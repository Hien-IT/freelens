/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { GetConfigurationFileModel } from "./get-configuration-file-model.injectable";

/** `conf` on the file in main; in the renderer, the model main answered, in memory. */
export const configurationFileModelImplementationInjectionToken = getInjectionToken<GetConfigurationFileModel>({
  id: "configuration-file-model-implementation",
});
