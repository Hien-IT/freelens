/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { clusterKubeconfigContextsChannel } from "../common/kubeconfig-channels";

import type { ClusterId } from "../../../../common/cluster-types";
import type { KubeconfigSummary } from "../common/kubeconfig-channels";

export type RequestClusterKubeconfigContexts = (clusterId: ClusterId) => Promise<KubeconfigSummary>;

const requestClusterKubeconfigContextsInjectable = getInjectable({
  id: "request-cluster-kubeconfig-contexts",
  instantiate: (di): RequestClusterKubeconfigContexts => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (clusterId) => requestFromChannel(clusterKubeconfigContextsChannel, clusterId);
  },
});

export default requestClusterKubeconfigContextsInjectable;
