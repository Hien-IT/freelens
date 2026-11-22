/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel, sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { broadcastMessageImplementationInjectionToken } from "../../common/ipc/broadcast-message-implementation-token";
import { toLegacyMessage } from "../../common/ipc/broadcast-to-views-channel";
import { toJS } from "../../common/utils/toJS";

// Main sends to every view over messaging. The legacy helper also called main's
// own listeners of the channel; no channel main broadcasts has one.
const broadcastMessageImplementationInjectable = getInjectable({
  id: "broadcast-message-implementation-for-main",

  instantiate: (di) => {
    const sendMessageToChannel = di.inject(sendMessageToChannelInjectionToken);

    return async (channel: string, ...args: unknown[]) => {
      sendMessageToChannel(getMessageChannel(channel), toJS(toLegacyMessage(args)));
    };
  },

  injectionToken: broadcastMessageImplementationInjectionToken,
});

export default broadcastMessageImplementationInjectable;
