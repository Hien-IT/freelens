/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { standaloneShellTokenChannel } from "../../../../common/ipc/shell-token-channels";
import { standaloneShellScope } from "./shell-request-authenticator";
import shellRequestAuthenticatorInjectable from "./shell-request-authenticator.injectable";

const standaloneShellTokenListenerInjectable = getRequestChannelListenerInjectable({
  id: "mint",
  channel: standaloneShellTokenChannel,
  getHandler: (di) => {
    const authenticator = di.inject(shellRequestAuthenticatorInjectable);

    return (tabId) => authenticator.mint(standaloneShellScope, tabId);
  },
});

export default standaloneShellTokenListenerInjectable;
