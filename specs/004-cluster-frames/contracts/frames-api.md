# Contract: The Frame Record for the Core's Areas

`Frames`, in `freelens-tauri/src-tauri/src/frames.rs`, is built once at
startup and cloned into every area that needs it, as `Messaging` is. The
states and events are in [data-model.md](../data-model.md).

```rust
impl Frames {
    /// Whether `cluster` has a recorded frame.
    pub fn has_frame(&self, cluster: &str) -> bool;
    /// The clusters with a recorded frame.
    pub fn frames(&self) -> Vec<String>;
    /// The cluster the main window last named, if it is in the catalog.
    pub fn visible(&self) -> Option<String>;

    /// Forgets the frame of `cluster`, as disconnecting or deleting it does.
    pub fn forget(&self, cluster: &str);

    /// Calls `listener` with every later `Announced` and `Forgotten`, in order,
    /// outside the record's lock.
    pub fn subscribe(&self, listener: impl Fn(&FrameEvent) + Send + Sync + 'static);

    /// Sends to the frame of `cluster` alone; dropped if it has no frame.
    pub fn send_to<M: Serialize + 'static>(&self, cluster: &str, channel: MessageChannel<M>, message: &M);
    /// Sends to the frame of the visible cluster alone; dropped if there is none.
    pub fn send_to_visible<M: Serialize + 'static>(&self, channel: MessageChannel<M>, message: &M);
}

pub enum FrameEvent {
    Announced(String),
    Forgotten(String),
}
```

- Every read runs the idle check of the queues first, so a frame whose queue
  has closed is never reported (research R5).
- `announce` and `set_visible` are not public: only the two channels below
  change the record from the views.
- Subscribing happens at startup, before the window opens; a subscriber does
  not get the events that came before it subscribed.

## The two channels

| Channel                   | Kind | Accepted from                     | Payload               | Effect                                           | Otherwise                                                                                           |
| ------------------------- | ---- | --------------------------------- | --------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| `cluster:set-frame-id`    | req  | `View::Cluster(id)`, payload `id` | cluster id            | records the frame of `id`; no answer             | error `cluster:set-frame-id is answered only for the sending frame's own cluster`; nothing recorded |
| `current-visible-cluster` | msg  | `View::Main`                      | cluster id, or `null` | `visible` is the id if in the catalog, else none | dropped and logged                                                                                  |

Both log what they refuse ([frames-log.md](./frames-log.md)).

## What the later areas do with it

| Area                      | Use                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `main-catalog`            | `subscribe`, and on `Announced(id)` send the catalog, as `pushCatalogToRenderer` does in Electron |
| `main-cluster-connection` | `forget(id)` when it disconnects or deletes cluster `id`                                          |
| `desktop-integration`     | `send_to_visible` for `reload-page-channel` and `renderer:navigate-in-cluster`                    |
