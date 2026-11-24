/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { showErrorNotificationInjectable } from "@freelensapp/notifications";
import { getInjectable } from "@ogre-tools/injectable";
import getBasenameOfPathInjectable from "../../../../common/path/get-basename.injectable";
import { parseChecksumSidecar } from "../../../../features/extensions/installer/common/checksums";
import { readExtensionPathChannel } from "../../../../features/extensions/installer/common/install-channels";
import { getMessageFromError } from "../get-message-from-error/get-message-from-error";
import attemptInstallInjectable from "./attempt-install.injectable";
import { fromBase64 } from "./to-base64";

import type { InstallChecksum } from "../../../../features/extensions/installer/common/checksums";

export type InstallFromFile = (filePath: string) => Promise<void>;

const sidecarSuffix = ".sha256";

const installFromFileInjectable = getInjectable({
  id: "install-from-file",
  instantiate: (di): InstallFromFile => {
    const attemptInstall = di.inject(attemptInstallInjectable);
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);
    const showErrorNotification = di.inject(showErrorNotificationInjectable);
    const getBasenameOfPath = di.inject(getBasenameOfPathInjectable);
    const logger = di.inject(loggerInjectionToken);

    /**
     * The digest of the \`.sha256\` sidecar beside the package, which main read
     * with it. A sidecar that is not there, or says nothing about this file, is
     * no checksum, so the extension installs disabled.
     */
    const checksumOf = (filePath: string, sidecar: string | undefined): InstallChecksum | undefined => {
      if (sidecar === undefined) {
        return undefined;
      }

      const value = parseChecksumSidecar(sidecar, getBasenameOfPath(filePath));

      if (!value) {
        logger.info(`[EXTENSION-INSTALL]: the checksum at ${filePath}${sidecarSuffix} says nothing about ${filePath}`);
      }

      return value ? { kind: "sha256", value } : undefined;
    };

    return async (filePath) => {
      let contents;

      try {
        // main reads the package the user chose, and its sidecar
        contents = await requestFromChannel(readExtensionPathChannel, { path: filePath });
      } catch (error) {
        const message = getMessageFromError(error);

        logger.info(`[EXTENSION-INSTALL]: preloading ${filePath} has failed: ${message}`, { error });
        showErrorNotification(`Error while reading "${filePath}": ${message}`);

        return;
      }

      if (contents.kind !== "file") {
        showErrorNotification(`Error while reading "${filePath}": it is a directory`);

        return;
      }

      return attemptInstall({
        fileName: getBasenameOfPath(filePath),
        data: fromBase64(contents.base64),
        source: { kind: "file", path: filePath },
        checksum: checksumOf(filePath, contents.sidecar),
      });
    };
  },
});

export default installFromFileInjectable;
