/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { openLinkInBrowserImplementationInjectionToken } from "../common/token";
import openExternalInjectable from "./open-external.injectable";

import type { OpenLinkInBrowser } from "../../../common/utils/open-link-in-browser.injectable";

const allowedProtocols = new Set(["http:", "https:"]);

const openLinkInBrowserForMainInjectable = getInjectable({
  id: "open-link-in-browser-for-main",
  instantiate:
    (di): OpenLinkInBrowser =>
    async (url) => {
      const { protocol } = new URL(url);

      if (!allowedProtocols.has(protocol)) {
        throw new TypeError("not an http(s) URL");
      }

      await di.inject(openExternalInjectable)(url);
    },
  injectionToken: openLinkInBrowserImplementationInjectionToken,
});

export default openLinkInBrowserForMainInjectable;
