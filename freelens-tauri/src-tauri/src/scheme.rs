/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The `freelens-app` scheme, the only channel between the views and the core
//! (`specs/001-tauri-shell-spike/contracts/scheme-routes.md`), and its routes,
//! rows of the table of `specs/004-cluster-frames/contracts/routes.md`.

use std::sync::LazyLock;

use http::{Method, Request, Response, StatusCode, header};
use serde_json::json;

use crate::catalog::{Catalog, CatalogEntry};
use crate::clusters::{ApiOutcome, ClusterApi};
use crate::messaging::View;
use crate::routes::{Audience, Env, Routes};

pub const SCHEME: &str = "freelens-app";
pub const MAIN_HOST: &str = "renderer.freelens.app";

// The catalog page is never shown in a frame, and the frame page only in the
// main window's page (FR-025, research R12).
const MAIN_CSP: &str = "default-src 'self'; frame-src freelens-app:; frame-ancestors 'none'";
const CLUSTER_CSP: &str =
    "default-src 'self'; frame-ancestors freelens-app://renderer.freelens.app";

/// A file of the built UI.
pub struct Asset {
    pub bytes: Vec<u8>,
    pub mime: String,
}

pub struct State {
    pub catalog: Catalog,
    /// Sends the `/api-kube` requests of the cluster frames.
    pub clusters: Box<dyn ClusterApi>,
    /// The context of `--open-cluster`, opened once the catalog is shown.
    pub open_cluster: Option<String>,
    /// Prints a log line of `contracts/log-lines.md`.
    pub log: Box<dyn Fn(&str) + Send + Sync>,
}

/// The routes of the scheme's own pages, files and data; the core adds the
/// routes of its other areas to this table at startup.
pub fn routes() -> Routes {
    let mut routes = Routes::default();
    let rows = [
        routes.add(Method::GET, "/", Audience::Main, |_, _, env| {
            Box::pin(async move { page(env.assets, "index.html", MAIN_CSP) })
        }),
        routes.add(Method::GET, "/", Audience::Clusters, |_, _, env| {
            Box::pin(async move { page(env.assets, "cluster.html", CLUSTER_CSP) })
        }),
        routes.add(
            Method::GET,
            "/assets/",
            Audience::Both,
            |request, _, env| {
                Box::pin(async move {
                    let path = request.uri().path();
                    if path.contains("..") {
                        return empty(StatusCode::NOT_FOUND);
                    }
                    match (env.assets)(&path[1..]) {
                        Some(asset) => with_body(StatusCode::OK, &asset.mime, asset.bytes),
                        None => empty(StatusCode::NOT_FOUND),
                    }
                })
            },
        ),
        routes.add(Method::GET, "/api/clusters", Audience::Main, |_, _, env| {
            Box::pin(async move { clusters(&env.state.catalog, env.state.open_cluster.as_deref()) })
        }),
        routes.add(
            Method::GET,
            "/api/mark",
            Audience::Both,
            |request, _, env| Box::pin(async move { mark(request.uri().query(), env.state) }),
        ),
        routes.add(
            Method::GET,
            "/api-kube/",
            Audience::Clusters,
            |request, view, env| {
                Box::pin(async move {
                    // The cluster comes from the view, never from the path (FR-006).
                    let entry = match &view {
                        View::Cluster(id) => env.state.catalog.entry(id),
                        View::Main => None,
                    };
                    let Some(entry) = entry else {
                        return empty(StatusCode::NOT_FOUND);
                    };
                    let path = &request.uri().path()["/api-kube".len()..];
                    kube(entry, path, request.uri().query(), env.state).await
                })
            },
        ),
    ];
    for row in rows {
        row.expect("the scheme's own routes are distinct");
    }
    routes
}

/// Answers one request on the scheme's own routes. `assets` looks up a file
/// of the built UI by its path, such as `index.html` or `assets/index-1234.js`.
pub async fn handle(
    request: Request<Vec<u8>>,
    state: &State,
    assets: &(dyn Fn(&str) -> Option<Asset> + Sync),
) -> Response<Vec<u8>> {
    static ROUTES: LazyLock<Routes> = LazyLock::new(routes);
    ROUTES.handle(request, Env { state, assets }).await
}

/// `GET /api-kube/<api path>`, sent to the cluster by the core, which adds the
/// credentials; the view's own headers are not forwarded.
async fn kube(
    entry: &CatalogEntry,
    api_path: &str,
    query: Option<&str>,
    state: &State,
) -> Response<Vec<u8>> {
    let api = api_path.starts_with("/api/") || api_path.starts_with("/apis/");
    if !api || api_path.contains("..") {
        return empty(StatusCode::NOT_FOUND);
    }
    // The scheme answers in one piece, so it cannot carry a watch (research R4).
    let watch = query
        .unwrap_or_default()
        .split('&')
        .any(|pair| pair.split('=').next() == Some("watch"));
    if watch {
        return empty(StatusCode::BAD_REQUEST);
    }
    let path_and_query = match query {
        Some(query) => format!("{api_path}?{query}"),
        None => api_path.to_string(),
    };
    match state.clusters.get(entry, &path_and_query).await {
        ApiOutcome::Response { status, body } => with_body(
            StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY),
            "application/json",
            body,
        ),
        ApiOutcome::Unreachable => {
            let body =
                json!({ "error": "unreachable", "message": "The cluster cannot be reached." });
            with_body(
                StatusCode::BAD_GATEWAY,
                "application/json",
                body.to_string().into_bytes(),
            )
        }
    }
}

fn page(
    assets: &(dyn Fn(&str) -> Option<Asset> + Sync),
    file: &str,
    csp: &str,
) -> Response<Vec<u8>> {
    let Some(asset) = assets(file) else {
        return empty(StatusCode::NOT_FOUND);
    };
    let mut response = with_body(StatusCode::OK, &asset.mime, asset.bytes);
    response.headers_mut().insert(
        header::CONTENT_SECURITY_POLICY,
        csp.parse().expect("a valid header value"),
    );
    response
}

fn clusters(catalog: &Catalog, open_cluster: Option<&str>) -> Response<Vec<u8>> {
    let open_on_load = open_cluster
        .and_then(|name| catalog.entries.iter().find(|entry| entry.name == name))
        .map(|entry| entry.id.as_str());
    let body = json!({
        "source": catalog.source.path.as_ref().map(|path| path.display().to_string()),
        "message": catalog.message(),
        "clusters": catalog
            .entries
            .iter()
            .map(|entry| json!({ "id": entry.id, "name": entry.name }))
            .collect::<Vec<_>>(),
        "openOnLoad": open_on_load,
    });
    with_body(
        StatusCode::OK,
        "application/json",
        body.to_string().into_bytes(),
    )
}

fn mark(query: Option<&str>, state: &State) -> Response<Vec<u8>> {
    let name = query
        .unwrap_or_default()
        .split('&')
        .find_map(|pair| pair.strip_prefix("name="))
        .unwrap_or_default();
    let valid = (1..=40).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-');
    if !valid {
        return empty(StatusCode::BAD_REQUEST);
    }
    (state.log)(&format!("Mark \"{name}\""));
    empty(StatusCode::NO_CONTENT)
}

fn with_body(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .body(body)
        .expect("a valid response")
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("a valid response")
}
