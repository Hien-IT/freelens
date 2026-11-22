/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannelListenerInjectable, sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { historyCanGoBackChannel, historyCanGoForwardChannel, locationChangedChannel } from "../../common/ipc/window";
import { getHistoryState } from "./window";

// Tells every view whether the windows can go back or forward.
const locationChangedListenerInjectable = getMessageChannelListenerInjectable({
  id: "send-history-state",
  channel: locationChangedChannel,
  getHandler: (di) => {
    const sendMessageToChannel = di.inject(sendMessageToChannelInjectionToken);

    return () => {
      const { canGoBack, canGoForward } = getHistoryState();

      sendMessageToChannel(historyCanGoBackChannel, canGoBack);
      sendMessageToChannel(historyCanGoForwardChannel, canGoForward);
    };
  },
});

export default locationChangedListenerInjectable;
