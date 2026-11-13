/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import createClusterAccessInjectable from "./create-cluster-access.injectable";
import { TrafficManager } from "./traffic-manager";

import type { Cluster } from "../../../common/cluster/cluster";

/** A manager left unused this long releases what it holds open, such as its port-forward. */
const idleTimeoutMs = 10 * 60_000;

export interface TrafficManagers {
  /** The manager of the cluster, created on first use. */
  get(cluster: Cluster): TrafficManager;
  closeAll(): void;
}

const trafficManagersInjectable = getInjectable({
  id: "traffic-map-managers",

  instantiate: (di): TrafficManagers => {
    const createClusterAccess = di.inject(createClusterAccessInjectable);
    const managers = new Map<string, { manager: TrafficManager; timer: ReturnType<typeof setTimeout> }>();

    const close = (clusterId: string) => {
      const entry = managers.get(clusterId);

      if (entry) {
        clearTimeout(entry.timer);
        entry.manager.close();
        managers.delete(clusterId);
      }
    };

    return {
      get: (cluster) => {
        const existing = managers.get(cluster.id);
        const manager = existing?.manager ?? new TrafficManager(createClusterAccess(cluster));

        if (existing) {
          clearTimeout(existing.timer);
        }

        const timer = setTimeout(() => close(cluster.id), idleTimeoutMs);

        timer.unref?.();
        managers.set(cluster.id, { manager, timer });

        return manager;
      },
      closeAll: () => [...managers.keys()].forEach(close),
    };
  },
});

export default trafficManagersInjectable;
