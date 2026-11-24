/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

/** A URL to open in the user's browser; main opens only `http:` and `https:` ones. */
export const openLinkInBrowserChannel = getRequestChannel<string, void>("open-link-in-browser");
