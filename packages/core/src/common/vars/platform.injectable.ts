/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { machineValuesInjectionToken } from "../../features/machine-values/common/token";

export const allPlatforms = ["win32", "darwin", "linux"] as const;

const platformInjectable = getInjectable({
  id: "platform",
  instantiate: (di) => di.inject(machineValuesInjectionToken).platform,
  causesSideEffects: true,
});

export default platformInjectable;
