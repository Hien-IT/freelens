/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster connection of `specs/009-main-cluster-connection` against the
//! fake API server.

mod fake_api;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use fake_api::{Answer, Context, FakeApi, Tls, User, temp_dir, write_kubeconfig};
use freelens_tauri::catalog::{Catalog, CatalogLog};
use freelens_tauri::cluster::{Clusters, api_kube};
use freelens_tauri::foundation::paths::BuildKind;
use freelens_tauri::frames::Frames;
use freelens_tauri::messaging::{Log, Messaging, routes};
use freelens_tauri::routes::{Env, Routes};
use freelens_tauri::scheme::{Asset, State};
use freelens_tauri::stores::{Machine, StoreName, Stores};
use freelens_tauri::{Checks, register_core};
use http::{Method, Request, header};
use kube::config::{KubeConfigOptions, Kubeconfig};
use serde_json::{Value, json};

async fn kube_client(file: &std::path::Path, context: &str) -> kube::Client {
    let kubeconfig = Kubeconfig::read_from(file).unwrap();
    let options = KubeConfigOptions {
        context: Some(context.into()),
        ..Default::default()
    };
    let config = kube::Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .unwrap();
    kube::Client::try_from(config).unwrap()
}

// The fake API server itself.

#[tokio::test]
async fn the_fake_api_answers_kube_over_tls_with_a_client_certificate() {
    let dir = temp_dir("fake-api-tls");
    let api = FakeApi::start(Tls::ClientAuth, &dir).await;
    api.set(
        "GET",
        "/version",
        Answer::json(200, json!({"gitVersion": "v1.37.0"})),
    );
    let file = dir.join("config");
    write_kubeconfig(
        &file,
        Some(&api),
        &[Context::new("tls", &api, User::ClientCert)],
    );
    let client = kube_client(&file, "tls").await;
    let version = client.apiserver_version().await.unwrap();
    assert_eq!(version.git_version, "v1.37.0");
    let request = &api.requests_of("/version")[0];
    assert_eq!(
        request.client_cert.as_deref(),
        Some(
            api.certificates
                .as_ref()
                .unwrap()
                .client_cert_der
                .as_slice()
        )
    );
}

#[tokio::test]
async fn the_fake_api_streams_and_counts_connections() {
    let dir = temp_dir("fake-api-stream");
    let api = FakeApi::start(Tls::None, &dir).await;
    let stream = api.stream("/api/v1/pods");
    let file = dir.join("config");
    write_kubeconfig(
        &file,
        Some(&api),
        &[Context::new(
            "plain",
            &api,
            User::Token(fake_api::TOKEN.into()),
        )],
    );
    let client = kube_client(&file, "plain").await;
    let request = http::Request::get("/api/v1/pods?watch=1")
        .body(Vec::new())
        .unwrap();
    let response = client.send(request.map(Into::into)).await.unwrap();
    assert_eq!(response.status(), 200);
    stream.wait_opened(1).await;
    assert!(api.open_connections() >= 1);
    stream.send("{\"type\":\"ADDED\"}\n");
    stream.end();
    let body = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    assert_eq!(&body[..], b"{\"type\":\"ADDED\"}\n");
    let recorded = &api.requests_of("/api/v1/pods")[0];
    assert_eq!(recorded.query.as_deref(), Some("watch=1"));
    assert_eq!(
        recorded.header("authorization"),
        Some(format!("Bearer {}", fake_api::TOKEN).as_str())
    );
}

// The connection through the channels (contracts/connection.md,
// contracts/cluster-channels.md)

const MAIN: &str = "freelens-app://renderer.freelens.app";

struct ClusterCore {
    api: FakeApi,
    catalog: Catalog,
    messaging: Messaging,
    stores: Stores,
    clusters: Clusters,
    frames: Frames,
    data_dir: std::path::PathBuf,
    lines: Arc<Mutex<Vec<String>>>,
}

impl ClusterCore {
    fn id(&self, index: usize) -> String {
        self.catalog.cluster_ids()[index].clone()
    }
}

/// A core whose catalog syncs one kubeconfig file of `contexts` at the fake
/// API server, with its stores in a temporary data directory.
async fn cluster_core(api: FakeApi, dir: &Path, contexts: Vec<Context>) -> ClusterCore {
    let file = dir.join("kubeconfig");
    write_kubeconfig(&file, Some(&api), &contexts);
    let data_dir = dir.join("data");
    std::fs::create_dir_all(&data_dir).unwrap();
    std::fs::write(
        data_dir.join("lens-user-store.json"),
        json!({"preferences": {"syncKubeconfigEntries": [{"filePath": file}]}}).to_string(),
    )
    .unwrap();
    let lines: Arc<Mutex<Vec<String>>> = Arc::default();
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    let stores = Stores::load(
        &data_dir,
        Machine {
            kube_dir: "/no/such/home/.kube".into(),
            timezone: "UTC".into(),
            build: BuildKind::Release,
        },
        Arc::clone(&log),
    );
    let catalog = Catalog::new_with_home(
        &stores,
        &data_dir,
        None,
        CatalogLog::new(Arc::clone(&log), false),
        Some("/no/such/home".into()),
    );
    let core = register_core(Checks::default(), "0.1.0".into(), &catalog, &stores, &log).unwrap();
    catalog.start();
    tokio::time::timeout(Duration::from_secs(10), catalog.scanned())
        .await
        .unwrap();
    ClusterCore {
        api,
        catalog,
        messaging: core.messaging,
        stores,
        clusters: core.clusters,
        frames: core.frames,
        data_dir,
        lines,
    }
}

async fn post(core: &ClusterCore, path: &str, body: Value) -> Value {
    post_from(core, MAIN, path, body).await
}

async fn post_from(core: &ClusterCore, origin: &str, path: &str, body: Value) -> Value {
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!("{origin}{path}"))
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

async fn request(core: &ClusterCore, channel: &str, payload: Value) -> Value {
    post(
        core,
        "/ipc/request",
        json!({"channel": channel, "payload": payload}),
    )
    .await
}

async fn message(core: &ClusterCore, channel: &str) {
    post(
        core,
        "/ipc/messages",
        json!({"messages": [{"channel": channel}]}),
    )
    .await;
}

/// What the main window receives, polled in the background.
#[derive(Clone, Default)]
struct Received(Arc<Mutex<Vec<Value>>>);

impl Received {
    async fn listen(core: &ClusterCore) -> Self {
        let received = Self::default();
        let sink = received.clone();
        let catalog = core.catalog.clone();
        let messaging = core.messaging.clone();
        tokio::spawn(async move {
            let mut after = 0;
            loop {
                let request = Request::builder()
                    .method(Method::POST)
                    .uri(format!("{MAIN}/ipc/poll"))
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(
                        json!({"session": "s1", "after": after})
                            .to_string()
                            .into_bytes(),
                    )
                    .unwrap();
                let response = routes::handle(request, &catalog, &messaging).await;
                let Ok(body) = serde_json::from_slice::<Value>(response.body()) else {
                    return;
                };
                for message in body["messages"].as_array().unwrap() {
                    after = message["seq"].as_u64().unwrap();
                    sink.0.lock().unwrap().push(message.clone());
                }
            }
        });
        tokio::time::sleep(Duration::from_millis(30)).await;
        received
    }

    fn of(&self, channel: &str) -> Vec<Value> {
        self.0
            .lock()
            .unwrap()
            .iter()
            .filter(|message| message["channel"] == channel)
            .map(|message| message["payload"].clone())
            .collect()
    }

    async fn wait_for(&self, what: &str, done: impl Fn(&Self) -> bool) {
        for _ in 0..400 {
            if done(self) {
                return;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        panic!("waited for {what}: {:?}", self.0.lock().unwrap());
    }
}

/// The answers of a reachable cluster, the detectors' included.
fn a_cluster(api: &FakeApi) {
    api.serve_a_cluster();
    api.set(
        "GET",
        "/api/v1/namespaces/default",
        Answer::json(
            200,
            json!({"metadata": {"name": "default", "uid": "uid-default"}}),
        ),
    );
    api.set(
        "GET",
        "/api/v1/nodes",
        Answer::json(
            200,
            json!({"items": [{"metadata": {"name": "n1"}}], "metadata": {}}),
        ),
    );
}

fn store_entry(core: &ClusterCore, id: &str) -> Value {
    core.stores.model(StoreName::Cluster)["clusters"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["id"] == id)
        .cloned()
        .unwrap()
}

fn phase(core: &ClusterCore, id: &str) -> (String, bool) {
    let entity = core
        .catalog
        .entities()
        .into_iter()
        .find(|entity| entity["metadata"]["uid"] == id)
        .unwrap();
    (
        entity["status"]["phase"].as_str().unwrap().to_string(),
        entity["status"]["enabled"].as_bool().unwrap(),
    )
}

#[tokio::test]
async fn activate_cluster_connects_it_as_the_electron_build_does() {
    let dir = temp_dir("cluster-activate-2");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let context = Context::new("kind-a", &api, User::Token(fake_api::TOKEN.into()));
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    let dump = dir.join("messages.jsonl");
    core.messaging.sender().dump_to(dump.clone());
    let received = Received::listen(&core).await;
    assert_eq!(phase(&core, &id), ("disconnected".into(), true));

    let answer = request(&core, "activate-cluster", json!({"clusterId": id})).await;
    assert_eq!(answer, json!({}));
    let channel = format!("cluster:{id}:connection-update");
    received
        .wait_for("the last update", |r| r.of(&channel).len() == 4)
        .await;

    let updates: Vec<(String, String)> = received
        .of(&format!("cluster:{id}:connection-update"))
        .iter()
        .map(|u| {
            (
                u["message"].as_str().unwrap().into(),
                u["level"].as_str().unwrap().into(),
            )
        })
        .collect();
    assert_eq!(
        updates,
        [
            ("Starting connection ...".into(), "info".into()),
            ("Refreshing connection status ...".into(), "info".into()),
            ("Refreshing cluster accessibility ...".into(), "info".into()),
            (
                "Connected, waiting for view to load ...".into(),
                "info".into()
            ),
        ]
    );
    received
        .wait_for("the connected state", |r| {
            r.of("cluster-state-sync")
                .iter()
                .any(|s| s["state"]["ready"] == true)
        })
        .await;
    let last = received.of("cluster-state-sync").last().unwrap().clone();
    assert_eq!(last["clusterId"], id.as_str());
    let keys: Vec<&String> = last["state"].as_object().unwrap().keys().collect();
    assert_eq!(
        keys,
        [
            "online",
            "ready",
            "disconnected",
            "accessible",
            "isAdmin",
            "allowedNamespaces",
            "resourcesToShow",
            "knownResources",
            "isGlobalWatchEnabled"
        ]
    );
    assert_eq!(phase(&core, &id), ("connected".into(), true));
    let entry = store_entry(&core, &id);
    assert_eq!(entry["metadata"]["version"], "v1.37.0");
    assert!(entry["metadata"]["lastSeen"].is_string());
    assert!(entry["metadata"].get("distribution").is_none());

    // cluster:refresh-accessibility detects the rest of the metadata.
    let answer = request(&core, "cluster:refresh-accessibility", json!(id)).await;
    assert_eq!(answer["payload"], true);
    let entry = store_entry(&core, &id);
    assert_eq!(entry["metadata"]["nodes"], 1);
    assert_eq!(entry["metadata"]["distribution"], "kind");
    assert!(entry["metadata"]["id"].is_string());

    // SC-009: no placeholder credential anywhere a view or the log sees.
    let dumped = std::fs::read_to_string(&dump).unwrap();
    assert!(dumped.contains("cluster-state-sync"));
    let everything = format!(
        "{dumped}{:?}{:?}",
        received.0.lock().unwrap(),
        core.lines.lock().unwrap()
    );
    for secret in [
        fake_api::TOKEN.to_string(),
        fake_api::base64(fake_api::TOKEN.as_bytes()),
    ] {
        assert!(!everything.contains(&secret), "{secret}");
    }
}

#[tokio::test]
async fn initial_states_name_every_cluster_and_unknown_ids_change_nothing() {
    let dir = temp_dir("cluster-initial");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let contexts = vec![
        Context::new("one", &api, User::None),
        Context::new("two", &api, User::None),
    ];
    let core = cluster_core(api, &dir, contexts).await;
    let (one, two) = (core.id(0), core.id(1));
    request(&core, "activate-cluster", json!({"clusterId": one})).await;

    let answer = request(&core, "initial-cluster-state-sync", Value::Null).await;
    let states = answer["payload"].as_array().unwrap();
    assert_eq!(states.len(), 2);
    let of = |id: &str| {
        states
            .iter()
            .find(|state| state["clusterId"] == id)
            .unwrap()["state"]
            .clone()
    };
    assert_eq!(of(&one)["accessible"], true);
    assert_eq!(of(&two)["disconnected"], true);

    assert_eq!(
        request(
            &core,
            "activate-cluster",
            json!({"clusterId": "no-such-id"})
        )
        .await,
        json!({})
    );
    assert_eq!(
        request(&core, "cluster:refresh-accessibility", json!("no-such-id")).await["payload"],
        true
    );
    assert!(core.clusters.state("no-such-id").is_none());
}

#[tokio::test]
async fn a_forbidden_namespace_list_without_a_default_is_broadcast() {
    let dir = temp_dir("cluster-forbidden");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    api.set(
        "GET",
        "/api/v1/namespaces",
        Answer::status(403, "Forbidden", "namespaces is forbidden"),
    );
    let context = Context::new("c", &api, User::None);
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    let received = Received::listen(&core).await;
    request(&core, "activate-cluster", json!({"clusterId": id})).await;
    received
        .wait_for("the broadcast", |r| {
            !r.of("cluster:list-namespace-forbidden").is_empty()
        })
        .await;
    assert_eq!(received.of("cluster:list-namespace-forbidden"), [json!(id)]);
    assert!(
        core.clusters
            .state(&id)
            .unwrap()
            .allowed_namespaces
            .is_empty()
    );
}

#[tokio::test]
async fn the_network_going_away_and_back_follows_the_electron_build() {
    let dir = temp_dir("cluster-network");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let context = Context::new("c", &api, User::None);
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    request(&core, "activate-cluster", json!({"clusterId": id})).await;
    core.api.set(
        "GET",
        "/version",
        Answer::status(503, "ServiceUnavailable", "down"),
    );
    message(&core, "network:offline").await;
    for _ in 0..200 {
        if !core.clusters.state(&id).unwrap().online {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let state = core.clusters.state(&id).unwrap();
    assert!(!state.online && !state.accessible);
    assert_eq!(phase(&core, &id), ("connecting".into(), true));
    core.api.set(
        "GET",
        "/version",
        Answer::json(200, json!({"gitVersion": "v1.37.0"})),
    );
    message(&core, "network:online").await;
    for _ in 0..200 {
        if core.clusters.state(&id).unwrap().accessible {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(core.clusters.state(&id).unwrap().accessible);
    assert!(
        core.lines
            .lock()
            .unwrap()
            .iter()
            .any(|line| line == "[CLUSTER-MANAGER]: network is offline")
    );
}

// pc/features/cluster/refresh-accessibility-technical.test.ts, its skipped
// cases included

/// A cluster of two namespaces, one core and two non-core group versions, as
/// the Electron test answers.
fn two_namespaces(api: &FakeApi) {
    a_cluster(api);
    api.set(
        "GET",
        "/api/v1/namespaces",
        Answer::json(
            200,
            json!({"items": [{"metadata": {"name": "default"}}, {"metadata": {"name": "my-namespace"}}]}),
        ),
    );
    api.set(
        "GET",
        "/apis",
        Answer::json(
            200,
            json!({"groups": [
                {"name": "node.k8s.io", "versions": [{"groupVersion": "node.k8s.io/v1", "version": "v1"}]},
                {"name": "discovery.k8s.io", "versions": [{"groupVersion": "discovery.k8s.io/v1", "version": "v1"}]},
            ]}),
        ),
    );
    api.set(
        "GET",
        "/api/v1",
        Answer::json(
            200,
            json!({"resources": [
                {"name": "namespaces", "kind": "Namespace", "namespaced": false},
                {"name": "pods", "kind": "Pod", "namespaced": true},
            ]}),
        ),
    );
    api.set(
        "GET",
        "/apis/node.k8s.io/v1",
        Answer::json(200, json!({"resources": [{"name": "runtimeclasses", "kind": "RuntimeClass", "namespaced": false}]})),
    );
    api.set(
        "GET",
        "/apis/discovery.k8s.io/v1",
        Answer::json(200, json!({"resources": [{"name": "endpointslices", "kind": "EndpointSlice", "namespaced": true}]})),
    );
}

async fn refreshed_with(rules: [Value; 2]) -> (ClusterCore, String) {
    let dir = temp_dir("cluster-refresh");
    let api = FakeApi::start(Tls::None, &dir).await;
    two_namespaces(&api);
    let context = Context::new("c", &api, User::None);
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    request(&core, "activate-cluster", json!({"clusterId": id})).await;
    core.api.clear_requests();
    let reviews = "/apis/authorization.k8s.io/v1/selfsubjectrulesreviews";
    core.api.set(
        "POST",
        reviews,
        Answer::json(201, json!({"status": rules[0]})),
    );
    core.api.answer(
        "POST",
        reviews,
        Answer::json(201, json!({"status": rules[1]})),
    );
    request(&core, "cluster:refresh-accessibility", json!(id)).await;
    (core, id)
}

#[tokio::test]
async fn the_refresh_asks_in_the_electron_build_s_order() {
    let (core, _) =
        refreshed_with([json!({"incomplete": true}), json!({"resourceRules": []})]).await;
    let requests: Vec<String> = core
        .api
        .requests()
        .iter()
        .map(|request| format!("{} {}", request.method, request.path))
        .collect();
    let review = "POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews";
    assert_eq!(
        requests[..5],
        [
            review,
            review,
            "GET /api/v1/namespaces",
            "GET /api",
            "GET /apis"
        ]
    );
    let mut groups = requests[5..8].to_vec();
    groups.sort();
    assert_eq!(
        groups,
        [
            "GET /api/v1",
            "GET /apis/discovery.k8s.io/v1",
            "GET /apis/node.k8s.io/v1"
        ]
    );
    let rules = "POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews";
    assert_eq!(requests[8..10], [rules, rules]);
    let namespaces: Vec<Value> = core
        .api
        .requests_of("/apis/authorization.k8s.io/v1/selfsubjectrulesreviews")
        .iter()
        .map(|request| {
            serde_json::from_slice::<Value>(&request.body).unwrap()["spec"]["namespace"].clone()
        })
        .collect();
    assert!(namespaces.contains(&json!("default")) && namespaces.contains(&json!("my-namespace")));
    let admin: Value = serde_json::from_slice(&core.api.requests()[0].body).unwrap();
    assert_eq!(
        admin["spec"]["resourceAttributes"],
        json!({"namespace": "kube-system", "resource": "*", "verb": "create"})
    );
    let watch: Value = serde_json::from_slice(&core.api.requests()[1].body).unwrap();
    assert_eq!(
        watch["spec"]["resourceAttributes"],
        json!({"verb": "watch", "resource": "*"})
    );
    // Then the metadata.
    assert!(requests[10..].contains(&"GET /version".to_string()));
}

#[tokio::test]
async fn an_incomplete_review_shows_pods_and_namespaces() {
    let (core, id) =
        refreshed_with([json!({"incomplete": true}), json!({"resourceRules": []})]).await;
    let shown = core.clusters.state(&id).unwrap().resources_to_show;
    assert!(shown.contains(&"pods".to_string()));
    assert!(shown.contains(&"namespaces".to_string()));
}

#[tokio::test]
async fn a_list_rule_on_pods_shows_pods_and_not_namespaces() {
    let single =
        json!({"resourceRules": [{"verbs": ["list"], "apiGroups": [""], "resources": ["pods"]}]});
    let several = json!({"resourceRules": [
        {"verbs": ["get"], "apiGroups": [""], "resources": ["namespaces"]},
        {"verbs": ["list"], "apiGroups": [""], "resources": ["pods"]},
    ]});
    let (core, id) = refreshed_with([single, several]).await;
    let state = core.clusters.state(&id).unwrap();
    assert!(state.resources_to_show.contains(&"pods".to_string()));
    assert!(!state.resources_to_show.contains(&"namespaces".to_string()));
    assert!(state.ready);
    assert_eq!(state.allowed_namespaces, ["default", "my-namespace"]);
    let known: Vec<String> = state
        .known_resources
        .iter()
        .map(|resource| resource.formatted())
        .collect();
    assert_eq!(
        known.len(),
        4,
        "namespaces, pods, runtimeclasses and endpointslices: {known:?}"
    );
}

// Disconnecting and deleting (contracts/cluster-channels.md, FR-019 to FR-024)

/// The status of a `GET` of the cluster frame of `id` through the scheme's
/// `/api-kube/` route.
async fn kube_get(clusters: Clusters, catalog: Catalog, id: String, path: &str) -> u16 {
    let mut routes = Routes::default();
    api_kube::register(&mut routes, &clusters).unwrap();
    let state = State {
        catalog,
        open_cluster: None,
        log: Box::new(|_| {}),
    };
    let request = Request::get(format!(
        "freelens-app://{id}.renderer.freelens.app/api-kube{path}"
    ))
    .body(Vec::new())
    .unwrap();
    let no_assets = |_: &str| -> Option<Asset> { None };
    routes
        .handle(
            request,
            Env {
                state: &state,
                assets: &no_assets,
            },
        )
        .await
        .status()
        .as_u16()
}

/// A connected cluster with a request of its frame in flight at the fake
/// server, the frame recorded.
async fn connected_with_a_request_in_flight(
    name: &str,
) -> (
    ClusterCore,
    String,
    fake_api::Stream,
    tokio::task::JoinHandle<u16>,
) {
    let dir = temp_dir(name);
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let context = Context::new("kind-a", &api, User::Token(fake_api::TOKEN.into()));
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    request(&core, "activate-cluster", json!({"clusterId": id})).await;
    assert!(core.clusters.state(&id).unwrap().ready);
    let frame = format!("freelens-app://{id}.renderer.freelens.app");
    post_from(
        &core,
        &frame,
        "/ipc/request",
        json!({"channel": "cluster:set-frame-id", "payload": id}),
    )
    .await;
    assert!(core.frames.has_frame(&id));
    let stream = core.api.stream("/api/v1/pods");
    let in_flight = tokio::spawn(kube_get(
        core.clusters.clone(),
        core.catalog.clone(),
        id.clone(),
        "/api/v1/pods",
    ));
    stream.wait_opened(1).await;
    (core, id, stream, in_flight)
}

#[tokio::test]
async fn deactivate_cluster_disconnects_it_and_ends_what_it_has_in_flight() {
    let (core, id, stream, in_flight) =
        connected_with_a_request_in_flight("cluster-deactivate").await;
    let before = core.clusters.state(&id).unwrap();
    assert!(before.is_admin && !before.allowed_namespaces.is_empty());
    let received = Received::listen(&core).await;

    let answer = request(&core, "deactivate-cluster", json!(id)).await;

    assert_eq!(answer, json!({}));
    let state = core.clusters.state(&id).unwrap();
    assert!(state.disconnected && !state.online && !state.accessible && !state.ready);
    assert!(state.allowed_namespaces.is_empty());
    // The rest of the state is kept.
    assert!(state.is_admin && state.is_global_watch_enabled);
    assert_eq!(state.known_resources, before.known_resources);
    assert_eq!(phase(&core, &id), ("disconnected".into(), true));
    assert!(!core.frames.has_frame(&id));
    stream.wait_active_at_most(0).await;
    tokio::time::timeout(Duration::from_secs(5), in_flight)
        .await
        .expect("the request in flight ends")
        .unwrap();
    received
        .wait_for("the disconnected state", |r| {
            r.of("cluster-state-sync")
                .last()
                .is_some_and(|sync| sync["state"]["disconnected"] == true)
        })
        .await;
    let lines = core.lines.lock().unwrap().clone();
    let disconnecting = lines
        .iter()
        .position(|line| line.contains("[CLUSTER]: disconnecting"));
    let disconnected = lines
        .iter()
        .position(|line| line.contains("[CLUSTER]: disconnected"));
    assert!(
        disconnecting.is_some() && disconnected > disconnecting,
        "{lines:?}"
    );
    // The route answers a disconnected cluster with the 503 of the contract.
    let status = kube_get(
        core.clusters.clone(),
        core.catalog.clone(),
        id.clone(),
        "/version",
    )
    .await;
    assert_eq!(status, 503);
}

#[tokio::test]
async fn deactivating_twice_or_an_unknown_id_changes_nothing() {
    let dir = temp_dir("cluster-deactivate-twice");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let context = Context::new("kind-a", &api, User::Token(fake_api::TOKEN.into()));
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);

    for payload in [json!(id), json!(id), json!("no-such-cluster")] {
        assert_eq!(
            request(&core, "deactivate-cluster", payload).await,
            json!({})
        );
    }

    assert_eq!(core.clusters.state(&id).unwrap(), Default::default());
    assert_eq!(phase(&core, &id), ("disconnected".into(), true));
    let lines = core.lines.lock().unwrap().clone();
    assert!(
        !lines
            .iter()
            .any(|line| line.contains("[CLUSTER]: disconnecting")),
        "{lines:?}"
    );
}

#[tokio::test]
async fn the_deleting_mark_disables_the_entity_and_clearing_it_restores_the_phase() {
    let dir = temp_dir("cluster-deleting");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let context = Context::new("kind-a", &api, User::Token(fake_api::TOKEN.into()));
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    request(&core, "activate-cluster", json!({"clusterId": id})).await;
    assert_eq!(phase(&core, &id), ("connected".into(), true));

    assert_eq!(
        request(&core, "set-cluster-as-deleting", json!(id)).await,
        json!({})
    );
    assert_eq!(phase(&core, &id), ("deleting".into(), false));
    assert_eq!(
        request(&core, "clear-cluster-as-deleting", json!(id)).await,
        json!({})
    );
    assert_eq!(phase(&core, &id), ("connected".into(), true));
    // Any id is accepted.
    assert_eq!(
        request(&core, "set-cluster-as-deleting", json!("no-such-cluster")).await,
        json!({})
    );
}

#[tokio::test]
async fn the_delete_dialog_removes_the_context_then_the_cluster() {
    let (core, id, stream, _in_flight) = connected_with_a_request_in_flight("cluster-delete").await;
    let storage = core.data_dir.join("lens-local-storage");
    std::fs::create_dir_all(&storage).unwrap();
    std::fs::write(storage.join(format!("{id}.json")), "{}").unwrap();
    let kubeconfig = store_entry(&core, &id)["kubeConfigPath"]
        .as_str()
        .unwrap()
        .to_string();

    let contexts = request(&core, "cluster-kubeconfig-contexts", json!(id)).await;
    assert_eq!(
        contexts,
        json!({"payload": {"contexts": ["kind-a"], "currentContext": "kind-a"}})
    );
    assert!(!contexts.to_string().contains(fake_api::TOKEN));
    let removed = request(
        &core,
        "remove-cluster-context-from-kubeconfig",
        json!({"clusterId": id}),
    )
    .await;
    assert_eq!(removed, json!({}));
    let text = std::fs::read_to_string(&kubeconfig).unwrap();
    assert!(!text.contains("name: kind-a\n  context:") && text.contains(fake_api::TOKEN));
    assert_eq!(
        request(&core, "set-cluster-as-deleting", json!(id)).await,
        json!({})
    );
    assert_eq!(request(&core, "delete-cluster", json!(id)).await, json!({}));

    assert!(
        core.stores.model(StoreName::Cluster)["clusters"]
            .as_array()
            .unwrap()
            .iter()
            .all(|entry| entry["id"] != id.as_str())
    );
    assert!(!storage.join(format!("{id}.json")).exists());
    assert!(!core.frames.has_frame(&id));
    stream.wait_active_at_most(0).await;
    // An unknown id changes nothing.
    assert_eq!(
        request(&core, "delete-cluster", json!("no-such-cluster")).await,
        json!({})
    );
    for (channel, payload) in [
        ("cluster-kubeconfig-contexts", json!("no-such-cluster")),
        (
            "remove-cluster-context-from-kubeconfig",
            json!({"clusterId": "no-such-cluster"}),
        ),
    ] {
        assert_eq!(
            request(&core, channel, payload).await["error"]["message"],
            "Cluster \"no-such-cluster\" is not registered"
        );
    }
}

#[tokio::test]
async fn a_context_removed_from_its_synced_file_disconnects_its_cluster() {
    let (core, id, stream, _in_flight) =
        connected_with_a_request_in_flight("cluster-left-the-catalog").await;
    let kubeconfig = store_entry(&core, &id)["kubeConfigPath"]
        .as_str()
        .unwrap()
        .to_string();

    std::fs::write(&kubeconfig, "apiVersion: v1\nkind: Config\ncontexts: []\n").unwrap();

    stream.wait_active_at_most(0).await;
    for _ in 0..500 {
        if core.catalog.cluster_ids().is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert!(core.catalog.cluster_ids().is_empty());
    let lines = core.lines.lock().unwrap().clone();
    assert!(
        lines.iter().any(|line| line.contains(&format!(
            "[CLUSTER]: cluster left the catalog, disconnecting {{\"id\":\"{id}\"}}"
        ))),
        "{lines:?}"
    );
}

#[tokio::test]
async fn quitting_disconnects_every_cluster_and_leaves_no_connection_open() {
    let (core, id, stream, _in_flight) = connected_with_a_request_in_flight("cluster-quit").await;

    core.clusters.disconnect_all();

    assert!(core.clusters.state(&id).unwrap().disconnected);
    stream.wait_active_at_most(0).await;
    for _ in 0..500 {
        if core.api.open_connections() == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    assert_eq!(core.api.open_connections(), 0);
}

// execute-on-cluster and the frame rule (contracts/cluster-channels.md,
// FR-025 to FR-027)

async fn connected_core(name: &str) -> (ClusterCore, String) {
    let dir = temp_dir(name);
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let context = Context::new("kind-a", &api, User::Token(fake_api::TOKEN.into()));
    let core = cluster_core(api, &dir, vec![context]).await;
    let id = core.id(0);
    request(&core, "activate-cluster", json!({"clusterId": id})).await;
    assert!(core.clusters.state(&id).unwrap().accessible);
    (core, id)
}

async fn execute(core: &ClusterCore, payload: Value) -> Value {
    request(core, "execute-on-cluster", payload).await["payload"].clone()
}

#[tokio::test]
async fn execute_on_cluster_runs_each_operation_with_the_cluster_s_credentials() {
    let (core, id) = connected_core("cluster-execute").await;
    let pods = "/api/v1/namespaces/default/pods";
    let pod = "/api/v1/namespaces/default/pods/my-pod";
    let deployment = "/apis/apps/v1/namespaces/default/deployments/my-deploy";
    core.api.set(
        "GET",
        pods,
        Answer::json(200, json!({"kind": "PodList", "items": []})),
    );
    core.api.set(
        "POST",
        pods,
        Answer::json(201, json!({"kind": "Pod", "created": true})),
    );
    core.api.set(
        "PUT",
        pod,
        Answer::json(200, json!({"kind": "Pod", "updated": true})),
    );
    core.api.set(
        "DELETE",
        pod,
        Answer::json(200, json!({"kind": "Status", "status": "Success"})),
    );
    core.api.set(
        "PATCH",
        deployment,
        Answer::json(200, json!({"kind": "Deployment"})),
    );
    core.api.set(
        "GET",
        "/api/v1/namespaces/default/pods/not-found",
        Answer::status(404, "NotFound", "pods \"not-found\" not found"),
    );
    let resource = |name: Option<&str>| {
        let mut resource = json!({"apiVersion": "v1", "kind": "Pod", "namespace": "default"});
        if let Some(name) = name {
            resource["name"] = json!(name);
        }
        resource
    };
    let body = json!({"metadata": {"name": "my-pod"}});

    let listed = execute(
        &core,
        json!({"clusterId": id, "operation": "list", "resource": {
            "apiVersion": "v1", "kind": "Pod", "namespace": "default",
            "labelSelector": "app=nginx", "fieldSelector": "status.phase=Running"}}),
    )
    .await;
    let created = execute(
        &core,
        json!({"clusterId": id, "operation": "create", "resource": resource(None), "body": body}),
    )
    .await;
    let updated = execute(&core, json!({"clusterId": id, "operation": "update", "resource": resource(Some("my-pod")), "body": body})).await;
    let deleted = execute(
        &core,
        json!({"clusterId": id, "operation": "delete", "resource": resource(Some("my-pod"))}),
    )
    .await;
    let patch = json!({"spec": {"replicas": 3}});
    let deployment_resource = json!({"apiVersion": "apps/v1", "kind": "Deployment", "namespace": "default", "name": "my-deploy"});
    let mut patch_types = Vec::new();
    for patch_type in [None, Some("merge"), Some("json")] {
        let mut payload = json!({"clusterId": id, "operation": "patch", "resource": deployment_resource, "body": patch});
        if let Some(patch_type) = patch_type {
            payload["patchType"] = json!(patch_type);
        }
        assert_eq!(execute(&core, payload).await["success"], true);
        patch_types.push(
            core.api
                .requests_of(deployment)
                .last()
                .unwrap()
                .header("content-type")
                .unwrap()
                .to_string(),
        );
    }
    let missing = execute(
        &core,
        json!({"clusterId": id, "operation": "get", "resource": resource(Some("not-found"))}),
    )
    .await;

    assert_eq!(
        listed,
        json!({"success": true, "data": {"kind": "PodList", "items": []}})
    );
    let list_request = core.api.requests_of(pods)[0].clone();
    assert_eq!(list_request.method, "GET");
    assert_eq!(
        list_request.query.as_deref(),
        Some("labelSelector=app%3Dnginx&fieldSelector=status.phase%3DRunning")
    );
    assert_eq!(list_request.header("user-agent"), Some("Freelens/0.1.0"));
    assert_eq!(
        list_request.header("authorization"),
        Some(format!("Bearer {}", fake_api::TOKEN).as_str())
    );
    assert_eq!(
        created,
        json!({"success": true, "data": {"kind": "Pod", "created": true}})
    );
    let create_request = core
        .api
        .requests_of(pods)
        .into_iter()
        .find(|r| r.method == "POST")
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<Value>(&create_request.body).unwrap(),
        body
    );
    assert_eq!(
        create_request.header("content-type"),
        Some("application/json")
    );
    assert_eq!(updated["data"]["updated"], true);
    assert_eq!(deleted["success"], true);
    assert_eq!(
        core.api
            .requests_of(pod)
            .iter()
            .map(|r| r.method.as_str())
            .collect::<Vec<_>>(),
        ["PUT", "DELETE"]
    );
    assert_eq!(
        patch_types,
        [
            "application/strategic-merge-patch+json",
            "application/merge-patch+json",
            "application/json-patch+json"
        ]
    );
    assert_eq!(
        missing,
        json!({"success": false, "error": {"message": "pods \"not-found\" not found", "code": 404, "reason": "NotFound"}})
    );
    // No answer carries the credential.
    for answer in [&listed, &created, &updated, &deleted, &missing] {
        assert!(!answer.to_string().contains(fake_api::TOKEN));
    }
}

#[tokio::test]
async fn execute_on_cluster_refuses_what_the_electron_build_refuses() {
    let (core, id) = connected_core("cluster-execute-refusals").await;
    let pod = json!({"apiVersion": "v1", "kind": "Pod", "namespace": "default"});
    let not_accessible = json!({"success": false, "error": {
        "message": "Cluster not available. Ensure cluster is connected.",
        "code": 503, "reason": "ClusterNotAccessible"}});

    let unknown = execute(
        &core,
        json!({"clusterId": "no-such-cluster", "operation": "list", "resource": pod}),
    )
    .await;
    let operation = execute(
        &core,
        json!({"clusterId": id, "operation": "watch", "resource": pod}),
    )
    .await;
    let escaping = execute(
        &core,
        json!({"clusterId": id, "operation": "get", "resource": {"apiVersion": "v1", "kind": "Pod", "namespace": "..", "name": "x"}}),
    )
    .await;
    request(&core, "deactivate-cluster", json!(id)).await;
    let disconnected = execute(
        &core,
        json!({"clusterId": id, "operation": "list", "resource": pod}),
    )
    .await;

    assert_eq!(unknown, not_accessible);
    assert_eq!(disconnected, not_accessible);
    assert_eq!(
        operation,
        json!({"success": false, "error": {"message": "Unknown operation: watch", "code": 400, "reason": "BadRequest"}})
    );
    assert_eq!(escaping["error"]["reason"], "BadRequest");
    assert!(
        core.api
            .requests_of("/api/v1/namespaces/../pods/x")
            .is_empty()
    );
}

#[tokio::test]
async fn a_cluster_frame_names_only_its_own_cluster() {
    let dir = temp_dir("cluster-frame-rule");
    let api = FakeApi::start(Tls::None, &dir).await;
    a_cluster(&api);
    let contexts = vec![
        Context::new("kind-a", &api, User::Token(fake_api::TOKEN.into())),
        Context::new("kind-b", &api, User::Token(fake_api::TOKEN.into())),
    ];
    let core = cluster_core(api, &dir, contexts).await;
    let (own, other) = (core.id(0), core.id(1));
    let frame = format!("freelens-app://{own}.renderer.freelens.app");
    let named = |id: &str| -> Vec<(&'static str, Value)> {
        vec![
            ("activate-cluster", json!({"clusterId": id})),
            ("deactivate-cluster", json!(id)),
            ("set-cluster-as-deleting", json!(id)),
            ("clear-cluster-as-deleting", json!(id)),
            ("delete-cluster", json!(id)),
            (
                "execute-on-cluster",
                json!({"clusterId": id, "operation": "list", "resource": {"apiVersion": "v1", "kind": "Pod"}}),
            ),
            ("cluster:refresh-accessibility", json!(id)),
            ("cluster-kubeconfig-contexts", json!(id)),
            (
                "remove-cluster-context-from-kubeconfig",
                json!({"clusterId": id}),
            ),
        ]
    };
    let requests_before = core.api.requests().len();
    let kubeconfig = std::fs::read_to_string(dir.join("kubeconfig")).unwrap();

    for (channel, payload) in named(&other) {
        let answer = post_from(
            &core,
            &frame,
            "/ipc/request",
            json!({"channel": channel, "payload": payload}),
        )
        .await;
        assert_eq!(
            answer["error"]["message"],
            format!("{channel} is answered only for the sending frame's own cluster"),
            "{channel}"
        );
        assert!(
            core.lines.lock().unwrap().iter().any(|line| line
                == &format!("[CLUSTER]: refused {channel} from cluster {own} for cluster {other}")),
            "{channel}"
        );
    }

    // Nothing changed: no request reached the cluster, the other cluster is
    // as it was, its entry and the file are still there.
    assert_eq!(core.api.requests().len(), requests_before);
    assert_eq!(core.clusters.state(&other).unwrap(), Default::default());
    assert_eq!(phase(&core, &other), ("disconnected".into(), true));
    assert_eq!(store_entry(&core, &other)["id"], other.as_str());
    assert_eq!(
        std::fs::read_to_string(dir.join("kubeconfig")).unwrap(),
        kubeconfig
    );
    // The frame's own cluster is answered.
    let activated = post_from(
        &core,
        &frame,
        "/ipc/request",
        json!({"channel": "activate-cluster", "payload": {"clusterId": own}}),
    )
    .await;
    assert_eq!(activated, json!({}));
    assert!(core.clusters.state(&own).unwrap().accessible);
    let contexts = post_from(
        &core,
        &frame,
        "/ipc/request",
        json!({"channel": "cluster-kubeconfig-contexts", "payload": own}),
    )
    .await;
    assert_eq!(contexts["payload"]["contexts"], json!(["kind-a", "kind-b"]));
}

// The fixture cases shared with the Electron build (research R18): the same
// answers of the API server go through `Connection` here and through the
// Electron build's `ClusterConnection` in
// `packages/core/src/main/cluster/tauri-parity.test.ts`, which writes
// `expected/` with `UPDATE_TAURI_PARITY=1`.
//
// `case.json` holds the cluster (`contextName`, `server`, `exec`, and the
// optional `defaultNamespace`, `accessibleNamespaces` and
// `skipNamespaceAuthorizationCheck`) and the steps. `api.json` holds the
// rules: the first whose method, path with its query and, when it has one,
// body (a deep subset of the request's) match answers with its next answer,
// the last one repeating; no rule gives `404 page not found`. An answer is a
// status and a body, or a failure: `connect`, `credential` or `hang`.

mod parity {
    use std::path::{Path, PathBuf};
    use std::sync::Mutex;
    use std::time::Duration;

    use freelens_tauri::cluster::access::{Api, Report, Settings};
    use freelens_tauri::cluster::connection::{Backend, Connection};
    use freelens_tauri::cluster::{
        BoxFuture, ClientError, ClusterState, ConnectionUpdate, detect, phase_of,
    };
    use http::Method;
    use serde_json::{Map, Value, json};

    pub const ID: &str = "parity-cluster";

    struct Rule {
        method: String,
        path: String,
        body: Option<Value>,
        answers: Vec<Value>,
        used: usize,
    }

    pub struct Fixture {
        cluster: Value,
        rules: Mutex<Vec<Rule>>,
        updates: Mutex<Vec<Value>>,
        states: Mutex<Vec<ClusterState>>,
        metadata: Mutex<Map<String, Value>>,
        forbidden: Mutex<u64>,
    }

    fn subset(rule: &Value, actual: &Value) -> bool {
        match (rule, actual) {
            (Value::Object(rule), Value::Object(actual)) => rule
                .iter()
                .all(|(key, value)| actual.get(key).is_some_and(|inner| subset(value, inner))),
            _ => rule == actual,
        }
    }

    impl Fixture {
        pub fn load(case: &Path) -> (Self, Vec<Value>) {
            let read = |name: &str| -> Value {
                serde_json::from_str(&std::fs::read_to_string(case.join(name)).unwrap()).unwrap()
            };
            let definition = read("case.json");
            let rules = read("api.json")
                .as_array()
                .unwrap()
                .iter()
                .map(|rule| Rule {
                    method: rule["method"].as_str().unwrap().into(),
                    path: rule["path"].as_str().unwrap().into(),
                    body: rule.get("body").cloned(),
                    answers: rule["answers"].as_array().unwrap().clone(),
                    used: 0,
                })
                .collect();
            let fixture = Self {
                cluster: definition["cluster"].clone(),
                rules: Mutex::new(rules),
                updates: Mutex::default(),
                states: Mutex::default(),
                metadata: Mutex::default(),
                forbidden: Mutex::default(),
            };
            (fixture, definition["steps"].as_array().unwrap().clone())
        }

        fn answer(&self, method: &Method, path: &str, body: Option<&Value>) -> Value {
            let mut rules = self.rules.lock().unwrap();
            let found = rules.iter_mut().find(|rule| {
                rule.method == method.as_str()
                    && rule.path == path
                    && rule
                        .body
                        .as_ref()
                        .is_none_or(|expected| body.is_some_and(|body| subset(expected, body)))
            });
            match found {
                Some(rule) => {
                    let answer = rule.answers[rule.used.min(rule.answers.len() - 1)].clone();
                    rule.used += 1;
                    answer
                }
                None => json!({"status": 404, "body": "404 page not found"}),
            }
        }

        fn text(&self, key: &str) -> String {
            self.cluster[key].as_str().unwrap_or_default().to_string()
        }

        pub async fn detect_metadata(&self) {
            let metadata =
                detect::detect(self, &self.text("server"), &self.text("contextName")).await;
            self.metadata(metadata, true);
        }

        /// What the case produced, as the Electron test writes it.
        pub fn outcome(&self) -> Vec<(&'static str, Value)> {
            let states = self.states.lock().unwrap().clone();
            let mut phases = vec!["disconnected"];
            for state in &states {
                let (phase, _) = phase_of(state, false);
                if phases.last() != Some(&phase) {
                    phases.push(phase);
                }
            }
            let mut metadata = self.metadata.lock().unwrap().clone();
            if metadata.contains_key("lastSeen") {
                metadata.insert("lastSeen".into(), json!("<now>"));
            }
            vec![
                (
                    "updates",
                    Value::Array(self.updates.lock().unwrap().clone()),
                ),
                ("states", serde_json::to_value(states).unwrap()),
                ("metadata", Value::Object(metadata)),
                ("phases", json!(phases)),
                ("forbidden", json!(*self.forbidden.lock().unwrap())),
            ]
        }
    }

    impl Api for Fixture {
        fn request<'a>(
            &'a self,
            method: Method,
            path: &'a str,
            body: Option<Value>,
        ) -> BoxFuture<'a, Result<Value, ClientError>> {
            let answer = self.answer(&method, path, body.as_ref());
            Box::pin(async move {
                if let Some(delay) = answer["delay"].as_u64() {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
                let reason = answer["reason"].as_str().unwrap_or_default().to_string();
                match answer["fail"].as_str() {
                    Some("connect") => return Err(ClientError::Connect(reason)),
                    Some("credential") => return Err(ClientError::Credential(reason)),
                    Some("hang") => std::future::pending::<()>().await,
                    _ => {}
                }
                let status = answer["status"].as_u64().unwrap_or(200) as u16;
                if (200..300).contains(&status) {
                    return Ok(answer["body"].clone());
                }
                // As the client reads an error: the body trimmed, else the
                // status text.
                let text = match &answer["body"] {
                    Value::String(text) => text.trim().to_string(),
                    Value::Null => String::new(),
                    other => other.to_string(),
                };
                let error = if text.is_empty() {
                    http::StatusCode::from_u16(status)
                        .ok()
                        .and_then(|code| code.canonical_reason())
                        .unwrap_or_default()
                        .to_string()
                } else {
                    text
                };
                Err(ClientError::Status { status, error })
            })
        }

        fn cluster_id(&self) -> &str {
            ID
        }
    }

    impl Report for Fixture {
        fn warning(&self, message: String) {
            self.update(ConnectionUpdate::warning(message));
        }
        fn error(&self, message: String) {
            self.update(ConnectionUpdate::error(message));
        }
        fn namespaces_forbidden(&self) {
            *self.forbidden.lock().unwrap() += 1;
        }
        fn log(&self, _: String) {}
    }

    impl Backend for Fixture {
        fn build(&self) -> BoxFuture<'_, Result<(), ClientError>> {
            Box::pin(async { Ok(()) })
        }
        fn uses_exec(&self) -> bool {
            self.cluster["exec"].as_bool().unwrap_or(false)
        }
        fn settings(&self) -> Settings {
            Settings {
                accessible_namespaces: serde_json::from_value(
                    self.cluster["accessibleNamespaces"].clone(),
                )
                .unwrap_or_default(),
                default_namespace: self.cluster["defaultNamespace"]
                    .as_str()
                    .map(str::to_string),
                skip_namespace_authorization_check: self.cluster["skipNamespaceAuthorizationCheck"]
                    .as_bool()
                    .unwrap_or(false),
            }
        }
        fn context_name(&self) -> String {
            self.text("contextName")
        }
        fn server(&self) -> String {
            self.text("server")
        }
        fn update(&self, update: ConnectionUpdate) {
            self.updates
                .lock()
                .unwrap()
                .push(serde_json::to_value(update).unwrap());
        }
        fn state_changed(&self, state: &ClusterState) {
            // Sent when it differs from the last one sent, as the state sync does.
            let mut states = self.states.lock().unwrap();
            if states.last().cloned().unwrap_or_default() != *state {
                states.push(state.clone());
            }
        }
        fn metadata(&self, metadata: Map<String, Value>, replace: bool) {
            let mut current = self.metadata.lock().unwrap();
            if replace {
                *current = metadata;
            } else {
                current.extend(metadata);
            }
        }
        fn disconnected(&self) {}
    }

    /// Lets every task that is ready run, without moving the paused clock.
    async fn settle() {
        for _ in 0..200 {
            tokio::task::yield_now().await;
        }
    }

    /// Runs a case on a runtime of its own with the clock paused.
    pub fn run(case: &Path) -> Vec<(&'static str, Value)> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_time()
            .start_paused(true)
            .build()
            .unwrap();
        runtime.block_on(async {
            let (fixture, steps) = Fixture::load(case);
            let fixture = std::sync::Arc::new(fixture);
            let connection = Connection::new(fixture.clone());
            for step in steps {
                match (step.as_str(), step["advance"].as_u64()) {
                    (Some("activate"), _) => connection.activate(false).await,
                    (Some("refreshAccessibility"), _) => {
                        connection.refresh_accessibility_and_metadata().await
                    }
                    (Some("networkOffline"), _) => connection.network_offline().await,
                    (Some("networkOnline"), _) => connection.network_online().await,
                    (Some("detectMetadata"), _) => fixture.detect_metadata().await,
                    (None, Some(ms)) => tokio::time::sleep(Duration::from_millis(ms)).await,
                    _ => panic!("unknown step {step}"),
                }
                settle().await;
            }
            let outcome = fixture.outcome();
            connection.disconnect();
            outcome
        })
    }

    pub fn cases() -> Vec<PathBuf> {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/cluster");
        let mut cases: Vec<PathBuf> = std::fs::read_dir(root)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.join("case.json").exists())
            .collect();
        cases.sort();
        cases
    }
}

#[test]
fn every_fixture_case_gives_what_the_electron_build_gives() {
    let cases = parity::cases();
    assert!(!cases.is_empty());
    let mut differences = Vec::new();
    for case in &cases {
        let name = case.file_name().unwrap().to_string_lossy().to_string();
        for (file, actual) in parity::run(case) {
            let path = case.join("expected").join(format!("{file}.json"));
            let expected: Option<Value> = std::fs::read_to_string(&path)
                .ok()
                .map(|text| serde_json::from_str(&text).unwrap());
            if expected.as_ref() != Some(&actual) {
                differences.push(format!(
                    "{name}/{file}.json\n  expected: {}\n  actual:   {actual}",
                    expected.map_or(
                        "(missing; run the Vitest parity test with UPDATE_TAURI_PARITY=1)".into(),
                        |value| value.to_string()
                    )
                ));
            }
        }
    }
    assert!(
        differences.is_empty(),
        "{} differences:\n{}",
        differences.len(),
        differences.join("\n")
    );
}
