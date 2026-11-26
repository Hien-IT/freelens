# Contract: Clusters and ShellEnv, for the Other Core Areas

Research R1 to R4, R10, R11. `Clusters` is built at startup after the
catalog, the stores and the frame record, and shared, cheap to clone, as
`Catalog`, `Stores` and `Frames` are. It replaces `KubeClusters` and the
`ClusterApi` trait of spec 001 (`src/clusters.rs`).

```rust
/// The login shell's environment of research R4, shared and read-only.
#[derive(Clone)]
pub struct ShellEnv { /* pending until the shell sync ends */ }

impl ShellEnv {
    /// Starts the shell sync on the runtime; returns at once.
    pub fn start(stores: &Stores, log: Log) -> Self;

    /// The merged environment, once the shell sync has ended or given up.
    pub async fn vars(&self) -> Arc<HashMap<OsString, OsString>>;

    /// The failure, taken once, for `shell-sync-failed-channel`.
    pub fn take_failure(&self) -> Option<String>;

    /// Kills the shell if it still runs.
    pub fn stop(&self);
}

#[derive(Clone)]
pub struct Clusters { /* the connections, their states, the deleting set */ }

impl Clusters {
    pub fn new(catalog: &Catalog, stores: &Stores, frames: &Frames,
               shell: &ShellEnv, sender: Sender, log: Log) -> Self;

    /// A client of the cluster's API server with the context's credentials,
    /// for the core's own requests: the status check, the accessibility, the
    /// detectors, `execute-on-cluster`, and later kubectl's and helm's routes.
    /// `ClientError::NotInCatalog` for a cluster not in the catalog,
    /// `ClientError::Disconnected` for one disconnected, and the reason when
    /// the client cannot be built, which the `/api-kube/` route answers.
    pub async fn client(&self, id: &str) -> Result<ClusterClient, ClientError>;

    /// The state of a cluster, as `cluster-state-sync` sends it.
    pub fn state(&self, id: &str) -> Option<ClusterState>;

    /// Calls `listener` after each change of a cluster's state, outside the lock.
    pub fn subscribe(&self, listener: impl Fn(&str, &ClusterState) + Send + Sync + 'static);

    /// Disconnects every cluster; for quitting.
    pub async fn disconnect_all(&self);
}

/// The client of one cluster; dropping a response future or body drops its
/// request.
#[derive(Clone)]
pub struct ClusterClient { /* kube::Client and the cluster's id */ }

impl ClusterClient {
    /// Sends a request as the /api-kube/ route sends it: the context's
    /// credentials added, no retry; the caller applies its own limits.
    pub async fn send(&self, request: http::Request<Vec<u8>>)
        -> Result<http::Response<kube::client::Body>, ClientError>;

    /// A request of the core's own with a JSON answer within 30 s, failing as
    /// `k8sRequest` fails: the body or the status text of a non-2xx answer.
    pub async fn request_json(&self, method: http::Method, path: &str, body: Option<&Value>)
        -> Result<Value, ClientError>;
}

/// Registers the channels of main-cluster-connection, the watch channels and
/// the /api-kube/ routes.
pub fn register(channels: &mut Channels, routes: &mut Routes, clusters: &Clusters)
    -> Result<(), RegisterError>;
```

Rules:

- No other area reads a kubeconfig file's credentials or runs a credential
  plugin: they ask `Clusters::client`.
- An area that starts a process for the user (kubectl, helm, a terminal) takes
  its environment from `ShellEnv::vars`, never from the core's own.
- A client is valid for one credential; an area that keeps one across a long
  task asks again after a `401`.
- `subscribe` listeners must not block; one that needs I/O spawns it.
