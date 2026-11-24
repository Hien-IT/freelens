/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { removeClusterContextFromKubeconfigChannel } from "../common/kubeconfig-channels";

import type { ClusterId } from "../../../../common/cluster-types";

export type RequestRemoveClusterContext = (clusterId: ClusterId, newCurrentContext?: string) => Promise<void>;

const requestRemoveClusterContextInjectable = getInjectable({
  id: "request-remove-cluster-context-from-kubeconfig",
  instantiate: (di): RequestRemoveClusterContext => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (clusterId, newCurrentContext) =>
      requestFromChannel(removeClusterContextFromKubeconfigChannel, { clusterId, newCurrentContext });
  },
});

export default requestRemoveClusterContextInjectable;
