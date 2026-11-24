/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import getClusterByIdInjectable from "../../storage/common/get-by-id.injectable";

import type { ClusterId } from "../../../../common/cluster-types";

/** The cluster of an id a view sent, which main must have. */
const getRegisteredClusterInjectable = getInjectable({
  id: "get-registered-cluster",
  instantiate: (di) => {
    const getClusterById = di.inject(getClusterByIdInjectable);

    return (clusterId: ClusterId) => {
      const cluster = getClusterById(clusterId);

      if (!cluster) {
        throw new Error(`Cluster "${clusterId}" is not registered`);
      }

      return cluster;
    };
  },
});

export default getRegisteredClusterInjectable;
