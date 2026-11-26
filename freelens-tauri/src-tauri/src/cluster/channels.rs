/*
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

//! The channels of main-cluster-connection
//! (`specs/009-main-cluster-connection/contracts/cluster-channels.md`).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::execute::{self, Request as ExecuteRequest, Response as ExecuteResponse};
use super::kubeconfig_edit::{self, Summary};
use super::{ClusterState, Clusters};
use crate::frames::Frames;
use crate::messaging::{
    ChannelError, Channels, DuplicateChannel, MessageChannel, RequestChannel, View,
};

/// `{ clusterId, force? }` of `activate-cluster`.
#[derive(Debug, Clone, Deserialize)]
pub struct Activate {
    #[serde(rename = "clusterId")]
    pub cluster_id: String,
    #[serde(default)]
    pub force: bool,
}

/// `{ clusterId, state }` of `cluster-state-sync`.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct StateSync {
    #[serde(rename = "clusterId")]
    pub cluster_id: String,
    pub state: ClusterState,
}

/// `activateClusterChannel` of `features/cluster/activation/common/channels.ts`.
pub const ACTIVATE: RequestChannel<Activate, ()> = RequestChannel::new("activate-cluster");
/// `clusterStateSyncChannel` of `features/cluster/state-sync/common/channels.ts`.
pub const CLUSTER_STATE_SYNC: MessageChannel<StateSync> = MessageChannel::new("cluster-state-sync");
/// `initialClusterStatesChannel` of the same file.
pub const INITIAL_STATES: RequestChannel<(), Vec<StateSync>> =
    RequestChannel::new("initial-cluster-state-sync");
/// `refreshClusterAccessibilityChannel` of `common/ipc/cluster.ts`.
pub const REFRESH_ACCESSIBILITY: RequestChannel<String, bool> =
    RequestChannel::new("cluster:refresh-accessibility");
/// `clusterListNamespaceForbiddenChannel` of `common/ipc/cluster.ts`.
pub const LIST_NAMESPACE_FORBIDDEN: MessageChannel<String> =
    MessageChannel::new("cluster:list-namespace-forbidden");
/// The network events the root frame sends (`main/cluster/manager.ts`).
pub const NETWORK_OFFLINE: MessageChannel<()> = MessageChannel::new("network:offline");
pub const NETWORK_ONLINE: MessageChannel<()> = MessageChannel::new("network:online");

/// `{ clusterId, newCurrentContext? }` of `remove-cluster-context-from-kubeconfig`.
#[derive(Debug, Clone, Deserialize)]
pub struct RemoveContext {
    #[serde(rename = "clusterId")]
    pub cluster_id: String,
    #[serde(rename = "newCurrentContext", default)]
    pub new_current_context: Option<String>,
}

/// `deactivateClusterChannel` of `features/cluster/activation/common/channels.ts`.
pub const DEACTIVATE: RequestChannel<String, ()> = RequestChannel::new("deactivate-cluster");
/// The channels of `features/cluster/delete-dialog/common/`.
pub const SET_DELETING: RequestChannel<String, ()> = RequestChannel::new("set-cluster-as-deleting");
pub const CLEAR_DELETING: RequestChannel<String, ()> =
    RequestChannel::new("clear-cluster-as-deleting");
pub const DELETE: RequestChannel<String, ()> = RequestChannel::new("delete-cluster");
pub const KUBECONFIG_CONTEXTS: RequestChannel<String, Summary> =
    RequestChannel::new("cluster-kubeconfig-contexts");
pub const REMOVE_CONTEXT: RequestChannel<RemoveContext, ()> =
    RequestChannel::new("remove-cluster-context-from-kubeconfig");
/// `executeOnClusterChannel` of `features/cluster/execute/common/channels.ts`.
pub const EXECUTE: RequestChannel<ExecuteRequest, ExecuteResponse> =
    RequestChannel::new("execute-on-cluster");

/// The frame rule (FR-026): a cluster frame names only its own cluster; the
/// main window names any. A refusal changes nothing and is logged.
fn own(clusters: &Clusters, channel: &str, view: &View, id: &str) -> Result<(), ChannelError> {
    match view {
        View::Cluster(own) if own != id => {
            clusters.log(&format!(
                "[CLUSTER]: refused {channel} from {view} for cluster {id}"
            ));
            Err(ChannelError::from(format!(
                "{channel} is answered only for the sending frame's own cluster"
            )))
        }
        _ => Ok(()),
    }
}

/// Registers the channels of the connection; `version` is the application's.
pub fn register(
    channels: &mut Channels,
    clusters: &Clusters,
    frames: &Frames,
    data_dir: &Path,
    version: &str,
) -> Result<(), DuplicateChannel> {
    let activating = clusters.clone();
    channels.answer(ACTIVATE, move |request: Activate, view| {
        let clusters = activating.clone();
        let allowed = own(&clusters, ACTIVATE.id(), &view, &request.cluster_id);
        async move {
            allowed?;
            // An unknown id resolves with nothing done.
            if let Some(connection) = clusters.connection(&request.cluster_id) {
                connection.activate(request.force).await;
            }
            Ok(())
        }
    })?;

    let initial = clusters.clone();
    channels.answer(INITIAL_STATES, move |(), _| {
        let states = initial
            .states()
            .into_iter()
            .map(|(cluster_id, state)| StateSync { cluster_id, state })
            .collect();
        async move { Ok(states) }
    })?;

    let refreshing = clusters.clone();
    channels.answer(REFRESH_ACCESSIBILITY, move |id: String, view| {
        let clusters = refreshing.clone();
        let allowed = own(&clusters, REFRESH_ACCESSIBILITY.id(), &view, &id);
        async move {
            allowed?;
            if let Some(connection) = clusters.connection(&id) {
                connection.refresh_accessibility_and_metadata().await;
            }
            Ok(true)
        }
    })?;

    let offline = clusters.clone();
    channels.listen(NETWORK_OFFLINE, move |(), _| {
        offline.log("[CLUSTER-MANAGER]: network is offline");
        for connection in offline.connections() {
            tokio::spawn(async move { connection.network_offline().await });
        }
    });
    let online = clusters.clone();
    channels.listen(NETWORK_ONLINE, move |(), _| {
        online.log("[CLUSTER-MANAGER]: network is online");
        for connection in online.connections() {
            tokio::spawn(async move { connection.network_online().await });
        }
    });

    let deactivating = (clusters.clone(), frames.clone());
    channels.answer(DEACTIVATE, move |id: String, view| {
        let allowed = own(&deactivating.0, DEACTIVATE.id(), &view, &id);
        if allowed.is_ok() {
            deactivating.0.deactivate(&id, &deactivating.1);
        }
        async { allowed }
    })?;
    let marking = clusters.clone();
    channels.answer(SET_DELETING, move |id: String, view| {
        let allowed = own(&marking, SET_DELETING.id(), &view, &id);
        if allowed.is_ok() {
            marking.set_deleting(&id, true);
        }
        async { allowed }
    })?;
    let clearing = clusters.clone();
    channels.answer(CLEAR_DELETING, move |id: String, view| {
        let allowed = own(&clearing, CLEAR_DELETING.id(), &view, &id);
        if allowed.is_ok() {
            clearing.set_deleting(&id, false);
        }
        async { allowed }
    })?;
    let deleting = (clusters.clone(), frames.clone(), data_dir.to_path_buf());
    channels.answer(DELETE, move |id: String, view| {
        let allowed = own(&deleting.0, DELETE.id(), &view, &id);
        if allowed.is_ok() {
            deleting.0.delete(&id, &deleting.1, &deleting.2);
        }
        async { allowed }
    })?;

    let reading = clusters.clone();
    channels.answer(KUBECONFIG_CONTEXTS, move |id: String, view| {
        let allowed = own(&reading, KUBECONFIG_CONTEXTS.id(), &view, &id);
        let file = reading.kubeconfig_of(&id);
        async move {
            allowed?;
            let (path, context): (PathBuf, String) = file?;
            let summary =
                tokio::task::spawn_blocking(move || kubeconfig_edit::contexts(&path, &context))
                    .await?;
            Ok(summary?)
        }
    })?;
    let editing = clusters.clone();
    channels.answer(REMOVE_CONTEXT, move |request: RemoveContext, view| {
        let allowed = own(&editing, REMOVE_CONTEXT.id(), &view, &request.cluster_id);
        let file = editing.kubeconfig_of(&request.cluster_id);
        async move {
            allowed?;
            let (path, context) = file?;
            kubeconfig_edit::remove_context(
                &path,
                &context,
                request.new_current_context.as_deref(),
            )
            .await?;
            Ok(())
        }
    })?;

    let executing = (clusters.clone(), version.to_string());
    channels.answer(EXECUTE, move |request: ExecuteRequest, view| {
        let (clusters, version) = executing.clone();
        let allowed = own(&clusters, EXECUTE.id(), &view, &request.cluster_id);
        async move {
            allowed?;
            Ok(execute::execute(&clusters, &version, request).await)
        }
    })?;
    Ok(())
}
