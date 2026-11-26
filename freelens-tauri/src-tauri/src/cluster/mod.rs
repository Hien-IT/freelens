/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster connection (`specs/009-main-cluster-connection`): the clients
//! of the clusters of the catalog, their connections and states, and the
//! channels and routes of main-cluster-connection
//! (`contracts/clusters-api.md`).

pub mod access;
pub mod api_kube;
pub mod channels;
pub mod client;
pub mod connection;
pub mod detect;
pub mod exec;
pub mod kubeconfig_edit;
pub mod watch;

/// The fake API server of the tests, for the unit tests of the area.
#[cfg(test)]
#[path = "../../tests/fake_api/mod.rs"]
pub(crate) mod fake_api;

use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex, RwLock, Weak};

use http::Method;
use serde_json::{Map, Value};

use crate::catalog::{Catalog, CatalogEvent};
use crate::foundation::shell_env::{self, ShellEnv};
use crate::frames::Frames;
use crate::messaging::{Log, Sender};

pub use client::{ClientError, ClusterClient};
pub use connection::{ClusterState, ConnectionUpdate, Level};

use access::{Api, Report, Settings};
use connection::{Backend, Connection};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

struct Inner {
    catalog: Catalog,
    clients: client::Clients,
    /// The environment of the credential plugins: the core's own until the
    /// shell sync of `run` takes its place (research R3, R4).
    shell: RwLock<ShellEnv>,
    sender: Sender,
    log: Log,
    connections: Mutex<HashMap<String, Arc<Connection>>>,
    /// The state last sent on `cluster-state-sync`, by cluster.
    sent: Mutex<HashMap<String, ClusterState>>,
    /// The clusters being deleted (`set-cluster-as-deleting`).
    deleting: Mutex<HashSet<String>>,
    watches: Mutex<Option<watch::Watches>>,
}

/// Built once at startup and cloned into every area that needs a cluster.
#[derive(Clone)]
pub struct Clusters {
    inner: Arc<Inner>,
}

impl Clusters {
    pub fn new(catalog: &Catalog, sender: Sender, log: Log) -> Self {
        let clusters = Self {
            inner: Arc::new(Inner {
                catalog: catalog.clone(),
                clients: client::Clients::new(catalog),
                shell: RwLock::new(ShellEnv::ready(shell_env::process_env())),
                sender,
                log,
                connections: Mutex::new(HashMap::new()),
                sent: Mutex::new(HashMap::new()),
                deleting: Mutex::new(HashSet::new()),
                watches: Mutex::new(None),
            }),
        };
        let weak = Arc::downgrade(&clusters.inner);
        catalog.subscribe(move |event| {
            if let CatalogEvent::ClusterRemoved(id) = event
                && let Some(inner) = weak.upgrade()
            {
                Clusters { inner }.left_the_catalog(id);
            }
        });
        clusters
    }

    /// A client of the cluster's API server with the context's credentials,
    /// for the `/api-kube/` route and its watches: `ClientError::Disconnected`
    /// for a cluster that is not connected (FR-012).
    pub async fn client(&self, id: &str) -> Result<ClusterClient, ClientError> {
        if !self.inner.catalog.has_cluster(id) {
            return Err(ClientError::NotInCatalog);
        }
        if self.state(id).is_none_or(|state| state.disconnected) {
            return Err(ClientError::Disconnected);
        }
        self.own_client(id).await
    }

    /// The client of the core's own requests, connected or not.
    async fn own_client(&self, id: &str) -> Result<ClusterClient, ClientError> {
        self.inner.clients.client(id, &self.shell()).await
    }

    /// The runs of the credential plugins.
    pub fn plugins(&self) -> &exec::Runner {
        self.inner.clients.runner()
    }

    /// The environment of the credential plugins from now on.
    pub fn set_shell(&self, shell: ShellEnv) {
        *self.inner.shell.write().expect("the shell lock") = shell;
    }

    /// The environment of the credential plugins.
    pub fn shell(&self) -> ShellEnv {
        self.inner.shell.read().expect("the shell lock").clone()
    }

    /// The watches, which a disconnect ends.
    pub fn set_watches(&self, watches: watch::Watches) {
        *self.inner.watches.lock().expect("the watches lock") = Some(watches);
    }

    /// The connection of `id`, made on first use; `None` for a cluster not
    /// in the catalog.
    pub fn connection(&self, id: &str) -> Option<Arc<Connection>> {
        if !self.inner.catalog.has_cluster(id) {
            return None;
        }
        let mut connections = self.inner.connections.lock().expect("the connections lock");
        Some(Arc::clone(
            connections.entry(id.to_string()).or_insert_with(|| {
                Connection::new(Arc::new(ClusterBackend {
                    id: id.to_string(),
                    clusters: Arc::downgrade(&self.inner),
                }))
            }),
        ))
    }

    /// The connections made so far.
    pub fn connections(&self) -> Vec<Arc<Connection>> {
        self.inner
            .connections
            .lock()
            .expect("the connections lock")
            .values()
            .cloned()
            .collect()
    }

    fn existing(&self, id: &str) -> Option<Arc<Connection>> {
        self.inner
            .connections
            .lock()
            .expect("the connections lock")
            .get(id)
            .cloned()
    }

    /// The state of a cluster of the catalog, as `cluster-state-sync` sends it.
    pub fn state(&self, id: &str) -> Option<ClusterState> {
        if !self.inner.catalog.has_cluster(id) {
            return None;
        }
        Some(
            self.existing(id)
                .map(|connection| connection.state())
                .unwrap_or_default(),
        )
    }

    /// Every cluster of the catalog with its state.
    pub fn states(&self) -> Vec<(String, ClusterState)> {
        self.inner
            .catalog
            .cluster_ids()
            .into_iter()
            .map(|id| {
                let state = self.state(&id).unwrap_or_default();
                (id, state)
            })
            .collect()
    }

    /// Disconnects `id`, if it has a connection.
    pub fn disconnect(&self, id: &str) {
        if let Some(connection) = self.existing(id) {
            connection.disconnect();
        }
    }

    /// Whether the cluster store has an entry for `id`, as `getClusterById`
    /// finds a cluster.
    fn is_registered(&self, id: &str) -> bool {
        self.inner.catalog.store_entry(id).is_some()
    }

    /// The kubeconfig file and the context of a registered cluster, else
    /// `Cluster "<id>" is not registered`.
    pub fn kubeconfig_of(&self, id: &str) -> Result<(std::path::PathBuf, String), String> {
        let entry = self
            .inner
            .catalog
            .store_entry(id)
            .ok_or_else(|| format!("Cluster \"{id}\" is not registered"))?;
        let text = |key: &str| {
            entry
                .get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        Ok((text("kubeConfigPath").into(), text("contextName")))
    }

    /// `deactivate-cluster`: an unregistered id changes nothing; else the
    /// cluster is disconnected and its frame forgotten.
    pub fn deactivate(&self, id: &str, frames: &Frames) {
        if self.is_registered(id) {
            self.disconnect(id);
            frames.forget(id);
        }
    }

    /// `delete-cluster`: an unregistered id changes nothing; else the cluster
    /// is disconnected, its frame forgotten, its store entry and its local
    /// storage file removed, the latter ignoring an error.
    pub fn delete(&self, id: &str, frames: &Frames, data_dir: &std::path::Path) {
        if !self.is_registered(id) {
            return;
        }
        self.disconnect(id);
        frames.forget(id);
        self.inner.catalog.remove_store_entry(id);
        let _ = std::fs::remove_file(
            data_dir
                .join("lens-local-storage")
                .join(format!("{id}.json")),
        );
    }

    /// Disconnects every cluster, as quitting does.
    pub fn disconnect_all(&self) {
        let connections: Vec<Arc<Connection>> = self
            .inner
            .connections
            .lock()
            .expect("the connections lock")
            .values()
            .cloned()
            .collect();
        for connection in connections {
            connection.disconnect();
        }
        self.plugins().stop_all();
    }

    /// A cluster that left the catalog, with a connection, is disconnected
    /// (FR-020).
    fn left_the_catalog(&self, id: &str) {
        let connection = self
            .inner
            .connections
            .lock()
            .expect("the connections lock")
            .remove(id);
        if let Some(connection) = connection {
            self.log(&format!(
                "[CLUSTER]: cluster left the catalog, disconnecting {{\"id\":\"{id}\"}}"
            ));
            connection.disconnect();
        }
        self.inner.sent.lock().expect("the sent lock").remove(id);
    }

    /// Marks `id` as being deleted, or clears the mark, and sets its phase.
    pub fn set_deleting(&self, id: &str, deleting: bool) {
        {
            let mut set = self.inner.deleting.lock().expect("the deleting lock");
            if deleting {
                set.insert(id.to_string());
            } else {
                set.remove(id);
            }
        }
        if self.inner.catalog.has_cluster(id) {
            self.set_phase(id, &self.state(id).unwrap_or_default());
        }
    }

    /// The phase and `enabled` of the entity (data-model.md, Phase of a
    /// cluster entity).
    fn set_phase(&self, id: &str, state: &ClusterState) {
        let deleting = self
            .inner
            .deleting
            .lock()
            .expect("the deleting lock")
            .contains(id);
        let (phase, enabled) = phase_of(state, deleting);
        self.inner.catalog.set_cluster_phase(id, phase, enabled);
    }

    /// Sends a state that differs from the last one sent, and sets the phase.
    fn state_changed(&self, id: &str, state: &ClusterState) {
        let changed = {
            let mut sent = self.inner.sent.lock().expect("the sent lock");
            if sent.get(id) == Some(state) {
                false
            } else {
                sent.insert(id.to_string(), state.clone());
                true
            }
        };
        if changed {
            self.inner.sender.send(
                channels::CLUSTER_STATE_SYNC,
                &channels::StateSync {
                    cluster_id: id.to_string(),
                    state: state.clone(),
                },
            );
        }
        self.set_phase(id, state);
    }

    pub(crate) fn log(&self, line: &str) {
        (self.inner.log)(line);
    }
}

/// What a connection needs, for one cluster.
struct ClusterBackend {
    id: String,
    clusters: Weak<Inner>,
}

impl ClusterBackend {
    fn clusters(&self) -> Option<Clusters> {
        self.clusters.upgrade().map(|inner| Clusters { inner })
    }

    fn facts(&self) -> client::ContextFacts {
        self.clusters()
            .and_then(|clusters| clusters.inner.catalog.cluster(&self.id))
            .map(|source| client::context_facts(&source))
            .unwrap_or_default()
    }
}

impl Api for ClusterBackend {
    fn request<'a>(
        &'a self,
        method: Method,
        path: &'a str,
        body: Option<Value>,
    ) -> BoxFuture<'a, Result<Value, ClientError>> {
        Box::pin(async move {
            let clusters = self.clusters().ok_or(ClientError::NotInCatalog)?;
            let client = clusters.own_client(&self.id).await?;
            client.request_json(method, path, body.as_ref()).await
        })
    }

    fn cluster_id(&self) -> &str {
        &self.id
    }
}

impl Report for ClusterBackend {
    fn warning(&self, message: String) {
        self.update(ConnectionUpdate::warning(message));
    }

    fn error(&self, message: String) {
        self.update(ConnectionUpdate::error(message));
    }

    fn namespaces_forbidden(&self) {
        if let Some(clusters) = self.clusters() {
            clusters
                .inner
                .sender
                .send(channels::LIST_NAMESPACE_FORBIDDEN, &self.id);
        }
    }

    fn log(&self, line: String) {
        if let Some(clusters) = self.clusters() {
            clusters.log(&line);
        }
    }
}

impl Backend for ClusterBackend {
    fn build(&self) -> BoxFuture<'_, Result<(), ClientError>> {
        Box::pin(async move {
            let clusters = self.clusters().ok_or(ClientError::NotInCatalog)?;
            clusters.inner.clients.drop_client(&self.id);
            clusters.own_client(&self.id).await.map(|_| ())
        })
    }

    fn uses_exec(&self) -> bool {
        self.facts().uses_exec
    }

    fn settings(&self) -> Settings {
        let Some(clusters) = self.clusters() else {
            return Settings::default();
        };
        let entry = clusters
            .inner
            .catalog
            .store_entry(&self.id)
            .unwrap_or_default();
        let preferences = entry.get("preferences").cloned().unwrap_or(Value::Null);
        let default_namespace = preferences["defaultNamespace"]
            .as_str()
            .filter(|namespace| !namespace.is_empty())
            .map(str::to_string)
            .or_else(|| self.facts().namespace);
        Settings {
            accessible_namespaces: entry
                .get("accessibleNamespaces")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|namespace| namespace.as_str().map(str::to_string))
                .collect(),
            default_namespace,
            skip_namespace_authorization_check: preferences["skipNamespaceAuthorizationCheck"]
                .as_bool()
                .unwrap_or(false),
        }
    }

    fn context_name(&self) -> String {
        self.clusters()
            .and_then(|clusters| clusters.inner.catalog.cluster(&self.id))
            .map(|source| source.context_name)
            .unwrap_or_default()
    }

    fn server(&self) -> String {
        self.facts().server.unwrap_or_default()
    }

    fn update(&self, update: ConnectionUpdate) {
        if let Some(clusters) = self.clusters() {
            clusters
                .inner
                .sender
                .send_named(&format!("cluster:{}:connection-update", self.id), &update);
        }
    }

    fn state_changed(&self, state: &ClusterState) {
        if let Some(clusters) = self.clusters() {
            clusters.state_changed(&self.id, state);
        }
    }

    fn metadata(&self, metadata: Map<String, Value>, replace: bool) {
        if let Some(clusters) = self.clusters() {
            clusters
                .inner
                .catalog
                .update_store_entry(&self.id, |entry| {
                    if replace {
                        entry.insert("metadata".into(), Value::Object(metadata));
                    } else {
                        let current = entry
                            .entry("metadata")
                            .or_insert_with(|| Value::Object(Map::new()));
                        if let Value::Object(current) = current {
                            current.extend(metadata);
                        }
                    }
                });
        }
    }

    fn disconnected(&self) {
        if let Some(clusters) = self.clusters() {
            clusters.inner.clients.drop_client(&self.id);
            clusters.inner.clients.close(&self.id);
            clusters.plugins().stop(&self.id);
            let watches = clusters
                .inner
                .watches
                .lock()
                .expect("the watches lock")
                .clone();
            if let Some(watches) = watches {
                watches.end_cluster(&self.id, &format!("Cluster {} is not connected", self.id));
            }
        }
    }
}

/// The phase and `enabled` of a cluster entity for its state (data-model.md,
/// Phase of a cluster entity; `main/cluster/manager.ts`).
pub fn phase_of(state: &ClusterState, deleting: bool) -> (&'static str, bool) {
    if deleting {
        ("deleting", false)
    } else if state.accessible {
        ("connected", true)
    } else if !state.disconnected {
        ("connecting", true)
    } else {
        ("disconnected", true)
    }
}
