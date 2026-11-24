/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { waitUntilPortFreeChannel } from "../common/channel";
import waitUntilFreeInjectable from "./wait-until-free.injectable";

const waitUntilPortFreeRequestListenerInjectable = getRequestChannelListenerInjectable({
  id: "wait-until-port-free-request-listener",
  channel: waitUntilPortFreeChannel,
  getHandler: (di) => {
    const waitUntilFree = di.inject(waitUntilFreeInjectable);

    return async ({ port }) => {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`"${port}" is not a port`);
      }

      await waitUntilFree(port);
    };
  },
});

export default waitUntilPortFreeRequestListenerInjectable;
