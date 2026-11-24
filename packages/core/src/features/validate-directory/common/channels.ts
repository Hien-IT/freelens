/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

export type DirectoryValidation = { ok: true } | { ok: false; error: string };

/** Whether a path the user typed is a directory; main reads only its kind, never its contents. */
export const validateDirectoryChannel = getRequestChannel<string, DirectoryValidation>("validate-directory");

/** Whether a path the user typed exists. */
export const pathExistsChannel = getRequestChannel<string, boolean>("path-exists");
