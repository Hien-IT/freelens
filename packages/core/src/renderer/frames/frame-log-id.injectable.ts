/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

/** Tells apart the log lines of the frames of one cluster, as the frame token of Electron did. */
const frameLogIdInjectable = getInjectable({
  id: "frame-log-id",
  instantiate: () => globalThis.crypto.randomUUID(),
});

export default frameLogIdInjectable;
