/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { getMessageChannel, sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";

export const frameCommunicationAdminChannel = getMessageChannel<undefined>("frame-communication-admin-channel");

// The view announces itself on load, as messaging-for-renderer does (research R7).
const allowCommunicationInjectable = getInjectable({
  id: "allow-communication-for-tauri",

  instantiate: (di) => {
    const sendMessageToChannel = di.inject(sendMessageToChannelInjectionToken);

    return {
      run: () => {
        sendMessageToChannel(frameCommunicationAdminChannel);
      },
    };
  },

  injectionToken: onLoadOfApplicationInjectionToken,
});

export default allowCommunicationInjectable;
