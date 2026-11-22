/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { windowActionChannel } from "../../common/ipc/window";
import { handleWindowAction } from "./window";

const windowActionListenerInjectable = getRequestChannelListenerInjectable({
  id: "handle-window-action",
  channel: windowActionChannel,
  getHandler: () => (action) => handleWindowAction(action),
});

export default windowActionListenerInjectable;
