/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import messageBatchesInjectable from "./message-batches.injectable";
import { toEnvelope } from "./wire";

import type { SendMessageToChannel } from "@freelensapp/messaging";

const messageToChannelInjectable = getInjectable({
  id: "message-to-channel-for-tauri",

  instantiate: (di) => {
    const batches = di.inject(messageBatchesInjectable);

    return ((channel, message) => {
      batches.send(channel.id, toEnvelope(channel.id, message));
    }) as SendMessageToChannel;
  },

  injectionToken: sendMessageToChannelInjectionToken,
});

export default messageToChannelInjectable;
