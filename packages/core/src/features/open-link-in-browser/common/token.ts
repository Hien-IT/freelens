/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

import type { OpenLinkInBrowser } from "../../../common/utils/open-link-in-browser.injectable";

/** Opens a link: main with the shell of Electron, the renderer by asking main. */
export const openLinkInBrowserImplementationInjectionToken = getInjectionToken<OpenLinkInBrowser>({
  id: "open-link-in-browser-implementation",
});
