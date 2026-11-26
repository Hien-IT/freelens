/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The client of a cluster (`specs/009-main-cluster-connection/research.md`,
//! R2). Only the core holds the credentials of the kubeconfig file; a view
//! gets the API server's response and nothing else (FR-007).

use std::collections::HashMap;
use std::fmt;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use http::{Method, Request, Response};
use http_body_util::BodyExt;
use kube::client::Body;
use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::{Client, Config};
use serde_json::{Map, Value};

use super::exec::{Credential, Plugin, Runner};
use crate::catalog::{Catalog, CatalogEvent, ClusterSource};
use crate::foundation::shell_env::ShellEnv;
use k8s_openapi::jiff::Timestamp;

/// The limit of the core's own requests, as `k8sRequest` of the Electron
/// build has it (`main/k8s-request.injectable.ts`).
pub const REQUEST_LIMIT: Duration = Duration::from_secs(30);

/// How long a connection to the API server may take to open, as kube's
/// default and client-go's dial timeout have it.
const CONNECT_LIMIT: Duration = Duration::from_secs(30);

/// Why a request of the core did not get a 2xx answer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ClientError {
    /// The cluster is not in the catalog.
    NotInCatalog,
    /// The cluster is not connected.
    Disconnected,
    /// The client could not be built: the file or the context.
    Build(String),
    /// A credential plugin failed, in client-go's words (research R3).
    Credential(String),
    /// The connection failed: refused, a name not resolved, a certificate not
    /// trusted; the core's own words naming the cause (FR-002).
    Connect(String),
    /// The limit passed.
    Timeout,
    /// The API server answered another status: `error` is its body, trimmed,
    /// or the status text when the body is empty, as `k8sRequest` has it.
    Status { status: u16, error: String },
}

impl fmt::Display for ClientError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::NotInCatalog => f.write_str("the cluster is not in the catalog"),
            Self::Disconnected => f.write_str("the cluster is not connected"),
            Self::Build(reason) | Self::Credential(reason) | Self::Connect(reason) => {
                f.write_str(reason)
            }
            // The abort reason of `withTimeout`, which the connection
            // recognises as a timeout (`common/fetch/timeout-controller.ts`).
            Self::Timeout => f.write_str("Operation timed out: timeout 30s"),
            Self::Status { error, .. } => f.write_str(error),
        }
    }
}

impl ClientError {
    /// The message of `k8sRequest`'s error for a failed request.
    pub fn request_message(&self, method: &str, path: &str, cluster_id: &str) -> String {
        format!(
            "Failed to {} {path} for clusterId={cluster_id}: {self}",
            method.to_ascii_lowercase()
        )
    }

    pub fn status_code(&self) -> Option<u16> {
        match self {
            Self::Status { status, .. } => Some(*status),
            _ => None,
        }
    }
}

/// The text of an error and of its sources, joined as Go joins wrapped errors.
pub fn describe(error: &(dyn std::error::Error + 'static)) -> String {
    let mut text = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let cause_text = cause.to_string();
        if !text.contains(&cause_text) {
            text.push_str(": ");
            text.push_str(&cause_text);
        }
        source = cause.source();
    }
    text
}

/// The client of one cluster. Dropping a response future or body drops its
/// request.
#[derive(Clone)]
pub struct ClusterClient {
    id: String,
    client: Client,
    /// Drops the credential of a plugin after a `401` (research R3).
    on_unauthorized: Option<Arc<dyn Fn() + Send + Sync>>,
    /// The URL of the API server, as kube reads it from the kubeconfig.
    server: String,
    /// The limit of the core's own requests; shorter in tests.
    limit: Duration,
    /// Changes when the cluster disconnects.
    closed: tokio::sync::watch::Receiver<()>,
}

impl ClusterClient {
    pub fn id(&self) -> &str {
        &self.id
    }

    /// The URL of the API server, which a redirect of it is read against.
    pub fn server(&self) -> &str {
        &self.server
    }

    #[cfg(test)]
    fn with_limit(mut self, limit: Duration) -> Self {
        self.limit = limit;
        self
    }

    /// Resolves once the cluster disconnects, which ends every request of
    /// its clients in flight (FR-019).
    pub async fn closed(&self) {
        // A close sends; a sender dropped with its `Clients` closes nothing.
        if self.closed.clone().changed().await.is_err() {
            std::future::pending::<()>().await;
        }
    }

    /// Sends a request as the `/api-kube/` route sends it: the context's
    /// credentials added, no retry; the caller applies its own limits.
    pub async fn send(&self, request: Request<Vec<u8>>) -> Result<Response<Body>, ClientError> {
        let response = tokio::select! {
            () = self.closed() => return Err(ClientError::Disconnected),
            response = self.client.send(request.map(Body::from)) => response,
        }
        .map_err(|error| ClientError::Connect(describe(&error)))?;
        if response.status() == http::StatusCode::UNAUTHORIZED
            && let Some(renew) = &self.on_unauthorized
        {
            renew();
        }
        Ok(response)
    }

    /// A request of the core's own with a JSON answer, within
    /// [`REQUEST_LIMIT`], as `k8sRequest` sends it.
    pub async fn request_json(
        &self,
        method: Method,
        path: &str,
        body: Option<&Value>,
    ) -> Result<Value, ClientError> {
        let mut request = Request::builder().method(method).uri(path);
        let bytes = match body {
            Some(body) => {
                request = request.header(http::header::CONTENT_TYPE, "application/json");
                body.to_string().into_bytes()
            }
            None => Vec::new(),
        };
        let request = request
            .body(bytes)
            .map_err(|error| ClientError::Build(error.to_string()))?;
        let answer = async {
            let response = self.send(request).await?;
            let status = response.status();
            let body = response
                .into_body()
                .collect()
                .await
                .map_err(|error| ClientError::Connect(describe(&error)))?
                .to_bytes();
            if !status.is_success() {
                let text = String::from_utf8_lossy(&body).trim().to_string();
                let error = if text.is_empty() {
                    status.canonical_reason().unwrap_or_default().to_string()
                } else {
                    text
                };
                return Err(ClientError::Status {
                    status: status.as_u16(),
                    error,
                });
            }
            serde_json::from_slice(&body).map_err(|error| ClientError::Connect(error.to_string()))
        };
        tokio::time::timeout(self.limit, answer)
            .await
            .unwrap_or(Err(ClientError::Timeout))
    }

    /// `GET path` with a JSON answer.
    pub async fn get_json(&self, path: &str) -> Result<Value, ClientError> {
        self.request_json(Method::GET, path, None).await
    }
}

/// A client built, with the URL of its API server and the expiry of the
/// plugin's credential it holds, if any.
#[derive(Clone)]
struct Built {
    client: Client,
    server: String,
    expires_at: Option<Timestamp>,
    exec: bool,
}

/// The clients of the clusters, one per cluster id, built on first use from
/// the cluster's own kubeconfig file and context, and dropped when the
/// cluster changes or leaves the catalog, or its plugin's credential renews.
pub struct Clients {
    catalog: Catalog,
    clients: Arc<Mutex<HashMap<String, Built>>>,
    runner: Runner,
    /// Sent by a disconnect, which the clients of the cluster see.
    closers: Mutex<HashMap<String, tokio::sync::watch::Sender<()>>>,
}

impl Clients {
    pub fn new(catalog: &Catalog) -> Self {
        let clients: Arc<Mutex<HashMap<String, Built>>> = Arc::default();
        let dropping = Arc::clone(&clients);
        catalog.subscribe(move |event| {
            let (CatalogEvent::ClusterChanged(id) | CatalogEvent::ClusterRemoved(id)) = event;
            dropping.lock().expect("the clients lock").remove(id);
        });
        Self {
            catalog: catalog.clone(),
            clients,
            runner: Runner::default(),
            closers: Mutex::default(),
        }
    }

    /// The runs of the credential plugins.
    pub fn runner(&self) -> &Runner {
        &self.runner
    }

    /// Drops the client of `id`, so that the next request builds it again.
    pub fn drop_client(&self, id: &str) {
        self.clients.lock().expect("the clients lock").remove(id);
    }

    /// Ends every request in flight of the clients of `id`.
    pub fn close(&self, id: &str) {
        if let Some(closer) = self.closers.lock().expect("the closers lock").remove(id) {
            closer.send_replace(());
        }
    }

    fn handle(&self, id: &str, built: Built) -> ClusterClient {
        let on_unauthorized: Option<Arc<dyn Fn() + Send + Sync>> = built.exec.then(|| {
            let clients = Arc::clone(&self.clients);
            let runner = self.runner.clone();
            let id = id.to_string();
            Arc::new(move || {
                clients.lock().expect("the clients lock").remove(&id);
                runner.invalidate(&id);
            }) as Arc<dyn Fn() + Send + Sync>
        });
        ClusterClient {
            id: id.to_string(),
            client: built.client,
            on_unauthorized,
            server: built.server,
            limit: REQUEST_LIMIT,
            closed: self
                .closers
                .lock()
                .expect("the closers lock")
                .entry(id.to_string())
                .or_insert_with(|| tokio::sync::watch::channel(()).0)
                .subscribe(),
        }
    }

    /// The client of the cluster `id` of the catalog; a context with `exec`
    /// gets its credential from the plugin, run with `shell`'s environment.
    pub async fn client(&self, id: &str, shell: &ShellEnv) -> Result<ClusterClient, ClientError> {
        let cluster = self.catalog.cluster(id).ok_or(ClientError::NotInCatalog)?;
        let cached = self
            .clients
            .lock()
            .expect("the clients lock")
            .get(id)
            .cloned();
        if let Some(built) = cached {
            let fresh = built.expires_at.is_none_or(|expiry| {
                Credential {
                    token: None,
                    client_tls: None,
                    expires_at: Some(expiry),
                }
                .is_fresh(Timestamp::now())
            });
            if fresh {
                return Ok(self.handle(id, built));
            }
            self.drop_client(id);
        }
        let https_proxy = self
            .catalog
            .store_entry(id)
            .and_then(|entry| https_proxy_setting(&entry));
        // The file holds credentials; the parser's text, which can quote it,
        // goes to no view.
        let kubeconfig = Kubeconfig::read_from(&cluster.kubeconfig_path).map_err(|error| {
            ClientError::Build(format!("cannot read the kubeconfig file: {error}"))
        })?;
        let (kubeconfig, credential) = match exec_of(&kubeconfig, &cluster) {
            Some(plugin) => {
                let credential = self
                    .runner
                    .credential(id, &plugin, shell)
                    .await
                    .map_err(ClientError::Credential)?;
                (
                    with_credential(kubeconfig, &cluster.context_name, &credential)?,
                    Some(credential),
                )
            }
            None => (kubeconfig, None),
        };
        let config = config_from(kubeconfig, &cluster.context_name, https_proxy.as_deref()).await?;
        let server = config.cluster_url.to_string();
        let client =
            Client::try_from(config).map_err(|error| ClientError::Build(describe(&error)))?;
        let built = Built {
            client,
            server,
            expires_at: credential
                .as_ref()
                .and_then(|credential| credential.expires_at),
            exec: credential.is_some(),
        };
        self.clients
            .lock()
            .expect("the clients lock")
            .insert(id.to_string(), built.clone());
        Ok(self.handle(id, built))
    }
}

/// The named user and cluster of `context`, as JSON.
fn context_entries(kubeconfig: &Kubeconfig, context: &str) -> Option<(Value, Value, String)> {
    let named = kubeconfig
        .contexts
        .iter()
        .find(|named| named.name == context)?;
    let entry = named.context.as_ref()?;
    let user_name = entry.user.clone()?;
    let user = kubeconfig
        .auth_infos
        .iter()
        .find(|named| named.name == user_name)?
        .auth_info
        .as_ref()
        .and_then(|info| serde_json::to_value(info).ok())?;
    let cluster = kubeconfig
        .clusters
        .iter()
        .find(|named| named.name == entry.cluster)
        .and_then(|named| named.cluster.as_ref())
        .and_then(|cluster| serde_json::to_value(cluster).ok())
        .unwrap_or(Value::Null);
    Some((user, cluster, user_name))
}

/// The plugin of the context's user, if it has `exec`.
fn exec_of(kubeconfig: &Kubeconfig, cluster: &ClusterSource) -> Option<Plugin> {
    let (user, cluster_entry, _) = context_entries(kubeconfig, &cluster.context_name)?;
    let exec = user.get("exec")?;
    let base_dir = cluster
        .kubeconfig_path
        .parent()
        .map(std::path::Path::to_path_buf)
        .unwrap_or_default();
    let mut info = serde_json::json!({});
    for (from, to) in [
        ("server", "server"),
        ("tls-server-name", "tls-server-name"),
        ("insecure-skip-tls-verify", "insecure-skip-tls-verify"),
        ("certificate-authority-data", "certificate-authority-data"),
        ("proxy-url", "proxy-url"),
    ] {
        if let Some(value) = cluster_entry.get(from) {
            info[to] = value.clone();
        }
    }
    Plugin::from_kubeconfig(exec, &info, &base_dir)
}

/// `kubeconfig` with the plugin's credential in place of the `exec` of the
/// context's user: a client certificate and key, else a token.
fn with_credential(
    kubeconfig: Kubeconfig,
    context: &str,
    credential: &Credential,
) -> Result<Kubeconfig, ClientError> {
    let Some((_, _, user_name)) = context_entries(&kubeconfig, context) else {
        return Ok(kubeconfig);
    };
    let mut json =
        serde_json::to_value(&kubeconfig).map_err(|error| ClientError::Build(error.to_string()))?;
    if let Some(users) = json.get_mut("users").and_then(Value::as_array_mut) {
        for named in users
            .iter_mut()
            .filter(|named| named["name"] == user_name.as_str())
        {
            let mut user = serde_json::Map::new();
            match &credential.client_tls {
                Some((cert, key)) => {
                    user.insert(
                        "client-certificate-data".into(),
                        Value::from(base64(cert.as_bytes())),
                    );
                    user.insert(
                        "client-key-data".into(),
                        Value::from(base64(key.as_bytes())),
                    );
                }
                None => {
                    if let Some(token) = &credential.token {
                        user.insert("token".into(), Value::from(token.clone()));
                    }
                }
            }
            named["user"] = Value::Object(user);
        }
    }
    serde_json::from_value(json).map_err(|error| ClientError::Build(error.to_string()))
}

/// Standard base64 with padding, for the `-data` fields.
fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        for i in 0..4 {
            out.push(if i <= chunk.len() {
                TABLE[(n >> (18 - 6 * i) & 63) as usize] as char
            } else {
                '='
            });
        }
    }
    out
}

/// What the connection reads of a cluster's context: whether its user runs a
/// credential plugin, its namespace and the URL of its server.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ContextFacts {
    pub uses_exec: bool,
    pub namespace: Option<String>,
    pub server: Option<String>,
}

/// The facts of `cluster`'s context, read from its file now; the default
/// when the file or the context cannot be read.
pub fn context_facts(cluster: &ClusterSource) -> ContextFacts {
    let Ok(kubeconfig) = Kubeconfig::read_from(&cluster.kubeconfig_path) else {
        return ContextFacts::default();
    };
    let Some(entry) = kubeconfig
        .contexts
        .iter()
        .find(|named| named.name == cluster.context_name)
        .and_then(|named| named.context.as_ref())
    else {
        return ContextFacts::default();
    };
    let uses_exec = entry.user.as_ref().is_some_and(|user| {
        kubeconfig.auth_infos.iter().any(|named| {
            named.name == *user
                && named
                    .auth_info
                    .as_ref()
                    .is_some_and(|info| info.exec.is_some())
        })
    });
    let server = kubeconfig
        .clusters
        .iter()
        .find(|named| named.name == entry.cluster)
        .and_then(|named| named.cluster.as_ref())
        .and_then(|cluster| cluster.server.clone());
    ContextFacts {
        uses_exec,
        namespace: entry.namespace.clone(),
        server,
    }
}

/// The `httpsProxy` of a cluster store entry's preferences, if set.
fn https_proxy_setting(entry: &Map<String, Value>) -> Option<String> {
    entry
        .get("preferences")?
        .get("httpsProxy")?
        .as_str()
        .filter(|proxy| !proxy.trim().is_empty())
        .map(str::to_string)
}

/// The kube configuration of a cluster's context (research R2): no retry, a
/// connect limit and no read limit, and the proxy of the kubeconfig, else the
/// cluster's `httpsProxy` setting, else kube's own reading of `HTTPS_PROXY`.
pub async fn config(
    cluster: &ClusterSource,
    https_proxy: Option<&str>,
) -> Result<Config, ClientError> {
    // The file holds credentials; the parser's text, which can quote it, goes
    // to no view.
    let kubeconfig = Kubeconfig::read_from(&cluster.kubeconfig_path)
        .map_err(|error| ClientError::Build(format!("cannot read the kubeconfig file: {error}")))?;
    config_from(kubeconfig, &cluster.context_name, https_proxy).await
}

/// `config` from a kubeconfig already read.
async fn config_from(
    kubeconfig: Kubeconfig,
    context: &str,
    https_proxy: Option<&str>,
) -> Result<Config, ClientError> {
    let has_proxy_url = kubeconfig_proxy_url(&kubeconfig, context).is_some();
    let options = KubeConfigOptions {
        context: Some(context.to_string()),
        ..KubeConfigOptions::default()
    };
    let mut config = Config::from_custom_kubeconfig(kubeconfig, &options)
        .await
        .map_err(|error| ClientError::Build(describe(&error)))?;
    config.default_retry = false;
    config.connect_timeout = Some(CONNECT_LIMIT);
    config.read_timeout = None;
    config.write_timeout = None;
    if !has_proxy_url && let Some(proxy) = https_proxy {
        config.proxy_url = Some(
            proxy
                .parse()
                .map_err(|_| ClientError::Build("the HTTPS proxy setting is not a URL".into()))?,
        );
    }
    Ok(config)
}

/// The `proxy-url` of the cluster of `context` in `kubeconfig`.
fn kubeconfig_proxy_url(kubeconfig: &Kubeconfig, context: &str) -> Option<String> {
    let cluster_name = kubeconfig
        .contexts
        .iter()
        .find(|named| named.name == context)?
        .context
        .as_ref()?
        .cluster
        .clone();
    kubeconfig
        .clusters
        .iter()
        .find(|named| named.name == cluster_name)?
        .cluster
        .as_ref()?
        .proxy_url
        .clone()
        .filter(|proxy| !proxy.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cluster::fake_api::{
        self, Answer, ConnectProxy, Context, FakeApi, Tls, User, temp_dir, write_kubeconfig,
    };
    use serde_json::json;

    fn shell() -> ShellEnv {
        ShellEnv::ready(crate::foundation::shell_env::process_env())
    }

    /// A catalog of the contexts of `file`.
    fn catalog(file: &std::path::Path) -> Catalog {
        Catalog::from_kubeconfig_file(file)
    }

    async fn client_of(catalog: &Catalog, index: usize) -> ClusterClient {
        Clients::new(catalog)
            .client(&catalog.cluster_ids()[index], &shell())
            .await
            .unwrap()
    }

    // pc/main/k8s-request.test.ts

    #[tokio::test]
    async fn a_200_answers_the_json() {
        let dir = temp_dir("client-200");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let client = client_of(&catalog(&file), 0).await;
        assert_eq!(
            client.get_json("/version").await,
            Ok(json!({"gitVersion": "v1"}))
        );
    }

    #[tokio::test]
    async fn a_500_with_a_body_fails_with_the_body_trimmed() {
        let dir = temp_dir("client-500");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set("GET", "/version", Answer::text(500, "  some-error\n"));
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let client = client_of(&catalog(&file), 0).await;
        let error = client.get_json("/version").await.unwrap_err();
        assert_eq!(
            error,
            ClientError::Status {
                status: 500,
                error: "some-error".into()
            }
        );
        assert_eq!(error.status_code(), Some(500));
        assert_eq!(
            error.request_message("GET", "/version", "some-cluster-id"),
            "Failed to get /version for clusterId=some-cluster-id: some-error"
        );
    }

    #[tokio::test]
    async fn a_502_with_an_empty_body_fails_with_the_status_text() {
        let dir = temp_dir("client-502");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set("GET", "/version", Answer::text(502, ""));
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let client = client_of(&catalog(&file), 0).await;
        let error = client.get_json("/version").await.unwrap_err();
        assert_eq!(
            error,
            ClientError::Status {
                status: 502,
                error: "Bad Gateway".into()
            }
        );
        assert_eq!(
            error.request_message("GET", "/version", "id"),
            "Failed to get /version for clusterId=id: Bad Gateway"
        );
    }

    #[tokio::test]
    async fn the_core_s_own_request_gives_up_at_its_limit() {
        let dir = temp_dir("client-timeout");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set("GET", "/version", Answer::Hang);
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        assert_eq!(REQUEST_LIMIT, Duration::from_secs(30));
        let client = client_of(&catalog(&file), 0)
            .await
            .with_limit(Duration::from_millis(200));
        let error = client.get_json("/version").await.unwrap_err();
        assert_eq!(error, ClientError::Timeout);
        assert_eq!(error.to_string(), "Operation timed out: timeout 30s");
    }

    // pc/features/cluster/connections/main/__tests__/api-url.test.ts

    #[tokio::test]
    async fn a_changed_server_reaches_the_next_request_once_the_catalog_reports_it() {
        let dir = temp_dir("client-changed");
        let old = FakeApi::start(Tls::None, &dir).await;
        let new = FakeApi::start(Tls::None, &dir).await;
        for api in [&old, &new] {
            api.set(
                "GET",
                "/version",
                Answer::json(200, json!({"gitVersion": "v1"})),
            );
        }
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&old), &[Context::new("a", &old, User::None)]);
        let catalog = catalog(&file);
        let id = catalog.cluster_ids()[0].clone();
        let clients = Clients::new(&catalog);

        clients
            .client(&id, &shell())
            .await
            .unwrap()
            .get_json("/version")
            .await
            .unwrap();
        clients
            .client(&id, &shell())
            .await
            .unwrap()
            .get_json("/version")
            .await
            .unwrap();
        assert_eq!(old.requests_of("/version").len(), 2);

        write_kubeconfig(&file, Some(&new), &[Context::new("a", &new, User::None)]);
        // Unchanged as long as the catalog reports nothing.
        clients
            .client(&id, &shell())
            .await
            .unwrap()
            .get_json("/version")
            .await
            .unwrap();
        assert_eq!(old.requests_of("/version").len(), 3);

        clients.drop_client(&id);
        clients
            .client(&id, &shell())
            .await
            .unwrap()
            .get_json("/version")
            .await
            .unwrap();
        assert_eq!(new.requests_of("/version").len(), 1);
    }

    // Research R2

    #[tokio::test]
    async fn no_status_of_the_api_server_is_retried() {
        let dir = temp_dir("client-no-retry");
        let api = FakeApi::start(Tls::None, &dir).await;
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let client = client_of(&catalog(&file), 0).await;
        for (status, method) in [
            (503, Method::GET),
            (429, Method::POST),
            (504, Method::DELETE),
        ] {
            api.clear_requests();
            api.set(
                method.as_str(),
                "/api/v1/pods",
                Answer::text(status, "busy"),
            );
            let request = Request::builder()
                .method(method.clone())
                .uri("/api/v1/pods")
                .body(Vec::new())
                .unwrap();
            let response = client.send(request).await.unwrap();
            assert_eq!(response.status().as_u16(), status);
            assert_eq!(
                api.requests_of("/api/v1/pods").len(),
                1,
                "{method} {status}"
            );
        }
    }

    #[tokio::test]
    async fn the_client_neither_retries_nor_cuts_a_quiet_answer() {
        let dir = temp_dir("client-config");
        let api = FakeApi::start(Tls::None, &dir).await;
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let cluster = catalog(&file).clusters()[0].clone();
        let config = config(&cluster, None).await.unwrap();
        assert!(!config.default_retry);
        assert_eq!(config.read_timeout, None);
        assert_eq!(config.write_timeout, None);
        assert_eq!(config.connect_timeout, Some(Duration::from_secs(30)));
    }

    #[tokio::test]
    async fn the_proxy_url_of_the_kubeconfig_wins_over_the_https_proxy_setting() {
        let dir = temp_dir("client-proxy-url");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
        let kubeconfig_proxy = ConnectProxy::start().await;
        let setting_proxy = ConnectProxy::start().await;
        let file = dir.join("config");
        let mut context = Context::new("a", &api, User::None);
        context.proxy_url = Some(kubeconfig_proxy.url());
        write_kubeconfig(&file, Some(&api), &[context]);
        let cluster = catalog(&file).clusters()[0].clone();

        let config = config(&cluster, Some(&setting_proxy.url())).await.unwrap();
        let client = Client::try_from(config).unwrap();
        client.apiserver_version().await.unwrap();

        assert_eq!(
            kubeconfig_proxy.targets(),
            [format!("127.0.0.1:{}", api.port)]
        );
        assert!(setting_proxy.targets().is_empty());
    }

    #[tokio::test]
    async fn the_https_proxy_setting_is_used_without_a_proxy_url() {
        let dir = temp_dir("client-proxy-setting");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.set(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
        let setting_proxy = ConnectProxy::start().await;
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let cluster = catalog(&file).clusters()[0].clone();

        let config = config(&cluster, Some(&setting_proxy.url())).await.unwrap();
        let client = Client::try_from(config).unwrap();
        client.apiserver_version().await.unwrap();

        assert_eq!(setting_proxy.targets(), [format!("127.0.0.1:{}", api.port)]);
    }

    #[test]
    fn the_https_proxy_setting_comes_from_the_entry_s_preferences() {
        let entry = |preferences: Value| {
            json!({"id": "x", "preferences": preferences})
                .as_object()
                .unwrap()
                .clone()
        };
        assert_eq!(
            https_proxy_setting(&entry(json!({"httpsProxy": "http://p:1"}))),
            Some("http://p:1".into())
        );
        assert_eq!(
            https_proxy_setting(&entry(json!({"httpsProxy": " "}))),
            None
        );
        assert_eq!(https_proxy_setting(&entry(json!({}))), None);
    }

    #[tokio::test]
    async fn the_client_is_dropped_when_the_cluster_leaves_the_catalog() {
        let dir = temp_dir("client-removed");
        let api = FakeApi::start(Tls::None, &dir).await;
        let file = dir.join("config");
        write_kubeconfig(&file, Some(&api), &[Context::new("a", &api, User::None)]);
        let catalog = catalog(&file);
        let id = catalog.cluster_ids()[0].clone();
        let clients = Clients::new(&catalog);
        clients.client(&id, &shell()).await.unwrap();
        assert!(clients.clients.lock().unwrap().contains_key(&id));

        catalog.set_clusters(Vec::new(), &Default::default());

        assert!(!clients.clients.lock().unwrap().contains_key(&id));
        assert_eq!(
            clients.client(&id, &shell()).await.err(),
            Some(ClientError::NotInCatalog)
        );
    }

    // Each credential kind of the kubeconfig (FR-006)

    async fn first_request(api: &FakeApi, user: User) -> fake_api::Recorded {
        let dir = temp_dir("client-credential");
        api.set(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
        api.clear_requests();
        let file = dir.join("config");
        write_kubeconfig(&file, Some(api), &[Context::new("a", api, user)]);
        let client = client_of(&catalog(&file), 0).await;
        client.get_json("/version").await.unwrap();
        api.requests_of("/version").remove(0)
    }

    #[tokio::test]
    async fn each_credential_kind_reaches_the_api_server() {
        let dir = temp_dir("client-credentials");
        let api = FakeApi::start(Tls::ClientAuth, &dir).await;

        let request = first_request(&api, User::Token(fake_api::TOKEN.into())).await;
        assert_eq!(
            request.header("authorization"),
            Some(format!("Bearer {}", fake_api::TOKEN).as_str())
        );

        let token_file = dir.join("token");
        std::fs::write(&token_file, fake_api::FILE_TOKEN).unwrap();
        let request = first_request(&api, User::TokenFile(token_file)).await;
        assert_eq!(
            request.header("authorization"),
            Some(format!("Bearer {}", fake_api::FILE_TOKEN).as_str())
        );

        let request = first_request(
            &api,
            User::Basic {
                username: "user".into(),
                password: fake_api::PASSWORD.into(),
            },
        )
        .await;
        let basic = fake_api::base64(format!("user:{}", fake_api::PASSWORD).as_bytes());
        assert_eq!(
            request.header("authorization"),
            Some(format!("Basic {basic}").as_str())
        );

        let request = first_request(
            &api,
            User::Oidc {
                id_token: fake_api::ID_TOKEN.into(),
            },
        )
        .await;
        assert_eq!(
            request.header("authorization"),
            Some(format!("Bearer {}", fake_api::ID_TOKEN).as_str())
        );

        let request = first_request(
            &api,
            User::Impersonate {
                token: fake_api::TOKEN.into(),
                user: "someone".into(),
                groups: vec!["team".into()],
            },
        )
        .await;
        assert_eq!(request.header("impersonate-user"), Some("someone"));
        assert_eq!(request.header("impersonate-group"), Some("team"));

        let request = first_request(&api, User::ClientCert).await;
        assert_eq!(
            request.client_cert.as_deref(),
            Some(
                api.certificates
                    .as_ref()
                    .unwrap()
                    .client_cert_der
                    .as_slice()
            )
        );
        assert_eq!(request.header("authorization"), None);
    }

    // A context with exec (research R3)

    #[tokio::test]
    async fn a_401_drops_the_plugin_s_credential_and_the_next_client_runs_it_again() {
        use crate::cluster::fake_api::{Exec, Plugin as Script, plugin_runs, write_plugin};
        let dir = temp_dir("client-exec-401");
        let api = FakeApi::start(Tls::None, &dir).await;
        api.answer(
            "GET",
            "/version",
            Answer::status(401, "Unauthorized", "expired"),
        );
        api.answer(
            "GET",
            "/version",
            Answer::json(200, json!({"gitVersion": "v1"})),
        );
        let plugin = write_plugin(
            &dir,
            "login",
            &Script::Token {
                token: crate::cluster::fake_api::EXEC_TOKEN.into(),
                expires: None,
            },
            None,
        );
        let file = dir.join("config");
        write_kubeconfig(
            &file,
            Some(&api),
            &[Context::new(
                "a",
                &api,
                User::Exec(Exec::new(plugin.to_string_lossy())),
            )],
        );
        let catalog = catalog(&file);
        let id = catalog.cluster_ids()[0].clone();
        let clients = Clients::new(&catalog);

        let client = clients.client(&id, &shell()).await.unwrap();
        assert_eq!(
            client.get_json("/version").await.unwrap_err().status_code(),
            Some(401)
        );
        assert_eq!(
            api.requests_of("/version")[0].header("authorization"),
            Some(format!("Bearer {}", crate::cluster::fake_api::EXEC_TOKEN).as_str())
        );
        assert_eq!(plugin_runs(&dir, "login"), 1);

        let client = clients.client(&id, &shell()).await.unwrap();
        client.get_json("/version").await.unwrap();
        assert_eq!(plugin_runs(&dir, "login"), 2);
    }

    #[tokio::test]
    async fn a_failing_plugin_is_a_credential_error_of_the_client() {
        use crate::cluster::fake_api::{Exec, Plugin as Script, write_plugin};
        let dir = temp_dir("client-exec-fails");
        let api = FakeApi::start(Tls::None, &dir).await;
        let plugin = write_plugin(
            &dir,
            "login",
            &Script::Fail {
                code: 2,
                message: "no".into(),
            },
            None,
        );
        let file = dir.join("config");
        write_kubeconfig(
            &file,
            Some(&api),
            &[Context::new(
                "a",
                &api,
                User::Exec(Exec::new(plugin.to_string_lossy())),
            )],
        );
        let catalog = catalog(&file);
        let error = Clients::new(&catalog)
            .client(&catalog.cluster_ids()[0], &shell())
            .await
            .err()
            .unwrap();
        assert_eq!(
            error,
            ClientError::Credential(format!(
                "getting credentials: exec: executable {} failed with exit code 2",
                plugin.display()
            ))
        );
        assert!(api.requests().is_empty());
    }
}
