/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getFeature } from "@freelensapp/feature-core";
import { loggerFeature } from "../common/feature";
import { registerInjectables } from "./register-injectables";

/** The logger of the main process, which writes with winston. */
export const loggerFeatureForMain = getFeature({
  id: "logger-feature-for-main",

  register: (di) => {
    registerInjectables(di);
  },

  dependencies: [loggerFeature],
});
