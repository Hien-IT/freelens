/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getFeature } from "@freelensapp/feature-core";
import { messagingFeature } from "@freelensapp/messaging";
import { registerInjectables } from "./register-injectables";

export const messagingFeatureForTauri = getFeature({
  id: "messaging-for-tauri",

  register: (di) => {
    registerInjectables(di);
  },

  dependencies: [messagingFeature],
});
