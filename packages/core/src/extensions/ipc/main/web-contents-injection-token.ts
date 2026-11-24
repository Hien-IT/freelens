/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { webContents } from "electron";

/**
 * Electron's `webContents`, which the legacy broadcast of main sends to. A
 * token, so that the legacy helpers, which the renderer bundle also reaches,
 * import no Electron value.
 */
export const webContentsInjectionToken = getInjectionToken<typeof webContents | undefined>({
  id: "web-contents",
});
