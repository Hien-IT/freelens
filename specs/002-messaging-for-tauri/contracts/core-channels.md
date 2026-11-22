# Contract: Registering Channels in the Core

The API of the `messaging` module of `freelens-tauri/src-tauri/src/`, through
which the core areas answer and send on channels (research R8). Signatures
show the contract; bodies are the implementation's.

```rust
/// The view a request or message comes from, taken from the host (research R7).
pub enum View {
    Main,
    Cluster(ClusterId),
}

/// A request channel: one typed answer per request.
pub struct RequestChannel<Req, Res> { /* id: &'static str */ }

impl<Req, Res> RequestChannel<Req, Res> {
    pub const fn new(id: &'static str) -> Self;
    pub fn id(&self) -> &'static str;
}

/// A message channel: one-way, typed.
pub struct MessageChannel<M> { /* id: &'static str */ }

impl<M> MessageChannel<M> {
    pub const fn new(id: &'static str) -> Self;
    pub fn id(&self) -> &'static str;
}

/// The error a handler answers with; its message reaches the view (status 500 of the routes).
pub struct ChannelError { /* message: String */ }

impl<E: std::fmt::Display> From<E> for ChannelError;

/// Collects the registrations of every area at startup.
#[derive(Default)]
pub struct Channels { /* … */ }

impl Channels {
    /// Answers a request channel. A second `answer` for the same id fails.
    pub fn answer<Req, Res, F, Fut>(
        &mut self,
        channel: RequestChannel<Req, Res>,
        handler: F,
    ) -> Result<(), DuplicateChannel>
    where
        Req: serde::de::DeserializeOwned + Send + 'static,
        Res: serde::Serialize + Send + 'static,
        F: Fn(Req, View) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = Result<Res, ChannelError>> + Send + 'static;

    /// Listens to a message channel. A channel may have several listeners.
    pub fn listen<M, F>(&mut self, channel: MessageChannel<M>, listener: F)
    where
        M: serde::de::DeserializeOwned + Send + 'static,
        F: Fn(M, View) + Send + Sync + 'static;

    /// Ends the registrations.
    pub fn build(self) -> Messaging;
}

/// "Channel \"<id>\" is answered twice".
pub struct DuplicateChannel { /* id: &'static str */ }

/// Shared by the scheme handler and every area that sends; cheap to clone.
#[derive(Clone)]
pub struct Messaging { /* … */ }

impl Messaging {
    /// Appends the message to the queue of every open view (FR-004).
    pub fn send<M: serde::Serialize>(&self, channel: MessageChannel<M>, message: &M);
}
```

## Rules

- **Values.** An absent `payload` reaches a handler as JSON `null`, so a
  channel without a request takes `()`. An answer of type `()` is sent with no
  `payload`, so the view sees `undefined`; every other answer is sent as
  `payload`, so `None` arrives as `null`. A request that does not deserialize
  into `Req` is answered `400`, without calling the handler.
- **Registration.** Each area has a `register` function taking `&mut Channels`,
  called from `lib.rs` before the window opens. On `DuplicateChannel` the core
  prints `Channel "<id>" is answered twice` on standard error and exits with
  status 1 (FR-010).
- **Ids.** A channel's id is the `id` of its TypeScript definition, written
  once as a Rust constant in the module of the area that owns it, next to the
  Rust types of its values. The module names the TypeScript file that defines
  the channel, so that a change on either side can find the other.
- **Concurrency.** Handlers run on the tokio runtime of the scheme handler; a
  slow handler delays only its own answer. Listeners run in the order of
  `listen` calls, synchronously, in the order the messages of a batch arrive
  (research R5); a listener with slow work spawns it.
- **Credentials.** The module carries values as the areas give them. An area
  never puts a certificate, key or token of a kubeconfig file in a value it
  answers or sends (FR-012); the tests of each area check its own channels.
