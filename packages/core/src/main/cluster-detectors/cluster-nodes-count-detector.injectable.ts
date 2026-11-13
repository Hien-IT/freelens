/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { ClusterMetadataKey } from "../../common/cluster-types";
import k8SRequestInjectable from "../k8s-request.injectable";
import { clusterMetadataDetectorInjectionToken } from "./token";

import type { Cluster } from "../../common/cluster/cluster";

interface NodeList {
  items: unknown[];
  metadata?: {
    continue?: string;
    remainingItemCount?: number;
  };
}

const clusterNodeCountDetectorInjectable = getInjectable({
  id: "cluster-node-count-detector",
  instantiate: (di) => {
    const k8sRequest = di.inject(k8SRequestInjectable);
    const requestNodeCount = async (cluster: Cluster) => {
      // Only the count is needed, which the API server reports for a limited list
      const { items, metadata } = (await k8sRequest(cluster, "/api/v1/nodes?limit=1")) as NodeList;

      if (metadata?.remainingItemCount !== undefined) {
        return items.length + metadata.remainingItemCount;
      }

      if (metadata?.continue) {
        const { items: allItems } = (await k8sRequest(cluster, "/api/v1/nodes")) as NodeList;

        return allItems.length;
      }

      return items.length;
    };

    return {
      key: ClusterMetadataKey.NODES_COUNT,
      detect: async (cluster) => {
        try {
          return {
            value: await requestNodeCount(cluster),
            accuracy: 1000,
          };
        } catch {
          return null;
        }
      },
    };
  },
  injectionToken: clusterMetadataDetectorInjectionToken,
});

export default clusterNodeCountDetectorInjectable;
