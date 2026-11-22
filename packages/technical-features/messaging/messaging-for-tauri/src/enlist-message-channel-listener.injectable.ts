/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import pollingInjectable from "./polling.injectable";

import type { EnlistMessageChannelListener } from "@freelensapp/messaging";

const enlistMessageChannelListenerInjectable = getInjectable({
  id: "enlist-message-channel-listener-for-tauri",

  instantiate: (di): EnlistMessageChannelListener => {
    const polling = di.inject(pollingInjectable);

    return ({ channel, handler }) => polling.listen(channel.id, (message) => handler(message as never));
  },

  injectionToken: enlistMessageChannelListenerInjectionToken,
});

export default enlistMessageChannelListenerInjectable;
