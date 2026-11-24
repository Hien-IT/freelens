/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { webContents } from "electron";
import { webContentsInjectionToken } from "./web-contents-injection-token";

const webContentsInjectable = getInjectable({
  id: "web-contents",
  instantiate: () => webContents,
  injectionToken: webContentsInjectionToken,
});

export default webContentsInjectable;
