/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

export interface CorruptStorageFile {
  cwd: string;
  configName: string;
  fileExtension: string | undefined;
  displayName: string;
  error: SyntaxError;
}

/**
 * Keeps a copy of a store's file that is not valid JSON, before it is reset.
 * Only main reads the file; the renderer's model never fails so.
 */
export const backupCorruptStorageFileInjectionToken = getInjectionToken<(file: CorruptStorageFile) => void>({
  id: "backup-corrupt-storage-file",
});
