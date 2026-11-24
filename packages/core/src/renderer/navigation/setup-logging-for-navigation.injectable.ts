/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { observableHistoryInjectionToken } from "@freelensapp/routing";
import { getInjectable } from "@ogre-tools/injectable";
import { beforeFrameStartsSecondInjectionToken } from "../before-frame-starts/tokens";
import currentlyInClusterFrameInjectable from "../routes/currently-in-cluster-frame.injectable";

const setupLoggingForNavigationInjectable = getInjectable({
  id: "setup-logging-for-navigation",
  instantiate: (di) => ({
    run: () => {
      const logger = di.inject(loggerInjectionToken);
      const observableHistory = di.inject(observableHistoryInjectionToken);
      const isClusterView = di.inject(currentlyInClusterFrameInjectable);

      observableHistory.listen((location, action) => {
        const domain = window.location.href;

        logger.debug(`[NAVIGATION]: ${action}-ing. Current is now:`, {
          isClusterView,
          domain,
          location,
        });
      });
    },
  }),
  injectionToken: beforeFrameStartsSecondInjectionToken,
});

export default setupLoggingForNavigationInjectable;
