/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The `/ipc/` routes of the scheme
//! (`specs/002-messaging-for-tauri/contracts/ipc-routes.md`).

use http::{Method, Request, Response, StatusCode, header};
use serde_json::{Map, Value, json};

use super::{Failure, Messaging, View};
use crate::catalog::Catalog;
use crate::scheme::{MAIN_HOST, SCHEME};

/// The largest body a route reads.
pub const BODY_LIMIT: usize = 64 * 1024 * 1024;

/// The view a host names: the main window, or the frame of a cluster of the
/// catalog (research R7).
pub fn view_of(host: &str, catalog: &Catalog) -> Option<View> {
    if host == MAIN_HOST {
        return Some(View::Main);
    }
    host.strip_suffix(MAIN_HOST)
        .and_then(|prefix| prefix.strip_suffix('.'))
        .and_then(|id| catalog.entry(id))
        .map(|entry| View::Cluster(entry.id.clone()))
}

/// Answers one request under `/ipc/`, with the checks of the contract in order.
pub async fn handle(
    request: Request<Vec<u8>>,
    catalog: &Catalog,
    messaging: &Messaging,
) -> Response<Vec<u8>> {
    let host = request
        .uri()
        .host()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let Some(view) = view_of(&host, catalog) else {
        return empty(StatusCode::NOT_FOUND);
    };
    if request.method() != Method::POST {
        return empty(StatusCode::METHOD_NOT_ALLOWED);
    }
    // WebKit sends no Origin when a page posts to its own host on a custom
    // scheme, so only a present one is checked. A page of another host cannot
    // post here either way: the JSON content type makes its request need a
    // CORS preflight, which the core never grants (research R7).
    if let Some(origin) = request.headers().get(header::ORIGIN)
        && origin.as_bytes() != format!("{SCHEME}://{host}").as_bytes()
    {
        eprintln!("Refused an IPC request whose Origin names another host");
        return empty(StatusCode::FORBIDDEN);
    }
    let json = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"));
    if !json {
        eprintln!("Refused an IPC request that is not JSON");
        return empty(StatusCode::UNSUPPORTED_MEDIA_TYPE);
    }
    if request.body().len() > BODY_LIMIT {
        return empty(StatusCode::PAYLOAD_TOO_LARGE);
    }
    let Ok(Value::Object(body)) = serde_json::from_slice::<Value>(request.body()) else {
        eprintln!(
            "Refused an IPC request whose body of {} bytes is not a JSON object",
            request.body().len()
        );
        return error(StatusCode::BAD_REQUEST, "The body is not a JSON object");
    };

    match request.uri().path() {
        "/ipc/request" => answer_request(body, view, messaging).await,
        "/ipc/messages" => deliver_messages(body, &view, messaging),
        "/ipc/poll" => poll(body, view, messaging).await,
        _ => empty(StatusCode::NOT_FOUND),
    }
}

async fn answer_request(
    body: Map<String, Value>,
    view: View,
    messaging: &Messaging,
) -> Response<Vec<u8>> {
    let Some(channel) = body.get("channel").and_then(Value::as_str) else {
        return error(StatusCode::BAD_REQUEST, "The request names no channel");
    };
    match messaging
        .request(channel, body.get("payload").cloned(), view)
        .await
    {
        Ok(payload) => json_body(StatusCode::OK, &envelope(payload)),
        Err(Failure::NoHandler) => error(
            StatusCode::NOT_FOUND,
            &format!("No handler registered for '{channel}'"),
        ),
        Err(Failure::BadRequest(message)) => error(StatusCode::BAD_REQUEST, &message),
        Err(Failure::Handler(message)) => error(StatusCode::INTERNAL_SERVER_ERROR, &message),
    }
}

fn deliver_messages(
    body: Map<String, Value>,
    view: &View,
    messaging: &Messaging,
) -> Response<Vec<u8>> {
    let Some(Value::Array(messages)) = body.get("messages") else {
        return error(
            StatusCode::BAD_REQUEST,
            "The batch holds no list of messages",
        );
    };
    let mut parsed = Vec::with_capacity(messages.len());
    for message in messages {
        let Some(channel) = message.get("channel").and_then(Value::as_str) else {
            return error(StatusCode::BAD_REQUEST, "A message names no channel");
        };
        parsed.push((channel, message.get("payload").cloned()));
    }
    if parsed.is_empty() {
        return error(StatusCode::BAD_REQUEST, "The batch holds no message");
    }
    // In order, so that a batch keeps the order the view sent it in (research R5).
    for (channel, payload) in parsed {
        messaging.deliver(channel, payload, view);
    }
    empty(StatusCode::NO_CONTENT)
}

async fn poll(body: Map<String, Value>, view: View, messaging: &Messaging) -> Response<Vec<u8>> {
    let session = body
        .get("session")
        .and_then(Value::as_str)
        .filter(|session| {
            (1..=64).contains(&session.len())
                && session
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'-')
        });
    let after = body.get("after").and_then(Value::as_u64);
    let (Some(session), Some(after)) = (session, after) else {
        return error(
            StatusCode::BAD_REQUEST,
            "The poll has no valid session or after",
        );
    };
    let messages = messaging.queues().poll(view, session, after).await;
    json_body(StatusCode::OK, &json!({ "messages": messages }))
}

fn envelope(payload: Option<Value>) -> Value {
    match payload {
        Some(payload) => json!({ "payload": payload }),
        None => json!({}),
    }
}

fn error(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    json_body(status, &json!({ "error": { "message": message } }))
}

fn json_body(status: StatusCode, body: &Value) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "application/json")
        .body(body.to_string().into_bytes())
        .expect("a valid response")
}

fn empty(status: StatusCode) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("a valid response")
}
