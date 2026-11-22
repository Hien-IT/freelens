/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannelListenerInjectable } from "@freelensapp/messaging";
import { openAppMenuAsContextMenuChannel } from "../../common/ipc/window";
import popupApplicationMenuInjectable from "./popup-application-menu.injectable";

const openAppMenuAsContextMenuListenerInjectable = getMessageChannelListenerInjectable({
  id: "open-app-menu-as-context-menu",
  channel: openAppMenuAsContextMenuChannel,
  // The menu is injected when a message arrives, so listening has no side effect.
  getHandler: (di) => (_, sender) => di.inject(popupApplicationMenuInjectable)(sender),
});

export default openAppMenuAsContextMenuListenerInjectable;
