/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import readResourceFolderInjectable from "../../../../common/k8s/main/read-resource-folder.injectable";
import { readResourceStackFolderChannel } from "../common/channel";

const readResourceStackFolderListenerInjectable = getRequestChannelListenerInjectable({
  id: "read-resource-stack-folder-listener",
  channel: readResourceStackFolderChannel,
  getHandler: (di) => {
    const readResourceFolder = di.inject(readResourceFolderInjectable);

    return ({ folderPath }) => readResourceFolder(folderPath);
  },
});

export default readResourceStackFolderListenerInjectable;
