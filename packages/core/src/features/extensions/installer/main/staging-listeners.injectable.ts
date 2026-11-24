/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { noop } from "@freelensapp/utilities";
import fse from "fs-extra";
import writeFileInjectable from "../../../../common/fs/main/write-file.injectable";
import tempDirectoryPathInjectable from "../../../../common/os/main/temp-directory-path.injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import { discardExtensionPackageChannel, stageExtensionPackageChannel } from "../common/install-channels";
import { discardTarball } from "./discard-tarball";
import stagedExtensionPackagesInjectable from "./staged-packages.injectable";
import { validatePackage } from "./validate-package";

export const stageExtensionPackageListenerInjectable = getRequestChannelListenerInjectable({
  id: "stage-extension-package-listener",
  channel: stageExtensionPackageChannel,
  getHandler: (di) => {
    const joinPaths = di.inject(joinPathsInjectable);
    const staged = di.inject(stagedExtensionPackagesInjectable);
    const writeFile = di.inject(writeFileInjectable);

    return async ({ fileName, base64 }) => {
      if (/[/\\]/.test(fileName) || fileName.includes("..")) {
        throw new Error(`"${fileName}" is not the name of a package`);
      }

      const data = new Uint8Array(Buffer.from(base64, "base64"));
      let directory: string | undefined;

      try {
        // A directory of this install's own, created with a random name and
        // readable by this user alone: the tarball is read again after it is
        // validated, so nobody else may be able to replace it in between, and
        // two installs of the same file name must not overwrite each other.
        directory = await fse.mkdtemp(joinPaths(di.inject(tempDirectoryPathInjectable), "freelens-extension-"));

        const tempFile = joinPaths(directory, fileName);

        await writeFile(tempFile, data);

        const manifest = await validatePackage(tempFile);
        const stagingId = globalThis.crypto.randomUUID();

        staged.set(stagingId, { fileName, tempFile, data, manifest });

        return { stagingId, manifest };
      } catch (error) {
        if (directory) {
          await fse.remove(directory).catch(noop);
        }

        throw error;
      }
    };
  },
});

export const discardExtensionPackageListenerInjectable = getRequestChannelListenerInjectable({
  id: "discard-extension-package-listener",
  channel: discardExtensionPackageChannel,
  getHandler: (di) => {
    const staged = di.inject(stagedExtensionPackagesInjectable);

    return async ({ stagingId }) => {
      const stagedPackage = staged.get(stagingId);

      staged.delete(stagingId);

      if (stagedPackage) {
        await discardTarball(stagedPackage.tempFile);
      }
    };
  },
});
