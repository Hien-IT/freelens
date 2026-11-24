/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { LensExtensionId } from "../../../../extensions/installed-extension";

/** The folder of an extension's own files, which main creates the first time it is asked for. */
export const extensionFileFolderChannel = getRequestChannel<LensExtensionId, string>("extension-file-folder");
