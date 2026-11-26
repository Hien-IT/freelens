/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Watches of the `/api-kube/` proxy over the view's message queue
//! (`specs/009-main-cluster-connection/contracts/kube-watch.md`, research
//! R10): the scheme answers a request in one piece, so a watch's body travels
//! to the frame that opened it as messages, each chunk appended to the one
//! that still waits for a poll.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http::Request;
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use tokio::sync::oneshot;
use tokio::task::AbortHandle;

use super::api_kube::{
    forwarded_request_headers, forwarded_response_headers, header_map, header_pairs, is_normalized,
    refusal,
};
use super::client::describe;
use super::{ClientError, Clusters};
use crate::catalog::{Catalog, CatalogEvent};
use crate::frames::{FrameEvent, Frames};
use crate::messaging::{
    ChannelError, Channels, DuplicateChannel, MessageChannel, QueueEvent, RequestChannel, Sender,
    View,
};

/// The request that opens a watch.
#[derive(Debug, Clone, Deserialize)]
pub struct OpenRequest {
    pub id: String,
    /// What follows `/api-kube` in the URL, with its query.
    pub path: String,
    #[serde(default)]
    pub headers: Vec<(String, String)>,
}

/// The head of the API server's answer, and its whole body when it is not a
/// 2xx.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct OpenAnswer {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Data {
    pub id: String,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct End {
    pub id: String,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
pub struct Close {
    pub id: String,
}

pub const OPEN: RequestChannel<OpenRequest, OpenAnswer> = RequestChannel::new("kube-watch:open");
pub const DATA: MessageChannel<Data> = MessageChannel::new("kube-watch:data");
pub const END: MessageChannel<End> = MessageChannel::new("kube-watch:end");
pub const CLOSE: MessageChannel<Close> = MessageChannel::new("kube-watch:close");

/// How long a watch may stay without a chunk, as the Electron build's proxy
/// lets a watch stay (`main/cluster/freelens-k8s-proxy-manager.injectable.ts`).
pub const INACTIVITY_LIMIT: Duration = Duration::from_secs(4 * 60 * 60);

const NOT_A_FRAME: &str = "kube-watch:open is answered only for a cluster frame";

/// Whether `id` is one a view may choose: `[A-Za-z0-9-]{1,64}`.
fn is_valid_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

struct Open {
    cluster: String,
    token: u64,
    abort: AbortHandle,
}

struct Inner {
    open: Mutex<HashMap<(View, String), Open>>,
    sender: Sender,
    limit: Duration,
    next_token: AtomicU64,
}

/// The open watches, by view and id (data-model.md, Watch).
#[derive(Clone)]
pub struct Watches {
    inner: Arc<Inner>,
}

impl Watches {
    fn new(sender: Sender, limit: Duration) -> Self {
        Self {
            inner: Arc::new(Inner {
                open: Mutex::new(HashMap::new()),
                sender,
                limit,
                next_token: AtomicU64::new(1),
            }),
        }
    }

    fn open(&self) -> std::sync::MutexGuard<'_, HashMap<(View, String), Open>> {
        self.inner.open.lock().expect("the watches lock")
    }

    /// How many watches are open now.
    pub fn count(&self) -> usize {
        self.open().len()
    }

    /// Ends the watch `id` of `view` without a message: the view stopped
    /// reading it or is gone.
    fn close(&self, view: &View, id: &str) {
        if let Some(open) = self.open().remove(&(view.clone(), id.to_string())) {
            open.abort.abort();
        }
    }

    /// Ends every watch of `view` without a message.
    pub fn end_view(&self, view: &View) {
        let closing: Vec<Open> = {
            let mut open = self.open();
            let keys: Vec<_> = open.keys().filter(|(v, _)| v == view).cloned().collect();
            keys.into_iter()
                .filter_map(|key| open.remove(&key))
                .collect()
        };
        for open in closing {
            open.abort.abort();
        }
    }

    /// Ends every watch of the cluster `cluster` with `error`, sent to the
    /// view that opened it: the cluster was disconnected, deleted or left the
    /// catalog.
    pub fn end_cluster(&self, cluster: &str, error: &str) {
        let ending: Vec<((View, String), Open)> = {
            let mut open = self.open();
            let keys: Vec<_> = open
                .iter()
                .filter(|(_, watch)| watch.cluster == cluster)
                .map(|(key, _)| key.clone())
                .collect();
            keys.into_iter()
                .filter_map(|key| open.remove(&key).map(|watch| (key, watch)))
                .collect()
        };
        for ((view, id), open) in ending {
            open.abort.abort();
            self.inner.sender.send_to(
                &view,
                END,
                &End {
                    id,
                    error: Some(error.to_string()),
                },
            );
        }
    }

    /// Forgets the watch `id` of `view` if it is still the one of `token`.
    fn forget(&self, view: &View, id: &str, token: u64) {
        let mut open = self.open();
        let key = (view.clone(), id.to_string());
        if open.get(&key).is_some_and(|watch| watch.token == token) {
            open.remove(&key);
        }
    }
}

/// Registers the four watch channels, and ends the watches of a view whose
/// queue restarts or closes, of a frame forgotten, and of a cluster that
/// leaves the catalog.
pub fn register(
    channels: &mut Channels,
    clusters: &Clusters,
    frames: &Frames,
    catalog: &Catalog,
) -> Result<Watches, DuplicateChannel> {
    register_with(channels, clusters, frames, catalog, INACTIVITY_LIMIT)
}

/// `register` with another inactivity limit, for tests.
pub fn register_with(
    channels: &mut Channels,
    clusters: &Clusters,
    frames: &Frames,
    catalog: &Catalog,
    limit: Duration,
) -> Result<Watches, DuplicateChannel> {
    let watches = Watches::new(channels.sender(), limit);

    let opening = watches.clone();
    let clusters = clusters.clone();
    channels.answer(OPEN, move |request: OpenRequest, view| {
        let watches = opening.clone();
        let clusters = clusters.clone();
        async move { open(watches, clusters, request, view).await }
    })?;

    let closing = watches.clone();
    channels.listen(CLOSE, move |close: Close, view| {
        closing.close(&view, &close.id)
    });

    let following = watches.clone();
    channels.sender().on_queue_event(move |event| match event {
        QueueEvent::Restarted(view) | QueueEvent::Closed(view) => following.end_view(view),
        QueueEvent::Reopened(_) => {}
    });

    let forgetting = watches.clone();
    frames.subscribe(move |event| {
        if let FrameEvent::Forgotten(cluster) = event {
            forgetting.end_view(&View::Cluster(cluster.clone()));
        }
    });

    let leaving = watches.clone();
    catalog.subscribe(move |event| {
        if let CatalogEvent::ClusterRemoved(cluster) = event {
            leaving.end_cluster(cluster, &format!("Cluster {cluster} left the catalog"));
        }
    });

    Ok(watches)
}

async fn open(
    watches: Watches,
    clusters: Clusters,
    request: OpenRequest,
    view: View,
) -> Result<OpenAnswer, ChannelError> {
    let View::Cluster(cluster) = &view else {
        return Err(ChannelError::from(NOT_A_FRAME));
    };
    if !is_valid_id(&request.id) {
        return Err(ChannelError::from(
            "kube-watch:open needs an id of 1 to 64 letters, digits and dashes",
        ));
    }
    if !is_normalized(&request.path) {
        return Err(ChannelError::from(
            "kube-watch:open needs a normalized path under /api-kube",
        ));
    }
    let key = (view.clone(), request.id.clone());
    let (head, answered) = oneshot::channel();
    let token = watches.inner.next_token.fetch_add(1, Ordering::SeqCst);
    {
        let mut open = watches.open();
        if open.contains_key(&key) {
            return Err(ChannelError::from(format!(
                "kube-watch:open: the id {} is in use",
                request.id
            )));
        }
        let task = tokio::spawn(run(
            watches.clone(),
            clusters,
            view.clone(),
            request,
            token,
            head,
        ));
        open.insert(
            key,
            Open {
                cluster: cluster.clone(),
                token,
                abort: task.abort_handle(),
            },
        );
    }
    answered
        .await
        .map_err(|_| ChannelError::from("the watch was closed before its answer"))
}

/// The answer of a refused or failed request, which ends the watch.
fn refused(cluster: &str, error: &ClientError) -> OpenAnswer {
    let (status, kind, body) = refusal(cluster, error);
    OpenAnswer {
        status,
        headers: vec![
            ("content-type".into(), kind.into()),
            ("cache-control".into(), "no-store".into()),
        ],
        body: Some(String::from_utf8_lossy(&body).into_owned()),
    }
}

/// Sends the request: the response of a 2xx head, or the whole answer that
/// ends the watch.
async fn start(
    clusters: &Clusters,
    cluster: &str,
    request: &OpenRequest,
    limit: Duration,
) -> Result<(OpenAnswer, kube::client::Body), OpenAnswer> {
    let client = clusters
        .client(cluster)
        .await
        .map_err(|error| refused(cluster, &error))?;
    let mut outgoing = Request::get(request.path.as_str())
        .body(Vec::new())
        .expect("a normalized path is a valid URI");
    *outgoing.headers_mut() = forwarded_request_headers(&header_map(&request.headers));
    let response = match tokio::time::timeout(limit, client.send(outgoing)).await {
        Ok(Ok(response)) => response,
        Ok(Err(error)) => return Err(refused(cluster, &error)),
        Err(_) => return Err(refused(cluster, &ClientError::Timeout)),
    };
    let status = response.status();
    let headers = header_pairs(&forwarded_response_headers(response.headers()));
    if !status.is_success() {
        let body = match tokio::time::timeout(limit, response.into_body().collect()).await {
            Ok(Ok(body)) => String::from_utf8_lossy(&body.to_bytes()).into_owned(),
            _ => String::new(),
        };
        return Err(OpenAnswer {
            status: status.as_u16(),
            headers,
            body: Some(body),
        });
    }
    let answer = OpenAnswer {
        status: status.as_u16(),
        headers,
        body: None,
    };
    Ok((answer, response.into_body()))
}

/// Sends the request, answers its head, then streams its body to the view.
async fn run(
    watches: Watches,
    clusters: Clusters,
    view: View,
    request: OpenRequest,
    token: u64,
    head: oneshot::Sender<OpenAnswer>,
) {
    let View::Cluster(cluster) = &view else {
        return;
    };
    let id = request.id.clone();
    let limit = watches.inner.limit;
    let sender = watches.inner.sender.clone();
    let (answer, body) = match start(&clusters, cluster, &request, limit).await {
        Ok(started) => started,
        Err(answer) => {
            watches.forget(&view, &id, token);
            let _ = head.send(answer);
            return;
        }
    };
    if head.send(answer).is_err() {
        watches.forget(&view, &id, token);
        return;
    }

    let mut body = body;
    let mut decoder = Utf8Decoder::default();
    let error = loop {
        match tokio::time::timeout(limit, body.frame()).await {
            Err(_) => break Some(format!("no data for {} s", limit.as_secs())),
            Ok(None) => break None,
            Ok(Some(Err(error))) => break Some(describe(&error)),
            Ok(Some(Ok(frame))) => {
                if let Ok(bytes) = frame.into_data() {
                    let text = decoder.push(&bytes);
                    if !text.is_empty() {
                        sender.send_appending_to(
                            &view,
                            DATA,
                            &id,
                            &Data {
                                id: id.clone(),
                                text,
                            },
                        );
                    }
                }
            }
        }
    };
    let tail = decoder.finish();
    if !tail.is_empty() {
        sender.send_appending_to(
            &view,
            DATA,
            &id,
            &Data {
                id: id.clone(),
                text: tail,
            },
        );
    }
    watches.forget(&view, &id, token);
    sender.send_to(&view, END, &End { id, error });
}

/// Decodes UTF-8 across chunks as `TextDecoder` with `stream: true` does: a
/// character split across chunks waits for the next one, an invalid sequence
/// becomes U+FFFD (data-model.md, `Watch.decoder`).
#[derive(Default)]
struct Utf8Decoder {
    pending: Vec<u8>,
}

impl Utf8Decoder {
    fn push(&mut self, bytes: &[u8]) -> String {
        self.pending.extend_from_slice(bytes);
        let mut text = String::new();
        let mut start = 0;
        while start < self.pending.len() {
            match std::str::from_utf8(&self.pending[start..]) {
                Ok(valid) => {
                    text.push_str(valid);
                    start = self.pending.len();
                }
                Err(error) => {
                    let valid = error.valid_up_to();
                    text.push_str(
                        std::str::from_utf8(&self.pending[start..start + valid])
                            .expect("the prefix the error reports valid"),
                    );
                    start += valid;
                    match error.error_len() {
                        Some(length) => {
                            text.push('\u{FFFD}');
                            start += length;
                        }
                        // A character cut by the end of the chunk.
                        None => break,
                    }
                }
            }
        }
        self.pending.drain(..start);
        text
    }

    /// What is left when the body ends: a cut character becomes U+FFFD.
    fn finish(&mut self) -> String {
        let text = String::from_utf8_lossy(&self.pending).into_owned();
        self.pending.clear();
        text
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_character_split_across_chunks_waits_for_the_next_one() {
        let mut decoder = Utf8Decoder::default();
        let bytes = "aé€😀b".as_bytes();
        let mut text = String::new();
        for byte in bytes {
            text.push_str(&decoder.push(std::slice::from_ref(byte)));
        }
        text.push_str(&decoder.finish());
        assert_eq!(text, "aé€😀b");
    }

    #[test]
    fn an_invalid_sequence_becomes_the_replacement_character() {
        let mut decoder = Utf8Decoder::default();
        assert_eq!(decoder.push(b"a\xffb"), "a\u{FFFD}b");
        assert_eq!(decoder.push(&[0xe2, 0x82]), "");
        assert_eq!(decoder.finish(), "\u{FFFD}");
    }

    #[test]
    fn an_id_is_1_to_64_letters_digits_and_dashes() {
        assert!(is_valid_id("w-1"));
        assert!(is_valid_id(&"a".repeat(64)));
        assert!(!is_valid_id(""));
        assert!(!is_valid_id(&"a".repeat(65)));
        assert!(!is_valid_id("w_1"));
        assert!(!is_valid_id("w 1"));
    }
}
