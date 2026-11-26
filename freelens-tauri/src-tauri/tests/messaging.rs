/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The `/ipc/` routes of `specs/002-messaging-for-tauri/contracts/ipc-routes.md`,
//! driven with the channels the core registers at startup.

use std::path::Path;
use std::sync::{Arc, Mutex};

use freelens_tauri::catalog::Catalog;
use freelens_tauri::messaging::{Log, Messaging, routes};
use freelens_tauri::register_channels;
use http::{Method, Request, Response, StatusCode, header};
use serde_json::{Value, json};

const MAIN: &str = "freelens-app://renderer.freelens.app";

struct Fixture {
    catalog: Catalog,
    messaging: Messaging,
    lines: Arc<Mutex<Vec<String>>>,
}

fn fixture_file() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/three-contexts.yaml")
}

fn fixture() -> Fixture {
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let log: Log = Arc::new(move |line| sink.lock().unwrap().push(line.to_string()));
    Fixture {
        catalog: Catalog::from_kubeconfig_file(&fixture_file()),
        messaging: register_channels(true, "0.1.0".into(), &log).unwrap(),
        lines,
    }
}

fn cluster_origin(fixture: &Fixture, index: usize) -> String {
    format!(
        "freelens-app://{}.renderer.freelens.app",
        fixture.catalog.cluster_ids()[index]
    )
}

fn request(
    method: Method,
    origin_of_host: &str,
    path: &str,
    origin: Option<&str>,
    content_type: Option<&str>,
    body: Vec<u8>,
) -> Request<Vec<u8>> {
    let mut builder = Request::builder()
        .method(method)
        .uri(format!("{origin_of_host}{path}"));
    if let Some(origin) = origin {
        builder = builder.header(header::ORIGIN, origin);
    }
    if let Some(content_type) = content_type {
        builder = builder.header(header::CONTENT_TYPE, content_type);
    }
    builder.body(body).unwrap()
}

/// A well-formed POST of a view to its own host.
async fn post(fixture: &Fixture, host: &str, path: &str, body: Value) -> Response<Vec<u8>> {
    let request = request(
        Method::POST,
        host,
        path,
        Some(host),
        Some("application/json"),
        body.to_string().into_bytes(),
    );
    routes::handle(request, &fixture.catalog, &fixture.messaging).await
}

fn json_of(response: &Response<Vec<u8>>) -> Value {
    serde_json::from_slice(response.body()).unwrap()
}

#[tokio::test]
async fn each_check_answers_its_status_in_order() {
    let fixture = fixture();
    let body = br#"{"channel":"build-version"}"#.to_vec();
    let cases = [
        (
            request(
                Method::POST,
                "freelens-app://nowhere.renderer.freelens.app",
                "/ipc/request",
                Some(MAIN),
                Some("application/json"),
                body.clone(),
            ),
            StatusCode::NOT_FOUND,
        ),
        (
            request(
                Method::GET,
                MAIN,
                "/ipc/request",
                Some(MAIN),
                Some("application/json"),
                body.clone(),
            ),
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        // The CORS preflight another host's page would need: never granted.
        (
            request(
                Method::OPTIONS,
                MAIN,
                "/ipc/request",
                Some(&cluster_origin(&fixture, 0)),
                None,
                Vec::new(),
            ),
            StatusCode::METHOD_NOT_ALLOWED,
        ),
        // A post that needs no preflight (a form, or `no-cors`) cannot be JSON.
        (
            request(
                Method::POST,
                MAIN,
                "/ipc/request",
                None,
                Some("text/plain"),
                body.clone(),
            ),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (
            request(
                Method::POST,
                MAIN,
                "/ipc/request",
                Some(&cluster_origin(&fixture, 0)),
                Some("application/json"),
                body.clone(),
            ),
            StatusCode::FORBIDDEN,
        ),
        (
            request(
                Method::POST,
                MAIN,
                "/ipc/request",
                Some(MAIN),
                Some("text/plain"),
                body.clone(),
            ),
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
        ),
        (
            request(
                Method::POST,
                MAIN,
                "/ipc/request",
                Some(MAIN),
                Some("application/json"),
                vec![b' '; routes::BODY_LIMIT + 1],
            ),
            StatusCode::PAYLOAD_TOO_LARGE,
        ),
        (
            request(
                Method::POST,
                MAIN,
                "/ipc/request",
                Some(MAIN),
                Some("application/json"),
                b"not json".to_vec(),
            ),
            StatusCode::BAD_REQUEST,
        ),
        (
            request(
                Method::POST,
                MAIN,
                "/ipc/other",
                Some(MAIN),
                Some("application/json"),
                body.clone(),
            ),
            StatusCode::NOT_FOUND,
        ),
    ];
    for (request, status) in cases {
        let path = request.uri().to_string();
        let response = routes::handle(request, &fixture.catalog, &fixture.messaging).await;
        assert_eq!(response.status(), status, "{path}");
        assert!(
            response
                .headers()
                .get(header::ACCESS_CONTROL_ALLOW_ORIGIN)
                .is_none()
        );
    }
}

#[tokio::test]
async fn a_post_without_origin_to_its_own_host_is_answered() {
    // WebKit sends no Origin when a page posts to its own host on a custom scheme.
    let fixture = fixture();
    let request = request(
        Method::POST,
        MAIN,
        "/ipc/request",
        None,
        Some("application/json"),
        br#"{"channel":"build-version"}"#.to_vec(),
    );

    let response = routes::handle(request, &fixture.catalog, &fixture.messaging).await;

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn a_cluster_frame_cannot_post_to_another_host() {
    let fixture = fixture();
    let other = cluster_origin(&fixture, 1);
    let request = request(
        Method::POST,
        &cluster_origin(&fixture, 0),
        "/ipc/messages",
        Some(&other),
        Some("application/json"),
        br#"{"messages":[{"channel":"frame-communication-admin-channel"}]}"#.to_vec(),
    );

    let response = routes::handle(request, &fixture.catalog, &fixture.messaging).await;

    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(fixture.lines.lock().unwrap().is_empty());
}

#[tokio::test]
async fn requests_answer_with_the_statuses_of_the_contract() {
    let fixture = fixture();

    let version = post(
        &fixture,
        MAIN,
        "/ipc/request",
        json!({ "channel": "build-version" }),
    )
    .await;
    assert_eq!(version.status(), StatusCode::OK);
    assert_eq!(json_of(&version), json!({ "payload": "0.1.0" }));

    let missing = post(
        &fixture,
        MAIN,
        "/ipc/request",
        json!({ "channel": "missing" }),
    )
    .await;
    assert_eq!(missing.status(), StatusCode::NOT_FOUND);
    assert_eq!(
        json_of(&missing),
        json!({ "error": { "message": "No handler registered for 'missing'" } })
    );

    let unparsed = post(
        &fixture,
        MAIN,
        "/ipc/request",
        json!({ "channel": "messaging-check:echo", "payload": 5 }),
    )
    .await;
    assert_eq!(unparsed.status(), StatusCode::BAD_REQUEST);
    assert!(
        json_of(&unparsed)["error"]["message"]
            .as_str()
            .unwrap()
            .starts_with("Invalid request for 'messaging-check:echo'")
    );

    let failing = post(
        &fixture,
        MAIN,
        "/ipc/request",
        json!({ "channel": "broadcast-to-views", "payload": {} }),
    )
    .await;
    assert_eq!(failing.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(
        json_of(&failing),
        json!({ "error": { "message": "the broadcast names no channel" } })
    );

    let relayed = post(
        &fixture,
        MAIN,
        "/ipc/request",
        json!({ "channel": "broadcast-to-views", "payload": { "channel": "x" } }),
    )
    .await;
    assert_eq!(relayed.status(), StatusCode::OK);
    assert_eq!(json_of(&relayed), json!({}));
}

#[tokio::test]
async fn a_batch_reaches_the_listeners_in_order_with_the_sending_view() {
    let fixture = fixture();
    let cluster = cluster_origin(&fixture, 0);
    let id = &fixture.catalog.cluster_ids()[0];

    let response = post(
        &fixture,
        &cluster,
        "/ipc/messages",
        json!({ "messages": [
            { "channel": "frame-communication-admin-channel" },
            { "channel": "messaging-check:report", "payload": { "kind": "round", "round": 1, "failed": null } },
            { "channel": "nobody-listens", "payload": 1 },
            { "channel": "messaging-check:report", "payload": { "kind": "done" } },
        ] }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        *fixture.lines.lock().unwrap(),
        [
            format!("Messaging: cluster {id} announced"),
            format!("Messaging check: cluster {id} round 1 passed"),
            format!("Messaging check: cluster {id} done, 1 of 20 rounds passed"),
        ]
    );
}

#[tokio::test]
async fn an_empty_or_unnamed_batch_is_refused() {
    let fixture = fixture();
    for body in [
        json!({ "messages": [] }),
        json!({ "messages": [{ "payload": 1 }] }),
        json!({}),
    ] {
        let response = post(&fixture, MAIN, "/ipc/messages", body).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

#[tokio::test(start_paused = true)]
async fn the_relay_reaches_every_open_view_once() {
    let fixture = Arc::new(fixture());
    let cluster = cluster_origin(&fixture, 0);
    let main_poll = |after: u64| json!({ "session": "main-session", "after": after });

    // Open both queues with a first poll each, answered empty after the hold.
    assert_eq!(
        json_of(&post(&fixture, MAIN, "/ipc/poll", main_poll(0)).await),
        json!({ "messages": [] })
    );
    post(
        &fixture,
        &cluster,
        "/ipc/poll",
        json!({ "session": "cluster-session", "after": 0 }),
    )
    .await;

    let waiting = tokio::spawn({
        let fixture = Arc::clone(&fixture);
        async move { json_of(&post(&fixture, MAIN, "/ipc/poll", main_poll(0)).await) }
    });
    tokio::task::yield_now().await;

    post(
        &fixture,
        &cluster,
        "/ipc/request",
        json!({ "channel": "broadcast-to-views", "payload": { "channel": "renderer:navigate", "message": "/x" } }),
    )
    .await;

    let expected =
        json!({ "messages": [{ "seq": 1, "channel": "renderer:navigate", "payload": "/x" }] });
    assert_eq!(waiting.await.unwrap(), expected);
    assert_eq!(
        json_of(
            &post(
                &fixture,
                &cluster,
                "/ipc/poll",
                json!({ "session": "cluster-session", "after": 0 })
            )
            .await
        ),
        expected
    );
    // Acknowledged, so not answered again.
    assert_eq!(
        json_of(&post(&fixture, MAIN, "/ipc/poll", main_poll(1)).await),
        json!({ "messages": [] })
    );
}

#[tokio::test(start_paused = true)]
async fn a_poll_with_no_valid_session_or_after_is_refused() {
    let fixture = fixture();
    for body in [
        json!({ "after": 0 }),
        json!({ "session": "", "after": 0 }),
        json!({ "session": "a b", "after": 0 }),
        json!({ "session": "x".repeat(65), "after": 0 }),
        json!({ "session": "ok", "after": -1 }),
    ] {
        let response = post(&fixture, MAIN, "/ipc/poll", body).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    }
}

/// The certificate, key and token values of the fixture.
fn fixture_secrets() -> Vec<String> {
    std::fs::read_to_string(fixture_file())
        .unwrap()
        .lines()
        .filter_map(|line| {
            let (key, value) = line.trim().split_once(": ")?;
            matches!(
                key,
                "token" | "client-certificate-data" | "client-key-data" | "password"
            )
            .then(|| value.trim().to_string())
        })
        .collect()
}

#[tokio::test(start_paused = true)]
async fn no_credentials_in_ipc_answers() {
    let secrets = fixture_secrets();
    assert!(
        secrets.len() >= 3,
        "the fixture holds credentials to look for"
    );
    let fixture = Arc::new(fixture());
    let mut bodies = Vec::new();

    post(
        &fixture,
        MAIN,
        "/ipc/poll",
        json!({ "session": "s", "after": 0 }),
    )
    .await;
    for (channel, payload) in [
        ("build-version", json!(null)),
        ("messaging-check:echo", json!({ "text": "ping" })),
        (
            "broadcast-to-views",
            json!({ "channel": "renderer:navigate", "message": "/x" }),
        ),
        ("missing", json!(null)),
    ] {
        let response = post(
            &fixture,
            MAIN,
            "/ipc/request",
            json!({ "channel": channel, "payload": payload }),
        )
        .await;
        bodies.push(String::from_utf8(response.into_body()).unwrap());
    }
    let polled = post(
        &fixture,
        MAIN,
        "/ipc/poll",
        json!({ "session": "s", "after": 0 }),
    )
    .await;
    bodies.push(String::from_utf8(polled.into_body()).unwrap());

    for body in &bodies {
        for secret in &secrets {
            assert!(
                !body.contains(secret.as_str()),
                "{body} holds a credential of the fixture"
            );
        }
    }
}
