/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { parseKubeconfigTextChannel } from "../common/channels";
import { checkKubeconfigText } from "./check";

const parseKubeconfigTextListenerInjectable = getRequestChannelListenerInjectable({
  id: "parse-kubeconfig-text-listener",
  channel: parseKubeconfigTextChannel,
  getHandler: () => checkKubeconfigText,
});

export default parseKubeconfigTextListenerInjectable;
