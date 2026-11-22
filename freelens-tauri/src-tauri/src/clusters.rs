/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The cluster clients. Only the core holds the credentials of the kubeconfig
//! file; a view gets the API server's response and nothing else (FR-015).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::time::Duration;

use kube::config::{KubeConfigOptions, Kubeconfig};
use kube::{Client, Config};
use tokio::sync::Mutex;

use crate::catalog::CatalogEntry;

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
    /// Sends `GET <path_and_query>` to the API server of `entry`'s context.
    fn get<'a>(
        &'a self,
        entry: &'a CatalogEntry,
        path_and_query: &'a str,
    ) -> BoxFuture<'a, ApiOutcome>;
}

/// One `kube::Client` per cluster id, created on its first request.
pub struct KubeClusters {
    kubeconfig: Option<Kubeconfig>,
    clients: Mutex<HashMap<String, Client>>,
}

impl KubeClusters {
    pub fn new(kubeconfig: Option<Kubeconfig>) -> Self {
        Self {
            kubeconfig,
            clients: Mutex::new(HashMap::new()),
        }
    }

    async fn client(&self, entry: &CatalogEntry) -> Option<Client> {
        let mut clients = self.clients.lock().await;
        if let Some(client) = clients.get(&entry.id) {
            return Some(client.clone());
        }
        let options = KubeConfigOptions {
            context: Some(entry.name.clone()),
            ..KubeConfigOptions::default()
        };
        let mut config =
            match Config::from_custom_kubeconfig(self.kubeconfig.clone()?, &options).await {
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
        clients.insert(entry.id.clone(), client.clone());
        Some(client)
    }
}

impl ClusterApi for KubeClusters {
    fn get<'a>(
        &'a self,
        entry: &'a CatalogEntry,
        path_and_query: &'a str,
    ) -> BoxFuture<'a, ApiOutcome> {
        Box::pin(async move {
            let Some(client) = self.client(entry).await else {
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
