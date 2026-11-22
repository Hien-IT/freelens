/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import clusterFramesInjectable from "../../common/cluster-frames.injectable";
import { setClusterFrameIdChannel } from "../../common/ipc/cluster";
import getClusterByIdInjectable from "../../features/cluster/storage/common/get-by-id.injectable";
import pushCatalogToRendererInjectable from "../catalog-sync-to-renderer/push-catalog-to-renderer.injectable";

// Records the frame that hosts a cluster, then sends it the catalog.
const setFrameIdListenerInjectable = getRequestChannelListenerInjectable({
  id: "set-cluster-frame-id",
  channel: setClusterFrameIdChannel,
  withSender: true,
  getHandler: (di) => {
    const getClusterById = di.inject(getClusterByIdInjectable);
    const clusterFrames = di.inject(clusterFramesInjectable);
    const pushCatalogToRenderer = di.inject(pushCatalogToRendererInjectable);

    return (clusterId, sender) => {
      const cluster = getClusterById(clusterId);

      if (cluster) {
        if (sender) {
          clusterFrames.set(cluster.id, { frameId: sender.frameId, processId: sender.processId });
        }

        pushCatalogToRenderer();
      }
    };
  },
});

export default setFrameIdListenerInjectable;
