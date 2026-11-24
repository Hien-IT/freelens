/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import getClusterByIdInjectable from "../../storage/common/get-by-id.injectable";
import { revealClusterKubeconfigChannel } from "../common/channel";
import showItemInFolderInjectable from "./show-item-in-folder.injectable";

const revealClusterKubeconfigRequestListenerInjectable = getRequestChannelListenerInjectable({
  id: "reveal-cluster-kubeconfig-request-listener",
  channel: revealClusterKubeconfigChannel,
  getHandler: (di) => {
    const getClusterById = di.inject(getClusterByIdInjectable);
    const showItemInFolder = di.inject(showItemInFolderInjectable);

    return (clusterId) => {
      const cluster = getClusterById(clusterId);

      if (!cluster) {
        throw new Error(`Cannot reveal the kubeconfig of cluster "${clusterId}", which is not registered`);
      }

      showItemInFolder(cluster.kubeConfigPath.get());
    };
  },
});

export default revealClusterKubeconfigRequestListenerInjectable;
