/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The `/api-kube/` proxy of a cluster frame
//! (`specs/009-main-cluster-connection/contracts/api-kube.md`): the rules the
//! route and the watches share, as the Electron build's freelens-proxy has
//! them (`main/freelens-proxy/freelens-proxy.ts`).

use std::time::Duration;

use http::header::{HeaderMap, HeaderName, HeaderValue};
use http::{Method, Request, Response, StatusCode};
use http_body_util::BodyExt;
use serde_json::json;

use super::client::REQUEST_LIMIT;
use super::{ClientError, Clusters};
use crate::messaging::View;
use crate::routes::{Audience, DuplicateRoute, Routes};

/// The methods the route forwards: those the renderer's requests use.
const METHODS: [Method; 6] = [
    Method::GET,
    Method::HEAD,
    Method::POST,
    Method::PUT,
    Method::PATCH,
    Method::DELETE,
];

/// The prefix of the route of a cluster frame.
const ROUTE: &str = "/api-kube";

/// The request headers the API server never gets: the frame's own
/// credentials and origin, the hop-by-hop headers, and `Accept-Encoding`,
/// which freelens-k8s-proxy's transport handles itself
/// (`main/cluster/freelens-k8s-proxy-target.ts`).
const DROPPED_REQUEST_HEADERS: [&str; 12] = [
    "authorization",
    "cookie",
    "origin",
    "host",
    "connection",
    "keep-alive",
    "proxy-connection",
    "te",
    "transfer-encoding",
    "upgrade",
    "expect",
    "accept-encoding",
];

/// The response headers the frame never gets.
const DROPPED_RESPONSE_HEADERS: [&str; 4] = [
    "transfer-encoding",
    "connection",
    "keep-alive",
    "content-length",
];

/// Whether the path, before its query, is one the Electron build's proxy
/// forwards: it starts with `/` and the WHATWG URL parser keeps it as it is,
/// so no `.` or `..` segment, plain or percent-encoded, no backslash, no
/// absolute or scheme-relative form, and no character the parser would
/// encode (`isNormalizedRequestPath`).
pub fn is_normalized(path_and_query: &str) -> bool {
    let path = path_and_query
        .split_once('?')
        .map_or(path_and_query, |(path, _)| path);
    if !path.starts_with('/') || path.starts_with("//") {
        return false;
    }
    if path.chars().any(|c| {
        c == '\\' || c == '#' || !c.is_ascii() || c.is_ascii_control() || " \"<>`{}".contains(c)
    }) {
        return false;
    }
    !path.split('/').any(|segment| {
        let decoded = segment.to_ascii_lowercase().replace("%2e", ".");
        decoded == "." || decoded == ".."
    })
}

/// Whether a query makes the request a watch: `watch` or `follow` present and
/// not `false`, `f` or `0`, in any case (`isLongRunningRequest`).
pub fn is_watch(query: Option<&str>) -> bool {
    query
        .unwrap_or_default()
        .split('&')
        .filter_map(|pair| {
            let (name, value) = pair.split_once('=').unwrap_or((pair, ""));
            (name == "watch" || name == "follow").then_some(value)
        })
        .any(|value| !matches!(value.to_ascii_lowercase().as_str(), "false" | "f" | "0"))
}

/// The frame's request headers the API server gets.
pub fn forwarded_request_headers(headers: &HeaderMap) -> HeaderMap {
    let named_by_connection: Vec<String> = headers
        .get_all(http::header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(|name| name.trim().to_ascii_lowercase())
        .collect();
    headers
        .iter()
        .filter(|(name, _)| {
            let name = name.as_str();
            !DROPPED_REQUEST_HEADERS.contains(&name)
                && !named_by_connection.iter().any(|n| n == name)
        })
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect()
}

/// The API server's response headers the frame gets, with `Cache-Control:
/// no-store`.
pub fn forwarded_response_headers(headers: &HeaderMap) -> HeaderMap {
    let mut forwarded: HeaderMap = headers
        .iter()
        .filter(|(name, _)| !DROPPED_RESPONSE_HEADERS.contains(&name.as_str()))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    forwarded.insert(
        http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    forwarded
}

/// Headers as `[name, value]` pairs, for the watch channels.
pub fn header_pairs(headers: &HeaderMap) -> Vec<(String, String)> {
    headers
        .iter()
        .filter_map(|(name, value)| Some((name.to_string(), value.to_str().ok()?.to_string())))
        .collect()
}

/// `[name, value]` pairs as headers; a pair that is not a valid header is
/// left out.
pub fn header_map(pairs: &[(String, String)]) -> HeaderMap {
    pairs
        .iter()
        .filter_map(|(name, value)| {
            Some((
                HeaderName::from_bytes(name.as_bytes()).ok()?,
                HeaderValue::from_str(value).ok()?,
            ))
        })
        .collect()
}

/// The Kubernetes `Status` of a failure, as freelens-proxy writes it.
pub fn status_body(code: u16, reason: &str, message: &str) -> Vec<u8> {
    json!({
        "kind": "Status",
        "apiVersion": "v1",
        "metadata": {},
        "status": "Failure",
        "message": message,
        "reason": reason,
        "code": code,
    })
    .to_string()
    .into_bytes()
}

/// What the frame gets when the request cannot reach the API server: a status,
/// its content type and its body (contracts/api-kube.md, "Rules").
pub fn refusal(cluster_id: &str, error: &ClientError) -> (u16, &'static str, Vec<u8>) {
    match error {
        ClientError::NotInCatalog => (404, "text/plain", b"Not Found".to_vec()),
        ClientError::Disconnected => (
            503,
            "application/json",
            status_body(
                503,
                "ServiceUnavailable",
                &format!("Cluster {cluster_id} is not connected"),
            ),
        ),
        ClientError::Build(reason) => (
            503,
            "application/json",
            status_body(
                503,
                "ServiceUnavailable",
                &format!("Failed to start the proxy of cluster {cluster_id}: {reason}"),
            ),
        ),
        other => (
            500,
            "text/plain",
            format!("Oops, something went wrong.\n{other}").into_bytes(),
        ),
    }
}

/// The location of a redirect of the API server on the route of the
/// cluster, or `None` for one that leaves the API server, which is passed on
/// as it is (`toClusterRoute` of `main/freelens-proxy/cluster-route-redirect.ts`).
pub fn to_cluster_route(
    location: &str,
    request_path: &str,
    server: &str,
    route_prefix: &str,
) -> Option<String> {
    let api_url = url::Url::parse(server).ok()?;
    let server_path = api_url.path().trim_end_matches('/');
    let base = api_url.join(&format!("{server_path}{request_path}")).ok()?;
    let target = base.join(location).ok()?;
    if target.origin() != api_url.origin() {
        return None;
    }
    let path = target.path();
    if !server_path.is_empty()
        && path != server_path
        && !path.starts_with(&format!("{server_path}/"))
    {
        return None;
    }
    let below = &path[server_path.len()..];
    let below = if below.is_empty() { "/" } else { below };
    let query = target.query().map(|q| format!("?{q}")).unwrap_or_default();
    let fragment = target
        .fragment()
        .map(|f| format!("#{f}"))
        .unwrap_or_default();
    Some(format!("{route_prefix}{below}{query}{fragment}"))
}

/// Adds the `/api-kube/` routes of the cluster views (contracts/api-kube.md).
pub fn register(routes: &mut Routes, clusters: &Clusters) -> Result<(), DuplicateRoute> {
    register_with(routes, clusters, REQUEST_LIMIT)
}

/// `register` with another inactivity limit, for tests.
pub fn register_with(
    routes: &mut Routes,
    clusters: &Clusters,
    limit: Duration,
) -> Result<(), DuplicateRoute> {
    for method in METHODS {
        let clusters = clusters.clone();
        routes.add(
            method,
            "/api-kube/",
            Audience::Clusters,
            move |request, view, _| {
                let clusters = clusters.clone();
                Box::pin(async move { answer(&clusters, request, view, limit).await })
            },
        )?;
    }
    Ok(())
}

fn respond(status: u16, headers: HeaderMap, body: Vec<u8>) -> Response<Vec<u8>> {
    let mut response = Response::builder()
        .status(StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY))
        .body(body)
        .expect("a valid response");
    *response.headers_mut() = headers;
    response.headers_mut().insert(
        http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    response
}

fn plain(status: u16, content_type: &'static str, body: Vec<u8>) -> Response<Vec<u8>> {
    let mut headers = HeaderMap::new();
    headers.insert(
        http::header::CONTENT_TYPE,
        HeaderValue::from_static(content_type),
    );
    respond(status, headers, body)
}

/// One request of a cluster frame, sent to its own cluster.
async fn answer(
    clusters: &Clusters,
    request: Request<Vec<u8>>,
    view: View,
    limit: Duration,
) -> Response<Vec<u8>> {
    // The route's audience is the cluster views; the cluster is the host's.
    let View::Cluster(cluster) = view else {
        return plain(404, "text/plain", b"Not Found".to_vec());
    };
    let (parts, body) = request.into_parts();
    let path = parts.uri.path().strip_prefix(ROUTE).unwrap_or_default();
    let target = match parts.uri.query() {
        Some(query) => format!("{path}?{query}"),
        None => path.to_string(),
    };
    if !is_normalized(&target) {
        return plain(400, "text/plain", b"Bad Request".to_vec());
    }
    if is_watch(parts.uri.query()) {
        return plain(
            400,
            "application/json",
            status_body(
                400,
                "BadRequest",
                "a watch of /api-kube is carried by kube-watch:open",
            ),
        );
    }
    let client = match clusters.client(&cluster).await {
        Ok(client) => client,
        Err(error) => {
            let (status, kind, body) = refusal(&cluster, &error);
            return plain(status, kind, body);
        }
    };
    let mut outgoing = Request::builder()
        .method(parts.method.clone())
        .uri(target.as_str())
        .body(body)
        .expect("a normalized path is a valid URI");
    *outgoing.headers_mut() = forwarded_request_headers(&parts.headers);

    let response = match tokio::time::timeout(limit, client.send(outgoing)).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => {
            let (status, kind, body) = refusal(&cluster, &error);
            return plain(status, kind, body);
        }
        Err(_) => {
            let (status, kind, body) = refusal(&cluster, &ClientError::Timeout);
            return plain(status, kind, body);
        }
    };
    let status = response.status().as_u16();
    let mut headers = forwarded_response_headers(response.headers());
    if (300..400).contains(&status)
        && let Some(location) = headers
            .get(http::header::LOCATION)
            .and_then(|value| value.to_str().ok())
        && let Some(rewritten) = to_cluster_route(location, &target, client.server(), ROUTE)
        && let Ok(value) = HeaderValue::from_str(&rewritten)
    {
        headers.insert(http::header::LOCATION, value);
    }
    // The body in one piece; a body that fails or stays quiet past the limit
    // after the head ends with what came, as a response cut early.
    let mut body = response.into_body();
    let mut bytes = Vec::new();
    loop {
        let frame = tokio::select! {
            () = client.closed() => break,
            frame = tokio::time::timeout(limit, body.frame()) => frame,
        };
        let Ok(Some(Ok(frame))) = frame else {
            break;
        };
        if let Ok(data) = frame.into_data() {
            bytes.extend_from_slice(&data);
        }
    }
    if parts.method == Method::HEAD {
        bytes.clear();
    }
    respond(status, headers, bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    // pc/main/__test__/freelens-proxy.test.ts

    #[test]
    fn a_request_is_a_watch_unless_watch_and_follow_are_absent_or_false() {
        for query in [
            "watch=true",
            "watch=1",
            "watch",
            "watch=",
            "follow=1",
            "limit=1&watch=TRUE",
        ] {
            assert!(is_watch(Some(query)), "{query}");
        }
        for query in [
            "watch=false",
            "watch=0",
            "watch=f",
            "watch=F",
            "watch=FALSE",
            "follow=0",
            "limit=500",
            "watcher=1",
            "",
        ] {
            assert!(!is_watch(Some(query)), "{query}");
        }
        assert!(!is_watch(None));
    }

    // The 400 cases of "protocols" in pc/main/freelens-proxy/freelens-proxy.test.ts

    #[test]
    fn a_path_that_is_not_normalized_is_refused() {
        for path in [
            "/./api",
            "/%2e/api",
            "/%2E%2E/api",
            "/x/../api",
            "\\api",
            "/api\\v1",
            "//evil/api",
            "http://example.com/api",
            "api/v1",
            "/api v1",
            "",
        ] {
            assert!(!is_normalized(path), "{path}");
        }
        for path in [
            "/api/v1/namespaces",
            "/apis/apps/v1/deployments?limit=500",
            "/version",
            "/api/v1/pods?fieldSelector=a.b%3Dc&labelSelector=x/y",
            "/",
            "/api/v1/namespaces/a.b",
        ] {
            assert!(is_normalized(path), "{path}");
        }
    }

    #[test]
    fn the_frame_s_credentials_and_hop_by_hop_headers_do_not_reach_the_server() {
        let mut headers = HeaderMap::new();
        for (name, value) in [
            ("authorization", "Bearer from-the-view"),
            ("cookie", "a=b"),
            ("origin", "freelens-app://x.renderer.freelens.app"),
            ("host", "x.renderer.freelens.app"),
            ("connection", "keep-alive, x-private"),
            ("x-private", "1"),
            ("keep-alive", "timeout=5"),
            ("proxy-connection", "keep-alive"),
            ("te", "trailers"),
            ("transfer-encoding", "chunked"),
            ("upgrade", "websocket"),
            ("expect", "100-continue"),
            ("accept-encoding", "gzip"),
            ("accept", "application/json;as=Table"),
            ("content-type", "application/merge-patch+json"),
            ("user-agent", "WebKit"),
            ("x-custom", "y"),
        ] {
            headers.append(
                HeaderName::from_static(name),
                HeaderValue::from_static(value),
            );
        }
        let forwarded = forwarded_request_headers(&headers);
        let names: Vec<&str> = forwarded.keys().map(HeaderName::as_str).collect();
        assert_eq!(names, ["accept", "content-type", "user-agent", "x-custom"]);
    }

    #[test]
    fn the_frame_gets_no_store_and_no_hop_by_hop_header() {
        let mut headers = HeaderMap::new();
        headers.insert(
            "cache-control",
            HeaderValue::from_static("no-cache, private"),
        );
        headers.insert("transfer-encoding", HeaderValue::from_static("chunked"));
        headers.insert("connection", HeaderValue::from_static("close"));
        headers.insert("content-type", HeaderValue::from_static("application/json"));
        let forwarded = forwarded_response_headers(&headers);
        assert_eq!(forwarded["cache-control"], "no-store");
        assert_eq!(forwarded["content-type"], "application/json");
        assert!(!forwarded.contains_key("transfer-encoding"));
        assert!(!forwarded.contains_key("connection"));
    }

    #[test]
    fn the_refusals_are_the_electron_build_s() {
        let (status, kind, body) = refusal("abc", &ClientError::Disconnected);
        assert_eq!((status, kind), (503, "application/json"));
        assert_eq!(
            String::from_utf8(body).unwrap(),
            r#"{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"Cluster abc is not connected","reason":"ServiceUnavailable","code":503}"#
        );
        let (status, _, body) = refusal("abc", &ClientError::Build("no context".into()));
        assert_eq!(status, 503);
        assert!(
            String::from_utf8(body)
                .unwrap()
                .contains("Failed to start the proxy of cluster abc: no context")
        );
        let (status, kind, body) =
            refusal("abc", &ClientError::Connect("connection refused".into()));
        assert_eq!((status, kind), (500, "text/plain"));
        assert_eq!(body, b"Oops, something went wrong.\nconnection refused");
    }

    // pc/main/freelens-proxy/cluster-route-redirect.test.ts

    const ROOT: &str = "https://some-api-server:6443";
    const RANCHER: &str = "https://some-rancher/k8s/clusters/local";

    #[test]
    fn a_redirect_of_api_to_api_slash_goes_on_the_route_of_a_renderer() {
        assert_eq!(
            to_cluster_route("/api/", "/api", ROOT, "/api-kube").as_deref(),
            Some("/api-kube/api/")
        );
    }

    #[test]
    fn it_goes_on_the_route_of_the_main_process() {
        assert_eq!(
            to_cluster_route("/api/", "/api", ROOT, "/some-cluster-id").as_deref(),
            Some("/some-cluster-id/api/")
        );
    }

    #[test]
    fn the_query_is_kept() {
        assert_eq!(
            to_cluster_route("/api/?timeout=32s", "/api?timeout=32s", ROOT, "/api-kube").as_deref(),
            Some("/api-kube/api/?timeout=32s")
        );
    }

    #[test]
    fn a_location_relative_to_the_request_path_is_resolved() {
        assert_eq!(
            to_cluster_route(
                "pods/",
                "/api/v1/namespaces/default/pods",
                ROOT,
                "/api-kube"
            )
            .as_deref(),
            Some("/api-kube/api/v1/namespaces/default/pods/")
        );
    }

    #[test]
    fn a_location_with_the_url_of_the_api_server_goes_on_the_route() {
        assert_eq!(
            to_cluster_route(
                "https://some-api-server:6443/apis/",
                "/apis",
                ROOT,
                "/api-kube"
            )
            .as_deref(),
            Some("/api-kube/apis/")
        );
    }

    #[test]
    fn a_redirect_to_another_host_or_port_or_unreadable_is_left_alone() {
        for location in [
            "https://some-login-page/sign-in",
            "https://some-api-server:8443/api/",
            "https://[not-a-host",
        ] {
            assert_eq!(
                to_cluster_route(location, "/api", ROOT, "/api-kube"),
                None,
                "{location}"
            );
        }
    }

    #[test]
    fn below_the_path_of_a_rancher_server() {
        assert_eq!(
            to_cluster_route("/k8s/clusters/local/api/", "/api", RANCHER, "/api-kube").as_deref(),
            Some("/api-kube/api/")
        );
        assert_eq!(
            to_cluster_route("api/", "/api", RANCHER, "/api-kube").as_deref(),
            Some("/api-kube/api/")
        );
        assert_eq!(
            to_cluster_route("/k8s/clusters/local", "/", RANCHER, "/api-kube").as_deref(),
            Some("/api-kube/")
        );
        assert_eq!(
            to_cluster_route("/dashboard/", "/api", RANCHER, "/api-kube"),
            None
        );
        assert_eq!(
            to_cluster_route(
                "/k8s/clusters/local-other/api/",
                "/api",
                RANCHER,
                "/api-kube"
            ),
            None
        );
    }

    #[test]
    fn a_server_given_with_a_trailing_slash() {
        assert_eq!(
            to_cluster_route(
                "/k8s/clusters/local/api/",
                "/api",
                "https://some-rancher/k8s/clusters/local/",
                "/api-kube"
            )
            .as_deref(),
            Some("/api-kube/api/")
        );
    }
}
