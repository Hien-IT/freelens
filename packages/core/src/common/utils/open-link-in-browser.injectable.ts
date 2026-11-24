/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { openLinkInBrowserImplementationInjectionToken } from "../../features/open-link-in-browser/common/token";

export type OpenLinkInBrowser = (url: string) => Promise<void>;

/** Main opens the link, and only an `http:` or `https:` one; the renderer asks main. */
const openLinkInBrowserInjectable = getInjectable({
  id: "open-link-in-browser",
  instantiate: (di) => di.inject(openLinkInBrowserImplementationInjectionToken),
});

export default openLinkInBrowserInjectable;
