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

use crate::catalog::{Catalog, ClusterSource, LaunchFile, LaunchFileState};
use crate::cluster::client::{ApiOutcome, ClusterApi};
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
            Box::pin(async move {
                env.state.catalog.scanned().await;
                clusters(&env.state.catalog, env.state.open_cluster.as_deref())
            })
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
                    let cluster = match &view {
                        View::Cluster(id) => env.state.catalog.cluster(id),
                        View::Main => None,
                    };
                    let Some(cluster) = cluster else {
                        return empty(StatusCode::NOT_FOUND);
                    };
                    let path = &request.uri().path()["/api-kube".len()..];
                    kube(&cluster, path, request.uri().query(), env.state).await
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
    cluster: &ClusterSource,
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
    match state.clusters.get(cluster, &path_and_query).await {
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

/// The spike page's list (`specs/001-tauri-shell-spike/contracts/scheme-routes.md`):
/// the file of `--kubeconfig` as `source`, the notice about it, and the id of
/// the context `--open-cluster` names in it.
fn clusters(catalog: &Catalog, open_cluster: Option<&str>) -> Response<Vec<u8>> {
    let launch_file = catalog.launch_file();
    let clusters = catalog.clusters();
    let open_on_load = open_cluster.and_then(|name| {
        clusters.iter().find(|cluster| {
            cluster.context_name == name
                && launch_file
                    .as_ref()
                    .is_some_and(|file| file.path == cluster.kubeconfig_path)
        })
    });
    let names = catalog
        .entities()
        .into_iter()
        .filter(|entity| entity["kind"] == "KubernetesCluster")
        .map(
            |entity| json!({ "id": entity["metadata"]["uid"], "name": entity["metadata"]["name"] }),
        )
        .collect::<Vec<_>>();
    let body = json!({
        "source": launch_file.as_ref().map(|file| file.path.display().to_string()),
        "message": launch_file.as_ref().and_then(notice),
        "clusters": names,
        "openOnLoad": open_on_load.map(|cluster| cluster.id.as_str()),
    });
    with_body(
        StatusCode::OK,
        "application/json",
        body.to_string().into_bytes(),
    )
}

/// The spike page's notice about the file of `--kubeconfig`; the Electron
/// build has none, and its renderer does not read this route.
fn notice(file: &LaunchFile) -> Option<String> {
    let path = file.path.display();
    match file.state {
        LaunchFileState::Read => None,
        LaunchFileState::Missing => Some(format!("Kubeconfig file not found: {path}")),
        LaunchFileState::Invalid => Some(format!(
            "Cannot read kubeconfig file {path}: it is not a valid kubeconfig"
        )),
    }
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

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    #[test]
    fn the_notice_names_the_file_without_quoting_it() {
        let file = |state| LaunchFile {
            path: PathBuf::from("/work/invalid.yaml"),
            state,
        };
        assert_eq!(notice(&file(LaunchFileState::Read)), None);
        assert_eq!(
            notice(&file(LaunchFileState::Missing)).as_deref(),
            Some("Kubeconfig file not found: /work/invalid.yaml")
        );
        assert_eq!(
            notice(&file(LaunchFileState::Invalid)).as_deref(),
            Some("Cannot read kubeconfig file /work/invalid.yaml: it is not a valid kubeconfig")
        );
    }
}
