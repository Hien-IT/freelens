/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getFeature } from "@freelensapp/feature-core";
import { loggerFeature } from "../common/feature";
import { registerInjectables } from "./register-injectables";

/** The logger of the renderer, which needs no Node. */
export const loggerFeatureForRenderer = getFeature({
  id: "logger-feature-for-renderer",

  register: (di) => {
    registerInjectables(di);
  },

  dependencies: [loggerFeature],
});
