/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `lens-weblink-store`, as `packages/core/src/features/weblinks/common/storage.injectable.ts`
//! reads and writes it (`specs/007-main-foundation/data-model.md`, "Web link store").

use serde_json::{Map, Value};

pub const CONFIG_NAME: &str = "lens-weblink-store";
pub const KEYS: &[&str] = &["weblinks"];

/// `toJSON(fromStore(data))`: the web links keyed by id, a later one with the
/// same id replacing the earlier in its place, each written as it is.
pub fn normalize(data: &Map<String, Value>) -> Map<String, Value> {
    let mut weblinks: Vec<(Option<Value>, Value)> = Vec::new();
    for weblink in data
        .get("weblinks")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
    {
        let id = weblink.get("id").cloned();
        match weblinks.iter_mut().find(|(existing, _)| *existing == id) {
            Some((_, existing)) => *existing = weblink.clone(),
            None => weblinks.push((id, weblink.clone())),
        }
    }
    let mut model = Map::new();
    model.insert(
        "weblinks".into(),
        Value::Array(weblinks.into_iter().map(|(_, weblink)| weblink).collect()),
    );
    model
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn web_links_with_one_id_collapse_into_the_last_in_the_first_place() {
        let data = json!({"weblinks": [
            {"id": "w1", "name": "A", "extra": true},
            {"id": "w2", "name": "B"},
            {"id": "w1", "name": "A2"},
        ]});
        assert_eq!(
            Value::Object(normalize(data.as_object().unwrap())),
            json!({"weblinks": [{"id": "w1", "name": "A2"}, {"id": "w2", "name": "B"}]})
        );
        assert_eq!(
            Value::Object(normalize(&Map::new())),
            json!({"weblinks": []})
        );
    }
}
