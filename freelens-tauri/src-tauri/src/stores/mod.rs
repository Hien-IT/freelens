/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The five stores the Electron build keeps in its data directory, loaded at
//! startup, shared with the views and the later core areas, and written back
//! with the bytes the Electron build writes
//! (`specs/007-main-foundation/contracts/stores-api.md`).

pub mod cluster;
pub mod favorites;
pub mod file;
pub mod hotbar;
pub mod js_json;
pub mod user;
pub mod weblinks;

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};

use serde::Serialize;
use serde_json::{Map, Value};

use crate::foundation::paths::BuildKind;
use crate::messaging::{Channels, DuplicateChannel, Log, MessageChannel, RequestChannel, Sender};
use file::StoreFile;
pub use user::Preferences;

/// One of the five stores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum StoreName {
    User,
    Hotbar,
    Favorites,
    Cluster,
    Weblink,
}

impl StoreName {
    /// In the order the Electron build loads them.
    pub const ALL: [Self; 5] = [
        Self::User,
        Self::Cluster,
        Self::Favorites,
        Self::Hotbar,
        Self::Weblink,
    ];

    pub fn config_name(self) -> &'static str {
        match self {
            Self::User => user::CONFIG_NAME,
            Self::Hotbar => hotbar::CONFIG_NAME,
            Self::Favorites => favorites::CONFIG_NAME,
            Self::Cluster => cluster::CONFIG_NAME,
            Self::Weblink => weblinks::CONFIG_NAME,
        }
    }

    /// The top-level keys the store's `toJSON` writes.
    fn keys(self) -> &'static [&'static str] {
        match self {
            Self::User => user::KEYS,
            Self::Hotbar => hotbar::KEYS,
            Self::Favorites => favorites::KEYS,
            Self::Cluster => cluster::KEYS,
            Self::Weblink => weblinks::KEYS,
        }
    }
}

/// What the defaults of the preferences depend on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Machine {
    /// `~/.kube` of the user database, the default kubeconfig directory to sync.
    pub kube_dir: String,
    /// The current time zone, which `localeTimezone` is not written as.
    pub timezone: String,
    pub build: BuildKind,
}

impl Machine {
    /// The machine this process runs on.
    pub fn current() -> Self {
        let home = crate::foundation::paths::user_home();
        Self {
            kube_dir: home.join(".kube").to_string_lossy().into_owned(),
            timezone: current_timezone(),
            build: BuildKind::current(),
        }
    }
}

/// `Intl.DateTimeFormat().resolvedOptions().timeZone`: `TZ` when set, else the
/// system's.
fn current_timezone() -> String {
    match std::env::var("TZ") {
        Ok(zone) if !zone.trim_start_matches(':').is_empty() => {
            zone.trim_start_matches(':').to_string()
        }
        _ => iana_time_zone::get_timezone().unwrap_or_else(|_| "UTC".into()),
    }
}

/// JavaScript's truthiness of a JSON value.
pub(crate) fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|number| number != 0.0),
        Value::String(text) => !text.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

/// A number the descriptors compute, as `JSON.parse` would read it back: an
/// integer when it is one.
pub(crate) fn js_number_value(number: f64) -> Value {
    const SAFE: f64 = 9_007_199_254_740_992.0;
    if number.fract() == 0.0 && number.abs() <= SAFE {
        if number >= 0.0 {
            return Value::from(number as u64);
        }
        return Value::from(number as i64);
    }
    serde_json::Number::from_f64(number).map_or(Value::Null, Value::Number)
}

/// `toJSON(fromStore(data))` of one store.
fn normalize(
    store: StoreName,
    data: &Map<String, Value>,
    previous: Option<&Map<String, Value>>,
    machine: &Machine,
) -> Map<String, Value> {
    match store {
        StoreName::User => user::normalize(data, previous, machine),
        StoreName::Hotbar => hotbar::normalize(data, previous),
        StoreName::Favorites => favorites::normalize(data),
        StoreName::Cluster => cluster::normalize(data, previous),
        StoreName::Weblink => weblinks::normalize(data),
    }
}

/// `{ configName, path, model }` of `persistent-storage-initial-values`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InitialValue {
    pub config_name: &'static str,
    pub path: String,
    pub model: Value,
}

pub const INITIAL_VALUES: RequestChannel<(), Vec<InitialValue>> =
    RequestChannel::new("persistent-storage-initial-values");

type Listener = Arc<dyn Fn(StoreName, &Value) + Send + Sync>;

struct Entry {
    name: StoreName,
    file: StoreFile,
    model: Map<String, Value>,
    writable: bool,
    /// `store-sync-main:<path>` and `store-sync-renderer:<path>`.
    to_core: &'static str,
    to_views: &'static str,
}

struct Inner {
    data_dir: PathBuf,
    machine: Machine,
    log: Log,
    entries: Mutex<Vec<Entry>>,
    sender: OnceLock<Sender>,
    listeners: Mutex<Vec<Listener>>,
}

/// The five stores, shared by the channels and every later core area; cheap
/// to clone.
#[derive(Clone)]
pub struct Stores {
    inner: Arc<Inner>,
}

impl Stores {
    /// Loads the five stores from `data_dir`, as the Electron build's main side
    /// loads them at startup.
    pub fn load(data_dir: &Path, machine: Machine, log: Log) -> Self {
        let entries = StoreName::ALL
            .iter()
            .map(|&name| {
                let path = data_dir.join(format!("{}.json", name.config_name()));
                let (file, writable) = match StoreFile::read(&path) {
                    Ok(mut file) => {
                        if file.raise_version()
                            && let Err(error) = file.write()
                        {
                            log(&write_error(&path, &error));
                        }
                        (file, true)
                    }
                    Err(error) => {
                        log(&format!(
                            "error: Stores: cannot read {}: {error:?}",
                            path.display()
                        ));
                        (StoreFile::empty(&path), false)
                    }
                };
                let model = normalize(name, &file.data(), None, &machine);
                entry(name, file, model, writable)
            })
            .collect();
        Self::with_entries(data_dir, machine, log, entries)
    }

    /// The stores with their defaults and no file, for callers that need the
    /// channels without a data directory.
    pub fn in_memory(machine: Machine, log: Log) -> Self {
        let entries = StoreName::ALL
            .iter()
            .map(|&name| {
                let path = PathBuf::from(format!("{}.json", name.config_name()));
                let model = normalize(name, &Map::new(), None, &machine);
                entry(name, StoreFile::empty(&path), model, false)
            })
            .collect();
        Self::with_entries(Path::new(""), machine, log, entries)
    }

    fn with_entries(data_dir: &Path, machine: Machine, log: Log, entries: Vec<Entry>) -> Self {
        Self {
            inner: Arc::new(Inner {
                data_dir: data_dir.to_path_buf(),
                machine,
                log,
                entries: Mutex::new(entries),
                sender: OnceLock::new(),
                listeners: Mutex::new(Vec::new()),
            }),
        }
    }

    pub fn data_dir(&self) -> &Path {
        &self.inner.data_dir
    }

    /// The preferences as the views see them now.
    pub fn preferences(&self) -> Preferences {
        let entries = self.inner.entries.lock().expect("stores lock");
        Preferences::from_model(&entries[index_of(StoreName::User)].model)
    }

    /// The model of one store, as `persistent-storage-initial-values` gives it.
    pub fn model(&self, store: StoreName) -> Value {
        let entries = self.inner.entries.lock().expect("stores lock");
        Value::Object(entries[index_of(store)].model.clone())
    }

    /// The answer of `persistent-storage-initial-values`.
    pub fn initial_values(&self) -> Vec<InitialValue> {
        let entries = self.inner.entries.lock().expect("stores lock");
        entries
            .iter()
            .map(|entry| InitialValue {
                config_name: entry.name.config_name(),
                path: entry.file.path().to_string_lossy().into_owned(),
                model: Value::Object(entry.model.clone()),
            })
            .collect()
    }

    /// Replaces a store's model as a view's `store-sync-main` does: normalized,
    /// written, and sent to every view, the sender included. Returns false when
    /// nothing changed.
    pub fn update(&self, store: StoreName, model: Value) -> bool {
        let Value::Object(data) = model else {
            (self.inner.log)(&format!(
                "error: Stores: dropped a model of {} that is not an object",
                store.config_name()
            ));
            return false;
        };
        let (model, to_views) = {
            let mut entries = self.inner.entries.lock().expect("stores lock");
            let entry = &mut entries[index_of(store)];
            let normalized = normalize(store, &data, Some(&entry.model), &self.inner.machine);
            if normalized == entry.model {
                return false;
            }
            entry.model = normalized.clone();
            if entry.writable {
                entry.file.merge(store.keys(), &normalized);
                if let Err(error) = entry.file.write() {
                    (self.inner.log)(&write_error(entry.file.path(), &error));
                }
            }
            (Value::Object(normalized), entry.to_views)
        };
        if let Some(sender) = self.inner.sender.get() {
            sender.send(MessageChannel::<Value>::new(to_views), &model);
        }
        let listeners = self.inner.listeners.lock().expect("listeners lock").clone();
        for listener in listeners {
            listener(store, &model);
        }
        true
    }

    /// Calls `listener` with the store and its new model after every change.
    pub fn on_change(&self, listener: impl Fn(StoreName, &Value) + Send + Sync + 'static) {
        self.inner
            .listeners
            .lock()
            .expect("listeners lock")
            .push(Arc::new(listener));
    }
}

fn entry(name: StoreName, file: StoreFile, model: Map<String, Value>, writable: bool) -> Entry {
    let path = file.path().display().to_string();
    // The ids carry the file's path; the five live as long as the process.
    let leak =
        |prefix: &str| -> &'static str { Box::leak(format!("{prefix}:{path}").into_boxed_str()) };
    Entry {
        name,
        to_core: leak("store-sync-main"),
        to_views: leak("store-sync-renderer"),
        file,
        model,
        writable,
    }
}

fn index_of(store: StoreName) -> usize {
    StoreName::ALL
        .iter()
        .position(|name| *name == store)
        .expect("every store is in ALL")
}

fn write_error(path: &Path, error: &std::io::Error) -> String {
    format!("error: Stores: cannot write {}: {error}", path.display())
}

/// Answers `persistent-storage-initial-values` and listens on the
/// `store-sync-main` channel of each store.
pub fn register(channels: &mut Channels, stores: &Stores) -> Result<(), DuplicateChannel> {
    let _ = stores.inner.sender.set(channels.sender());
    let answering = stores.clone();
    channels.answer(INITIAL_VALUES, move |(), _| {
        let stores = answering.clone();
        async move { Ok(stores.initial_values()) }
    })?;
    let ids: Vec<(StoreName, &'static str)> = stores
        .inner
        .entries
        .lock()
        .expect("stores lock")
        .iter()
        .map(|entry| (entry.name, entry.to_core))
        .collect();
    for (name, id) in ids {
        let stores = stores.clone();
        channels.listen(MessageChannel::<Value>::new(id), move |model, _| {
            stores.update(name, model);
        });
    }
    Ok(())
}
