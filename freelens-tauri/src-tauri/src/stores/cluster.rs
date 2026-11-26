/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `lens-cluster-store`: the validation and the projection of
//! `packages/core/src/features/cluster/storage/common/storage.injectable.ts`,
//! and nothing that connects a cluster (`specs/007-main-foundation/data-model.md`,
//! "Cluster store").

use serde_json::{Map, Value};

pub const CONFIG_NAME: &str = "lens-cluster-store";
pub const KEYS: &[&str] = &["clusters"];

/// The keys of a cluster the Electron build reads; any other is one a newer
/// build wrote, and is kept in the file.
pub const FIELDS: &[&str] = &[
    "id",
    "contextName",
    "kubeConfigPath",
    "preferences",
    "metadata",
    "accessibleNamespaces",
    "labels",
];

/// The fields `Cluster.toJSON` writes, in its order.
#[derive(Debug, Clone)]
struct Cluster {
    id: Value,
    context_name: Value,
    kube_config_path: Value,
    preferences: Value,
    metadata: Value,
    accessible_namespaces: Value,
    labels: Value,
}

impl Cluster {
    fn from_model(model: &Map<String, Value>) -> Option<Self> {
        let id = model.get("id")?.clone();
        Some(Self {
            id,
            context_name: model.get("contextName")?.clone(),
            kube_config_path: model.get("kubeConfigPath")?.clone(),
            preferences: model.get("preferences")?.clone(),
            metadata: model.get("metadata")?.clone(),
            accessible_namespaces: model.get("accessibleNamespaces")?.clone(),
            labels: model.get("labels")?.clone(),
        })
    }

    /// `Cluster.updateModel`: the two names always, the rest when given.
    fn update(&mut self, model: &Map<String, Value>) {
        self.kube_config_path = model["kubeConfigPath"].clone();
        self.context_name = model["contextName"].clone();
        for (key, field) in [
            ("preferences", &mut self.preferences),
            ("metadata", &mut self.metadata),
            ("accessibleNamespaces", &mut self.accessible_namespaces),
            ("labels", &mut self.labels),
        ] {
            if let Some(value) = model.get(key) {
                *field = value.clone();
            }
        }
    }

    fn to_json(&self) -> Value {
        let mut model = Map::new();
        model.insert("id".into(), self.id.clone());
        model.insert("contextName".into(), self.context_name.clone());
        model.insert("kubeConfigPath".into(), self.kube_config_path.clone());
        model.insert("preferences".into(), self.preferences.clone());
        model.insert("metadata".into(), self.metadata.clone());
        model.insert(
            "accessibleNamespaces".into(),
            self.accessible_namespaces.clone(),
        );
        model.insert("labels".into(), self.labels.clone());
        Value::Object(model)
    }
}

/// `toJSON(fromStore(data))`: the valid models, each as `Cluster.toJSON` writes
/// it, then the invalid ones as they were, unless a valid one has their id. A
/// cluster `previous` already had keeps what a model leaves out, as
/// `updateModel` does.
pub fn normalize(
    data: &Map<String, Value>,
    previous: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let current: Vec<Cluster> = previous
        .and_then(|model| model.get("clusters"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .filter(|model| is_valid(model))
        .filter_map(Cluster::from_model)
        .collect();
    let mut clusters: Vec<Cluster> = Vec::new();
    let mut invalid: Vec<Value> = Vec::new();
    for model in data
        .get("clusters")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let Some(fields) = model.as_object().filter(|fields| is_valid(fields)) else {
            invalid.push(model.clone());
            continue;
        };
        let id = &fields["id"];
        let mut cluster = current
            .iter()
            .find(|cluster| cluster.id == *id)
            .cloned()
            .unwrap_or_else(|| Cluster {
                id: id.clone(),
                context_name: Value::Null,
                kube_config_path: Value::Null,
                preferences: Value::Object(Map::new()),
                metadata: Value::Object(Map::new()),
                accessible_namespaces: Value::Array(Vec::new()),
                labels: Value::Object(Map::new()),
            });
        cluster.update(fields);
        match clusters.iter_mut().find(|existing| existing.id == *id) {
            Some(existing) => *existing = cluster,
            None => clusters.push(cluster),
        }
    }
    let mut written: Vec<Value> = clusters.iter().map(Cluster::to_json).collect();
    written.extend(invalid.into_iter().filter(|model| {
        let id = model.get("id");
        !clusters.iter().any(|cluster| Some(&cluster.id) == id)
    }));
    let mut out = Map::new();
    out.insert("clusters".into(), Value::Array(written));
    out
}

/// `clusterModelIdChecker` and `updateClusterModelChecker` of
/// `packages/core/src/common/cluster-types.ts`, with Joi's rule that a string
/// is not empty.
pub fn is_valid(model: &Map<String, Value>) -> bool {
    let text = |value: Option<&Value>| {
        value
            .and_then(Value::as_str)
            .is_some_and(|text| !text.is_empty())
    };
    let object_if_given = |key: &str| model.get(key).is_none_or(Value::is_object);
    text(model.get("id"))
        && text(model.get("kubeConfigPath"))
        && text(model.get("contextName"))
        && object_if_given("preferences")
        && object_if_given("metadata")
        && model.get("accessibleNamespaces").is_none_or(|namespaces| {
            namespaces
                .as_array()
                .is_some_and(|namespaces| namespaces.iter().all(|namespace| text(Some(namespace))))
        })
        && model.get("labels").is_none_or(|labels| {
            labels
                .as_object()
                .is_some_and(|labels| labels.values().all(|value| text(Some(value))))
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn normalized(clusters: Value) -> Vec<Value> {
        let data = json!({"clusters": clusters});
        normalize(data.as_object().unwrap(), None)["clusters"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn a_valid_model_is_written_as_cluster_to_json_writes_it() {
        assert_eq!(
            normalized(
                json!([{"contextName": "ctx", "id": "c1", "kubeConfigPath": "/k", "extra": 1}])
            ),
            [
                json!({"id": "c1", "contextName": "ctx", "kubeConfigPath": "/k", "preferences": {}, "metadata": {}, "accessibleNamespaces": [], "labels": {}})
            ]
        );
    }

    #[test]
    fn each_rule_of_the_checkers_rejects_a_model() {
        let base = json!({"id": "c", "kubeConfigPath": "/k", "contextName": "ctx"});
        let with = |key: &str, value: Value| {
            let mut model = base.clone();
            model[key] = value;
            model
        };
        let mut without_id = base.clone();
        without_id.as_object_mut().unwrap().remove("id");
        for model in [
            without_id,
            with("id", json!("")),
            with("kubeConfigPath", json!("")),
            with("contextName", json!(5)),
            with("preferences", json!(null)),
            with("metadata", json!([])),
            with("accessibleNamespaces", json!([1])),
            with("accessibleNamespaces", json!([""])),
            with("labels", json!({"a": ""})),
            with("labels", json!({"a": 1})),
            json!(null),
        ] {
            assert_eq!(
                normalized(json!([model.clone()])),
                std::slice::from_ref(&model),
                "for {model}"
            );
        }
    }

    #[test]
    fn an_invalid_model_with_the_id_of_a_valid_one_is_dropped() {
        let clusters = normalized(json!([
            {"id": "c", "kubeConfigPath": "/k", "contextName": "ctx"},
            {"id": "c", "kubeConfigPath": "", "contextName": "x"},
        ]));
        assert_eq!(clusters.len(), 1);
        assert_eq!(clusters[0]["contextName"], "ctx");
    }

    #[test]
    fn valid_models_with_one_id_collapse_into_the_last_in_the_first_place() {
        let clusters = normalized(json!([
            {"id": "a", "kubeConfigPath": "/k", "contextName": "first", "preferences": {"clusterName": "A"}},
            {"id": "b", "kubeConfigPath": "/k", "contextName": "b"},
            {"id": "a", "kubeConfigPath": "/k2", "contextName": "second"},
        ]));
        assert_eq!(clusters.len(), 2);
        assert_eq!(clusters[0]["contextName"], "second");
        assert_eq!(clusters[0]["preferences"], json!({}));
    }

    #[test]
    fn a_known_cluster_keeps_what_a_model_leaves_out() {
        let first = normalize(
            json!({"clusters": [{"id": "a", "kubeConfigPath": "/k", "contextName": "c", "preferences": {"clusterName": "A"}}]})
                .as_object()
                .unwrap(),
            None,
        );
        let second = normalize(
            json!({"clusters": [{"id": "a", "kubeConfigPath": "/k", "contextName": "renamed"}]})
                .as_object()
                .unwrap(),
            Some(&first),
        );
        assert_eq!(
            second["clusters"][0]["preferences"],
            json!({"clusterName": "A"})
        );
        assert_eq!(second["clusters"][0]["contextName"], "renamed");
    }
}
