/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import Config from "conf";
import { configurationFileModelImplementationInjectionToken } from "../implementation-token";

import type { GetConfigurationFileModel } from "../get-configuration-file-model.injectable";

const getConfigurationFileModelForMainInjectable = getInjectable({
  id: "get-configuration-file-model-for-main",
  instantiate: (): GetConfigurationFileModel => (content) => new Config(content),
  injectionToken: configurationFileModelImplementationInjectionToken,
  causesSideEffects: true,
});

export default getConfigurationFileModelForMainInjectable;
