/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

import type { StoreSnapshotEntry } from "../common/initial-values-channel";

/** What main answered for each store, by `configName`, kept up to date until the store loads. */
const persistentStorageInitialValuesInjectable = getInjectable({
  id: "persistent-storage-initial-values",
  instantiate: () => new Map<string, StoreSnapshotEntry>(),
});

export default persistentStorageInitialValuesInjectable;
