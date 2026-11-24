/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import readJsonFileInjectable from "../../../common/fs/main/read-json-file.injectable";
import { lensLocalStorageReadChannel } from "../common/channels";
import lensLocalStorageFilePathInjectable from "./file-path.injectable";

const lensLocalStorageReadListenerInjectable = getRequestChannelListenerInjectable({
  id: "lens-local-storage-read-listener",
  channel: lensLocalStorageReadChannel,
  getHandler: (di) => {
    const readJsonFile = di.inject(readJsonFileInjectable);
    const getFilePath = di.inject(lensLocalStorageFilePathInjectable);

    return async ({ clusterId }) => {
      const filePath = getFilePath(clusterId);

      try {
        const contents = await readJsonFile(filePath);

        return typeof contents === "object" && contents !== null ? (contents as Record<string, unknown>) : {};
      } catch {
        // a missing or unreadable file is an empty state, as it was when the renderer read it
        return {};
      }
    };
  },
});

export default lensLocalStorageReadListenerInjectable;
