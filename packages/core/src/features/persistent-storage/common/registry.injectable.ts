/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

export interface LoadedPersistentStorage {
  configName: string;
  toJSON: () => object;
}

/** The storages this process has loaded, by the path of their file. */
const persistentStorageRegistryInjectable = getInjectable({
  id: "persistent-storage-registry",
  instantiate: () => new Map<string, LoadedPersistentStorage>(),
});

export default persistentStorageRegistryInjectable;
