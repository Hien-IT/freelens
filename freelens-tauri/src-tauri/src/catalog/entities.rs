/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The JSON of each entity on `catalog:items`
//! (`specs/008-main-catalog/contracts/catalog-entities.md`), and what the
//! cluster manager of the Electron build does with the cluster store without
//! connecting anything (research R6).

use serde_json::{Map, Value, json};

use super::ClusterSource;
use super::syncs::file_label;

const API_VERSION: &str = "entity.k8slens.dev/v1alpha1";

/// What the `file` label depends on.
#[derive(Debug, Clone, Default)]
pub struct LabelContext {
    /// `<data dir>/kubeconfigs`, as the Electron build's string.
    pub app_dir: String,
    /// `os.homedir()`, which reads `HOME`.
    pub home: Option<String>,
}

/// The four general pages, in the order the Electron build registers them.
pub fn general_pages() -> Vec<Value> {
    [
        ("catalog-entity", "Catalog", "/catalog", "view_list"),
        ("terminal-page-entity", "Terminal", "/terminal", "terminal"),
        ("welcome-page-entity", "Welcome Page", "/welcome", "home"),
        (
            "preferences-entity",
            "Preferences",
            "/preferences",
            "settings",
        ),
    ]
    .into_iter()
    .map(|(uid, name, path, material)| {
        json!({
            "metadata": { "uid": uid, "name": name, "source": "app", "labels": {} },
            "status": { "phase": "active" },
            "spec": {
                "path": path,
                "icon": { "material": material, "background": "var(--primary)" },
            },
            "apiVersion": API_VERSION,
            "kind": "General",
        })
    })
    .collect()
}

/// The entity of an entry `{ id, name, url }` of the web link store.
pub fn weblink(entry: &Value, phase: &str) -> Value {
    let field = |key: &str| entry.get(key).cloned().unwrap_or(Value::Null);
    json!({
        "metadata": { "uid": field("id"), "name": field("name"), "source": "local", "labels": {} },
        "status": { "phase": phase, "active": true },
        "spec": { "url": field("url") },
        "apiVersion": API_VERSION,
        "kind": "WebLink",
    })
}

/// The entity of a cluster once the cluster manager has settled it, from its
/// context and its valid entry of the cluster store, if any: as
/// `catalogEntityFromCluster`, `update-entity-metadata` and
/// `update-entity-spec` build it, phase `disconnected`.
pub fn cluster(
    source: &ClusterSource,
    entry: Option<&Map<String, Value>>,
    active: bool,
    labels: &LabelContext,
) -> Value {
    cluster_with(source, entry, active, labels, false)
}

/// `cluster`, for an entity whose `null` icon the cluster manager has
/// cleared: the Electron build leaves it without an icon until one is set.
pub fn cluster_with(
    source: &ClusterSource,
    entry: Option<&Map<String, Value>>,
    active: bool,
    labels: &LabelContext,
    icon_cleared: bool,
) -> Value {
    let empty = Map::new();
    let preferences = entry
        .and_then(|entry| entry.get("preferences"))
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let metadata = entry
        .and_then(|entry| entry.get("metadata"))
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let entry_labels = entry
        .and_then(|entry| entry.get("labels"))
        .and_then(Value::as_object)
        .unwrap_or(&empty);
    let entry_text = |key: &str| {
        entry
            .and_then(|entry| entry.get(key))
            .and_then(Value::as_str)
            .map(str::to_string)
    };
    let path = source.kubeconfig_path.display().to_string();
    let context = entry_text("contextName").unwrap_or_else(|| source.context_name.clone());
    let kubeconfig_path = entry_text("kubeConfigPath").unwrap_or_else(|| path.clone());

    let name = match preferences.get("clusterName") {
        Some(value) if truthy(value) => value.clone(),
        _ => Value::String(context.clone()),
    };
    let mut entity_labels = entry_labels.clone();
    if let Some(file) = file_label(&path, &labels.app_dir, labels.home.as_deref())
        && !entity_labels.contains_key("file")
    {
        entity_labels.insert("file".into(), Value::String(file));
    }

    let mut entity_metadata = Map::new();
    entity_metadata.insert("uid".into(), Value::String(source.id.clone()));
    entity_metadata.insert("name".into(), name);
    entity_metadata.insert("source".into(), Value::String("local".into()));
    entity_metadata.insert("labels".into(), Value::Object(entity_labels));
    entity_metadata.insert("distro".into(), or_unknown(metadata.get("distribution")));
    entity_metadata.insert("kubeVersion".into(), or_unknown(metadata.get("version")));
    for key in [
        "version",
        "id",
        "distribution",
        "nodes",
        "lastSeen",
        "prometheus",
    ] {
        if let Some(value) = metadata.get(key) {
            entity_metadata.insert(key.into(), value.clone());
        }
    }
    if let Some(short_name) = preferences
        .get("iconShortName")
        .filter(|value| truthy(value))
    {
        entity_metadata.insert("shortName".into(), short_name.clone());
    }

    let mut icon = Map::new();
    let mut has_icon = !icon_cleared;
    match preferences.get("icon") {
        Some(Value::Null) => has_icon = false,
        Some(value) if truthy(value) => {
            let text = js_string(value);
            let place = if text.starts_with("data:") {
                "src"
            } else {
                "background"
            };
            icon.insert(place.into(), value.clone());
            has_icon = true;
        }
        _ => {}
    }
    let mut prometheus = Map::new();
    if let Some(kind) = preferences
        .get("prometheusProvider")
        .and_then(Value::as_object)
        .and_then(|provider| provider.get("type"))
    {
        prometheus.insert("type".into(), kind.clone());
    }
    if let Some(address) = preferences.get("prometheus") {
        prometheus.insert("address".into(), address.clone());
    }
    let mut spec = Map::new();
    spec.insert("kubeconfigPath".into(), Value::String(kubeconfig_path));
    spec.insert("kubeconfigContext".into(), Value::String(context));
    if has_icon {
        spec.insert("icon".into(), Value::Object(icon));
    }
    spec.insert(
        "metrics".into(),
        json!({ "source": "local", "prometheus": Value::Object(prometheus) }),
    );

    json!({
        "metadata": Value::Object(entity_metadata),
        "status": {
            "phase": "disconnected",
            "reason": "",
            "message": "",
            "active": active,
            "enabled": true,
        },
        "spec": Value::Object(spec),
        "apiVersion": API_VERSION,
        "kind": "KubernetesCluster",
    })
}

/// The entry the cluster manager adds to the cluster store for a context
/// that has none (`addCluster` with `accessibleNamespaces: []`).
pub fn new_entry(source: &ClusterSource) -> Value {
    json!({
        "id": source.id,
        "contextName": source.context_name,
        "kubeConfigPath": source.kubeconfig_path.display().to_string(),
        "preferences": {},
        "metadata": {},
        "accessibleNamespaces": [],
        "labels": {},
    })
}

/// The entry without the `null` icon and short name that the cluster manager
/// clears from it, or `None` when it has neither.
pub fn cleared(entry: &Map<String, Value>) -> Option<Map<String, Value>> {
    let preferences = entry.get("preferences").and_then(Value::as_object)?;
    let nulls: Vec<&str> = ["iconShortName", "icon"]
        .into_iter()
        .filter(|key| preferences.get(*key) == Some(&Value::Null))
        .collect();
    if nulls.is_empty() {
        return None;
    }
    let mut preferences = preferences.clone();
    for key in nulls {
        preferences.shift_remove(key);
    }
    let mut entry = entry.clone();
    entry.insert("preferences".into(), Value::Object(preferences));
    Some(entry)
}

/// `value?.toString() || "unknown"`.
fn or_unknown(value: Option<&Value>) -> Value {
    match value {
        None | Some(Value::Null) => Value::String("unknown".into()),
        Some(value) => {
            let text = js_string(value);
            Value::String(if text.is_empty() {
                "unknown".into()
            } else {
                text
            })
        }
    }
}

/// JavaScript's `String(value)` for a JSON value.
fn js_string(value: &Value) -> String {
    match value {
        Value::Null => "null".into(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(number) => number.to_string(),
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| match item {
                Value::Null => String::new(),
                other => js_string(other),
            })
            .collect::<Vec<_>>()
            .join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// JavaScript's truthiness of a JSON value.
fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0 && !n.is_nan()),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use super::*;

    fn source() -> ClusterSource {
        ClusterSource {
            id: "c1".into(),
            context_name: "ctx".into(),
            kubeconfig_path: PathBuf::from("/Users/me/work/dev.yaml"),
        }
    }

    fn labels() -> LabelContext {
        LabelContext {
            app_dir: "/data/kubeconfigs".into(),
            home: Some("/Users/me".into()),
        }
    }

    fn entry(extra: Value) -> Map<String, Value> {
        let mut entry = new_entry(&source()).as_object().unwrap().clone();
        for (key, value) in extra.as_object().unwrap() {
            entry.insert(key.clone(), value.clone());
        }
        entry
    }

    fn with(extra: Value) -> Value {
        cluster(&source(), Some(&entry(extra)), false, &labels())
    }

    #[test]
    fn the_general_pages_are_the_electron_build_s() {
        let pages = general_pages();
        assert_eq!(pages.len(), 4);
        assert_eq!(
            pages[0],
            json!({
                "metadata": { "uid": "catalog-entity", "name": "Catalog", "source": "app", "labels": {} },
                "status": { "phase": "active" },
                "spec": { "path": "/catalog", "icon": { "material": "view_list", "background": "var(--primary)" } },
                "apiVersion": "entity.k8slens.dev/v1alpha1",
                "kind": "General",
            })
        );
        let uids: Vec<&str> = pages
            .iter()
            .map(|page| page["metadata"]["uid"].as_str().unwrap())
            .collect();
        assert_eq!(
            uids,
            [
                "catalog-entity",
                "terminal-page-entity",
                "welcome-page-entity",
                "preferences-entity"
            ]
        );
    }

    #[test]
    fn a_web_link_is_the_electron_build_s() {
        assert_eq!(
            weblink(
                &json!({ "id": "w1", "name": "Docs", "url": "https://example.invalid" }),
                "unavailable"
            ),
            json!({
                "metadata": { "uid": "w1", "name": "Docs", "source": "local", "labels": {} },
                "status": { "phase": "unavailable", "active": true },
                "spec": { "url": "https://example.invalid" },
                "apiVersion": "entity.k8slens.dev/v1alpha1",
                "kind": "WebLink",
            })
        );
    }

    #[test]
    fn a_cluster_without_a_store_entry() {
        assert_eq!(
            cluster(&source(), None, false, &labels()),
            json!({
                "metadata": {
                    "uid": "c1",
                    "name": "ctx",
                    "source": "local",
                    "labels": { "file": "~/work/dev.yaml" },
                    "distro": "unknown",
                    "kubeVersion": "unknown",
                },
                "status": { "phase": "disconnected", "reason": "", "message": "", "active": false, "enabled": true },
                "spec": {
                    "kubeconfigPath": "/Users/me/work/dev.yaml",
                    "kubeconfigContext": "ctx",
                    "icon": {},
                    "metrics": { "source": "local", "prometheus": {} },
                },
                "apiVersion": "entity.k8slens.dev/v1alpha1",
                "kind": "KubernetesCluster",
            })
        );
    }

    #[test]
    fn the_metadata_of_the_entry_reaches_the_entity() {
        let entity = with(json!({ "metadata": {} }));
        assert!(entity["metadata"].get("lastSeen").is_none());
        assert_eq!(entity["metadata"]["kubeVersion"], "unknown");
        let entity = with(json!({ "metadata": {
            "lastSeen": "some-date",
            "version": "some-version",
            "nodes": 42,
            "prometheus": { "provider": "some-provider", "success": true },
            "distribution": "some-distribution",
            "id": "some-cluster-id",
        }}));
        let metadata = &entity["metadata"];
        assert_eq!(metadata["lastSeen"], "some-date");
        assert_eq!(metadata["version"], "some-version");
        assert_eq!(metadata["kubeVersion"], "some-version");
        assert_eq!(metadata["nodes"], 42);
        assert_eq!(
            metadata["prometheus"],
            json!({ "provider": "some-provider", "success": true })
        );
        assert_eq!(metadata["distribution"], "some-distribution");
        assert_eq!(metadata["distro"], "some-distribution");
        assert_eq!(metadata["id"], "some-cluster-id");
    }

    #[test]
    fn the_labels_of_the_entry_follow_the_file_label_and_win() {
        let entity = with(json!({ "labels": { "team": "a", "file": "mine" } }));
        assert_eq!(
            entity["metadata"]["labels"],
            json!({ "team": "a", "file": "mine" })
        );
        let entity = with(json!({ "labels": { "team": "a" } }));
        assert_eq!(
            entity["metadata"]["labels"],
            json!({ "team": "a", "file": "~/work/dev.yaml" })
        );
    }

    #[test]
    fn the_preferences_name_and_short_name_reach_the_entity() {
        let entity = with(
            json!({ "preferences": { "clusterName": "some-cluster-name", "iconShortName": "W2NP" } }),
        );
        assert_eq!(entity["metadata"]["name"], "some-cluster-name");
        assert_eq!(entity["metadata"]["shortName"], "W2NP");
        let entity = with(json!({ "preferences": { "clusterName": "" } }));
        assert_eq!(entity["metadata"]["name"], "ctx");
        assert!(entity["metadata"].get("shortName").is_none());
    }

    #[test]
    fn a_null_short_name_and_icon_are_cleared_from_the_entity_and_the_entry() {
        let raw = entry(
            json!({ "preferences": { "iconShortName": null, "icon": null, "clusterName": "n" } }),
        );
        let entity = cluster(&source(), Some(&raw), false, &labels());
        assert!(entity["metadata"].get("shortName").is_none());
        assert!(entity["spec"].get("icon").is_none());
        let cleared_entry = cleared(&raw).unwrap();
        assert_eq!(cleared_entry["preferences"], json!({ "clusterName": "n" }));
        assert_eq!(cleared(&entry(json!({}))), None);
    }

    #[test]
    fn the_icon_is_a_source_for_a_data_url_and_a_background_otherwise() {
        let entity = with(json!({ "preferences": { "icon": "data:image/png;base64,AAAA" } }));
        assert_eq!(
            entity["spec"]["icon"],
            json!({ "src": "data:image/png;base64,AAAA" })
        );
        let entity = with(json!({ "preferences": { "icon": "#ff0000" } }));
        assert_eq!(entity["spec"]["icon"], json!({ "background": "#ff0000" }));
    }

    #[test]
    fn the_metrics_settings_reach_the_spec() {
        let entity = with(json!({ "preferences": {
            "prometheus": { "namespace": "monitoring", "service": "prometheus", "port": 9090, "prefix": "" },
            "prometheusProvider": { "type": "operator" },
        }}));
        assert_eq!(
            entity["spec"]["metrics"],
            json!({ "source": "local", "prometheus": {
                "type": "operator",
                "address": { "namespace": "monitoring", "service": "prometheus", "port": 9090, "prefix": "" },
            }})
        );
    }

    #[test]
    fn the_active_flag_follows_the_visible_cluster() {
        assert_eq!(
            cluster(&source(), None, true, &labels())["status"]["active"],
            true
        );
    }

    #[test]
    fn a_new_entry_is_what_add_cluster_writes() {
        assert_eq!(
            new_entry(&source()),
            json!({
                "id": "c1",
                "contextName": "ctx",
                "kubeConfigPath": "/Users/me/work/dev.yaml",
                "preferences": {},
                "metadata": {},
                "accessibleNamespaces": [],
                "labels": {},
            })
        );
    }

    #[test]
    fn the_file_label_is_left_out_inside_the_application_s_directory() {
        let inside = ClusterSource {
            kubeconfig_path: PathBuf::from("/data/kubeconfigs/1234"),
            ..source()
        };
        assert_eq!(
            cluster(&inside, None, false, &labels())["metadata"]["labels"],
            json!({})
        );
    }
}
