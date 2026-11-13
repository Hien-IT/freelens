/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { routeSpecificComponentInjectionToken } from "../../../renderer/routes/route-specific-component-injection-token";
import { ResourceMapPage } from "./resource-map-entry-points";
import resourceMapRouteInjectable from "./resource-map-route.injectable";

const resourceMapRouteComponentInjectable = getInjectable({
  id: "resource-map-route-component",

  instantiate: (di) => ({
    route: di.inject(resourceMapRouteInjectable),
    Component: ResourceMapPage,
  }),

  injectionToken: routeSpecificComponentInjectionToken,
});

export default resourceMapRouteComponentInjectable;
