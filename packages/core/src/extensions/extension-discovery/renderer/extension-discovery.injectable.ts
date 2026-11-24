/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { uninstallExtensionChannel } from "../../../features/extensions/installer/common/uninstall-channel";
import ipcRendererInjectable from "../../ipc/ipc-renderer.injectable";
import { ExtensionDiscoveryFollower } from "./extension-discovery";

const extensionDiscoveryFollowerInjectable = getInjectable({
  id: "extension-discovery-follower",
  instantiate: (di) => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return new ExtensionDiscoveryFollower({
      requestUninstallExtension: (extensionId) => requestFromChannel(uninstallExtensionChannel, extensionId),
      ipcRenderer: di.inject(ipcRendererInjectable),
    });
  },
});

export default extensionDiscoveryFollowerInjectable;
