/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistMessageChannelListenerInjectionToken, getMessageChannel } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";

import type { Disposer } from "@freelensapp/utilities";

/** Listens to a channel known only by its legacy name; the listener gets its message. */
export type LegacyOnChannelListen = (channel: string, listener: (message: unknown) => void) => Disposer;

const legacyOnChannelListenInjectable = getInjectable({
  id: "legacy-on-channel-listen",
  instantiate: (di): LegacyOnChannelListen => {
    const enlistMessageChannelListener = di.inject(enlistMessageChannelListenerInjectionToken);

    return (channel, listener) =>
      enlistMessageChannelListener({
        id: `legacy-on-channel-listen-${channel}`,
        channel: getMessageChannel<unknown>(channel),
        handler: listener,
      });
  },
  causesSideEffects: true,
});

export default legacyOnChannelListenInjectable;
