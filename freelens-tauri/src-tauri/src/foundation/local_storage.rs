/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! `lens-local-storage:read` and `lens-local-storage:write`: what a view keeps
//! across runs, one file for the main window and one per cluster
//! (`specs/007-main-foundation/contracts/foundation-channels.md`, "Local storage").

use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::{Map, Value};

use crate::catalog::Catalog;
use crate::messaging::{ChannelError, Channels, DuplicateChannel, RequestChannel};
use crate::stores::file::write_atomically;
use crate::stores::js_json::to_js_string_indented;

pub const READ: RequestChannel<Value, Value> = RequestChannel::new("lens-local-storage:read");
pub const WRITE: RequestChannel<Value, ()> = RequestChannel::new("lens-local-storage:write");

struct LocalStorage {
    directory: PathBuf,
    catalog: Catalog,
}

impl LocalStorage {
    /// The file of a view: `app.json` without a cluster, `<clusterId>.json` for
    /// a cluster of the catalog at the time of the request; any other cluster
    /// id is refused.
    fn file(&self, request: &Value) -> Result<PathBuf, ChannelError> {
        match request.get("clusterId") {
            None => Ok(self.directory.join("app.json")),
            Some(Value::String(id)) if self.catalog.has_cluster(id) => {
                Ok(self.directory.join(format!("{id}.json")))
            }
            Some(id) => {
                let id = id.as_str().map_or_else(|| id.to_string(), str::to_string);
                Err(ChannelError::from(format!(
                    "Cannot use the local storage of cluster \"{id}\", which is not registered"
                )))
            }
        }
    }
}

/// What `readJson` gives: the stored object, an array as it is, and `{}` for
/// a file that is missing, unreadable, invalid or holds anything else.
fn read(path: &Path) -> Value {
    let Ok(bytes) = fs::read(path) else {
        return Value::Object(Map::new());
    };
    let text = String::from_utf8_lossy(&bytes);
    let text = text.strip_prefix('\u{feff}').unwrap_or(&text);
    match serde_json::from_str::<Value>(text) {
        Ok(value @ (Value::Object(_) | Value::Array(_))) => value,
        _ => Value::Object(Map::new()),
    }
}

/// What `writeJson` writes with `spaces: 2`, in a `0700` directory and a
/// `0600` file, here written whole or not at all.
fn write(path: &Path, state: &Value) -> std::io::Result<()> {
    if let Some(directory) = path.parent()
        && !directory.exists()
    {
        fs::create_dir_all(directory)?;
        fs::set_permissions(directory, fs::Permissions::from_mode(0o700))?;
    }
    let mut text = to_js_string_indented(state, "  ");
    text.push('\n');
    write_atomically(path, text.as_bytes(), Some(0o600))
}

pub fn register(
    channels: &mut Channels,
    data_dir: &Path,
    catalog: Catalog,
) -> Result<(), DuplicateChannel> {
    let storage = Arc::new(LocalStorage {
        directory: data_dir.join("lens-local-storage"),
        catalog,
    });
    let reading = Arc::clone(&storage);
    channels.answer(READ, move |request, _| {
        let file = reading.file(&request);
        async move { Ok(read(&file?)) }
    })?;
    channels.answer(WRITE, move |request, _| {
        let file = storage.file(&request);
        async move {
            let state = request.get("state").cloned().unwrap_or(Value::Null);
            write(&file?, &state).map_err(ChannelError::from)
        }
    })
}
