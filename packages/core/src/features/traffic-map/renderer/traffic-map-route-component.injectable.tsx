/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import { withInjectables } from "@ogre-tools/injectable-react";
import { routeSpecificComponentInjectionToken } from "../../../renderer/routes/route-specific-component-injection-token";
import { ErrorBoundary } from "../../resource-map/renderer/error-boundary";
import trafficMapDependenciesInjectable from "./traffic-map-dependencies.injectable";
import { TrafficMapPage } from "./traffic-map-page";
import trafficMapRouteInjectable from "./traffic-map-route.injectable";

import type { Logger } from "@freelensapp/logger";

import type { TrafficMapPageDependencies } from "./traffic-map-page";

interface Dependencies {
  dependencies: TrafficMapPageDependencies;
  logger: Logger;
}

/** The page inside an error boundary, so that an error of the map leaves the sidebar rendered. */
function NonInjectedTrafficMapRoute({ dependencies, logger }: Dependencies) {
  return (
    <ErrorBoundary logger={logger}>
      <TrafficMapPage dependencies={dependencies} />
    </ErrorBoundary>
  );
}

const TrafficMapRoute = withInjectables<Dependencies>(NonInjectedTrafficMapRoute, {
  getProps: (di, props) => ({
    ...props,
    dependencies: di.inject(trafficMapDependenciesInjectable),
    logger: di.inject(loggerInjectionToken),
  }),
});

const trafficMapRouteComponentInjectable = getInjectable({
  id: "traffic-map-route-component",

  instantiate: (di) => ({
    route: di.inject(trafficMapRouteInjectable),
    Component: TrafficMapRoute,
  }),

  injectionToken: routeSpecificComponentInjectionToken,
});

export default trafficMapRouteComponentInjectable;
