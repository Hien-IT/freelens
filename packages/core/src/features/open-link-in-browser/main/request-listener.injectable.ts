/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import openLinkInBrowserInjectable from "../../../common/utils/open-link-in-browser.injectable";
import { openLinkInBrowserChannel } from "../common/channel";

const openLinkInBrowserRequestListenerInjectable = getRequestChannelListenerInjectable({
  id: "open-link-in-browser-request-listener",
  channel: openLinkInBrowserChannel,
  getHandler: (di) => {
    const openLinkInBrowser = di.inject(openLinkInBrowserInjectable);

    return (url) => openLinkInBrowser(url);
  },
});

export default openLinkInBrowserRequestListenerInjectable;
