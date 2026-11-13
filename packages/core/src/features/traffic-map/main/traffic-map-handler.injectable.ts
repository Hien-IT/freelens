/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import getClusterByIdInjectable from "../../cluster/storage/common/get-by-id.injectable";
import { trafficSourceNames } from "../common/types";
import trafficManagersInjectable from "./traffic-managers.injectable";

import type { TrafficRequest, TrafficResponse } from "../common/types";

export type TrafficMapHandler = (request: TrafficRequest) => Promise<TrafficResponse<unknown>>;

const trafficMapHandlerInjectable = getInjectable({
  id: "traffic-map-handler",

  instantiate: (di): TrafficMapHandler => {
    const getClusterById = di.inject(getClusterByIdInjectable);
    const managers = di.inject(trafficManagersInjectable);
    const logger = di.inject(loggerInjectionToken);

    const handle = async (request: TrafficRequest): Promise<unknown> => {
      const cluster = getClusterById(request?.clusterId);

      if (!cluster?.accessible.get()) {
        throw new Error("The cluster is not connected");
      }

      const manager = managers.get(cluster);

      switch (request.type) {
        case "sources":
          return manager.detectSources(request.refresh);
        case "flows":
          return manager.getFlows(request.query ?? { sinceSeconds: 300 });
        case "set-source":
          if (!trafficSourceNames.includes(request.source)) {
            throw new Error(`Unknown traffic source ${request.source}`);
          }

          return manager.setActiveSource(request.source);
        default:
          throw new Error("Unknown traffic map request");
      }
    };

    return async (request) => {
      try {
        return { callWasSuccessful: true, response: await handle(request) };
      } catch (error) {
        logger.warn("[TRAFFIC-MAP]: request failed", { error, type: request?.type });

        return { callWasSuccessful: false, error: error instanceof Error ? error.message : String(error) };
      }
    };
  },
});

export default trafficMapHandlerInjectable;
