/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { readResourceStackFolderChannel } from "../../../features/extensions/resource-stack/common/channel";
import { readResourceFolderInjectionToken } from "../read-resource-folder";

const readResourceFolderInjectable = getInjectable({
  id: "read-resource-folder-in-renderer",
  instantiate: (di) => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return (folderPath: string) => requestFromChannel(readResourceStackFolderChannel, { folderPath });
  },
  injectionToken: readResourceFolderInjectionToken,
});

export default readResourceFolderInjectable;
