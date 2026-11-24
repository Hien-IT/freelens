/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { backupCorruptStorageFileInjectionToken } from "../common/backup-corrupt-file";

/** The renderer reads no file, so a parse error here is not a corrupt file. */
const backupCorruptStorageFileInjectable = getInjectable({
  id: "backup-corrupt-storage-file",
  instantiate:
    () =>
    ({ error }: { error: SyntaxError }) => {
      throw error;
    },
  injectionToken: backupCorruptStorageFileInjectionToken,
});

export default backupCorruptStorageFileInjectable;
