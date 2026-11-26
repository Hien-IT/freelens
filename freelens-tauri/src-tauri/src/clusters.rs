/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster clients. Only the core holds the credentials of the kubeconfig
//! file; a view gets the API server's response and nothing else (FR-015).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::{Client, Config};

use crate::catalog::{Catalog, CatalogEvent, ClusterSource};

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What a GET request to a cluster's API server gave.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ApiOutcome {
    Response {
        status: u16,
        body: Vec<u8>,
    },
    /// No answer: the connection failed or timed out.
    Unreachable,
}

pub trait ClusterApi: Send + Sync {
    /// Sends `GET <path_and_query>` to the API server of `cluster`'s context.
    fn get<'a>(
        &'a self,
        cluster: &'a ClusterSource,
        path_and_query: &'a str,
    ) -> BoxFuture<'a, ApiOutcome>;
}

/// One `kube::Client` per cluster id, created on its first request from the
/// cluster's own kubeconfig file, and dropped when the cluster changes or
/// leaves the catalog (research R10 of spec 008).
pub struct KubeClusters {
    clients: Arc<Mutex<HashMap<String, Client>>>,
}

impl KubeClusters {
    pub fn new(catalog: &Catalog) -> Self {
        let clients: Arc<Mutex<HashMap<String, Client>>> = Arc::default();
        let dropping = Arc::clone(&clients);
        catalog.subscribe(move |event| {
            let (CatalogEvent::ClusterChanged(id) | CatalogEvent::ClusterRemoved(id)) = event;
            dropping.lock().expect("the clients lock").remove(id);
        });
        Self { clients }
    }

    async fn client(&self, cluster: &ClusterSource) -> Option<Client> {
        if let Some(client) = self
            .clients
            .lock()
            .expect("the clients lock")
            .get(&cluster.id)
        {
            return Some(client.clone());
        }
        // The file holds credentials; only this area reads it, and the parser's
        // text, which can quote it, goes to the terminal and not to a view.
        let kubeconfig = match Kubeconfig::read_from(&cluster.kubeconfig_path) {
            Ok(kubeconfig) => kubeconfig,
            Err(error) => {
                eprintln!("Cannot read the kubeconfig file of a cluster: {error}");
                return None;
            }
        };
        let options = KubeConfigOptions {
            context: Some(cluster.context_name.clone()),
            ..KubeConfigOptions::default()
        };
        let mut config = match Config::from_custom_kubeconfig(kubeconfig, &options).await {
            Ok(config) => config,
            Err(error) => {
                eprintln!("Cannot configure the client of a cluster: {error}");
                return None;
            }
        };
        // A blackholed address must not leave the view loading for minutes.
        config.connect_timeout = Some(Duration::from_secs(10));
        config.read_timeout = Some(Duration::from_secs(30));
        let client = match Client::try_from(config) {
            Ok(client) => client,
            Err(error) => {
                eprintln!("Cannot create the client of a cluster: {error}");
                return None;
            }
        };
        self.clients
            .lock()
            .expect("the clients lock")
            .insert(cluster.id.clone(), client.clone());
        Some(client)
    }
}

impl ClusterApi for KubeClusters {
    fn get<'a>(
        &'a self,
        cluster: &'a ClusterSource,
        path_and_query: &'a str,
    ) -> BoxFuture<'a, ApiOutcome> {
        Box::pin(async move {
            let Some(client) = self.client(cluster).await else {
                return ApiOutcome::Unreachable;
            };
            let request = http::Request::get(path_and_query)
                .body(Vec::new())
                .expect("a valid request");
            match client.request_text(request).await {
                Ok(text) => ApiOutcome::Response {
                    status: 200,
                    body: text.into_bytes(),
                },
                Err(kube::Error::Api(status)) => ApiOutcome::Response {
                    status: status.code,
                    body: serde_json::to_vec(&status).unwrap_or_default(),
                },
                Err(error) => {
                    // The error text can name the server; it stays in the terminal.
                    eprintln!("A cluster request failed: {error}");
                    ApiOutcome::Unreachable
                }
            }
        })
    }
}
