/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The channels of main-catalog
//! (`specs/008-main-catalog/contracts/catalog-channels.md`).

use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::Value;
use tokio::sync::mpsc;
use tokio::time::Instant;

use serde_json::{Map, json};

use super::{Catalog, CatalogLog, kubeconfig};
use crate::frames::{FrameEvent, Frames};
use crate::messaging::{
    ChannelError, Channels, DuplicateChannel, MessageChannel, Optional, QueueEvent, RequestChannel,
    Sender,
};

pub const CATALOG_INIT: MessageChannel<()> = MessageChannel::new("catalog:init");
pub const CATALOG_ITEMS: MessageChannel<Vec<Value>> = MessageChannel::new("catalog:items");
pub const CLUSTER_VISIBILITY: MessageChannel<Option<String>> =
    MessageChannel::new("cluster-visibility");

pub const GET_ALL_CLUSTERS: RequestChannel<(), Vec<Value>> =
    RequestChannel::new("get-all-clusters");
pub const GET_CLUSTER_BY_ID: RequestChannel<Value, Optional> =
    RequestChannel::new("get-cluster-by-id");
pub const DISCOVER_KUBECONFIG_SYNC_KIND: RequestChannel<String, Value> =
    RequestChannel::new("discover-kubeconfig-sync-kind");
pub const PARSE_KUBECONFIG_TEXT: RequestChannel<String, Value> =
    RequestChannel::new("parse-kubeconfig-text");
pub const ADD_KUBECONFIG_TEXT: RequestChannel<String, Value> =
    RequestChannel::new("add-kubeconfig-text");

/// The time the Electron build's broadcaster waits for a quiet catalog.
pub const QUIET: Duration = Duration::from_millis(100);

/// `debounce(…, 100, { leading: true, trailing: true })` of `es-toolkit`: a
/// poke while no timer runs sends at once; every poke restarts the timer; when
/// it ends, the catalog is sent again if a poke came after the first send.
#[derive(Clone)]
pub struct Broadcaster {
    pokes: mpsc::UnboundedSender<()>,
}

impl Broadcaster {
    pub fn poke(&self) {
        // The task ends only with the process.
        let _ = self.pokes.send(());
    }
}

fn spawn_broadcaster(send: impl Fn() + Send + Sync + 'static) -> Broadcaster {
    let (pokes, mut received) = mpsc::unbounded_channel::<()>();
    let task = async move {
        while received.recv().await.is_some() {
            send();
            let mut deadline = Instant::now() + QUIET;
            let mut pending = false;
            loop {
                tokio::select! {
                    poke = received.recv() => match poke {
                        Some(()) => {
                            pending = true;
                            deadline = Instant::now() + QUIET;
                        }
                        None => return,
                    },
                    () = tokio::time::sleep_until(deadline) => {
                        if pending {
                            send();
                        }
                        break;
                    }
                }
            }
        }
    };
    match tokio::runtime::Handle::try_current() {
        Ok(handle) => {
            handle.spawn(task);
        }
        Err(_) => {
            tauri::async_runtime::spawn(task);
        }
    }
    Broadcaster { pokes }
}

/// Registers `catalog:init`, `catalog:items` and `cluster-visibility`, and
/// sends the catalog on every change of it and whenever a cluster frame
/// records its frame id, as `set-frame-id-listener.injectable.ts` does
/// (research R7).
pub fn register(
    channels: &mut Channels,
    catalog: &Catalog,
    frames: &Frames,
    log: CatalogLog,
) -> Result<Broadcaster, DuplicateChannel> {
    let log_fallback = log.clone();
    let sender: Sender = channels.sender();
    let sending = catalog.clone();
    let dump = Arc::new(Mutex::new(()));
    let broadcaster = spawn_broadcaster(move || {
        let entities = sending.entities();
        sender.send(CATALOG_ITEMS, &entities);
        log.info(&format!("sent {} entities", entities.len()));
        if let Some(path) = sending.dump_path() {
            let _guard = dump.lock().expect("the dump lock");
            let mut line = Value::Array(entities).to_string();
            line.push('\n');
            let written = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&path)
                .and_then(|mut file| std::io::Write::write_all(&mut file, line.as_bytes()));
            if let Err(error) = written {
                log.warn(&format!("cannot write {}: {error}", path.display()));
            }
        }
    });

    // The view that asks gets the catalog at once, which it has none of yet;
    // every view gets it through the coalescing, as in the Electron build
    // (research R7).
    let initializing = broadcaster.clone();
    let answering = catalog.clone();
    let direct = channels.sender();
    let direct_log = log_fallback.clone();
    channels.listen(CATALOG_INIT, move |(), view| {
        let entities = answering.entities();
        direct.send_to(&view, CATALOG_ITEMS, &entities);
        direct_log.info(&format!("sent {} entities to {view}", entities.len()));
        initializing.poke();
    });

    // A view whose queue closed while it stayed open, a page WebKit suspended
    // for a minute, lost what was sent meanwhile; it gets the catalog again
    // when it polls again (research R7). A reloaded page asks with
    // `catalog:init` itself.
    let resending = catalog.clone();
    let resend = channels.sender();
    let resend_log = log_fallback.clone();
    channels.sender().on_queue_event(move |event| {
        if let QueueEvent::Reopened(view) = event {
            let entities = resending.entities();
            resend.send_to(view, CATALOG_ITEMS, &entities);
            resend_log.info(&format!("sent {} entities to {view}", entities.len()));
        }
    });

    let naming = catalog.clone();
    channels.listen(CLUSTER_VISIBILITY, move |cluster: Option<String>, _| {
        naming.set_visible(cluster);
    });

    // A change that leaves the entities as they were sends nothing, so that a
    // write of the store that changes nothing does not hold back a send.
    let changing = broadcaster.clone();
    let comparing = catalog.clone();
    let last: Mutex<Option<String>> = Mutex::new(None);
    catalog.on_change(move || {
        let now = Value::Array(comparing.entities()).to_string();
        let mut last = last.lock().expect("the last catalog lock");
        if last.as_deref() != Some(now.as_str()) {
            *last = Some(now);
            changing.poke();
        }
    });

    let enumerating = catalog.clone();
    channels.answer(GET_ALL_CLUSTERS, move |(), _| {
        let clusters = cluster_infos(&enumerating.entities());
        async move { Ok(clusters) }
    })?;
    let finding = catalog.clone();
    channels.answer(GET_CLUSTER_BY_ID, move |id: Value, _| {
        let found = id.as_str().filter(|id| !id.is_empty()).and_then(|id| {
            cluster_infos(&finding.entities())
                .into_iter()
                .find(|info| info["id"] == id)
        });
        async move { Ok(Optional(found)) }
    })?;
    let discovering = catalog.log().unwrap_or_else(|| log_fallback.clone());
    channels.answer(DISCOVER_KUBECONFIG_SYNC_KIND, move |path: String, _| {
        let answer = sync_kind(&path, &discovering);
        async move { Ok(answer) }
    })?;
    channels.answer(PARSE_KUBECONFIG_TEXT, move |text: String, _| {
        let answer = kubeconfig::check_text(&text);
        async move { Ok(answer) }
    })?;
    let adding = catalog.clone();
    channels.answer(ADD_KUBECONFIG_TEXT, move |text: String, _| {
        let result = add_text(adding.app_dir(), &text);
        async move { result.map_err(ChannelError::from) }
    })?;

    let announcing = broadcaster.clone();
    frames.subscribe(move |event| {
        if let FrameEvent::Announced(_) = event {
            announcing.poke();
        }
    });

    Ok(broadcaster)
}

/// `mapClusterToClusterInfo` of `features/cluster/enumeration/common/cluster-mapping.ts`
/// for each cluster entity, with `isActive` false, as the Electron build's main
/// side tracks no active cluster for the enumeration.
pub fn cluster_infos(entities: &[Value]) -> Vec<Value> {
    entities
        .iter()
        .filter(|entity| entity["kind"] == "KubernetesCluster")
        .map(|entity| {
            let metadata = &entity["metadata"];
            let spec = &entity["spec"];
            let status = match entity["status"]["phase"].as_str() {
                Some("connected") => "connected",
                Some("connecting") => "connecting",
                Some("deleting") => "disconnecting",
                _ => "disconnected",
            };
            let labels: Map<String, Value> = metadata["labels"]
                .as_object()
                .map(|labels| {
                    labels
                        .iter()
                        .filter(|(_, value)| !value.is_null())
                        .map(|(key, value)| (key.clone(), value.clone()))
                        .collect()
                })
                .unwrap_or_default();
            let mut info_metadata = Map::new();
            for (key, from) in [
                ("distribution", "distro"),
                ("kubernetesVersion", "kubeVersion"),
            ] {
                if let Some(value) = metadata.get(from) {
                    info_metadata.insert(key.into(), value.clone());
                }
            }
            json!({
                "id": metadata["uid"],
                "name": metadata["name"],
                "kubeConfigPath": spec["kubeconfigPath"],
                "contextName": spec["kubeconfigContext"],
                "status": status,
                "labels": labels,
                "isActive": false,
                "metadata": info_metadata,
            })
        })
        .collect()
}

/// `discover-kubeconfig-sync-kind`: a stat that follows symbolic links, and
/// reads nothing of the contents.
pub fn sync_kind(path: &str, log: &CatalogLog) -> Value {
    match std::fs::metadata(path) {
        Ok(meta) if meta.is_file() => json!({ "kind": "file" }),
        Ok(meta) if meta.is_dir() => json!({ "kind": "dir" }),
        Ok(_) => {
            log.warn("unknown stat entry");
            json!({ "error": "unknown stat entry" })
        }
        Err(error) => {
            let text = node_stat_error(&error, path);
            log.warn(&format!("failed to stat entry: {text}"));
            json!({ "error": text })
        }
    }
}

/// `String(error)` of a failed `fs.stat` in Node: `Error: <CODE>: <message>,
/// stat '<path>'`, with libuv's messages.
pub fn node_stat_error(error: &std::io::Error, path: &str) -> String {
    let known = match error.raw_os_error() {
        Some(libc::ENOENT) => Some(("ENOENT", "no such file or directory")),
        Some(libc::EACCES) => Some(("EACCES", "permission denied")),
        Some(libc::ENOTDIR) => Some(("ENOTDIR", "not a directory")),
        Some(libc::ELOOP) => Some(("ELOOP", "too many symbolic links encountered")),
        Some(libc::ENAMETOOLONG) => Some(("ENAMETOOLONG", "name too long")),
        Some(libc::EIO) => Some(("EIO", "i/o error")),
        _ => None,
    };
    match known {
        Some((code, message)) => format!("Error: {code}: {message}, stat '{path}'"),
        None => format!(
            "Error: errno {}, stat '{path}'",
            error.raw_os_error().unwrap_or_default()
        ),
    }
}

/// `add-kubeconfig-text`: the trimmed text in a new file of the application's
/// kubeconfig directory, readable and writable by the user alone.
pub fn add_text(directory: &std::path::Path, text: &str) -> Result<Value, String> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;

    std::fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let file = directory.join(uuid::Uuid::new_v4().to_string());
    std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&file)
        .and_then(|mut written| written.write_all(text.trim().as_bytes()))
        .map_err(|error| error.to_string())?;
    let added: Vec<Value> = kubeconfig::check_text(text)["contexts"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|context| context["name"].clone())
        .collect();
    Ok(json!({ "added": added }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cluster(phase: &str, labels: Value, metadata: Value) -> Value {
        let mut entity_metadata = json!({ "uid": "c1", "name": "One", "labels": labels });
        for (key, value) in metadata.as_object().unwrap() {
            entity_metadata[key] = value.clone();
        }
        json!({
            "metadata": entity_metadata,
            "status": { "phase": phase },
            "spec": { "kubeconfigPath": "/k", "kubeconfigContext": "ctx" },
            "kind": "KubernetesCluster",
        })
    }

    #[test]
    fn cluster_info_has_the_fields_of_the_electron_build() {
        let entity = cluster(
            "disconnected",
            json!({ "env": "dev" }),
            json!({ "distro": "kind", "kubeVersion": "v1.34.0" }),
        );
        assert_eq!(
            cluster_infos(&[entity]),
            [json!({
                "id": "c1",
                "name": "One",
                "kubeConfigPath": "/k",
                "contextName": "ctx",
                "status": "disconnected",
                "labels": { "env": "dev" },
                "isActive": false,
                "metadata": { "distribution": "kind", "kubernetesVersion": "v1.34.0" },
            })]
        );
    }

    #[test]
    fn every_phase_maps_as_the_electron_build_maps_it() {
        for (phase, status) in [
            ("connected", "connected"),
            ("connecting", "connecting"),
            ("disconnected", "disconnected"),
            ("deleting", "disconnecting"),
            ("custom", "disconnected"),
        ] {
            let info = &cluster_infos(&[cluster(phase, json!({}), json!({}))])[0];
            assert_eq!(info["status"], status, "for {phase}");
        }
    }

    #[test]
    fn a_label_without_a_value_and_missing_metadata_are_left_out() {
        let info = &cluster_infos(&[cluster(
            "disconnected",
            json!({ "a": "x", "b": null }),
            json!({}),
        )])[0];
        assert_eq!(info["labels"], json!({ "a": "x" }));
        assert_eq!(info["metadata"], json!({}));
    }

    #[test]
    fn only_clusters_are_enumerated() {
        let weblink = json!({ "kind": "WebLink", "metadata": { "uid": "w" } });
        let general = json!({ "kind": "General", "metadata": { "uid": "g" } });
        assert!(cluster_infos(&[weblink, general]).is_empty());
    }

    #[test]
    fn stat_errors_read_as_node_writes_them() {
        let missing = std::fs::metadata("/no/such/path").unwrap_err();
        assert_eq!(
            node_stat_error(&missing, "/no/such/path"),
            "Error: ENOENT: no such file or directory, stat '/no/such/path'"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn coalesces_as_the_electron_build_s_broadcaster() {
        let sent = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&sent);
        let start = Instant::now();
        let broadcaster = spawn_broadcaster(move || {
            sink.lock().unwrap().push(start.elapsed().as_millis());
        });
        let settle = || tokio::time::sleep(Duration::from_millis(1));

        // A poke while no timer runs is sent at once.
        broadcaster.poke();
        settle().await;
        assert_eq!(*sent.lock().unwrap(), [0]);

        // Nothing more when nothing changed after the first send.
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert_eq!(sent.lock().unwrap().len(), 1);

        // Three pokes 50 ms apart: the first at once, the rest once, 100 ms
        // after the last.
        sent.lock().unwrap().clear();
        let base = start.elapsed().as_millis();
        broadcaster.poke();
        for _ in 0..2 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            broadcaster.poke();
        }
        tokio::time::sleep(Duration::from_millis(150)).await;
        let times: Vec<u128> = sent.lock().unwrap().iter().map(|t| t - base).collect();
        assert_eq!(times.len(), 2, "{times:?}");
        assert!(times[0] <= 1, "{times:?}");
        assert!((200..=202).contains(&times[1]), "{times:?}");
    }
}
