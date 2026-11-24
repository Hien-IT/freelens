/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { machineValuesInjectionToken } from "../common/token";
import machineValuesStateInjectable from "./state.injectable";

const machineValuesInjectable = getInjectable({
  id: "machine-values-for-renderer",
  instantiate: (di) => di.inject(machineValuesStateInjectable).get(),
  injectionToken: machineValuesInjectionToken,
});

export default machineValuesInjectable;
