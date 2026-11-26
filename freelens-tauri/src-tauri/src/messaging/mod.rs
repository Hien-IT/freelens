/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The channels between the views and the core: request channels answered by
//! the core areas, and message channels in both directions
//! (`specs/002-messaging-for-tauri/contracts/core-channels.md`).

pub mod admin;
pub mod check;
pub mod queues;
pub mod routes;

use std::any::TypeId;
use std::collections::HashMap;
use std::fmt;
use std::future::Future;
use std::marker::PhantomData;
use std::sync::Arc;

use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::Value;

use crate::cluster::BoxFuture;
pub use queues::QueueEvent;
use queues::Queues;

/// Prints one log line of `contracts/check-log.md`.
pub type Log = Arc<dyn Fn(&str) + Send + Sync>;

/// The view a request or message comes from, taken from the host of the
/// request, never from its body (research R7).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum View {
    Main,
    Cluster(String),
}

impl fmt::Display for View {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Main => write!(f, "main"),
            Self::Cluster(id) => write!(f, "cluster {id}"),
        }
    }
}

/// A request channel: one typed answer per request. Its id is the `id` of the
/// TypeScript channel.
pub struct RequestChannel<Req, Res> {
    id: &'static str,
    types: PhantomData<fn(Req) -> Res>,
}

impl<Req, Res> RequestChannel<Req, Res> {
    pub const fn new(id: &'static str) -> Self {
        Self {
            id,
            types: PhantomData,
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }
}

impl<Req, Res> Clone for RequestChannel<Req, Res> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<Req, Res> Copy for RequestChannel<Req, Res> {}

/// A message channel: one-way and typed.
pub struct MessageChannel<M> {
    id: &'static str,
    types: PhantomData<fn(M)>,
}

impl<M> MessageChannel<M> {
    pub const fn new(id: &'static str) -> Self {
        Self {
            id,
            types: PhantomData,
        }
    }

    pub fn id(&self) -> &'static str {
        self.id
    }
}

impl<M> Clone for MessageChannel<M> {
    fn clone(&self) -> Self {
        *self
    }
}

impl<M> Copy for MessageChannel<M> {}

/// The error a handler answers with; its message reaches the view.
#[derive(Debug)]
pub struct ChannelError {
    message: String,
}

impl ChannelError {
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl<E: fmt::Display> From<E> for ChannelError {
    fn from(error: E) -> Self {
        Self {
            message: error.to_string(),
        }
    }
}

/// A second answer registered for one request channel (FR-010).
#[derive(Debug, PartialEq, Eq)]
pub struct DuplicateChannel {
    id: &'static str,
}

impl fmt::Display for DuplicateChannel {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "Channel \"{}\" is answered twice", self.id)
    }
}

/// Why a request got no answer; each maps to a status of the routes.
#[derive(Debug, PartialEq)]
pub(crate) enum Failure {
    NoHandler,
    BadRequest(String),
    Handler(String),
}

type RequestHandler =
    Box<dyn Fn(Value, View) -> BoxFuture<'static, Result<Option<Value>, Failure>> + Send + Sync>;
type MessageListener = Box<dyn Fn(Value, View) -> Result<(), String> + Send + Sync>;

/// An answer that may be "no value", which the view sees as `undefined`, as
/// the Electron build answers `undefined`; `Optional(None)` is that.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Optional(pub Option<Value>);

/// `()` and `Optional(None)` travel as "no value", so that the view sees
/// `undefined`.
fn to_payload<T: Serialize + 'static>(value: &T) -> Result<Option<Value>, String> {
    if TypeId::of::<T>() == TypeId::of::<()>() {
        return Ok(None);
    }
    if let Some(Optional(optional)) = (value as &dyn std::any::Any).downcast_ref::<Optional>() {
        return Ok(optional.clone());
    }
    serde_json::to_value(value)
        .map(Some)
        .map_err(|error| error.to_string())
}

/// Sends messages to every open view; usable before `Channels::build`, so that
/// a handler registered there can send.
#[derive(Clone)]
pub struct Sender {
    queues: Arc<Queues>,
}

impl Sender {
    pub fn send<M: Serialize + 'static>(&self, channel: MessageChannel<M>, message: &M) {
        match to_payload(message) {
            Ok(payload) => self.queues.push(channel.id, payload),
            Err(error) => (self.queues.log)(&format!(
                "Messaging: cannot send on \"{}\": {error}",
                channel.id
            )),
        }
    }

    /// Sends a payload on a channel known only at run time, for the relay.
    pub(crate) fn send_raw(&self, channel_id: &str, payload: Option<Value>) {
        self.queues.push(channel_id, payload);
    }

    /// Sends to the queue of `view` alone; dropped if it has no open queue
    /// (`specs/004-cluster-frames/contracts/frames-api.md`).
    pub fn send_to<M: Serialize + 'static>(
        &self,
        view: &View,
        channel: MessageChannel<M>,
        message: &M,
    ) {
        match to_payload(message) {
            Ok(payload) => self.queues.push_to(view, channel.id, payload),
            Err(error) => (self.queues.log)(&format!(
                "Messaging: cannot send on \"{}\": {error}",
                channel.id
            )),
        }
    }

    /// Sends to every open view on a channel whose name is built at run time,
    /// such as `cluster:<clusterId>:connection-update`
    /// (`specs/009-main-cluster-connection/research.md`, R14).
    pub fn send_named<M: Serialize + 'static>(&self, name: &str, message: &M) {
        match to_payload(message) {
            Ok(payload) => self.queues.push(name, payload),
            Err(error) => {
                (self.queues.log)(&format!("Messaging: cannot send on \"{name}\": {error}"))
            }
        }
    }

    /// Sends to the queue of `view` alone a message whose `text` a later one of
    /// the same `key` is appended to while it waits unanswered
    /// (`specs/009-main-cluster-connection/contracts/kube-watch.md`).
    pub fn send_appending_to<M: Serialize + 'static>(
        &self,
        view: &View,
        channel: MessageChannel<M>,
        key: &str,
        message: &M,
    ) {
        match to_payload(message) {
            Ok(Some(payload)) => self.queues.push_appending(view, channel.id, key, payload),
            Ok(None) => self.queues.push_to(view, channel.id, None),
            Err(error) => (self.queues.log)(&format!(
                "Messaging: cannot send on \"{}\": {error}",
                channel.id
            )),
        }
    }

    /// Closes the queues of the views that are gone (research R5 of spec 004).
    pub fn sweep(&self) {
        self.queues.sweep();
    }

    /// With `--messages-dump`: appends every message sent from now on to
    /// `path`, one JSON line each.
    pub fn dump_to(&self, path: std::path::PathBuf) {
        self.queues.dump_to(path);
    }

    /// Calls `listener` with a view whose first poll opens its queue: its page
    /// has loaded; usable before `Channels::build`.
    pub fn on_queue_opened(&self, listener: impl Fn(&View) + Send + Sync + 'static) {
        self.queues.on_opened(listener);
    }

    /// Calls `listener` with every later queue event, outside the queues'
    /// lock; usable before `Channels::build`.
    pub fn on_queue_event(&self, listener: impl Fn(&QueueEvent) + Send + Sync + 'static) {
        self.queues.on_event(listener);
    }
}

/// Collects the registrations of every area at startup.
pub struct Channels {
    requests: HashMap<&'static str, RequestHandler>,
    listeners: HashMap<&'static str, Vec<MessageListener>>,
    sender: Sender,
    log: Log,
}

impl Default for Channels {
    fn default() -> Self {
        Self::with_log(Arc::new(|line| println!("{line}")))
    }
}

impl Channels {
    pub fn with_log(log: Log) -> Self {
        Self {
            requests: HashMap::new(),
            listeners: HashMap::new(),
            sender: Sender {
                queues: Arc::new(Queues::new(Arc::clone(&log))),
            },
            log,
        }
    }

    pub fn sender(&self) -> Sender {
        self.sender.clone()
    }

    /// Answers a request channel. A second `answer` for the same id fails.
    pub fn answer<Req, Res, F, Fut>(
        &mut self,
        channel: RequestChannel<Req, Res>,
        handler: F,
    ) -> Result<(), DuplicateChannel>
    where
        Req: DeserializeOwned + Send + 'static,
        Res: Serialize + Send + 'static,
        F: Fn(Req, View) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Res, ChannelError>> + Send + 'static,
    {
        let id = channel.id;
        if self.requests.contains_key(id) {
            return Err(DuplicateChannel { id });
        }
        let handler = Arc::new(handler);
        self.requests.insert(
            id,
            Box::new(move |payload, view| {
                let handler = Arc::clone(&handler);
                Box::pin(async move {
                    let request: Req = serde_json::from_value(payload).map_err(|error| {
                        Failure::BadRequest(format!("Invalid request for '{id}': {error}"))
                    })?;
                    let answer = handler(request, view)
                        .await
                        .map_err(|error| Failure::Handler(error.message))?;
                    to_payload(&answer).map_err(Failure::Handler)
                })
            }),
        );
        Ok(())
    }

    /// Listens to a message channel. A channel may have several listeners.
    pub fn listen<M, F>(&mut self, channel: MessageChannel<M>, listener: F)
    where
        M: DeserializeOwned + Send + 'static,
        F: Fn(M, View) + Send + Sync + 'static,
    {
        self.listeners
            .entry(channel.id)
            .or_default()
            .push(Box::new(move |payload, view| {
                let message: M =
                    serde_json::from_value(payload).map_err(|error| error.to_string())?;
                listener(message, view);
                Ok(())
            }));
    }

    /// Ends the registrations.
    pub fn build(self) -> Messaging {
        Messaging {
            inner: Arc::new(Inner {
                requests: self.requests,
                listeners: self.listeners,
                sender: self.sender,
                log: self.log,
            }),
        }
    }
}

struct Inner {
    requests: HashMap<&'static str, RequestHandler>,
    listeners: HashMap<&'static str, Vec<MessageListener>>,
    sender: Sender,
    log: Log,
}

/// Shared by the scheme handler and every area that sends; cheap to clone.
#[derive(Clone)]
pub struct Messaging {
    inner: Arc<Inner>,
}

impl Messaging {
    /// Appends the message to the queue of every open view (FR-004).
    pub fn send<M: Serialize + 'static>(&self, channel: MessageChannel<M>, message: &M) {
        self.inner.sender.send(channel, message);
    }

    pub fn sender(&self) -> Sender {
        self.inner.sender.clone()
    }

    /// Closes the queues of the views that are gone; the core calls it once a
    /// second, so that no view has to poll for that to happen.
    pub fn sweep(&self) {
        self.inner.sender.sweep();
    }

    /// Answers a request; an absent payload reaches the handler as `null`.
    pub(crate) async fn request(
        &self,
        channel_id: &str,
        payload: Option<Value>,
        view: View,
    ) -> Result<Option<Value>, Failure> {
        let Some(handler) = self.inner.requests.get(channel_id) else {
            return Err(Failure::NoHandler);
        };
        handler(payload.unwrap_or(Value::Null), view).await
    }

    /// Hands a message to every listener of its channel, in registration order.
    pub(crate) fn deliver(&self, channel_id: &str, payload: Option<Value>, view: &View) {
        for listener in self.inner.listeners.get(channel_id).into_iter().flatten() {
            if let Err(error) = listener(payload.clone().unwrap_or(Value::Null), view.clone()) {
                (self.inner.log)(&format!(
                    "Messaging: dropped a message on \"{channel_id}\": {error}"
                ));
            }
        }
    }

    pub(crate) fn queues(&self) -> &Queues {
        &self.inner.sender.queues
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    const DOUBLE: RequestChannel<u32, u32> = RequestChannel::new("double");
    const NOTHING: RequestChannel<(), ()> = RequestChannel::new("nothing");
    const MAYBE: RequestChannel<(), Option<u32>> = RequestChannel::new("maybe");
    const NOTE: MessageChannel<String> = MessageChannel::new("note");

    fn quiet() -> Channels {
        Channels::with_log(Arc::new(|_| {}))
    }

    #[tokio::test]
    async fn a_second_answer_for_one_id_fails() {
        let mut channels = quiet();
        channels
            .answer(DOUBLE, |n, _| async move { Ok(n * 2) })
            .unwrap();
        assert_eq!(
            channels.answer(DOUBLE, |n, _| async move { Ok(n) }),
            Err(DuplicateChannel { id: "double" })
        );
        assert_eq!(
            DuplicateChannel { id: "double" }.to_string(),
            "Channel \"double\" is answered twice"
        );
    }

    #[tokio::test]
    async fn answers_carry_no_value_for_unit_and_null_for_none() {
        let mut channels = quiet();
        channels
            .answer(DOUBLE, |n, _| async move { Ok(n * 2) })
            .unwrap();
        channels.answer(NOTHING, |(), _| async { Ok(()) }).unwrap();
        channels.answer(MAYBE, |(), _| async { Ok(None) }).unwrap();
        let messaging = channels.build();

        let double = messaging
            .request("double", Some(Value::from(21)), View::Main)
            .await;
        assert_eq!(double, Ok(Some(Value::from(42))));
        assert_eq!(
            messaging.request("nothing", None, View::Main).await,
            Ok(None)
        );
        assert_eq!(
            messaging.request("maybe", None, View::Main).await,
            Ok(Some(Value::Null))
        );
    }

    #[tokio::test]
    async fn requests_fail_without_a_handler_on_a_bad_value_and_on_an_error() {
        let mut channels = quiet();
        channels
            .answer(DOUBLE, |_: u32, _| async {
                Err::<u32, _>(ChannelError::from("boom"))
            })
            .unwrap();
        let messaging = channels.build();

        assert_eq!(
            messaging.request("missing", None, View::Main).await,
            Err(Failure::NoHandler)
        );
        assert!(matches!(
            messaging.request("double", Some(Value::from("x")), View::Main).await,
            Err(Failure::BadRequest(message)) if message.starts_with("Invalid request for 'double'")
        ));
        assert_eq!(
            messaging
                .request("double", Some(Value::from(1)), View::Main)
                .await,
            Err(Failure::Handler("boom".into()))
        );
    }

    #[test]
    fn every_listener_of_a_channel_gets_the_message_with_its_view() {
        let received = Arc::new(Mutex::new(Vec::new()));
        let mut channels = quiet();
        for name in ["first", "second"] {
            let received = Arc::clone(&received);
            channels.listen(NOTE, move |message, view| {
                received
                    .lock()
                    .unwrap()
                    .push(format!("{name} {message} {view}"));
            });
        }
        let messaging = channels.build();

        messaging.deliver(
            "note",
            Some(Value::from("hi")),
            &View::Cluster("abc".into()),
        );

        assert_eq!(
            *received.lock().unwrap(),
            ["first hi cluster abc", "second hi cluster abc"]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn send_to_reaches_one_of_two_open_views() {
        let channels = quiet();
        let sender = channels.sender();
        let messaging = channels.build();
        let one = View::Cluster("one".into());
        messaging.queues().poll(View::Main, "s1", 0).await;
        messaging.queues().poll(one.clone(), "s2", 0).await;

        sender.send_to(&one, NOTE, &"hi".to_string());

        let polled = messaging.queues().poll(one, "s2", 0).await;
        assert_eq!(polled.len(), 1);
        assert_eq!(polled[0].channel, "note");
        assert_eq!(polled[0].payload, Some(Value::from("hi")));
        assert!(
            messaging
                .queues()
                .poll(View::Main, "s1", 0)
                .await
                .is_empty()
        );
    }

    #[test]
    fn a_message_that_does_not_parse_is_dropped_and_logged() {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let log_lines = Arc::clone(&lines);
        let mut channels = Channels::with_log(Arc::new(move |line| {
            log_lines.lock().unwrap().push(line.to_string());
        }));
        channels.listen(NOTE, |_, _| panic!("must not be called"));
        let messaging = channels.build();

        messaging.deliver("note", Some(Value::from(1)), &View::Main);

        assert_eq!(lines.lock().unwrap().len(), 1);
        assert!(lines.lock().unwrap()[0].starts_with("Messaging: dropped a message on \"note\""));
    }

    #[tokio::test(start_paused = true)]
    async fn send_named_reaches_every_open_view_on_a_name_built_at_run_time() {
        let channels = quiet();
        let sender = channels.sender();
        let messaging = channels.build();
        let one = View::Cluster("one".into());
        messaging.queues().poll(View::Main, "s1", 0).await;
        messaging.queues().poll(one.clone(), "s2", 0).await;

        let name = format!("cluster:{}:connection-update", "abc");
        sender.send_named(&name, &serde_json::json!({"message": "m", "level": "info"}));

        for (view, session) in [(View::Main, "s1"), (one, "s2")] {
            let polled = messaging.queues().poll(view, session, 0).await;
            assert_eq!(polled.len(), 1);
            assert_eq!(polled[0].channel, "cluster:abc:connection-update");
            assert_eq!(
                polled[0].payload,
                Some(serde_json::json!({"message": "m", "level": "info"}))
            );
        }
    }

    #[tokio::test(start_paused = true)]
    async fn send_appending_to_appends_the_text_of_one_key() {
        const DATA: MessageChannel<serde_json::Value> = MessageChannel::new("data");
        let channels = quiet();
        let sender = channels.sender();
        let messaging = channels.build();
        let one = View::Cluster("one".into());
        messaging.queues().poll(one.clone(), "s1", 0).await;

        sender.send_appending_to(
            &one,
            DATA,
            "w",
            &serde_json::json!({"id": "w", "text": "a"}),
        );
        sender.send_appending_to(
            &one,
            DATA,
            "w",
            &serde_json::json!({"id": "w", "text": "b"}),
        );

        let polled = messaging.queues().poll(one, "s1", 0).await;
        assert_eq!(polled.len(), 1);
        assert_eq!(
            polled[0].payload,
            Some(serde_json::json!({"id": "w", "text": "ab"}))
        );
    }
}
