/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeApplicationIsLoadingInjectionToken } from "@freelensapp/application";
import { enlistMessageChannelListenerInjectionToken, requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { persistentStorageIpcChannelPrefixesInjectionToken } from "../common/channel-prefix";
import { persistentStorageInitialValuesChannel } from "../common/initial-values-channel";
import persistentStorageInitialValuesInjectable from "./initial-values.injectable";

import type { MessageChannel } from "@freelensapp/messaging";

const setupPersistentStorageInitialValuesInjectable = getInjectable({
  id: "setup-persistent-storage-initial-values",
  instantiate: (di) => ({
    run: async () => {
      const requestFromChannel = di.inject(requestFromChannelInjectionToken);
      const enlistMessageChannelListener = di.inject(enlistMessageChannelListenerInjectionToken);
      const { local } = di.inject(persistentStorageIpcChannelPrefixesInjectionToken);
      const initialValues = di.inject(persistentStorageInitialValuesInjectable);

      for (const entry of await requestFromChannel(persistentStorageInitialValuesChannel)) {
        initialValues.set(entry.configName, entry);

        // A change main sends before the store loads would be lost otherwise
        const channel: MessageChannel<object> = { id: `${local}:${entry.path}` };

        enlistMessageChannelListener({
          id: "persistent-storage-initial-value",
          channel,
          handler: (model) => initialValues.set(entry.configName, { ...entry, model }),
        });
      }
    },
  }),
  injectionToken: beforeApplicationIsLoadingInjectionToken,
});

export default setupPersistentStorageInitialValuesInjectable;
