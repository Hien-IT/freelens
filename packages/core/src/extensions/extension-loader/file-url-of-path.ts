/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

/** `pathToFileURL` of `node:url`, which only main has: only main imports an entry point by its file. */
export const fileUrlOfPathInjectionToken = getInjectionToken<(path: string) => URL>({
  id: "file-url-of-path",
});
