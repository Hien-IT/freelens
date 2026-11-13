/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { onQuitOfBackEndInjectionToken } from "../../../main/start-main-application/runnable-tokens/phases";
import trafficManagersInjectable from "./traffic-managers.injectable";

/** Stops the port-forwards of the traffic sources when the application quits. */
const closeTrafficManagersOnQuitInjectable = getInjectable({
  id: "close-traffic-managers-on-quit",

  instantiate: (di) => ({
    run: () => {
      di.inject(trafficManagersInjectable).closeAll();

      return undefined;
    },
  }),

  injectionToken: onQuitOfBackEndInjectionToken,
});

export default closeTrafficManagersOnQuitInjectable;
