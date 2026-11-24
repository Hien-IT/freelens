/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { MachineValues } from "./channel";

/**
 * Where the injectables of the machine values read them: in main, from the
 * process and the operating system; in the renderer, from what main answered on
 * `machine-values` before the frame started.
 */
export const machineValuesInjectionToken = getInjectionToken<MachineValues>({
  id: "machine-values",
});
