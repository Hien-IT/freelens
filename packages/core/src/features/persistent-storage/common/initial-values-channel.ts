/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

/** A store main has loaded, with the model it holds now. */
export interface StoreSnapshotEntry {
  /** The key a store of the renderer finds its entry by. */
  configName: string;
  /** Main's `config.path`, which names the store's sync channels. */
  path: string;
  model: object;
}

export const persistentStorageInitialValuesChannel = getRequestChannel<void, StoreSnapshotEntry[]>(
  "persistent-storage-initial-values",
);
