/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { trafficMapChannel } from "../common/channels";
import trafficMapHandlerInjectable from "./traffic-map-handler.injectable";

const trafficMapChannelListenerInjectable = getRequestChannelListenerInjectable({
  id: "traffic-map-channel-listener",
  channel: trafficMapChannel,
  getHandler: (di) => di.inject(trafficMapHandlerInjectable),
});

export default trafficMapChannelListenerInjectable;
