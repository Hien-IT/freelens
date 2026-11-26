/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Reading a synced kubeconfig file as the Electron build's kubeconfig sync
//! reads it: the size limits, the encodings, and the loader of
//! `common/kube-helpers/main/kube-helpers.ts` with js-yaml's, Joi's and
//! client-node's rules (`specs/008-main-catalog/contracts/synced-files.md`,
//! "Reading" and "Loading"; research R3).
//!
//! Kubeconfig text holds credentials: no error built here quotes it.

use std::path::Path;

use serde_json::{Map, Value};

use super::CatalogLog;

pub const MIB: u64 = 1024 * 1024;
/// The limit of a file sync.
pub const FILE_SYNC_LIMIT: u64 = 32 * MIB;
/// The limit of a file of a folder sync.
pub const FOLDER_FILE_LIMIT: u64 = 2 * MIB;

/// What a read of a synced file gives the catalog.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FileRead {
    /// The valid contexts, in file order, each name once.
    Contexts(Vec<String>),
    /// Too large, not text, not loadable, or loaded with schema errors and no
    /// valid context: the file gives no cluster.
    Invalid,
    /// The file could not be read: its clusters stay as they were.
    Failed,
}

impl FileRead {
    /// The contexts the file gives, `None` when it keeps the ones it had.
    pub fn contexts(&self) -> Option<Vec<String>> {
        match self {
            Self::Contexts(contexts) => Some(contexts.clone()),
            Self::Invalid => Some(Vec::new()),
            Self::Failed => None,
        }
    }
}

/// One context of the split, valid or not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SplitContext {
    pub name: String,
    /// `Error: No valid … object provided in kubeconfig for context '<name>'`.
    pub error: Option<String>,
}

/// What the loader gives for text it does not throw on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Loaded {
    /// Every context of the split, in file order.
    pub contexts: Vec<SplitContext>,
    /// The Joi messages joined by `. `, without the values.
    pub schema_error: Option<String>,
}

impl Loaded {
    /// The valid contexts, each name once, at its first place, as the model
    /// map of `computeKubeconfigDiff` keeps them.
    pub fn valid_names(&self) -> Vec<String> {
        let mut names: Vec<String> = Vec::new();
        for context in &self.contexts {
            if context.error.is_none() && !names.contains(&context.name) {
                names.push(context.name.clone());
            }
        }
        names
    }
}

/// Reads a synced file in the order of the contract, the first step that
/// fails deciding, and logs as the Electron build logs.
pub fn read_synced_file(path: &Path, limit: u64, log: &CatalogLog) -> FileRead {
    let shown = path.display();
    match std::fs::metadata(path) {
        Ok(meta) if meta.len() >= limit => {
            log.warn(&format!(
                "skipping {shown}: size={} is larger than maxSize={}",
                bytes_to_units(meta.len()),
                bytes_to_units(limit)
            ));
            return FileRead::Invalid;
        }
        Ok(_) => {}
        Err(error) => {
            log.warn(&format!("failed to read file: {error} ({shown})"));
            return FileRead::Failed;
        }
    }
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => {
            log.warn(&format!("failed to read file: {error} ({shown})"));
            return FileRead::Failed;
        }
    };
    let text = match decode(&bytes) {
        Ok(text) => text,
        Err(error) => {
            log.warn(&format!("skipping {shown}: {error}"));
            return FileRead::Invalid;
        }
    };
    match load(&text) {
        Ok(loaded) => {
            if let Some(error) = &loaded.schema_error {
                log.warn(&format!(
                    "encountered errors while loading config: {error} ({shown})"
                ));
            }
            for context in &loaded.contexts {
                if let Some(error) = &context.error {
                    log.debug(&format!(
                        "context failed validation: {error} ({}, {shown})",
                        context.name
                    ));
                }
            }
            let names = loaded.valid_names();
            if names.is_empty() && loaded.schema_error.is_some() {
                FileRead::Invalid
            } else {
                FileRead::Contexts(names)
            }
        }
        Err(error) => {
            log.warn(&format!("Failed to compute diff: Error: {error} ({shown})"));
            FileRead::Invalid
        }
    }
}

/// `bytesToUnits` of `@freelensapp/utilities`, with one decimal.
pub fn bytes_to_units(bytes: u64) -> String {
    const UNITS: [&str; 7] = ["B", "KiB", "MiB", "GiB", "TiB", "PiB", "EiB"];
    if bytes == 0 {
        return "N/A".to_string();
    }
    let index = ((bytes as f64).ln() / 1024f64.ln()).floor() as usize;
    let index = index.min(UNITS.len() - 1);
    let magnitude = 1024f64.powi(index as i32);
    format!("{:.1}{}", bytes as f64 / magnitude, UNITS[index])
}

/// The encoding of `getKubeconfigEncoding`, decoded as `TextDecoder` with
/// `fatal: true` decodes it, the byte order mark dropped.
pub fn decode(bytes: &[u8]) -> Result<String, String> {
    match bytes {
        [0xff, 0xfe, ..] => decode_utf16(bytes, u16::from_le_bytes, "utf-16le"),
        [0xfe, 0xff, ..] => decode_utf16(bytes, u16::from_be_bytes, "utf-16be"),
        _ => {
            let text = std::str::from_utf8(bytes).map_err(|_| invalid_encoding("utf-8"))?;
            Ok(text.strip_prefix('\u{feff}').unwrap_or(text).to_string())
        }
    }
}

fn decode_utf16(bytes: &[u8], unit: fn([u8; 2]) -> u16, name: &str) -> Result<String, String> {
    let (pairs, rest) = bytes.as_chunks::<2>();
    if !rest.is_empty() {
        return Err(invalid_encoding(name));
    }
    let text: String = char::decode_utf16(pairs.iter().map(|pair| unit(*pair)))
        .collect::<Result<_, _>>()
        .map_err(|_| invalid_encoding(name))?;
    Ok(text.strip_prefix('\u{feff}').unwrap_or(&text).to_string())
}

fn invalid_encoding(name: &str) -> String {
    format!("TypeError: The encoded data was not valid for encoding {name}")
}

/// `loadConfigFromString` then `splitConfig`: an `Err` is the message of what
/// the Electron build's loader throws.
pub fn load(text: &str) -> Result<Loaded, String> {
    let document = parse_yaml(text)?;
    let (value, messages) = validate(document.as_ref());
    let schema_error = (!messages.is_empty()).then(|| messages.join(". "));
    let config = build_config(&value)?;
    Ok(Loaded {
        contexts: split(&config),
        schema_error,
    })
}

/// The answer of `parse-kubeconfig-text`: `checkKubeconfigText` of
/// `features/add-cluster/main/check.ts`.
pub fn check_text(text: &str) -> Value {
    let trimmed = text.trim();
    let source = if trimmed.is_empty() { "{}" } else { trimmed };
    let mut answer = Map::new();
    match load(source) {
        Err(error) => {
            answer.insert("contexts".into(), Value::Array(Vec::new()));
            answer.insert("error".into(), Value::String(format!("Error: {error}")));
        }
        Ok(loaded) => {
            let contexts = loaded
                .contexts
                .iter()
                .map(|context| {
                    let mut entry = Map::new();
                    entry.insert("name".into(), Value::String(context.name.clone()));
                    if let Some(error) = &context.error {
                        entry.insert("error".into(), Value::String(error.clone()));
                    }
                    Value::Object(entry)
                })
                .collect();
            answer.insert("contexts".into(), Value::Array(contexts));
            if let Some(error) = loaded.schema_error {
                answer.insert(
                    "error".into(),
                    Value::String(format!("ValidationError: {error}")),
                );
            }
        }
    }
    Value::Object(answer)
}

/// js-yaml 5.5.0's `load` of the default schema: blank text, or text of comments
/// alone, is no document; a parse error is `invalid YAML: <reason> at line
/// <n>`, whose reason is the core's own and never quotes the text.
pub fn parse_yaml(text: &str) -> Result<Option<Value>, String> {
    if text.trim().is_empty() || is_only_comments(text) {
        return Ok(None);
    }
    let mut budget = serde_saphyr::Budget::default();
    // The Electron build reads files up to 32 MiB without a node limit.
    budget.max_nodes = 64_000_000;
    budget.max_events = 256_000_000;
    let mut options = serde_saphyr::Options::default();
    options.budget = Some(budget);
    options.strict_booleans = true;
    options.with_snippet = false;
    options.duplicate_keys = serde_saphyr::DuplicateKeyPolicy::Error;
    // js-yaml 5's default schema keeps `<<` as an ordinary key.
    options.merge_keys = serde_saphyr::MergeKeyPolicy::AsOrdinary;
    serde_saphyr::from_str_with_options::<Value>(text, options)
        .map(Some)
        .map_err(|error| yaml_error(&error))
}

fn is_only_comments(text: &str) -> bool {
    text.lines().all(|line| {
        let line = line.trim_start();
        line.is_empty() || line.starts_with('#')
    })
}

fn yaml_error(error: &serde_saphyr::Error) -> String {
    use serde_saphyr::Error as E;
    let reason = match error {
        E::Eof { .. } => "unexpected end of the stream",
        E::MultipleDocuments { .. } => "expected a single document in the stream, but found more",
        E::DuplicateMappingKey { .. } => "duplicated mapping key",
        E::UnknownAnchor { .. } => "unidentified alias",
        E::MergeValueNotMapOrSeqOfMaps { .. } => {
            "cannot merge mappings; the provided source object is unacceptable"
        }
        E::Budget { .. } => "the document is too large",
        _ => "the text is not valid YAML",
    };
    match error.location() {
        Some(location) => format!("invalid YAML: {reason} at line {}", location.line()),
        None => format!("invalid YAML: {reason}"),
    }
}

/// The Joi schema of `kube-helpers.ts`, every unknown key allowed: returns the
/// value with the failed entries of `users`, `clusters` and `contexts`
/// dropped (`stripUnknown: { arrays: true }`), and the messages in Joi's
/// order (`abortEarly: false`).
fn validate(document: Option<&Value>) -> (Value, Vec<String>) {
    let mut messages = Vec::new();
    let Some(document) = document else {
        messages.push("\"value\" is required".to_string());
        return (Value::Object(Map::new()), messages);
    };
    let Value::Object(root) = document else {
        messages.push("\"value\" must be of type object".to_string());
        return (Value::Object(Map::new()), messages);
    };
    let mut value = root.clone();
    for (key, item) in [
        ("users", user_errors as ItemRule),
        ("clusters", cluster_errors as ItemRule),
        ("contexts", context_errors as ItemRule),
    ] {
        match root.get(key) {
            None => {}
            Some(Value::Array(items)) => {
                let mut kept = Vec::new();
                for (index, entry) in items.iter().enumerate() {
                    let errors = item(entry, &format!("{key}[{index}]"));
                    if errors.is_empty() {
                        kept.push(entry.clone());
                    }
                    messages.extend(errors);
                }
                value.insert(key.to_string(), Value::Array(kept));
            }
            Some(_) => messages.push(format!("\"{key}\" must be an array")),
        }
    }
    (Value::Object(value), messages)
}

type ItemRule = fn(&Value, &str) -> Vec<String>;

fn user_errors(entry: &Value, label: &str) -> Vec<String> {
    let Value::Object(user) = entry else {
        return vec![format!("\"{label}\" must be of type object")];
    };
    required_string(user.get("name"), &format!("{label}.name"))
        .into_iter()
        .collect()
}

fn cluster_errors(entry: &Value, label: &str) -> Vec<String> {
    let Value::Object(cluster) = entry else {
        return vec![format!("\"{label}\" must be of type object")];
    };
    let mut errors: Vec<String> = required_string(cluster.get("name"), &format!("{label}.name"))
        .into_iter()
        .collect();
    let inner = format!("{label}.cluster");
    match cluster.get("cluster") {
        None => errors.push(format!("\"{inner}\" is required")),
        Some(Value::Object(fields)) => {
            errors.extend(required_string(
                fields.get("server"),
                &format!("{inner}.server"),
            ));
        }
        Some(_) => errors.push(format!("\"{inner}\" must be of type object")),
    }
    errors
}

fn context_errors(entry: &Value, label: &str) -> Vec<String> {
    let Value::Object(context) = entry else {
        return vec![format!("\"{label}\" must be of type object")];
    };
    let mut errors: Vec<String> = required_string(context.get("name"), &format!("{label}.name"))
        .into_iter()
        .collect();
    let inner = format!("{label}.context");
    match context.get("context") {
        None => {}
        Some(Value::Object(fields)) => {
            errors.extend(required_string(
                fields.get("cluster"),
                &format!("{inner}.cluster"),
            ));
            errors.extend(required_string(
                fields.get("user"),
                &format!("{inner}.user"),
            ));
        }
        Some(_) => errors.push(format!("\"{inner}\" must be of type object")),
    }
    errors
}

/// `Joi.string().min(1).required()`.
fn required_string(value: Option<&Value>, label: &str) -> Option<String> {
    match value {
        None => Some(format!("\"{label}\" is required")),
        Some(Value::String(text)) if text.is_empty() => {
            Some(format!("\"{label}\" is not allowed to be empty"))
        }
        Some(Value::String(_)) => None,
        Some(_) => Some(format!("\"{label}\" must be a string")),
    }
}

/// What `loadFromOptions` keeps of the validated value.
struct Config {
    clusters: Vec<String>,
    users: Vec<String>,
    /// `(name, cluster, user)`.
    contexts: Vec<(String, String, Option<String>)>,
}

/// client-node's `newClusters`, `newUsers` and `newContexts`, which throw on
/// an entry the Joi schema let through without what they need.
fn build_config(value: &Value) -> Result<Config, String> {
    let array = |key: &str| match value.get(key) {
        Some(Value::Array(items)) => items.as_slice(),
        _ => &[],
    };
    let name = |entry: &Value| {
        entry
            .get("name")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string()
    };
    let clusters = array("clusters").iter().map(name).collect();
    let users = array("users").iter().map(name).collect();
    let mut contexts = Vec::new();
    for (index, entry) in array("contexts").iter().enumerate() {
        let Some(context) = entry.get("context").filter(|context| truthy(context)) else {
            return Err(format!("contexts[{index}].context is missing"));
        };
        let cluster = context
            .get("cluster")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let user = context
            .get("user")
            .and_then(Value::as_str)
            .filter(|user| !user.is_empty())
            .map(str::to_string);
        contexts.push((name(entry), cluster, user));
    }
    Ok(Config {
        clusters,
        users,
        contexts,
    })
}

fn truthy(value: &Value) -> bool {
    !matches!(value, Value::Null | Value::Bool(false))
        && value.as_str() != Some("")
        && value.as_f64() != Some(0.0)
}

/// `splitConfig` and `validateKubeConfig`: each context in file order, built
/// from its own cluster and user and validated against the first context of
/// its name, as `getContextObject` finds it.
fn split(config: &Config) -> Vec<SplitContext> {
    config
        .contexts
        .iter()
        .map(|(name, cluster, user)| {
            let first = config
                .contexts
                .iter()
                .find(|(other, _, _)| other == name)
                .expect("the context itself");
            let has_cluster = config.clusters.contains(cluster) && first.1 == *cluster;
            let has_user = user
                .as_ref()
                .is_some_and(|user| config.users.contains(user) && first.2.as_ref() == Some(user));
            let missing = if !has_cluster {
                Some("cluster")
            } else if !has_user {
                Some("user")
            } else {
                None
            };
            SplitContext {
                name: name.clone(),
                error: missing.map(|object| {
                    format!(
                        "Error: No valid {object} object provided in kubeconfig for context '{name}'"
                    )
                }),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use std::sync::{Arc, Mutex};

    use super::*;
    use crate::catalog::CatalogLog;
    use serde_json::json;

    const TOKEN: &str = "placeholder-token-1f2e3d";
    const SERVER: &str = "https://cluster-a.example.invalid:6443";

    fn kubeconfig() -> String {
        format!(
            "apiVersion: v1\nkind: Config\nclusters:\n- name: cluster-a\n  cluster:\n    server: {SERVER}\nusers:\n- name: user-a\n  user:\n    token: {TOKEN}\ncontexts:\n- name: context-a\n  context:\n    cluster: cluster-a\n    user: user-a\ncurrent-context: context-a\n"
        )
    }

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "freelens-kubeconfig-test-{}-{}",
                std::process::id(),
                uuid::Uuid::new_v4()
            ));
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn recording() -> (CatalogLog, Arc<Mutex<Vec<String>>>) {
        let lines = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&lines);
        let log = CatalogLog::new(
            Arc::new(move |line: &str| sink.lock().unwrap().push(line.to_string())),
            true,
        );
        (log, lines)
    }

    fn read_bytes(bytes: &[u8], limit: u64) -> (FileRead, Vec<String>) {
        let dir = TempDir::new();
        let path = dir.0.join("config");
        std::fs::write(&path, bytes).unwrap();
        let (log, lines) = recording();
        let read = read_synced_file(&path, limit, &log);
        let lines = lines.lock().unwrap().clone();
        (read, lines)
    }

    fn names(text: &str) -> Vec<String> {
        load(text).unwrap().valid_names()
    }

    fn utf16le(text: &str) -> Vec<u8> {
        let mut bytes = vec![0xff, 0xfe];
        for unit in text.encode_utf16() {
            bytes.extend(unit.to_le_bytes());
        }
        bytes
    }

    fn utf16be(text: &str) -> Vec<u8> {
        let mut bytes = vec![0xfe, 0xff];
        for unit in text.encode_utf16() {
            bytes.extend(unit.to_be_bytes());
        }
        bytes
    }

    #[test]
    fn reads_the_valid_contexts_of_a_file() {
        let (read, lines) = read_bytes(kubeconfig().as_bytes(), FOLDER_FILE_LIMIT);
        assert_eq!(read, FileRead::Contexts(vec!["context-a".into()]));
        assert!(lines.is_empty(), "{lines:?}");
    }

    #[test]
    fn skips_a_file_at_the_size_limit_and_reads_one_just_under() {
        let mut at_limit = kubeconfig().into_bytes();
        at_limit.resize(FOLDER_FILE_LIMIT as usize, b'\n');
        let (read, lines) = read_bytes(&at_limit, FOLDER_FILE_LIMIT);
        assert_eq!(read, FileRead::Invalid);
        assert!(
            lines[0].contains("size=2.0MiB is larger than maxSize=2.0MiB"),
            "{lines:?}"
        );
        assert!(lines[0].starts_with("warn: "), "{lines:?}");

        let mut under = kubeconfig().into_bytes();
        under.resize(FOLDER_FILE_LIMIT as usize - 1, b'\n');
        let (read, _) = read_bytes(&under, FOLDER_FILE_LIMIT);
        assert_eq!(read, FileRead::Contexts(vec!["context-a".into()]));
    }

    #[test]
    fn the_file_sync_limit_is_32_mib() {
        assert_eq!(FILE_SYNC_LIMIT, 32 * 1024 * 1024);
        assert_eq!(bytes_to_units(FILE_SYNC_LIMIT), "32.0MiB");
        let mut under = kubeconfig().into_bytes();
        under.resize(FILE_SYNC_LIMIT as usize - 1, b'\n');
        let (read, _) = read_bytes(&under, FILE_SYNC_LIMIT);
        assert_eq!(read, FileRead::Contexts(vec!["context-a".into()]));
    }

    #[test]
    fn reads_utf8_with_and_without_a_byte_order_mark_and_crlf() {
        let text = kubeconfig();
        assert_eq!(decode(text.as_bytes()).unwrap(), text);
        let bom = format!("\u{feff}{text}");
        assert_eq!(decode(bom.as_bytes()).unwrap(), text);
        let crlf = text.replace('\n', "\r\n");
        assert_eq!(decode(crlf.as_bytes()).unwrap(), crlf);
        assert_eq!(names(&crlf), ["context-a"]);
    }

    #[test]
    fn reads_utf16_le_and_be_by_their_byte_order_mark() {
        let text = kubeconfig();
        assert_eq!(decode(&utf16le(&text)).unwrap(), text);
        assert_eq!(decode(&utf16be(&text)).unwrap(), text);
        let crlf = text.replace('\n', "\r\n");
        assert_eq!(decode(&utf16le(&crlf)).unwrap(), crlf);
        let (read, _) = read_bytes(&utf16be(&text), FOLDER_FILE_LIMIT);
        assert_eq!(read, FileRead::Contexts(vec!["context-a".into()]));
    }

    #[test]
    fn skips_text_that_is_not_valid_or_ends_inside_a_character() {
        assert!(decode(&[0x61, 0xc3, 0x28]).is_err());
        let mut utf8 = kubeconfig().into_bytes();
        utf8.push(0xc3);
        assert!(decode(&utf8).is_err());
        let mut utf16 = utf16le(&kubeconfig());
        utf16.push(0x61);
        assert!(decode(&utf16).is_err());
        let (read, lines) = read_bytes(&utf8, FOLDER_FILE_LIMIT);
        assert_eq!(read, FileRead::Invalid);
        assert!(
            lines[0].contains("not valid for encoding utf-8"),
            "{lines:?}"
        );
    }

    #[test]
    fn a_file_that_cannot_be_read_keeps_its_clusters() {
        let (log, lines) = recording();
        assert_eq!(
            read_synced_file(Path::new("/no/such/kubeconfig"), FOLDER_FILE_LIMIT, &log),
            FileRead::Failed
        );
        assert!(lines.lock().unwrap()[0].starts_with("warn: Catalog: failed to read file"));
    }

    #[test]
    fn blank_text_and_comments_are_no_document() {
        assert_eq!(
            load("").unwrap(),
            Loaded {
                contexts: Vec::new(),
                schema_error: Some("\"value\" is required".into()),
            }
        );
        assert_eq!(
            load("# only a comment\n").unwrap().schema_error.as_deref(),
            Some("\"value\" is required")
        );
        assert_eq!(
            load("just text").unwrap().schema_error.as_deref(),
            Some("\"value\" must be of type object")
        );
    }

    #[test]
    fn duplicate_keys_are_refused_and_merge_keys_kept_as_keys() {
        let duplicate = "clusters: []\nclusters: []\n";
        assert_eq!(
            load(duplicate).unwrap_err(),
            "invalid YAML: duplicated mapping key at line 2"
        );
        let merged = "base: &base\n  cluster: cluster-a\n  user: user-a\nclusters:\n- name: cluster-a\n  cluster:\n    server: https://s.example.invalid\nusers:\n- name: user-a\ncontexts:\n- name: merged\n  context:\n    <<: *base\n";
        let loaded = load(merged).unwrap();
        assert!(loaded.valid_names().is_empty());
        assert_eq!(
            loaded.schema_error.as_deref(),
            Some(
                "\"contexts[0].context.cluster\" is required. \"contexts[0].context.user\" is required"
            )
        );
    }

    #[test]
    fn yes_is_a_string_and_true_is_not() {
        let yes = kubeconfig().replace("name: context-a", "name: yes");
        assert_eq!(names(&yes), ["yes"]);
        let truth = kubeconfig().replace("name: context-a", "name: true");
        assert!(names(&truth).is_empty());
        assert_eq!(
            load(&truth).unwrap().schema_error.as_deref(),
            Some("\"contexts[0].name\" must be a string")
        );
    }

    #[test]
    fn every_rule_of_the_schema_has_joi_s_message_and_drops_the_entry() {
        let text = "users:\n- name: ''\n- 7\n- name: user-a\nclusters:\n- name: c\n- name: d\n  cluster: x\n- cluster:\n    server: ''\n- name: cluster-a\n  cluster:\n    server: https://s.example.invalid\ncontexts:\n- name: 5\n- name: bad\n  context:\n    cluster: cluster-a\n- name: context-a\n  context:\n    cluster: cluster-a\n    user: user-a\n";
        let loaded = load(text).unwrap();
        assert_eq!(
            loaded.schema_error.as_deref(),
            Some(
                "\"users[0].name\" is not allowed to be empty. \"users[1]\" must be of type object. \"clusters[0].cluster\" is required. \"clusters[1].cluster\" must be of type object. \"clusters[2].name\" is required. \"clusters[2].cluster.server\" is not allowed to be empty. \"contexts[0].name\" must be a string. \"contexts[1].context.user\" is required"
            )
        );
        assert_eq!(loaded.valid_names(), ["context-a"]);
        assert_eq!(
            load("users: {}\nclusters: x\ncontexts: ~\n")
                .unwrap()
                .schema_error
                .as_deref(),
            Some(
                "\"users\" must be an array. \"clusters\" must be an array. \"contexts\" must be an array"
            )
        );
    }

    #[test]
    fn a_context_without_context_throws_with_its_index_after_the_drops() {
        let text = "contexts:\n- name: 5\n- name: lonely\n";
        assert_eq!(load(text).unwrap_err(), "contexts[0].context is missing");
        assert_eq!(
            check_text(text),
            json!({ "contexts": [], "error": "Error: contexts[0].context is missing" })
        );
    }

    #[test]
    fn split_and_validation_name_the_missing_object() {
        let text = kubeconfig()
            + "- name: no-cluster\n  context:\n    cluster: nowhere\n    user: user-a\n- name: no-user\n  context:\n    cluster: cluster-a\n    user: nobody\n";
        let text =
            text.replace("current-context: context-a\n", "") + "current-context: context-a\n";
        let loaded = load(&text).unwrap();
        let errors: Vec<Option<&str>> = loaded
            .contexts
            .iter()
            .map(|context| context.error.as_deref())
            .collect();
        assert_eq!(
            errors,
            [
                None,
                Some(
                    "Error: No valid cluster object provided in kubeconfig for context 'no-cluster'"
                ),
                Some("Error: No valid user object provided in kubeconfig for context 'no-user'"),
            ]
        );
        assert_eq!(loaded.valid_names(), ["context-a"]);
    }

    #[test]
    fn a_duplicate_context_name_gives_one_context_validated_against_the_first() {
        let text = kubeconfig().replace("current-context: context-a\n", "")
            + "- name: context-a\n  context:\n    cluster: cluster-a\n    user: user-a\n- name: twin\n  context:\n    cluster: nowhere\n    user: user-a\n- name: twin\n  context:\n    cluster: cluster-a\n    user: user-a\n";
        let loaded = load(&text).unwrap();
        assert_eq!(loaded.contexts.len(), 4);
        assert_eq!(loaded.valid_names(), ["context-a"]);
        assert!(loaded.contexts[3].error.is_some());
    }

    #[test]
    fn parse_answers_names_and_errors_and_no_credential() {
        let answer = check_text(
            &(kubeconfig().replace("current-context: context-a\n", "")
                + "- name: no-cluster\n  context:\n    cluster: nowhere\n    user: user-a\n"),
        );
        assert_eq!(
            answer,
            json!({
                "contexts": [
                    { "name": "context-a" },
                    { "name": "no-cluster", "error": "Error: No valid cluster object provided in kubeconfig for context 'no-cluster'" },
                ],
            })
        );
        let text = answer.to_string();
        assert!(!text.contains(TOKEN) && !text.contains(SERVER));
        assert_eq!(check_text("   "), json!({ "contexts": [] }));
    }

    #[test]
    fn no_error_quotes_the_text() {
        let texts = [
            format!("token: {TOKEN}\n  bad: [indent\n"),
            format!("a: {TOKEN}\na: {SERVER}\n"),
            format!("clusters:\n- name: {TOKEN}\n  cluster:\n    server: ''\n"),
            format!("contexts:\n- name: {TOKEN}\n"),
            format!("x: *{TOKEN}\n"),
            format!("--- {TOKEN}\n--- {SERVER}\n"),
        ];
        for text in texts {
            let (_, lines) = read_bytes(text.as_bytes(), FOLDER_FILE_LIMIT);
            let answer = check_text(&text).to_string();
            for output in lines.iter().chain([&answer]) {
                assert!(!output.contains(TOKEN), "{output}");
                assert!(!output.contains(SERVER), "{output}");
            }
        }
    }

    #[test]
    fn an_invalid_document_throws_invalid_yaml_with_its_line() {
        let error = load("a: b\n  c: [d\n").unwrap_err();
        assert!(error.starts_with("invalid YAML: "), "{error}");
        assert!(error.contains(" at line "), "{error}");
    }
}
