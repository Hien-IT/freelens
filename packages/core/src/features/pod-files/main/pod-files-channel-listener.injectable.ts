/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { podFilesChannel } from "../common/channels";
import podFilesHandlerInjectable from "./pod-files-handler.injectable";

const podFilesChannelListenerInjectable = getRequestChannelListenerInjectable({
  id: "pod-files-channel-listener",
  channel: podFilesChannel,
  getHandler: (di) => di.inject(podFilesHandlerInjectable),
});

export default podFilesChannelListenerInjectable;
