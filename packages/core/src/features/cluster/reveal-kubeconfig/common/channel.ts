/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { ClusterId } from "../../../../common/cluster-types";

/** Shows the kubeconfig file of a cluster in the file manager; main finds the file by the cluster. */
export const revealClusterKubeconfigChannel = getRequestChannel<ClusterId, void>("reveal-cluster-kubeconfig");
