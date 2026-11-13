/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { navigateToRouteInjectionToken } from "../../../common/front-end-routing/navigate-to-route-injection-token";
import resourceMapRouteInjectable from "./resource-map-route.injectable";

const navigateToResourceMapInjectable = getInjectable({
  id: "navigate-to-resource-map",

  instantiate: (di) => {
    const navigateToRoute = di.inject(navigateToRouteInjectionToken);
    const route = di.inject(resourceMapRouteInjectable);

    return () => navigateToRoute(route);
  },
});

export default navigateToResourceMapInjectable;
