/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { persistentStorageInitialValuesChannel } from "../common/initial-values-channel";
import persistentStorageRegistryInjectable from "../common/registry.injectable";

const persistentStorageInitialValuesListenerInjectable = getRequestChannelListenerInjectable({
  id: "persistent-storage-initial-values-listener",
  channel: persistentStorageInitialValuesChannel,
  getHandler: (di) => {
    const registry = di.inject(persistentStorageRegistryInjectable);

    return () => Array.from(registry, ([path, { configName, toJSON }]) => ({ configName, path, model: toJSON() }));
  },
});

export default persistentStorageInitialValuesListenerInjectable;
