/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannelListenerInjectable } from "@freelensapp/messaging";
import { runInAction } from "mobx";
import { userResourceTemplatesUpdateChannel } from "../common/channels";
import userResourceTemplatesStateInjectable from "./state.injectable";

const userResourceTemplatesUpdateListenerInjectable = getMessageChannelListenerInjectable({
  channel: userResourceTemplatesUpdateChannel,
  id: "renderer",
  getHandler: (di) => {
    const state = di.inject(userResourceTemplatesStateInjectable);

    return (templates) => runInAction(() => state.set(templates));
  },
});

export default userResourceTemplatesUpdateListenerInjectable;
