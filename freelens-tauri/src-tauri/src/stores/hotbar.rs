/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `lens-hotbar-store`, as `packages/core/src/features/hotbar/storage/common/storage.injectable.ts`
//! reads and writes it (`specs/007-main-foundation/data-model.md`, "Hotbar store").

use serde_json::{Map, Value, json};

use super::truthy;

pub const CONFIG_NAME: &str = "lens-hotbar-store";
pub const KEYS: &[&str] = &["hotbars", "activeHotbarId"];
const CELLS: usize = 12;

/// `toJSON(fromStore(data))`. The active hotbar is state in the Electron
/// build, so a model without one keeps `previous`'s.
pub fn normalize(
    data: &Map<String, Value>,
    previous: Option<&Map<String, Value>>,
) -> Map<String, Value> {
    let stored = data.get("hotbars").and_then(Value::as_array);
    let mut hotbars: Vec<(Option<Value>, Map<String, Value>)> = Vec::new();
    match stored.filter(|hotbars| !hotbars.is_empty()) {
        None => hotbars.push((None, default_hotbar())),
        Some(stored) => {
            for hotbar in stored {
                // Keyed by the stored id, as the Electron build's map is: hotbars
                // without one collapse, though each gets an id of its own.
                let key = hotbar.get("id").cloned();
                let created = create(hotbar);
                match hotbars.iter_mut().find(|(existing, _)| *existing == key) {
                    Some((_, existing)) => *existing = created,
                    None => hotbars.push((key, created)),
                }
            }
        }
    }
    let ids: Vec<Value> = hotbars
        .iter()
        .map(|(_, hotbar)| hotbar["id"].clone())
        .collect();
    let mut active = data
        .get("activeHotbarId")
        .filter(|id| truthy(id))
        .cloned()
        .or_else(|| previous.and_then(|model| model.get("activeHotbarId").cloned()));
    if !active
        .as_ref()
        .is_some_and(|id| truthy(id) && ids.contains(id))
    {
        active = ids.first().cloned();
    }
    let mut model = Map::new();
    model.insert(
        "hotbars".into(),
        Value::Array(
            hotbars
                .into_iter()
                .map(|(_, hotbar)| Value::Object(hotbar))
                .collect(),
        ),
    );
    if let Some(active) = active {
        model.insert("activeHotbarId".into(), active);
    }
    model
}

/// `new Hotbar(data)`: an id of its own when none, twelve empty cells when no
/// items; then exactly twelve cells.
fn create(data: &Value) -> Map<String, Value> {
    let id = match data.get("id") {
        None | Some(Value::Null) => Value::String(uuid::Uuid::new_v4().to_string()),
        Some(id) => id.clone(),
    };
    let items = match data.get("items") {
        None | Some(Value::Null) => vec![Value::Null; CELLS],
        Some(Value::Array(items)) => items.clone(),
        Some(_) => Vec::new(),
    };
    let mut hotbar = Map::new();
    hotbar.insert("id".into(), id);
    hotbar.insert("items".into(), Value::Array(exactly_twelve(items)));
    if let Some(name) = data.get("name") {
        hotbar.insert("name".into(), name.clone());
    }
    hotbar
}

fn default_hotbar() -> Map<String, Value> {
    let mut items = vec![Value::Null; CELLS];
    items[0] =
        json!({"entity": {"uid": "welcome-page-entity", "name": "Welcome Page", "source": "app"}});
    items[1] = json!({"entity": {"uid": "catalog-entity", "name": "Catalog", "source": "app"}});
    let mut hotbar = Map::new();
    hotbar.insert("id".into(), Value::String(uuid::Uuid::new_v4().to_string()));
    hotbar.insert("items".into(), Value::Array(items));
    hotbar.insert("name".into(), "Default".into());
    hotbar
}

/// `ensureExactHotbarItemLength`: pad with empty cells; to shorten, drop the
/// last empty cell first, then cut the end.
fn exactly_twelve(mut items: Vec<Value>) -> Vec<Value> {
    items.resize(items.len().max(CELLS), Value::Null);
    while items.len() > CELLS {
        match items.iter().rposition(Value::is_null) {
            Some(index) => {
                items.remove(index);
            }
            None => items.truncate(CELLS),
        }
    }
    items
}

#[cfg(test)]
mod tests {
    use super::*;

    fn normalized(data: Value) -> Map<String, Value> {
        normalize(data.as_object().unwrap(), None)
    }

    fn item(uid: &str) -> Value {
        json!({"entity": {"uid": uid, "name": uid, "source": "local"}})
    }

    fn uids(hotbar: &Value) -> Vec<Option<String>> {
        hotbar["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["entity"]["uid"].as_str().map(str::to_string))
            .collect()
    }

    #[test]
    fn no_hotbar_gives_the_default_one() {
        let model = normalized(json!({}));
        let hotbars = model["hotbars"].as_array().unwrap();
        assert_eq!(hotbars.len(), 1);
        assert_eq!(hotbars[0]["name"], "Default");
        assert!(uuid::Uuid::parse_str(hotbars[0]["id"].as_str().unwrap()).is_ok());
        assert_eq!(
            uids(&hotbars[0])[..3],
            [
                Some("welcome-page-entity".into()),
                Some("catalog-entity".into()),
                None
            ]
        );
        assert_eq!(hotbars[0]["items"].as_array().unwrap().len(), 12);
        assert_eq!(model["activeHotbarId"], hotbars[0]["id"]);
        assert_eq!(
            normalized(json!({"hotbars": []}))["hotbars"][0]["name"],
            "Default"
        );
    }

    #[test]
    fn every_hotbar_has_twelve_cells() {
        let mut long = vec![item("a"), Value::Null, item("b"), Value::Null];
        long.extend((0..9).map(|index| item(&format!("x{index}"))));
        long.push(Value::Null);
        let full: Vec<Value> = (0..13).map(|index| item(&format!("f{index}"))).collect();
        let model = normalized(json!({"hotbars": [
            {"id": "short", "name": "S", "items": [item("a")]},
            {"id": "long", "name": "L", "items": long},
            {"id": "full", "name": "F", "items": full},
            {"id": "none", "name": "N"},
        ]}));
        let hotbars = model["hotbars"].as_array().unwrap();
        for hotbar in hotbars {
            assert_eq!(hotbar["items"].as_array().unwrap().len(), 12);
        }
        assert_eq!(
            uids(&hotbars[1])[..4],
            [Some("a".into()), None, Some("b".into()), Some("x0".into())]
        );
        assert_eq!(uids(&hotbars[2])[11], Some("f11".into()));
        assert!(uids(&hotbars[3]).iter().all(Option::is_none));
    }

    #[test]
    fn hotbars_with_one_id_collapse_into_the_last() {
        let model = normalized(json!({"hotbars": [
            {"id": "same", "name": "First"},
            {"id": "other", "name": "Other"},
            {"id": "same", "name": "Second"},
        ], "activeHotbarId": "other"}));
        let names: Vec<_> = model["hotbars"]
            .as_array()
            .unwrap()
            .iter()
            .map(|hotbar| hotbar["name"].clone())
            .collect();
        assert_eq!(names, [json!("Second"), json!("Other")]);
        assert_eq!(model["activeHotbarId"], "other");
    }

    #[test]
    fn an_unknown_active_hotbar_becomes_the_first() {
        let model =
            normalized(json!({"hotbars": [{"id": "a"}, {"id": "b"}], "activeHotbarId": "missing"}));
        assert_eq!(model["activeHotbarId"], "a");
    }

    #[test]
    fn a_model_without_an_active_hotbar_keeps_the_previous_one() {
        let first =
            normalized(json!({"hotbars": [{"id": "a"}, {"id": "b"}], "activeHotbarId": "b"}));
        let second = normalize(
            json!({"hotbars": [{"id": "a"}, {"id": "b"}]})
                .as_object()
                .unwrap(),
            Some(&first),
        );
        assert_eq!(second["activeHotbarId"], "b");
    }
}
