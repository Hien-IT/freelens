/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import loadKubeconfigInjectable from "../../../../common/cluster/main/load-kubeconfig.injectable";
import { clusterKubeconfigContextsChannel } from "../common/kubeconfig-channels";
import getRegisteredClusterInjectable from "./get-registered-cluster.injectable";

const clusterKubeconfigContextsListenerInjectable = getRequestChannelListenerInjectable({
  id: "cluster-kubeconfig-contexts-listener",
  channel: clusterKubeconfigContextsChannel,
  getHandler: (di) => {
    const getRegisteredCluster = di.inject(getRegisteredClusterInjectable);

    return async (clusterId) => {
      const cluster = getRegisteredCluster(clusterId);
      const { config, error } = await di.inject(loadKubeconfigInjectable, cluster)(true);

      if (error) {
        throw error;
      }

      return {
        contexts: config.contexts.map(({ name }) => name),
        currentContext: config.currentContext || undefined,
        defaultNamespace: config.getContextObject(cluster.contextName.get())?.namespace,
      };
    };
  },
});

export default clusterKubeconfigContextsListenerInjectable;
