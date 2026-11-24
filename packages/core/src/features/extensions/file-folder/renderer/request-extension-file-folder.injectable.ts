/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { extensionFileFolderChannel } from "../common/channel";

import type { LensExtensionId } from "../../../../extensions/installed-extension";

const requestExtensionFileFolderInjectable = getInjectable({
  id: "request-extension-file-folder",
  instantiate: (di) => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (extensionId: LensExtensionId) => requestFromChannel(extensionFileFolderChannel, extensionId);
  },
});

export default requestExtensionFileFolderInjectable;
