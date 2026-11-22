/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { clusterShellTokenChannel } from "../../../../common/ipc/shell-token-channels";
import shellRequestAuthenticatorInjectable from "./shell-request-authenticator.injectable";

const clusterShellTokenListenerInjectable = getRequestChannelListenerInjectable({
  id: "mint",
  channel: clusterShellTokenChannel,
  getHandler: (di) => {
    const authenticator = di.inject(shellRequestAuthenticatorInjectable);

    return ([clusterId, tabId]) => authenticator.mint(clusterId, tabId);
  },
});

export default clusterShellTokenListenerInjectable;
