/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `execute-on-cluster` (research R13 of `specs/009-main-cluster-connection`):
//! one operation of the extension API on a resource of a cluster, as the
//! Electron build's `executeOnClusterHandler` runs it.

use http::{Method, header};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::Clusters;
use super::api_kube::is_normalized;

/// `ResourceQuery` of `features/cluster/execute/common/types.ts`.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    pub api_version: String,
    pub kind: String,
    #[serde(default)]
    pub namespace: Option<String>,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub label_selector: Option<String>,
    #[serde(default)]
    pub field_selector: Option<String>,
}

/// `ExecuteOnClusterRequest`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    pub cluster_id: String,
    pub operation: String,
    pub resource: Resource,
    #[serde(default)]
    pub body: Option<Value>,
    #[serde(default)]
    pub patch_type: Option<String>,
}

/// `ExecuteOnClusterError`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Failure {
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// `ExecuteOnClusterResponse`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Response {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Failure>,
}

fn failed(message: impl Into<String>, code: Option<u64>, reason: Option<&str>) -> Response {
    Response {
        success: false,
        data: None,
        error: Some(Failure {
            message: message.into(),
            code,
            reason: reason.map(str::to_string),
        }),
    }
}

const NOT_ACCESSIBLE: &str = "Cluster not available. Ensure cluster is connected.";

/// `lowerAndPluralize` of `@freelensapp/utilities`.
pub fn pluralize(kind: &str) -> String {
    let lower = kind.to_lowercase();
    if let Some(stem) = lower.strip_suffix('y') {
        format!("{stem}ies")
    } else if ["s", "x", "z", "ch", "sh"]
        .iter()
        .any(|end| lower.ends_with(end))
    {
        format!("{lower}es")
    } else {
        format!("{lower}s")
    }
}

/// `encodeURIComponent`, as `stringify` of the JSON API writes a query.
pub fn encode_component(text: &str) -> String {
    let mut encoded = String::new();
    for byte in text.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

/// `createKubeApiURL` with the selectors as its query.
pub fn path_of(resource: &Resource) -> String {
    let prefix = if resource.api_version.contains('/') {
        "/apis"
    } else {
        "/api"
    };
    let mut parts = vec![prefix.to_string(), resource.api_version.clone()];
    if let Some(namespace) = resource
        .namespace
        .as_deref()
        .filter(|namespace| !namespace.is_empty())
    {
        parts.extend(["namespaces".to_string(), namespace.to_string()]);
    }
    parts.push(pluralize(&resource.kind));
    if let Some(name) = resource.name.as_deref().filter(|name| !name.is_empty()) {
        parts.push(name.to_string());
    }
    let mut path = parts.join("/");
    let query: Vec<String> = [
        ("labelSelector", &resource.label_selector),
        ("fieldSelector", &resource.field_selector),
    ]
    .into_iter()
    .filter_map(|(key, value)| {
        value
            .as_deref()
            .filter(|value| !value.is_empty())
            .map(|value| format!("{key}={}", encode_component(value)))
    })
    .collect();
    if !query.is_empty() {
        path.push('?');
        path.push_str(&query.join("&"));
    }
    path
}

/// Whether the parts, which come from an extension, name the resource they
/// say: no `..`, no segment or query of their own.
fn is_safe(resource: &Resource) -> bool {
    let parts = [&resource.namespace, &resource.name]
        .into_iter()
        .flatten()
        .chain([&resource.kind]);
    let base = path_of(&Resource {
        label_selector: None,
        field_selector: None,
        ..resource.clone()
    });
    is_normalized(&base)
        && !base.contains('?')
        && resource.api_version.matches('/').count() <= 1
        && parts.into_iter().all(|part| !part.contains('/'))
}

/// The method of an operation, `None` for one the handler does not know.
fn method_of(operation: &str) -> Option<Method> {
    Some(match operation {
        "list" | "get" => Method::GET,
        "create" => Method::POST,
        "update" => Method::PUT,
        "patch" => Method::PATCH,
        "delete" => Method::DELETE,
        _ => return None,
    })
}

/// `patchTypeHeaders`; strategic merge unless asked otherwise.
fn patch_content_type(patch_type: Option<&str>) -> &'static str {
    match patch_type {
        Some("merge") => "application/merge-patch+json",
        Some("json") => "application/json-patch+json",
        _ => "application/strategic-merge-patch+json",
    }
}

/// The failure of an answer outside 2xx: the API server's `Status` with its
/// `message`, `code` and `reason`, else the body or the status text.
fn failure_of(status: http::StatusCode, text: &str) -> Response {
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(status_object)) => {
            let reason = status_object.get("reason").and_then(Value::as_str);
            let message = status_object
                .get("message")
                .and_then(Value::as_str)
                .filter(|message| !message.is_empty())
                .map(str::to_string)
                .unwrap_or_else(|| match reason {
                    Some(reason) => format!("{}: {reason}", status.as_u16()),
                    None => status.canonical_reason().unwrap_or("Error!").to_string(),
                });
            let code = status_object
                .get("code")
                .and_then(Value::as_u64)
                .or(Some(u64::from(status.as_u16())));
            failed(message, code, reason)
        }
        _ => {
            let text = text.trim();
            let message = if text.is_empty() {
                status.canonical_reason().unwrap_or("Error!").to_string()
            } else {
                text.to_string()
            };
            failed(message, Some(u64::from(status.as_u16())), None)
        }
    }
}

/// Runs the request; `version` is the application's, for `User-Agent`.
pub async fn execute(clusters: &Clusters, version: &str, request: Request) -> Response {
    let id = &request.cluster_id;
    if clusters.kubeconfig_of(id).is_err() {
        clusters.log(&format!("[execute-api] Cluster not found: {id}"));
        return failed(NOT_ACCESSIBLE, Some(503), Some("ClusterNotAccessible"));
    }
    if !clusters.state(id).is_some_and(|state| state.accessible) {
        clusters.log(&format!("[execute-api] Cluster not accessible: {id}"));
        return failed(NOT_ACCESSIBLE, Some(503), Some("ClusterNotAccessible"));
    }
    if clusters
        .server_of(id)
        .is_none_or(|server| server.is_empty())
    {
        clusters.log(&format!(
            "[execute-api] No server in kubeconfig for cluster: {id}"
        ));
        return failed(
            "Failed to load cluster configuration.",
            Some(500),
            Some("ConfigurationError"),
        );
    }
    let Some(method) = method_of(&request.operation) else {
        return failed(
            format!("Unknown operation: {}", request.operation),
            Some(400),
            Some("BadRequest"),
        );
    };
    let path = path_of(&request.resource);
    if !is_safe(&request.resource) {
        return failed(
            format!("Invalid resource path: {path}"),
            Some(400),
            Some("BadRequest"),
        );
    }
    let client = match clusters.client(id).await {
        Ok(client) => client,
        Err(error) => return failed(error.to_string(), None, None),
    };
    let content_type = if method == Method::PATCH {
        patch_content_type(request.patch_type.as_deref())
    } else {
        "application/json"
    };
    // The body is sent with the operations that carry data.
    let body = match (&method, &request.body) {
        (&Method::POST | &Method::PUT | &Method::PATCH, Some(body)) if !body.is_null() => {
            body.to_string().into_bytes()
        }
        _ => Vec::new(),
    };
    let outgoing = http::Request::builder()
        .method(method)
        .uri(&path)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::USER_AGENT, format!("Freelens/{version}"))
        .body(body)
        .expect("a normalized path is a valid URI");
    let response = match client.send(outgoing).await {
        Ok(response) => response,
        Err(error) => return failed(error.to_string(), None, None),
    };
    let status = response.status();
    let bytes = tokio::select! {
        () = client.closed() => return failed(super::ClientError::Disconnected.to_string(), None, None),
        bytes = response.into_body().collect() => match bytes {
            Ok(bytes) => bytes.to_bytes(),
            Err(error) => return failed(super::client::describe(&error), None, None),
        },
    };
    let text = String::from_utf8_lossy(&bytes);
    if !status.is_success() {
        return failure_of(status, &text);
    }
    // The JSON of the answer, `{}` for none, else its text.
    let data = serde_json::from_str(if text.is_empty() { "{}" } else { &text })
        .unwrap_or_else(|_| Value::from(text.to_string()));
    Response {
        success: true,
        data: Some(data),
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn resource(
        api_version: &str,
        kind: &str,
        namespace: Option<&str>,
        name: Option<&str>,
    ) -> Resource {
        Resource {
            api_version: api_version.into(),
            kind: kind.into(),
            namespace: namespace.map(str::to_string),
            name: name.map(str::to_string),
            ..Resource::default()
        }
    }

    // pc/features/cluster/execute/main/__tests__/execute-handler.test.ts

    #[test]
    fn the_urls_of_core_group_cluster_scoped_and_named_resources() {
        assert_eq!(
            path_of(&resource("v1", "Pod", Some("default"), None)),
            "/api/v1/namespaces/default/pods"
        );
        assert_eq!(
            path_of(&resource(
                "apps/v1",
                "Deployment",
                Some("kube-system"),
                None
            )),
            "/apis/apps/v1/namespaces/kube-system/deployments"
        );
        assert_eq!(
            path_of(&resource("v1", "Node", None, None)),
            "/api/v1/nodes"
        );
        assert_eq!(
            path_of(&resource("v1", "Pod", Some("default"), Some("my-pod"))),
            "/api/v1/namespaces/default/pods/my-pod"
        );
    }

    #[test]
    fn the_selectors_are_the_query() {
        let mut both = resource("v1", "Pod", Some("default"), None);
        both.label_selector = Some("app=nginx,env=prod".into());
        assert_eq!(
            path_of(&both),
            "/api/v1/namespaces/default/pods?labelSelector=app%3Dnginx%2Cenv%3Dprod"
        );
        both.field_selector = Some("status.phase=Running".into());
        assert_eq!(
            path_of(&both),
            "/api/v1/namespaces/default/pods?labelSelector=app%3Dnginx%2Cenv%3Dprod&fieldSelector=status.phase%3DRunning"
        );
        both.label_selector = None;
        assert_eq!(
            path_of(&both),
            "/api/v1/namespaces/default/pods?fieldSelector=status.phase%3DRunning"
        );
    }

    #[test]
    fn kinds_are_lowered_and_pluralized_as_lower_and_pluralize_does() {
        for (kind, plural) in [
            ("Pod", "pods"),
            ("NetworkPolicy", "networkpolicies"),
            ("Ingress", "ingresses"),
            ("Box", "boxes"),
            ("Quiz", "quizes"),
            ("Batch", "batches"),
            ("Mesh", "meshes"),
            ("Endpoints", "endpointses"),
        ] {
            assert_eq!(pluralize(kind), plural, "{kind}");
        }
    }

    #[test]
    fn the_patch_types_have_their_content_types() {
        assert_eq!(
            patch_content_type(None),
            "application/strategic-merge-patch+json"
        );
        assert_eq!(
            patch_content_type(Some("strategic")),
            "application/strategic-merge-patch+json"
        );
        assert_eq!(
            patch_content_type(Some("json")),
            "application/json-patch+json"
        );
        assert_eq!(
            patch_content_type(Some("merge")),
            "application/merge-patch+json"
        );
    }

    #[test]
    fn an_api_status_gives_its_message_code_and_reason() {
        let status = json!({"kind": "Status", "status": "Failure", "message": "pods \"not-found\" not found", "reason": "NotFound", "code": 404});
        assert_eq!(
            failure_of(http::StatusCode::NOT_FOUND, &status.to_string()),
            failed("pods \"not-found\" not found", Some(404), Some("NotFound"))
        );
        assert_eq!(
            failure_of(http::StatusCode::BAD_GATEWAY, ""),
            failed("Bad Gateway", Some(502), None)
        );
        assert_eq!(
            failure_of(http::StatusCode::INTERNAL_SERVER_ERROR, " boom \n"),
            failed("boom", Some(500), None)
        );
    }

    #[test]
    fn parts_that_would_name_another_path_are_refused() {
        assert!(is_safe(&resource(
            "v1",
            "Pod",
            Some("default"),
            Some("my-pod")
        )));
        assert!(is_safe(&resource("apps/v1", "Deployment", None, None)));
        for unsafe_resource in [
            resource("v1", "Pod", Some(".."), Some("x")),
            resource("v1", "Pod", Some("default"), Some("x?watch=1")),
            resource("v1", "Pod", Some("default"), Some("x/status")),
            resource("v1", "Pod", Some("default"), Some("%2e%2e")),
            resource("a/b/c", "Pod", None, None),
        ] {
            assert!(!is_safe(&unsafe_resource), "{unsafe_resource:?}");
        }
    }

    #[test]
    fn the_request_reads_as_the_extension_api_sends_it() {
        let request: Request = serde_json::from_value(json!({
            "clusterId": "c1",
            "operation": "patch",
            "resource": {"apiVersion": "apps/v1", "kind": "Deployment", "namespace": "default", "name": "d"},
            "body": {"spec": {"replicas": 2}},
            "patchType": "merge",
        }))
        .unwrap();
        assert_eq!(request.patch_type.as_deref(), Some("merge"));
        assert_eq!(
            path_of(&request.resource),
            "/apis/apps/v1/namespaces/default/deployments/d"
        );
        assert_eq!(method_of("patch"), Some(Method::PATCH));
        assert_eq!(method_of("watch"), None);
    }
}
