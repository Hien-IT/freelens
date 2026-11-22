/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken } from "@freelensapp/messaging";
import { delay } from "@freelensapp/utilities";
import { getInjectable } from "@ogre-tools/injectable";
import { bundledExtensionsLoadedChannel } from "../../../../common/ipc/extension-handling";

const waitUntilBundledExtensionsAreLoadedInjectable = getInjectable({
  id: "wait-until-bundled-extensions-are-loaded",

  instantiate: (di) => {
    const enlistMessageChannelListener = di.inject(enlistMessageChannelListenerInjectionToken);

    return async () => {
      const viewHasLoaded = new Promise<void>((resolve) => {
        const stopListening = enlistMessageChannelListener({
          id: "wait-until-bundled-extensions-are-loaded",
          channel: bundledExtensionsLoadedChannel,
          handler: () => {
            stopListening();
            resolve();
          },
        });
      });

      await viewHasLoaded;
      await delay(50); // wait just a bit longer to let the first round of rendering happen
    };
  },

  causesSideEffects: true,
});

export default waitUntilBundledExtensionsAreLoadedInjectable;
