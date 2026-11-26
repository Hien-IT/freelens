/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The `/api-kube/` proxy and its watches of `specs/009-main-cluster-connection`
//! (`contracts/api-kube.md`, `contracts/kube-watch.md`), against the fake API
//! server, through the scheme's routes as a view reaches them.

mod fake_api;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use fake_api::{Answer, Context, FakeApi, Tls, User, temp_dir, write_kubeconfig};
use freelens_tauri::catalog::Catalog;
use freelens_tauri::cluster::watch::{self, Watches};
use freelens_tauri::cluster::{Clusters, api_kube};
use freelens_tauri::frames::{self, Frames};
use freelens_tauri::messaging::{Channels, Log, Messaging, routes};
use freelens_tauri::routes::{Env, Routes};
use freelens_tauri::scheme::{Asset, State};
use http::{Method, Request, Response, StatusCode, header};
use serde_json::{Value, json};

const MAIN: &str = "freelens-app://renderer.freelens.app";

struct Core {
    api: FakeApi,
    dir: std::path::PathBuf,
    routes: Routes,
    state: State,
    catalog: Catalog,
    messaging: Messaging,
    frames: Frames,
    watches: Watches,
    lines: Arc<Mutex<Vec<String>>>,
}

impl Core {
    fn cluster(&self) -> String {
        self.catalog.cluster_ids()[0].clone()
    }

    fn host(&self) -> String {
        format!("freelens-app://{}.renderer.freelens.app", self.cluster())
    }
}

async fn core_with_limit(limit: Duration) -> Core {
    let dir = temp_dir("api-kube");
    let api = FakeApi::start(Tls::None, &dir).await;
    let file = dir.join("config");
    write_kubeconfig(
        &file,
        Some(&api),
        &[Context::new("a", &api, User::Token(fake_api::TOKEN.into()))],
    );
    let catalog = Catalog::from_kubeconfig_file(&file);
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    let mut channels = Channels::with_log(Arc::clone(&log));
    let frames = frames::register(&mut channels, catalog.clone(), Arc::clone(&log)).unwrap();
    let clusters = Clusters::new(&catalog);
    let watches = watch::register_with(&mut channels, &clusters, &frames, &catalog, limit).unwrap();
    let mut routes = Routes::default();
    api_kube::register_with(&mut routes, &clusters, limit).unwrap();
    let state = State {
        catalog: catalog.clone(),
        open_cluster: None,
        log: Box::new(|_| {}),
    };
    Core {
        api,
        dir,
        routes,
        state,
        catalog,
        messaging: channels.build(),
        frames,
        watches,
        lines,
    }
}

async fn core() -> Core {
    core_with_limit(watch::INACTIVITY_LIMIT).await
}

async fn post(core: &Core, host: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("{host}{path}"))
        .header(header::ORIGIN, host)
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

async fn open(core: &Core, host: &str, payload: Value) -> (StatusCode, Value) {
    post(
        core,
        host,
        "/ipc/request",
        json!({"channel": "kube-watch:open", "payload": payload}),
    )
    .await
}

async fn send_message(core: &Core, host: &str, channel: &str, payload: Value) {
    let (status, _) = post(
        core,
        host,
        "/ipc/messages",
        json!({"messages": [{"channel": channel, "payload": payload}]}),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
}

/// The messages a view's queue delivers, polled without end in the
/// background; a page load with its session.
#[derive(Clone)]
struct Inbox {
    messages: Arc<Mutex<Vec<Value>>>,
}

impl Inbox {
    async fn open(core: &Core, host: &str, session: &str) -> Self {
        let messages: Arc<Mutex<Vec<Value>>> = Arc::default();
        let collected = Arc::clone(&messages);
        let catalog = core.catalog.clone();
        let messaging = core.messaging.clone();
        let host = host.to_string();
        let session = session.to_string();
        tokio::spawn(async move {
            let mut after = 0;
            loop {
                let request = Request::builder()
                    .method(Method::POST)
                    .uri(format!("{host}/ipc/poll"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(
                        json!({"session": session, "after": after})
                            .to_string()
                            .into_bytes(),
                    )
                    .unwrap();
                let response = routes::handle(request, &catalog, &messaging).await;
                let body: Value = serde_json::from_slice(response.body()).unwrap();
                for message in body["messages"].as_array().unwrap() {
                    after = message["seq"].as_u64().unwrap();
                    collected.lock().unwrap().push(message.clone());
                }
            }
        });
        // The first poll opens the queue.
        tokio::time::sleep(Duration::from_millis(30)).await;
        Self { messages }
    }

    fn of(&self, channel: &str) -> Vec<Value> {
        self.messages
            .lock()
            .unwrap()
            .iter()
            .filter(|message| message["channel"] == channel)
            .map(|message| message["payload"].clone())
            .collect()
    }

    /// The text of every data message of `id`, in order.
    fn text(&self, id: &str) -> String {
        self.of("kube-watch:data")
            .iter()
            .filter(|data| data["id"] == id)
            .map(|data| data["text"].as_str().unwrap().to_string())
            .collect()
    }

    async fn wait_for(&self, what: &str, done: impl Fn(&Self) -> bool) {
        for _ in 0..400 {
            if done(self) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("waited for {what}: {:?}", self.messages.lock().unwrap());
    }
}

fn header_of<'a>(answer: &'a Value, name: &str) -> Option<&'a str> {
    answer["payload"]["headers"]
        .as_array()?
        .iter()
        .find(|pair| pair[0] == name)
        .and_then(|pair| pair[1].as_str())
}

// The watch channels (contracts/kube-watch.md)

#[tokio::test]
async fn a_watch_is_answered_with_its_head_before_the_first_event() {
    let core = core().await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    let inbox = Inbox::open(&core, &host, "s1").await;

    let (status, answer) = open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1&resourceVersion=5", "headers": []}),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(answer["payload"]["status"], 200);
    assert_eq!(answer["payload"].get("body"), None);
    assert_eq!(header_of(&answer, "cache-control"), Some("no-store"));
    assert_eq!(header_of(&answer, "content-type"), Some("application/json"));
    assert_eq!(header_of(&answer, "transfer-encoding"), None);
    assert!(inbox.of("kube-watch:data").is_empty());
    assert_eq!(stream.opened(), 1);
    let request = &core.api.requests_of("/api/v1/pods")[0];
    assert_eq!(request.query.as_deref(), Some("watch=1&resourceVersion=5"));
    assert_eq!(
        request.header("authorization"),
        Some(format!("Bearer {}", fake_api::TOKEN).as_str())
    );
}

#[tokio::test]
async fn the_body_reaches_the_frame_in_order_and_the_end_follows() {
    let core = core().await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    let inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;

    stream.send("{\"type\":\"ADDED\"}\n");
    stream.send("{\"type\":\"MOD");
    stream.send("IFIED\"}\n");
    // A character split across chunks.
    stream.send(vec![b'"', 0xc3]);
    stream.send(vec![0xa9, b'"', b'\n']);
    stream.end();

    inbox
        .wait_for("the end", |inbox| !inbox.of("kube-watch:end").is_empty())
        .await;
    assert_eq!(
        inbox.text("w1"),
        "{\"type\":\"ADDED\"}\n{\"type\":\"MODIFIED\"}\n\"é\"\n"
    );
    assert_eq!(inbox.of("kube-watch:end"), [json!({"id": "w1"})]);
    let ends_after_data = {
        let messages = inbox.messages.lock().unwrap();
        let last_data = messages
            .iter()
            .rposition(|m| m["channel"] == "kube-watch:data")
            .unwrap();
        let end = messages
            .iter()
            .position(|m| m["channel"] == "kube-watch:end")
            .unwrap();
        end > last_data
    };
    assert!(ends_after_data);
    assert_eq!(core.watches.count(), 0);
}

#[tokio::test]
async fn chunks_that_arrive_while_one_waits_are_appended_to_it() {
    let core = core().await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    // No poll runs yet beyond the first, so the chunks wait together.
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("{host}/ipc/poll"))
        .header(header::CONTENT_TYPE, "application/json")
        .body(
            json!({"session": "s1", "after": 0})
                .to_string()
                .into_bytes(),
        )
        .unwrap();
    let catalog = core.catalog.clone();
    let messaging = core.messaging.clone();
    let first = tokio::spawn(async move { routes::handle(request, &catalog, &messaging).await });
    tokio::time::sleep(Duration::from_millis(20)).await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    stream.send("a");
    // The first chunk answers the waiting poll; the next ones wait together.
    let answered: Value = serde_json::from_slice(first.await.unwrap().body()).unwrap();
    assert_eq!(answered["messages"][0]["payload"]["text"], "a");
    for chunk in ["b", "c", "d"] {
        stream.send(chunk);
    }
    tokio::time::sleep(Duration::from_millis(50)).await;
    let (_, polled) = post(
        &core,
        &host,
        "/ipc/poll",
        json!({"session": "s1", "after": 1}),
    )
    .await;
    let data = polled["messages"].as_array().unwrap();
    assert_eq!(data.len(), 1);
    assert_eq!(data[0]["payload"], json!({"id": "w1", "text": "bcd"}));
}

#[tokio::test]
async fn a_failed_body_ends_the_watch_with_an_error() {
    let core = core().await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    let inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;

    stream.send("{}\n");
    stream.cut();

    inbox
        .wait_for("the end", |inbox| !inbox.of("kube-watch:end").is_empty())
        .await;
    let end = &inbox.of("kube-watch:end")[0];
    assert_eq!(end["id"], "w1");
    assert!(end["error"].as_str().is_some());
}

#[tokio::test]
async fn a_non_2xx_head_is_answered_whole_and_nothing_follows() {
    let core = core().await;
    let host = core.host();
    core.api.set(
        "GET",
        "/api/v1/secrets",
        Answer::status(403, "Forbidden", "secrets is forbidden"),
    );
    let inbox = Inbox::open(&core, &host, "s1").await;

    let (status, answer) = open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/secrets?watch=1"}),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(answer["payload"]["status"], 403);
    assert!(
        answer["payload"]["body"]
            .as_str()
            .unwrap()
            .contains("secrets is forbidden")
    );
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(inbox.of("kube-watch:end").is_empty());
    assert_eq!(core.watches.count(), 0);
}

#[tokio::test]
async fn close_drops_the_request_and_sends_nothing_more() {
    let core = core().await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    let inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    assert_eq!(core.api.open_connections(), 1);

    send_message(&core, &host, "kube-watch:close", json!({"id": "w1"})).await;

    core.api.wait_open_at_most(0).await;
    assert_eq!(core.watches.count(), 0);
    stream.send("late\n");
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(inbox.of("kube-watch:end").is_empty());
    assert_eq!(inbox.text("w1"), "");
}

#[tokio::test]
async fn a_new_page_load_of_the_frame_ends_its_watches() {
    let core = core().await;
    let host = core.host();
    core.api.stream("/api/v1/pods");
    let _inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    assert_eq!(core.watches.count(), 1);

    // The page reloads: its next poll names a new session.
    let _reloaded = Inbox::open(&core, &host, "s2").await;

    core.api.wait_open_at_most(0).await;
    assert_eq!(core.watches.count(), 0);
}

#[tokio::test]
async fn a_forgotten_frame_ends_its_watches() {
    let core = core().await;
    let host = core.host();
    core.api.stream("/api/v1/pods");
    let _inbox = Inbox::open(&core, &host, "s1").await;
    let (status, _) = post(
        &core,
        &host,
        "/ipc/request",
        json!({"channel": "cluster:set-frame-id", "payload": core.cluster()}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;

    core.frames.forget(&core.cluster());

    core.api.wait_open_at_most(0).await;
    assert_eq!(core.watches.count(), 0);
}

#[tokio::test]
async fn a_cluster_leaving_the_catalog_ends_its_watches_with_an_error() {
    let core = core().await;
    let host = core.host();
    core.api.stream("/api/v1/pods");
    let inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    let cluster = core.cluster();

    core.catalog.set_clusters(Vec::new(), &Default::default());

    core.api.wait_open_at_most(0).await;
    // The queue of a cluster no longer in the catalog still holds the end.
    let ended = inbox.of("kube-watch:end");
    assert_eq!(ended.len(), 1);
    assert_eq!(
        ended[0]["error"],
        format!("Cluster {cluster} left the catalog")
    );
}

#[tokio::test]
async fn a_watch_without_a_chunk_for_its_limit_ends_with_an_error() {
    let core = core_with_limit(Duration::from_millis(300)).await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    let inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    stream.send("{}\n");

    inbox
        .wait_for("the end", |inbox| !inbox.of("kube-watch:end").is_empty())
        .await;
    assert_eq!(inbox.text("w1"), "{}\n");
    let end = &inbox.of("kube-watch:end")[0];
    assert!(end["error"].as_str().unwrap().starts_with("no data for"));
    core.api.wait_open_at_most(0).await;
}

#[tokio::test]
async fn the_main_window_cannot_open_a_watch() {
    let core = core().await;
    core.api.stream("/api/v1/pods");
    let (status, answer) = open(
        &core,
        MAIN,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        answer["error"]["message"],
        "kube-watch:open is answered only for a cluster frame"
    );
    assert!(core.api.requests().is_empty());
}

#[tokio::test]
async fn ids_in_use_or_invalid_and_paths_not_normalized_are_refused() {
    let core = core().await;
    let host = core.host();
    core.api.stream("/api/v1/pods");
    let _inbox = Inbox::open(&core, &host, "s1").await;
    let (status, _) = open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    for (payload, message) in [
        (
            json!({"id": "w1", "path": "/api/v1/pods?watch=1"}),
            "kube-watch:open: the id w1 is in use",
        ),
        (
            json!({"id": "w_1", "path": "/api/v1/pods?watch=1"}),
            "kube-watch:open needs an id of 1 to 64 letters, digits and dashes",
        ),
        (
            json!({"id": "w2", "path": "/api/../version?watch=1"}),
            "kube-watch:open needs a normalized path under /api-kube",
        ),
        (
            json!({"id": "w3", "path": "api/v1/pods?watch=1"}),
            "kube-watch:open needs a normalized path under /api-kube",
        ),
    ] {
        let (status, answer) = open(&core, &host, payload).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(answer["error"]["message"], message);
    }
    assert_eq!(core.api.requests_of("/api/v1/pods").len(), 1);
}

#[tokio::test]
async fn the_filtered_headers_reach_the_server() {
    let core = core().await;
    let host = core.host();
    core.api.stream("/api/v1/pods");
    let _inbox = Inbox::open(&core, &host, "s1").await;
    open(
        &core,
        &host,
        json!({"id": "w1", "path": "/api/v1/pods?watch=1", "headers": [
            ["authorization", "Bearer from-the-view"],
            ["cookie", "a=b"],
            ["origin", "freelens-app://x"],
            ["accept-encoding", "gzip"],
            ["accept", "application/json"],
            ["x-custom", "y"],
        ]}),
    )
    .await;
    let request = &core.api.requests_of("/api/v1/pods")[0];
    assert_eq!(
        request.header("authorization"),
        Some(format!("Bearer {}", fake_api::TOKEN).as_str())
    );
    assert_eq!(request.header("cookie"), None);
    assert_eq!(request.header("origin"), None);
    assert_eq!(request.header("accept-encoding"), None);
    assert_eq!(request.header("accept"), Some("application/json"));
    assert_eq!(request.header("x-custom"), Some("y"));
}

#[tokio::test]
async fn twenty_open_watches_leave_a_request_unblocked() {
    let core = core().await;
    let host = core.host();
    let stream = core.api.stream("/api/v1/pods");
    core.api.set(
        "GET",
        "/api/v1/namespaces",
        Answer::json(200, json!({"items": []})),
    );
    let _inbox = Inbox::open(&core, &host, "s1").await;
    for n in 0..20 {
        let (status, _) = open(
            &core,
            &host,
            json!({"id": format!("w{n}"), "path": "/api/v1/pods?watch=1"}),
        )
        .await;
        assert_eq!(status, StatusCode::OK);
    }
    stream.wait_opened(20).await;

    let response = tokio::time::timeout(
        Duration::from_secs(5),
        kube(&core, Method::GET, "/api-kube/api/v1/namespaces"),
    )
    .await
    .expect("answered while the watches stay open");
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body(), br#"{"items":[]}"#);
    assert_eq!(core.watches.count(), 20);
    assert!(core.lines.lock().unwrap().is_empty());
}

// The route (contracts/api-kube.md)

fn no_assets(_: &str) -> Option<Asset> {
    None
}

/// A request of the cluster frame through the scheme's route table.
async fn kube_with(core: &Core, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    core.routes
        .handle(
            request,
            Env {
                state: &core.state,
                assets: &no_assets,
            },
        )
        .await
}

async fn kube(core: &Core, method: Method, path: &str) -> Response<Vec<u8>> {
    let request = Request::builder()
        .method(method)
        .uri(format!("{}{path}", core.host()))
        .body(Vec::new())
        .unwrap();
    kube_with(core, request).await
}

fn text(response: &Response<Vec<u8>>) -> String {
    String::from_utf8_lossy(response.body()).into_owned()
}

#[tokio::test]
async fn every_method_reaches_the_api_server_with_its_path_query_and_body() {
    let core = core().await;
    for method in ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] {
        core.api.set(
            method,
            "/api/v1/namespaces/default/configmaps",
            Answer::json(200, json!({"kind": "ConfigMapList", "method": method})),
        );
    }
    for method in [
        Method::GET,
        Method::HEAD,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
    ] {
        core.api.clear_requests();
        let request = Request::builder()
            .method(method.clone())
            .uri(format!(
                "{}/api-kube/api/v1/namespaces/default/configmaps?limit=500",
                core.host()
            ))
            .header(header::CONTENT_TYPE, "application/merge-patch+json")
            .body(br#"{"data":{"k":"v"}}"#.to_vec())
            .unwrap();
        let response = kube_with(&core, request).await;
        assert_eq!(response.status(), StatusCode::OK, "{method}");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
        if method == Method::HEAD {
            assert!(response.body().is_empty());
        } else {
            assert!(text(&response).contains(method.as_str()), "{method}");
        }
        let request = &core.api.requests()[0];
        assert_eq!(request.method, method.as_str());
        assert_eq!(request.path, "/api/v1/namespaces/default/configmaps");
        assert_eq!(request.query.as_deref(), Some("limit=500"));
        assert_eq!(request.body, br#"{"data":{"k":"v"}}"#);
        assert_eq!(
            request.header("content-type"),
            Some("application/merge-patch+json")
        );
    }
}

#[tokio::test]
async fn the_frame_s_credentials_and_hop_by_hop_headers_stay_and_the_context_s_are_added() {
    let core = core().await;
    core.api.set(
        "GET",
        "/api/v1/namespaces",
        Answer::json(200, json!({"items": []})),
    );
    let request = Request::builder()
        .uri(format!("{}/api-kube/api/v1/namespaces", core.host()))
        .header(header::AUTHORIZATION, "Bearer from-the-view")
        .header(header::COOKIE, "a=b")
        .header(header::ORIGIN, core.host())
        .header(header::ACCEPT_ENCODING, "gzip")
        .header(header::CONNECTION, "x-private")
        .header("x-private", "1")
        .header(header::ACCEPT, "application/json;as=Table")
        .header(header::USER_AGENT, "WebKit")
        .header("x-custom", "y")
        .body(Vec::new())
        .unwrap();
    let response = kube_with(&core, request).await;
    assert_eq!(response.status(), StatusCode::OK);
    let request = &core.api.requests()[0];
    assert_eq!(
        request.header("authorization"),
        Some(format!("Bearer {}", fake_api::TOKEN).as_str())
    );
    for dropped in ["cookie", "origin", "accept-encoding", "x-private"] {
        assert_eq!(request.header(dropped), None, "{dropped}");
    }
    assert_eq!(request.header("accept"), Some("application/json;as=Table"));
    assert_eq!(request.header("user-agent"), Some("WebKit"));
    assert_eq!(request.header("x-custom"), Some("y"));
    assert!(request.header("host").unwrap().starts_with("127.0.0.1:"));
    for secret in [fake_api::TOKEN, "from-the-view"] {
        assert!(!text(&response).contains(secret));
        assert!(
            response
                .headers()
                .values()
                .all(|value| !value.to_str().unwrap_or_default().contains(secret))
        );
    }
}

#[tokio::test]
async fn an_error_status_of_the_api_server_passes_through_without_retry() {
    let core = core().await;
    for (status, reason) in [
        (403, "Forbidden"),
        (503, "ServiceUnavailable"),
        (429, "TooManyRequests"),
    ] {
        core.api.clear_requests();
        core.api.set(
            "GET",
            "/api/v1/secrets",
            Answer::status(status, reason, "no"),
        );
        let response = kube(&core, Method::GET, "/api-kube/api/v1/secrets").await;
        assert_eq!(response.status().as_u16(), status);
        assert!(text(&response).contains(&format!("\"code\":{status}")));
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(core.api.requests().len(), 1);
    }
}

#[tokio::test]
async fn any_normalized_path_goes_to_the_cluster_and_others_get_400() {
    let core = core().await;
    core.api.set(
        "GET",
        "/version",
        Answer::json(200, json!({"gitVersion": "v1"})),
    );
    core.api.set("GET", "/healthz", Answer::text(200, "ok"));
    assert_eq!(
        kube(&core, Method::GET, "/api-kube/version").await.status(),
        StatusCode::OK
    );
    assert_eq!(
        text(&kube(&core, Method::GET, "/api-kube/healthz").await),
        "ok"
    );
    for path in [
        "/api-kube/api/../version",
        "/api-kube/./api",
        "/api-kube/%2e%2e/version",
    ] {
        let response = kube(&core, Method::GET, path).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{path}");
        assert_eq!(text(&response), "Bad Request");
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
    }
    assert_eq!(core.api.requests().len(), 2);
}

#[tokio::test]
async fn a_watch_on_the_route_is_refused_with_a_status_naming_the_watch_channel() {
    let core = core().await;
    for query in ["watch=1", "watch=true", "limit=1&watch", "follow=1"] {
        let response = kube(
            &core,
            Method::GET,
            &format!("/api-kube/api/v1/pods?{query}"),
        )
        .await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
        assert!(text(&response).contains("kube-watch:open"));
    }
    assert_eq!(
        kube(&core, Method::GET, "/api-kube/api/v1/pods?watch=0")
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(core.api.requests().len(), 1);
}

#[tokio::test]
async fn the_main_window_has_no_api_kube_route() {
    let core = core().await;
    let request = Request::get("freelens-app://renderer.freelens.app/api-kube/api/v1/namespaces")
        .body(Vec::new())
        .unwrap();
    assert_eq!(
        kube_with(&core, request).await.status(),
        StatusCode::NOT_FOUND
    );
    assert!(core.api.requests().is_empty());
}

#[tokio::test]
async fn a_refused_target_answers_500_without_retry() {
    let core = core().await;
    // A port that nothing listens on.
    let closed = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let file = core.dir.join("refused");
    let mut context = Context::new("refused", &core.api, User::None);
    context.server = format!("http://127.0.0.1:{port}");
    write_kubeconfig(&file, None, &[context]);
    let catalog = Catalog::from_kubeconfig_file(&file);
    let clusters = Clusters::new(&catalog);
    let mut routes = Routes::default();
    api_kube::register(&mut routes, &clusters).unwrap();
    let state = State {
        catalog: catalog.clone(),
        open_cluster: None,
        log: Box::new(|_| {}),
    };
    let request = Request::get(format!(
        "freelens-app://{}.renderer.freelens.app/api-kube/version",
        catalog.cluster_ids()[0]
    ))
    .body(Vec::new())
    .unwrap();
    let response = routes
        .handle(
            request,
            Env {
                state: &state,
                assets: &no_assets,
            },
        )
        .await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "text/plain");
    assert!(text(&response).starts_with("Oops, something went wrong.\n"));
    assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
}

#[tokio::test]
async fn a_client_that_cannot_be_built_answers_503_with_the_reason() {
    let core = core().await;
    // The file goes away after the catalog read it.
    let file = core.dir.join("gone");
    write_kubeconfig(
        &file,
        Some(&core.api),
        &[Context::new("gone", &core.api, User::None)],
    );
    let catalog = Catalog::from_kubeconfig_file(&file);
    std::fs::remove_file(&file).unwrap();
    let clusters = Clusters::new(&catalog);
    let mut routes = Routes::default();
    api_kube::register(&mut routes, &clusters).unwrap();
    let id = catalog.cluster_ids()[0].clone();
    let state = State {
        catalog,
        open_cluster: None,
        log: Box::new(|_| {}),
    };
    let request = Request::get(format!(
        "freelens-app://{id}.renderer.freelens.app/api-kube/version"
    ))
    .body(Vec::new())
    .unwrap();
    let response = routes
        .handle(
            request,
            Env {
                state: &state,
                assets: &no_assets,
            },
        )
        .await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let status: Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(status["kind"], "Status");
    assert_eq!(status["reason"], "ServiceUnavailable");
    assert!(
        status["message"]
            .as_str()
            .unwrap()
            .starts_with(&format!("Failed to start the proxy of cluster {id}: "))
    );
}

#[tokio::test]
async fn a_response_cut_after_its_head_is_answered_with_what_came() {
    let core = core().await;
    core.api.set(
        "GET",
        "/api/v1/pods",
        Answer::DropAfterHead {
            status: 200,
            partial: br#"{"items":["#.to_vec(),
        },
    );
    let response = kube(&core, Method::GET, "/api-kube/api/v1/pods").await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body(), br#"{"items":["#);
}

#[tokio::test]
async fn no_head_within_the_limit_answers_500_and_a_quiet_body_ends_at_it() {
    let core = core_with_limit(Duration::from_millis(300)).await;
    core.api.set("GET", "/api/v1/slow", Answer::Hang);
    let response = kube(&core, Method::GET, "/api-kube/api/v1/slow").await;
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(text(&response).contains("Operation timed out"));

    let stream = core.api.stream("/api/v1/quiet");
    let (response, ()) = tokio::join!(kube(&core, Method::GET, "/api-kube/api/v1/quiet"), async {
        stream.wait_opened(1).await;
        stream.send("{\"items\":");
    });
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.body(), b"{\"items\":");
    core.api.wait_open_at_most(0).await;
}

#[tokio::test]
async fn the_request_goes_to_the_cluster_of_the_host_whatever_it_says() {
    let core = core().await;
    let other_dir = temp_dir("api-kube-other");
    let other = FakeApi::start(Tls::None, &other_dir).await;
    let file = core.dir.join("two");
    write_kubeconfig(
        &file,
        None,
        &[
            Context::new("first", &core.api, User::None),
            Context::new("second", &other, User::None),
        ],
    );
    let catalog = Catalog::from_kubeconfig_file(&file);
    let ids = catalog.cluster_ids();
    let clusters = Clusters::new(&catalog);
    let mut routes = Routes::default();
    api_kube::register(&mut routes, &clusters).unwrap();
    let state = State {
        catalog: catalog.clone(),
        open_cluster: None,
        log: Box::new(|_| {}),
    };
    for api in [&core.api, &other] {
        api.set(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
    }
    let request = Request::get(format!(
        "freelens-app://{}.renderer.freelens.app/api-kube/version?cluster={}",
        ids[1], ids[0]
    ))
    .header("x-cluster", ids[0].as_str())
    .body(Vec::new())
    .unwrap();
    let response = routes
        .handle(
            request,
            Env {
                state: &state,
                assets: &no_assets,
            },
        )
        .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(other.requests_of("/version").len(), 1);
    assert!(core.api.requests().is_empty());
}

#[tokio::test]
async fn a_redirect_inside_the_api_server_stays_on_the_route() {
    let core = core().await;
    core.api.set(
        "GET",
        "/api",
        Answer::text(301, "").with_header("location", "/api/"),
    );
    core.api.set(
        "GET",
        "/apis",
        Answer::text(302, "").with_header("location", "https://some-login-page/sign-in"),
    );
    let response = kube(&core, Method::GET, "/api-kube/api").await;
    assert_eq!(response.status(), StatusCode::MOVED_PERMANENTLY);
    assert_eq!(response.headers()[header::LOCATION], "/api-kube/api/");
    let response = kube(&core, Method::GET, "/api-kube/apis").await;
    assert_eq!(
        response.headers()[header::LOCATION],
        "https://some-login-page/sign-in"
    );
}
