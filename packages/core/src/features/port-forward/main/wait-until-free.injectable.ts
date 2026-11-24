/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { waitUntilFree } from "tcp-port-used";

/** Checks every 200 ms, and fails after a second, as the renderer did. */
const waitUntilFreeInjectable = getInjectable({
  id: "wait-until-port-free-in-main",
  instantiate: () => (port: number) => waitUntilFree(port, 200, 1000),
  causesSideEffects: true,
});

export default waitUntilFreeInjectable;
