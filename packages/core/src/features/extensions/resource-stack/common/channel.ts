/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { ResourceFile } from "../../../../common/k8s/read-resource-folder";

/** The files of the folder an extension's resource stack applies, as the extension names it. */
export const readResourceStackFolderChannel = getRequestChannel<{ folderPath: string }, ResourceFile[]>(
  "extension-resource-stack:read-folder",
);
