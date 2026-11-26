/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The web links' checks, as `features/weblinks/main/` makes them: at once,
//! then 60 to 65 minutes after each check ends; a GET that gives up after
//! 20 seconds; a status from 200 to 499 is available (research R9).

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;

use super::Catalog;
use crate::foundation::download::{Trust, status_of};

pub const AVAILABLE: &str = "available";
pub const UNAVAILABLE: &str = "unavailable";

/// The waits of the checks.
#[derive(Debug, Clone, Copy)]
pub struct CheckTiming {
    /// How long a check waits for an answer.
    pub limit: Duration,
    /// The wait after a check ends.
    pub every: Duration,
    /// The most that is added to it at random.
    pub spread: Duration,
}

impl Default for CheckTiming {
    fn default() -> Self {
        Self {
            limit: Duration::from_secs(20),
            every: Duration::from_secs(60 * 60),
            spread: Duration::from_secs(5 * 60),
        }
    }
}

pub type BoxFuture = Pin<Box<dyn Future<Output = &'static str> + Send>>;
/// Checks one address: `available` or `unavailable`.
pub type Checker = Arc<dyn Fn(String) -> BoxFuture + Send + Sync>;

/// The check of `validate-weblink.injectable.ts`.
pub async fn check(address: &str, trust: &Trust, limit: Duration) -> &'static str {
    match tokio::time::timeout(limit, status_of(address, trust)).await {
        Ok(Ok(status)) if (200..500).contains(&status) => AVAILABLE,
        _ => UNAVAILABLE,
    }
}

/// The checker of the application, with the system's authorities or a test's.
pub fn checker(trust: Trust, limit: Duration) -> Checker {
    let trust = Arc::new(trust);
    Arc::new(move |address| {
        let trust = Arc::clone(&trust);
        Box::pin(async move { check(&address, &trust, limit).await })
    })
}

/// A random wait from zero to `spread`, from the randomness of a v4 uuid.
fn random_up_to(spread: Duration) -> Duration {
    let millis = spread.as_millis().max(1);
    Duration::from_millis((uuid::Uuid::new_v4().as_u128() % millis) as u64)
}

/// Checks every web link of the catalog's store, one task per id, started
/// when the id appears and stopped when it leaves (data-model.md "Web link
/// check").
pub fn start(catalog: &Catalog, checker: Checker, timing: CheckTiming) {
    let tasks: Arc<Mutex<HashMap<String, tokio::task::AbortHandle>>> = Arc::default();
    let handle = match tokio::runtime::Handle::try_current() {
        Ok(handle) => handle,
        Err(_) => tauri::async_runtime::handle().inner().clone(),
    };
    let reconcile = {
        let catalog = catalog.clone();
        move || {
            let entries = catalog.weblink_entries();
            let ids: Vec<(String, String)> = entries
                .iter()
                .filter_map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str)?;
                    let url = entry.get("url").and_then(Value::as_str).unwrap_or_default();
                    Some((id.to_string(), url.to_string()))
                })
                .collect();
            let mut tasks = tasks.lock().expect("the checks lock");
            tasks.retain(|id, task| {
                let keep = ids.iter().any(|(kept, _)| kept == id);
                if !keep {
                    task.abort();
                }
                keep
            });
            for (id, url) in ids {
                if tasks.contains_key(&id) {
                    continue;
                }
                let catalog = catalog.clone();
                let checker = Arc::clone(&checker);
                let task = handle.spawn({
                    let id = id.clone();
                    async move {
                        loop {
                            let phase = checker(url.clone()).await;
                            catalog.set_weblink_phase(&id, phase);
                            let wait = timing.every + random_up_to(timing.spread);
                            tokio::time::sleep(wait).await;
                        }
                    }
                });
                tasks.insert(id, task.abort_handle());
            }
        }
    };
    reconcile();
    catalog.on_weblinks_change(reconcile);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Answers each request with `status`, and `Location: /` for a redirect.
    async fn serve(status: u16, delay: Duration) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            loop {
                let Ok((mut socket, _)) = listener.accept().await else {
                    return;
                };
                tokio::spawn(async move {
                    let mut buffer = [0u8; 2048];
                    let read = socket.read(&mut buffer).await.unwrap_or(0);
                    let request = String::from_utf8_lossy(&buffer[..read]).to_string();
                    tokio::time::sleep(delay).await;
                    let answer = if status == 302 && request.starts_with("GET /moved") {
                        "HTTP/1.1 302 Found\r\nLocation: /\r\nContent-Length: 0\r\n\r\n".to_string()
                    } else if status == 302 {
                        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\nok".to_string()
                    } else {
                        format!("HTTP/1.1 {status} X\r\nContent-Length: 2\r\n\r\nok")
                    };
                    let _ = socket.write_all(answer.as_bytes()).await;
                });
            }
        });
        format!("http://{address}")
    }

    fn trust() -> Trust {
        Trust::Roots(Vec::new())
    }

    #[tokio::test]
    async fn statuses_from_200_to_499_are_available() {
        let limit = Duration::from_secs(5);
        for (status, phase) in [
            (200, AVAILABLE),
            (404, AVAILABLE),
            (499, AVAILABLE),
            (500, UNAVAILABLE),
            (503, UNAVAILABLE),
        ] {
            let url = serve(status, Duration::ZERO).await;
            assert_eq!(
                check(&format!("{url}/"), &trust(), limit).await,
                phase,
                "{status}"
            );
        }
        let url = serve(302, Duration::ZERO).await;
        assert_eq!(
            check(&format!("{url}/moved"), &trust(), limit).await,
            AVAILABLE
        );
    }

    #[tokio::test]
    async fn a_closed_port_and_a_slow_server_are_unavailable() {
        let closed = {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            listener.local_addr().unwrap()
        };
        assert_eq!(
            check(
                &format!("http://{closed}/"),
                &trust(),
                Duration::from_secs(5)
            )
            .await,
            UNAVAILABLE
        );
        let slow = serve(200, Duration::from_secs(2)).await;
        assert_eq!(
            check(&format!("{slow}/"), &trust(), Duration::from_millis(200)).await,
            UNAVAILABLE
        );
    }

    fn weblinks_catalog() -> (Catalog, crate::stores::Stores) {
        let log: crate::messaging::Log = Arc::new(|_| {});
        let stores =
            crate::stores::Stores::in_memory(crate::stores::Machine::current(), Arc::clone(&log));
        let catalog = Catalog::new(
            &stores,
            std::path::Path::new("/no/such/data"),
            None,
            super::super::CatalogLog::new(log, false),
        );
        (catalog, stores)
    }

    fn set_links(stores: &crate::stores::Stores, ids: &[&str]) {
        let links: Vec<Value> = ids
            .iter()
            .map(|id| serde_json::json!({ "id": id, "name": id, "url": format!("https://{id}.example.invalid") }))
            .collect();
        stores.update(
            crate::stores::StoreName::Weblink,
            serde_json::json!({ "weblinks": links }),
        );
    }

    fn phase_of(catalog: &Catalog, id: &str) -> Option<String> {
        catalog
            .entities()
            .iter()
            .find(|entity| entity["metadata"]["uid"] == id)
            .map(|entity| entity["status"]["phase"].as_str().unwrap().to_string())
    }

    #[tokio::test(start_paused = true)]
    async fn each_link_is_checked_at_once_then_after_an_hour_until_it_leaves() {
        let (catalog, stores) = weblinks_catalog();
        set_links(&stores, &["docs", "status"]);
        assert_eq!(phase_of(&catalog, "docs").as_deref(), Some(AVAILABLE));
        let calls: Arc<Mutex<Vec<String>>> = Arc::default();
        let recording = Arc::clone(&calls);
        let fake: Checker = Arc::new(move |url: String| {
            recording.lock().unwrap().push(url.clone());
            Box::pin(async move {
                if url.contains("status") {
                    UNAVAILABLE
                } else {
                    AVAILABLE
                }
            })
        });
        start(&catalog, fake, CheckTiming::default());
        tokio::time::sleep(Duration::from_millis(10)).await;
        assert_eq!(calls.lock().unwrap().len(), 2);
        assert_eq!(phase_of(&catalog, "status").as_deref(), Some(UNAVAILABLE));

        // Not again before an hour, and again within 65 minutes.
        tokio::time::sleep(Duration::from_secs(59 * 60)).await;
        assert_eq!(calls.lock().unwrap().len(), 2);
        tokio::time::sleep(Duration::from_secs(6 * 60 + 1)).await;
        assert_eq!(calls.lock().unwrap().len(), 4);

        // A link removed is not checked again, and leaves the catalog.
        set_links(&stores, &["docs"]);
        assert_eq!(phase_of(&catalog, "status"), None);
        let before = calls.lock().unwrap().len();
        tokio::time::sleep(Duration::from_secs(70 * 60)).await;
        let after: Vec<String> = calls.lock().unwrap()[before..].to_vec();
        assert!(after.iter().all(|url| url.contains("docs")), "{after:?}");
        assert_eq!(after.len(), 1);
    }

    #[tokio::test]
    async fn the_timing_is_the_electron_build_s() {
        let timing = CheckTiming::default();
        assert_eq!(timing.limit, Duration::from_secs(20));
        assert_eq!(timing.every, Duration::from_secs(3600));
        assert_eq!(timing.spread, Duration::from_secs(300));
        for _ in 0..100 {
            assert!(random_up_to(timing.spread) <= timing.spread);
        }
    }
}
