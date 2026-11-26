/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The syncs and their synced files, as the Electron build's kubeconfig sync
//! keeps them: which files a sync has, the path chokidar reports for each, the
//! cluster id, the `file` label, and the order the catalog lists the clusters
//! in (`specs/008-main-catalog/contracts/synced-files.md`; research R4).

use std::collections::HashSet;
use std::path::{Path, PathBuf};

use md5::{Digest, Md5};
use serde_json::Value;

use super::kubeconfig::{FILE_SYNC_LIMIT, FOLDER_FILE_LIMIT, FileRead, read_synced_file};
use super::watch::{FileState, identity_of};
use super::{CatalogLog, ClusterSource};

/// Where a sync comes from (data-model.md `Sync.origin`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Origin {
    /// `<data dir>/kubeconfigs`, always synced, first.
    AppDir,
    /// An entry of the kubeconfig sync setting.
    Setting,
    /// The file of `--kubeconfig`, for the run only.
    Launch,
}

/// What a sync's path was when the sync started (data-model.md `Sync.kind`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SyncKind {
    File,
    Folder,
    Missing,
}

/// One kubeconfig file of a sync.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyncedFile {
    /// The path chokidar reports for it (data-model.md `Synced file.path`).
    pub path: String,
    /// Whether the last read found no kubeconfig in it, for the spike page.
    pub invalid: bool,
    /// The watcher's record of it.
    pub watch: FileState,
    /// The valid contexts of the last read, in the order the Electron build's
    /// map keeps them (data-model.md `Synced file.contexts`).
    pub contexts: Vec<String>,
}

/// One file or folder whose contexts the catalog lists.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Sync {
    pub path: String,
    pub origin: Origin,
    pub kind: SyncKind,
    /// In the order first seen (data-model.md `Sync.files`).
    pub files: Vec<SyncedFile>,
    /// The files of a folder left out by an ignore rule, logged once each.
    pub ignored: HashSet<String>,
}

impl Sync {
    /// The size limit of the files of this sync.
    pub fn limit(&self) -> u64 {
        match self.kind {
            SyncKind::Folder => FOLDER_FILE_LIMIT,
            _ => FILE_SYNC_LIMIT,
        }
    }

    pub fn file(&self, path: &str) -> Option<&SyncedFile> {
        self.files.iter().find(|file| file.path == path)
    }
}

/// Every sync of the catalog, in the order the Electron build's source map
/// keeps them: the application's directory, the setting's entries, the
/// launch file, then any added later.
pub struct SyncSet {
    syncs: Vec<Sync>,
    log: CatalogLog,
}

impl SyncSet {
    pub fn new(log: CatalogLog) -> Self {
        Self {
            syncs: Vec::new(),
            log,
        }
    }

    pub fn syncs(&self) -> &[Sync] {
        &self.syncs
    }

    pub fn syncs_mut(&mut self) -> &mut [Sync] {
        &mut self.syncs
    }

    /// Starts the syncs `desired` has and this set does not, each with its
    /// first scan, and stops the others; the application's directory never
    /// stops. Returns the paths of the syncs it started.
    pub fn reconcile(&mut self, desired: &[(String, Origin)]) -> Vec<String> {
        let wanted: HashSet<&str> = desired.iter().map(|(path, _)| path.as_str()).collect();
        let log = self.log.clone();
        self.syncs.retain(|sync| {
            let keep = sync.origin == Origin::AppDir || wanted.contains(sync.path.as_str());
            if !keep {
                log.info(&format!("stopping sync of file/folder {}", sync.path));
            }
            keep
        });
        let mut started = Vec::new();
        for (path, origin) in desired {
            if self.syncs.iter().any(|sync| sync.path == *path) {
                continue;
            }
            let sync = start_sync(path, *origin, &self.log);
            self.log
                .info(&format!("starting sync of file/folder {path}"));
            started.push(path.clone());
            self.syncs.push(sync);
        }
        started
    }

    /// The clusters of every sync, each id once, from the first sync and file
    /// that give it (`manager.ts` drops the ids it has seen).
    pub fn clusters(&self) -> Vec<ClusterSource> {
        let mut seen = HashSet::new();
        let mut clusters = Vec::new();
        for sync in &self.syncs {
            for file in &sync.files {
                for context in &file.contexts {
                    let id = cluster_id(&file.path, context);
                    if seen.insert(id.clone()) {
                        clusters.push(ClusterSource {
                            id,
                            context_name: context.clone(),
                            kubeconfig_path: PathBuf::from(&file.path),
                        });
                    }
                }
            }
        }
        clusters
    }
}

/// Stats the sync's path, following symbolic links, and reads every file it
/// has at once, as the first scan of chokidar emits them.
fn start_sync(path: &str, origin: Origin, log: &CatalogLog) -> Sync {
    let kind = match std::fs::metadata(path) {
        Ok(meta) if meta.is_dir() => SyncKind::Folder,
        Ok(_) => SyncKind::File,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            log.debug(&format!("skipping missing file/folder {path}"));
            SyncKind::Missing
        }
        Err(error) => {
            log.warn(&format!(
                "failed to start watching changes: {error} ({path})"
            ));
            SyncKind::Missing
        }
    };
    let mut sync = Sync {
        path: path.to_string(),
        origin,
        kind,
        files: Vec::new(),
        ignored: HashSet::new(),
    };
    let (files, ignored) = list_files(&sync);
    for (file, rule) in ignored {
        log.info(&format!("ignoring {file} due to ignore rule: {rule}"));
        sync.ignored.insert(file);
    }
    for file in files {
        let identity = identity_of(Path::new(&file));
        let read = read_synced_file(Path::new(&file), sync.limit(), log);
        sync.files.push(SyncedFile {
            path: file,
            invalid: read == FileRead::Invalid,
            contexts: read.contexts().unwrap_or_default(),
            watch: FileState::read(identity),
        });
    }
    sync
}

/// The paths of the files a sync has now: its own path for a file sync while
/// it exists; for a folder sync, each entry directly in it that is not a
/// folder once symbolic links are followed and whose name no ignore rule
/// matches, in name order. Also the files an ignore rule left out, with it.
pub fn list_files(sync: &Sync) -> (Vec<String>, Vec<(String, &'static str)>) {
    match sync.kind {
        SyncKind::Missing => (Vec::new(), Vec::new()),
        SyncKind::File => {
            let exists = std::fs::metadata(&sync.path).is_ok_and(|meta| !meta.is_dir());
            (
                if exists {
                    vec![sync.path.clone()]
                } else {
                    Vec::new()
                },
                Vec::new(),
            )
        }
        SyncKind::Folder => {
            let Ok(entries) = std::fs::read_dir(&sync.path) else {
                return (Vec::new(), Vec::new());
            };
            let mut names: Vec<String> = entries
                .flatten()
                .filter_map(|entry| entry.file_name().into_string().ok())
                .collect();
            names.sort();
            let mut files = Vec::new();
            let mut ignored = Vec::new();
            for name in names {
                let path = join(&sync.path, &name);
                match std::fs::metadata(&path) {
                    Ok(meta) if !meta.is_dir() => {}
                    _ => continue,
                }
                match ignored_by(&name) {
                    Some(rule) => ignored.push((path, rule)),
                    None => files.push(path),
                }
            }
            (files, ignored)
        }
    }
}

/// The ignore rule a file name of a folder sync matches
/// (`matchIgnoredKubeconfigFileName` of `watch-file-changes.injectable.ts`).
pub fn ignored_by(name: &str) -> Option<&'static str> {
    const NAMES: [&str; 6] = [
        ".DS_Store",
        "Thumbs.db",
        "cache",
        "desktop.ini",
        "kubectx",
        "kubens",
    ];
    if let Some(exact) = NAMES.iter().find(|exact| **exact == name) {
        return Some(exact);
    }
    type Rule = (&'static str, fn(&str) -> bool);
    let patterns: [Rule; 8] = [
        (r"^\._", |n| n.starts_with("._")),
        (r"^\.#", |n| n.starts_with(".#")),
        ("^~", |n| n.starts_with('~')),
        (r"\.bak$", |n| n.ends_with(".bak")),
        (r"\.lock$", |n| n.ends_with(".lock")),
        (r"\.sw[nop]$", |n| {
            n.ends_with(".swn") || n.ends_with(".swo") || n.ends_with(".swp")
        }),
        ("#$", |n| n.ends_with('#')),
        ("~$", |n| n.ends_with('~')),
    ];
    patterns
        .iter()
        .find(|(_, matches)| matches(name))
        .map(|(source, _)| *source)
}

/// The syncs the settings give, in the setting's order: the keys of
/// `syncKubeconfigEntries`, or the Electron build's default when the setting
/// is unset (the kube directory for a release build, nothing for a debug one).
pub fn setting_paths(preferences: &Value, default: &[String]) -> Vec<String> {
    match preferences
        .get("syncKubeconfigEntries")
        .and_then(Value::as_array)
    {
        Some(entries) => entries
            .iter()
            .filter_map(|entry| entry.get("filePath").and_then(Value::as_str))
            .map(normalize)
            .collect(),
        None => default.iter().map(|path| normalize(path)).collect(),
    }
}

/// The syncs in the order of data-model.md `Sync.origin`.
pub fn desired(
    app_dir: &Path,
    setting: Vec<String>,
    launch: Option<&Path>,
) -> Vec<(String, Origin)> {
    let mut desired = vec![(normalize(&app_dir.display().to_string()), Origin::AppDir)];
    let mut push = |path: String, origin| {
        if !desired.iter().any(|(existing, _)| *existing == path) {
            desired.push((path, origin));
        }
    };
    for path in setting {
        push(path, Origin::Setting);
    }
    if let Some(launch) = launch {
        push(normalize(&launch.display().to_string()), Origin::Launch);
    }
    desired
}

/// The one sync of a catalog built from a single file.
pub fn desired_launch_only(path: &Path) -> Vec<(String, Origin)> {
    vec![(normalize(&path.display().to_string()), Origin::Launch)]
}

/// chokidar's `normalizePath`: backslashes become slashes, then Node's
/// `path.normalize`, which keeps a trailing slash, then repeated slashes
/// collapse, a leading `//` kept.
pub fn normalize(path: &str) -> String {
    let unix = path.replace('\\', "/");
    let unc = unix.starts_with("//");
    let mut normalized = node_normalize(&unix);
    while normalized.contains("//") {
        normalized = normalized.replace("//", "/");
    }
    if unc && !normalized.starts_with("//") {
        normalized.insert(0, '/');
    }
    normalized
}

/// Node's `path.posix.normalize`.
fn node_normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".to_string();
    }
    let absolute = path.starts_with('/');
    let trailing = path.ends_with('/');
    let mut segments: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.last().is_some_and(|last| *last != "..") {
                    segments.pop();
                } else if !absolute {
                    segments.push("..");
                }
            }
            other => segments.push(other),
        }
    }
    let mut normalized = segments.join("/");
    if normalized.is_empty() && !absolute {
        normalized.push('.');
    }
    if !normalized.is_empty() && trailing {
        normalized.push('/');
    }
    if absolute {
        normalized.insert(0, '/');
    }
    normalized
}

/// Node's `path.join` of a folder and a name.
pub fn join(folder: &str, name: &str) -> String {
    node_normalize(&format!("{folder}/{name}"))
}

/// The id the Electron build gives a cluster: the MD5 of `<path>:<context>`.
pub fn cluster_id(path: &str, context: &str) -> String {
    Md5::digest(format!("{path}:{context}").as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The `file` label: none for a file whose path starts with the string of the
/// application's kubeconfig directory; otherwise the path with the first
/// occurrence of the home directory written `~` (`compute-diff.injectable.ts`).
pub fn file_label(path: &str, app_dir: &str, home: Option<&str>) -> Option<String> {
    if path.starts_with(app_dir) {
        return None;
    }
    Some(match home {
        Some(home) if !home.is_empty() => path.replacen(home, "~", 1),
        _ => path.to_string(),
    })
}

/// The contexts of a file after a read, as `computeKubeconfigDiff` changes
/// its map: the ones that stay keep their place, the ones that left go, the
/// new ones follow in file order.
pub fn merge_contexts(before: &[String], after: &[String]) -> Vec<String> {
    let mut merged: Vec<String> = before
        .iter()
        .filter(|context| after.contains(context))
        .cloned()
        .collect();
    for context in after {
        if !merged.contains(context) {
            merged.push(context.clone());
        }
    }
    merged
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use serde_json::json;

    const KUBECONFIG: &str = "clusters:\n- name: c\n  cluster:\n    server: https://c.example.invalid\nusers:\n- name: u\n  user:\n    token: placeholder\ncontexts:\n- name: ctx-1\n  context:\n    cluster: c\n    user: u\n- name: ctx-2\n  context:\n    cluster: c\n    user: u\n";

    struct TempDir(PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "freelens-syncs-test-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path.canonicalize().unwrap())
        }

        fn path(&self, name: &str) -> String {
            self.0.join(name).display().to_string()
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn recording() -> (CatalogLog, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let log = CatalogLog::new(
            Arc::new(move |line: &str| sink.lock().unwrap().push(line.to_string())),
            true,
        );
        (log, lines)
    }

    #[test]
    fn the_syncs_come_in_the_order_of_their_origin() {
        let desired = desired(
            Path::new("/data/kubeconfigs"),
            vec!["/home/me/.kube".into(), "/work/dev.yaml".into()],
            Some(Path::new("/tmp/launch.yaml")),
        );
        assert_eq!(
            desired,
            [
                ("/data/kubeconfigs".to_string(), Origin::AppDir),
                ("/home/me/.kube".to_string(), Origin::Setting),
                ("/work/dev.yaml".to_string(), Origin::Setting),
                ("/tmp/launch.yaml".to_string(), Origin::Launch),
            ]
        );
    }

    #[test]
    fn the_setting_s_default_applies_only_when_it_is_unset() {
        let default = vec!["/home/me/.kube".to_string()];
        assert_eq!(setting_paths(&json!({}), &default), default);
        assert!(setting_paths(&json!({ "syncKubeconfigEntries": [] }), &default).is_empty());
        assert!(setting_paths(&json!({}), &[]).is_empty());
        assert_eq!(
            setting_paths(
                &json!({ "syncKubeconfigEntries": [{ "filePath": "/b" }, { "filePath": "/a/" }, { "other": 1 }] }),
                &default
            ),
            ["/b", "/a/"]
        );
    }

    #[test]
    fn normalizes_as_chokidar_does() {
        assert_eq!(normalize("/a/b/../c/./d"), "/a/c/d");
        assert_eq!(normalize("/a//b///c"), "/a/b/c");
        assert_eq!(normalize("/a/b/"), "/a/b/");
        assert_eq!(normalize("\\a\\b"), "/a/b");
        assert_eq!(normalize("//server/share/x"), "//server/share/x");
        assert_eq!(normalize("a/../../b"), "../b");
        assert_eq!(normalize("/.."), "/");
        assert_eq!(join("/a/b/", "config"), "/a/b/config");
        assert_eq!(join("/a/b", "config"), "/a/b/config");
    }

    #[test]
    fn the_id_is_the_md5_of_the_path_and_the_context() {
        // `md5 -s "/Users/me/.kube/config:kind-freelens-profile"`
        assert_eq!(
            cluster_id("/Users/me/.kube/config", "kind-freelens-profile"),
            "fbfacebb6727e499ecefddb07e27418e"
        );
        // `md5 -s "/foobar/config:context-name"`, the path of the test of
        // `kubeconfig-sync.test.ts` that finds a single entity.
        assert_eq!(
            cluster_id("/foobar/config", "context-name"),
            "64c31b65bb1bc49ebb0e06e27f9e0bf8"
        );
    }

    #[test]
    fn the_file_label_writes_the_home_directory_once() {
        assert_eq!(
            file_label(
                "/Users/me/work/me.yaml",
                "/data/kubeconfigs",
                Some("/Users/me")
            ),
            Some("~/work/me.yaml".to_string())
        );
        assert_eq!(
            file_label(
                "/x/Users/me/Users/me",
                "/data/kubeconfigs",
                Some("/Users/me")
            ),
            Some("/x~/Users/me".to_string())
        );
        assert_eq!(
            file_label(
                "/data/kubeconfigs/1234",
                "/data/kubeconfigs",
                Some("/Users/me")
            ),
            None
        );
        // The prefix is compared as a string, as `startsWith` compares it.
        assert_eq!(
            file_label("/data/kubeconfigs-old/x", "/data/kubeconfigs", None),
            None
        );
    }

    #[test]
    fn every_ignore_rule_of_the_electron_build_matches() {
        for (name, rule) in [
            (".DS_Store", ".DS_Store"),
            ("Thumbs.db", "Thumbs.db"),
            ("cache", "cache"),
            ("desktop.ini", "desktop.ini"),
            ("kubectx", "kubectx"),
            ("kubens", "kubens"),
            ("._config", r"^\._"),
            (".#config", r"^\.#"),
            ("~config", "^~"),
            ("config.bak", r"\.bak$"),
            ("config.lock", r"\.lock$"),
            (".config.swp", r"\.sw[nop]$"),
            (".config.swo", r"\.sw[nop]$"),
            (".config.swn", r"\.sw[nop]$"),
            ("#config#", "#$"),
            ("config~", "~$"),
        ] {
            assert_eq!(ignored_by(name), Some(rule), "{name}");
        }
        for name in [
            "config",
            ".kube-config",
            "config.yaml",
            "cache.yaml",
            "swp",
            "lock",
        ] {
            assert_eq!(ignored_by(name), None, "{name}");
        }
    }

    #[test]
    fn a_folder_has_its_direct_files_links_to_files_and_no_ignored_name() {
        let dir = TempDir::new();
        let folder = dir.path("folder");
        std::fs::create_dir(&folder).unwrap();
        std::fs::write(join(&folder, "b"), KUBECONFIG).unwrap();
        std::fs::write(join(&folder, "a"), KUBECONFIG).unwrap();
        std::fs::write(join(&folder, "a.bak"), KUBECONFIG).unwrap();
        std::fs::create_dir(join(&folder, "sub")).unwrap();
        std::fs::write(join(&join(&folder, "sub"), "inner"), KUBECONFIG).unwrap();
        let outside = dir.path("outside");
        std::fs::write(&outside, KUBECONFIG).unwrap();
        std::os::unix::fs::symlink(&outside, join(&folder, "link")).unwrap();
        std::os::unix::fs::symlink(dir.path("folder/sub"), join(&folder, "dirlink")).unwrap();
        let (log, lines) = recording();
        let mut set = SyncSet::new(log);
        set.reconcile(&[(folder.clone(), Origin::Setting)]);
        let files: Vec<&str> = set.syncs()[0]
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert_eq!(
            files,
            [
                join(&folder, "a"),
                join(&folder, "b"),
                join(&folder, "link")
            ]
        );
        assert!(
            lines
                .lock()
                .unwrap()
                .iter()
                .any(|line| line.contains("a.bak due to ignore rule: \\.bak$"))
        );
    }

    #[test]
    fn a_missing_path_is_skipped_with_a_debug_line_and_no_warning() {
        let (log, lines) = recording();
        let mut set = SyncSet::new(log);
        set.reconcile(&[("/no/such/path".into(), Origin::Setting)]);
        assert_eq!(set.syncs()[0].kind, SyncKind::Missing);
        assert!(set.clusters().is_empty());
        let lines = lines.lock().unwrap();
        assert!(
            lines
                .iter()
                .any(|line| line == "debug: Catalog: skipping missing file/folder /no/such/path")
        );
        assert!(!lines.iter().any(|line| line.starts_with("warn: ")));
    }

    #[test]
    fn a_file_reached_by_two_syncs_gives_each_context_once_from_the_first() {
        let dir = TempDir::new();
        let folder = dir.path("foobar");
        std::fs::create_dir(&folder).unwrap();
        let config = join(&folder, "config");
        std::fs::write(&config, KUBECONFIG).unwrap();
        let (log, _) = recording();
        let mut set = SyncSet::new(log);
        set.reconcile(&[
            (config.clone(), Origin::Setting),
            (folder.clone(), Origin::Setting),
        ]);
        let clusters = set.clusters();
        assert_eq!(clusters.len(), 2);
        assert!(
            clusters
                .iter()
                .all(|cluster| cluster.kubeconfig_path == Path::new(&config))
        );
        assert_eq!(clusters[0].id, cluster_id(&config, "ctx-1"));
    }

    #[test]
    fn reconcile_starts_and_stops_syncs_and_keeps_the_application_s_directory() {
        let dir = TempDir::new();
        let app = dir.path("kubeconfigs");
        std::fs::create_dir(&app).unwrap();
        let file = dir.path("dev.yaml");
        std::fs::write(&file, KUBECONFIG).unwrap();
        let (log, lines) = recording();
        let mut set = SyncSet::new(log);
        set.reconcile(&[
            (app.clone(), Origin::AppDir),
            (file.clone(), Origin::Setting),
        ]);
        assert_eq!(set.clusters().len(), 2);
        let started = set.reconcile(&[]);
        assert!(started.is_empty());
        assert_eq!(set.syncs().len(), 1);
        assert_eq!(set.syncs()[0].path, app);
        assert!(set.clusters().is_empty());
        let lines = lines.lock().unwrap();
        assert!(
            lines
                .iter()
                .any(|line| *line == format!("Catalog: starting sync of file/folder {file}"))
        );
        assert!(
            lines
                .iter()
                .any(|line| *line == format!("Catalog: stopping sync of file/folder {file}"))
        );
    }

    #[test]
    fn contexts_that_stay_keep_their_place_and_new_ones_follow() {
        let before = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let after = vec!["d".to_string(), "c".to_string(), "a".to_string()];
        assert_eq!(merge_contexts(&before, &after), ["a", "c", "d"]);
    }
}
