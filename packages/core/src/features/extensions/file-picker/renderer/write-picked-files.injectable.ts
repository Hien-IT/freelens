/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { getInjectable } from "@ogre-tools/injectable";
import { writePickedFilesChannel } from "../common/channel";

/** The bytes as base64, in chunks, as `String.fromCharCode` takes its arguments on the stack. */
const toBase64 = (bytes: Uint8Array) => {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
};

export type WritePickedFiles = (uploadDir: string, files: File[]) => Promise<string[]>;

const writePickedFilesInjectable = getInjectable({
  id: "write-picked-files",
  instantiate: (di): WritePickedFiles => {
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);

    return async (uploadDir, files) =>
      requestFromChannel(writePickedFilesChannel, {
        uploadDir,
        files: await Promise.all(
          files.map(async (file) => ({ name: file.name, base64: toBase64(new Uint8Array(await file.arrayBuffer())) })),
        ),
      });
  },
});

export default writePickedFilesInjectable;
