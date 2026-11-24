/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import { extensionStoreReadChannel } from "../common/channels";

import type { IpcRenderer } from "electron";

import type { ExtensionStoreFile, ExtensionStoreFileRequest, ExtensionStoreReadAnswer } from "../common/channels";

/** Asks main for a store's file and waits for the answer, as a store loads synchronously. */
const readExtensionStoreFileInjectable = getInjectable({
  id: "read-extension-store-file",
  instantiate:
    () =>
    (request: ExtensionStoreFileRequest): ExtensionStoreFile => {
      // a local type, so that the declaration of the extension API does not carry the global
      const bridge = (globalThis as { freelensViewBridge?: { readonly ipcRenderer: Pick<IpcRenderer, "sendSync"> } })
        .freelensViewBridge;

      if (!bridge) {
        throw new Error("window.freelensViewBridge is missing, so the store cannot be read");
      }

      const answer = bridge.ipcRenderer.sendSync(extensionStoreReadChannel, request) as ExtensionStoreReadAnswer;

      if (!answer.ok) {
        throw new Error(answer.error);
      }

      return answer.file;
    },
});

export default readExtensionStoreFileInjectable;
