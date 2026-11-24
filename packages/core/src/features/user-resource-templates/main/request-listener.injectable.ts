/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { initialUserResourceTemplatesChannel } from "../common/channels";
import startUserResourceTemplatesInjectable from "./start.injectable";
import userResourceTemplatesInjectable from "./templates.injectable";

const initialUserResourceTemplatesListenerInjectable = getRequestChannelListenerInjectable({
  id: "initial-user-resource-templates-listener",
  channel: initialUserResourceTemplatesChannel,
  getHandler: (di) => () => {
    di.inject(startUserResourceTemplatesInjectable)();

    return di.inject(userResourceTemplatesInjectable).get();
  },
});

export default initialUserResourceTemplatesListenerInjectable;
