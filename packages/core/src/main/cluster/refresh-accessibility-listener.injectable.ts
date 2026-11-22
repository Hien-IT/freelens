/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { refreshClusterAccessibilityChannel } from "../../common/ipc/cluster";
import getClusterByIdInjectable from "../../features/cluster/storage/common/get-by-id.injectable";
import clusterConnectionInjectable from "./cluster-connection.injectable";

const refreshAccessibilityListenerInjectable = getRequestChannelListenerInjectable({
  id: "refresh-cluster-accessibility",
  channel: refreshClusterAccessibilityChannel,
  getHandler: (di) => {
    const getClusterById = di.inject(getClusterByIdInjectable);

    return async (clusterId) => {
      const cluster = getClusterById(clusterId);

      if (cluster) {
        await di.inject(clusterConnectionInjectable, cluster).refreshAccessibilityAndMetadata();
      }

      return true;
    };
  },
});

export default refreshAccessibilityListenerInjectable;
