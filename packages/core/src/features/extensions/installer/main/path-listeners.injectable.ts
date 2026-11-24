/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import pathExistsInjectable from "../../../../common/fs/main/path-exists.injectable";
import readFileInjectable from "../../../../common/fs/main/read-file.injectable";
import readFileBufferInjectable from "../../../../common/fs/main/read-file-buffer.injectable";
import readJsonFileInjectable from "../../../../common/fs/main/read-json-file.injectable";
import statInjectable from "../../../../common/fs/main/stat.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import { extensionPathKindChannel, readExtensionPathChannel } from "../common/install-channels";
import { manifestFilename, validateExtensionManifest } from "../common/manifest";

export const extensionPathKindListenerInjectable = getRequestChannelListenerInjectable({
  id: "extension-path-kind-listener",
  channel: extensionPathKindChannel,
  getHandler: (di) => {
    const stat = di.inject(statInjectable);

    return async ({ path }) => {
      const stats = await stat(path).catch(() => undefined);

      return !stats ? "missing" : stats.isDirectory() ? "directory" : "file";
    };
  },
});

/** Reads a package or a directory the user chose, as the renderer did before it lost Node. */
export const readExtensionPathListenerInjectable = getRequestChannelListenerInjectable({
  id: "read-extension-path-listener",
  channel: readExtensionPathChannel,
  getHandler: (di) => {
    const stat = di.inject(statInjectable);
    const readFileBuffer = di.inject(readFileBufferInjectable);
    const readFile = di.inject(readFileInjectable);
    const readJsonFile = di.inject(readJsonFileInjectable);
    const pathExists = di.inject(pathExistsInjectable);
    const joinPaths = di.inject(joinPathsInjectable);

    return async ({ path }) => {
      if ((await stat(path).catch(() => undefined))?.isDirectory()) {
        return {
          kind: "directory",
          manifest: validateExtensionManifest(await readJsonFile(joinPaths(path, manifestFilename))),
        };
      }

      const base64 = Buffer.from(await readFileBuffer(path)).toString("base64");
      const sidecarPath = `${path}.sha256`;
      // a sidecar that cannot be read is no checksum, as before
      const sidecar = (await pathExists(sidecarPath).catch(() => false))
        ? await readFile(sidecarPath).catch(() => undefined)
        : undefined;

      return { kind: "file", base64, ...(sidecar === undefined ? {} : { sidecar }) };
    };
  },
});
