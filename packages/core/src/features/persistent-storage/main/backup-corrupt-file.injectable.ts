/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import readFileBufferSyncInjectable from "../../../common/fs/main/read-file-buffer-sync.injectable";
import writeBufferSyncInjectable from "../../../common/fs/main/write-buffer-sync.injectable";
import joinPathsInjectable from "../../../common/path/join-paths.injectable";
import { backupCorruptStorageFileInjectionToken } from "../common/backup-corrupt-file";

const backupCorruptStorageFileInjectable = getInjectable({
  id: "backup-corrupt-storage-file",
  instantiate: (di) => {
    const joinPaths = di.inject(joinPathsInjectable);
    const readFileBufferSync = di.inject(readFileBufferSyncInjectable);
    const writeBufferSync = di.inject(writeBufferSyncInjectable);
    const logger = di.inject(loggerInjectionToken);

    return ({ cwd, configName, fileExtension, displayName, error }) => {
      const filePath = joinPaths(cwd, `${configName}.${fileExtension ?? "json"}`);
      const backupPath = joinPaths(cwd, `${configName}.corrupt-${Date.now()}.json`);

      // A file that cannot be copied aside is not cleared either
      writeBufferSync(backupPath, readFileBufferSync(filePath));
      logger.error(`[${displayName}]: ${filePath} is not valid JSON, copied it to ${backupPath} and reset it`, error);
    };
  },
  injectionToken: backupCorruptStorageFileInjectionToken,
});

export default backupCorruptStorageFileInjectable;
