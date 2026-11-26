/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The catalog: the web links, the general pages and the clusters the views
//! list, kept by the core, shared with its other areas and sent whole to every
//! view (`specs/008-main-catalog/contracts/catalog-api.md`).

pub mod channels;
pub mod entities;
pub mod kubeconfig;
pub mod syncs;
pub mod watch;
pub mod weblinks;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::{Map, Value};
use tokio::sync::watch as tokio_watch;

use crate::messaging::Log;
use crate::stores::{StoreName, Stores};
use entities::LabelContext;
use syncs::{Origin, SyncKind, SyncSet};

/// The catalog's lines in the core's log, prefixed `Catalog:` as the Electron
/// build prefixes its own `[KUBECONFIG-SYNC]:` (research R11). Debug lines are
/// written only when the debugging flag of `machine-values` is on.
#[derive(Clone)]
pub struct CatalogLog {
    log: Log,
    debug: bool,
}

impl CatalogLog {
    pub fn new(log: Log, debug: bool) -> Self {
        Self { log, debug }
    }

    pub fn info(&self, line: &str) {
        (self.log)(&format!("Catalog: {line}"));
    }

    pub fn warn(&self, line: &str) {
        (self.log)(&format!("warn: Catalog: {line}"));
    }

    pub fn debug(&self, line: &str) {
        if self.debug {
            (self.log)(&format!("debug: Catalog: {line}"));
        }
    }
}

/// Where a cluster of the catalog comes from; never its credentials.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClusterSource {
    pub id: String,
    pub context_name: String,
    /// The synced file, as `spec.kubeconfigPath` names it.
    pub kubeconfig_path: PathBuf,
}

/// A change of the clusters, reported to the subscribers in order.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CatalogEvent {
    /// A cluster was added, or its file was read again.
    ClusterChanged(String),
    /// A cluster left the catalog.
    ClusterRemoved(String),
}

/// What the last read of the file of `--kubeconfig` found.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LaunchFileState {
    Read,
    Missing,
    Invalid,
}

/// The file of `--kubeconfig`, for the spike page's `/api/clusters` only.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LaunchFile {
    pub path: PathBuf,
    pub state: LaunchFileState,
}

type ClusterListener = Arc<dyn Fn(&CatalogEvent) + Send + Sync>;
type ChangeListener = Arc<dyn Fn() + Send + Sync>;

#[derive(Default)]
struct State {
    weblinks: Vec<Value>,
    /// The phase of each web link whose first check has ended.
    phases: HashMap<String, String>,
    clusters: Vec<ClusterSource>,
    /// The cluster last named on `cluster-visibility`.
    visible: Option<String>,
    /// The clusters whose `null` icon was cleared, which keep no icon.
    icon_cleared: HashSet<String>,
    version: u64,
    launch_file: Option<LaunchFile>,
    /// The paths of the running syncs, in the order they started.
    syncs: Vec<String>,
}

struct Inner {
    state: Mutex<State>,
    cluster_listeners: Mutex<Vec<ClusterListener>>,
    change_listeners: Mutex<Vec<ChangeListener>>,
    scanned: tokio_watch::Sender<bool>,
    stores: Option<Stores>,
    labels: LabelContext,
    /// `<data dir>/kubeconfigs`.
    app_dir: PathBuf,
    launch: Option<PathBuf>,
    log: Option<CatalogLog>,
    /// The file of `--catalog-dump`.
    dump: Mutex<Option<PathBuf>>,
    /// Reaches the watcher's thread once it runs.
    events: Mutex<Option<std::sync::mpsc::Sender<watch::Event>>>,
    /// Called after each change of the web link store.
    weblink_listeners: Mutex<Vec<ChangeListener>>,
}

/// Built once at startup and cloned into every area that needs it.
#[derive(Clone)]
pub struct Catalog {
    inner: Arc<Inner>,
}

impl Catalog {
    /// A catalog with no cluster and no store, whose scan is done.
    pub fn empty() -> Self {
        Self::with(None, PathBuf::new(), None, None, true, None)
    }

    /// The catalog of a data directory: the web links of `stores` and the
    /// general pages at once, the clusters of the syncs once `start` has
    /// scanned them. `launch` is the file of `--kubeconfig`.
    pub fn new(stores: &Stores, data_dir: &Path, launch: Option<PathBuf>, log: CatalogLog) -> Self {
        Self::new_with_home(stores, data_dir, launch, log, std::env::var("HOME").ok())
    }

    /// `new` with the home directory of the `file` label given, for tests.
    pub fn new_with_home(
        stores: &Stores,
        data_dir: &Path,
        launch: Option<PathBuf>,
        log: CatalogLog,
        home: Option<String>,
    ) -> Self {
        let catalog = Self::with(
            Some(stores.clone()),
            data_dir.join("kubeconfigs"),
            launch,
            Some(log),
            false,
            home,
        );
        catalog.refresh_weblinks();
        let following = catalog.clone();
        stores.on_change(move |store, _| match store {
            StoreName::Weblink => {
                following.refresh_weblinks();
                let listeners = following
                    .inner
                    .weblink_listeners
                    .lock()
                    .expect("the listeners lock")
                    .clone();
                for listener in &listeners {
                    listener();
                }
            }
            StoreName::Cluster => {
                following.bump();
                following.ensure_entries();
            }
            StoreName::User => {
                if let Some(events) = following
                    .inner
                    .events
                    .lock()
                    .expect("the events lock")
                    .as_ref()
                {
                    let _ = events.send(watch::Event::Setting);
                }
            }
            _ => {}
        });
        catalog
    }

    /// A catalog of the contexts of one file, read once with the loader of
    /// the kubeconfig sync, without stores; for the tests that need clusters
    /// alone.
    pub fn from_kubeconfig_file(path: &Path) -> Self {
        let catalog = Self::with(
            None,
            PathBuf::new(),
            Some(path.to_path_buf()),
            None,
            true,
            std::env::var("HOME").ok(),
        );
        let log = CatalogLog::new(Arc::new(|_| {}), false);
        let mut set = SyncSet::new(log);
        set.reconcile(&syncs::desired_launch_only(path));
        catalog.publish(&set);
        catalog
    }

    fn with(
        stores: Option<Stores>,
        app_dir: PathBuf,
        launch: Option<PathBuf>,
        log: Option<CatalogLog>,
        scanned: bool,
        home: Option<String>,
    ) -> Self {
        let (scanned, _) = tokio_watch::channel(scanned);
        let labels = LabelContext {
            app_dir: app_dir.display().to_string(),
            home,
        };
        Self {
            inner: Arc::new(Inner {
                state: Mutex::new(State::default()),
                cluster_listeners: Mutex::new(Vec::new()),
                change_listeners: Mutex::new(Vec::new()),
                scanned,
                stores,
                labels,
                app_dir,
                launch,
                log,
                dump: Mutex::new(None),
                events: Mutex::new(None),
                weblink_listeners: Mutex::new(Vec::new()),
            }),
        }
    }

    /// Appends each catalog sent to `path`, one JSON line each
    /// (`--catalog-dump`).
    pub fn dump_to(&self, path: PathBuf) {
        *self.inner.dump.lock().expect("the dump lock") = Some(path);
    }

    /// The file of `--catalog-dump`, if any.
    pub fn dump_path(&self) -> Option<PathBuf> {
        self.inner.dump.lock().expect("the dump lock").clone()
    }

    /// `<data dir>/kubeconfigs`, where pasted kubeconfig text is written.
    pub fn app_dir(&self) -> &Path {
        &self.inner.app_dir
    }

    /// The catalog's log, when it was built with one.
    pub fn log(&self) -> Option<CatalogLog> {
        self.inner.log.clone()
    }

    /// Starts the syncs on a thread of their own: creates the application's
    /// kubeconfig directory, scans every sync once, then follows them.
    /// Returns at once.
    pub fn start(&self) {
        let (Some(stores), Some(log)) = (self.inner.stores.clone(), self.inner.log.clone()) else {
            self.set_scanned();
            return;
        };
        let catalog = self.clone();
        let spawned = std::thread::Builder::new()
            .name("catalog-syncs".into())
            .spawn(move || {
                if let Err(error) = std::fs::create_dir_all(&catalog.inner.app_dir) {
                    log.warn(&format!(
                        "cannot create {}: {error}",
                        catalog.inner.app_dir.display()
                    ));
                }
                log.info("starting requested syncs");
                let (sender, events) = std::sync::mpsc::channel();
                *catalog.inner.events.lock().expect("the events lock") = Some(sender.clone());
                let mut set = SyncSet::new(log.clone());
                set.reconcile(&catalog.desired_syncs(&stores));
                catalog.publish(&set);
                // `run` ends the first scan once the syncs are watched, so that
                // no change made after it is missed.
                watch::run(
                    catalog,
                    stores,
                    set,
                    events,
                    sender,
                    watch::Timing::default(),
                    log,
                );
            });
        if spawned.is_err() {
            self.set_scanned();
        }
    }

    /// The syncs the settings, the application's directory and the launch
    /// file give now.
    pub(crate) fn desired_syncs(&self, stores: &Stores) -> Vec<(String, Origin)> {
        let model = stores.model(StoreName::User);
        let preferences = model.get("preferences").cloned().unwrap_or(Value::Null);
        let machine = stores.machine();
        let default = match machine.build {
            crate::foundation::paths::BuildKind::Release => vec![machine.kube_dir.clone()],
            crate::foundation::paths::BuildKind::Debug => Vec::new(),
        };
        syncs::desired(
            &self.inner.app_dir,
            syncs::setting_paths(&preferences, &default),
            self.inner.launch.as_deref(),
        )
    }

    /// Takes the clusters and the launch file's state from the syncs.
    fn publish(&self, set: &SyncSet) {
        let reread: HashSet<String> = set.clusters().into_iter().map(|c| c.id).collect();
        self.publish_changed(set, &reread);
    }

    /// Takes the clusters from the syncs; the ids of `reread` had their file
    /// read again.
    pub(crate) fn publish_changed(&self, set: &SyncSet, reread: &HashSet<String>) {
        let launch_file = set
            .syncs()
            .iter()
            .find(|sync| sync.origin == Origin::Launch)
            .map(|sync| LaunchFile {
                path: PathBuf::from(&sync.path),
                state: match sync.kind {
                    SyncKind::Missing => LaunchFileState::Missing,
                    _ if sync.files.iter().any(|file| file.invalid) => LaunchFileState::Invalid,
                    _ => LaunchFileState::Read,
                },
            });
        {
            let mut state = self.state();
            state.launch_file = launch_file;
            state.syncs = set.syncs().iter().map(|sync| sync.path.clone()).collect();
        }
        self.set_clusters(set.clusters(), reread);
    }

    /// Logs at quit what `stopSync` of `manager.ts` logs. The process ends
    /// with the watcher's thread, so nothing else needs stopping.
    pub fn stop(&self) {
        let Some(log) = &self.inner.log else {
            return;
        };
        log.info("stopping requested syncs");
        for path in self.state().syncs.clone() {
            log.info(&format!("stopping sync of file/folder {path}"));
        }
    }

    /// Whether `id` is a cluster of the catalog now.
    pub fn has_cluster(&self, id: &str) -> bool {
        self.state().clusters.iter().any(|cluster| cluster.id == id)
    }

    /// The file and context of a cluster of the catalog now.
    pub fn cluster(&self, id: &str) -> Option<ClusterSource> {
        self.state()
            .clusters
            .iter()
            .find(|cluster| cluster.id == id)
            .cloned()
    }

    /// The clusters of the catalog now, in catalog order.
    pub fn clusters(&self) -> Vec<ClusterSource> {
        self.state().clusters.clone()
    }

    /// The ids of the clusters of the catalog now, in catalog order.
    pub fn cluster_ids(&self) -> Vec<String> {
        self.state()
            .clusters
            .iter()
            .map(|cluster| cluster.id.clone())
            .collect()
    }

    /// The entities as `catalog:items` sends them: the web links, then the
    /// general pages, then the clusters (research R1).
    pub fn entities(&self) -> Vec<Value> {
        let entries = self.store_entries();
        let state = self.state();
        let clusters = state.clusters.iter().map(|cluster| {
            entities::cluster_with(
                cluster,
                entries.get(&cluster.id),
                state.visible.as_deref() == Some(cluster.id.as_str()),
                &self.inner.labels,
                state.icon_cleared.contains(&cluster.id),
            )
        });
        state
            .weblinks
            .iter()
            .cloned()
            .chain(entities::general_pages())
            .chain(clusters)
            .filter(listed)
            .collect()
    }

    /// Raised on every change of the entities.
    pub fn version(&self) -> u64 {
        self.state().version
    }

    /// Calls `listener` after every change of a cluster, outside the lock.
    pub fn subscribe(&self, listener: impl Fn(&CatalogEvent) + Send + Sync + 'static) {
        self.inner
            .cluster_listeners
            .lock()
            .expect("the listeners lock")
            .push(Arc::new(listener));
    }

    /// Calls `listener` after every change of the entities, outside the lock.
    pub fn on_change(&self, listener: impl Fn() + Send + Sync + 'static) {
        self.inner
            .change_listeners
            .lock()
            .expect("the listeners lock")
            .push(Arc::new(listener));
    }

    /// Resolves once every sync has had its first scan.
    pub async fn scanned(&self) {
        let mut scanned = self.inner.scanned.subscribe();
        // The sender lives as long as the catalog, so waiting cannot fail.
        let _ = scanned.wait_for(|done| *done).await;
    }

    /// The file of `--kubeconfig` and what its last read found.
    pub fn launch_file(&self) -> Option<LaunchFile> {
        self.state().launch_file.clone()
    }

    /// Replaces the web link entities.
    pub fn set_weblinks(&self, weblinks: Vec<Value>) {
        let changed = {
            let mut state = self.state();
            let changed = state.weblinks != weblinks;
            if changed {
                state.weblinks = weblinks;
                state.version += 1;
            }
            changed
        };
        if changed {
            self.changed(&[]);
        }
    }

    /// Records the result of a web link's check.
    pub fn set_weblink_phase(&self, id: &str, phase: &str) {
        let changed = {
            let mut state = self.state();
            state.phases.insert(id.to_string(), phase.to_string()) != Some(phase.to_string())
        };
        if changed {
            self.refresh_weblinks();
        }
    }

    /// Calls `listener` after each change of the web link store.
    pub fn on_weblinks_change(&self, listener: impl Fn() + Send + Sync + 'static) {
        self.inner
            .weblink_listeners
            .lock()
            .expect("the listeners lock")
            .push(Arc::new(listener));
    }

    /// The entries `{ id, name, url }` of the web link store now.
    pub fn weblink_entries(&self) -> Vec<Value> {
        self.inner
            .stores
            .as_ref()
            .map(|stores| stores.model(StoreName::Weblink))
            .and_then(|model| model.get("weblinks").and_then(Value::as_array).cloned())
            .unwrap_or_default()
    }

    fn refresh_weblinks(&self) {
        if self.inner.stores.is_none() {
            return;
        }
        let entries = self.weblink_entries();
        let weblinks = {
            let mut state = self.state();
            // A link that leaves forgets its phase: back, it starts available.
            let ids: HashSet<&str> = entries
                .iter()
                .filter_map(|entry| entry.get("id").and_then(Value::as_str))
                .collect();
            state.phases.retain(|id, _| ids.contains(id.as_str()));
            entries
                .iter()
                .map(|entry| {
                    let id = entry.get("id").and_then(Value::as_str).unwrap_or_default();
                    let phase = state.phases.get(id).map_or("available", String::as_str);
                    entities::weblink(entry, phase)
                })
                .collect()
        };
        self.set_weblinks(weblinks);
    }

    /// Replaces the clusters, in catalog order. A cluster whose id is in
    /// `reread` had its file read again, and is reported as changed even when
    /// its source stayed the same.
    pub fn set_clusters(&self, clusters: Vec<ClusterSource>, reread: &HashSet<String>) {
        let events = {
            let mut state = self.state();
            let mut events = Vec::new();
            for old in &state.clusters {
                if !clusters.iter().any(|new| new.id == old.id) {
                    events.push(CatalogEvent::ClusterRemoved(old.id.clone()));
                }
            }
            let kept: HashSet<String> = clusters.iter().map(|c| c.id.clone()).collect();
            state.icon_cleared.retain(|id| kept.contains(id));
            for new in &clusters {
                let same = state.clusters.iter().any(|old| old == new);
                if !same || reread.contains(&new.id) {
                    events.push(CatalogEvent::ClusterChanged(new.id.clone()));
                }
            }
            let reordered = state.clusters != clusters;
            if events.is_empty() && !reordered {
                return;
            }
            state.clusters = clusters;
            state.version += 1;
            events
        };
        self.changed(&events);
        self.ensure_entries();
    }

    /// Names the visible cluster, whose entity is marked active.
    pub fn set_visible(&self, visible: Option<String>) {
        {
            let mut state = self.state();
            if state.visible == visible {
                return;
            }
            state.visible = visible;
            state.version += 1;
        }
        self.changed(&[]);
    }

    /// Ends the first scan of every sync.
    pub fn set_scanned(&self) {
        self.inner.scanned.send_replace(true);
    }

    /// The valid entries of the cluster store, by id.
    fn store_entries(&self) -> HashMap<String, Map<String, Value>> {
        let Some(stores) = &self.inner.stores else {
            return HashMap::new();
        };
        let model = stores.model(StoreName::Cluster);
        model
            .get("clusters")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_object)
            .filter(|entry| crate::stores::cluster::is_valid(entry))
            .filter_map(|entry| {
                let id = entry.get("id")?.as_str()?.to_string();
                Some((id, entry.clone()))
            })
            .fold(HashMap::new(), |mut entries, (id, entry)| {
                entries.entry(id).or_insert(entry);
                entries
            })
    }

    /// What the cluster manager does with the store for the clusters of the
    /// catalog: adds an entry for a context that has none, and clears a
    /// `null` icon and short name, in one update (research R6).
    fn ensure_entries(&self) {
        let Some(stores) = &self.inner.stores else {
            return;
        };
        let clusters = self.clusters();
        let model = stores.model(StoreName::Cluster);
        let mut list: Vec<Value> = model
            .get("clusters")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let entries = self.store_entries();
        let mut changed = false;
        for item in &mut list {
            let Some(entry) = item.as_object() else {
                continue;
            };
            let in_catalog = entry
                .get("id")
                .and_then(Value::as_str)
                .is_some_and(|id| clusters.iter().any(|cluster| cluster.id == id));
            if in_catalog
                && crate::stores::cluster::is_valid(entry)
                && let Some(cleared) = entities::cleared(entry)
            {
                let icon_was_null = entry
                    .get("preferences")
                    .and_then(|preferences| preferences.get("icon"))
                    == Some(&Value::Null);
                if icon_was_null && let Some(id) = entry.get("id").and_then(Value::as_str) {
                    self.state().icon_cleared.insert(id.to_string());
                }
                *item = Value::Object(cleared);
                changed = true;
            }
        }
        for cluster in &clusters {
            if !entries.contains_key(&cluster.id) {
                list.push(entities::new_entry(cluster));
                changed = true;
            }
        }
        if changed {
            let mut model = model.as_object().cloned().unwrap_or_default();
            model.insert("clusters".into(), Value::Array(list));
            stores.update(StoreName::Cluster, Value::Object(model));
        }
    }

    fn bump(&self) {
        self.state().version += 1;
        self.changed(&[]);
    }

    fn changed(&self, events: &[CatalogEvent]) {
        let cluster_listeners = self
            .inner
            .cluster_listeners
            .lock()
            .expect("the listeners lock")
            .clone();
        for event in events {
            for listener in &cluster_listeners {
                listener(event);
            }
        }
        let change_listeners = self
            .inner
            .change_listeners
            .lock()
            .expect("the listeners lock")
            .clone();
        for listener in &change_listeners {
            listener();
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.inner.state.lock().expect("the catalog lock")
    }
}

/// Whether the Electron build's main side lists `entity`: the group
/// `entity.k8slens.dev` with one of the three built-in kinds, whatever the
/// version (`common/catalog/category-registry.ts`).
pub fn listed(entity: &Value) -> bool {
    let group = entity
        .get("apiVersion")
        .and_then(Value::as_str)
        .and_then(|api_version| api_version.split('/').next());
    let kind = entity.get("kind").and_then(Value::as_str);
    group == Some("entity.k8slens.dev")
        && matches!(kind, Some("General" | "KubernetesCluster" | "WebLink"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures")
            .join(name)
    }

    fn source(id: &str, context: &str) -> ClusterSource {
        ClusterSource {
            id: id.to_string(),
            context_name: context.to_string(),
            kubeconfig_path: PathBuf::from("/kube/config"),
        }
    }

    fn weblink(uid: &str) -> Value {
        json!({
            "metadata": { "uid": uid, "name": uid, "source": "local", "labels": {} },
            "status": { "phase": "available", "active": true },
            "spec": { "url": "https://example.invalid" },
            "apiVersion": "entity.k8slens.dev/v1alpha1",
            "kind": "WebLink",
        })
    }

    fn uids(catalog: &Catalog) -> Vec<String> {
        catalog
            .entities()
            .iter()
            .map(|entity| entity["metadata"]["uid"].as_str().unwrap().to_string())
            .collect()
    }

    fn recording(catalog: &Catalog) -> Arc<Mutex<Vec<CatalogEvent>>> {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&events);
        catalog.subscribe(move |event| sink.lock().unwrap().push(event.clone()));
        events
    }

    #[test]
    fn lists_web_links_then_general_pages_then_clusters() {
        let catalog = Catalog::empty();
        catalog.set_clusters(
            vec![source("c1", "one"), source("c2", "two")],
            &HashSet::new(),
        );
        catalog.set_weblinks(vec![weblink("w1"), weblink("w2")]);
        assert_eq!(
            uids(&catalog),
            [
                "w1",
                "w2",
                "catalog-entity",
                "terminal-page-entity",
                "welcome-page-entity",
                "preferences-entity",
                "c1",
                "c2",
            ]
        );
    }

    #[test]
    fn an_id_of_two_sources_is_listed_by_each_as_the_registry_lists_it() {
        let catalog = Catalog::empty();
        catalog.set_weblinks(vec![weblink("same")]);
        catalog.set_clusters(vec![source("same", "one")], &HashSet::new());
        let same = uids(&catalog).iter().filter(|uid| *uid == "same").count();
        assert_eq!(same, 2);
    }

    #[test]
    fn leaves_out_an_entity_of_another_group_or_kind_whatever_the_version() {
        let mut other_group = weblink("g");
        other_group["apiVersion"] = json!("example.com/v1alpha1");
        let mut other_kind = weblink("k");
        other_kind["kind"] = json!("Other");
        let mut other_version = weblink("v");
        other_version["apiVersion"] = json!("entity.k8slens.dev/v1");
        assert!(!listed(&other_group));
        assert!(!listed(&other_kind));
        assert!(listed(&other_version));
        let catalog = Catalog::empty();
        catalog.set_weblinks(vec![other_group, other_kind, other_version]);
        let uids = uids(&catalog);
        assert!(!uids.contains(&"g".to_string()));
        assert!(!uids.contains(&"k".to_string()));
        assert!(uids.contains(&"v".to_string()));
    }

    #[test]
    fn answers_for_known_unknown_and_empty_ids() {
        let catalog = Catalog::empty();
        catalog.set_clusters(vec![source("c1", "one")], &HashSet::new());
        assert!(catalog.has_cluster("c1"));
        assert_eq!(catalog.cluster("c1"), Some(source("c1", "one")));
        assert!(!catalog.has_cluster("c2"));
        assert_eq!(catalog.cluster("c2"), None);
        assert!(!catalog.has_cluster(""));
        assert_eq!(catalog.cluster(""), None);
    }

    #[test]
    fn reports_added_changed_reread_and_removed_clusters() {
        let catalog = Catalog::empty();
        let events = recording(&catalog);
        catalog.set_clusters(
            vec![source("c1", "one"), source("c2", "two")],
            &HashSet::new(),
        );
        let mut moved = source("c2", "two");
        moved.kubeconfig_path = PathBuf::from("/other");
        catalog.set_clusters(
            vec![source("c1", "one"), moved.clone()],
            &HashSet::from(["c1".to_string()]),
        );
        catalog.set_clusters(vec![moved], &HashSet::new());
        assert_eq!(
            *events.lock().unwrap(),
            [
                CatalogEvent::ClusterChanged("c1".into()),
                CatalogEvent::ClusterChanged("c2".into()),
                CatalogEvent::ClusterChanged("c1".into()),
                CatalogEvent::ClusterChanged("c2".into()),
                CatalogEvent::ClusterRemoved("c1".into()),
            ]
        );
    }

    #[test]
    fn listeners_are_called_outside_the_lock() {
        let catalog = Catalog::empty();
        let reading = catalog.clone();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&seen);
        catalog.subscribe(move |_| sink.lock().unwrap().push(reading.cluster_ids()));
        catalog.set_clusters(vec![source("c1", "one")], &HashSet::new());
        assert_eq!(*seen.lock().unwrap(), [vec!["c1".to_string()]]);
    }

    #[test]
    fn the_version_rises_on_every_change_and_only_then() {
        let catalog = Catalog::empty();
        let start = catalog.version();
        catalog.set_clusters(vec![source("c1", "one")], &HashSet::new());
        let after_clusters = catalog.version();
        assert!(after_clusters > start);
        catalog.set_clusters(vec![source("c1", "one")], &HashSet::new());
        assert_eq!(catalog.version(), after_clusters);
        catalog.set_visible(Some("c1".into()));
        assert!(catalog.version() > after_clusters);
        let after_visible = catalog.version();
        catalog.set_visible(Some("c1".into()));
        assert_eq!(catalog.version(), after_visible);
        catalog.set_weblinks(vec![weblink("w1")]);
        assert!(catalog.version() > after_visible);
    }

    #[test]
    fn the_visible_cluster_is_marked_active() {
        let catalog = Catalog::empty();
        catalog.set_clusters(
            vec![source("c1", "one"), source("c2", "two")],
            &HashSet::new(),
        );
        catalog.set_visible(Some("c2".into()));
        let active: Vec<bool> = catalog
            .entities()
            .iter()
            .filter(|entity| entity["kind"] == "KubernetesCluster")
            .map(|entity| entity["status"]["active"].as_bool().unwrap())
            .collect();
        assert_eq!(active, [false, true]);
    }

    #[tokio::test]
    async fn scanned_resolves_once_the_scan_is_done() {
        let catalog = Catalog::empty();
        catalog.inner.scanned.send_replace(false);
        let waiting = catalog.clone();
        let task = tokio::spawn(async move { waiting.scanned().await });
        tokio::task::yield_now().await;
        assert!(!task.is_finished());
        catalog.set_scanned();
        task.await.unwrap();
    }

    #[test]
    fn a_kubeconfig_file_gives_one_cluster_per_context() {
        let catalog = Catalog::from_kubeconfig_file(&fixture("three-contexts.yaml"));
        let names: Vec<String> = catalog
            .clusters()
            .into_iter()
            .map(|cluster| cluster.context_name)
            .collect();
        assert_eq!(names, ["context-a", "context-b", "context-c"]);
        assert_eq!(
            catalog.launch_file(),
            Some(LaunchFile {
                path: fixture("three-contexts.yaml"),
                state: LaunchFileState::Read,
            })
        );
        for cluster in catalog.clusters() {
            assert_eq!(cluster.id.len(), 32);
            assert_eq!(cluster.kubeconfig_path, fixture("three-contexts.yaml"));
        }
    }

    #[test]
    fn a_file_without_contexts_is_read_and_empty() {
        let catalog = Catalog::from_kubeconfig_file(&fixture("no-contexts.yaml"));
        assert!(catalog.clusters().is_empty());
        assert_eq!(catalog.launch_file().unwrap().state, LaunchFileState::Read);
    }

    #[test]
    fn an_invalid_or_missing_chosen_file_says_so() {
        let invalid = Catalog::from_kubeconfig_file(&fixture("invalid.yaml"));
        assert!(invalid.clusters().is_empty());
        assert_eq!(
            invalid.launch_file().unwrap().state,
            LaunchFileState::Invalid
        );
        let missing = Catalog::from_kubeconfig_file(Path::new("/no/such/file"));
        assert_eq!(
            missing.launch_file().unwrap().state,
            LaunchFileState::Missing
        );
    }
}
