/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The channels of main-cluster-connection the pages use, declared by id
// (specs/009-main-cluster-connection/contracts/cluster-channels.md).

import { getMessageChannel, getRequestChannel } from "@freelensapp/messaging";

export interface KnownResource {
  apiName: string;
  kind: string;
  group: string;
  version: string;
  namespaced: boolean;
}

/** `ClusterState` (specs/009-main-cluster-connection/data-model.md). */
export interface ClusterState {
  online: boolean;
  ready: boolean;
  disconnected: boolean;
  accessible: boolean;
  isAdmin: boolean;
  allowedNamespaces: string[];
  resourcesToShow: string[];
  knownResources: KnownResource[];
  isGlobalWatchEnabled: boolean;
}

export interface StateSync {
  clusterId: string;
  state: ClusterState;
}

export interface ConnectionUpdate {
  message: string;
  level: "info" | "warning" | "error";
}

export interface KubeconfigSummary {
  contexts: string[];
  currentContext?: string;
  defaultNamespace?: string;
}

export const activateClusterChannel = getRequestChannel<{ clusterId: string; force?: boolean }, void>(
  "activate-cluster",
);
export const deactivateClusterChannel = getRequestChannel<string, void>("deactivate-cluster");
export const setClusterAsDeletingChannel = getRequestChannel<string, void>("set-cluster-as-deleting");
export const clearClusterAsDeletingChannel = getRequestChannel<string, void>("clear-cluster-as-deleting");
export const deleteClusterChannel = getRequestChannel<string, void>("delete-cluster");
export const clusterKubeconfigContextsChannel = getRequestChannel<string, KubeconfigSummary>(
  "cluster-kubeconfig-contexts",
);
export const removeClusterContextChannel = getRequestChannel<{ clusterId: string; newCurrentContext?: string }, void>(
  "remove-cluster-context-from-kubeconfig",
);
export const clusterStateSyncChannel = getMessageChannel<StateSync>("cluster-state-sync");
export const initialClusterStatesChannel = getRequestChannel<void, StateSync[]>("initial-cluster-state-sync");
export const shellSyncFailedChannel = getMessageChannel<string>("shell-sync-failed-channel");

/** The channel of a cluster's connection updates, one name per cluster. */
export const connectionUpdateChannel = (clusterId: string) =>
  getMessageChannel<ConnectionUpdate>(`cluster:${clusterId}:connection-update`);
