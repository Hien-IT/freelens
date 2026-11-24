/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { ClusterId } from "../../../../common/cluster-types";

/** What the views show of a cluster's kubeconfig: names and a namespace, never a credential. */
export interface KubeconfigSummary {
  contexts: string[];
  currentContext?: string;
  /** The namespace of the cluster's own context. */
  defaultNamespace?: string;
}

export const clusterKubeconfigContextsChannel = getRequestChannel<ClusterId, KubeconfigSummary>(
  "cluster-kubeconfig-contexts",
);

export const removeClusterContextFromKubeconfigChannel = getRequestChannel<
  { clusterId: ClusterId; newCurrentContext?: string },
  void
>("remove-cluster-context-from-kubeconfig");
