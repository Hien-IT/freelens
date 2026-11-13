/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { navigateToRouteInjectionToken } from "../../../common/front-end-routing/navigate-to-route-injection-token";
import trafficMapRouteInjectable from "./traffic-map-route.injectable";

const navigateToTrafficMapInjectable = getInjectable({
  id: "navigate-to-traffic-map",

  instantiate: (di) => {
    const navigateToRoute = di.inject(navigateToRouteInjectionToken);
    const route = di.inject(trafficMapRouteInjectable);

    return () => navigateToRoute(route);
  },
});

export default navigateToTrafficMapInjectable;
