/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { removeClusterContextFromKubeconfigChannel } from "../common/kubeconfig-channels";
import getRegisteredClusterInjectable from "./get-registered-cluster.injectable";
import saveKubeconfigInjectable from "./save-kubeconfig.injectable";

/** Removes the cluster's context from its kubeconfig file, and sets the new current context if one is given. */
const removeClusterContextFromKubeconfigListenerInjectable = getRequestChannelListenerInjectable({
  id: "remove-cluster-context-from-kubeconfig-listener",
  channel: removeClusterContextFromKubeconfigChannel,
  getHandler: (di) => {
    const getRegisteredCluster = di.inject(getRegisteredClusterInjectable);

    return async ({ clusterId, newCurrentContext }) => {
      const cluster = getRegisteredCluster(clusterId);
      const contextName = cluster.contextName.get();

      await di.inject(saveKubeconfigInjectable)(cluster.kubeConfigPath.get(), (config) => {
        Object.assign(config, {
          contexts: config.contexts.filter((item) => item.name !== contextName),
          currentContext: newCurrentContext || config.currentContext,
        });
      });
    };
  },
});

export default removeClusterContextFromKubeconfigListenerInjectable;
