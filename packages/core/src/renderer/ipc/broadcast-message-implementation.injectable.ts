/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { broadcastMessageImplementationInjectionToken } from "../../common/ipc/broadcast-message-implementation-token";
import { broadcastToViewsChannel, toLegacyMessage } from "../../common/ipc/broadcast-to-views-channel";
import { toJS } from "../../common/utils/toJS";

// A view broadcasts through main, which sends to every view.
const broadcastMessageImplementationInjectable = getInjectable({
  id: "broadcast-message-implementation-for-renderer",

  instantiate: (di) => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return async (channel: string, ...args: unknown[]) => {
      await requestFromChannel(broadcastToViewsChannel, { channel, message: toJS(toLegacyMessage(args)) });
    };
  },

  injectionToken: broadcastMessageImplementationInjectionToken,
});

export default broadcastMessageImplementationInjectable;
