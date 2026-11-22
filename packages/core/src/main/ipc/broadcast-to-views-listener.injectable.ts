/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import {
  getMessageChannel,
  getRequestChannelListenerInjectable,
  sendMessageToChannelInjectionToken,
} from "@freelensapp/messaging";
import { broadcastToViewsChannel } from "../../common/ipc/broadcast-to-views-channel";

// The relay of a view's broadcast to every view (specs/002-messaging-for-tauri, research R7).
const broadcastToViewsListenerInjectable = getRequestChannelListenerInjectable({
  id: "relay",
  channel: broadcastToViewsChannel,
  getHandler: (di) => {
    const sendMessageToChannel = di.inject(sendMessageToChannelInjectionToken);

    return ({ channel, message }) => {
      sendMessageToChannel(getMessageChannel(channel), message);
    };
  },
});

export default broadcastToViewsListenerInjectable;
