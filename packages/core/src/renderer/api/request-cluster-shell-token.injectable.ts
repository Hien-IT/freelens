/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { assert } from "@freelensapp/utilities";
import { getInjectable } from "@ogre-tools/injectable";
import { clusterShellTokenChannel } from "../../common/ipc/shell-token-channels";
import hostedClusterIdInjectable from "../cluster-frame-context/hosted-cluster-id.injectable";

import type { RequestShellToken } from "./terminal-api";

/**
 * Mints the one time token for a shell belonging to the cluster this frame is
 * hosting.
 */
const requestClusterShellTokenInjectable = getInjectable({
  id: "request-cluster-shell-token",

  instantiate: (di): RequestShellToken => {
    const hostedClusterId = di.inject(hostedClusterIdInjectable);
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (tabId) => {
      assert(hostedClusterId, "Can only request a cluster shell token within a cluster frame");

      return requestFromChannel(clusterShellTokenChannel, [hostedClusterId, tabId]);
    };
  },
});

export default requestClusterShellTokenInjectable;
