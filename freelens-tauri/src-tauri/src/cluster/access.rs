/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! What the user may see in a cluster
//! (`specs/009-main-cluster-connection/contracts/connection.md`,
//! "Accessibility"; research R6), as `refreshAccessibility` of the Electron
//! build's `ClusterConnection` learns it.

use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use http::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use super::{BoxFuture, ClientError};

/// The requests of the core to one cluster, each within the 30 s limit of
/// `k8sRequest`.
pub trait Api: Send + Sync {
    fn request<'a>(
        &'a self,
        method: Method,
        path: &'a str,
        body: Option<Value>,
    ) -> BoxFuture<'a, Result<Value, ClientError>>;

    /// The id of the cluster, for the messages of failed requests.
    fn cluster_id(&self) -> &str;
}

/// A kind of resource the cluster serves (data-model.md,
/// `ClusterState.knownResources`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct KnownResource {
    #[serde(rename = "apiName")]
    pub api_name: String,
    pub kind: String,
    pub group: String,
    pub version: String,
    pub namespaced: bool,
}

impl KnownResource {
    /// `formatKubeApiResource` of `common/rbac.ts`: `<group>/<apiName>`, or
    /// `<apiName>` for the core group.
    pub fn formatted(&self) -> String {
        if self.group.is_empty() {
            self.api_name.clone()
        } else {
            format!("{}/{}", self.group, self.api_name)
        }
    }
}

/// What the accessibility refresh learns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Access {
    pub is_admin: bool,
    pub is_global_watch_enabled: bool,
    pub allowed_namespaces: Vec<String>,
    pub known_resources: Vec<KnownResource>,
    pub resources_to_show: Vec<String>,
}

/// The cluster's settings the refresh reads.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Settings {
    /// `accessibleNamespaces` of the cluster store entry.
    pub accessible_namespaces: Vec<String>,
    /// `preferences.defaultNamespace`, else the namespace of the context.
    pub default_namespace: Option<String>,
    /// `preferences.skipNamespaceAuthorizationCheck`.
    pub skip_namespace_authorization_check: bool,
}

/// What the refresh tells the views and the log.
pub trait Report: Send + Sync {
    fn warning(&self, message: String);
    fn error(&self, message: String);
    fn namespaces_forbidden(&self);
    fn log(&self, line: String);
}

/// The attempts of an API version list: 5, after 1, 2, 4 and 8 s
/// (`packages/utility-features/utilities/src/backoff-caller.ts`).
const ATTEMPTS: u32 = 5;
const FIRST_DELAY: Duration = Duration::from_secs(1);
/// The group version lists requested at once (`limitAsync(…, 5)`).
const AT_ONCE: usize = 5;

/// How an error of a request reads in a message, as `${error}` writes an
/// `Error` of `k8sRequest` or the abort reason of its timeout.
pub fn error_text(api: &dyn Api, method: &str, path: &str, error: &ClientError) -> String {
    match error {
        ClientError::Timeout => error.to_string(),
        _ => format!(
            "Error: {}",
            error.request_message(method, path, api.cluster_id())
        ),
    }
}

/// `createCanI`: a `SelfSubjectAccessReview`, `false` on any error.
pub async fn can_i(api: &dyn Api, report: &dyn Report, attributes: Value) -> bool {
    let body = json!({
        "apiVersion": "authorization.k8s.io/v1",
        "kind": "SelfSubjectAccessReview",
        "spec": {"resourceAttributes": attributes},
    });
    match api
        .request(
            Method::POST,
            "/apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
            Some(body),
        )
        .await
    {
        Ok(review) => review["status"]["allowed"].as_bool().unwrap_or(false),
        Err(error) => {
            report.log(format!(
                "[AUTHORIZATION-REVIEW]: failed to create access review: {error}"
            ));
            false
        }
    }
}

/// `requestAllowedNamespaces` of the connection.
pub async fn allowed_namespaces(
    api: &dyn Api,
    report: &dyn Report,
    settings: &Settings,
) -> Vec<String> {
    if !settings.accessible_namespaces.is_empty() {
        return settings.accessible_namespaces.clone();
    }
    match api.request(Method::GET, "/api/v1/namespaces", None).await {
        Ok(list) => list["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|item| item["metadata"]["name"].as_str().map(str::to_string))
            .collect(),
        Err(error) => {
            let fallback: Vec<String> = settings
                .default_namespace
                .iter()
                .filter(|namespace| !namespace.is_empty())
                .cloned()
                .collect();
            if fallback.is_empty() && error.status_code() == Some(403) {
                report.log(format!(
                    "[CLUSTER]: listing namespaces is forbidden, broadcasting {{\"clusterId\":\"{}\"}}",
                    api.cluster_id()
                ));
                report.namespaces_forbidden();
            }
            fallback
        }
    }
}

/// One group version to list the resources of.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ListGroup {
    pub group: String,
    pub version: String,
    pub path: String,
}

/// `request-core-api-versions`: the versions of `/api`.
pub async fn core_versions(api: &dyn Api) -> Result<Vec<ListGroup>, ClientError> {
    let answer = api.request(Method::GET, "/api", None).await?;
    Ok(answer["versions"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|version| ListGroup {
            group: String::new(),
            version: version.to_string(),
            path: format!("/api/{version}"),
        })
        .collect())
}

/// `request-non-core-api-versions`: every version of every group of `/apis`.
pub async fn non_core_versions(api: &dyn Api) -> Result<Vec<ListGroup>, ClientError> {
    let answer = api.request(Method::GET, "/apis", None).await?;
    Ok(answer["groups"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|group| {
            let name = group["name"].as_str().unwrap_or_default().to_string();
            group["versions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(move |version| {
                    Some(ListGroup {
                        group: name.clone(),
                        version: version["version"].as_str()?.to_string(),
                        path: format!("/apis/{}", version["groupVersion"].as_str()?),
                    })
                })
        })
        .collect())
}

/// `request-kube-api-resources-for`: the resources of one group version.
async fn resources_of(api: &dyn Api, list: &ListGroup) -> Result<Vec<KnownResource>, ClientError> {
    let answer = api.request(Method::GET, &list.path, None).await?;
    Ok(answer["resources"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|resource| {
            Some(KnownResource {
                api_name: resource["name"].as_str()?.to_string(),
                kind: resource["kind"].as_str().unwrap_or_default().to_string(),
                group: list.group.clone(),
                version: list.version.clone(),
                namespaced: resource["namespaced"].as_bool().unwrap_or(false),
            })
        })
        .collect())
}

/// `request-api-resources`: the version lists with their backoff, then the
/// resources of each, five at a time; `None` when a version list fails.
pub async fn request_api_resources(
    api: &dyn Api,
    report: &dyn Report,
) -> Option<Vec<KnownResource>> {
    let mut groups = Vec::new();
    for (path, core) in [("/api", true), ("/apis", false)] {
        let mut delay = FIRST_DELAY;
        let mut listed = None;
        for attempt in 1..=ATTEMPTS {
            let result = if core {
                core_versions(api).await
            } else {
                non_core_versions(api).await
            };
            match result {
                Ok(list) => {
                    listed = Some(list);
                    break;
                }
                Err(error) => {
                    let text = error_text(api, "get", path, &error);
                    report.warning(format!(
                        "Failed to list kube API resource kinds, attempt {attempt}: {text}"
                    ));
                    report.log(format!(
                        "[LIST-API-RESOURCES]: failed to list kube api resources: {text}"
                    ));
                    if attempt < ATTEMPTS {
                        tokio::time::sleep(delay).await;
                        delay *= 2;
                    }
                }
            }
        }
        groups.extend(listed?);
    }
    let mut results = Vec::with_capacity(groups.len());
    for chunk in groups.chunks(AT_ONCE) {
        let lists = chunk.iter().map(|list| resources_of(api, list));
        results.extend(chunk.iter().cloned().zip(join_all(lists).await));
    }
    let mut resources = Vec::new();
    for (list, result) in results {
        match result {
            Ok(found) => resources.extend(found),
            Err(_) => report.warning(format!(
                "Kube APIs under \"{}\" may not be displayed",
                list.path
            )),
        }
    }
    Some(resources)
}

/// The predicate of a namespace's `SelfSubjectRulesReview`: whether a
/// resource may be listed there (`create-request-namespace-list-permissions`).
pub type Permission = Arc<dyn Fn(&KnownResource) -> bool + Send + Sync>;

pub fn allow_all() -> Permission {
    Arc::new(|_| true)
}

/// The rules review of one namespace; an incomplete or failed review allows
/// all.
pub async fn namespace_permissions(
    api: &dyn Api,
    report: &dyn Report,
    namespace: &str,
) -> Permission {
    let body = json!({
        "apiVersion": "authorization.k8s.io/v1",
        "kind": "SelfSubjectRulesReview",
        "spec": {"namespace": namespace},
    });
    let review = match api
        .request(
            Method::POST,
            "/apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
            Some(body),
        )
        .await
    {
        Ok(review) => review,
        Err(error) => {
            report.log(format!(
                "[AUTHORIZATION-NAMESPACE-REVIEW]: failed to create subject rules review {{\"namespace\":\"{namespace}\",\"error\":\"{error}\"}}"
            ));
            return allow_all();
        }
    };
    let status = &review["status"];
    if status.is_null() || status["incomplete"].as_bool().unwrap_or(false) {
        report.log(format!(
            "[AUTHORIZATION-NAMESPACE-REVIEW]: allowing all resources in namespace=\"{namespace}\" due to incomplete SelfSubjectRulesReview: {}",
            status["evaluationError"].as_str().unwrap_or("undefined")
        ));
        return allow_all();
    }
    let rules: Vec<(Vec<String>, Vec<String>, Vec<String>)> = status["resourceRules"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|rule| {
            let list = |name: &str, default: &[&str]| -> Vec<String> {
                match rule.get(name).and_then(Value::as_array) {
                    Some(items) => items
                        .iter()
                        .filter_map(Value::as_str)
                        .map(str::to_string)
                        .collect(),
                    None => default.iter().map(|item| item.to_string()).collect(),
                }
            };
            (
                list("apiGroups", &["*"]),
                list("resources", &["*"]),
                list("verbs", &[]),
            )
        })
        .collect();
    Arc::new(move |resource: &KnownResource| {
        rules.iter().any(|(groups, resources, verbs)| {
            (groups.iter().any(|g| g == "*" || *g == resource.group))
                && (resources
                    .iter()
                    .any(|r| r == "*" || *r == resource.api_name))
                && (verbs.iter().any(|v| v == "*" || v == "list"))
        })
    })
}

/// `getResourcesToShow`: the resources any allowed namespace lets the user
/// list, the reviews five at a time.
pub async fn resources_to_show(
    api: &dyn Api,
    report: &dyn Report,
    settings: &Settings,
    allowed: &[String],
    known: &[KnownResource],
) -> Vec<String> {
    if allowed.is_empty() {
        return Vec::new();
    }
    let mut permissions = Vec::new();
    if settings.skip_namespace_authorization_check {
        permissions.push(allow_all());
    } else {
        for chunk in allowed.chunks(AT_ONCE) {
            permissions.extend(
                join_all(
                    chunk
                        .iter()
                        .map(|namespace| namespace_permissions(api, report, namespace)),
                )
                .await,
            );
        }
    }
    known
        .iter()
        .filter(|resource| permissions.iter().any(|allows| allows(resource)))
        .map(KnownResource::formatted)
        .collect()
}

/// The whole refresh, in the order of the Electron build; `previous` is the
/// list of known resources from the last refresh.
pub async fn refresh(
    api: &dyn Api,
    report: &dyn Report,
    settings: &Settings,
    previous: &[KnownResource],
) -> Access {
    let is_admin = can_i(
        api,
        report,
        json!({"namespace": "kube-system", "resource": "*", "verb": "create"}),
    )
    .await;
    let is_global_watch_enabled =
        can_i(api, report, json!({"verb": "watch", "resource": "*"})).await;
    let allowed_namespaces = allowed_namespaces(api, report, settings).await;
    let known_resources = match request_api_resources(api, report).await {
        Some(resources) => resources,
        None if !previous.is_empty() => {
            report.log(
                "[CLUSTER]: failed to list KUBE resources, sticking with previous list".into(),
            );
            previous.to_vec()
        }
        None => {
            report.log(
                "[CLUSTER]: failed to list KUBE resources for the first time, blocking connection to cluster..."
                    .into(),
            );
            report.error("Failed to list kube API resources, please reconnect...".into());
            Vec::new()
        }
    };
    let resources_to_show =
        resources_to_show(api, report, settings, &allowed_namespaces, &known_resources).await;
    Access {
        is_admin,
        is_global_watch_enabled,
        allowed_namespaces,
        known_resources,
        resources_to_show,
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// Answers by `<METHOD> <path>`, each a list answered in turn, the last
    /// repeated; records every request with its body.
    #[derive(Default)]
    pub(crate) struct FakeApi {
        pub(crate) answers: Mutex<HashMap<String, Vec<Result<Value, ClientError>>>>,
        pub(crate) requests: Mutex<Vec<(String, Option<Value>)>>,
    }

    impl FakeApi {
        pub(crate) fn answer(&self, route: &str, answer: Result<Value, ClientError>) {
            self.answers
                .lock()
                .unwrap()
                .entry(route.to_string())
                .or_default()
                .push(answer);
        }

        pub(crate) fn routes(&self) -> Vec<String> {
            self.requests
                .lock()
                .unwrap()
                .iter()
                .map(|(route, _)| route.clone())
                .collect()
        }
    }

    impl Api for FakeApi {
        fn request<'a>(
            &'a self,
            method: Method,
            path: &'a str,
            body: Option<Value>,
        ) -> BoxFuture<'a, Result<Value, ClientError>> {
            let route = format!("{method} {path}");
            self.requests.lock().unwrap().push((route.clone(), body));
            let answer = {
                let mut answers = self.answers.lock().unwrap();
                match answers.get_mut(&route) {
                    Some(list) if list.len() > 1 => list.remove(0),
                    Some(list) => list[0].clone(),
                    None => Err(ClientError::Status {
                        status: 404,
                        error: "not found".into(),
                    }),
                }
            };
            Box::pin(async move { answer })
        }

        fn cluster_id(&self) -> &str {
            "some-cluster-id"
        }
    }

    #[derive(Default)]
    pub(crate) struct Reported {
        pub(crate) warnings: Mutex<Vec<String>>,
        pub(crate) errors: Mutex<Vec<String>>,
        pub(crate) forbidden: Mutex<usize>,
        pub(crate) lines: Mutex<Vec<String>>,
    }

    impl Report for Reported {
        fn warning(&self, message: String) {
            self.warnings.lock().unwrap().push(message);
        }
        fn error(&self, message: String) {
            self.errors.lock().unwrap().push(message);
        }
        fn namespaces_forbidden(&self) {
            *self.forbidden.lock().unwrap() += 1;
        }
        fn log(&self, line: String) {
            self.lines.lock().unwrap().push(line);
        }
    }

    // pc/main/cluster/request-non-core-api-versions.test.ts

    #[tokio::test]
    async fn apis_is_requested() {
        let api = FakeApi::default();
        api.answer("GET /apis", Ok(json!({"groups": []})));
        assert_eq!(non_core_versions(&api).await, Ok(Vec::new()));
        assert_eq!(api.routes(), ["GET /apis"]);
    }

    fn group(name: &str, versions: &[&str]) -> Value {
        json!({"name": name, "versions": versions.iter().map(|v| json!({"groupVersion": format!("{name}/{v}"), "version": v})).collect::<Vec<_>>()})
    }

    fn list(group: &str, version: &str) -> ListGroup {
        ListGroup {
            group: group.into(),
            version: version.into(),
            path: format!("/apis/{group}/{version}"),
        }
    }

    #[tokio::test]
    async fn each_version_of_each_group_is_a_list_group_in_order() {
        let api = FakeApi::default();
        api.answer("GET /apis", Ok(json!({"groups": [group("apps", &["v1"])]})));
        assert_eq!(non_core_versions(&api).await, Ok(vec![list("apps", "v1")]));

        let api = FakeApi::default();
        api.answer(
            "GET /apis",
            Ok(json!({"groups": [group("x.io", &["v1", "v1beta1"])]})),
        );
        assert_eq!(
            non_core_versions(&api).await,
            Ok(vec![list("x.io", "v1"), list("x.io", "v1beta1")])
        );

        let api = FakeApi::default();
        api.answer(
            "GET /apis",
            Ok(json!({"groups": [group("a.io", &["v1", "v2"]), group("b.io", &["v1"])]})),
        );
        assert_eq!(
            non_core_versions(&api).await,
            Ok(vec![
                list("a.io", "v1"),
                list("a.io", "v2"),
                list("b.io", "v1")
            ])
        );
    }

    // pc/common/cluster/request-namespace-list-permissions.test.ts

    fn pods() -> KnownResource {
        KnownResource {
            api_name: "pods".into(),
            kind: "Pod".into(),
            group: String::new(),
            version: "v1".into(),
            namespaced: true,
        }
    }

    async fn permission_for(status: Value) -> bool {
        let api = FakeApi::default();
        api.answer(
            "POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
            Ok(json!({"status": status})),
        );
        let reported = Reported::default();
        let allows = namespace_permissions(&api, &reported, "irrelevant").await;
        allows(&pods())
    }

    #[tokio::test]
    async fn the_review_is_sent_for_the_namespace() {
        let api = FakeApi::default();
        api.answer(
            "POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
            Ok(json!({"status": {"incomplete": true}})),
        );
        namespace_permissions(&api, &Reported::default(), "some-namespace").await;
        assert_eq!(
            api.requests.lock().unwrap()[0].1,
            Some(json!({
                "apiVersion": "authorization.k8s.io/v1",
                "kind": "SelfSubjectRulesReview",
                "spec": {"namespace": "some-namespace"},
            }))
        );
    }

    #[tokio::test]
    async fn the_predicate_of_the_rules() {
        assert!(permission_for(json!({"incomplete": true})).await);
        let rule = |groups: Value, resources: Value, verbs: Value| json!({"apiGroups": groups, "resources": resources, "verbs": verbs});
        let other = rule(json!(["x"]), json!(["y"]), json!(["get"]));
        let all = rule(json!(["*"]), json!(["*"]), json!(["*"]));
        assert!(permission_for(json!({"resourceRules": [all.clone(), other.clone()]})).await);
        assert!(permission_for(json!({"resourceRules": [other.clone(), all]})).await);
        assert!(
            permission_for(
                json!({"resourceRules": [rule(json!(["*"]), json!(["*"]), json!(["list"]))]})
            )
            .await
        );
        let exact = rule(json!([""]), json!(["pods"]), json!(["list"]));
        assert!(permission_for(json!({"resourceRules": [exact.clone(), other.clone()]})).await);
        assert!(permission_for(json!({"resourceRules": [other.clone(), exact]})).await);
        assert!(
            !permission_for(
                json!({"resourceRules": [rule(json!([""]), json!(["pods"]), json!(["get"]))]})
            )
            .await
        );
        assert!(
            !permission_for(
                json!({"resourceRules": [rule(json!([""]), json!(["services"]), json!(["list"]))]})
            )
            .await
        );
    }

    #[tokio::test]
    async fn a_rejected_review_allows_all() {
        let api = FakeApi::default();
        api.answer(
            "POST /apis/authorization.k8s.io/v1/selfsubjectrulesreviews",
            Err(ClientError::Status {
                status: 500,
                error: "boom".into(),
            }),
        );
        let allows = namespace_permissions(&api, &Reported::default(), "ns").await;
        assert!(allows(&pods()));
    }

    // The steps of refreshAccessibility (research R6)

    #[tokio::test]
    async fn the_accessible_namespaces_setting_skips_the_list() {
        let api = FakeApi::default();
        let settings = Settings {
            accessible_namespaces: vec!["a".into()],
            ..Settings::default()
        };
        assert_eq!(
            allowed_namespaces(&api, &Reported::default(), &settings).await,
            ["a"]
        );
        assert!(api.routes().is_empty());
    }

    #[tokio::test]
    async fn a_forbidden_list_falls_back_to_the_default_namespace_or_broadcasts() {
        let forbidden = || {
            Err(ClientError::Status {
                status: 403,
                error: "forbidden".into(),
            })
        };
        let api = FakeApi::default();
        api.answer("GET /api/v1/namespaces", forbidden());
        let reported = Reported::default();
        let settings = Settings {
            default_namespace: Some("mine".into()),
            ..Settings::default()
        };
        assert_eq!(
            allowed_namespaces(&api, &reported, &settings).await,
            ["mine"]
        );
        assert_eq!(*reported.forbidden.lock().unwrap(), 0);

        let reported = Reported::default();
        assert!(
            allowed_namespaces(&api, &reported, &Settings::default())
                .await
                .is_empty()
        );
        assert_eq!(*reported.forbidden.lock().unwrap(), 1);

        let api = FakeApi::default();
        api.answer("GET /api/v1/namespaces", Err(ClientError::Timeout));
        let reported = Reported::default();
        assert!(
            allowed_namespaces(&api, &reported, &Settings::default())
                .await
                .is_empty()
        );
        assert_eq!(*reported.forbidden.lock().unwrap(), 0);
    }

    #[tokio::test(start_paused = true)]
    async fn a_version_list_is_tried_five_times_with_a_warning_each() {
        let api = FakeApi::default();
        api.answer(
            "GET /api",
            Err(ClientError::Status {
                status: 500,
                error: "down".into(),
            }),
        );
        let reported = Reported::default();
        let started = tokio::time::Instant::now();
        assert_eq!(request_api_resources(&api, &reported).await, None);
        assert_eq!(started.elapsed(), Duration::from_secs(1 + 2 + 4 + 8));
        let warnings = reported.warnings.lock().unwrap().clone();
        assert_eq!(warnings.len(), 5);
        assert_eq!(
            warnings[0],
            "Failed to list kube API resource kinds, attempt 1: Error: Failed to get /api for clusterId=some-cluster-id: down"
        );
        assert!(!api.routes().contains(&"GET /apis".to_string()));
    }

    #[tokio::test]
    async fn a_failed_group_is_skipped_with_a_warning() {
        let api = FakeApi::default();
        api.answer("GET /api", Ok(json!({"versions": ["v1"]})));
        api.answer("GET /apis", Ok(json!({"groups": [group("apps", &["v1"])]})));
        api.answer(
            "GET /api/v1",
            Ok(json!({"resources": [{"name": "pods", "kind": "Pod", "namespaced": true}, {"name": "pods/log", "kind": "Pod", "namespaced": true}]})),
        );
        let reported = Reported::default();
        let resources = request_api_resources(&api, &reported).await.unwrap();
        assert_eq!(
            resources
                .iter()
                .map(KnownResource::formatted)
                .collect::<Vec<_>>(),
            ["pods", "pods/log"]
        );
        assert_eq!(
            *reported.warnings.lock().unwrap(),
            ["Kube APIs under \"/apis/apps/v1\" may not be displayed"]
        );
    }

    #[tokio::test(start_paused = true)]
    async fn a_first_failure_blocks_and_a_later_one_keeps_the_list() {
        let api = FakeApi::default();
        api.answer(
            "POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
            Ok(json!({"status": {"allowed": true}})),
        );
        api.answer("GET /api/v1/namespaces", Ok(json!({"items": []})));
        api.answer("GET /api", Err(ClientError::Timeout));
        let reported = Reported::default();
        let access = refresh(&api, &reported, &Settings::default(), &[]).await;
        assert!(access.known_resources.is_empty());
        assert_eq!(
            *reported.errors.lock().unwrap(),
            ["Failed to list kube API resources, please reconnect..."]
        );
        let reported = Reported::default();
        let access = refresh(&api, &reported, &Settings::default(), &[pods()]).await;
        assert_eq!(access.known_resources, [pods()]);
        assert!(reported.errors.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn skip_namespace_authorization_check_sends_no_review() {
        let api = FakeApi::default();
        let settings = Settings {
            skip_namespace_authorization_check: true,
            ..Settings::default()
        };
        let shown = resources_to_show(
            &api,
            &Reported::default(),
            &settings,
            &["a".into()],
            &[pods()],
        )
        .await;
        assert_eq!(shown, ["pods"]);
        assert!(api.routes().is_empty());
        let none = resources_to_show(
            &api,
            &Reported::default(),
            &Settings::default(),
            &[],
            &[pods()],
        )
        .await;
        assert!(none.is_empty());
    }

    #[tokio::test]
    async fn an_access_review_error_is_false_and_logged() {
        let api = FakeApi::default();
        api.answer(
            "POST /apis/authorization.k8s.io/v1/selfsubjectaccessreviews",
            Err(ClientError::Timeout),
        );
        let reported = Reported::default();
        assert!(!can_i(&api, &reported, json!({"verb": "watch", "resource": "*"})).await);
        assert_eq!(
            *reported.lines.lock().unwrap(),
            [
                "[AUTHORIZATION-REVIEW]: failed to create access review: Operation timed out: timeout 30s"
            ]
        );
    }
}
