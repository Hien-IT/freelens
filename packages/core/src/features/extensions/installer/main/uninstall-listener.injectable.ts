/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import extensionDiscoveryInjectable from "../../../../extensions/extension-discovery/main/extension-discovery.injectable";
import { uninstallExtensionChannel } from "../common/uninstall-channel";

const uninstallExtensionListenerInjectable = getRequestChannelListenerInjectable({
  id: "uninstall-extension-listener",
  channel: uninstallExtensionChannel,
  getHandler: (di) => (extensionId) => di.inject(extensionDiscoveryInjectable).uninstallExtension(extensionId),
});

export default uninstallExtensionListenerInjectable;
