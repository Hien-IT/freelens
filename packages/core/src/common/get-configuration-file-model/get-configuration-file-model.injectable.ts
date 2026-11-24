/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { configurationFileModelImplementationInjectionToken } from "./implementation-token";

import type Config from "conf";
import type { Options as ConfOptions } from "conf";

export type GetConfigurationFileModel = <T extends Record<string, unknown>>(content: ConfOptions<T>) => Config<T>;

const getConfigurationFileModelInjectable = getInjectable({
  id: "get-configuration-file-model",
  instantiate: (di): GetConfigurationFileModel => di.inject(configurationFileModelImplementationInjectionToken),
});

export default getConfigurationFileModelInjectable;
