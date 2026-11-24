/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

import type { ConfCompatibleFile } from "../../../../common/get-configuration-file-model/renderer/conf-compatible";

/** The files of stores about to load, by the folder and name the store's model is asked for. */
const preparedExtensionStoreFilesInjectable = getInjectable({
  id: "prepared-extension-store-files",
  instantiate: () => new Map<string, ConfCompatibleFile>(),
});

export default preparedExtensionStoreFilesInjectable;
