/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { pathModuleInjectionToken } from "./path-module-injection-token";

export type GetBasenameOfPath = (path: string) => string;

const getBasenameOfPathInjectable = getInjectable({
  id: "get-basename-of-path",
  instantiate: (di): GetBasenameOfPath => di.inject(pathModuleInjectionToken).basename,
  causesSideEffects: true,
});

export default getBasenameOfPathInjectable;
