/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import path from "node:path";
import { getInjectable } from "@ogre-tools/injectable";
import { pathModuleInjectionToken } from "../path-module-injection-token";

const pathModuleInjectable = getInjectable({
  id: "path-module-for-main",
  instantiate: () => path,
  injectionToken: pathModuleInjectionToken,
});

export default pathModuleInjectable;
