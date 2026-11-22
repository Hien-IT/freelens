/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { standaloneShellTokenChannel } from "../../common/ipc/shell-token-channels";

import type { RequestShellToken } from "./terminal-api";

/**
 * Mints the one time token for a shell that belongs to no cluster, and so can
 * be asked for from the root frame.
 */
const requestStandaloneShellTokenInjectable = getInjectable({
  id: "request-standalone-shell-token",

  instantiate: (di): RequestShellToken => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (tabId) => requestFromChannel(standaloneShellTokenChannel, tabId);
  },
});

export default requestStandaloneShellTokenInjectable;
