/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken, getMessageChannel } from "@freelensapp/messaging";
import { showErrorNotificationInjectable } from "@freelensapp/notifications";
import { getInjectable } from "@ogre-tools/injectable";
import { listNamespaceForbiddenChannel } from "../../common/ipc/cluster";
import { hotbarTooManyItemsChannel } from "../../common/ipc/hotbar";
import { defaultHotbarCells } from "../../features/hotbar/storage/common/types";
import listNamespacesForbiddenHandlerInjectable from "./list-namespaces-forbidden-handler.injectable";

const registerIpcListenersInjectable = getInjectable({
  id: "register-ipc-listeners",

  instantiate: (di) => {
    const listNamespacesForbiddenHandler = di.inject(listNamespacesForbiddenHandlerInjectable);
    const enlistMessageChannelListener = di.inject(enlistMessageChannelListenerInjectionToken);
    const showErrorNotification = di.inject(showErrorNotificationInjectable);

    return () => {
      enlistMessageChannelListener({
        id: "list-namespaces-forbidden",
        channel: listNamespaceForbiddenChannel,
        handler: listNamespacesForbiddenHandler,
      });
      enlistMessageChannelListener({
        id: "hotbar-too-many-items",
        channel: getMessageChannel<void>(hotbarTooManyItemsChannel),
        handler: () => {
          showErrorNotification(`Cannot have more than ${defaultHotbarCells} items pinned to a hotbar`);
        },
      });
    };
  },
});

export default registerIpcListenersInjectable;
