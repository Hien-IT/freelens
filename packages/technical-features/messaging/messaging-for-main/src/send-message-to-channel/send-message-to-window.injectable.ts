/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sendMessageToWindowInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import getWebContentsByIdInjectable from "./get-web-contents-by-id.injectable";

import type { SendMessageToWindow } from "@freelensapp/messaging";

const sendMessageToWindowInjectable = getInjectable({
  id: "send-message-to-window",

  instantiate: (di): SendMessageToWindow => {
    const getWebContentsById = di.inject(getWebContentsByIdInjectable);

    return ({ windowId, frame }, channelId, message) => {
      const contents = getWebContentsById(windowId);

      if (!contents || contents.isDestroyed()) {
        return;
      }

      if (frame) {
        contents.sendToFrame([frame.processId, frame.frameId], channelId, message);
      } else {
        contents.send(channelId, message);
      }
    };
  },

  injectionToken: sendMessageToWindowInjectionToken,
});

export default sendMessageToWindowInjectable;
