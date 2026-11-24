/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { once } from "es-toolkit";
import { reaction } from "mobx";
import { userResourceTemplatesUpdateChannel } from "../common/channels";
import userResourceTemplatesInjectable from "./templates.injectable";
import watchUserResourceTemplatesInjectable from "./watch.injectable";

/** Watches the folder from the first request on, and sends every change to the views. */
const startUserResourceTemplatesInjectable = getInjectable({
  id: "start-user-resource-templates",
  instantiate: (di) =>
    once(() => {
      const templates = di.inject(userResourceTemplatesInjectable);
      const sendMessageToChannel = di.inject(sendMessageToChannelInjectionToken);

      reaction(
        () => templates.get(),
        (changed) => sendMessageToChannel(userResourceTemplatesUpdateChannel, changed),
      );
      di.inject(watchUserResourceTemplatesInjectable)();
    }),
});

export default startUserResourceTemplatesInjectable;
