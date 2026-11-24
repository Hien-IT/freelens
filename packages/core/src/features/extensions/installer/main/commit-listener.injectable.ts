/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import path from "node:path";
import { loggerInjectionToken } from "@freelensapp/logger";
import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import { noop } from "@freelensapp/utilities";
import fse from "fs-extra";
import extractTarInjectable from "../../../../common/fs/main/extract-tar.injectable";
import { sanitizeExtensionName } from "../../../../extensions/lens-extension";
import { computeTarballDigest, shortenDigest } from "../common/checksums";
import extensionsRootInjectable from "../common/extensions-root.injectable";
import { commitExtensionPackageChannel } from "../common/install-channels";
import { versionDirectoryName } from "../common/version-directory";
import activateInstalledBuildInjectable from "./activate-installed-build.injectable";
import { discardTarball } from "./discard-tarball";
import { managedDirectoryOf } from "./managed-directory";
import stagedExtensionPackagesInjectable from "./staged-packages.injectable";

/**
 * Turns a staged tarball into a managed install. Everything in the tarball is
 * extracted, not only the code, and the tarball is not kept, so the digest is
 * computed while its bytes are in hand.
 */
const commitExtensionPackageListenerInjectable = getRequestChannelListenerInjectable({
  id: "commit-extension-package-listener",
  channel: commitExtensionPackageChannel,
  getHandler: (di) => {
    const staged = di.inject(stagedExtensionPackagesInjectable);
    const extensionsRoot = di.inject(extensionsRootInjectable);
    const activateInstalledBuild = di.inject(activateInstalledBuildInjectable);
    const extractTar = di.inject(extractTarInjectable);
    const logger = di.inject(loggerInjectionToken);

    return async ({ stagingId, source, verified }) => {
      const stagedPackage = staged.get(stagingId);

      if (!stagedPackage) {
        throw new Error("the package is not staged, or was committed or discarded already");
      }

      // an id is good for one commit
      staged.delete(stagingId);

      const {
        fileName,
        tempFile,
        data,
        manifest: { name, version },
      } = stagedPackage;
      const digest = computeTarballDigest(data);
      const buildFolder = path.join(extensionsRoot, sanitizeExtensionName(name), versionDirectoryName(version, digest));
      const unpackingTempFolder = path.join(path.dirname(tempFile), `${path.basename(tempFile)}-unpacked`);

      logger.info(`Unpacking extension ${name}@${version}`, { fileName, tempFile, buildFolder });

      try {
        const managedDirectory = managedDirectoryOf(extensionsRoot, buildFolder);

        // A name or a version that reaches outside its own directory would let
        // the removal below delete something that is not this extension's.
        if (!managedDirectory || path.dirname(buildFolder) !== managedDirectory) {
          throw new Error(`the install path ${buildFolder} is outside of the extensions directory`);
        }

        await fse.remove(unpackingTempFolder).catch(noop);
        await fse.ensureDir(unpackingTempFolder);
        await extractTar(tempFile, { cwd: unpackingTempFolder });

        const unpackedFiles = await fse.readdir(unpackingTempFolder);
        let unpackedRootFolder = unpackingTempFolder;

        if (unpackedFiles.length === 1) {
          // check if %extension.tgz was packed with single top folder,
          // e.g. "npm pack %ext_name" downloads file with "package" root folder within tarball
          unpackedRootFolder = path.join(unpackingTempFolder, unpackedFiles[0]);
        }

        await fse.remove(buildFolder).catch(noop);
        await fse.ensureDir(path.dirname(buildFolder));
        await fse.move(unpackedRootFolder, buildFolder, { overwrite: true });
        await activateInstalledBuild({
          name,
          path: buildFolder,
          version,
          digest: shortenDigest(digest),
          source,
          verified,
        });

        return { id: name, version };
      } finally {
        await fse.remove(unpackingTempFolder).catch(noop);
        await discardTarball(tempFile);
      }
    };
  },
});

export default commitExtensionPackageListenerInjectable;
