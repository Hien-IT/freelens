/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { openExtensionFolderChannel } from "../common/install-channels";
import getExtensionDestFolderInjectable from "./get-extension-dest-folder.injectable";
import openPathInjectable from "./open-path.injectable";

const openExtensionFolderListenerInjectable = getRequestChannelListenerInjectable({
  id: "open-extension-folder-listener",
  channel: openExtensionFolderChannel,
  getHandler: (di) => {
    const getExtensionDestFolder = di.inject(getExtensionDestFolderInjectable);
    const openPath = di.inject(openPathInjectable);

    return async ({ name }) => {
      await openPath(getExtensionDestFolder(name));
    };
  },
});

export default openExtensionFolderListenerInjectable;
