/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The channels of main-foundation besides the stores, over the `/ipc/`
//! routes (`specs/007-main-foundation/contracts/foundation-channels.md`).

use std::fs;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use freelens_tauri::catalog::Catalog;
use freelens_tauri::foundation::download::Trust;
use freelens_tauri::foundation::paths::{BuildKind, Environment};
use freelens_tauri::foundation::{self, Setup};
use freelens_tauri::messaging::{Channels, Log, Messaging, routes};
use freelens_tauri::options::KubeconfigChoice;
use freelens_tauri::stores::{Machine, StoreName, Stores};
use http::{Method, Request, StatusCode, header};
use rustls::pki_types::{CertificateDer, PrivateKeyDer, PrivatePkcs8KeyDer};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio_rustls::TlsAcceptor;

const MAIN: &str = "freelens-app://renderer.freelens.app";

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!(
            "freelens-foundation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::SeqCst)
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        fn open_up(path: &Path) {
            let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o755));
            if let Ok(entries) = fs::read_dir(path) {
                for entry in entries.flatten() {
                    if entry.file_type().is_ok_and(|kind| kind.is_dir()) {
                        open_up(&entry.path());
                    }
                }
            }
        }
        open_up(&self.0);
        let _ = fs::remove_dir_all(&self.0);
    }
}

struct Core {
    catalog: Catalog,
    messaging: Messaging,
    stores: Stores,
    dir: TempDir,
}

impl Core {
    fn home(&self) -> PathBuf {
        self.dir.0.join("home")
    }

    fn data_dir(&self) -> PathBuf {
        self.dir.0.join("data")
    }
}

fn core_with(trust: Trust) -> Core {
    let dir = TempDir::new();
    let home = dir.0.join("home");
    let data_dir = dir.0.join("data");
    fs::create_dir_all(&home).unwrap();
    let log: Log = Arc::new(|_| {});
    let catalog = Catalog::load(
        &KubeconfigChoice::File(
            Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/three-contexts.yaml"),
        ),
        None,
    );
    let stores = Stores::load(
        &data_dir,
        Machine {
            kube_dir: home.join(".kube").to_string_lossy().into_owned(),
            timezone: "UTC".into(),
            build: BuildKind::Release,
        },
        Arc::clone(&log),
    );
    let env = Environment {
        home: home.clone(),
        integration_testing_dir: None,
        temp: std::env::temp_dir(),
        exe: PathBuf::from("/Applications/Freelens.app/Contents/MacOS/freelens-tauri"),
        build: BuildKind::Release,
        data_dir: data_dir.clone(),
        debug: None,
        snap: None,
        flatpak: None,
    };
    let mut channels = Channels::with_log(Arc::clone(&log));
    let clusters = catalog
        .entries
        .iter()
        .map(|entry| entry.id.clone())
        .collect();
    foundation::register(
        &mut channels,
        Setup {
            env,
            clusters,
            stores: stores.clone(),
            templates_interval: Duration::from_millis(50),
            trust,
            log,
        },
    )
    .unwrap();
    Core {
        catalog,
        messaging: channels.build(),
        stores,
        dir,
    }
}

fn core() -> Core {
    core_with(Trust::Roots(Vec::new()))
}

async fn post(core: &Core, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("{MAIN}{path}"))
        .header(header::ORIGIN, MAIN)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into_bytes())
        .unwrap();
    let response = routes::handle(request, &core.catalog, &core.messaging).await;
    let status = response.status();
    let body = if response.body().is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(response.body()).unwrap()
    };
    (status, body)
}

async fn request(core: &Core, channel: &str, payload: Value) -> Value {
    let (status, body) = post(
        core,
        "/ipc/request",
        json!({"channel": channel, "payload": payload}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{channel}: {body}");
    body["payload"].clone()
}

async fn refusal(core: &Core, channel: &str, payload: Value) -> String {
    let (status, body) = post(
        core,
        "/ipc/request",
        json!({"channel": channel, "payload": payload}),
    )
    .await;
    assert_eq!(
        status,
        StatusCode::INTERNAL_SERVER_ERROR,
        "{channel}: {body}"
    );
    body["error"]["message"].as_str().unwrap().to_string()
}

async fn poll(core: &Core, after: u64) -> Vec<Value> {
    post(
        core,
        "/ipc/poll",
        json!({"session": "main", "after": after}),
    )
    .await
    .1["messages"]
        .as_array()
        .cloned()
        .unwrap_or_default()
}

fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

// app-paths and machine-values

#[tokio::test]
async fn the_paths_and_the_machine_values_are_answered() {
    let core = core();
    let paths = request(&core, "app-paths", Value::Null).await;
    assert_eq!(paths.as_object().unwrap().len(), 17);
    assert_eq!(
        paths["userData"],
        core.data_dir().to_string_lossy().as_ref()
    );
    assert_eq!(paths["recent"], "");
    let values = request(&core, "machine-values", Value::Null).await;
    assert_eq!(values["platform"], "darwin");
    assert_eq!(
        values["homeDirectory"],
        core.home().to_string_lossy().as_ref()
    );
    assert_eq!(
        values["bundledHelmPath"],
        "/Applications/Freelens.app/Contents/Resources/arm64/helm"
    );
}

// Local storage

#[tokio::test]
async fn the_main_window_s_local_storage_is_app_json() {
    let core = core();
    assert_eq!(
        request(&core, "lens-local-storage:read", json!({})).await,
        json!({})
    );
    request(
        &core,
        "lens-local-storage:write",
        json!({"state": {"a": [1, {"b": true}]}}),
    )
    .await;
    let directory = core.data_dir().join("lens-local-storage");
    let file = directory.join("app.json");
    assert_eq!(
        fs::read_to_string(&file).unwrap(),
        "{\n  \"a\": [\n    1,\n    {\n      \"b\": true\n    }\n  ]\n}\n"
    );
    assert_eq!(mode(&file), 0o600);
    assert_eq!(mode(&directory), 0o700);
    assert_eq!(
        request(&core, "lens-local-storage:read", json!({})).await,
        json!({"a": [1, {"b": true}]})
    );
}

#[tokio::test]
async fn a_cluster_s_local_storage_is_its_own_file() {
    let core = core();
    let id = core.catalog.entries[0].id.clone();
    request(
        &core,
        "lens-local-storage:write",
        json!({"clusterId": id, "state": {"x": 1}}),
    )
    .await;
    assert!(
        core.data_dir()
            .join(format!("lens-local-storage/{id}.json"))
            .exists()
    );
    assert_eq!(
        request(&core, "lens-local-storage:read", json!({"clusterId": id})).await,
        json!({"x": 1})
    );
    assert_eq!(
        request(&core, "lens-local-storage:read", json!({})).await,
        json!({})
    );
}

#[tokio::test]
async fn a_file_that_is_not_an_object_reads_as_empty_and_a_list_as_it_is() {
    let core = core();
    let directory = core.data_dir().join("lens-local-storage");
    fs::create_dir_all(&directory).unwrap();
    let file = directory.join("app.json");
    for (text, expected) in [
        ("{", json!({})),
        ("5", json!({})),
        ("null", json!({})),
        ("[1, 2]", json!([1, 2])),
        ("\u{feff}{\"a\": 1}", json!({"a": 1})),
    ] {
        fs::write(&file, text).unwrap();
        assert_eq!(
            request(&core, "lens-local-storage:read", json!({})).await,
            expected,
            "for {text:?}"
        );
    }
    fs::set_permissions(&file, fs::Permissions::from_mode(0o000)).unwrap();
    assert_eq!(
        request(&core, "lens-local-storage:read", json!({})).await,
        json!({})
    );
}

#[tokio::test]
async fn a_cluster_the_catalog_does_not_have_is_refused() {
    let core = core();
    for id in ["not-a-cluster", ""] {
        let message =
            format!("Cannot use the local storage of cluster \"{id}\", which is not registered");
        assert_eq!(
            refusal(&core, "lens-local-storage:read", json!({"clusterId": id})).await,
            message
        );
        assert_eq!(
            refusal(
                &core,
                "lens-local-storage:write",
                json!({"clusterId": id, "state": {}})
            )
            .await,
            message
        );
    }
    assert!(!core.data_dir().join("lens-local-storage").exists());
}

// Directories

async fn validate(core: &Core, path: &Path) -> Value {
    request(core, "validate-directory", json!(path.to_string_lossy())).await
}

#[tokio::test]
async fn validate_directory_answers_with_the_electron_build_s_texts() {
    let core = core();
    let base = core.dir.0.join("paths");
    fs::create_dir_all(base.join("dir")).unwrap();
    fs::write(base.join("file"), "x").unwrap();
    let fifo = base.join("fifo");
    let fifo_name = std::ffi::CString::new(fifo.to_string_lossy().as_bytes()).unwrap();
    // SAFETY: a valid, NUL-terminated path.
    assert_eq!(unsafe { libc::mkfifo(fifo_name.as_ptr(), 0o644) }, 0);
    symlink(base.join("loop-b"), base.join("loop-a")).unwrap();
    symlink(base.join("loop-a"), base.join("loop-b")).unwrap();
    fs::create_dir_all(base.join("closed/inner")).unwrap();
    fs::set_permissions(base.join("closed"), fs::Permissions::from_mode(0o000)).unwrap();

    assert_eq!(
        validate(&core, &base.join("dir")).await,
        json!({"ok": true})
    );
    let error = |text: &str| json!({"ok": false, "error": text});
    assert_eq!(
        validate(&core, &base.join("file")).await,
        error("the provided path is a file and not a directory.")
    );
    assert_eq!(
        validate(&core, &fifo).await,
        error("the provided path is a pipe and not a directory.")
    );
    assert_eq!(
        validate(&core, &base.join("missing")).await,
        error("the provided path does not exist.")
    );
    assert_eq!(
        validate(&core, &base.join("file/child")).await,
        error("a prefix of the provided path is not a directory.")
    );
    assert_eq!(
        validate(&core, &base.join("loop-a")).await,
        error(
            "the provided path is a sym-link which points to a chain of sym-links that is too long to resolve. Perhaps it is cyclic."
        )
    );
    assert_eq!(
        validate(&core, &base.join("x".repeat(300))).await,
        error("the pathname is too long to be used.")
    );
    assert_eq!(
        validate(&core, &base.join("closed/inner")).await,
        error(
            "search permissions is denied for one of the directories in the prefix of the provided path."
        )
    );
}

#[tokio::test]
async fn the_tilde_is_the_home_directory_alone_only() {
    let core = core();
    for path in ["~", "~/"] {
        assert_eq!(
            request(&core, "validate-directory", json!(path)).await,
            json!({"ok": true}),
            "for {path}"
        );
    }
    assert_eq!(
        request(&core, "validate-directory", json!("~/missing-in-home")).await,
        json!({"ok": false, "error": "the provided path does not exist."})
    );
    assert_eq!(request(&core, "path-exists", json!("~")).await, json!(true));
}

#[tokio::test]
async fn path_exists_follows_links() {
    let core = core();
    let base = core.dir.0.join("exists");
    fs::create_dir_all(&base).unwrap();
    fs::write(base.join("file"), "x").unwrap();
    symlink(base.join("gone"), base.join("broken")).unwrap();
    for (name, expected) in [
        ("file", true),
        ("", true),
        ("missing", false),
        ("broken", false),
    ] {
        assert_eq!(
            request(
                &core,
                "path-exists",
                json!(base.join(name).to_string_lossy())
            )
            .await,
            json!(expected),
            "for {name:?}"
        );
    }
}

// Templates

fn templates_folder(core: &Core) -> PathBuf {
    core.home().join(".freelens/templates")
}

/// The next update of the templates, polling as a view does.
async fn next_update(core: &Core, after: &mut u64) -> Value {
    loop {
        for message in poll(core, *after).await {
            *after = message["seq"].as_u64().unwrap();
            if message["channel"] == "user-resource-templates-update" {
                return message["payload"].clone();
            }
        }
    }
}

#[tokio::test(start_paused = true)]
async fn the_templates_follow_the_folder() {
    let core = core();
    let mut after = 0;
    poll(&core, after).await;
    assert_eq!(
        request(&core, "initial-user-resource-templates", Value::Null).await,
        json!([])
    );

    let folder = templates_folder(&core);
    fs::create_dir_all(folder.join("a")).unwrap();
    fs::write(folder.join("a/x.yaml"), "kind: X").unwrap();
    fs::write(folder.join("y.json"), "{}").unwrap();
    fs::write(folder.join("z.YAML"), "not counted").unwrap();
    symlink(&folder, folder.join("a/loop")).unwrap();
    assert_eq!(
        next_update(&core, &mut after).await,
        json!([
            {"label": "a", "options": [{"label": "x", "value": "kind: X"}]},
            {"label": "ungrouped", "options": [{"label": "y", "value": "{}"}]},
        ])
    );

    fs::write(folder.join("a/x.yaml"), "kind: Changed").unwrap();
    let update = next_update(&core, &mut after).await;
    assert_eq!(update[0]["options"][0]["value"], "kind: Changed");

    fs::remove_file(folder.join("y.json")).unwrap();
    let update = next_update(&core, &mut after).await;
    assert_eq!(update.as_array().unwrap().len(), 1);

    // Nothing changed: no update while the folder is polled again and again.
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert!(
        poll(&core, after)
            .await
            .iter()
            .all(|message| message["channel"] != "user-resource-templates-update")
    );

    fs::remove_dir_all(&folder).unwrap();
    assert_eq!(next_update(&core, &mut after).await, json!([]));
    fs::create_dir_all(&folder).unwrap();
    fs::write(folder.join("back.yml"), "kind: Back").unwrap();
    assert_eq!(
        next_update(&core, &mut after).await,
        json!([{"label": "ungrouped", "options": [{"label": "back", "value": "kind: Back"}]}])
    );
    // A second request answers what was sent last, without starting again.
    assert_eq!(
        request(&core, "initial-user-resource-templates", Value::Null).await[0]["label"],
        "ungrouped"
    );
}

// Sync box

#[tokio::test(start_paused = true)]
async fn the_sync_box_is_empty_and_hears_nothing() {
    let core = core();
    poll(&core, 0).await;
    assert_eq!(
        request(&core, "sync-box-initial-value-channel", Value::Null).await,
        json!([])
    );
    let (status, _) = post(
        &core,
        "/ipc/messages",
        json!({"messages": [{"channel": "sync-box-channel", "payload": {"id": "x", "value": 1}}]}),
    )
    .await;
    assert!(status.is_success());
    assert!(poll(&core, 0).await.is_empty());
}

// download-json-channel

/// A self-signed certificate for `localhost` and `127.0.0.1`, made when the
/// test runs; no key is kept in the repository.
fn certificate(dir: &Path) -> (CertificateDer<'static>, PrivateKeyDer<'static>) {
    fs::write(
        dir.join("openssl.cnf"),
        "[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost,IP:127.0.0.1\nbasicConstraints=critical,CA:FALSE\n",
    )
    .unwrap();
    let run = |args: &[&str]| {
        let status = std::process::Command::new("openssl")
            .args(args)
            .current_dir(dir)
            .stderr(std::process::Stdio::null())
            .status()
            .unwrap();
        assert!(status.success(), "openssl {args:?}");
    };
    run(&[
        "req",
        "-x509",
        "-newkey",
        "ec",
        "-pkeyopt",
        "ec_paramgen_curve:prime256v1",
        "-nodes",
        "-keyout",
        "key.tmp",
        "-out",
        "cert.tmp",
        "-days",
        "2",
        "-config",
        "openssl.cnf",
    ]);
    run(&[
        "x509", "-in", "cert.tmp", "-outform", "DER", "-out", "cert.der",
    ]);
    run(&[
        "pkcs8", "-topk8", "-nocrypt", "-in", "key.tmp", "-outform", "DER", "-out", "key.der",
    ]);
    (
        CertificateDer::from(fs::read(dir.join("cert.der")).unwrap()),
        PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(
            fs::read(dir.join("key.der")).unwrap(),
        )),
    )
}

fn acceptor(cert: &CertificateDer<'static>, key: &PrivateKeyDer<'static>) -> TlsAcceptor {
    let provider = Arc::new(rustls::crypto::ring::default_provider());
    let config = rustls::ServerConfig::builder_with_provider(provider)
        .with_safe_default_protocol_versions()
        .unwrap()
        .with_no_client_auth()
        .with_single_cert(vec![cert.clone()], key.clone_key())
        .unwrap();
    TlsAcceptor::from(Arc::new(config))
}

type Record = Arc<Mutex<Vec<String>>>;

trait Io: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send {}
impl<T: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin + Send> Io for T {}

async fn read_head(stream: &mut (impl tokio::io::AsyncRead + Unpin)) -> String {
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        match stream.read_u8().await {
            Ok(byte) => head.push(byte),
            Err(_) => break,
        }
    }
    String::from_utf8_lossy(&head).into_owned()
}

/// A server of a few paths, plain or TLS, recording each request's head.
async fn server(tls: Option<TlsAcceptor>) -> (u16, Record) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let record: Record = Arc::default();
    let recording = Arc::clone(&record);
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let tls = tls.clone();
            let record = Arc::clone(&recording);
            tokio::spawn(async move {
                let mut stream: Box<dyn Io> = match tls {
                    Some(tls) => match tls.accept(tcp).await {
                        Ok(stream) => Box::new(stream),
                        Err(_) => return,
                    },
                    None => Box::new(tcp),
                };
                let head = read_head(&mut stream).await;
                record.lock().unwrap().push(head.clone());
                let path = head
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or_default()
                    .to_string();
                let (status, extra, body) = match path.as_str() {
                    "/json" => ("200 OK", "", "{\"ok\":true}"),
                    "/missing" => ("404 Not Found", "", "nothing"),
                    "/html" => ("200 OK", "", "<html></html>"),
                    "/redirect" => ("302 Found", "Location: /json\r\n", ""),
                    "/slow" => {
                        tokio::time::sleep(Duration::from_secs(10)).await;
                        ("200 OK", "", "{}")
                    }
                    _ => ("500 Internal Server Error", "", ""),
                };
                let response = format!(
                    "HTTP/1.1 {status}\r\n{extra}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes()).await;
                let _ = stream.shutdown().await;
            });
        }
    });
    (port, record)
}

/// An HTTP proxy, plain or TLS, that opens the tunnels it is asked for.
async fn connect_proxy(tls: Option<TlsAcceptor>) -> (u16, Record) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let record: Record = Arc::default();
    let recording = Arc::clone(&record);
    tokio::spawn(async move {
        loop {
            let (tcp, _) = listener.accept().await.unwrap();
            let tls = tls.clone();
            let record = Arc::clone(&recording);
            tokio::spawn(async move {
                let mut client: Box<dyn Io> = match tls {
                    Some(tls) => match tls.accept(tcp).await {
                        Ok(stream) => Box::new(stream),
                        Err(_) => return,
                    },
                    None => Box::new(tcp),
                };
                let head = read_head(&mut client).await;
                let line = head.lines().next().unwrap_or_default().to_string();
                record.lock().unwrap().push(line.clone());
                let target = line
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or_default()
                    .to_string();
                let Ok(mut upstream) = TcpStream::connect(target).await else {
                    let _ = client.write_all(b"HTTP/1.1 502 Bad Gateway\r\n\r\n").await;
                    return;
                };
                let _ = client
                    .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .await;
                let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
            });
        }
    });
    (port, record)
}

/// A SOCKS5 proxy without authentication.
async fn socks_proxy() -> (u16, Record) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let record: Record = Arc::default();
    let recording = Arc::clone(&record);
    tokio::spawn(async move {
        loop {
            let (mut client, _) = listener.accept().await.unwrap();
            let record = Arc::clone(&recording);
            tokio::spawn(async move {
                let mut greeting = [0u8; 2];
                client.read_exact(&mut greeting).await.unwrap();
                let mut methods = vec![0u8; usize::from(greeting[1])];
                client.read_exact(&mut methods).await.unwrap();
                client.write_all(&[5, 0]).await.unwrap();
                let mut request = [0u8; 4];
                client.read_exact(&mut request).await.unwrap();
                let host = match request[3] {
                    3 => {
                        let mut name = vec![0u8; usize::from(client.read_u8().await.unwrap())];
                        client.read_exact(&mut name).await.unwrap();
                        String::from_utf8(name).unwrap()
                    }
                    _ => {
                        let mut address = [0u8; 4];
                        client.read_exact(&mut address).await.unwrap();
                        std::net::Ipv4Addr::from(address).to_string()
                    }
                };
                let port = client.read_u16().await.unwrap();
                record.lock().unwrap().push(format!("socks5 {host}:{port}"));
                let mut upstream = TcpStream::connect((host.as_str(), port)).await.unwrap();
                client
                    .write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0])
                    .await
                    .unwrap();
                let _ = tokio::io::copy_bidirectional(&mut client, &mut upstream).await;
            });
        }
    });
    (port, record)
}

async fn download(core: &Core, url: &str, timeout: Option<u64>) -> Value {
    let opts = match timeout {
        Some(timeout) => json!({"timeout": timeout}),
        None => json!({}),
    };
    request(
        core,
        "download-json-channel",
        json!({"url": url, "opts": opts}),
    )
    .await
}

fn set_preferences(core: &Core, preferences: Value) {
    core.stores
        .update(StoreName::User, json!({"preferences": preferences}));
}

#[tokio::test]
async fn a_json_body_is_answered_and_failures_are_named() {
    let core = core();
    let (port, record) = server(None).await;
    let base = format!("http://localhost:{port}");
    assert_eq!(
        download(&core, &format!("{base}/json"), None).await,
        json!({"callWasSuccessful": true, "response": {"ok": true}})
    );
    assert_eq!(
        download(&core, &format!("{base}/missing"), None).await,
        json!({"callWasSuccessful": false, "error": "404: Not Found"})
    );
    let not_json = download(&core, &format!("{base}/html"), None).await;
    assert_eq!(not_json["callWasSuccessful"], false);
    let message = not_json["error"].as_str().unwrap();
    assert!(
        !message.is_empty() && !message.starts_with("fetch failed"),
        "{message}"
    );
    assert_eq!(
        download(&core, &format!("{base}/redirect"), None).await,
        json!({"callWasSuccessful": true, "response": {"ok": true}})
    );
    assert_eq!(
        download(&core, &format!("{base}/slow"), Some(1500)).await,
        json!({"callWasSuccessful": false, "error": "Operation timed out: timeout 1s"})
    );
    for head in record.lock().unwrap().iter() {
        let head = head.to_lowercase();
        assert!(
            !head.contains("\r\ncookie:") && !head.contains("\r\nauthorization:"),
            "{head}"
        );
        assert!(head.starts_with("get "), "{head}");
    }
    let refused = download(&core, "http://127.0.0.1:1/json", None).await;
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .starts_with("fetch failed: "),
        "{refused}"
    );
}

#[tokio::test]
async fn a_proxy_scheme_the_electron_build_does_not_support_is_named() {
    let core = core();
    set_preferences(&core, json!({"httpsProxy": "ftp://x"}));
    assert_eq!(
        download(&core, "http://localhost:1/json", None).await,
        json!({"callWasSuccessful": false, "error": "Unsupported proxy URL scheme \"ftp:\" in the HTTP Proxy preference: use http:, https: or socks5:"})
    );
}

/// The cases of `https-agent.test.ts` and `https-proxy-agent.test.ts`.
#[tokio::test]
async fn a_tls_server_is_reached_through_each_kind_of_proxy() {
    let certs = TempDir::new();
    let (cert, key) = certificate(&certs.0);
    let tls = acceptor(&cert, &key);
    let core = core_with(Trust::Roots(vec![cert.clone()]));
    let (port, served) = server(Some(tls.clone())).await;
    let url = format!("https://localhost:{port}/json");
    let ok = json!({"callWasSuccessful": true, "response": {"ok": true}});

    assert_eq!(download(&core, &url, None).await, ok, "direct");

    let (http_port, http_record) = connect_proxy(None).await;
    set_preferences(
        &core,
        json!({"httpsProxy": format!("http://127.0.0.1:{http_port}")}),
    );
    assert_eq!(
        download(&core, &url, None).await,
        ok,
        "through an http: proxy"
    );
    assert_eq!(
        http_record.lock().unwrap().as_slice(),
        [format!("CONNECT localhost:{port} HTTP/1.1")]
    );

    let (https_port, https_record) = connect_proxy(Some(tls.clone())).await;
    set_preferences(
        &core,
        json!({"httpsProxy": format!("https://localhost:{https_port}")}),
    );
    assert_eq!(
        download(&core, &url, None).await,
        ok,
        "through an https: proxy"
    );
    assert_eq!(
        https_record.lock().unwrap().as_slice(),
        [format!("CONNECT localhost:{port} HTTP/1.1")]
    );

    let (socks_port, socks_record) = socks_proxy().await;
    set_preferences(
        &core,
        json!({"httpsProxy": format!("socks5://127.0.0.1:{socks_port}")}),
    );
    assert_eq!(
        download(&core, &url, None).await,
        ok,
        "through a SOCKS5 proxy"
    );
    assert_eq!(
        socks_record.lock().unwrap().as_slice(),
        [format!("socks5 localhost:{port}")]
    );

    // A plain http: target goes through the tunnel to its own port.
    let (plain_port, _) = server(None).await;
    set_preferences(
        &core,
        json!({"httpsProxy": format!("http://127.0.0.1:{http_port}")}),
    );
    assert_eq!(
        download(&core, &format!("http://localhost:{plain_port}/json"), None).await,
        ok,
        "plain through an http: proxy"
    );
    assert_eq!(
        http_record.lock().unwrap().last().unwrap(),
        &format!("CONNECT localhost:{plain_port} HTTP/1.1")
    );
    assert_eq!(served.lock().unwrap().len(), 4);
}

#[tokio::test]
async fn an_untrusted_server_is_refused_unless_untrusted_authorities_are_allowed() {
    let certs = TempDir::new();
    let (cert, key) = certificate(&certs.0);
    let core = core_with(Trust::Roots(Vec::new()));
    let (port, _) = server(Some(acceptor(&cert, &key))).await;
    let url = format!("https://localhost:{port}/json");
    let refused = download(&core, &url, None).await;
    assert_eq!(refused["callWasSuccessful"], false);
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .starts_with("fetch failed: "),
        "{refused}"
    );

    set_preferences(&core, json!({"allowUntrustedCAs": true}));
    assert_eq!(
        download(&core, &url, None).await,
        json!({"callWasSuccessful": true, "response": {"ok": true}})
    );

    let (proxy_port, _) = connect_proxy(Some(acceptor(&cert, &key))).await;
    set_preferences(
        &core,
        json!({"httpsProxy": format!("https://localhost:{proxy_port}")}),
    );
    let refused = download(&core, &url, None).await;
    assert!(
        refused["error"]
            .as_str()
            .unwrap()
            .starts_with("fetch failed: "),
        "the proxy is not trusted either: {refused}"
    );
    set_preferences(
        &core,
        json!({"httpsProxy": format!("https://localhost:{proxy_port}"), "allowUntrustedCAs": true}),
    );
    assert_eq!(download(&core, &url, None).await["callWasSuccessful"], true);
}
