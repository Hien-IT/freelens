/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

export interface PickedFile {
  name: string;
  /** The bytes of the file, as base64. */
  base64: string;
}

/** Writes the files picked in a view into the folder the extension gave, answering their paths. */
export const writePickedFilesChannel = getRequestChannel<{ uploadDir: string; files: PickedFile[] }, string[]>(
  "extension-files:write-picked",
);
