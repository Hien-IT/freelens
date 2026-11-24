/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { posix, win32 } from "../../../renderer/path/node-path-port";
import platformInjectable from "../../vars/platform.injectable";
import { pathModuleInjectionToken } from "../path-module-injection-token";

/** The form of the path port that `node:path` has on the platform the application runs on. */
const pathModuleInjectable = getInjectable({
  id: "path-module-for-renderer",
  instantiate: (di) => (di.inject(platformInjectable) === "win32" ? win32 : posix),
  injectionToken: pathModuleInjectionToken,
});

export default pathModuleInjectable;
