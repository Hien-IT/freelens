/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import { persistStateToConfigInjectionToken } from "../common/save-to-file";

const persistStateToConfigInjectable = getInjectable({
  id: "persist-state-to-config",
  instantiate: (di) => {
    const logger = di.inject(loggerInjectionToken);

    return (config, state) => {
      logger.info(`[BASE-STORE]: saving ${config.path}...`);

      // Each key is saved on its own, so that one that fails does not keep the
      // others from being saved, nor the caller from syncing the state over IPC
      for (const [key, value] of Object.entries(state)) {
        try {
          if (value === undefined) {
            // conf refuses to set a key to undefined
            config.delete(key as never);
          } else {
            config.set(key, value);
          }
        } catch (error) {
          logger.error(`[BASE-STORE]: failed to save "${key}" to ${config.path}`, error);
        }
      }
    };
  },
  injectionToken: persistStateToConfigInjectionToken,
});

export default persistStateToConfigInjectable;
