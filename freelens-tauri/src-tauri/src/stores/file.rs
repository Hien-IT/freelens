/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Reading and writing one store file the way `conf` 16 does
//! (`specs/007-main-foundation/contracts/store-format.md`, research R1 and R2).

use std::fs;
use std::io::{self, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Map, Value};

use super::js_json::{remove_key, to_js_string};

/// The `projectVersion` every store of the Electron build passes to `conf`.
pub const STORE_VERSION: &str = "0.1.0";

const INTERNAL_KEY: &str = "__internal__";

/// Why a store file could not be used.
#[derive(Debug)]
pub enum LoadError {
    /// Not JSON for JavaScript either: the Electron build copies it aside and
    /// starts over.
    Invalid(String),
    /// JSON that JavaScript reads and `serde_json` does not, such as an
    /// unpaired surrogate escape; the core must not overwrite it.
    ReadableByJavaScriptOnly(String),
    /// The file exists and could not be read.
    Unreadable(io::Error),
}

/// One store file: its whole content, `__internal__` and unknown keys included.
#[derive(Debug, Clone)]
pub struct StoreFile {
    path: PathBuf,
    content: Map<String, Value>,
}

impl StoreFile {
    /// Reads the file; a missing file is an empty one, and JSON that is not an
    /// object reads as an empty object, as `conf` reads them.
    pub fn read(path: &Path) -> Result<Self, LoadError> {
        let content = match fs::read(path) {
            Ok(bytes) => parse(&String::from_utf8_lossy(&bytes))?,
            Err(error) if error.kind() == io::ErrorKind::NotFound => Map::new(),
            Err(error) => return Err(LoadError::Unreadable(error)),
        };
        Ok(Self {
            path: path.to_path_buf(),
            content,
        })
    }

    /// A file with only the version, for a store started over.
    pub fn empty(path: &Path) -> Self {
        Self {
            path: path.to_path_buf(),
            content: Map::new(),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The whole file.
    pub fn content(&self) -> &Map<String, Value> {
        &self.content
    }

    /// The file without `__internal__`, which is what `fromStore` gets.
    pub fn data(&self) -> Map<String, Value> {
        let mut data = self.content.clone();
        remove_key(&mut data, INTERNAL_KEY);
        data
    }

    /// Records `STORE_VERSION` when the file has no version, a range, or a lower
    /// one; never lowers it. Returns whether the content changed.
    pub fn raise_version(&mut self) -> bool {
        let recorded = self
            .content
            .get(INTERNAL_KEY)
            .and_then(|internal| internal.get("migrations"))
            .and_then(|migrations| migrations.get("version"));
        if !moves_forward(recorded) {
            return false;
        }
        let internal = object_at(&mut self.content, INTERNAL_KEY);
        let migrations = object_at(internal, "migrations");
        migrations.insert("version".into(), Value::String(STORE_VERSION.into()));
        true
    }

    /// Sets each of `keys` the model has and removes each it lacks, keeping
    /// every other key of the file, as `persistStateToConfig` does key by key.
    pub fn merge(&mut self, keys: &[&str], model: &Map<String, Value>) {
        for key in keys {
            match model.get(*key) {
                Some(value) => {
                    self.content.insert((*key).to_string(), value.clone());
                }
                None => {
                    remove_key(&mut self.content, key);
                }
            }
        }
    }

    /// Replaces the whole file at once: a temporary file in the same directory,
    /// synced, given the mode of the file it replaces, then renamed over it.
    pub fn write(&self) -> io::Result<()> {
        let text = to_js_string(&Value::Object(self.content.clone()));
        write_atomically(&self.path, text.as_bytes())
    }
}

/// Writes `bytes` to `path` so that the file is the old one or the new one,
/// never a part of either, as `atomically` does for `conf`.
pub fn write_atomically(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let temporary = temporary_path(path);
    let result = (|| {
        let mut file = fs::File::create(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        if let Ok(existing) = fs::metadata(path) {
            file.set_permissions(fs::Permissions::from_mode(
                existing.permissions().mode() & 0o7777,
            ))?;
        }
        drop(file);
        fs::rename(&temporary, path)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result
}

/// `<file>.tmp-<the last 10 digits of the time in ms><6 hex digits>`.
fn temporary_path(path: &Path) -> PathBuf {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_millis())
        .unwrap_or_default();
    let random = uuid::Uuid::new_v4().simple().to_string();
    let mut name = path.as_os_str().to_os_string();
    name.push(format!(
        ".tmp-{:010}{}",
        millis % 10_000_000_000,
        &random[..6]
    ));
    PathBuf::from(name)
}

fn object_at<'a>(map: &'a mut Map<String, Value>, key: &str) -> &'a mut Map<String, Value> {
    let entry = map
        .entry(key.to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    if !entry.is_object() {
        *entry = Value::Object(Map::new());
    }
    entry.as_object_mut().expect("just made an object")
}

fn parse(text: &str) -> Result<Map<String, Value>, LoadError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    match serde_json::from_str::<Value>(text) {
        Ok(Value::Object(map)) => Ok(map),
        Ok(_) => Ok(Map::new()),
        Err(error) if is_json_for_javascript(text) => {
            Err(LoadError::ReadableByJavaScriptOnly(error.to_string()))
        }
        Err(error) => Err(LoadError::Invalid(error.to_string())),
    }
}

/// `movesForward` of `conf`: no version, a range or something that is not a
/// version, or a version lower than `STORE_VERSION`.
fn moves_forward(recorded: Option<&Value>) -> bool {
    let Some(Value::String(recorded)) = recorded else {
        return true;
    };
    match (Version::parse(recorded), Version::parse(STORE_VERSION)) {
        (Some(recorded), Some(current)) => current > recorded,
        _ => true,
    }
}

/// A semantic version without build metadata, ordered as `semver` orders it.
#[derive(Debug, PartialEq, Eq)]
struct Version {
    core: (u64, u64, u64),
    pre: Vec<String>,
}

impl Version {
    /// What `semver.clean` accepts: a full version, with an optional leading
    /// `v` or `=` and surrounding spaces.
    fn parse(text: &str) -> Option<Self> {
        let text = text.trim().trim_start_matches(['v', '=']);
        let text = text.split_once('+').map_or(text, |(version, _)| version);
        let (core, pre) = match text.split_once('-') {
            Some((core, pre)) => (core, pre.split('.').map(str::to_string).collect()),
            None => (text, Vec::new()),
        };
        let mut numbers = core.split('.').map(|part| {
            let leading_zero = part.len() > 1 && part.starts_with('0');
            (!leading_zero).then(|| part.parse::<u64>().ok()).flatten()
        });
        let version = Self {
            core: (numbers.next()??, numbers.next()??, numbers.next()??),
            pre,
        };
        (numbers.next().is_none() && version.pre.iter().all(|id| !id.is_empty())).then_some(version)
    }
}

impl PartialOrd for Version {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

impl Ord for Version {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        use std::cmp::Ordering;
        self.core
            .cmp(&other.core)
            .then_with(|| match (self.pre.is_empty(), other.pre.is_empty()) {
                (true, true) => Ordering::Equal,
                (true, false) => Ordering::Greater,
                (false, true) => Ordering::Less,
                (false, false) => {
                    for (left, right) in self.pre.iter().zip(&other.pre) {
                        let order = match (left.parse::<u64>(), right.parse::<u64>()) {
                            (Ok(left), Ok(right)) => left.cmp(&right),
                            (Ok(_), Err(_)) => Ordering::Less,
                            (Err(_), Ok(_)) => Ordering::Greater,
                            (Err(_), Err(_)) => left.cmp(right),
                        };
                        if order != Ordering::Equal {
                            return order;
                        }
                    }
                    self.pre.len().cmp(&other.pre.len())
                }
            })
    }
}

/// Whether `JSON.parse` accepts `text`: the grammar of JSON, with any number
/// and any escape, unpaired surrogates included, and no depth limit beyond the
/// stack's.
fn is_json_for_javascript(text: &str) -> bool {
    let bytes = text.as_bytes();
    let mut position = skip_space(bytes, 0);
    match value_end(bytes, position) {
        Some(end) => {
            position = skip_space(bytes, end);
            position == bytes.len()
        }
        None => false,
    }
}

fn skip_space(bytes: &[u8], mut position: usize) -> usize {
    while matches!(bytes.get(position), Some(b' ' | b'\t' | b'\n' | b'\r')) {
        position += 1;
    }
    position
}

fn value_end(bytes: &[u8], position: usize) -> Option<usize> {
    match bytes.get(position)? {
        b'{' => container_end(bytes, position, b'}', true),
        b'[' => container_end(bytes, position, b']', false),
        b'"' => string_end(bytes, position),
        b't' => literal_end(bytes, position, b"true"),
        b'f' => literal_end(bytes, position, b"false"),
        b'n' => literal_end(bytes, position, b"null"),
        _ => number_end(bytes, position),
    }
}

fn container_end(bytes: &[u8], start: usize, close: u8, keyed: bool) -> Option<usize> {
    let mut position = skip_space(bytes, start + 1);
    if bytes.get(position) == Some(&close) {
        return Some(position + 1);
    }
    loop {
        if keyed {
            if bytes.get(position) != Some(&b'"') {
                return None;
            }
            position = skip_space(bytes, string_end(bytes, position)?);
            if bytes.get(position) != Some(&b':') {
                return None;
            }
            position = skip_space(bytes, position + 1);
        }
        position = skip_space(bytes, value_end(bytes, position)?);
        match bytes.get(position)? {
            b',' => position = skip_space(bytes, position + 1),
            byte if *byte == close => return Some(position + 1),
            _ => return None,
        }
    }
}

fn string_end(bytes: &[u8], start: usize) -> Option<usize> {
    let mut position = start + 1;
    loop {
        match *bytes.get(position)? {
            b'"' => return Some(position + 1),
            b'\\' => match *bytes.get(position + 1)? {
                b'"' | b'\\' | b'/' | b'b' | b'f' | b'n' | b'r' | b't' => position += 2,
                b'u' => {
                    let hex = bytes.get(position + 2..position + 6)?;
                    if !hex.iter().all(u8::is_ascii_hexdigit) {
                        return None;
                    }
                    position += 6;
                }
                _ => return None,
            },
            byte if byte < 0x20 => return None,
            _ => position += 1,
        }
    }
}

fn literal_end(bytes: &[u8], start: usize, literal: &[u8]) -> Option<usize> {
    bytes[start..]
        .starts_with(literal)
        .then_some(start + literal.len())
}

fn number_end(bytes: &[u8], start: usize) -> Option<usize> {
    let digits = |mut position: usize| {
        let first = position;
        while bytes.get(position).is_some_and(u8::is_ascii_digit) {
            position += 1;
        }
        (position > first).then_some(position)
    };
    let mut position = start;
    if bytes.get(position) == Some(&b'-') {
        position += 1;
    }
    position = match bytes.get(position)? {
        b'0' => position + 1,
        b'1'..=b'9' => digits(position)?,
        _ => return None,
    };
    if bytes.get(position) == Some(&b'.') {
        position = digits(position + 1)?;
    }
    if matches!(bytes.get(position), Some(b'e' | b'E')) {
        position += 1;
        if matches!(bytes.get(position), Some(b'+' | b'-')) {
            position += 1;
        }
        position = digits(position)?;
    }
    Some(position)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_reads_what_serde_json_refuses() {
        assert!(is_json_for_javascript(r#"{"a": "\ud800", "b": 1e400}"#));
        assert!(is_json_for_javascript(
            " [1, -0.5e+3, true, null, {\"x\": []}] "
        ));
        for invalid in ["", "{", "{\"a\" 1}", "[1,]", "01", "\"\t\"", "{} x", "tru"] {
            assert!(!is_json_for_javascript(invalid), "for {invalid:?}");
        }
    }

    #[test]
    fn versions_are_ordered_as_semver_orders_them() {
        let version = |text| Version::parse(text).unwrap();
        assert!(version("0.1.0") > version("0.1.0-beta.1"));
        assert!(version("0.1.0-beta.2") > version("0.1.0-beta.1"));
        assert!(version("0.1.0-beta") > version("0.1.0-1"));
        assert!(version("1.0.0") > version("0.10.0"));
        assert_eq!(version(" v0.2.0 "), version("0.2.0"));
        assert_eq!(version("0.2.0+build.5"), version("0.2.0"));
        for invalid in ["0.1", "0.x", "01.0.0", "a.b.c", "0.1.0-"] {
            assert!(Version::parse(invalid).is_none(), "for {invalid}");
        }
    }
}
