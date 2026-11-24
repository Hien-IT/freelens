/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { onLoadOfApplicationInjectionToken } from "@freelensapp/application";
import { getInjectable } from "@ogre-tools/injectable";
import ipcMainInjectionToken from "../../../../extensions/ipc/main/ipc-main-injection-token";
import { extensionStoreReadChannel } from "../common/channels";
import readExtensionStoreFileInjectable from "./read-store-file.injectable";

import type { ExtensionStoreFileRequest, ExtensionStoreReadAnswer } from "../common/channels";

/** Answers the synchronous read of a store's file with `event.returnValue`. */
const listenForExtensionStoreReadsInjectable = getInjectable({
  id: "listen-for-extension-store-reads",
  instantiate: (di) => ({
    run: () => {
      const readExtensionStoreFile = di.inject(readExtensionStoreFileInjectable);

      di.inject(ipcMainInjectionToken).on(extensionStoreReadChannel, (event, request: ExtensionStoreFileRequest) => {
        let answer: ExtensionStoreReadAnswer;

        try {
          answer = { ok: true, file: readExtensionStoreFile(request) };
        } catch (error) {
          answer = { ok: false, error: error instanceof Error ? error.message : String(error) };
        }

        event.returnValue = answer;
      });
    },
  }),
  injectionToken: onLoadOfApplicationInjectionToken,
});

export default listenForExtensionStoreReadsInjectable;
