/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { ExtensionStoreFileRequest } from "./channels";

/**
 * Gets the file of a store ready before the store loads, and answers the
 * folder it is in. Main computes the folder as it always has; the renderer
 * asks main for the file and keeps it for the store's model.
 */
export const prepareExtensionStoreInjectionToken = getInjectionToken<
  (request: ExtensionStoreFileRequest & { storeName: string }) => string
>({
  id: "prepare-extension-store",
});
