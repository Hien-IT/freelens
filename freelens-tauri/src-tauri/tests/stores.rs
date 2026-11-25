/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The store files of `specs/007-main-foundation/contracts/store-format.md`.

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};

use freelens_tauri::stores::file::{LoadError, StoreFile};
use serde_json::{Map, Value, json};

/// A directory of its own under the temporary directory, removed on drop.
struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "freelens-stores-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }

    fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = set_mode(&self.0, 0o755);
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn set_mode(path: &Path, mode: u32) -> std::io::Result<()> {
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

const VERSION_BLOCK: &str =
    "{\n\t\"__internal__\": {\n\t\t\"migrations\": {\n\t\t\t\"version\": \"0.1.0\"\n\t\t}\n\t}\n}";

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        other => panic!("not an object: {other}"),
    }
}

fn opened(path: &Path) -> StoreFile {
    let mut file = StoreFile::read(path).unwrap();
    if file.raise_version() {
        file.write().unwrap();
    }
    file
}

fn temporary_files(dir: &Path) -> Vec<String> {
    fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .filter(|name| name.contains(".tmp-"))
        .collect()
}

#[test]
fn a_missing_file_is_written_with_the_version_and_read_as_empty() {
    let dir = TempDir::new();
    let path = dir.file("nested/lens-user-store.json");
    let file = opened(&path);
    assert_eq!(fs::read_to_string(&path).unwrap(), VERSION_BLOCK);
    assert_eq!(file.data(), Map::new());
}

#[test]
fn a_bom_is_stripped() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    fs::write(&path, "\u{feff}{\"a\": 1}").unwrap();
    let file = StoreFile::read(&path).unwrap();
    assert_eq!(file.data(), object(json!({"a": 1})));
}

#[test]
fn json_that_is_not_an_object_reads_as_empty() {
    let dir = TempDir::new();
    for (index, text) in ["[]", "null", "5", "\"text\""].iter().enumerate() {
        let path = dir.file(&format!("store-{index}.json"));
        fs::write(&path, text).unwrap();
        let file = opened(&path);
        assert_eq!(file.data(), Map::new(), "for {text}");
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            VERSION_BLOCK,
            "for {text}"
        );
    }
}

#[test]
fn the_version_moves_forward_only() {
    let dir = TempDir::new();
    let cases = [
        (json!({"a": 1}), Some("0.1.0")),
        (
            json!({"__internal__": {"migrations": {"version": "0.0.9"}}}),
            Some("0.1.0"),
        ),
        (
            json!({"__internal__": {"migrations": {"version": "0.1.0-beta.1"}}}),
            Some("0.1.0"),
        ),
        (
            json!({"__internal__": {"migrations": {"version": "0.x || 1.x"}}}),
            Some("0.1.0"),
        ),
        (
            json!({"__internal__": {"migrations": {"version": 3}}}),
            Some("0.1.0"),
        ),
        (
            json!({"__internal__": {"migrations": {"version": "0.1.0"}}}),
            None,
        ),
        (
            json!({"__internal__": {"migrations": {"version": "9.0.0"}}}),
            None,
        ),
        (
            json!({"__internal__": {"migrations": {"version": "v0.2.0"}}}),
            None,
        ),
    ];
    for (index, (content, raised)) in cases.into_iter().enumerate() {
        let path = dir.file(&format!("store-{index}.json"));
        fs::write(&path, content.to_string()).unwrap();
        let mut file = StoreFile::read(&path).unwrap();
        assert_eq!(file.raise_version(), raised.is_some(), "for {content}");
        let version = &file.content()["__internal__"]["migrations"]["version"];
        match raised {
            Some(expected) => assert_eq!(version, expected, "for {content}"),
            None => assert_eq!(version, &content["__internal__"]["migrations"]["version"]),
        }
    }
}

#[test]
fn the_version_goes_after_the_keys_of_a_file_without_it() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    fs::write(&path, r#"{"b": 1, "a": 2}"#).unwrap();
    opened(&path);
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{\n\t\"b\": 1,\n\t\"a\": 2,\n\t\"__internal__\": {\n\t\t\"migrations\": {\n\t\t\t\"version\": \"0.1.0\"\n\t\t}\n\t}\n}"
    );
}

#[test]
fn a_write_prints_the_bytes_of_json_stringify() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    let mut file = opened(&path);
    file.merge(
        &["hotbars"],
        &object(json!({"hotbars": [{"id": "1", "items": [null]}]})),
    );
    file.write().unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{\n\t\"__internal__\": {\n\t\t\"migrations\": {\n\t\t\t\"version\": \"0.1.0\"\n\t\t}\n\t},\n\t\"hotbars\": [\n\t\t{\n\t\t\t\"id\": \"1\",\n\t\t\t\"items\": [\n\t\t\t\tnull\n\t\t\t]\n\t\t}\n\t]\n}"
    );
}

#[test]
fn a_write_keeps_the_mode_of_the_file() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    fs::write(&path, "{}").unwrap();
    set_mode(&path, 0o640).unwrap();
    opened(&path);
    assert_eq!(mode(&path), 0o640);
}

#[test]
fn a_new_file_gets_the_mode_a_created_file_gets() {
    let dir = TempDir::new();
    let reference = dir.file("reference");
    fs::File::create(&reference).unwrap();
    let path = dir.file("store.json");
    opened(&path);
    assert_eq!(mode(&path), mode(&reference));
}

#[test]
fn a_write_leaves_no_temporary_file() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    opened(&path);
    assert!(temporary_files(&dir.0).is_empty());
}

#[test]
fn a_failed_write_removes_its_temporary_file() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    let mut file = StoreFile::read(&path).unwrap();
    file.raise_version();
    // A non-empty directory where the file should go: the rename fails.
    fs::create_dir_all(path.join("in-the-way")).unwrap();
    assert!(file.write().is_err());
    assert!(temporary_files(&dir.0).is_empty());
}

#[test]
fn merging_a_model_follows_persist_state_to_config() {
    let dir = TempDir::new();
    let path = dir.file("store.json");
    fs::write(
        &path,
        r#"{"__internal__": {"migrations": {"version": "0.1.0"}}, "a": 1, "unknown": true, "b": 2}"#,
    )
    .unwrap();
    let mut file = StoreFile::read(&path).unwrap();
    file.merge(&["a", "b", "c"], &object(json!({"c": 3, "a": 10})));
    let keys: Vec<_> = file.content().keys().cloned().collect();
    assert_eq!(keys, ["__internal__", "a", "unknown", "c"]);
    assert_eq!(
        file.data(),
        object(json!({"a": 10, "unknown": true, "c": 3}))
    );
}

#[test]
fn files_the_core_cannot_use_come_back_as_distinct_errors() {
    let dir = TempDir::new();

    let invalid = dir.file("invalid.json");
    fs::write(&invalid, "{").unwrap();
    assert!(matches!(
        StoreFile::read(&invalid),
        Err(LoadError::Invalid(_))
    ));

    let empty = dir.file("empty.json");
    fs::write(&empty, "").unwrap();
    assert!(matches!(
        StoreFile::read(&empty),
        Err(LoadError::Invalid(_))
    ));

    let surrogate = dir.file("surrogate.json");
    fs::write(&surrogate, r#"{"a": "\ud800"}"#).unwrap();
    assert!(matches!(
        StoreFile::read(&surrogate),
        Err(LoadError::ReadableByJavaScriptOnly(_))
    ));

    let unreadable = dir.file("unreadable.json");
    fs::write(&unreadable, "{}").unwrap();
    set_mode(&unreadable, 0o000).unwrap();
    assert!(matches!(
        StoreFile::read(&unreadable),
        Err(LoadError::Unreadable(_))
    ));
}

// The store layer: the channels of the stores, `Stores`, and the fixtures of
// research R13, which the Electron build's own code produced.

use std::sync::{Arc, Mutex};

use freelens_tauri::catalog::Catalog;
use freelens_tauri::foundation::paths::BuildKind;
use freelens_tauri::messaging::{Log, Messaging, routes};
use freelens_tauri::options::KubeconfigChoice;
use freelens_tauri::stores::{Machine, StoreName, Stores};
use freelens_tauri::{Checks, register_core};
use http::{Method, Request, header};

const MAIN: &str = "freelens-app://renderer.freelens.app";
const STORES: [&str; 5] = [
    "lens-user-store",
    "lens-cluster-store",
    "freelens-favorites-store",
    "lens-hotbar-store",
    "lens-weblink-store",
];

fn machine() -> Machine {
    Machine {
        kube_dir: "/home/test/.kube".into(),
        timezone: "UTC".into(),
        build: BuildKind::Release,
    }
}

struct Core {
    catalog: Catalog,
    messaging: Messaging,
    stores: Stores,
    lines: Arc<Mutex<Vec<String>>>,
}

fn core_on(dir: &Path) -> Core {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    let catalog = Catalog::load(
        &KubeconfigChoice::File(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/three-contexts.yaml"),
        ),
        None,
    );
    let stores = Stores::load(dir, machine(), Arc::clone(&log));
    let core = register_core(Checks::default(), "0.1.0".into(), &catalog, &stores, &log).unwrap();
    Core {
        catalog,
        messaging: core.messaging,
        stores,
        lines,
    }
}

async fn post(core: &Core, host: &str, path: &str, body: Value) -> Value {
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("{host}{path}"))
        .header(header::ORIGIN, host)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into_bytes())
        .unwrap();
    let response = routes::handle(request, &core.catalog, &core.messaging).await;
    if response.body().is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(response.body()).unwrap()
    }
}

async fn send(core: &Core, host: &str, channel: &str, payload: Value) {
    post(
        core,
        host,
        "/ipc/messages",
        json!({"messages": [{"channel": channel, "payload": payload}]}),
    )
    .await;
}

async fn poll(core: &Core, host: &str, session: &str, after: u64) -> Vec<Value> {
    post(
        core,
        host,
        "/ipc/poll",
        json!({"session": session, "after": after}),
    )
    .await["messages"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn store_path(dir: &Path, name: &str) -> PathBuf {
    dir.join(format!("{name}.json"))
}

#[tokio::test]
async fn the_initial_values_hold_the_five_stores() {
    let dir = TempDir::new();
    let core = core_on(&dir.0);
    let answer = post(
        &core,
        MAIN,
        "/ipc/request",
        json!({"channel": "persistent-storage-initial-values"}),
    )
    .await;
    let values = answer["payload"].as_array().unwrap();
    let names: Vec<_> = values
        .iter()
        .map(|value| value["configName"].clone())
        .collect();
    assert_eq!(names, STORES.map(Value::from));
    for value in values {
        let name = value["configName"].as_str().unwrap();
        assert_eq!(
            value["path"],
            store_path(&dir.0, name).to_string_lossy().as_ref()
        );
        assert!(value["model"].is_object(), "for {name}");
    }
    assert_eq!(
        values[2]["model"],
        json!({"items": [], "useShortNames": true})
    );
}

#[tokio::test(start_paused = true)]
async fn a_model_from_a_view_is_written_and_sent_to_every_view() {
    let dir = TempDir::new();
    let core = core_on(&dir.0);
    let path = store_path(&dir.0, "freelens-favorites-store");
    poll(&core, MAIN, "main", 0).await;
    let model = json!({"items": [{"id": "x", "type": "static", "title": "X", "order": 1}], "useShortNames": false});
    send(
        &core,
        MAIN,
        &format!("store-sync-main:{}", path.display()),
        model.clone(),
    )
    .await;

    let messages = poll(&core, MAIN, "main", 0).await;
    assert_eq!(messages.len(), 1, "the sender gets the model too");
    assert_eq!(
        messages[0]["channel"],
        format!("store-sync-renderer:{}", path.display())
    );
    assert_eq!(messages[0]["payload"], model);
    assert_eq!(core.stores.model(StoreName::Favorites), model);
    let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written["items"], model["items"]);
    assert_eq!(written["useShortNames"], false);

    // The same model again writes and sends nothing.
    let before = fs::metadata(&path).unwrap().modified().unwrap();
    send(
        &core,
        MAIN,
        &format!("store-sync-main:{}", path.display()),
        model.clone(),
    )
    .await;
    assert!(poll(&core, MAIN, "main", 1).await.is_empty());
    assert_eq!(fs::metadata(&path).unwrap().modified().unwrap(), before);
}

#[tokio::test]
async fn a_model_that_is_not_an_object_is_dropped() {
    let dir = TempDir::new();
    let core = core_on(&dir.0);
    let path = store_path(&dir.0, "lens-weblink-store");
    let before = fs::read_to_string(&path).unwrap();
    send(
        &core,
        MAIN,
        &format!("store-sync-main:{}", path.display()),
        json!([1, 2]),
    )
    .await;
    assert_eq!(fs::read_to_string(&path).unwrap(), before);
    assert!(
        core.lines
            .lock()
            .unwrap()
            .iter()
            .any(|line| line.contains("dropped a model of lens-weblink-store")),
        "{:?}",
        core.lines.lock().unwrap()
    );
}

#[tokio::test]
async fn two_views_one_after_the_other_end_with_the_last_model() {
    let dir = TempDir::new();
    let core = core_on(&dir.0);
    let path = store_path(&dir.0, "lens-weblink-store");
    let channel = format!("store-sync-main:{}", path.display());
    let cluster_view = format!(
        "freelens-app://{}.renderer.freelens.app",
        core.catalog.entries[0].id
    );
    send(&core, MAIN, &channel, json!({"weblinks": [{"id": "a"}]})).await;
    send(
        &core,
        &cluster_view,
        &channel,
        json!({"weblinks": [{"id": "b"}]}),
    )
    .await;
    let expected = json!({"weblinks": [{"id": "b"}]});
    assert_eq!(core.stores.model(StoreName::Weblink), expected);
    let written: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
    assert_eq!(written["weblinks"], expected["weblinks"]);
}

#[test]
fn update_and_on_change_follow_the_contract() {
    let dir = TempDir::new();
    let stores = Stores::load(&dir.0, machine(), Arc::new(|_| {}));
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    stores.on_change(move |store, model| sink.lock().unwrap().push((store, model.clone())));
    let model = json!({"preferences": {"httpsProxy": "http://proxy:3128"}});
    assert!(stores.update(StoreName::User, model.clone()));
    assert!(!stores.update(StoreName::User, model));
    assert_eq!(seen.lock().unwrap().len(), 1);
    assert_eq!(seen.lock().unwrap()[0].0, StoreName::User);
    assert_eq!(
        stores.preferences().https_proxy.as_deref(),
        Some("http://proxy:3128")
    );
    assert_eq!(stores.data_dir(), dir.0.as_path());
}

#[test]
fn the_core_touches_no_other_file_of_the_data_directory() {
    let dir = TempDir::new();
    let extensions = [
        ("lens-extensions.json", "{\"extensions\": {}}"),
        ("installed-extensions.json", "{\n  \"installed\": []\n}"),
    ];
    for (name, text) in extensions {
        fs::write(dir.file(name), text).unwrap();
    }
    let stores = Stores::load(&dir.0, machine(), Arc::new(|_| {}));
    stores.update(
        StoreName::Hotbar,
        json!({"hotbars": [{"id": "h", "name": "H"}]}),
    );
    let mut names: Vec<String> = fs::read_dir(&dir.0)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    let mut expected: Vec<String> = STORES.iter().map(|name| format!("{name}.json")).collect();
    expected.extend(extensions.iter().map(|(name, _)| name.to_string()));
    expected.sort();
    assert_eq!(names, expected);
    for (name, text) in extensions {
        assert_eq!(
            fs::read_to_string(dir.file(name)).unwrap(),
            text,
            "for {name}"
        );
    }
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/data-dir")
}

fn without_random_ids(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(index) = rest.find(|c: char| c.is_ascii_hexdigit()) {
        out.push_str(&rest[..index]);
        rest = &rest[index..];
        let candidate = rest.get(..36).filter(|candidate| uuid_shaped(candidate));
        match candidate {
            Some(_) => {
                out.push_str("<uuid>");
                rest = &rest[36..];
            }
            None => {
                let next = rest.chars().next().unwrap();
                out.push(next);
                rest = &rest[next.len_utf8()..];
            }
        }
    }
    out.push_str(rest);
    out
}

fn uuid_shaped(text: &str) -> bool {
    text.len() == 36
        && text.char_indices().all(|(index, c)| match index {
            8 | 13 | 18 | 23 => c == '-',
            _ => c.is_ascii_hexdigit() && !c.is_ascii_uppercase(),
        })
        && uuid::Uuid::parse_str(text).is_ok_and(|id| id.get_version_num() == 4)
}

/// The copies of the files that were not valid JSON, by store.
fn corrupt_copies(dir: &Path) -> Map<String, Value> {
    fs::read_dir(dir)
        .unwrap()
        .filter_map(|entry| {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            let (store, rest) = name.split_once(".corrupt-")?;
            let stamp = rest.strip_suffix(".json")?;
            (!stamp.is_empty() && stamp.bytes().all(|byte| byte.is_ascii_digit())).then(|| {
                let text = fs::read_to_string(dir.join(&name)).unwrap();
                (store.to_string(), Value::String(text))
            })
        })
        .collect()
}

/// Runs every case of `fixtures()`. The `core-only-` cases hold the deliberate
/// differences of research R3, which the Electron build's test skips; with
/// `UPDATE_TAURI_PARITY=1` their `expected/` is written from the core.
#[test]
fn every_fixture_case_gives_the_models_and_bytes_of_the_electron_build() {
    let update = std::env::var("UPDATE_TAURI_PARITY").as_deref() == Ok("1");
    let mut cases: Vec<_> = fs::read_dir(fixtures())
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.is_dir())
        .collect();
    cases.sort();
    assert!(!cases.is_empty());
    for case in cases {
        let name = case.file_name().unwrap().to_string_lossy().into_owned();
        let write_expected = update && name.starts_with("core-only-");
        let dir = TempDir::new();
        if let Ok(entries) = fs::read_dir(case.join("input")) {
            for entry in entries {
                let entry = entry.unwrap();
                fs::copy(entry.path(), dir.file(&entry.file_name().to_string_lossy())).unwrap();
            }
        }
        let stores = Stores::load(&dir.0, machine(), Arc::new(|_| {}));
        let models: Map<String, Value> = StoreName::ALL
            .iter()
            .map(|store| (store.config_name().to_string(), stores.model(*store)))
            .collect();
        let models_text = format!(
            "{}\n",
            without_random_ids(&serde_json::to_string_pretty(&Value::Object(models)).unwrap())
        );
        if write_expected {
            fs::create_dir_all(case.join("expected")).unwrap();
            fs::write(case.join("expected/models.json"), &models_text).unwrap();
        }
        let models: Value = serde_json::from_str(&models_text).unwrap();
        let expected: Value =
            serde_json::from_str(&fs::read_to_string(case.join("expected/models.json")).unwrap())
                .unwrap();
        assert_eq!(models, expected, "models of {name}");

        if let Ok(text) = fs::read_to_string(case.join("change.json")) {
            let changes: Map<String, Value> = serde_json::from_str(&text).unwrap();
            for (config_name, model) in changes {
                let store = StoreName::ALL
                    .into_iter()
                    .find(|store| store.config_name() == config_name)
                    .unwrap();
                stores.update(store, model);
            }
        }
        for config_name in STORES {
            let written = fs::read_to_string(store_path(&dir.0, config_name))
                .ok()
                .map(|text| without_random_ids(&text));
            let expected_path = case.join(format!("expected/{config_name}.json"));
            if write_expected && let Some(text) = &written {
                fs::write(&expected_path, text).unwrap();
            }
            let expected = fs::read_to_string(expected_path).ok();
            assert_eq!(written, expected, "{config_name} of {name}");
        }
        let expected_copies: Map<String, Value> = fs::read_dir(case.join("expected/corrupt"))
            .map(|entries| {
                entries
                    .map(|entry| {
                        let path = entry.unwrap().path();
                        let store = path.file_stem().unwrap().to_string_lossy().into_owned();
                        (store, Value::String(fs::read_to_string(&path).unwrap()))
                    })
                    .collect()
            })
            .unwrap_or_default();
        assert_eq!(
            corrupt_copies(&dir.0),
            expected_copies,
            "corrupt copies of {name}"
        );
    }
}

// User Story 2: a broken or newer file does not cost the user's setup.

fn logged(lines: &Arc<Mutex<Vec<String>>>, part: &str) -> bool {
    lines.lock().unwrap().iter().any(|line| line.contains(part))
}

fn recording() -> (Log, Arc<Mutex<Vec<String>>>) {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    (
        Arc::new(move |line| sink.lock().unwrap().push(line.to_string())),
        lines,
    )
}

#[test]
fn a_file_that_is_not_json_is_copied_aside_and_reset() {
    let dir = TempDir::new();
    let path = store_path(&dir.0, "lens-hotbar-store");
    fs::write(&path, "{\n  \"hotbars\": [\n").unwrap();
    let (log, lines) = recording();
    let stores = Stores::load(&dir.0, machine(), log);
    let copies = corrupt_copies(&dir.0);
    assert_eq!(copies.len(), 1);
    assert_eq!(copies["lens-hotbar-store"], "{\n  \"hotbars\": [\n");
    assert_eq!(fs::read_to_string(&path).unwrap(), VERSION_BLOCK);
    assert_eq!(
        stores.model(StoreName::Hotbar)["hotbars"][0]["name"],
        "Default"
    );
    assert!(
        logged(&lines, "is not valid JSON, copied it to"),
        "{:?}",
        lines.lock().unwrap()
    );
    // The other stores load as usual.
    assert_eq!(
        fs::read_to_string(store_path(&dir.0, "lens-user-store")).unwrap(),
        VERSION_BLOCK
    );
    assert!(stores.update(
        StoreName::Hotbar,
        json!({"hotbars": [{"id": "h", "name": "H"}]})
    ));
    assert!(fs::read_to_string(&path).unwrap().contains("\"H\""));
}

#[test]
fn a_file_that_cannot_be_copied_aside_is_kept_and_not_written() {
    let dir = TempDir::new();
    let path = store_path(&dir.0, "lens-hotbar-store");
    fs::write(&path, "{").unwrap();
    set_mode(&dir.0, 0o555).unwrap();
    let (log, lines) = recording();
    let stores = Stores::load(&dir.0, machine(), log);
    set_mode(&dir.0, 0o755).unwrap();
    assert!(corrupt_copies(&dir.0).is_empty());
    assert_eq!(fs::read_to_string(&path).unwrap(), "{");
    assert!(logged(&lines, "cannot copy"), "{:?}", lines.lock().unwrap());
    assert!(stores.update(
        StoreName::Hotbar,
        json!({"hotbars": [{"id": "h", "name": "H"}]})
    ));
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        "{",
        "the store is not written"
    );
}

#[test]
fn an_unreadable_file_is_kept_and_not_written() {
    let dir = TempDir::new();
    let path = store_path(&dir.0, "lens-weblink-store");
    fs::write(&path, r#"{"weblinks": [{"id": "w"}]}"#).unwrap();
    set_mode(&path, 0o000).unwrap();
    let (log, lines) = recording();
    let stores = Stores::load(&dir.0, machine(), log);
    assert!(logged(&lines, "cannot read"), "{:?}", lines.lock().unwrap());
    assert_eq!(stores.model(StoreName::Weblink), json!({"weblinks": []}));
    assert!(stores.update(StoreName::Weblink, json!({"weblinks": [{"id": "x"}]})));
    set_mode(&path, 0o644).unwrap();
    assert_eq!(
        fs::read_to_string(&path).unwrap(),
        r#"{"weblinks": [{"id": "w"}]}"#
    );
    assert!(corrupt_copies(&dir.0).is_empty());
}

#[test]
fn a_file_only_javascript_reads_is_kept_and_not_written() {
    let dir = TempDir::new();
    let path = store_path(&dir.0, "lens-weblink-store");
    let text = r#"{"weblinks": [{"id": "w", "name": "\ud800"}]}"#;
    fs::write(&path, text).unwrap();
    let (log, lines) = recording();
    let stores = Stores::load(&dir.0, machine(), log);
    assert!(logged(&lines, "cannot read"), "{:?}", lines.lock().unwrap());
    assert!(stores.update(StoreName::Weblink, json!({"weblinks": [{"id": "x"}]})));
    assert_eq!(fs::read_to_string(&path).unwrap(), text);
    assert!(corrupt_copies(&dir.0).is_empty());
}

#[tokio::test]
async fn an_unwritable_store_answers_its_model_and_sends_changes() {
    let dir = TempDir::new();
    let path = store_path(&dir.0, "lens-weblink-store");
    fs::write(&path, "{\"weblinks\": [], \"x\": \"\\ud800\"}").unwrap();
    let core = core_on(&dir.0);
    poll(&core, MAIN, "main", 0).await;
    let model = json!({"weblinks": [{"id": "sent"}]});
    send(
        &core,
        MAIN,
        &format!("store-sync-main:{}", path.display()),
        model.clone(),
    )
    .await;
    let messages = poll(&core, MAIN, "main", 0).await;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["payload"], model);
    let answer = post(
        &core,
        MAIN,
        "/ipc/request",
        json!({"channel": "persistent-storage-initial-values"}),
    )
    .await;
    assert_eq!(answer["payload"][4]["model"], model);
    assert!(fs::read_to_string(&path).unwrap().contains("\\ud800"));
}

#[tokio::test]
async fn a_failed_write_is_logged_and_the_model_still_sent() {
    let dir = TempDir::new();
    let core = core_on(&dir.0);
    let path = store_path(&dir.0, "lens-weblink-store");
    poll(&core, MAIN, "main", 0).await;
    set_mode(&dir.0, 0o555).unwrap();
    let model = json!({"weblinks": [{"id": "after"}]});
    send(
        &core,
        MAIN,
        &format!("store-sync-main:{}", path.display()),
        model.clone(),
    )
    .await;
    set_mode(&dir.0, 0o755).unwrap();
    let messages = poll(&core, MAIN, "main", 0).await;
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["payload"], model);
    assert!(
        logged(
            &core.lines,
            &format!("error: Stores: cannot write {}", path.display())
        ),
        "{:?}",
        core.lines.lock().unwrap()
    );
    assert!(temporary_files(&dir.0).is_empty());
    assert_eq!(fs::read_to_string(&path).unwrap(), VERSION_BLOCK);
}

/// FR-006: a process killed while it writes leaves a file whole, old or new.
#[test]
fn a_write_killed_part_way_leaves_a_whole_file() {
    let dir = TempDir::new();
    let path = store_path(&dir.0, "lens-weblink-store");
    let small = json!({"weblinks": [{"id": "small"}]});
    let large = json!({"weblinks": (0..2000).map(|index| json!({"id": format!("w{index}"), "url": "https://example.test/".repeat(4)})).collect::<Vec<_>>()});
    let mut file = StoreFile::read(&path).unwrap();
    file.merge(&["weblinks"], small.as_object().unwrap());
    file.write().unwrap();
    for round in 0..20u64 {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "writer_for_the_kill_test",
                "--ignored",
                "--nocapture",
            ])
            .env("FREELENS_STORES_WRITER", &path)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        std::thread::sleep(std::time::Duration::from_millis(30 + round * 17));
        child.kill().unwrap();
        child.wait().unwrap();
        let text = fs::read_to_string(&path).unwrap();
        let value: Value =
            serde_json::from_str(&text).unwrap_or_else(|error| panic!("round {round}: {error}"));
        assert!(
            value["weblinks"] == small["weblinks"] || value["weblinks"] == large["weblinks"],
            "round {round}"
        );
    }
}

/// The child of `a_write_killed_part_way_leaves_a_whole_file`: writes the two
/// models in turn until it is killed. Does nothing when run on its own.
#[test]
#[ignore = "run by a_write_killed_part_way_leaves_a_whole_file"]
fn writer_for_the_kill_test() {
    let Ok(path) = std::env::var("FREELENS_STORES_WRITER") else {
        return;
    };
    let small = json!({"weblinks": [{"id": "small"}]});
    let large = json!({"weblinks": (0..2000).map(|index| json!({"id": format!("w{index}"), "url": "https://example.test/".repeat(4)})).collect::<Vec<_>>()});
    let mut file = StoreFile::read(Path::new(&path)).unwrap();
    loop {
        for model in [&large, &small] {
            file.merge(&["weblinks"], model.as_object().unwrap());
            file.write().unwrap();
        }
    }
}
