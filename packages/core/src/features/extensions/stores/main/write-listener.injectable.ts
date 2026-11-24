/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import fsInjectable from "../../../../common/fs/main/fs.injectable";
import getDirnameOfPathInjectable from "../../../../common/path/get-dirname.injectable";
import { extensionStoreWriteChannel } from "../common/channels";
import { encryptStoreData } from "./store-crypto";
import extensionStoreFilePathInjectable from "./store-file-path.injectable";

/** Writes a store's file atomically, encrypted when the store has a key. */
const extensionStoreWriteListenerInjectable = getRequestChannelListenerInjectable({
  id: "extension-store-write-listener",
  channel: extensionStoreWriteChannel,
  getHandler: (di) => {
    const getPath = di.inject(extensionStoreFilePathInjectable);
    const getDirnameOfPath = di.inject(getDirnameOfPathInjectable);
    const { ensureDir, writeFile, rename } = di.inject(fsInjectable);
    // The writes of a file run one after another, in the order they arrive: a
    // migration sends one per step without waiting, and an earlier write that
    // finished last would leave its contents in the file.
    const lastWriteOf = new Map<string, Promise<void>>();

    return async ({ contents, ...request }) => {
      const path = getPath(request);
      const data = request.encryptionKey
        ? encryptStoreData(contents, request.encryptionKey, request.encryptionAlgorithm)
        : contents;
      const write = async () => {
        const temporaryPath = `${path}.tmp-${globalThis.crypto.randomUUID()}`;

        await ensureDir(getDirnameOfPath(path));
        await writeFile(temporaryPath, data);
        await rename(temporaryPath, path);
      };
      const thisWrite = (lastWriteOf.get(path) ?? Promise.resolve()).then(write, write);

      lastWriteOf.set(path, thisWrite);

      try {
        await thisWrite;
      } finally {
        if (lastWriteOf.get(path) === thisWrite) {
          lastWriteOf.delete(path);
        }
      }
    };
  },
});

export default extensionStoreWriteListenerInjectable;
