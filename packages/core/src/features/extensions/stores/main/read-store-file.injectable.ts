/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import pathExistsSyncInjectable from "../../../../common/fs/main/path-exists-sync.injectable";
import readFileBufferSyncInjectable from "../../../../common/fs/main/read-file-buffer-sync.injectable";
import { decryptStoreData } from "./store-crypto";
import extensionStoreFilePathInjectable from "./store-file-path.injectable";

import type { ExtensionStoreFile, ExtensionStoreFileRequest } from "../common/channels";

const readExtensionStoreFileInjectable = getInjectable({
  id: "read-extension-store-file",
  instantiate: (di) => {
    const getPath = di.inject(extensionStoreFilePathInjectable);
    const pathExistsSync = di.inject(pathExistsSyncInjectable);
    const readFileBufferSync = di.inject(readFileBufferSyncInjectable);

    return (request: ExtensionStoreFileRequest): ExtensionStoreFile => {
      const path = getPath(request);

      if (!pathExistsSync(path)) {
        return { path };
      }

      const data = readFileBufferSync(path);
      const contents = request.encryptionKey
        ? decryptStoreData(data, request.encryptionKey, request.encryptionAlgorithm)
        : Buffer.from(data).toString("utf8");

      return { path, contents };
    };
  },
});

export default readExtensionStoreFileInjectable;
