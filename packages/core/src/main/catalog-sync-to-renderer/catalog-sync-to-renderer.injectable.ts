/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken } from "@freelensapp/messaging";
import { getStartableStoppable } from "@freelensapp/startable-stoppable";
import { disposer } from "@freelensapp/utilities";
import { getInjectable } from "@ogre-tools/injectable";
import { reaction } from "mobx";
import { catalogInitMessageChannel } from "../../common/ipc/catalog";
import { toJS } from "../../common/utils";
import catalogEntityRegistryInjectable from "../catalog/entity-registry.injectable";
import catalogSyncBroadcasterInjectable from "./broadcaster.injectable";

const catalogSyncToRendererInjectable = getInjectable({
  id: "catalog-sync-to-renderer",

  instantiate: (di) => {
    const catalogEntityRegistry = di.inject(catalogEntityRegistryInjectable);
    const enlistMessageChannelListener = di.inject(enlistMessageChannelListenerInjectionToken);
    const catalogSyncBroadcaster = di.inject(catalogSyncBroadcasterInjectable);

    return getStartableStoppable("catalog-sync", () => {
      const stopListening = enlistMessageChannelListener({
        id: "catalog-init",
        channel: catalogInitMessageChannel,
        handler: () => catalogSyncBroadcaster(toJS(catalogEntityRegistry.items)),
      });

      return disposer(
        stopListening,
        reaction(
          () => toJS(catalogEntityRegistry.items),
          (items) => {
            catalogSyncBroadcaster(items);
          },
          {
            fireImmediately: true,
          },
        ),
      );
    });
  },
});

export default catalogSyncToRendererInjectable;
