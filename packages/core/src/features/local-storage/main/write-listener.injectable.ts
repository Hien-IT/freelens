/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import writeJsonFileInjectable from "../../../common/fs/main/write-json-file.injectable";
import { lensLocalStorageWriteChannel } from "../common/channels";
import lensLocalStorageFilePathInjectable from "./file-path.injectable";

const lensLocalStorageWriteListenerInjectable = getRequestChannelListenerInjectable({
  id: "lens-local-storage-write-listener",
  channel: lensLocalStorageWriteChannel,
  getHandler: (di) => {
    const writeJsonFile = di.inject(writeJsonFileInjectable);
    const getFilePath = di.inject(lensLocalStorageFilePathInjectable);

    return ({ clusterId, state }) => writeJsonFile(getFilePath(clusterId), state);
  },
});

export default lensLocalStorageWriteListenerInjectable;
