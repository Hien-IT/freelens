/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import getDirnameOfPathInjectable from "../../../../common/path/get-dirname.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import { prepareExtensionStoreInjectionToken } from "../common/prepare";
import preparedExtensionStoreFilesInjectable from "./prepared-files.injectable";
import readExtensionStoreFileInjectable from "./read-store-file.injectable";
import writeExtensionStoreFileInjectable from "./write-store-file.injectable";

/** Reads the store's file through main, which also gives its folder, so the renderer computes no path. */
const prepareExtensionStoreInjectable = getInjectable({
  id: "prepare-extension-store-for-renderer",
  instantiate: (di) => {
    const readStoreFile = di.inject(readExtensionStoreFileInjectable);
    const writeStoreFile = di.inject(writeExtensionStoreFileInjectable);
    const preparedFiles = di.inject(preparedExtensionStoreFilesInjectable);
    const getDirnameOfPath = di.inject(getDirnameOfPathInjectable);
    const joinPaths = di.inject(joinPathsInjectable);
    const logger = di.inject(loggerInjectionToken);

    return ({ storeName: _storeName, ...request }) => {
      const { path, contents } = readStoreFile(request);
      const folder = getDirnameOfPath(path);

      preparedFiles.set(joinPaths(folder, request.configName), {
        path,
        contents,
        write: (written) => {
          writeStoreFile(request, written).catch((error) => {
            logger.error(`[EXTENSION-STORE]: failed to write ${path}`, error);
          });
        },
      });

      return folder;
    };
  },
  injectionToken: prepareExtensionStoreInjectionToken,
});

export default prepareExtensionStoreInjectable;
