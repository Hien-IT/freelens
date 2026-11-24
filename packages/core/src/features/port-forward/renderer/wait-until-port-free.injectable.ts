/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { waitUntilPortFreeChannel } from "../common/channel";

export type WaitUntilPortFree = (port: number) => Promise<void>;

const waitUntilPortFreeInjectable = getInjectable({
  id: "wait-until-port-free",
  instantiate: (di): WaitUntilPortFree => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (port) => requestFromChannel(waitUntilPortFreeChannel, { port });
  },
});

export default waitUntilPortFreeInjectable;
