/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { revealClusterKubeconfigChannel } from "../common/channel";

import type { ClusterId } from "../../../../common/cluster-types";

export type RevealClusterKubeconfig = (clusterId: ClusterId) => Promise<void>;

const revealClusterKubeconfigInjectable = getInjectable({
  id: "reveal-cluster-kubeconfig",
  instantiate: (di): RevealClusterKubeconfig => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (clusterId) => requestFromChannel(revealClusterKubeconfigChannel, clusterId);
  },
});

export default revealClusterKubeconfigInjectable;
