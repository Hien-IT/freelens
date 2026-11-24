/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { extensionStoreWriteChannel } from "../common/channels";

import type { ExtensionStoreFileRequest } from "../common/channels";

const writeExtensionStoreFileInjectable = getInjectable({
  id: "write-extension-store-file",
  instantiate: (di) => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (request: ExtensionStoreFileRequest, contents: string) =>
      requestFromChannel(extensionStoreWriteChannel, { ...request, contents });
  },
});

export default writeExtensionStoreFileInjectable;
