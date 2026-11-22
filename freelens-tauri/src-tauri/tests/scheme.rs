/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The routes, origin rules and log lines of
//! `specs/001-tauri-shell-spike/contracts/scheme-routes.md`.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use freelens_tauri::catalog::{Catalog, CatalogEntry};
use freelens_tauri::clusters::{ApiOutcome, BoxFuture, ClusterApi};
use freelens_tauri::options::KubeconfigChoice;
use freelens_tauri::scheme::{Asset, State, handle};
use http::{Method, Request, Response, StatusCode, header};

const MAIN: &str = "freelens-app://renderer.freelens.app";

type Calls = Arc<Mutex<Vec<(String, String)>>>;

struct Fixture {
    state: State,
    lines: Arc<Mutex<Vec<String>>>,
    calls: Calls,
}

/// Answers every request with `outcome` and records what it was asked.
struct FakeClusters {
    outcome: ApiOutcome,
    calls: Calls,
}

impl ClusterApi for FakeClusters {
    fn get<'a>(
        &'a self,
        entry: &'a CatalogEntry,
        path_and_query: &'a str,
    ) -> BoxFuture<'a, ApiOutcome> {
        self.calls
            .lock()
            .unwrap()
            .push((entry.id.clone(), path_and_query.to_string()));
        let outcome = self.outcome.clone();
        Box::pin(async move { outcome })
    }
}

fn namespaces() -> ApiOutcome {
    ApiOutcome::Response {
        status: 200,
        body: br#"{"kind":"NamespaceList","items":[{"metadata":{"name":"default"}}]}"#.to_vec(),
    }
}

fn fixture() -> Fixture {
    fixture_with(namespaces())
}

fn fixture_with(outcome: ApiOutcome) -> Fixture {
    let path: PathBuf =
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/three-contexts.yaml");
    let lines = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&lines);
    let calls: Calls = Arc::new(Mutex::new(Vec::new()));
    let state = State {
        catalog: Catalog::load(&KubeconfigChoice::File(path), None),
        clusters: Box::new(FakeClusters {
            outcome,
            calls: Arc::clone(&calls),
        }),
        log: Box::new(move |line| sink.lock().unwrap().push(line.to_string())),
    };
    Fixture {
        state,
        lines,
        calls,
    }
}

fn assets(path: &str) -> Option<Asset> {
    let mime = match path {
        "index.html" | "cluster.html" => "text/html",
        "assets/app.js" => "text/javascript",
        _ => return None,
    };
    Some(Asset {
        bytes: path.as_bytes().to_vec(),
        mime: mime.to_string(),
    })
}

fn cluster_host(fixture: &Fixture, index: usize) -> String {
    format!(
        "freelens-app://{}.renderer.freelens.app",
        fixture.state.catalog.entries[index].id
    )
}

async fn send(
    fixture: &Fixture,
    method: Method,
    url: &str,
    origin: Option<&str>,
) -> Response<Vec<u8>> {
    let mut request = Request::builder().method(method).uri(url);
    if let Some(origin) = origin {
        request = request.header(header::ORIGIN, origin);
    }
    handle(request.body(Vec::new()).unwrap(), &fixture.state, &assets).await
}

async fn get(fixture: &Fixture, url: &str) -> Response<Vec<u8>> {
    send(fixture, Method::GET, url, None).await
}

fn body(response: &Response<Vec<u8>>) -> String {
    String::from_utf8(response.body().clone()).unwrap()
}

fn csp(response: &Response<Vec<u8>>) -> &str {
    response.headers()[header::CONTENT_SECURITY_POLICY]
        .to_str()
        .unwrap()
}

#[tokio::test]
async fn the_main_host_serves_the_catalog_page() {
    let f = fixture();
    let response = get(&f, &format!("{MAIN}/")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(&response), "index.html");
    assert_eq!(
        csp(&response),
        "default-src 'self'; frame-src freelens-app:"
    );
}

#[tokio::test]
async fn a_cluster_host_serves_the_cluster_page() {
    let f = fixture();
    let response = get(&f, &format!("{}/", cluster_host(&f, 1))).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(body(&response), "cluster.html");
    assert_eq!(
        csp(&response),
        "default-src 'self'; frame-ancestors freelens-app://renderer.freelens.app"
    );
}

#[tokio::test]
async fn assets_are_served_on_both_hosts() {
    let f = fixture();
    for host in [MAIN.to_string(), cluster_host(&f, 0)] {
        let response = get(&f, &format!("{host}/assets/app.js")).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers()[header::CONTENT_TYPE], "text/javascript");
        assert_eq!(
            get(&f, &format!("{host}/assets/missing.js")).await.status(),
            StatusCode::NOT_FOUND
        );
        assert_eq!(
            get(&f, &format!("{host}/assets/../index.html"))
                .await
                .status(),
            StatusCode::NOT_FOUND
        );
    }
}

#[tokio::test]
async fn unknown_hosts_and_unknown_cluster_ids_get_404_everywhere() {
    let f = fixture();
    for host in [
        "freelens-app://example.com",
        "freelens-app://0123456789abcdef0123456789abcdef.renderer.freelens.app",
        "freelens-app://evil.example.com.renderer.freelens.app",
    ] {
        for path in ["/", "/assets/app.js", "/api/clusters", "/api/mark?name=x"] {
            let response = get(&f, &format!("{host}{path}")).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND, "{host}{path}");
        }
    }
}

#[tokio::test]
async fn the_catalog_is_served_on_the_main_host_only() {
    let f = fixture();
    let response = get(&f, &format!("{MAIN}/api/clusters")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    let json: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(json["message"], serde_json::Value::Null);
    assert_eq!(json["openOnLoad"], serde_json::Value::Null);
    assert!(
        json["source"]
            .as_str()
            .unwrap()
            .ends_with("three-contexts.yaml")
    );
    let names: Vec<&str> = json["clusters"]
        .as_array()
        .unwrap()
        .iter()
        .map(|cluster| cluster["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["context-a", "context-b", "context-c"]);
    assert_eq!(
        json["clusters"][0]["id"],
        f.state.catalog.entries[0].id.as_str()
    );
    assert_eq!(json["clusters"][0].as_object().unwrap().len(), 2);

    let response = get(&f, &format!("{}/api/clusters", cluster_host(&f, 0))).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_catalog_holds_no_credential_or_server_address() {
    let f = fixture();
    let text = body(&get(&f, &format!("{MAIN}/api/clusters")).await);
    for secret in [
        "FAKE-TOKEN",
        "RkFLRS1DRVJU",
        "RkFLRS1LRVk",
        "127.0.0.1:1",
        "token-user",
        "cert-user",
    ] {
        assert!(!text.contains(secret), "{secret} in {text}");
    }
}

#[tokio::test]
async fn kube_requests_pass_status_and_body_through() {
    let f = fixture();
    let url = format!(
        "{}/api-kube/api/v1/namespaces?limit=500",
        cluster_host(&f, 1)
    );
    let response = get(&f, &url).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()[header::CONTENT_TYPE], "application/json");
    assert!(body(&response).contains("NamespaceList"));
    assert_eq!(
        *f.calls.lock().unwrap(),
        [(
            f.state.catalog.entries[1].id.clone(),
            "/api/v1/namespaces?limit=500".to_string()
        )]
    );
}

#[tokio::test]
async fn kube_paths_must_start_with_api_or_apis() {
    let f = fixture();
    let host = cluster_host(&f, 0);
    for path in [
        "/api-kube/",
        "/api-kube/version",
        "/api-kube/healthz",
        "/api-kube/api/../version",
    ] {
        let response = get(&f, &format!("{host}{path}")).await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND, "{path}");
    }
    assert!(f.calls.lock().unwrap().is_empty());

    let response = get(&f, &format!("{host}/api-kube/apis/apps/v1/deployments")).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(f.calls.lock().unwrap()[0].1, "/apis/apps/v1/deployments");
}

#[tokio::test]
async fn kube_watches_are_refused() {
    let f = fixture();
    let host = cluster_host(&f, 0);
    for query in ["watch=1", "watch=true", "limit=1&watch=0", "watch"] {
        let response = get(&f, &format!("{host}/api-kube/api/v1/namespaces?{query}")).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
    }
    assert!(f.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn kube_requests_are_not_served_on_the_main_host() {
    let f = fixture();
    let response = get(&f, &format!("{MAIN}/api-kube/api/v1/namespaces")).await;
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    assert!(f.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn kube_requests_accept_get_only() {
    let f = fixture();
    let url = format!("{}/api-kube/api/v1/namespaces", cluster_host(&f, 0));
    for method in [Method::POST, Method::DELETE, Method::PATCH] {
        let response = send(&f, method.clone(), &url, None).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
    }
    assert!(f.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unreachable_cluster_gives_502_with_json() {
    let f = fixture_with(ApiOutcome::Unreachable);
    let url = format!("{}/api-kube/api/v1/namespaces", cluster_host(&f, 0));
    let response = get(&f, &url).await;
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    let json: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
    assert_eq!(json["error"], "unreachable");
    assert!(json["message"].as_str().is_some());
}

#[tokio::test]
async fn an_error_status_of_the_api_server_passes_through() {
    let f = fixture_with(ApiOutcome::Response {
        status: 403,
        body: br#"{"kind":"Status","code":403}"#.to_vec(),
    });
    let url = format!("{}/api-kube/api/v1/namespaces", cluster_host(&f, 0));
    let response = get(&f, &url).await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    assert!(body(&response).contains("\"code\":403"));
}

#[tokio::test]
async fn view_headers_are_not_forwarded_and_no_credential_comes_back() {
    let f = fixture();
    let url = format!("{}/api-kube/api/v1/namespaces", cluster_host(&f, 0));
    let request = Request::builder()
        .uri(&url)
        .header(header::AUTHORIZATION, "Bearer from-the-view")
        .header(header::COOKIE, "a=b")
        .body(Vec::new())
        .unwrap();
    let response = handle(request, &f.state, &assets).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(f.calls.lock().unwrap()[0].1, "/api/v1/namespaces");
    assert!(!response.headers().contains_key(header::AUTHORIZATION));
    assert!(!response.headers().contains_key(header::SET_COOKIE));

    for outcome in [
        namespaces(),
        ApiOutcome::Unreachable,
        ApiOutcome::Response {
            status: 403,
            body: Vec::new(),
        },
    ] {
        let f = fixture_with(outcome);
        // Every fixture reads the same file, so the cluster ids are the same.
        let text = body(&get(&f, &url).await);
        for secret in ["FAKE-TOKEN", "RkFLRS1DRVJU", "RkFLRS1LRVk", "from-the-view"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
    }
}

#[tokio::test]
async fn a_valid_mark_is_logged_on_both_hosts() {
    let f = fixture();
    let response = get(&f, &format!("{MAIN}/api/mark?name=catalog-shown")).await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    let response = get(
        &f,
        &format!("{}/api/mark?name=namespaces-shown", cluster_host(&f, 2)),
    )
    .await;
    assert_eq!(response.status(), StatusCode::NO_CONTENT);
    assert_eq!(
        *f.lines.lock().unwrap(),
        ["Mark \"catalog-shown\"", "Mark \"namespaces-shown\""]
    );
}

#[tokio::test]
async fn an_invalid_mark_is_refused_and_not_logged() {
    let f = fixture();
    let too_long = "a".repeat(41);
    for query in ["", "?name=", "?name=Upper", "?name=a%20b", "?other=x"] {
        let response = get(&f, &format!("{MAIN}/api/mark{query}")).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{query}");
    }
    let response = get(&f, &format!("{MAIN}/api/mark?name={too_long}")).await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert!(f.lines.lock().unwrap().is_empty());
}

#[tokio::test]
async fn methods_other_than_get_are_refused() {
    let f = fixture();
    for method in [
        Method::POST,
        Method::PUT,
        Method::DELETE,
        Method::OPTIONS,
        Method::HEAD,
    ] {
        let response = send(&f, method.clone(), &format!("{MAIN}/api/clusters"), None).await;
        assert_eq!(
            response.status(),
            StatusCode::METHOD_NOT_ALLOWED,
            "{method}"
        );
    }
}

#[tokio::test]
async fn a_foreign_origin_is_refused_and_the_own_origin_accepted() {
    let f = fixture();
    let cluster = cluster_host(&f, 0);
    let other_cluster = cluster_host(&f, 1);

    let response = send(
        &f,
        Method::GET,
        &format!("{MAIN}/api/clusters"),
        Some(&cluster),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = send(
        &f,
        Method::GET,
        &format!("{other_cluster}/"),
        Some(&cluster),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);
    let response = send(
        &f,
        Method::GET,
        &format!("{MAIN}/api/clusters"),
        Some("null"),
    )
    .await;
    assert_eq!(response.status(), StatusCode::FORBIDDEN);

    let response = send(&f, Method::GET, &format!("{MAIN}/api/clusters"), Some(MAIN)).await;
    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn no_response_carries_cors_headers() {
    let f = fixture();
    let cluster = cluster_host(&f, 0);
    let urls = [
        format!("{MAIN}/"),
        format!("{MAIN}/api/clusters"),
        format!("{MAIN}/assets/app.js"),
        format!("{cluster}/"),
        format!("{cluster}/api/mark?name=x"),
    ];
    for url in &urls {
        for origin in [None, Some(MAIN), Some(cluster.as_str())] {
            let response = send(&f, Method::GET, url, origin).await;
            assert!(
                !response
                    .headers()
                    .keys()
                    .any(|name| name.as_str().starts_with("access-control-")),
                "{url}"
            );
        }
    }
}

#[tokio::test]
async fn other_paths_get_404() {
    let f = fixture();
    for path in ["/index.html", "/api", "/api/other", "/build/index.html"] {
        assert_eq!(
            get(&f, &format!("{MAIN}{path}")).await.status(),
            StatusCode::NOT_FOUND,
            "{path}"
        );
    }
}
