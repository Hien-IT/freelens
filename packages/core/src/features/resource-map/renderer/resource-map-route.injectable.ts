/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { computed } from "mobx";
import { frontEndRouteInjectionToken } from "../../../common/front-end-routing/front-end-route-injection-token";

const resourceMapRouteInjectable = getInjectable({
  id: "resource-map-route",

  instantiate: () => ({
    path: "/resource-map",
    clusterFrame: true,
    isEnabled: computed(() => true),
  }),

  injectionToken: frontEndRouteInjectionToken,
});

export default resourceMapRouteInjectable;
