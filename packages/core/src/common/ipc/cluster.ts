/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel, getRequestChannel } from "@freelensapp/messaging";

import type { ClusterId, KubeAuthUpdate } from "../cluster-types";

export const clusterSetFrameIdHandler = "cluster:set-frame-id";
export const clusterVisibilityHandler = "cluster:visibility";
export const clusterRefreshAccessibilityChannel = "cluster:refresh-accessibility";

/**
 * This channel is broadcast on whenever the cluster fails to list namespaces
 * during a refresh and no `accessibleNamespaces` have been set.
 */
export const clusterListNamespaceForbiddenChannel = "cluster:list-namespace-forbidden";

export type ListNamespaceForbiddenArgs = [clusterId: string];

export function isListNamespaceForbiddenArgs(args: unknown[]): args is ListNamespaceForbiddenArgs {
  return args.length === 1 && typeof args[0] === "string";
}

// Typed channels of the legacy names above (specs/002-messaging-for-tauri, research R11).
export const setClusterFrameIdChannel = getRequestChannel<ClusterId, void>(clusterSetFrameIdHandler);
export const refreshClusterAccessibilityChannel = getRequestChannel<ClusterId, boolean>(
  clusterRefreshAccessibilityChannel,
);
export const listNamespaceForbiddenChannel = getMessageChannel<string>(clusterListNamespaceForbiddenChannel);
export const networkOfflineChannel = getMessageChannel<void>("network:offline");
export const networkOnlineChannel = getMessageChannel<void>("network:online");
export const getConnectionUpdateChannel = (clusterId: ClusterId) =>
  getMessageChannel<KubeAuthUpdate>(`cluster:${clusterId}:connection-update`);
