/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `freelens-favorites-store`, as `packages/core/src/features/favorites/common/storage.injectable.ts`
//! reads and writes it (`specs/007-main-foundation/data-model.md`, "Favorites store").

use serde_json::{Map, Value};

pub const CONFIG_NAME: &str = "freelens-favorites-store";
pub const KEYS: &[&str] = &["items", "useShortNames"];

/// `toJSON(fromStore(data))`: the items as they are, `[]` when there are none;
/// short names on unless the store turns them off.
pub fn normalize(data: &Map<String, Value>) -> Map<String, Value> {
    let items = match data.get("items") {
        Some(Value::Array(items)) => items.clone(),
        // `data.items || []`; a value that is not a list would stop the
        // Electron build, and is read as none.
        _ => Vec::new(),
    };
    let use_short_names = match data.get("useShortNames") {
        None | Some(Value::Null) => Value::Bool(true),
        Some(value) => value.clone(),
    };
    let mut model = Map::new();
    model.insert("items".into(), Value::Array(items));
    model.insert("useShortNames".into(), use_short_names);
    model
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn normalized(data: Value) -> Value {
        Value::Object(normalize(data.as_object().unwrap()))
    }

    #[test]
    fn an_empty_store_has_no_favorites_and_short_names() {
        assert_eq!(
            normalized(json!({})),
            json!({"items": [], "useShortNames": true})
        );
        assert_eq!(
            normalized(json!({"items": null, "useShortNames": null})),
            json!({"items": [], "useShortNames": true})
        );
    }

    #[test]
    fn stored_favorites_are_restored_in_order() {
        let items = json!([
            {"id": "sidebar-item-pods", "type": "static", "title": "Pods", "order": 10},
            {"id": "crd-example", "type": "crd", "title": "Examples", "order": 20, "group": "example.io"},
        ]);
        assert_eq!(
            normalized(json!({"items": items, "useShortNames": false})),
            json!({"items": items, "useShortNames": false})
        );
    }
}
