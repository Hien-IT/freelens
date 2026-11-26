/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! Following the synced files (research R5): FSEvents only wakes a scan of
//! the syncs an event concerns; the scan decides, with a file read once it
//! has been still for 500 ms and a missing file removed once it has been
//! missing for 100 ms (`specs/008-main-catalog/contracts/synced-files.md`,
//! "Following changes").

use std::collections::{HashMap, HashSet};
use std::os::unix::fs::MetadataExt;
use std::path::{Path, PathBuf};
use std::sync::mpsc::{Receiver, RecvTimeoutError, Sender};
use std::time::{Duration, Instant};

use notify::{RecursiveMode, Watcher};

use super::kubeconfig::{FileRead, read_synced_file};
use super::syncs::{SyncKind, SyncSet, SyncedFile, cluster_id, list_files, merge_contexts};
use super::{Catalog, CatalogLog};
use crate::stores::Stores;

/// The windows of the watcher.
#[derive(Debug, Clone, Copy)]
pub struct Timing {
    /// How long a file stays the same before it is read.
    pub stable: Duration,
    /// How long a file stays missing before it is removed.
    pub missing: Duration,
    /// How often a file that is waiting is looked at again.
    pub poll: Duration,
}

impl Default for Timing {
    fn default() -> Self {
        Self {
            stable: Duration::from_millis(500),
            missing: Duration::from_millis(100),
            poll: Duration::from_millis(100),
        }
    }
}

/// What tells a file's contents changed: its size, modification time and
/// inode (data-model.md `Synced file.identity`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    pub size: u64,
    pub modified: (i64, i64),
    pub inode: u64,
}

/// The identity of the file `path` names, following symbolic links.
pub fn identity_of(path: &Path) -> Option<Identity> {
    let meta = std::fs::metadata(path).ok()?;
    if meta.is_dir() {
        return None;
    }
    Some(Identity {
        size: meta.len(),
        modified: (meta.mtime(), meta.mtime_nsec()),
        inode: meta.ino(),
    })
}

/// What to do with a file after a look at it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Action {
    Nothing,
    Read,
    Remove,
}

/// The watcher's record of one synced file.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FileState {
    identity: Option<Identity>,
    /// When the identity last changed, while a read waits (data-model.md
    /// `Synced file.stable_at`).
    changed_at: Option<Instant>,
    /// When a look first found it missing (`Synced file.missing_at`).
    missing_at: Option<Instant>,
}

impl FileState {
    /// A file the first scan has just read.
    pub fn read(identity: Option<Identity>) -> Self {
        Self {
            identity,
            changed_at: None,
            missing_at: None,
        }
    }

    /// A file seen for the first time after the first scan, read once still.
    pub fn new_at(now: Instant, identity: Option<Identity>) -> Self {
        Self {
            identity,
            changed_at: Some(now),
            missing_at: None,
        }
    }

    /// Whether a read or a removal waits on the passing of time.
    pub fn waiting(&self) -> bool {
        self.changed_at.is_some() || self.missing_at.is_some()
    }

    /// Takes a look at the file: `current` is its identity now, or `None`
    /// when it is missing.
    pub fn observe(&mut self, now: Instant, current: Option<Identity>, timing: &Timing) -> Action {
        let Some(current) = current else {
            return match self.missing_at {
                None => {
                    self.missing_at = Some(now);
                    Action::Nothing
                }
                Some(since) if now.duration_since(since) >= timing.missing => Action::Remove,
                Some(_) => Action::Nothing,
            };
        };
        if self.missing_at.take().is_some() {
            // Back within the window, as an editor's unlink and create: a change.
            self.identity = Some(current);
            self.changed_at = Some(now);
            return Action::Nothing;
        }
        if self.identity != Some(current) {
            self.identity = Some(current);
            self.changed_at = Some(now);
            return Action::Nothing;
        }
        match self.changed_at {
            Some(since) if now.duration_since(since) >= timing.stable => {
                self.changed_at = None;
                Action::Read
            }
            _ => Action::Nothing,
        }
    }
}

/// What reaches the watcher's thread.
#[derive(Debug)]
pub enum Event {
    /// FSEvents named these paths; `rescan` when it dropped or coalesced
    /// events under them.
    Paths { paths: Vec<PathBuf>, rescan: bool },
    /// The kubeconfig sync setting may have changed.
    Setting,
}

/// Whether an event's path concerns a sync watching `roots`, whose paths are
/// canonical, as FSEvents names them (`/private/var` for `/var`).
pub fn concerns(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

/// The canonical directories a sync is watched through: its folder, or the
/// folder of its file; and the folder of each symbolic link's target.
pub fn roots_of(sync: &super::syncs::Sync) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    let mut push = |path: &Path| {
        if let Ok(canonical) = path.canonicalize()
            && !roots.contains(&canonical)
        {
            roots.push(canonical);
        }
    };
    let path = Path::new(&sync.path);
    match sync.kind {
        SyncKind::Missing => {}
        SyncKind::Folder => push(path),
        SyncKind::File => {
            if let Some(parent) = path.parent() {
                push(parent);
            }
        }
    }
    let links = std::iter::once(path.to_path_buf())
        .chain(sync.files.iter().map(|file| PathBuf::from(&file.path)));
    for link in links {
        if std::fs::symlink_metadata(&link).is_ok_and(|meta| meta.file_type().is_symlink())
            && let Ok(target) = link.canonicalize()
            && let Some(parent) = target.parent()
        {
            push(parent);
        }
    }
    roots
}

/// Looks at every file of a sync, reads the ones that are still, removes the
/// ones gone long enough, and adds the new ones. Returns whether its clusters
/// may have changed, and the ids of the files read again.
pub fn scan(
    sync: &mut super::syncs::Sync,
    now: Instant,
    timing: &Timing,
    log: &CatalogLog,
) -> (bool, HashSet<String>) {
    let mut changed = false;
    let mut reread = HashSet::new();
    let limit = sync.limit();
    let mut removed = Vec::new();
    for file in &mut sync.files {
        match file
            .watch
            .observe(now, identity_of(Path::new(&file.path)), timing)
        {
            Action::Nothing => {}
            Action::Remove => removed.push(file.path.clone()),
            Action::Read => match read_synced_file(Path::new(&file.path), limit, log) {
                FileRead::Failed => {}
                read => {
                    file.invalid = read == FileRead::Invalid;
                    let contexts = read.contexts().unwrap_or_default();
                    file.contexts = merge_contexts(&file.contexts, &contexts);
                    reread.extend(
                        file.contexts
                            .iter()
                            .map(|context| cluster_id(&file.path, context)),
                    );
                    changed = true;
                }
            },
        }
    }
    if !removed.is_empty() {
        sync.files.retain(|file| !removed.contains(&file.path));
        changed = true;
    }
    let (listed, ignored) = list_files(sync);
    for (path, rule) in ignored {
        if sync.ignored.insert(path.clone()) {
            log.info(&format!("ignoring {path} due to ignore rule: {rule}"));
        }
    }
    for path in listed {
        if sync.file(&path).is_none() {
            let identity = identity_of(Path::new(&path));
            sync.files.push(SyncedFile {
                path,
                invalid: false,
                contexts: Vec::new(),
                watch: FileState::new_at(now, identity),
            });
        }
    }
    (changed, reread)
}

/// The watcher's thread after the first scan: wakes on FSEvents, on a change
/// of the setting, and every `poll` while a file waits.
pub fn run(
    catalog: Catalog,
    stores: Stores,
    mut set: SyncSet,
    events: Receiver<Event>,
    sender: Sender<Event>,
    timing: Timing,
    log: CatalogLog,
) {
    let forwarding = sender.clone();
    let mut watcher =
        match notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
            if let Ok(event) = result {
                let rescan = event.need_rescan();
                let _ = forwarding.send(Event::Paths {
                    paths: event.paths,
                    rescan,
                });
            }
        }) {
            Ok(watcher) => Some(watcher),
            Err(error) => {
                log.warn(&format!("watching file/folder failed: {error}"));
                None
            }
        };
    let mut watched: HashSet<PathBuf> = HashSet::new();
    let mut roots: HashMap<String, Vec<PathBuf>> = HashMap::new();
    let mut refresh_watches =
        |set: &SyncSet,
         watched: &mut HashSet<PathBuf>,
         roots: &mut HashMap<String, Vec<PathBuf>>| {
            roots.clear();
            let mut wanted = HashSet::new();
            for sync in set.syncs() {
                let sync_roots = roots_of(sync);
                wanted.extend(sync_roots.iter().cloned());
                roots.insert(sync.path.clone(), sync_roots);
            }
            if let Some(watcher) = watcher.as_mut() {
                for root in wanted.difference(watched) {
                    if let Err(error) = watcher.watch(root, RecursiveMode::NonRecursive) {
                        log.warn(&format!(
                            "watching file/folder failed: {error} ({})",
                            root.display()
                        ));
                    }
                }
                for root in watched.difference(&wanted) {
                    let _ = watcher.unwatch(root);
                }
            }
            *watched = wanted;
        };
    refresh_watches(&set, &mut watched, &mut roots);
    // A change made between the first scan and the watches is caught here.
    let mut dirty: HashSet<String> = set.syncs().iter().map(|sync| sync.path.clone()).collect();
    catalog.set_scanned();
    loop {
        let waiting = set
            .syncs()
            .iter()
            .any(|sync| sync.files.iter().any(|file| file.watch.waiting()));
        let event = if waiting || !dirty.is_empty() {
            events.recv_timeout(timing.poll)
        } else {
            events.recv().map_err(|_| RecvTimeoutError::Disconnected)
        };
        match event {
            Ok(Event::Paths { paths, rescan }) => {
                for sync in set.syncs() {
                    let sync_roots = roots.get(&sync.path).map(Vec::as_slice).unwrap_or(&[]);
                    let hit = paths.iter().any(|path| {
                        concerns(path, sync_roots)
                            || (rescan && sync_roots.iter().any(|root| root.starts_with(path)))
                    });
                    if hit {
                        dirty.insert(sync.path.clone());
                    }
                }
            }
            Ok(Event::Setting) => {
                let before: Vec<String> =
                    set.syncs().iter().map(|sync| sync.path.clone()).collect();
                let started = set.reconcile(&catalog.desired_syncs(&stores));
                let after: Vec<String> = set.syncs().iter().map(|sync| sync.path.clone()).collect();
                if before != after {
                    let reread: HashSet<String> = set
                        .syncs()
                        .iter()
                        .filter(|sync| started.contains(&sync.path))
                        .flat_map(|sync| {
                            sync.files.iter().flat_map(|file| {
                                file.contexts
                                    .iter()
                                    .map(|context| cluster_id(&file.path, context))
                            })
                        })
                        .collect();
                    refresh_watches(&set, &mut watched, &mut roots);
                    catalog.publish_changed(&set, &reread);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return,
        }
        // Drain what else arrived, so that a burst of events makes one scan.
        while let Ok(event) = events.try_recv() {
            if let Event::Paths { .. } = event {
                dirty.extend(set.syncs().iter().map(|sync| sync.path.clone()));
            } else {
                let _ = sender.send(event);
                break;
            }
        }
        let now = Instant::now();
        let mut changed = false;
        let mut reread = HashSet::new();
        for sync in set.syncs_mut() {
            let looking =
                dirty.contains(&sync.path) || sync.files.iter().any(|file| file.watch.waiting());
            if !looking {
                continue;
            }
            let (sync_changed, sync_reread) = scan(sync, now, &timing, &log);
            changed |= sync_changed;
            reread.extend(sync_reread);
        }
        dirty.clear();
        if changed {
            refresh_watches(&set, &mut watched, &mut roots);
            catalog.publish_changed(&set, &reread);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(size: u64, inode: u64) -> Option<Identity> {
        Some(Identity {
            size,
            modified: (1, 0),
            inode,
        })
    }

    #[test]
    fn a_change_is_read_once_still_for_the_stable_window() {
        let timing = Timing::default();
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut state = FileState::read(id(10, 1));
        assert_eq!(state.observe(at(0), id(10, 1), &timing), Action::Nothing);
        assert!(!state.waiting());
        assert_eq!(state.observe(at(10), id(20, 1), &timing), Action::Nothing);
        assert!(state.waiting());
        assert_eq!(state.observe(at(400), id(20, 1), &timing), Action::Nothing);
        // A further change restarts the wait.
        assert_eq!(state.observe(at(450), id(30, 1), &timing), Action::Nothing);
        assert_eq!(state.observe(at(900), id(30, 1), &timing), Action::Nothing);
        assert_eq!(state.observe(at(950), id(30, 1), &timing), Action::Read);
        assert!(!state.waiting());
        assert_eq!(state.observe(at(2000), id(30, 1), &timing), Action::Nothing);
    }

    #[test]
    fn a_new_inode_of_the_same_size_is_a_change() {
        let timing = Timing::default();
        let start = Instant::now();
        let mut state = FileState::read(id(10, 1));
        assert_eq!(state.observe(start, id(10, 2), &timing), Action::Nothing);
        assert!(state.waiting());
    }

    #[test]
    fn a_missing_file_is_removed_only_when_still_missing_and_is_a_change_when_back() {
        let timing = Timing::default();
        let start = Instant::now();
        let at = |ms: u64| start + Duration::from_millis(ms);
        let mut state = FileState::read(id(10, 1));
        assert_eq!(state.observe(at(0), None, &timing), Action::Nothing);
        assert_eq!(state.observe(at(50), None, &timing), Action::Nothing);
        assert_eq!(state.observe(at(100), None, &timing), Action::Remove);

        let mut back = FileState::read(id(10, 1));
        assert_eq!(back.observe(at(0), None, &timing), Action::Nothing);
        assert_eq!(back.observe(at(60), id(10, 2), &timing), Action::Nothing);
        assert_eq!(back.observe(at(560), id(10, 2), &timing), Action::Read);
    }

    #[test]
    fn a_new_file_waits_for_the_stable_window() {
        let timing = Timing::default();
        let start = Instant::now();
        let mut state = FileState::new_at(start, id(10, 1));
        assert!(state.waiting());
        assert_eq!(
            state.observe(start + Duration::from_millis(499), id(10, 1), &timing),
            Action::Nothing
        );
        assert_eq!(
            state.observe(start + Duration::from_millis(500), id(10, 1), &timing),
            Action::Read
        );
    }

    #[test]
    fn an_event_under_private_var_concerns_a_sync_under_var() {
        let dir = std::env::temp_dir().join(format!("freelens-watch-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let sync = super::super::syncs::Sync {
            path: dir.display().to_string(),
            origin: super::super::syncs::Origin::Setting,
            kind: SyncKind::Folder,
            files: Vec::new(),
            ignored: HashSet::new(),
        };
        let roots = roots_of(&sync);
        let canonical = dir.canonicalize().unwrap();
        assert_eq!(roots.as_slice(), std::slice::from_ref(&canonical));
        assert!(concerns(&canonical.join("config"), &roots));
        assert!(!concerns(Path::new("/elsewhere/config"), &roots));
        // macOS gives the temporary directory under /var, which is a link to
        // /private/var; FSEvents names the canonical path.
        if dir.starts_with("/var") {
            assert!(canonical.starts_with("/private/var"));
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
