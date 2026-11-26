/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The metadata detectors of a cluster
//! (`specs/009-main-cluster-connection/research.md`, R7), as
//! `main/cluster-detectors` of the Electron build has them.

use futures::future::join_all;
use http::Method;
use k8s_openapi::jiff::Timestamp;
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use super::access::Api;

/// What a detector found, and how sure it is.
#[derive(Debug, Clone, PartialEq)]
pub struct Detected {
    pub key: &'static str,
    pub value: Value,
    pub accuracy: u32,
}

/// The time as `Date.toJSON()` writes it.
pub fn now_json() -> String {
    Timestamp::now()
        .strftime("%Y-%m-%dT%H:%M:%S%.3fZ")
        .to_string()
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

/// The server URL as `new URL(server).toString()` writes it.
pub fn url_string(server: &str) -> Option<String> {
    url::Url::parse(server).ok().map(|url| url.to_string())
}

async fn git_version(api: &dyn Api) -> Option<String> {
    api.request(Method::GET, "/version", None)
        .await
        .ok()?
        .get("gitVersion")?
        .as_str()
        .map(str::to_string)
}

async fn version(api: &dyn Api) -> Option<Detected> {
    Some(Detected {
        key: "version",
        value: Value::from(git_version(api).await?),
        accuracy: 100,
    })
}

async fn last_seen(api: &dyn Api) -> Option<Detected> {
    api.request(Method::GET, "/version", None).await.ok()?;
    Some(Detected {
        key: "lastSeen",
        value: Value::from(now_json()),
        accuracy: 100,
    })
}

async fn cluster_id(api: &dyn Api, server: &str) -> Option<Detected> {
    let value = match api
        .request(Method::GET, "/api/v1/namespaces/default", None)
        .await
    {
        Ok(namespace) => sha256_hex(namespace["metadata"]["uid"].as_str()?.as_bytes()),
        Err(_) => sha256_hex(url_string(server)?.as_bytes()),
    };
    Some(Detected {
        key: "id",
        value: Value::from(value),
        accuracy: 100,
    })
}

async fn nodes(api: &dyn Api) -> Option<Detected> {
    let page = api
        .request(Method::GET, "/api/v1/nodes?limit=1", None)
        .await
        .ok()?;
    let items = page["items"].as_array().map_or(0, Vec::len) as u64;
    let count = if let Some(remaining) = page["metadata"]["remainingItemCount"].as_u64() {
        items + remaining
    } else if page["metadata"]["continue"]
        .as_str()
        .is_some_and(|token| !token.is_empty())
    {
        let all = api.request(Method::GET, "/api/v1/nodes", None).await.ok()?;
        all["items"].as_array().map_or(0, Vec::len) as u64
    } else {
        items
    };
    Some(Detected {
        key: "nodes",
        value: Value::from(count),
        accuracy: 1000,
    })
}

/// The 21 rules of `cluster-distribution-detector`, in their order.
pub fn distribution_of(
    version: &str,
    host: &str,
    context: &str,
    openshift: impl FnOnce() -> bool,
) -> (&'static str, u32) {
    if version.contains("-rancher") {
        return ("rke", 80);
    }
    if version.contains("+rke2") {
        return ("rke2", 80);
    }
    if context == "rancher-desktop" {
        return ("rancher-desktop", 80);
    }
    if version.contains("+k3s") {
        return ("k3s", 80);
    }
    if version.contains("gke") {
        return ("gke", 80);
    }
    if version.contains("eks") {
        return ("eks", 80);
    }
    if version.contains("IKS") {
        return ("iks", 80);
    }
    if host.contains("azmk8s.io") {
        return ("aks", 80);
    }
    if host.ends_with("k8s.ondigitalocean.com") {
        return ("digitalocean", 90);
    }
    if version.contains("-k0s") || version.contains("+k0s") {
        return ("k0s", 80);
    }
    if version.contains("+vmware") {
        return ("vmware", 90);
    }
    if version.contains("-mirantis-") || version.contains("-docker-") {
        return ("mirantis", 90);
    }
    if version.contains("-aliyun") {
        return ("alibaba", 90);
    }
    if version.contains("-CCE") {
        return ("huawei", 90);
    }
    if version.contains("-tke.") {
        return ("tencent", 90);
    }
    if context.starts_with("minikube") {
        return ("minikube", 80);
    }
    if context.starts_with("microk8s") {
        return ("microk8s", 80);
    }
    if context.starts_with("kind-") {
        return ("kind", 70);
    }
    if context == "docker-desktop" {
        return ("docker-desktop", 80);
    }
    if version.contains('+') {
        if openshift() {
            return ("openshift", 90);
        }
        return ("custom", 10);
    }
    ("unknown", 10)
}

async fn distribution(api: &dyn Api, server: &str, context: &str) -> Option<Detected> {
    let version = git_version(api).await?;
    let host = url::Url::parse(server)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
        .unwrap_or_default();
    // The probe of OpenShift runs only for a version with `+`.
    let openshift = if version.contains('+') {
        api.request(Method::GET, "/", None)
            .await
            .ok()
            .and_then(|root| {
                root["paths"].as_array().map(|paths| {
                    paths
                        .iter()
                        .any(|path| path == "/apis/project.openshift.io")
                })
            })
            .unwrap_or(false)
    } else {
        false
    };
    let (value, accuracy) = distribution_of(&version, &host, context, || openshift);
    Some(Detected {
        key: "distribution",
        value: Value::from(value),
        accuracy,
    })
}

/// Every detector in parallel; for each key the highest accuracy, a tie to
/// the later; a detector that fails is left out. The result replaces the
/// cluster's metadata.
pub async fn detect(api: &dyn Api, server: &str, context: &str) -> Map<String, Value> {
    let found = join_all([
        Box::pin(version(api))
            as std::pin::Pin<Box<dyn std::future::Future<Output = Option<Detected>> + Send + '_>>,
        Box::pin(cluster_id(api, server)),
        Box::pin(last_seen(api)),
        Box::pin(nodes(api)),
        Box::pin(distribution(api, server, context)),
    ])
    .await;
    let mut best: Vec<Detected> = Vec::new();
    for detected in found.into_iter().flatten() {
        match best.iter_mut().find(|kept| kept.key == detected.key) {
            Some(kept) if kept.accuracy <= detected.accuracy => *kept = detected,
            Some(_) => {}
            None => best.push(detected),
        }
    }
    best.into_iter()
        .filter(|detected| !detected.value.is_null())
        .map(|detected| (detected.key.to_string(), detected.value))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cluster::ClientError;
    use crate::cluster::access::tests::FakeApi;
    use serde_json::json;

    // pc/main/cluster-detectors/cluster-nodes-count-detector.test.ts

    #[tokio::test]
    async fn the_remaining_count_is_added_in_one_request() {
        let api = FakeApi::default();
        api.answer(
            "GET /api/v1/nodes?limit=1",
            Ok(json!({"items": [{}], "metadata": {"remainingItemCount": 41, "continue": "x"}})),
        );
        assert_eq!(nodes(&api).await.unwrap().value, json!(42));
        assert_eq!(api.routes(), ["GET /api/v1/nodes?limit=1"]);
    }

    #[tokio::test]
    async fn continue_without_a_count_lists_them_all() {
        let api = FakeApi::default();
        api.answer(
            "GET /api/v1/nodes?limit=1",
            Ok(json!({"items": [{}], "metadata": {"continue": "x"}})),
        );
        api.answer("GET /api/v1/nodes", Ok(json!({"items": [{}, {}, {}]})));
        assert_eq!(nodes(&api).await.unwrap().value, json!(3));
    }

    #[tokio::test]
    async fn one_page_gives_its_length() {
        let api = FakeApi::default();
        api.answer(
            "GET /api/v1/nodes?limit=1",
            Ok(json!({"items": [{}], "metadata": {}})),
        );
        assert_eq!(nodes(&api).await.unwrap().value, json!(1));
        assert_eq!(nodes(&api).await.unwrap().accuracy, 1000);
    }

    // pc/main/cluster-detectors/detect-cluster-metadata.test.ts

    fn reachable() -> FakeApi {
        let api = FakeApi::default();
        api.answer("GET /version", Ok(json!({"gitVersion": "v1.37.0"})));
        api.answer(
            "GET /api/v1/namespaces/default",
            Ok(json!({"metadata": {"uid": "some-uid"}})),
        );
        api.answer(
            "GET /api/v1/nodes?limit=1",
            Ok(json!({"items": [{}], "metadata": {}})),
        );
        api
    }

    #[tokio::test]
    async fn every_key_is_detected() {
        let metadata = detect(
            &reachable(),
            "https://127.0.0.1:6443",
            "kind-freelens-profile",
        )
        .await;
        assert_eq!(metadata["version"], "v1.37.0");
        assert_eq!(metadata["id"], sha256_hex(b"some-uid"));
        assert_eq!(metadata["nodes"], 1);
        assert_eq!(metadata["distribution"], "kind");
        let last_seen = metadata["lastSeen"].as_str().unwrap();
        assert_eq!(last_seen.len(), "2026-11-26T10:00:00.000Z".len());
        assert!(last_seen.ends_with('Z'));
    }

    #[tokio::test]
    async fn a_failing_detector_is_left_out() {
        let api = FakeApi::default();
        api.answer(
            "GET /version",
            Err(ClientError::Status {
                status: 500,
                error: "down".into(),
            }),
        );
        api.answer("GET /api/v1/namespaces/default", Err(ClientError::Timeout));
        api.answer("GET /api/v1/nodes?limit=1", Err(ClientError::Timeout));
        let metadata = detect(&api, "https://Example.COM:443/k8s", "ctx").await;
        assert_eq!(metadata.keys().collect::<Vec<_>>(), ["id"]);
        // The id from the server URL as `new URL()` writes it.
        assert_eq!(metadata["id"], sha256_hex(b"https://example.com/k8s"));
    }

    #[test]
    fn the_server_url_is_written_as_new_url_writes_it() {
        assert_eq!(
            url_string("https://Some-Server:6443").as_deref(),
            Some("https://some-server:6443/")
        );
        assert_eq!(
            url_string("https://some-server:443").as_deref(),
            Some("https://some-server/")
        );
        assert_eq!(
            url_string("https://some-rancher/k8s/clusters/local").as_deref(),
            Some("https://some-rancher/k8s/clusters/local")
        );
    }

    #[test]
    fn the_21_rules_of_the_distribution_in_order() {
        let no = || false;
        let cases = [
            ("v1.20.4-rancher1", "h", "c", "rke", 80),
            ("v1.27.1+rke2r1", "h", "c", "rke2", 80),
            ("v1.27.1", "h", "rancher-desktop", "rancher-desktop", 80),
            ("v1.27.1+k3s1", "h", "c", "k3s", 80),
            ("v1.27.3-gke.100", "h", "c", "gke", 80),
            ("v1.27.4-eks-2d98532", "h", "c", "eks", 80),
            ("v1.27.4+IKS", "h", "c", "iks", 80),
            ("v1.27.4", "x.hcp.westeurope.azmk8s.io", "c", "aks", 80),
            (
                "v1.27.4",
                "abc.k8s.ondigitalocean.com",
                "c",
                "digitalocean",
                90,
            ),
            ("v1.27.4+k0s", "h", "c", "k0s", 80),
            ("v1.27.4+vmware.1", "h", "c", "vmware", 90),
            ("v1.27.4-mirantis-1", "h", "c", "mirantis", 90),
            ("v1.27.4-aliyun.1", "h", "c", "alibaba", 90),
            ("v1.27.4-r0-CCE23", "h", "c", "huawei", 90),
            ("v1.27.4-tke.5", "h", "c", "tencent", 90),
            ("v1.27.4", "h", "minikube", "minikube", 80),
            ("v1.27.4", "h", "microk8s", "microk8s", 80),
            ("v1.27.4", "h", "kind-x", "kind", 70),
            ("v1.27.4", "h", "docker-desktop", "docker-desktop", 80),
            ("v1.27.4+custom", "h", "c", "custom", 10),
            ("v1.27.4", "h", "c", "unknown", 10),
        ];
        for (version, host, context, value, accuracy) in cases {
            assert_eq!(
                distribution_of(version, host, context, no),
                (value, accuracy),
                "{version} {host} {context}"
            );
        }
        assert_eq!(
            distribution_of("v1.27.4+abc", "h", "c", || true),
            ("openshift", 90)
        );
        // The first rule that matches wins.
        assert_eq!(
            distribution_of("v1.27.1+k3s1", "h", "kind-x", no),
            ("k3s", 80)
        );
    }

    #[tokio::test]
    async fn openshift_is_probed_only_for_a_version_with_a_plus() {
        let api = FakeApi::default();
        api.answer("GET /version", Ok(json!({"gitVersion": "v1.27.4+abc"})));
        api.answer(
            "GET /",
            Ok(json!({"paths": ["/api", "/apis/project.openshift.io"]})),
        );
        assert_eq!(
            distribution(&api, "https://h", "c").await.unwrap().value,
            "openshift"
        );
        let api = reachable();
        distribution(&api, "https://h", "c").await;
        assert!(!api.routes().contains(&"GET /".to_string()));
    }
}
