/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster connection (`specs/009-main-cluster-connection`): the clients
//! of the clusters of the catalog, their connections and states, and the
//! channels and routes of main-cluster-connection
//! (`contracts/clusters-api.md`).

pub mod api_kube;
pub mod client;
pub mod exec;
pub mod watch;

/// The fake API server of the tests, for the unit tests of the area.
#[cfg(test)]
#[path = "../../tests/fake_api/mod.rs"]
pub(crate) mod fake_api;

use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, RwLock};

use crate::catalog::Catalog;
use crate::foundation::shell_env::{self, ShellEnv};

pub use client::{ClientError, ClusterClient};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

struct Inner {
    clients: client::Clients,
    /// The environment of the credential plugins: the core's own until the
    /// shell sync of `run` takes its place (research R3, R4).
    shell: RwLock<ShellEnv>,
}

/// Built once at startup and cloned into every area that needs a cluster.
#[derive(Clone)]
pub struct Clusters {
    inner: Arc<Inner>,
}

impl Clusters {
    pub fn new(catalog: &Catalog) -> Self {
        Self {
            inner: Arc::new(Inner {
                clients: client::Clients::new(catalog),
                shell: RwLock::new(ShellEnv::ready(shell_env::process_env())),
            }),
        }
    }

    /// A client of the cluster's API server with the context's credentials,
    /// for the core's own requests and the `/api-kube/` route. Until the
    /// connection of spec 009 is ported (T046), every cluster of the catalog
    /// counts as connected, as the route of spec 001 had it.
    pub async fn client(&self, id: &str) -> Result<ClusterClient, ClientError> {
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
}
