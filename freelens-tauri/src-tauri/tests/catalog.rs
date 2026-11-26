/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The catalog over the `/ipc/` routes and on real files
//! (`specs/008-main-catalog/contracts/catalog-channels.md`,
//! `contracts/synced-files.md`), and the fixtures shared with the Electron
//! build's own code (research R13).

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use freelens_tauri::catalog::syncs::cluster_id;
use freelens_tauri::catalog::{Catalog, CatalogLog, kubeconfig};
use freelens_tauri::foundation::paths::BuildKind;
use freelens_tauri::messaging::{Log, MessageChannel, Messaging, View, routes};
use freelens_tauri::stores::{Machine, StoreName, Stores};
use freelens_tauri::{Checks, register_core};
use http::{Method, Request, header};
use serde_json::{Map, Value, json};

const MAIN: &str = "freelens-app://renderer.freelens.app";

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "freelens-catalog-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path.canonicalize().unwrap())
    }

    fn root(&self) -> String {
        self.0.display().to_string()
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn machine() -> Machine {
    Machine {
        kube_dir: "/no/such/home/.kube".into(),
        timezone: "UTC".into(),
        build: BuildKind::Release,
    }
}

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/catalog")
}

/// Writes a user store whose kubeconfig syncs are `syncs`.
fn write_syncs(data_dir: &Path, syncs: &[String]) {
    fs::create_dir_all(data_dir).unwrap();
    let entries: Vec<Value> = syncs
        .iter()
        .map(|path| json!({ "filePath": path }))
        .collect();
    fs::write(
        data_dir.join("lens-user-store.json"),
        json!({ "preferences": { "syncKubeconfigEntries": entries } }).to_string(),
    )
    .unwrap();
}

struct Core {
    catalog: Catalog,
    messaging: Messaging,
    stores: Stores,
    lines: Arc<Mutex<Vec<String>>>,
}

/// A core whose catalog syncs the user store of `data_dir`, with the home
/// directory of the `file` label at `home`.
async fn core_on(data_dir: &Path, home: &str) -> Core {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    let stores = Stores::load(data_dir, machine(), Arc::clone(&log));
    let catalog = Catalog::new_with_home(
        &stores,
        data_dir,
        None,
        CatalogLog::new(Arc::clone(&log), true),
        Some(home.to_string()),
    );
    let core = register_core(Checks::default(), "0.1.0".into(), &catalog, &stores, &log).unwrap();
    catalog.start();
    tokio::time::timeout(Duration::from_secs(10), catalog.scanned())
        .await
        .expect("the first scan ends");
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
        json!({ "messages": [{ "channel": channel, "payload": payload }] }),
    )
    .await;
}

async fn request(core: &Core, host: &str, channel: &str, payload: Value) -> Value {
    post(
        core,
        host,
        "/ipc/request",
        json!({ "channel": channel, "payload": payload }),
    )
    .await
}

async fn poll(core: &Core, host: &str, session: &str) -> Vec<Value> {
    poll_after(core, host, session, 0).await
}

async fn poll_after(core: &Core, host: &str, session: &str, after: u64) -> Vec<Value> {
    post(
        core,
        host,
        "/ipc/poll",
        json!({ "session": session, "after": after }),
    )
    .await["messages"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn last_seq(messages: &[Value]) -> u64 {
    messages
        .iter()
        .filter_map(|message| message["seq"].as_u64())
        .max()
        .unwrap_or(0)
}

/// The payloads of the `catalog:items` messages among `messages`.
fn catalogs(messages: &[Value]) -> Vec<Vec<Value>> {
    messages
        .iter()
        .filter(|message| message["channel"] == "catalog:items")
        .map(|message| message["payload"].as_array().cloned().unwrap_or_default())
        .collect()
}

fn clusters_of(entities: &[Value]) -> Vec<String> {
    entities
        .iter()
        .filter(|entity| entity["kind"] == "KubernetesCluster")
        .map(|entity| entity["metadata"]["name"].as_str().unwrap().to_string())
        .collect()
}

const KUBECONFIG: &str = "apiVersion: v1\nkind: Config\nclusters:\n- name: cluster-a\n  cluster:\n    server: https://cluster-a.example.invalid:6443\nusers:\n- name: user-a\n  user:\n    token: placeholder-token-a1\ncontexts:\n- name: context-a\n  context:\n    cluster: cluster-a\n    user: user-a\n- name: context-b\n  context:\n    cluster: cluster-a\n    user: user-a\n";

#[tokio::test]
async fn catalog_init_gives_every_open_view_the_whole_catalog() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, KUBECONFIG).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let cluster = format!(
        "freelens-app://{}.renderer.freelens.app",
        core.catalog.cluster_ids()[0]
    );
    poll(&core, MAIN, "main").await;
    poll(&core, &cluster, "frame").await;

    send(&core, MAIN, "catalog:init", Value::Null).await;
    tokio::time::sleep(Duration::from_millis(20)).await;

    for (host, session) in [(MAIN, "main"), (cluster.as_str(), "frame")] {
        let received = catalogs(&poll(&core, host, session).await);
        let last = received.last().expect("a catalog");
        assert_eq!(last.len(), 4 + 2);
        assert_eq!(clusters_of(last), ["context-a", "context-b"]);
    }
    assert!(
        core.lines
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == "Catalog: sent 6 entities")
    );
}

#[tokio::test]
async fn cluster_visibility_marks_a_cluster_active_and_an_unknown_id_waits() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, "apiVersion: v1\nkind: Config\n").unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let later = cluster_id(&file, "context-a");
    send(&core, MAIN, "cluster-visibility", json!(later)).await;

    fs::write(&file, KUBECONFIG).unwrap();
    let file_path = PathBuf::from(&file);
    core.catalog.set_clusters(
        vec![freelens_tauri::catalog::ClusterSource {
            id: later.clone(),
            context_name: "context-a".into(),
            kubeconfig_path: file_path,
        }],
        &Default::default(),
    );
    let active: Vec<bool> = core
        .catalog
        .entities()
        .iter()
        .filter(|entity| entity["kind"] == "KubernetesCluster")
        .map(|entity| entity["status"]["active"].as_bool().unwrap())
        .collect();
    assert_eq!(active, [true]);

    send(&core, MAIN, "cluster-visibility", Value::Null).await;
    assert!(
        core.catalog
            .entities()
            .iter()
            .all(|entity| entity["status"]["active"] != true
                || entity["kind"] != "KubernetesCluster")
    );
}

#[tokio::test]
async fn a_cluster_frame_that_records_its_id_gets_the_catalog() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, KUBECONFIG).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let id = core.catalog.cluster_ids()[0].clone();
    let cluster = format!("freelens-app://{id}.renderer.freelens.app");
    poll(&core, &cluster, "frame").await;
    // The catalog of the first scan has gone out already.
    tokio::time::sleep(Duration::from_millis(250)).await;
    let seen = last_seq(&poll(&core, &cluster, "frame").await);

    request(&core, &cluster, "cluster:set-frame-id", json!(id)).await;
    tokio::time::sleep(Duration::from_millis(20)).await;

    let received = catalogs(&poll_after(&core, &cluster, "frame", seen).await);
    assert_eq!(received.len(), 1);
    assert_eq!(clusters_of(&received[0]), ["context-a", "context-b"]);
}

#[tokio::test]
async fn catalog_dump_appends_each_catalog_sent() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, KUBECONFIG).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let dump = dir.0.join("dump.json");
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    core.catalog.dump_to(dump.clone());
    send(&core, MAIN, "catalog:init", Value::Null).await;
    tokio::time::sleep(Duration::from_millis(250)).await;
    let text = String::from_utf8(fs::read(&dump).unwrap()).unwrap();
    let last: Vec<Value> = serde_json::from_str(text.lines().last().unwrap()).unwrap();
    assert_eq!(last, core.catalog.entities());
    assert!(!text.contains("placeholder-token-a1"));
    assert!(!text.contains("cluster-a.example.invalid"));
}

/// A filler message, to close a queue by more messages than it holds.
const FILLER: MessageChannel<()> = MessageChannel::new("filler");

#[tokio::test]
async fn a_view_whose_queue_closed_gets_the_catalog_again_when_it_polls_again() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, KUBECONFIG).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let (opened, ()) = tokio::join!(poll(&core, MAIN, "main"), async {
        tokio::time::sleep(Duration::from_millis(20)).await;
        send(&core, MAIN, "catalog:init", Value::Null).await;
    });
    assert_eq!(catalogs(&opened).len(), 1);
    let handled = last_seq(&opened);

    // The page stops polling, as a suspended one, and its queue closes; the
    // catalog that changes meanwhile is lost with it.
    let sender = core.messaging.sender();
    for _ in 0..=10_000 {
        sender.send_to(&View::Main, FILLER, &());
    }
    fs::write(&file, kubeconfig_with(&["context-a"])).unwrap();
    wait_for_clusters(&core, &["context-a"]).await;
    tokio::time::sleep(Duration::from_millis(250)).await;

    let again = poll_after(&core, MAIN, "main", handled).await;
    let received = catalogs(&again);
    assert_eq!(received.len(), 1, "only the catalog sent again");
    assert_eq!(clusters_of(&received[0]), ["context-a"]);
    assert!(
        core.lines
            .lock()
            .unwrap()
            .iter()
            .filter(|line| *line == "Catalog: sent 5 entities to main")
            .count()
            == 1
    );
}

/// The ids of the inputs of a fixture name a file relative to the case's
/// root, as `<id:work/dev.yaml:context-a>`, because the root is a new
/// directory each run.
fn with_input_placeholders(text: &str, root: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(start) = rest.find("<id:") {
        out.push_str(&rest[..start]);
        let end = rest[start..].find('>').unwrap() + start;
        let inner = &rest[start + 4..end];
        let (file, context) = inner.split_once(':').unwrap();
        out.push_str(&cluster_id(&format!("{root}/{file}"), context));
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    out.replace("<root>", root)
}

/// Every id that is the MD5 of a kubeconfig path and a context becomes
/// `<id>`, then the root `<root>`, as the Vitest test writes them.
fn with_output_placeholders(value: &Value, root: &str) -> Value {
    fn replace(node: &Value) -> Value {
        match node {
            Value::Array(items) => Value::Array(items.iter().map(replace).collect()),
            Value::Object(fields) => {
                let mut copy: Map<String, Value> = fields
                    .iter()
                    .map(|(key, value)| (key.clone(), replace(value)))
                    .collect();
                let text = |value: Option<&Value>| {
                    value
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .to_string()
                };
                if fields.get("kind") == Some(&json!("KubernetesCluster")) {
                    let spec = &fields["spec"];
                    let id = cluster_id(
                        &text(spec.get("kubeconfigPath")),
                        &text(spec.get("kubeconfigContext")),
                    );
                    if fields["metadata"]["uid"] == json!(id) {
                        copy["metadata"]["uid"] = json!("<id>");
                    }
                }
                if let Some(Value::String(id)) = fields.get("id")
                    && *id
                        == cluster_id(
                            &text(fields.get("kubeConfigPath")),
                            &text(fields.get("contextName")),
                        )
                {
                    copy.insert("id".into(), json!("<id>"));
                }
                Value::Object(copy)
            }
            other => other.clone(),
        }
    }
    let text = replace(value).to_string().replace(root, "<root>");
    serde_json::from_str(&text).unwrap()
}

fn copy_into(from: &Path, to: &Path, root: &str) {
    let Ok(entries) = fs::read_dir(from) else {
        return;
    };
    for entry in entries.flatten() {
        let target = to.join(entry.file_name());
        if entry.file_type().unwrap().is_dir() {
            fs::create_dir_all(&target).unwrap();
            copy_into(&entry.path(), &target, root);
        } else {
            let bytes = fs::read(entry.path()).unwrap();
            let is_store = from.file_name().is_some_and(|name| name == "data")
                && entry.file_name().to_string_lossy().ends_with(".json");
            if is_store {
                let text = with_input_placeholders(&String::from_utf8(bytes).unwrap(), root);
                fs::write(&target, text).unwrap();
            } else {
                fs::write(&target, bytes).unwrap();
            }
        }
    }
}

/// A YAML parse error's reason is the core's own (research R3): only the
/// prefix and the line are compared.
fn parse_matches(core: &Value, expected: &Value) -> bool {
    let prefix = "Error: invalid YAML: ";
    match (core["error"].as_str(), expected["error"].as_str()) {
        (Some(core_error), Some(expected_error)) if expected_error.starts_with(prefix) => {
            core_error.starts_with(prefix)
                && core_error.contains(" at line ")
                && core["contexts"] == expected["contexts"]
        }
        _ => core == expected,
    }
}

fn sorted(entries: &Value) -> Vec<Value> {
    let mut entries = entries.as_array().cloned().unwrap_or_default();
    entries.sort_by_key(|entry| entry.to_string());
    entries
}

#[tokio::test]
async fn every_fixture_gives_what_the_electron_build_gives() {
    let update = std::env::var("UPDATE_TAURI_PARITY").as_deref() == Ok("1");
    let mut cases: Vec<PathBuf> = fs::read_dir(fixtures())
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect();
    cases.sort();
    assert!(!cases.is_empty());
    for case in cases {
        let name = case.file_name().unwrap().to_string_lossy().to_string();
        let core_only = name.starts_with("core-only-");
        let definition: Value =
            serde_json::from_slice(&fs::read(case.join("case.json")).unwrap()).unwrap();
        let dir = TempDir::new();
        let root = dir.root();
        copy_into(&case.join("input"), &dir.0, &root);
        for generated in definition["generate"].as_array().into_iter().flatten() {
            let mut bytes = fs::read(case.join(generated["from"].as_str().unwrap())).unwrap();
            bytes.resize(generated["size"].as_u64().unwrap() as usize, b'\n');
            let target = dir.0.join(generated["path"].as_str().unwrap());
            fs::create_dir_all(target.parent().unwrap()).unwrap();
            fs::write(target, bytes).unwrap();
        }
        let channels = definition.get("channels");
        for (link, target) in channels
            .and_then(|channels| channels["links"].as_object())
            .into_iter()
            .flatten()
        {
            std::os::unix::fs::symlink(target.as_str().unwrap(), dir.0.join(link)).unwrap();
        }
        let data_dir = dir.0.join("data");
        let syncs: Vec<String> = definition["syncs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|sync| format!("{root}/{}", sync["path"].as_str().unwrap()))
            .collect();
        // The user store of the case names its syncs; the stores it brings
        // stay as they are.
        write_syncs(&data_dir, &syncs);
        let core = core_on(&data_dir, &root).await;

        // No log line carries the text of a file, and each sync is logged as
        // started (FR-014, FR-022, research R11).
        let lines = core.lines.lock().unwrap().clone();
        for line in &lines {
            assert!(!line.contains("example.invalid"), "{name}: {line}");
            for credential in CREDENTIALS {
                assert!(!line.contains(credential), "{name}: {line}");
            }
        }
        for sync in &syncs {
            let started = format!("Catalog: starting sync of file/folder {sync}");
            assert!(lines.contains(&started), "{name}: no line {started}");
        }

        let entities = with_output_placeholders(&Value::Array(core.catalog.entities()), &root);
        let store =
            with_output_placeholders(&core.stores.model(StoreName::Cluster)["clusters"], &root);
        let mut outputs = vec![
            ("entities.json".to_string(), entities),
            ("lens-cluster-store.json".to_string(), store),
        ];
        let texts = case.join("texts");
        if let Ok(entries) = fs::read_dir(&texts) {
            for entry in entries.flatten() {
                let text = String::from_utf8(fs::read(entry.path()).unwrap()).unwrap();
                outputs.push((
                    format!("parse/{}.json", entry.file_name().to_string_lossy()),
                    kubeconfig::check_text(&text),
                ));
            }
        }
        if let Some(channels) = channels {
            outputs.extend(channel_outputs(&core, channels, &root, &texts).await);
        }
        // No answer carries a credential of the files (SC-008).
        for (file, value) in &outputs {
            let text = value.to_string();
            for credential in CREDENTIALS {
                assert!(!text.contains(credential), "{name}/{file}: {credential}");
            }
        }
        let expected = case.join("expected");
        if update && core_only {
            for (file, value) in &outputs {
                let target = expected.join(file);
                fs::create_dir_all(target.parent().unwrap()).unwrap();
                fs::write(target, serde_json::to_string_pretty(value).unwrap() + "\n").unwrap();
            }
            continue;
        }
        for (file, value) in outputs {
            let wanted: Value =
                serde_json::from_slice(&fs::read(expected.join(&file)).unwrap_or_else(|_| {
                    panic!("{name}: no expected/{file}; run the Vitest parity test to write it")
                }))
                .unwrap();
            if file.starts_with("parse/") {
                assert!(
                    parse_matches(&value, &wanted),
                    "{name}/{file}:\n{value:#}\n!=\n{wanted:#}"
                );
            } else if file == "lens-cluster-store.json" {
                // The Electron build adds the entries in the order its reads
                // of the files end, which the core does not reproduce.
                assert_eq!(sorted(&value), sorted(&wanted), "{name}/{file}");
            } else {
                assert_eq!(value, wanted, "{name}/{file}");
            }
        }
    }
}

/// The credentials of the fixtures, as written and, for the `*-data` fields,
/// base64-encoded: every placeholder starts with `placeholder-`, whose base64
/// is `cGxhY2Vob2xkZXIt`.
const CREDENTIALS: [&str; 4] = [
    "placeholder-token",
    "placeholder-client",
    "placeholder-authority",
    "cGxhY2Vob2xkZXIt",
];

/// The answers of the channels other than `catalog:items` that a case's
/// `channels` asks for, in the order the Vitest test asks them.
async fn channel_outputs(
    core: &Core,
    channels: &Value,
    root: &str,
    texts: &Path,
) -> Vec<(String, Value)> {
    let id = |value: &Value| match value.as_str() {
        Some(text) => json!(with_input_placeholders(text, root)),
        None => Value::Null,
    };
    let mut active = Vec::new();
    for visible in channels["visible"].as_array().unwrap() {
        send(core, MAIN, "cluster-visibility", id(visible)).await;
        let names: Vec<Value> = core
            .catalog
            .entities()
            .into_iter()
            .filter(|entity| {
                entity["kind"] == "KubernetesCluster" && entity["status"]["active"] == true
            })
            .map(|entity| entity["metadata"]["name"].clone())
            .collect();
        active.push(Value::Array(names));
    }
    let mut kinds = Map::new();
    for file in channels["discover"].as_array().unwrap() {
        let file = file.as_str().unwrap();
        let path = json!(format!("{root}/{file}"));
        let answer = request(core, MAIN, "discover-kubeconfig-sync-kind", path).await;
        kinds.insert(file.to_string(), answer["payload"].clone());
    }
    let all = request(core, MAIN, "get-all-clusters", Value::Null).await["payload"].clone();
    let mut by_id = Vec::new();
    for value in channels["byId"].as_array().unwrap() {
        let answer = request(core, MAIN, "get-cluster-by-id", id(value)).await;
        // An unknown id is answered with no value, written `null`.
        by_id.push(answer.get("payload").cloned().unwrap_or(Value::Null));
    }
    let mut outputs: Vec<(String, Value)> = [
        ("channels/get-all-clusters.json", all),
        ("channels/get-cluster-by-id.json", Value::Array(by_id)),
        (
            "channels/discover-kubeconfig-sync-kind.json",
            Value::Object(kinds),
        ),
        ("channels/active.json", Value::Array(active)),
    ]
    .into_iter()
    .map(|(file, value)| (file.to_string(), with_output_placeholders(&value, root)))
    .collect();
    if let Ok(entries) = fs::read_dir(texts) {
        for entry in entries.flatten() {
            let text = fs::read_to_string(entry.path()).unwrap();
            let answer = request(core, MAIN, "add-kubeconfig-text", json!(text)).await;
            outputs.push((
                format!(
                    "channels/add-kubeconfig-text/{}.json",
                    entry.file_name().to_string_lossy()
                ),
                answer["payload"].clone(),
            ));
        }
    }
    outputs
}

/// Waits until the catalog's clusters are `names`, for at most 3 seconds;
/// gives what they were last.
async fn wait_for_clusters(core: &Core, names: &[&str]) -> Vec<String> {
    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    loop {
        let now = clusters_of(&core.catalog.entities());
        if now == names || tokio::time::Instant::now() >= deadline {
            return now;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

fn kubeconfig_with(contexts: &[&str]) -> String {
    let mut text = String::from(
        "apiVersion: v1\nkind: Config\nclusters:\n- name: cluster-a\n  cluster:\n    server: https://cluster-a.example.invalid:6443\nusers:\n- name: user-a\n  user:\n    token: placeholder-token-a1\ncontexts:\n",
    );
    for context in contexts {
        text.push_str(&format!(
            "- name: {context}\n  context:\n    cluster: cluster-a\n    user: user-a\n"
        ));
    }
    text
}

/// Every cluster list the catalog had, recorded on each change.
fn recording(core: &Core) -> Arc<Mutex<Vec<Vec<String>>>> {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let reading = core.catalog.clone();
    core.catalog
        .on_change(move || sink.lock().unwrap().push(clusters_of(&reading.entities())));
    seen
}

#[tokio::test]
async fn a_context_added_changed_and_removed_reaches_the_catalog() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, kubeconfig_with(&["context-a"])).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    assert_eq!(
        wait_for_clusters(&core, &["context-a"]).await,
        ["context-a"]
    );

    fs::write(&file, kubeconfig_with(&["context-a", "context-b"])).unwrap();
    assert_eq!(
        wait_for_clusters(&core, &["context-a", "context-b"]).await,
        ["context-a", "context-b"]
    );
    let id = core.catalog.cluster_ids()[0].clone();

    // A change of a context's content keeps its cluster and id.
    let changed = kubeconfig_with(&["context-a", "context-b"])
        .replace("cluster-a.example", "cluster-z.example");
    fs::write(&file, changed).unwrap();
    tokio::time::sleep(Duration::from_millis(900)).await;
    assert_eq!(core.catalog.cluster_ids()[0], id);

    fs::write(&file, kubeconfig_with(&["context-b"])).unwrap();
    assert_eq!(
        wait_for_clusters(&core, &["context-b"]).await,
        ["context-b"]
    );
}

#[tokio::test]
async fn a_file_added_to_and_removed_from_a_folder_reaches_the_catalog() {
    let dir = TempDir::new();
    let folder = format!("{}/work/folder", dir.root());
    fs::create_dir_all(&folder).unwrap();
    fs::write(format!("{folder}/a"), kubeconfig_with(&["folder-a"])).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&folder));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;

    fs::write(format!("{folder}/b"), kubeconfig_with(&["folder-b"])).unwrap();
    assert_eq!(
        wait_for_clusters(&core, &["folder-a", "folder-b"]).await,
        ["folder-a", "folder-b"]
    );
    fs::write(format!("{folder}/b.swp"), kubeconfig_with(&["ignored"])).unwrap();
    fs::remove_file(format!("{folder}/a")).unwrap();
    assert_eq!(wait_for_clusters(&core, &["folder-b"]).await, ["folder-b"]);
}

#[tokio::test]
async fn a_rewrite_in_place_or_by_a_rename_never_drops_a_context_it_keeps() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    let text = kubeconfig_with(&["context-a", "context-b"]);
    fs::write(&file, &text).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let seen = recording(&core);
    for rewrite in 0..10 {
        let content = format!("{text}# rewrite {rewrite}\n");
        if rewrite % 2 == 0 {
            fs::write(&file, &content[..content.len() / 2]).unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
            fs::write(&file, &content).unwrap();
        } else {
            let temporary = format!("{file}.tmp-{rewrite}");
            fs::write(&temporary, &content).unwrap();
            fs::rename(&temporary, &file).unwrap();
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
    }
    tokio::time::sleep(Duration::from_millis(900)).await;
    for clusters in seen.lock().unwrap().iter() {
        assert_eq!(clusters, &["context-a", "context-b"]);
    }
    assert_eq!(
        clusters_of(&core.catalog.entities()),
        ["context-a", "context-b"]
    );
}

#[tokio::test]
async fn a_change_of_a_link_s_target_reaches_the_catalog() {
    let dir = TempDir::new();
    let folder = format!("{}/work/folder", dir.root());
    fs::create_dir_all(&folder).unwrap();
    let target = format!("{}/work/outside.yaml", dir.root());
    fs::write(&target, kubeconfig_with(&["linked-a"])).unwrap();
    std::os::unix::fs::symlink(&target, format!("{folder}/link")).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&folder));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    assert_eq!(clusters_of(&core.catalog.entities()), ["linked-a"]);

    fs::write(&target, kubeconfig_with(&["linked-a", "linked-b"])).unwrap();
    assert_eq!(
        wait_for_clusters(&core, &["linked-a", "linked-b"]).await,
        ["linked-a", "linked-b"]
    );
}

#[tokio::test]
async fn a_sync_added_and_removed_in_the_setting_starts_and_stops() {
    let dir = TempDir::new();
    let data = dir.0.join("data");
    let first = format!("{}/work/first.yaml", dir.root());
    let second = format!("{}/work/second.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::create_dir_all(data.join("kubeconfigs")).unwrap();
    fs::write(&first, kubeconfig_with(&["first"])).unwrap();
    fs::write(&second, kubeconfig_with(&["second"])).unwrap();
    fs::write(
        data.join("kubeconfigs/pasted"),
        kubeconfig_with(&["pasted"]),
    )
    .unwrap();
    write_syncs(&data, std::slice::from_ref(&first));
    let core = core_on(&data, &dir.root()).await;
    assert_eq!(clusters_of(&core.catalog.entities()), ["pasted", "first"]);

    let set = |paths: &[&String]| {
        let mut model = core.stores.model(StoreName::User);
        model["preferences"]["syncKubeconfigEntries"] = Value::Array(
            paths
                .iter()
                .map(|path| json!({ "filePath": path }))
                .collect(),
        );
        core.stores.update(StoreName::User, model);
    };
    set(&[&first, &second]);
    assert_eq!(
        wait_for_clusters(&core, &["pasted", "first", "second"]).await,
        ["pasted", "first", "second"]
    );
    set(&[&second]);
    assert_eq!(
        wait_for_clusters(&core, &["pasted", "second"]).await,
        ["pasted", "second"]
    );
    // The application's directory stays synced whatever the setting says.
    set(&[]);
    assert_eq!(wait_for_clusters(&core, &["pasted"]).await, ["pasted"]);
    let lines = core.lines.lock().unwrap().clone();
    assert!(lines.contains(&format!("Catalog: starting sync of file/folder {second}")));
    assert!(lines.contains(&format!("Catalog: stopping sync of file/folder {first}")));
}

#[tokio::test]
async fn quitting_logs_each_sync_it_stops_as_the_electron_build_does() {
    let dir = TempDir::new();
    let data = dir.0.join("data");
    let file = format!("{}/work/config.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, kubeconfig_with(&["first"])).unwrap();
    write_syncs(&data, std::slice::from_ref(&file));
    let core = core_on(&data, &dir.root()).await;
    assert_eq!(clusters_of(&core.catalog.entities()), ["first"]);

    core.catalog.stop();
    let lines = core.lines.lock().unwrap().clone();
    let at = lines
        .iter()
        .position(|line| line == "Catalog: stopping requested syncs")
        .expect("the stop line");
    // `stopSync` of `manager.ts` stops the syncs in the order they started.
    let app_dir = format!("{}/kubeconfigs", data.display());
    let stopped: Vec<String> = lines[at + 1..]
        .iter()
        .filter(|line| line.starts_with("Catalog: stopping"))
        .cloned()
        .collect();
    assert_eq!(
        stopped,
        [
            format!("Catalog: stopping sync of file/folder {app_dir}"),
            format!("Catalog: stopping sync of file/folder {file}"),
        ]
    );
}

#[tokio::test]
async fn a_cluster_that_leaves_is_refused_from_then_on() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, kubeconfig_with(&["context-a", "context-b"])).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let gone = core.catalog.cluster_ids()[1].clone();
    let read = |id: &str| json!({ "clusterId": id });
    assert!(
        request(&core, MAIN, "lens-local-storage:read", read(&gone))
            .await
            .get("error")
            .is_none()
    );

    fs::write(&file, kubeconfig_with(&["context-a"])).unwrap();
    assert_eq!(
        wait_for_clusters(&core, &["context-a"]).await,
        ["context-a"]
    );
    let answer = request(&core, MAIN, "lens-local-storage:read", read(&gone)).await;
    assert!(
        answer["error"]["message"]
            .as_str()
            .unwrap()
            .contains("not registered")
    );
    send(&core, MAIN, "current-visible-cluster", json!(gone)).await;
    assert!(
        core.lines
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == "Frames: no visible cluster")
    );
}

#[tokio::test]
async fn the_enumeration_answers_the_clusters_and_follows_the_catalog() {
    let dir = TempDir::new();
    let file = format!("{}/work/dev.yaml", dir.root());
    fs::create_dir_all(dir.0.join("work")).unwrap();
    fs::write(&file, kubeconfig_with(&["context-a"])).unwrap();
    write_syncs(&dir.0.join("data"), std::slice::from_ref(&file));
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let id = core.catalog.cluster_ids()[0].clone();

    let all = request(&core, MAIN, "get-all-clusters", Value::Null).await;
    assert_eq!(
        all["payload"],
        json!([{
            "id": id,
            "name": "context-a",
            "kubeConfigPath": file,
            "contextName": "context-a",
            "status": "disconnected",
            "labels": { "file": "~/work/dev.yaml" },
            "isActive": false,
            "metadata": { "distribution": "unknown", "kubernetesVersion": "unknown" },
        }])
    );
    let one = request(&core, MAIN, "get-cluster-by-id", json!(id)).await;
    assert_eq!(one["payload"], all["payload"][0]);
    for unknown in [json!("no-such-id"), json!("")] {
        let none = request(&core, MAIN, "get-cluster-by-id", unknown).await;
        assert_eq!(none, json!({}), "no value, as undefined");
    }

    fs::write(&file, kubeconfig_with(&["context-a", "context-b"])).unwrap();
    wait_for_clusters(&core, &["context-a", "context-b"]).await;
    let all = request(&core, MAIN, "get-all-clusters", Value::Null).await;
    assert_eq!(all["payload"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn discover_kubeconfig_sync_kind_reads_only_the_kind() {
    let dir = TempDir::new();
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let file = dir.0.join("file.yaml");
    let folder = dir.0.join("folder");
    fs::write(&file, "x").unwrap();
    fs::create_dir(&folder).unwrap();
    std::os::unix::fs::symlink(&file, dir.0.join("file-link")).unwrap();
    std::os::unix::fs::symlink(&folder, dir.0.join("folder-link")).unwrap();
    let socket_path = dir.0.join("socket");
    let _socket = std::os::unix::net::UnixListener::bind(&socket_path).unwrap();
    let kind = |path: PathBuf| {
        let core = &core;
        async move {
            request(
                core,
                MAIN,
                "discover-kubeconfig-sync-kind",
                json!(path.display().to_string()),
            )
            .await["payload"]
                .clone()
        }
    };
    assert_eq!(kind(file).await, json!({ "kind": "file" }));
    assert_eq!(kind(folder).await, json!({ "kind": "dir" }));
    assert_eq!(
        kind(dir.0.join("file-link")).await,
        json!({ "kind": "file" })
    );
    assert_eq!(
        kind(dir.0.join("folder-link")).await,
        json!({ "kind": "dir" })
    );
    assert_eq!(
        kind(socket_path).await,
        json!({ "error": "unknown stat entry" })
    );
    let missing = dir.0.join("missing");
    assert_eq!(
        kind(missing.clone()).await,
        json!({ "error": format!("Error: ENOENT: no such file or directory, stat '{}'", missing.display()) })
    );
}

#[tokio::test]
async fn pasted_text_is_checked_and_added_without_a_credential_in_any_answer() {
    let dir = TempDir::new();
    let core = core_on(&dir.0.join("data"), &dir.root()).await;
    let text = format!(
        "\n{}- name: no-cluster\n  context:\n    cluster: nowhere\n    user: user-a\n\n",
        kubeconfig_with(&["pasted-a"])
    );
    let parsed = request(&core, MAIN, "parse-kubeconfig-text", json!(text)).await;
    assert_eq!(
        parsed["payload"],
        json!({ "contexts": [
            { "name": "pasted-a" },
            { "name": "no-cluster", "error": "Error: No valid cluster object provided in kubeconfig for context 'no-cluster'" },
        ]})
    );
    let added = request(&core, MAIN, "add-kubeconfig-text", json!(text)).await;
    assert_eq!(
        added["payload"],
        json!({ "added": ["pasted-a", "no-cluster"] })
    );
    for answer in [&parsed, &added] {
        let answer = answer.to_string();
        assert!(!answer.contains("placeholder-token-a1"));
        assert!(!answer.contains("cluster-a.example.invalid"));
    }
    let written: Vec<PathBuf> = fs::read_dir(dir.0.join("data/kubeconfigs"))
        .unwrap()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    assert_eq!(written.len(), 1);
    let name = written[0]
        .file_name()
        .unwrap()
        .to_string_lossy()
        .to_string();
    assert!(uuid::Uuid::parse_str(&name).is_ok_and(|id| id.get_version_num() == 4));
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(
        fs::metadata(&written[0]).unwrap().permissions().mode() & 0o777,
        0o600
    );
    assert_eq!(fs::read_to_string(&written[0]).unwrap(), text.trim());
    assert_eq!(wait_for_clusters(&core, &["pasted-a"]).await, ["pasted-a"]);
}
