/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The `freelens-app` scheme, the only channel between the views and the core
//! (`specs/001-tauri-shell-spike/contracts/scheme-routes.md`).

use http::{Method, Request, Response, StatusCode, header};
use serde_json::json;

use crate::catalog::Catalog;

pub const SCHEME: &str = "freelens-app";
pub const MAIN_HOST: &str = "renderer.freelens.app";

const MAIN_CSP: &str = "default-src 'self'; frame-src freelens-app:";
const CLUSTER_CSP: &str =
    "default-src 'self'; frame-ancestors freelens-app://renderer.freelens.app";

/// A file of the built UI.
pub struct Asset {
    pub bytes: Vec<u8>,
    pub mime: String,
}

pub struct State {
    pub catalog: Catalog,
    /// Prints a log line of `contracts/log-lines.md`.
    pub log: Box<dyn Fn(&str) + Send + Sync>,
}

enum Host {
    Main,
    Cluster,
    Unknown,
}

/// Answers one request on the scheme. `assets` looks up a file of the built UI
/// by its path, such as `index.html` or `assets/index-1234.js`.
pub async fn handle(
    request: Request<Vec<u8>>,
    state: &State,
    assets: &(dyn Fn(&str) -> Option<Asset> + Sync),
) -> Response<Vec<u8>> {
    let host_name = request
        .uri()
        .host()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let host = host_of(&host_name, &state.catalog);

    if matches!(host, Host::Unknown) {
        return empty(StatusCode::NOT_FOUND);
    }

    if let Some(origin) = request.headers().get(header::ORIGIN)
        && origin.as_bytes() != format!("{SCHEME}://{host_name}").as_bytes()
    {
        eprintln!("Refused a request whose Origin is not its own");
        return empty(StatusCode::FORBIDDEN);
    }

    if request.method() != Method::GET {
        return empty(StatusCode::METHOD_NOT_ALLOWED);
    }

    let path = request.uri().path();

    match (&host, path) {
        (Host::Main, "/") => page(assets, "index.html", MAIN_CSP),
        (Host::Cluster, "/") => page(assets, "cluster.html", CLUSTER_CSP),
        (_, "/api/mark") => mark(request.uri().query(), state),
        (Host::Main, "/api/clusters") => clusters(&state.catalog),
        (_, path) if path.starts_with("/assets/") && !path.contains("..") => {
            match assets(&path[1..]) {
                Some(asset) => with_body(StatusCode::OK, &asset.mime, asset.bytes),
                None => empty(StatusCode::NOT_FOUND),
            }
        }
        _ => empty(StatusCode::NOT_FOUND),
    }
}

fn host_of(host: &str, catalog: &Catalog) -> Host {
    if host == MAIN_HOST {
        return Host::Main;
    }
    host.strip_suffix(MAIN_HOST)
        .and_then(|prefix| prefix.strip_suffix('.'))
        .and_then(|id| catalog.entry(id))
        .map_or(Host::Unknown, |_| Host::Cluster)
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

fn clusters(catalog: &Catalog) -> Response<Vec<u8>> {
    let body = json!({
        "source": catalog.source.path.as_ref().map(|path| path.display().to_string()),
        "message": catalog.message(),
        "clusters": catalog
            .entries
            .iter()
            .map(|entry| json!({ "id": entry.id, "name": entry.name }))
            .collect::<Vec<_>>(),
        "openOnLoad": null,
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
