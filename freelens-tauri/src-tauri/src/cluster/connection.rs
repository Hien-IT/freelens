/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The connection of one cluster
//! (`specs/009-main-cluster-connection/contracts/connection.md`, research
//! R5), as `ClusterConnection` of the Electron build has it: the activation,
//! the status check and its classification, the backoff, the timers, the
//! accessibility and the metadata, and the disconnect.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures::FutureExt;
use futures::future::{BoxFuture as SharedBox, Shared};
use http::Method;
use serde::Serialize;
use serde_json::{Map, Value};
use tokio::task::AbortHandle;
use tokio::time::Instant;

use super::access::{self, Api, KnownResource, Report, Settings};
use super::client::REQUEST_LIMIT;
use super::{BoxFuture, ClientError, detect};

/// What a view gets on `cluster-state-sync`, in this field order
/// (data-model.md, ClusterState).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClusterState {
    pub online: bool,
    pub ready: bool,
    pub disconnected: bool,
    pub accessible: bool,
    pub is_admin: bool,
    pub allowed_namespaces: Vec<String>,
    pub resources_to_show: Vec<String>,
    pub known_resources: Vec<KnownResource>,
    pub is_global_watch_enabled: bool,
}

impl Default for ClusterState {
    fn default() -> Self {
        Self {
            online: false,
            ready: false,
            disconnected: true,
            accessible: false,
            is_admin: false,
            allowed_namespaces: Vec::new(),
            resources_to_show: Vec::new(),
            known_resources: Vec::new(),
            is_global_watch_enabled: false,
        }
    }
}

/// The level of a connection update.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Level {
    Info,
    Warning,
    Error,
}

/// `{ message, level }` on `cluster:<clusterId>:connection-update`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ConnectionUpdate {
    pub message: String,
    pub level: Level,
}

impl ConnectionUpdate {
    pub fn info(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            level: Level::Info,
        }
    }

    pub fn warning(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            level: Level::Warning,
        }
    }

    pub fn error(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
            level: Level::Error,
        }
    }
}

/// The status a check finds (`ClusterStatus`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    Offline,
    AccessDenied,
    AccessGranted,
}

/// What the connection needs of the rest of the core.
pub trait Backend: Api + Report {
    /// Builds the client of the cluster, as the Electron build starts its
    /// proxy; the reason when it cannot.
    fn build(&self) -> BoxFuture<'_, Result<(), ClientError>>;
    /// Whether the context's user runs a credential plugin.
    fn uses_exec(&self) -> bool;
    fn settings(&self) -> Settings;
    fn context_name(&self) -> String;
    fn server(&self) -> String;
    fn update(&self, update: ConnectionUpdate);
    fn state_changed(&self, state: &ClusterState);
    /// Writes `metadata` into the cluster store entry, merged into it or
    /// replacing it.
    fn metadata(&self, metadata: Map<String, Value>, replace: bool);
    /// Drops the client, stops a credential plugin run and ends the requests
    /// in flight, as stopping the proxy does.
    fn disconnected(&self);
}

/// The texts by which a failure reads as a credential plugin's
/// (`credentialPluginErrorPatterns`).
pub fn is_plugin_error(text: &str) -> bool {
    let text = text.to_ascii_lowercase();
    ["getting credentials", "exec plugin", "credential plugin"]
        .iter()
        .any(|pattern| text.contains(pattern))
}

/// The timers' periods and the backoff (`cluster-connection.injectable.ts`).
pub const REFRESH_EVERY: Duration = Duration::from_secs(30);
pub const ACCESSIBILITY_EVERY: Duration = Duration::from_secs(15 * 60);
pub const MAX_AUTO_AUTH_RETRIES: u32 = 3;
pub const AUTH_BACKOFF: [Duration; 2] = [Duration::from_secs(60), Duration::from_secs(300)];

#[derive(Default)]
struct Inner {
    state: ClusterState,
    activated: bool,
    /// Raised by a disconnect; an activation of an older generation applies
    /// nothing more (data-model.md, `Connection.generation`).
    generation: u64,
    consecutive_auth_failures: u32,
    next_refresh_allowed_at: Option<Instant>,
    refreshing: bool,
    timers: Option<AbortHandle>,
    activation: Option<Shared<SharedBox<'static, ()>>>,
}

/// One cluster's connection (data-model.md, Connection).
pub struct Connection {
    backend: Arc<dyn Backend>,
    inner: Mutex<Inner>,
}

impl Connection {
    pub fn new(backend: Arc<dyn Backend>) -> Arc<Self> {
        Arc::new(Self {
            backend,
            inner: Mutex::new(Inner::default()),
        })
    }

    fn inner(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().expect("the connection lock")
    }

    pub fn state(&self) -> ClusterState {
        self.inner().state.clone()
    }

    pub fn is_activated(&self) -> bool {
        self.inner().activated
    }

    fn log(&self, line: String) {
        self.backend.log(line);
    }

    /// Changes the state, unless a disconnect came after `generation`, and
    /// reports it.
    fn change(&self, generation: Option<u64>, change: impl FnOnce(&mut ClusterState)) {
        let state = {
            let mut inner = self.inner();
            if generation.is_some_and(|generation| generation != inner.generation) {
                return;
            }
            change(&mut inner.state);
            inner.state.clone()
        };
        self.backend.state_changed(&state);
    }

    /// `activate(force)`: an activated cluster is left alone unless forced; an
    /// activation in flight is shared; a forced one waits for it, then runs.
    pub async fn activate(self: &Arc<Self>, force: bool) {
        let in_flight = {
            let inner = self.inner();
            if inner.activated && !force {
                return;
            }
            inner.activation.clone()
        };
        if let Some(activation) = in_flight {
            activation.await;
            if !force {
                return;
            }
        }
        let running = {
            let mut inner = self.inner();
            if !force && let Some(activation) = inner.activation.clone() {
                activation
            } else {
                let connection = Arc::clone(self);
                let activation = async move { connection.run_activation().await }
                    .boxed()
                    .shared();
                inner.activation = Some(activation.clone());
                activation
            }
        };
        running.clone().await;
        let mut inner = self.inner();
        if inner
            .activation
            .as_ref()
            .is_some_and(|activation| activation.ptr_eq(&running))
        {
            inner.activation = None;
        }
    }

    async fn run_activation(self: Arc<Self>) {
        self.log("[CLUSTER]: activate".into());
        self.bind_events();
        let generation = self.inner().generation;
        let (disconnected, accessible) = {
            let state = &self.inner().state;
            (state.disconnected, state.accessible)
        };
        if disconnected || !accessible {
            self.backend
                .update(ConnectionUpdate::info("Starting connection ..."));
            if let Err(error) = self.reconnect(Some(generation)).await {
                self.backend.update(ConnectionUpdate::error(format!(
                    "Failed to start connection: Error: {error}"
                )));
                return;
            }
        }
        self.backend
            .update(ConnectionUpdate::info("Refreshing connection status ..."));
        self.refresh_connection_status(Some(generation)).await;
        if self.inner().state.accessible {
            self.backend.update(ConnectionUpdate::info(
                "Refreshing cluster accessibility ...",
            ));
            self.refresh_accessibility(Some(generation)).await;
            self.backend.update(ConnectionUpdate::info(
                "Connected, waiting for view to load ...",
            ));
        }
        let mut inner = self.inner();
        if inner.generation == generation {
            inner.activated = true;
        }
    }

    /// Binds the two timers, once per connection (research R5).
    fn bind_events(self: &Arc<Self>) {
        let mut inner = self.inner();
        if inner.timers.is_some() {
            return;
        }
        self.backend.log("[CLUSTER]: bind events".into());
        let weak = Arc::downgrade(self);
        // The periods count from now, as `setInterval` counts them.
        let mut refresh = tokio::time::interval_at(Instant::now() + REFRESH_EVERY, REFRESH_EVERY);
        let mut accessibility =
            tokio::time::interval_at(Instant::now() + ACCESSIBILITY_EVERY, ACCESSIBILITY_EVERY);
        let timers = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = refresh.tick() => {
                        let Some(connection) = weak.upgrade() else { return };
                        if !connection.inner().state.disconnected && connection.should_attempt_auto_refresh() {
                            let running = Arc::clone(&connection);
                            tokio::spawn(async move { running.refresh().await });
                        }
                    }
                    _ = accessibility.tick() => {
                        let Some(connection) = weak.upgrade() else { return };
                        let available = {
                            let state = &connection.inner().state;
                            state.accessible && !state.disconnected
                        };
                        if available {
                            let running = Arc::clone(&connection);
                            tokio::spawn(async move { running.refresh_accessibility_and_metadata().await });
                        }
                    }
                }
            }
        });
        inner.timers = Some(timers.abort_handle());
    }

    fn should_attempt_auto_refresh(&self) -> bool {
        let inner = self.inner();
        if inner.consecutive_auth_failures >= MAX_AUTO_AUTH_RETRIES {
            return false;
        }
        inner.consecutive_auth_failures == 0
            || inner
                .next_refresh_allowed_at
                .is_none_or(|allowed| Instant::now() >= allowed)
    }

    fn reset_auth_failures(&self) {
        let mut inner = self.inner();
        inner.consecutive_auth_failures = 0;
        inner.next_refresh_allowed_at = None;
    }

    fn on_auth_failure(&self) {
        let (failures, backoff) = {
            let mut inner = self.inner();
            inner.consecutive_auth_failures += 1;
            let failures = inner.consecutive_auth_failures;
            let backoff = AUTH_BACKOFF[(failures as usize - 1).min(AUTH_BACKOFF.len() - 1)];
            inner.next_refresh_allowed_at = Some(Instant::now() + backoff);
            (failures, backoff)
        };
        let context = self.backend.context_name();
        if failures >= MAX_AUTO_AUTH_RETRIES {
            self.log(format!(
                "[CLUSTER]: authentication failed {failures} times for \"{context}\", pausing automatic refresh until reconnect"
            ));
            self.backend.update(ConnectionUpdate::error(format!(
                "Authentication failed {failures} times, automatic reconnection paused: reconnect to try again"
            )));
        } else {
            self.log(format!(
                "[CLUSTER]: authentication failure #{failures} for \"{context}\", next automatic attempt in {}s",
                backoff.as_secs()
            ));
        }
    }

    fn on_auth_success(&self) {
        let failures = self.inner().consecutive_auth_failures;
        if failures > 0 {
            self.log(format!(
                "[CLUSTER]: authentication succeeded after {failures} consecutive failure(s)"
            ));
        }
        self.reset_auth_failures();
    }

    async fn reconnect(&self, generation: Option<u64>) -> Result<(), ClientError> {
        self.log("[CLUSTER]: reconnect".into());
        self.reset_auth_failures();
        self.backend.build().await?;
        self.change(generation, |state| state.disconnected = false);
        Ok(())
    }

    /// The 30 s refresh.
    pub async fn refresh(&self) {
        self.log("[CLUSTER]: refresh".into());
        self.refresh_connection_status(None).await;
    }

    async fn refresh_connection_status(&self, generation: Option<u64>) {
        {
            let mut inner = self.inner();
            if inner.refreshing {
                return;
            }
            inner.refreshing = true;
        }
        let status = self.connection_status().await;
        self.inner().refreshing = false;
        self.change(generation, |state| {
            state.online = status != Status::Offline;
            state.accessible = status == Status::AccessGranted;
        });
    }

    /// The status check: `GET /version` within 30 s, classified as the
    /// Electron build classifies its failures (contracts/connection.md).
    pub async fn connection_status(&self) -> Status {
        let answer = tokio::time::timeout(
            REQUEST_LIMIT,
            self.backend.request(Method::GET, "/version", None),
        )
        .await
        .unwrap_or(Err(ClientError::Timeout));
        let error = match answer {
            Ok(version) => {
                let mut metadata = Map::new();
                if let Some(git_version) = version.get("gitVersion") {
                    metadata.insert("version".into(), git_version.clone());
                }
                metadata.insert("lastSeen".into(), Value::from(detect::now_json()));
                self.backend.metadata(metadata, false);
                self.on_auth_success();
                return Status::AccessGranted;
            }
            Err(error) => error,
        };
        self.log(format!(
            "[CLUSTER]: Failed to connect to \"{}\": {error}",
            self.backend.context_name()
        ));
        match error {
            ClientError::Status { status, .. } if (400..500).contains(&status) => {
                self.backend
                    .update(ConnectionUpdate::error("Invalid credentials"));
                self.on_auth_failure();
                Status::AccessDenied
            }
            ClientError::Status { error, .. } | ClientError::Credential(error)
                if is_plugin_error(&error) =>
            {
                self.backend.update(ConnectionUpdate::error(format!(
                    "Failed to fetch credentials: {error}"
                )));
                self.on_auth_failure();
                Status::AccessDenied
            }
            ClientError::Timeout => {
                if self.backend.uses_exec() {
                    self.backend.update(ConnectionUpdate::error(
                        "Connection timed out, the credential plugin may be waiting for an interactive login",
                    ));
                    self.on_auth_failure();
                } else {
                    self.backend
                        .update(ConnectionUpdate::error("Connection timed out"));
                }
                Status::Offline
            }
            other => {
                self.backend
                    .update(ConnectionUpdate::error(other.to_string()));
                Status::Offline
            }
        }
    }

    /// The 15-minute refresh and `cluster:refresh-accessibility`.
    pub async fn refresh_accessibility_and_metadata(&self) {
        self.refresh_accessibility(None).await;
        self.refresh_metadata().await;
    }

    async fn refresh_accessibility(&self, generation: Option<u64>) {
        self.log("[CLUSTER]: refreshAccessibility".into());
        let previous = self.inner().state.known_resources.clone();
        let settings = self.backend.settings();
        let access = access::refresh(&*self.backend, &*self.backend, &settings, &previous).await;
        self.change(generation, |state| {
            state.is_admin = access.is_admin;
            state.is_global_watch_enabled = access.is_global_watch_enabled;
            state.allowed_namespaces = access.allowed_namespaces;
            state.ready = !access.known_resources.is_empty();
            state.known_resources = access.known_resources;
            state.resources_to_show = access.resources_to_show;
        });
    }

    async fn refresh_metadata(&self) {
        self.log("[CLUSTER]: refreshMetadata".into());
        let metadata = detect::detect(
            &*self.backend,
            &self.backend.server(),
            &self.backend.context_name(),
        )
        .await;
        self.backend.metadata(metadata, true);
    }

    /// `disconnect()`: a disconnected cluster only drops what it still holds.
    pub fn disconnect(&self) {
        if self.inner().state.disconnected {
            // An activation still in flight applies nothing more (research R5).
            let timers = {
                let mut inner = self.inner();
                inner.generation += 1;
                inner.activated = false;
                inner.timers.take()
            };
            if let Some(timers) = timers {
                timers.abort();
            }
            self.backend.disconnected();
            return;
        }
        self.reset_auth_failures();
        self.log("[CLUSTER]: disconnecting".into());
        let timers = {
            let mut inner = self.inner();
            inner.generation += 1;
            inner.activated = false;
            inner.timers.take()
        };
        if let Some(timers) = timers {
            timers.abort();
        }
        self.backend.disconnected();
        self.change(None, |state| {
            state.disconnected = true;
            state.online = false;
            state.accessible = false;
            state.ready = false;
            state.allowed_namespaces.clear();
        });
        self.log("[CLUSTER]: disconnected".into());
    }

    /// `network:offline` of the cluster manager.
    pub async fn network_offline(&self) {
        if self.inner().state.disconnected {
            return;
        }
        // Two changes, each sent, as the cluster manager sets them outside an
        // action.
        self.change(None, |state| state.online = false);
        self.change(None, |state| state.accessible = false);
        self.refresh_connection_status(None).await;
    }

    /// `network:online` of the cluster manager.
    pub async fn network_online(&self) {
        if self.inner().state.disconnected {
            return;
        }
        self.refresh_connection_status(None).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cluster::access::tests::{FakeApi, Reported};
    use serde_json::json;

    #[derive(Default)]
    struct Fake {
        api: FakeApi,
        reported: Reported,
        updates: Mutex<Vec<ConnectionUpdate>>,
        states: Mutex<Vec<ClusterState>>,
        metadata: Mutex<Vec<(Map<String, Value>, bool)>>,
        builds: Mutex<u32>,
        /// The results of the builds, in turn; `Ok` when none is left.
        build_results: Mutex<Vec<Result<(), ClientError>>>,
        build_delay: Mutex<Duration>,
        exec: bool,
        dropped: Mutex<u32>,
        /// How long `GET /version` takes.
        version_delay: Mutex<Duration>,
    }

    impl Api for Fake {
        fn request<'a>(
            &'a self,
            method: Method,
            path: &'a str,
            body: Option<Value>,
        ) -> BoxFuture<'a, Result<Value, ClientError>> {
            let delay = if path == "/version" {
                *self.version_delay.lock().unwrap()
            } else {
                Duration::ZERO
            };
            let answer = self.api.request(method, path, body);
            Box::pin(async move {
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                answer.await
            })
        }
        fn cluster_id(&self) -> &str {
            "some-cluster-id"
        }
    }

    impl Report for Fake {
        fn warning(&self, message: String) {
            self.reported.warning(message);
        }
        fn error(&self, message: String) {
            self.reported.error(message);
        }
        fn namespaces_forbidden(&self) {
            self.reported.namespaces_forbidden();
        }
        fn log(&self, line: String) {
            self.reported.log(line);
        }
    }

    impl Backend for Fake {
        fn build(&self) -> BoxFuture<'_, Result<(), ClientError>> {
            Box::pin(async move {
                let delay = *self.build_delay.lock().unwrap();
                if !delay.is_zero() {
                    tokio::time::sleep(delay).await;
                }
                *self.builds.lock().unwrap() += 1;
                let mut results = self.build_results.lock().unwrap();
                if results.is_empty() {
                    Ok(())
                } else {
                    results.remove(0)
                }
            })
        }
        fn uses_exec(&self) -> bool {
            self.exec
        }
        fn settings(&self) -> Settings {
            Settings::default()
        }
        fn context_name(&self) -> String {
            "some-context".into()
        }
        fn server(&self) -> String {
            "https://127.0.0.1:6443".into()
        }
        fn update(&self, update: ConnectionUpdate) {
            self.updates.lock().unwrap().push(update);
        }
        fn state_changed(&self, state: &ClusterState) {
            self.states.lock().unwrap().push(state.clone());
        }
        fn metadata(&self, metadata: Map<String, Value>, replace: bool) {
            self.metadata.lock().unwrap().push((metadata, replace));
        }
        fn disconnected(&self) {
            *self.dropped.lock().unwrap() += 1;
        }
    }

    impl Fake {
        fn reachable() -> Self {
            let fake = Self::default();
            fake.api
                .answer("GET /version", Ok(json!({"gitVersion": "v1.37.0"})));
            fake.api.answer(
                "POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
                Ok(json!({"status": {"allowed": true}})),
            );
            fake.api.answer(
                "GET /api/v1/namespaces",
                Ok(json!({"items": [{"metadata": {"name": "default"}}]})),
            );
            fake.api.answer("GET /api", Ok(json!({"versions": ["v1"]})));
            fake.api.answer("GET /apis", Ok(json!({"groups": []})));
            fake.api.answer(
                "GET /api/v1",
                Ok(json!({"resources": [{"name": "pods", "kind": "Pod", "namespaced": true}]})),
            );
            fake.api.answer(
                "POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
                Ok(json!({"status": {"incomplete": true}})),
            );
            fake
        }

        fn messages(&self) -> Vec<String> {
            self.updates
                .lock()
                .unwrap()
                .iter()
                .map(|u| u.message.clone())
                .collect()
        }

        fn lines_with(&self, text: &str) -> usize {
            self.reported
                .lines
                .lock()
                .unwrap()
                .iter()
                .filter(|l| l.contains(text))
                .count()
        }

        fn versions(&self) -> usize {
            self.api
                .routes()
                .iter()
                .filter(|r| *r == "GET /version")
                .count()
        }
    }

    fn connection(fake: Fake) -> (Arc<Connection>, Arc<Fake>) {
        let fake = Arc::new(fake);
        (Connection::new(Arc::clone(&fake) as Arc<dyn Backend>), fake)
    }

    async fn settle() {
        for _ in 0..50 {
            tokio::task::yield_now().await;
        }
    }

    // The steps (contracts/connection.md, "Activation")

    #[tokio::test(start_paused = true)]
    async fn a_connection_sends_its_steps_and_ends_connected() {
        let (connection, fake) = connection(Fake::reachable());
        connection.activate(false).await;
        assert_eq!(
            fake.messages(),
            [
                "Starting connection ...",
                "Refreshing connection status ...",
                "Refreshing cluster accessibility ...",
                "Connected, waiting for view to load ...",
            ]
        );
        assert!(
            fake.updates
                .lock()
                .unwrap()
                .iter()
                .all(|u| u.level == Level::Info)
        );
        let state = connection.state();
        assert!(state.online && state.accessible && state.ready && !state.disconnected);
        assert!(state.is_admin && state.is_global_watch_enabled);
        assert_eq!(state.allowed_namespaces, ["default"]);
        assert_eq!(state.resources_to_show, ["pods"]);
        assert!(connection.is_activated());
        let (metadata, replace) = fake.metadata.lock().unwrap()[0].clone();
        assert!(!replace);
        assert_eq!(metadata["version"], "v1.37.0");
        assert!(metadata.contains_key("lastSeen"));
    }

    // pc/main/cluster/cluster-connection-activation.test.ts

    #[tokio::test(start_paused = true)]
    async fn two_activations_in_flight_share_one_run() {
        let fake = Fake::reachable();
        *fake.build_delay.lock().unwrap() = Duration::from_millis(100);
        let (connection, fake) = connection(fake);
        tokio::join!(connection.activate(false), connection.activate(false));
        assert_eq!(*fake.builds.lock().unwrap(), 1);
        assert_eq!(fake.lines_with("[CLUSTER]: activate"), 1);
        assert!(
            !fake
                .messages()
                .iter()
                .any(|m| m.starts_with("Failed to start connection"))
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_forced_activation_waits_for_the_one_in_flight_then_runs() {
        let fake = Fake::reachable();
        *fake.build_delay.lock().unwrap() = Duration::from_millis(100);
        let (connection, fake) = connection(fake);
        let first = connection.clone();
        let running = tokio::spawn(async move { first.activate(false).await });
        settle().await;
        connection.activate(true).await;
        running.await.unwrap();
        assert_eq!(fake.lines_with("[CLUSTER]: activate"), 2);
        // The second run finds the cluster connected: no second build.
        assert_eq!(*fake.builds.lock().unwrap(), 1);
        let messages = fake.messages();
        let connected = messages
            .iter()
            .position(|m| m.starts_with("Connected"))
            .unwrap();
        assert!(connected < messages.len() - 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_forced_activation_after_a_failed_one_runs_again() {
        let fake = Fake::reachable();
        *fake.build_delay.lock().unwrap() = Duration::from_millis(100);
        fake.build_results
            .lock()
            .unwrap()
            .push(Err(ClientError::Build("some-error".into())));
        let (connection, fake) = connection(fake);
        let first = connection.clone();
        let running = tokio::spawn(async move { first.activate(false).await });
        settle().await;
        connection.activate(true).await;
        running.await.unwrap();
        assert_eq!(fake.lines_with("[CLUSTER]: activate"), 2);
        assert_eq!(*fake.builds.lock().unwrap(), 2);
        assert_eq!(
            fake.messages()
                .iter()
                .filter(|m| m.starts_with("Connected"))
                .count(),
            1
        );
    }

    #[tokio::test(start_paused = true)]
    async fn after_a_success_only_a_forced_activation_runs() {
        let (connection, fake) = connection(Fake::reachable());
        connection.activate(false).await;
        connection.activate(false).await;
        assert_eq!(fake.lines_with("[CLUSTER]: activate"), 1);
        connection.activate(true).await;
        assert_eq!(fake.lines_with("[CLUSTER]: activate"), 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_failed_start_is_sent_and_a_later_activation_runs_again() {
        let fake = Fake::reachable();
        fake.build_results
            .lock()
            .unwrap()
            .push(Err(ClientError::Build("some-error".into())));
        let (connection, fake) = connection(fake);
        connection.activate(false).await;
        assert_eq!(
            fake.updates.lock().unwrap().last().unwrap(),
            &ConnectionUpdate::error("Failed to start connection: Error: some-error")
        );
        assert!(!connection.is_activated());
        connection.activate(false).await;
        assert_eq!(fake.lines_with("[CLUSTER]: activate"), 2);
        assert_eq!(*fake.builds.lock().unwrap(), 2);
    }

    // pc/main/cluster/cluster-connection-auth-backoff.test.ts

    async fn connected() -> (Arc<Connection>, Arc<Fake>) {
        let (connection, fake) = connection(Fake::reachable());
        connection.activate(false).await;
        (connection, fake)
    }

    async fn advance(seconds: u64) {
        tokio::time::advance(Duration::from_secs(seconds)).await;
        settle().await;
    }

    fn fail_with(fake: &Fake, error: ClientError) {
        fake.api
            .answers
            .lock()
            .unwrap()
            .insert("GET /version".into(), vec![Err(error)]);
    }

    fn succeed(fake: &Fake) {
        fake.api
            .answers
            .lock()
            .unwrap()
            .insert("GET /version".into(), vec![Ok(json!({"gitVersion": "v1"}))]);
    }

    #[tokio::test(start_paused = true)]
    async fn the_status_is_checked_every_30_seconds() {
        let (_connection, fake) = connected().await;
        let before = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), before + 1);
        advance(30).await;
        assert_eq!(fake.versions(), before + 2);
    }

    #[tokio::test(start_paused = true)]
    async fn a_401_is_invalid_credentials_and_waits_60_seconds() {
        let (_connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Status {
                status: 401,
                error: "Unauthorized".into(),
            },
        );
        advance(30).await;
        assert_eq!(fake.messages().last().unwrap(), "Invalid credentials");
        let after_failure = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after_failure);
        advance(30).await;
        assert_eq!(fake.versions(), after_failure + 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_credential_plugin_failure_is_counted() {
        let (_connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Credential(
                "getting credentials: exec: executable kubelogin failed with exit code 1".into(),
            ),
        );
        advance(30).await;
        assert_eq!(
            fake.messages().last().unwrap(),
            "Failed to fetch credentials: getting credentials: exec: executable kubelogin failed with exit code 1"
        );
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after);

        let (_connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Status {
                status: 500,
                error: "getting credentials: exec: executable kubelogin failed".into(),
            },
        );
        advance(30).await;
        assert!(
            fake.messages()
                .last()
                .unwrap()
                .starts_with("Failed to fetch credentials: getting credentials")
        );
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after);
    }

    #[tokio::test(start_paused = true)]
    async fn a_dial_failure_and_a_timeout_without_exec_keep_the_30_seconds() {
        let (_connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Connect("dial tcp 127.0.0.1:1: connect: connection refused".into()),
        );
        advance(30).await;
        assert_eq!(
            fake.messages().last().unwrap(),
            "dial tcp 127.0.0.1:1: connect: connection refused"
        );
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);

        fail_with(&fake, ClientError::Timeout);
        advance(30).await;
        assert_eq!(fake.messages().last().unwrap(), "Connection timed out");
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);
        // A 5xx without a plugin's text is not counted either.
        fail_with(
            &fake,
            ClientError::Status {
                status: 503,
                error: "busy".into(),
            },
        );
        advance(30).await;
        assert_eq!(fake.messages().last().unwrap(), "busy");
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);
    }

    #[tokio::test(start_paused = true)]
    async fn the_third_failure_pauses_until_a_reconnect() {
        let (connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Status {
                status: 403,
                error: "Forbidden".into(),
            },
        );
        advance(30).await; // 1st
        advance(60).await; // 2nd
        advance(300).await; // 3rd
        assert_eq!(
            fake.messages().last().unwrap(),
            "Authentication failed 3 times, automatic reconnection paused: reconnect to try again"
        );
        let paused = fake.versions();
        advance(600).await;
        assert_eq!(fake.versions(), paused);
        succeed(&fake);
        connection.activate(true).await;
        let resumed = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), resumed + 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_success_after_a_failure_resets_the_count() {
        let (_connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Status {
                status: 401,
                error: "x".into(),
            },
        );
        advance(30).await;
        succeed(&fake);
        advance(60).await;
        assert_eq!(
            fake.lines_with("authentication succeeded after 1 consecutive failure(s)"),
            1
        );
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);
    }

    #[tokio::test(start_paused = true)]
    async fn two_concurrent_refreshes_make_one_request() {
        let fake = Fake::reachable();
        let (connection, fake) = connection(fake);
        connection.activate(false).await;
        *fake.version_delay.lock().unwrap() = Duration::from_millis(100);
        let before = fake.versions();
        tokio::join!(connection.refresh(), connection.refresh());
        assert_eq!(fake.versions(), before + 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_timeout_with_a_plugin_hints_an_interactive_login_and_backs_off() {
        let fake = Fake {
            exec: true,
            ..Fake::reachable()
        };
        let (connection, fake) = connection(fake);
        connection.activate(false).await;
        fail_with(&fake, ClientError::Timeout);
        advance(30).await;
        assert_eq!(
            fake.messages().last().unwrap(),
            "Connection timed out, the credential plugin may be waiting for an interactive login"
        );
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after);
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);
        // A dial failure with a plugin keeps the 30 s.
        fail_with(&fake, ClientError::Connect("refused".into()));
        connection.activate(true).await;
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);
    }

    #[tokio::test(start_paused = true)]
    async fn a_disconnect_then_a_forced_activation_resets_the_count() {
        let (connection, fake) = connected().await;
        fail_with(
            &fake,
            ClientError::Status {
                status: 401,
                error: "x".into(),
            },
        );
        advance(30).await;
        connection.disconnect();
        succeed(&fake);
        connection.activate(true).await;
        let after = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), after + 1);
    }

    // pc/main/__test__/cluster.test.ts, and research R5

    #[tokio::test(start_paused = true)]
    async fn activate_reconnect_and_disconnect_do_not_fail() {
        let (connection, fake) = connection(Fake::default());
        connection.activate(false).await;
        connection.disconnect();
        connection.disconnect();
        assert_eq!(*fake.dropped.lock().unwrap(), 2);
        let state = connection.state();
        assert!(state.disconnected && !state.online && !state.accessible && !state.ready);
    }

    #[tokio::test(start_paused = true)]
    async fn one_pair_of_timers_however_many_activations() {
        let (connection, fake) = connected().await;
        connection.activate(true).await;
        connection.activate(true).await;
        let before = fake.versions();
        advance(30).await;
        assert_eq!(fake.versions(), before + 1);
        assert_eq!(fake.lines_with("[CLUSTER]: bind events"), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn an_activation_applies_nothing_after_a_disconnect() {
        let fake = Fake::reachable();
        *fake.build_delay.lock().unwrap() = Duration::from_millis(100);
        let (connection, _fake) = connection(fake);
        let first = connection.clone();
        let running = tokio::spawn(async move { first.activate(false).await });
        settle().await;
        connection.disconnect();
        running.await.unwrap();
        let state = connection.state();
        assert!(state.disconnected && !state.accessible);
        assert!(!connection.is_activated());
    }

    #[tokio::test(start_paused = true)]
    async fn a_disconnect_keeps_admin_and_clears_the_namespaces() {
        let (connection, fake) = connected().await;
        connection.disconnect();
        let state = connection.state();
        assert!(state.is_admin);
        assert!(state.allowed_namespaces.is_empty());
        assert_eq!(fake.lines_with("[CLUSTER]: disconnected"), 1);
        // The timers stop.
        let before = fake.versions();
        advance(60).await;
        assert_eq!(fake.versions(), before);
    }

    #[tokio::test(start_paused = true)]
    async fn the_network_going_away_marks_the_cluster_offline_and_checks_it() {
        let (connection, fake) = connected().await;
        fail_with(&fake, ClientError::Connect("offline".into()));
        connection.network_offline().await;
        let states = fake.states.lock().unwrap().clone();
        let n = states.len();
        assert!(!states[n - 2].online && !states[n - 2].accessible);
        succeed(&fake);
        connection.network_online().await;
        assert!(connection.state().accessible);
    }

    #[tokio::test(start_paused = true)]
    async fn the_metadata_is_detected_on_the_15_minute_timer() {
        let (_connection, fake) = connected().await;
        fake.api.answer(
            "GET /api/v1/namespaces/default",
            Ok(json!({"metadata": {"uid": "u"}})),
        );
        fake.api.answer(
            "GET /api/v1/nodes?limit=1",
            Ok(json!({"items": [{}], "metadata": {}})),
        );
        advance(15 * 60).await;
        let replaced: Vec<_> = fake
            .metadata
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, replace)| *replace)
            .cloned()
            .collect();
        assert_eq!(replaced.len(), 1);
        assert_eq!(replaced[0].0["nodes"], 1);
        assert_eq!(replaced[0].0["distribution"], "unknown");
    }

    #[test]
    fn the_plugin_patterns() {
        assert!(is_plugin_error("getting credentials: exec: x"));
        assert!(is_plugin_error("an EXEC PLUGIN failed"));
        assert!(is_plugin_error("Credential Plugin"));
        assert!(!is_plugin_error("dial tcp: refused"));
    }

    #[test]
    fn the_state_serializes_in_the_electron_build_s_field_order() {
        let text = serde_json::to_string(&ClusterState::default()).unwrap();
        assert_eq!(
            text,
            r#"{"online":false,"ready":false,"disconnected":true,"accessible":false,"isAdmin":false,"allowedNamespaces":[],"resourcesToShow":[],"knownResources":[],"isGlobalWatchEnabled":false}"#
        );
        assert_eq!(
            serde_json::to_value(ConnectionUpdate::warning("w")).unwrap(),
            json!({"message": "w", "level": "warning"})
        );
    }
}
