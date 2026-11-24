/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

import type { LensExtensionId } from "../../../../extensions/installed-extension";

/** The file of an extension's store; main computes its path from what it knows of the extension. */
export interface ExtensionStoreFileRequest {
  extensionId: LensExtensionId;
  configName: string;
  fileExtension?: string;
  encryptionKey?: string | Uint8Array;
  encryptionAlgorithm?: string;
  /** The folder the extension gave, which main uses as it is. */
  cwd?: string;
}

export interface ExtensionStoreFile {
  path: string;
  /** The text of the file, decrypted; left out when there is no file yet. */
  contents?: string;
}

export type ExtensionStoreReadAnswer = { ok: true; file: ExtensionStoreFile } | { ok: false; error: string };

/**
 * Read synchronously, on the IPC of the extension system: a store loads in
 * `ExtensionStore.loadExtension`, which is synchronous and public.
 */
export const extensionStoreReadChannel = "extension-store:read";

export const extensionStoreWriteChannel = getRequestChannel<ExtensionStoreFileRequest & { contents: string }, void>(
  "extension-store:write",
);
