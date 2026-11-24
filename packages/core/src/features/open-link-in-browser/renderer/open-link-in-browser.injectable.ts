/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { openLinkInBrowserChannel } from "../common/channel";
import { openLinkInBrowserImplementationInjectionToken } from "../common/token";

import type { OpenLinkInBrowser } from "../../../common/utils/open-link-in-browser.injectable";

const openLinkInBrowserForRendererInjectable = getInjectable({
  id: "open-link-in-browser-for-renderer",
  instantiate: (di): OpenLinkInBrowser => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (url) => requestFromChannel(openLinkInBrowserChannel, url);
  },
  injectionToken: openLinkInBrowserImplementationInjectionToken,
});

export default openLinkInBrowserForRendererInjectable;
