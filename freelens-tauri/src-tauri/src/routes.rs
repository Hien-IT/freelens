/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The table of what the core serves on the scheme, each route with the views
//! that may use it, and the checks every request passes before a route
//! answers (`specs/004-cluster-frames/contracts/routes.md`).

use std::fmt;

use http::{Method, Request, Response, StatusCode, Uri, header};

use crate::catalog::Catalog;
use crate::cluster::BoxFuture;
use crate::messaging::routes::view_of;
use crate::messaging::{Log, View};
use crate::scheme::{Asset, SCHEME, State};

/// Which views may use a route (FR-007).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Audience {
    Main,
    Clusters,
    Both,
}

impl Audience {
    fn includes(self, view: &View) -> bool {
        matches!(
            (self, view),
            (Self::Both, _) | (Self::Main, View::Main) | (Self::Clusters, View::Cluster(_))
        )
    }

    fn overlaps(self, other: Self) -> bool {
        self == other || self == Self::Both || other == Self::Both
    }
}

/// What the core serves from, for the length of one request.
#[derive(Clone, Copy)]
pub struct Env<'a> {
    pub state: &'a State,
    /// Looks up a file of the built UI, such as `index.html`.
    pub assets: &'a (dyn Fn(&str) -> Option<Asset> + Sync),
}

type Handler = Box<
    dyn for<'a> Fn(Request<Vec<u8>>, View, Env<'a>) -> BoxFuture<'a, Response<Vec<u8>>>
        + Send
        + Sync,
>;

struct Route {
    method: Method,
    /// An exact path, or, when it ends in `/` and is not `/` itself, a prefix.
    path: String,
    audience: Audience,
    handler: Handler,
}

impl Route {
    fn matches(&self, path: &str) -> bool {
        if self.path != "/" && self.path.ends_with('/') {
            path.starts_with(&self.path)
        } else {
            path == self.path
        }
    }
}

/// A route with the method and path of one already added, for an audience
/// that overlaps.
#[derive(Debug)]
pub struct DuplicateRoute {
    method: Method,
    path: String,
}

impl fmt::Display for DuplicateRoute {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Route {} {} is added twice", self.method, self.path)
    }
}

impl std::error::Error for DuplicateRoute {}

#[derive(Default)]
pub struct Routes {
    routes: Vec<Route>,
    /// With `--frames-check`, prints the check's cookie of every request.
    cookies: Option<Log>,
}

impl Routes {
    /// Adds a route; the handler gets the view the host names, never one the
    /// request says.
    pub fn add<F>(
        &mut self,
        method: Method,
        path: &str,
        audience: Audience,
        handler: F,
    ) -> Result<(), DuplicateRoute>
    where
        F: for<'a> Fn(Request<Vec<u8>>, View, Env<'a>) -> BoxFuture<'a, Response<Vec<u8>>>
            + Send
            + Sync
            + 'static,
    {
        let duplicate = self.routes.iter().any(|route| {
            route.method == method && route.path == path && route.audience.overlaps(audience)
        });
        if duplicate {
            return Err(DuplicateRoute {
                method,
                path: path.to_string(),
            });
        }
        self.routes.push(Route {
            method,
            path: path.to_string(),
            audience,
            handler: Box::new(handler),
        });
        Ok(())
    }

    /// With `--frames-check`: prints a line of `contracts/frames-log.md` for
    /// every request that carries a `Cookie` header.
    pub fn log_cookies(&mut self, log: Log) {
        self.cookies = Some(log);
    }

    /// Answers one request, with the checks of `contracts/routes.md` in order.
    pub async fn handle(&self, request: Request<Vec<u8>>, env: Env<'_>) -> Response<Vec<u8>> {
        let Some(view) = view_of_uri(request.uri(), &env.state.catalog) else {
            return empty(StatusCode::NOT_FOUND);
        };
        if let (Some(log), Some(cookie)) = (&self.cookies, request.headers().get(header::COOKIE)) {
            log(&format!(
                "Frames check: cookie on a request from {view}: {}",
                check_cookie(cookie.as_bytes())
            ));
        }

        let path = request.uri().path();
        let matching = || self.routes.iter().filter(|route| route.matches(path));
        let Some(longest) = matching().map(|route| route.path.len()).max() else {
            return empty(StatusCode::NOT_FOUND);
        };
        let with_method: Vec<&Route> = matching()
            .filter(|route| route.path.len() == longest && route.method == request.method())
            .collect();
        if with_method.is_empty() {
            return empty(StatusCode::METHOD_NOT_ALLOWED);
        }

        if let Some(origin) = request.headers().get(header::ORIGIN)
            && origin.as_bytes() != origin_of(request.uri()).as_bytes()
        {
            eprintln!("Refused a request whose Origin is not its own");
            return empty(StatusCode::FORBIDDEN);
        }

        // A route of the other kind of view looks absent (research R3).
        let Some(route) = with_method
            .into_iter()
            .find(|route| route.audience.includes(&view))
        else {
            return empty(StatusCode::NOT_FOUND);
        };
        (route.handler)(request, view, env).await
    }
}

/// The view the URI's host names. The whole authority is compared, so that a
/// port or a user name, which `Uri::host` leaves out, names no view, and one
/// cluster cannot have two origins (FR-005).
fn view_of_uri(uri: &Uri, catalog: &Catalog) -> Option<View> {
    view_of(&uri.authority()?.as_str().to_ascii_lowercase(), catalog)
}

/// The origin of a page served from the URI's host.
fn origin_of(uri: &Uri) -> String {
    let host = uri.host().unwrap_or_default().to_ascii_lowercase();
    format!("{SCHEME}://{host}")
}

/// The value of the check's cookie, `frames-check`, or `none`; nothing else
/// of the header is printed.
fn check_cookie(header: &[u8]) -> String {
    String::from_utf8_lossy(header)
        .split(';')
        .find_map(|pair| pair.trim().strip_prefix("frames-check="))
        .map_or_else(|| "none".to_string(), str::to_string)
}

/// Whether the main window may go to `url`: a page of the scheme whose host
/// names a view, or an empty frame (research R12).
pub fn allows_navigation(url: &tauri::Url, catalog: &Catalog) -> bool {
    match url.scheme() {
        "about" => matches!(url.as_str(), "about:blank" | "about:srcdoc"),
        SCHEME => {
            url.port().is_none()
                && url.username().is_empty()
                && url.password().is_none()
                && url
                    .host_str()
                    .is_some_and(|host| view_of(&host.to_ascii_lowercase(), catalog).is_some())
        }
        _ => false,
    }
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("a valid response")
}
