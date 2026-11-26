/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster connection (`specs/009-main-cluster-connection`): the clients
//! of the clusters of the catalog, their connections and states, and the
//! channels and routes of main-cluster-connection
//! (`contracts/clusters-api.md`).

pub mod client;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use crate::catalog::Catalog;

pub use client::{ClientError, ClusterClient};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

struct Inner {
    clients: client::Clients,
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
            }),
        }
    }

    /// A client of the cluster's API server with the context's credentials,
    /// for the core's own requests and the `/api-kube/` route. Until the
    /// connection of spec 009 is ported (T046), every cluster of the catalog
    /// counts as connected, as the route of spec 001 had it.
    pub async fn client(&self, id: &str) -> Result<ClusterClient, ClientError> {
        self.inner.clients.client(id).await
    }
}
