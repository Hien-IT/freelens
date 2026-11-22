/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { enlistRequestChannelListenerInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";

// A view answers no request, as in the Electron renderer.
const enlistRequestChannelListenerInjectable = getInjectable({
  id: "enlist-request-channel-listener-for-tauri",

  instantiate: () => (listener) => {
    throw new Error(
      `Tried to enlist request channel "${listener.channel.id}" in a view of the Tauri build, but views do not answer requests.`,
    );
  },

  injectionToken: enlistRequestChannelListenerInjectionToken,
});

export default enlistRequestChannelListenerInjectable;
