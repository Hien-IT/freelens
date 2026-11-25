/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `lens-user-store`: the preferences, read and written by the rules of
//! `packages/core/src/features/user-preferences/common/preference-descriptors.injectable.ts`
//! (`specs/007-main-foundation/data-model.md`, "Preferences").

use serde_json::{Map, Value, json};

use super::{Machine, js_number_value, truthy};

pub const CONFIG_NAME: &str = "lens-user-store";
/// The keys `toJSON` writes.
pub const KEYS: &[&str] = &["preferences"];

const ZOOM_STEPS: [f64; 10] = [
    67.0, 75.0, 80.0, 90.0, 100.0, 110.0, 125.0, 150.0, 175.0, 200.0,
];
const DEFAULT_ZOOM: f64 = 100.0;
const DEFAULT_THEME: &str = "freelens";
const LOG_VIEWER_KEYS: [&str; 3] = ["showTimestamps", "showWordWrap", "maxCombinedLogsPods"];

/// The preferences the later areas of the core read, with their defaults.
#[derive(Debug, Clone, PartialEq)]
pub struct Preferences {
    pub https_proxy: Option<String>,
    pub allow_untrusted_cas: bool,
    pub shell: Option<String>,
    pub download_kubectl_binaries: bool,
    pub download_binaries_path: Option<String>,
    pub kubectl_binaries_path: Option<String>,
    pub helm_binaries_path: Option<String>,
}

impl Preferences {
    /// Reads the model of the store, whose values are already normalized.
    pub fn from_model(model: &Map<String, Value>) -> Self {
        let empty = Map::new();
        let preferences = model
            .get("preferences")
            .and_then(Value::as_object)
            .unwrap_or(&empty);
        let text = |key: &str| {
            preferences
                .get(key)
                .and_then(Value::as_str)
                .map(str::to_string)
        };
        Self {
            https_proxy: text("httpsProxy"),
            allow_untrusted_cas: preferences.get("allowUntrustedCAs").is_some_and(truthy),
            shell: text("shell"),
            download_kubectl_binaries: preferences
                .get("downloadKubectlBinaries")
                .is_none_or(truthy),
            download_binaries_path: text("downloadBinariesPath"),
            kubectl_binaries_path: text("kubectlBinariesPath"),
            helm_binaries_path: text("helmBinariesPath"),
        }
    }
}

/// `toJSON(fromStore(data))` of the Electron build. `previous` is the model
/// before this one, whose state some descriptors keep: the order of the
/// kubeconfig sync entries, and the editor and terminal settings a partial
/// value is merged into.
pub fn normalize(
    data: &Map<String, Value>,
    previous: Option<&Map<String, Value>>,
    machine: &Machine,
) -> Map<String, Value> {
    let stored = match data.get("preferences") {
        Some(Value::Object(preferences)) => migrate_legacy_theme(preferences.clone()),
        _ => Map::new(),
    };
    let previous = previous
        .and_then(|model| model.get("preferences"))
        .and_then(Value::as_object);
    let get = |key: &str| stored.get(key);
    let mut out = Map::new();
    let mut put = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            out.insert(key.to_string(), value);
        }
    };

    put(
        "allowErrorReporting",
        default_true(get("allowErrorReporting")),
    );
    put("allowUntrustedCAs", default_false(get("allowUntrustedCAs")));
    put(
        "theme",
        get("theme")
            .filter(|value| truthy(value) && value.as_str() != Some(DEFAULT_THEME))
            .cloned(),
    );
    put(
        "themeVariant",
        get("themeVariant")
            .filter(|value| matches!(value.as_str(), Some("dark" | "light")))
            .cloned(),
    );
    put("accentColorDark", if_truthy(get("accentColorDark")));
    put("accentColorLight", if_truthy(get("accentColorLight")));
    put(
        "zoom",
        get("zoom")
            .and_then(Value::as_f64)
            .filter(|zoom| ZOOM_STEPS.contains(zoom) && *zoom != DEFAULT_ZOOM)
            .map(js_number_value),
    );
    put(
        "downloadBinariesPath",
        if_truthy(get("downloadBinariesPath")),
    );
    put(
        "downloadKubectlBinaries",
        default_true(get("downloadKubectlBinaries")),
    );
    put(
        "downloadMirror",
        get("downloadMirror")
            .filter(|value| value.as_str() == Some("custom"))
            .cloned(),
    );
    put(
        "downloadCustomMirror",
        if_truthy(get("downloadCustomMirror")),
    );
    put(
        "editorConfiguration",
        Some(merged(
            editor_default(),
            previous.and_then(|p| p.get("editorConfiguration")),
            get("editorConfiguration"),
        )),
    );
    put(
        "extensionRegistryUrl",
        extension_registry(get("extensionRegistryUrl")),
    );
    put("helmBinariesPath", if_truthy(get("helmBinariesPath")));
    put("helmServerSide", default_true(get("helmServerSide")));
    put(
        "hiddenTableColumns",
        hidden_table_columns(get("hiddenTableColumns")),
    );
    put("httpsProxy", if_truthy(get("httpsProxy")));
    put("kubectlBinariesPath", if_truthy(get("kubectlBinariesPath")));
    put(
        "localeTimezone",
        get("localeTimezone")
            .filter(|value| truthy(value) && value.as_str() != Some(machine.timezone.as_str()))
            .cloned(),
    );
    put("openAtLogin", default_false(get("openAtLogin")));
    put("showTrayIcon", default_true(get("showTrayIcon")));
    put("hotbarAutoHide", default_false(get("hotbarAutoHide")));
    put("persistentSearch", default_false(get("persistentSearch")));
    put(
        "logViewerPreferences",
        log_viewer(get("logViewerPreferences")),
    );
    put("shell", if_truthy(get("shell")));
    put(
        "syncKubeconfigEntries",
        sync_entries(
            get("syncKubeconfigEntries"),
            previous.and_then(|p| p.get("syncKubeconfigEntries")),
            previous.is_some(),
            machine,
        ),
    );
    put(
        "terminalConfig",
        Some(merged(
            json!({"fontSize": 12, "fontFamily": "RobotoMono"}),
            previous.and_then(|p| p.get("terminalConfig")),
            get("terminalConfig"),
        )),
    );
    put(
        "terminalCopyOnSelect",
        default_false(get("terminalCopyOnSelect")),
    );
    put("terminalTheme", if_truthy(get("terminalTheme")));
    put(
        "terminalThemeVariant",
        get("terminalThemeVariant")
            .filter(|value| value.as_str() == Some("light"))
            .cloned(),
    );
    put("clusterPageMenuOrder", get("clusterPageMenuOrder").cloned());

    let mut model = Map::new();
    model.insert("preferences".into(), Value::Object(out));
    model
}

/// `migrateLegacyThemePreferences`: `colorTheme` gives way to `theme` and
/// `themeVariant`, and a `terminalTheme` of `Dark` or `Light` to a variant.
fn migrate_legacy_theme(mut preferences: Map<String, Value>) -> Map<String, Value> {
    let color_theme = super::js_json::remove_key(&mut preferences, "colorTheme");
    if let Some(color_theme) = color_theme
        && !preferences.contains_key("theme")
        && !preferences.contains_key("themeVariant")
    {
        preferences.insert("theme".into(), DEFAULT_THEME.into());
        let variant = match color_theme.as_str() {
            Some("system") => "system",
            Some("Light") => "light",
            _ => "dark",
        };
        preferences.insert("themeVariant".into(), variant.into());
    }
    if let Some(terminal_theme @ ("Dark" | "Light")) =
        preferences.get("terminalTheme").and_then(Value::as_str)
    {
        let variant = if terminal_theme == "Light" {
            "light"
        } else {
            "dark"
        };
        preferences.insert("terminalThemeVariant".into(), variant.into());
        preferences.insert("terminalTheme".into(), DEFAULT_THEME.into());
    }
    preferences
}

/// `val || undefined`.
fn if_truthy(value: Option<&Value>) -> Option<Value> {
    value.filter(|value| truthy(value)).cloned()
}

/// `fromStore: val ?? false`, `toStore: !val ? undefined : val`.
fn default_false(value: Option<&Value>) -> Option<Value> {
    value.filter(|value| truthy(value)).cloned()
}

/// `fromStore: val ?? true`, `toStore: val ? undefined : val`.
fn default_true(value: Option<&Value>) -> Option<Value> {
    match value {
        None | Some(Value::Null) => None,
        Some(value) if truthy(value) => None,
        Some(value) => Some(value.clone()),
    }
}

fn editor_default() -> Value {
    json!({
        "tabSize": 2,
        "lineNumbers": "on",
        "fontSize": 12,
        "fontFamily": "RobotoMono",
        "minimap": {"enabled": true, "side": "right"},
    })
}

/// `merge(defaults, val)` of `es-toolkit/compat`. In the Electron build the
/// merge writes into the shared defaults, so a later read starts from the
/// previous one's result; `previous` stands for that.
fn merged(defaults: Value, previous: Option<&Value>, stored: Option<&Value>) -> Value {
    let mut target = previous.cloned().unwrap_or(defaults);
    if let Some(source @ Value::Object(_)) = stored {
        merge_into(&mut target, source);
    }
    target
}

/// Lodash's `merge`: plain objects and arrays merge key by key, `undefined`
/// is skipped, anything else replaces.
fn merge_into(target: &mut Value, source: &Value) {
    match (target, source) {
        (Value::Object(target), Value::Object(source)) => {
            for (key, value) in source {
                match target.get_mut(key) {
                    Some(existing) if is_container(existing) && is_container(value) => {
                        merge_into(existing, value)
                    }
                    _ => {
                        target.insert(key.clone(), fresh_merge(value));
                    }
                }
            }
        }
        (Value::Array(target), Value::Array(source)) => {
            for (index, value) in source.iter().enumerate() {
                match target.get_mut(index) {
                    Some(existing) if is_container(existing) && is_container(value) => {
                        merge_into(existing, value)
                    }
                    Some(existing) => *existing = fresh_merge(value),
                    None => target.push(fresh_merge(value)),
                }
            }
        }
        (target, source) => *target = fresh_merge(source),
    }
}

fn is_container(value: &Value) -> bool {
    matches!(value, Value::Object(_) | Value::Array(_))
}

fn fresh_merge(value: &Value) -> Value {
    value.clone()
}

/// `!val || val.location === "npmrc"` reads as the default location, which is
/// not written.
fn extension_registry(value: Option<&Value>) -> Option<Value> {
    let value = value.filter(|value| truthy(value))?;
    match value.get("location").and_then(Value::as_str) {
        Some("npmrc" | "default") => None,
        _ => Some(value.clone()),
    }
}

/// `[[tableId, [columns]]]` read as a map of sets; only the non-empty sets are
/// written.
fn hidden_table_columns(value: Option<&Value>) -> Option<Value> {
    let entries = value.and_then(Value::as_array)?;
    let mut tables: Vec<(Value, Vec<Value>)> = Vec::new();
    for entry in entries {
        let Some(pair) = entry.as_array() else {
            continue;
        };
        let table = pair.first().cloned().unwrap_or(Value::Null);
        let mut columns: Vec<Value> = Vec::new();
        for column in pair.get(1).and_then(Value::as_array).into_iter().flatten() {
            if !columns.contains(column) {
                columns.push(column.clone());
            }
        }
        match tables.iter_mut().find(|(existing, _)| *existing == table) {
            Some((_, existing)) => *existing = columns,
            None => tables.push((table, columns)),
        }
    }
    let written: Vec<Value> = tables
        .into_iter()
        .filter(|(_, columns)| !columns.is_empty())
        .map(|(table, columns)| json!([table, columns]))
        .collect();
    (!written.is_empty()).then(|| Value::Array(written))
}

/// The log viewer's defaults overlaid by the stored value, the pod count
/// clamped; only the keys that differ from the defaults are written.
fn log_viewer(value: Option<&Value>) -> Option<Value> {
    let defaults =
        json!({"showTimestamps": false, "showWordWrap": true, "maxCombinedLogsPods": 20});
    let stored = value.and_then(Value::as_object);
    let mut written = Map::new();
    for key in LOG_VIEWER_KEYS {
        let read = if key == "maxCombinedLogsPods" {
            clamp_pods(stored.and_then(|stored| stored.get(key)))
        } else {
            stored
                .and_then(|stored| stored.get(key))
                .cloned()
                .unwrap_or_else(|| defaults[key].clone())
        };
        if !strictly_equal(&read, &defaults[key]) {
            written.insert(key.to_string(), read);
        }
    }
    (!written.is_empty()).then_some(Value::Object(written))
}

fn clamp_pods(value: Option<&Value>) -> Value {
    match value
        .and_then(Value::as_f64)
        .filter(|pods| pods.is_finite())
    {
        // Math.round rounds halves up.
        Some(pods) => js_number_value((pods + 0.5).floor().clamp(1.0, 100.0)),
        None => json!(20),
    }
}

/// `===` between two JSON values of the descriptors: numbers by value, other
/// primitives by value, containers never equal.
fn strictly_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Number(left), Value::Number(right)) => left.as_f64() == right.as_f64(),
        (Value::Object(_) | Value::Array(_), _) | (_, Value::Object(_) | Value::Array(_)) => false,
        (left, right) => left == right,
    }
}

/// The kubeconfig files to sync: `[~/.kube]` in a production build and `[]`
/// in a development one when the key is absent; the default is not written.
/// The Electron build keeps the entries in one map across reads, so an entry
/// read again keeps its place.
fn sync_entries(
    value: Option<&Value>,
    previous: Option<&Value>,
    has_previous: bool,
    machine: &Machine,
) -> Option<Value> {
    let defaults: Vec<String> = match machine.build {
        crate::foundation::paths::BuildKind::Release => vec![machine.kube_dir.clone()],
        crate::foundation::paths::BuildKind::Debug => Vec::new(),
    };
    let as_entries = |entries: &Vec<Value>| -> Vec<(Value, Map<String, Value>)> {
        let mut map: Vec<(Value, Map<String, Value>)> = Vec::new();
        for entry in entries {
            let Some(entry) = entry.as_object() else {
                continue;
            };
            let mut rest = entry.clone();
            let file_path =
                super::js_json::remove_key(&mut rest, "filePath").unwrap_or(Value::Null);
            match map.iter_mut().find(|(existing, _)| *existing == file_path) {
                Some((_, existing)) => *existing = rest,
                None => map.push((file_path, rest)),
            }
        }
        map
    };
    let default_entries = || {
        defaults
            .iter()
            .map(|path| (Value::String(path.clone()), Map::new()))
            .collect::<Vec<_>>()
    };
    let desired = match value.and_then(Value::as_array) {
        Some(entries) => as_entries(entries),
        None => default_entries(),
    };
    let before = match previous.and_then(Value::as_array) {
        Some(entries) => as_entries(entries),
        None if has_previous => default_entries(),
        None => Vec::new(),
    };
    let mut entries: Vec<(Value, Map<String, Value>)> = before
        .into_iter()
        .filter_map(|(path, _)| {
            desired
                .iter()
                .find(|(wanted, _)| *wanted == path)
                .map(|(_, rest)| (path, rest.clone()))
        })
        .collect();
    for (path, rest) in &desired {
        if !entries.iter().any(|(existing, _)| existing == path) {
            entries.push((path.clone(), rest.clone()));
        }
    }
    let is_default = entries.len() == defaults.len()
        && defaults.iter().all(|path| {
            entries
                .iter()
                .any(|(existing, _)| existing.as_str() == Some(path))
        });
    if is_default {
        return None;
    }
    Some(Value::Array(
        entries
            .into_iter()
            .map(|(path, rest)| {
                let mut entry = Map::new();
                if !path.is_null() {
                    entry.insert("filePath".into(), path);
                }
                entry.extend(rest);
                Value::Object(entry)
            })
            .collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::foundation::paths::BuildKind;

    fn machine(build: BuildKind) -> Machine {
        Machine {
            kube_dir: "/home/test/.kube".into(),
            timezone: "UTC".into(),
            build,
        }
    }

    fn preferences_of(stored: Value) -> Map<String, Value> {
        preferences_with(stored, BuildKind::Release)
    }

    fn preferences_with(stored: Value, build: BuildKind) -> Map<String, Value> {
        let data = json!({"preferences": stored});
        let model = normalize(data.as_object().unwrap(), None, &machine(build));
        model["preferences"].as_object().unwrap().clone()
    }

    fn written(stored: Value, key: &str) -> Option<Value> {
        preferences_of(stored).get(key).cloned()
    }

    #[test]
    fn the_defaults_write_only_the_editor_and_terminal_settings() {
        let preferences = preferences_of(json!({}));
        let keys: Vec<_> = preferences.keys().cloned().collect();
        assert_eq!(keys, ["editorConfiguration", "terminalConfig"]);
    }

    #[test]
    fn text_preferences_are_written_when_not_empty() {
        for key in [
            "httpsProxy",
            "shell",
            "accentColorDark",
            "accentColorLight",
            "downloadBinariesPath",
            "kubectlBinariesPath",
            "helmBinariesPath",
            "terminalTheme",
            "downloadCustomMirror",
        ] {
            assert_eq!(
                written(json!({key: "x"}), key),
                Some(json!("x")),
                "for {key}"
            );
            assert_eq!(written(json!({key: ""}), key), None, "for {key}");
        }
    }

    #[test]
    fn the_theme_and_its_variants() {
        assert_eq!(
            written(json!({"theme": "dracula"}), "theme"),
            Some(json!("dracula"))
        );
        assert_eq!(written(json!({"theme": "freelens"}), "theme"), None);
        assert_eq!(
            written(json!({"themeVariant": "dark"}), "themeVariant"),
            Some(json!("dark"))
        );
        assert_eq!(
            written(json!({"themeVariant": "system"}), "themeVariant"),
            None
        );
        assert_eq!(
            written(
                json!({"terminalThemeVariant": "light"}),
                "terminalThemeVariant"
            ),
            Some(json!("light"))
        );
        assert_eq!(
            written(
                json!({"terminalThemeVariant": "dark"}),
                "terminalThemeVariant"
            ),
            None
        );
    }

    #[test]
    fn the_zoom_is_a_step_other_than_100() {
        assert_eq!(written(json!({"zoom": 125}), "zoom"), Some(json!(125)));
        assert_eq!(written(json!({"zoom": 125.0}), "zoom"), Some(json!(125)));
        assert_eq!(written(json!({"zoom": 100}), "zoom"), None);
        assert_eq!(written(json!({"zoom": 101}), "zoom"), None);
    }

    #[test]
    fn the_time_zone_is_written_when_it_is_not_the_current_one() {
        assert_eq!(
            written(json!({"localeTimezone": "Europe/Paris"}), "localeTimezone"),
            Some(json!("Europe/Paris"))
        );
        assert_eq!(
            written(json!({"localeTimezone": "UTC"}), "localeTimezone"),
            None
        );
    }

    #[test]
    fn flags_are_written_only_away_from_their_default() {
        for key in [
            "allowUntrustedCAs",
            "openAtLogin",
            "hotbarAutoHide",
            "persistentSearch",
            "terminalCopyOnSelect",
        ] {
            assert_eq!(
                written(json!({key: true}), key),
                Some(json!(true)),
                "for {key}"
            );
            assert_eq!(written(json!({key: false}), key), None, "for {key}");
        }
        for key in [
            "allowErrorReporting",
            "downloadKubectlBinaries",
            "helmServerSide",
            "showTrayIcon",
        ] {
            assert_eq!(
                written(json!({key: false}), key),
                Some(json!(false)),
                "for {key}"
            );
            assert_eq!(written(json!({key: true}), key), None, "for {key}");
            assert_eq!(written(json!({key: null}), key), None, "for {key}");
        }
    }

    #[test]
    fn the_download_mirror_is_written_when_custom() {
        assert_eq!(
            written(json!({"downloadMirror": "custom"}), "downloadMirror"),
            Some(json!("custom"))
        );
        assert_eq!(
            written(json!({"downloadMirror": "default"}), "downloadMirror"),
            None
        );
        assert_eq!(
            written(json!({"downloadMirror": "other"}), "downloadMirror"),
            None
        );
    }

    #[test]
    fn the_log_viewer_writes_what_differs_from_its_defaults() {
        assert_eq!(
            written(
                json!({"logViewerPreferences": {"showTimestamps": true, "maxCombinedLogsPods": 250, "extra": 1}}),
                "logViewerPreferences"
            ),
            Some(json!({"showTimestamps": true, "maxCombinedLogsPods": 100}))
        );
        assert_eq!(
            written(
                json!({"logViewerPreferences": {"maxCombinedLogsPods": 2.5}}),
                "logViewerPreferences"
            ),
            Some(json!({"maxCombinedLogsPods": 3}))
        );
        assert_eq!(
            written(
                json!({"logViewerPreferences": {"maxCombinedLogsPods": 20.4}}),
                "logViewerPreferences"
            ),
            None
        );
        assert_eq!(
            written(
                json!({"logViewerPreferences": {"maxCombinedLogsPods": "many"}}),
                "logViewerPreferences"
            ),
            None
        );
    }

    #[test]
    fn hidden_columns_keep_the_tables_with_columns() {
        assert_eq!(
            written(
                json!({"hiddenTableColumns": [["pods", ["age", "qos", "age"]], ["nodes", []], ["pods2", ["x"]]]}),
                "hiddenTableColumns"
            ),
            Some(json!([["pods", ["age", "qos"]], ["pods2", ["x"]]]))
        );
        assert_eq!(
            written(
                json!({"hiddenTableColumns": [["nodes", []]]}),
                "hiddenTableColumns"
            ),
            None
        );
    }

    #[test]
    fn the_editor_and_terminal_settings_merge_into_their_defaults() {
        assert_eq!(
            written(
                json!({"editorConfiguration": {"tabSize": 4, "minimap": {"enabled": false}}}),
                "editorConfiguration"
            ),
            Some(
                json!({"tabSize": 4, "lineNumbers": "on", "fontSize": 12, "fontFamily": "RobotoMono", "minimap": {"enabled": false, "side": "right"}})
            )
        );
        assert_eq!(
            written(
                json!({"terminalConfig": {"fontSize": 14, "extra": true}}),
                "terminalConfig"
            ),
            Some(json!({"fontSize": 14, "fontFamily": "RobotoMono", "extra": true}))
        );
    }

    #[test]
    fn the_extension_registry_writes_only_a_custom_location() {
        let custom = json!({"location": "custom", "customUrl": "https://registry.example"});
        assert_eq!(
            written(
                json!({"extensionRegistryUrl": custom}),
                "extensionRegistryUrl"
            ),
            Some(custom)
        );
        for location in ["npmrc", "default"] {
            assert_eq!(
                written(
                    json!({"extensionRegistryUrl": {"location": location}}),
                    "extensionRegistryUrl"
                ),
                None
            );
        }
    }

    #[test]
    fn the_cluster_page_menu_order_passes_through() {
        let order = json!({"workloads": 1});
        assert_eq!(
            written(
                json!({"clusterPageMenuOrder": order}),
                "clusterPageMenuOrder"
            ),
            Some(order)
        );
    }

    // migrate-legacy-theme-preferences.test.ts
    #[test]
    fn a_legacy_color_theme_gives_the_theme_and_its_variant() {
        let cases = [
            ("system", None),
            ("Light", Some("light")),
            ("Dark", Some("dark")),
            ("other", Some("dark")),
        ];
        for (color_theme, variant) in cases {
            let preferences = preferences_of(json!({"colorTheme": color_theme}));
            assert_eq!(preferences.get("theme"), None, "for {color_theme}");
            assert_eq!(
                preferences.get("themeVariant").and_then(Value::as_str),
                variant,
                "for {color_theme}"
            );
        }
    }

    #[test]
    fn a_legacy_color_theme_does_not_override_a_theme() {
        let preferences = preferences_of(json!({"colorTheme": "Light", "theme": "dracula"}));
        assert_eq!(preferences.get("theme"), Some(&json!("dracula")));
        assert_eq!(preferences.get("themeVariant"), None);
    }

    #[test]
    fn a_legacy_terminal_theme_gives_its_variant() {
        let preferences = preferences_of(json!({"terminalTheme": "Light"}));
        assert_eq!(preferences.get("terminalTheme"), Some(&json!("freelens")));
        assert_eq!(
            preferences.get("terminalThemeVariant"),
            Some(&json!("light"))
        );
        let preferences = preferences_of(json!({"terminalTheme": "Dark"}));
        assert_eq!(preferences.get("terminalThemeVariant"), None);
    }

    // sync-kubeconfig-entries-default.test.ts
    #[test]
    fn the_sync_entries_default_to_the_kube_directory_in_production() {
        assert_eq!(
            preferences_with(json!({}), BuildKind::Release).get("syncKubeconfigEntries"),
            None
        );
        assert_eq!(
            preferences_with(json!({"syncKubeconfigEntries": []}), BuildKind::Release)
                .get("syncKubeconfigEntries"),
            Some(&json!([]))
        );
        assert_eq!(
            preferences_with(
                json!({"syncKubeconfigEntries": [{"filePath": "/home/test/.kube"}]}),
                BuildKind::Release
            )
            .get("syncKubeconfigEntries"),
            None
        );
    }

    #[test]
    fn the_sync_entries_default_to_none_in_development() {
        assert_eq!(
            preferences_with(json!({}), BuildKind::Debug).get("syncKubeconfigEntries"),
            None
        );
        assert_eq!(
            preferences_with(json!({"syncKubeconfigEntries": []}), BuildKind::Debug)
                .get("syncKubeconfigEntries"),
            None
        );
        assert_eq!(
            preferences_with(
                json!({"syncKubeconfigEntries": [{"filePath": "/home/test/.kube"}]}),
                BuildKind::Debug
            )
            .get("syncKubeconfigEntries"),
            Some(&json!([{"filePath": "/home/test/.kube"}]))
        );
    }

    #[test]
    fn a_sync_entry_read_again_keeps_its_place() {
        let first = normalize(
            json!({"preferences": {"syncKubeconfigEntries": [{"filePath": "/a"}, {"filePath": "/b"}]}})
                .as_object()
                .unwrap(),
            None,
            &machine(BuildKind::Release),
        );
        let second = normalize(
            json!({"preferences": {"syncKubeconfigEntries": [{"filePath": "/c"}, {"filePath": "/b"}, {"filePath": "/a", "x": 1}]}})
                .as_object()
                .unwrap(),
            Some(&first),
            &machine(BuildKind::Release),
        );
        assert_eq!(
            second["preferences"]["syncKubeconfigEntries"],
            json!([{"filePath": "/a", "x": 1}, {"filePath": "/b"}, {"filePath": "/c"}])
        );
    }

    #[test]
    fn the_typed_preferences_apply_the_defaults() {
        let model = normalize(
            json!({"preferences": {"httpsProxy": "http://proxy:3128", "allowUntrustedCAs": true}})
                .as_object()
                .unwrap(),
            None,
            &machine(BuildKind::Release),
        );
        let preferences = Preferences::from_model(&model);
        assert_eq!(
            preferences.https_proxy.as_deref(),
            Some("http://proxy:3128")
        );
        assert!(preferences.allow_untrusted_cas);
        assert!(preferences.download_kubectl_binaries);
        assert_eq!(preferences.shell, None);
    }
}
