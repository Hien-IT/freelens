/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The kubeconfig edits of the delete dialog (research R12 of
//! `specs/009-main-cluster-connection`): the contexts of a cluster's file, and
//! the removal of its context under the lock the Electron build takes with
//! proper-lockfile, so that the two builds exclude each other on a file.

use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use serde_json::Value;

use crate::catalog::kubeconfig;

/// A lock older than this is taken over (proper-lockfile's `stale`).
pub const STALE: Duration = Duration::from_secs(10);
/// Its holder touches it this often (`stale / 2`).
pub const TOUCH_EVERY: Duration = Duration::from_secs(5);
pub const HELD: &str = "Lock file is already being held";

/// The answer of `cluster-kubeconfig-contexts` (`KubeconfigSummary`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub contexts: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_context: Option<String>,
    /// The namespace of the cluster's own context.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_namespace: Option<String>,
}

fn read(path: &Path) -> Result<String, String> {
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    kubeconfig::decode(&bytes)
}

fn contexts_of(document: &Value) -> impl Iterator<Item = &Value> {
    document["contexts"].as_array().into_iter().flatten()
}

/// `cluster-kubeconfig-contexts`: the file read strictly, so that an entry
/// failing the schema fails the request.
pub fn contexts(path: &Path, context_name: &str) -> Result<Summary, String> {
    let text = read(path)?;
    if let Some(error) = kubeconfig::load(&text)?.schema_error {
        return Err(error);
    }
    let document = kubeconfig::parse_yaml(&text)?.unwrap_or_default();
    let text_of = |value: &Value| {
        value
            .as_str()
            .filter(|text| !text.is_empty())
            .map(str::to_string)
    };
    Ok(Summary {
        contexts: contexts_of(&document)
            .filter_map(|context| context["name"].as_str().map(str::to_string))
            .collect(),
        current_context: text_of(&document["current-context"]),
        default_namespace: contexts_of(&document)
            .find(|context| context["name"] == context_name)
            .and_then(|context| text_of(&context["context"]["namespace"])),
    })
}

/// The directory `<real path>.lock`, held while it exists.
pub struct Lock {
    dir: PathBuf,
    touch: tokio::task::JoinHandle<()>,
}

impl Lock {
    /// Takes the lock of the file at `real` at once, or fails with
    /// [`HELD`]; a stale one is taken over.
    pub fn acquire(real: &Path) -> Result<Self, String> {
        let mut dir = real.as_os_str().to_owned();
        dir.push(".lock");
        let dir = PathBuf::from(dir);
        if let Err(error) = fs::create_dir(&dir) {
            if error.kind() != io::ErrorKind::AlreadyExists {
                return Err(error.to_string());
            }
            let modified = fs::metadata(&dir)
                .and_then(|metadata| metadata.modified())
                .map_err(|error| error.to_string())?;
            let age = SystemTime::now()
                .duration_since(modified)
                .unwrap_or_default();
            if age <= STALE {
                return Err(HELD.into());
            }
            fs::remove_dir(&dir).map_err(|error| error.to_string())?;
            fs::create_dir(&dir).map_err(|error| match error.kind() {
                io::ErrorKind::AlreadyExists => HELD.to_string(),
                _ => error.to_string(),
            })?;
        }
        let touched = dir.clone();
        let touch = tokio::spawn(async move {
            let mut every =
                tokio::time::interval_at(tokio::time::Instant::now() + TOUCH_EVERY, TOUCH_EVERY);
            loop {
                every.tick().await;
                let _ =
                    fs::File::open(&touched).and_then(|file| file.set_modified(SystemTime::now()));
            }
        });
        Ok(Self { dir, touch })
    }
}

impl Drop for Lock {
    fn drop(&mut self) {
        self.touch.abort();
        let _ = fs::remove_dir(&self.dir);
    }
}

/// `remove-cluster-context-from-kubeconfig`: under the lock, drops the
/// contexts named `context_name` and sets `current-context` to `new_current`
/// when one is given; every other entry and field stays. Written to a file
/// next to the real path and renamed over it, with the file's mode, so that
/// a symbolic link stays and a reader never sees half a file.
pub async fn remove_context(
    path: &Path,
    context_name: &str,
    new_current: Option<&str>,
) -> Result<(), String> {
    let real = fs::canonicalize(path).map_err(|error| error.to_string())?;
    let _lock = Lock::acquire(&real)?;
    let text = read(&real)?;
    // The schema is not checked here, as the Electron build ignores it.
    let Some(mut document) = kubeconfig::parse_yaml(&text)? else {
        return Ok(());
    };
    let Some(root) = document.as_object_mut() else {
        return Err("the kubeconfig is not a mapping".into());
    };
    if let Some(Value::Array(contexts)) = root.get_mut("contexts") {
        contexts.retain(|context| context["name"] != context_name);
    }
    if let Some(current) = new_current.filter(|current| !current.is_empty()) {
        root.insert("current-context".into(), Value::from(current));
    }
    let yaml = serde_saphyr::to_string(&document).map_err(|error| error.to_string())?;
    let mode = fs::metadata(&real)
        .map_err(|error| error.to_string())?
        .permissions()
        .mode();
    let name = real
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let temp = real.with_file_name(format!(".{name}.{}.freelens-tmp", std::process::id()));
    let written = fs::write(&temp, yaml)
        .and_then(|()| fs::set_permissions(&temp, fs::Permissions::from_mode(mode)))
        .and_then(|()| fs::rename(&temp, &real));
    if let Err(error) = written {
        let _ = fs::remove_file(&temp);
        return Err(error.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const TOKEN: &str = "some-secret-token";

    fn kubeconfig() -> String {
        format!(
            "apiVersion: v1
kind: Config
clusters:
  - name: some-cluster
    cluster:
      server: https://some-server:6443
      x-unmodelled: kept
users:
  - name: some-user
    user:
      token: {TOKEN}
contexts:
  - name: some-context
    context:
      cluster: some-cluster
      user: some-user
      namespace: some-namespace
  - name: some-other-context
    context:
      cluster: some-cluster
      user: some-user
current-context: some-context
preferences:
  colors: true
"
        )
    }

    fn temp_dir() -> PathBuf {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!(
            "freelens-kubeconfig-edit-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn file_with(text: &str) -> PathBuf {
        let path = temp_dir().join("config");
        fs::write(&path, text).unwrap();
        path
    }

    fn parsed(path: &Path) -> Value {
        kubeconfig::parse_yaml(&fs::read_to_string(path).unwrap())
            .unwrap()
            .unwrap()
    }

    fn lock_dir(path: &Path) -> PathBuf {
        PathBuf::from(format!(
            "{}.lock",
            fs::canonicalize(path).unwrap().display()
        ))
    }

    fn age(path: &Path, seconds: u64) {
        let file = fs::File::open(path).unwrap();
        file.set_modified(SystemTime::now() - Duration::from_secs(seconds))
            .unwrap();
    }

    #[test]
    fn the_contexts_the_current_one_and_the_namespace_of_the_cluster_s_context_are_answered() {
        let path = file_with(&kubeconfig());
        let summary = contexts(&path, "some-context").unwrap();
        assert_eq!(
            summary,
            Summary {
                contexts: vec!["some-context".into(), "some-other-context".into()],
                current_context: Some("some-context".into()),
                default_namespace: Some("some-namespace".into()),
            }
        );
        let answer = serde_json::to_string(&summary).unwrap();
        assert!(!answer.contains(TOKEN));
        assert_eq!(
            serde_json::to_value(contexts(&path, "some-other-context").unwrap()).unwrap(),
            serde_json::json!({
                "contexts": ["some-context", "some-other-context"],
                "currentContext": "some-context",
            })
        );
    }

    #[test]
    fn an_entry_failing_the_schema_fails_the_contexts_and_not_the_removal() {
        let text = kubeconfig().replace(
            "  - name: some-user\n",
            "  - user: {}\n  - name: some-user\n",
        );
        let path = file_with(&text);
        assert!(contexts(&path, "some-context").is_err());
        tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(remove_context(&path, "some-context", None))
            .unwrap();
        let names: Vec<_> = parsed(&path)["contexts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|context| context["name"].clone())
            .collect();
        assert_eq!(names, vec![Value::from("some-other-context")]);
    }

    #[tokio::test]
    async fn the_context_is_removed_and_the_new_current_one_set() {
        let path = file_with(&kubeconfig());
        remove_context(&path, "some-context", Some("some-other-context"))
            .await
            .unwrap();
        let document = parsed(&path);
        let mut expected = kubeconfig::parse_yaml(&kubeconfig()).unwrap().unwrap();
        expected["contexts"].as_array_mut().unwrap().remove(0);
        expected["current-context"] = Value::from("some-other-context");
        // The clusters, users, other contexts and unmodelled fields stay, in order.
        assert_eq!(document, expected);
        assert_eq!(
            document.as_object().unwrap().keys().collect::<Vec<_>>(),
            expected.as_object().unwrap().keys().collect::<Vec<_>>()
        );
        assert!(!lock_dir(&path).exists());
    }

    #[tokio::test]
    async fn without_a_new_current_context_the_old_one_stays() {
        let path = file_with(&kubeconfig());
        remove_context(&path, "some-context", None).await.unwrap();
        assert_eq!(parsed(&path)["current-context"], "some-context");
        remove_context(&path, "some-other-context", Some(""))
            .await
            .unwrap();
        assert_eq!(parsed(&path)["current-context"], "some-context");
        assert_eq!(parsed(&path)["contexts"], serde_json::json!([]));
    }

    #[tokio::test]
    async fn the_mode_is_kept() {
        let path = file_with(&kubeconfig());
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600)).unwrap();
        remove_context(&path, "some-context", None).await.unwrap();
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[tokio::test]
    async fn a_symbolic_link_stays_and_its_target_is_written() {
        let target = file_with(&kubeconfig());
        let link = target.with_file_name("link");
        std::os::unix::fs::symlink(&target, &link).unwrap();
        remove_context(&link, "some-context", None).await.unwrap();
        assert!(
            fs::symlink_metadata(&link)
                .unwrap()
                .file_type()
                .is_symlink()
        );
        assert_eq!(parsed(&target)["contexts"].as_array().unwrap().len(), 1);
        // The lock is taken on the real path, as proper-lockfile's `realpath`.
        assert!(!PathBuf::from(format!("{}.lock", link.display())).exists());
    }

    #[tokio::test]
    async fn a_held_lock_fails_at_once_and_the_file_is_left_alone() {
        let path = file_with(&kubeconfig());
        fs::create_dir(lock_dir(&path)).unwrap();
        assert_eq!(
            remove_context(&path, "some-context", None).await,
            Err(HELD.into())
        );
        assert_eq!(fs::read_to_string(&path).unwrap(), kubeconfig());
        // Someone else's lock stays.
        assert!(lock_dir(&path).exists());
    }

    #[tokio::test]
    async fn a_lock_older_than_ten_seconds_is_taken_over() {
        let path = file_with(&kubeconfig());
        fs::create_dir(lock_dir(&path)).unwrap();
        age(&lock_dir(&path), 11);
        remove_context(&path, "some-context", None).await.unwrap();
        assert_eq!(parsed(&path)["contexts"].as_array().unwrap().len(), 1);
        assert!(!lock_dir(&path).exists());
    }

    #[tokio::test(start_paused = true)]
    async fn the_lock_is_touched_every_five_seconds_while_held() {
        let path = file_with(&kubeconfig());
        let real = fs::canonicalize(&path).unwrap();
        let lock = Lock::acquire(&real).unwrap();
        let dir = lock_dir(&path);
        age(&dir, 60);
        let modified = || fs::metadata(&dir).unwrap().modified().unwrap();
        tokio::time::sleep(Duration::from_secs(4)).await;
        assert!(SystemTime::now().duration_since(modified()).unwrap() >= Duration::from_secs(59));
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(SystemTime::now().duration_since(modified()).unwrap() < Duration::from_secs(5));
        // A second holder is refused while it is fresh.
        assert_eq!(Lock::acquire(&real).err(), Some(HELD.into()));
        drop(lock);
        assert!(!dir.exists());
    }
}
