/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The templates of `~/.freelens/templates`: answered on
//! `initial-user-resource-templates`, then followed by polling the folder,
//! every change sent on `user-resource-templates-update` (research R8).

use std::collections::{BTreeMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};

use serde::Serialize;

use crate::messaging::{Channels, DuplicateChannel, Log, MessageChannel, RequestChannel, Sender};

pub const INITIAL: RequestChannel<(), Vec<Group>> =
    RequestChannel::new("initial-user-resource-templates");
pub const UPDATE: MessageChannel<Vec<Group>> =
    MessageChannel::new("user-resource-templates-update");

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Group {
    pub label: String,
    pub options: Vec<Template>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Template {
    pub label: String,
    pub value: String,
}

/// The size and the modification time a file had at a poll.
type Stamp = (u64, Option<SystemTime>);

#[derive(Debug, Clone)]
struct Seen {
    stamp: Stamp,
    /// The contents, once read, and the stamp they were read at.
    read: Option<(String, Stamp)>,
}

struct Watcher {
    folder: PathBuf,
    interval: Duration,
    sender: Sender,
    log: Log,
    state: Mutex<Option<State>>,
}

struct State {
    files: BTreeMap<PathBuf, Seen>,
    sent: Vec<Group>,
}

impl Watcher {
    /// One look at the folder. A file is read once its size and time have not
    /// changed since the last poll, as chokidar waits for a write to finish;
    /// until then a changed file keeps the contents read before. The first
    /// poll reads every file at once.
    fn poll(&self, previous: Option<&BTreeMap<PathBuf, Seen>>) -> BTreeMap<PathBuf, Seen> {
        let mut files = BTreeMap::new();
        for (relative, stamp) in walk(&self.folder) {
            let before = previous.and_then(|files| files.get(&relative));
            let stable = previous.is_none() || before.is_some_and(|seen| seen.stamp == stamp);
            let read = if !stable {
                before.and_then(|seen| seen.read.clone())
            } else if let Some(read) = before
                .and_then(|seen| seen.read.clone())
                .filter(|(_, read_at)| *read_at == stamp)
            {
                Some(read)
            } else {
                match fs::read(self.folder.join(&relative)) {
                    Ok(bytes) => Some((String::from_utf8_lossy(&bytes).into_owned(), stamp)),
                    Err(error) => {
                        if error.kind() != std::io::ErrorKind::NotFound {
                            (self.log)(&format!(
                                "warn: Templates: cannot read {}: {error}",
                                relative.display()
                            ));
                        }
                        None
                    }
                }
            };
            files.insert(relative, Seen { stamp, read });
        }
        files
    }

    /// The groups of the templates read, in the order of their paths.
    fn groups(files: &BTreeMap<PathBuf, Seen>) -> Vec<Group> {
        let mut groups: Vec<Group> = Vec::new();
        for (relative, seen) in files {
            let Some((value, _)) = &seen.read else {
                continue;
            };
            let label = match relative.parent() {
                Some(parent) if !parent.as_os_str().is_empty() => {
                    parent.to_string_lossy().into_owned()
                }
                _ => "ungrouped".to_string(),
            };
            let template = Template {
                label: relative
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default(),
                value: value.clone(),
            };
            match groups.iter_mut().find(|group| group.label == label) {
                Some(group) => group.options.push(template),
                None => groups.push(Group {
                    label,
                    options: vec![template],
                }),
            }
        }
        groups
    }

    /// The answer of a request, starting the polls on the first one.
    fn templates(self: &Arc<Self>) -> Vec<Group> {
        let mut state = self.state.lock().expect("templates lock");
        if let Some(state) = state.as_ref() {
            return state.sent.clone();
        }
        let files = self.poll(None);
        let sent = Self::groups(&files);
        *state = Some(State {
            files,
            sent: sent.clone(),
        });
        let watcher = Arc::clone(self);
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(watcher.interval);
            tick.tick().await;
            loop {
                tick.tick().await;
                watcher.poll_and_send();
            }
        });
        sent
    }

    fn poll_and_send(&self) {
        let mut state = self.state.lock().expect("templates lock");
        let Some(state) = state.as_mut() else {
            return;
        };
        state.files = self.poll(Some(&state.files));
        let groups = Self::groups(&state.files);
        if groups != state.sent {
            state.sent = groups.clone();
            self.sender.send(UPDATE, &groups);
        }
    }
}

/// The template files under `folder`, by path relative to it: those whose
/// path ends in `.yaml`, `.yml` or `.json`, symbolic links followed, each
/// directory walked once.
fn walk(folder: &Path) -> Vec<(PathBuf, Stamp)> {
    let mut found = Vec::new();
    let mut visited = HashSet::new();
    let mut pending = vec![PathBuf::new()];
    while let Some(relative) = pending.pop() {
        let directory = folder.join(&relative);
        let Ok(canonical) = fs::canonicalize(&directory) else {
            continue;
        };
        if !visited.insert(canonical) {
            continue;
        }
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = relative.join(entry.file_name());
            let Ok(metadata) = fs::metadata(folder.join(&path)) else {
                continue;
            };
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() {
                let name = path.to_string_lossy();
                if [".yaml", ".yml", ".json"]
                    .iter()
                    .any(|end| name.ends_with(end))
                {
                    found.push((path, (metadata.len(), metadata.modified().ok())));
                }
            }
        }
    }
    found
}

pub fn register(
    channels: &mut Channels,
    home: &Path,
    interval: Duration,
    log: Log,
) -> Result<(), DuplicateChannel> {
    let watcher = Arc::new(Watcher {
        folder: home.join(".freelens").join("templates"),
        interval,
        sender: channels.sender(),
        log,
        state: Mutex::new(None),
    });
    channels.answer(INITIAL, move |(), _| {
        let templates = watcher.templates();
        async move { Ok(templates) }
    })
}
