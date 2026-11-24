/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { pathModuleInjectionToken } from "./path-module-injection-token";

const fileSystemSeparatorInjectable = getInjectable({
  id: "file-system-separator",
  instantiate: (di) => di.inject(pathModuleInjectionToken).sep,
  causesSideEffects: true,
});

export default fileSystemSeparatorInjectable;
