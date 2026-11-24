/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import { showErrorNotificationInjectable } from "@freelensapp/notifications";
import { getInjectable } from "@ogre-tools/injectable";
import { stageExtensionPackageChannel } from "../../../../features/extensions/installer/common/install-channels";
import { getMessageFromError } from "../get-message-from-error/get-message-from-error";
import { toBase64 } from "./to-base64";

import type { LensExtensionId, LensExtensionManifest } from "../../../../extensions/installed-extension";
import type { InstallChecksum } from "../../../../features/extensions/installer/common/checksums";
import type { InstalledExtensionSource } from "../../../../features/extensions/installer/common/installed-extensions";
import type { InstallRequest } from "./attempt-install.injectable";

export interface InstallRequestValidated {
  fileName: string;
  data: Uint8Array;
  id: LensExtensionId;
  manifest: LensExtensionManifest;
  /**
   * The id main staged the packed extension under, in a directory of its own,
   * good for one commit or discard.
   */
  stagingId: string;
  source?: InstalledExtensionSource;
  checksum?: InstallChecksum;
}

export type CreateTempFilesAndValidate = (request: InstallRequest) => Promise<InstallRequestValidated | null>;

const createTempFilesAndValidateInjectable = getInjectable({
  id: "create-temp-files-and-validate",
  instantiate: (di): CreateTempFilesAndValidate => {
    const logger = di.inject(loggerInjectionToken);
    const requestFromChannel = di.inject(requestFromChannelInjectionToken);
    const showErrorNotification = di.inject(showErrorNotificationInjectable);

    return async ({ fileName, data, source, checksum }) => {
      try {
        // main writes the tarball where nobody else can replace it, and reads its manifest
        const { stagingId, manifest } = await requestFromChannel(stageExtensionPackageChannel, {
          fileName,
          base64: toBase64(data),
        });

        return {
          fileName,
          data,
          manifest,
          stagingId,
          source,
          checksum,
          // An extension is identified by its name, independently of which
          // version of it happens to be installed.
          id: manifest.name,
        };
      } catch (error) {
        const message = getMessageFromError(error);

        logger.info(`[EXTENSION-INSTALLATION]: installing ${fileName} has failed: ${message}`, { error });
        showErrorNotification(
          <div className="flex flex-col gap-2">
            <p>
              {"Installing "}
              <em>{fileName}</em>
              {" has failed, skipping."}
            </p>
            <p>
              {"Reason: "}
              <em>{message}</em>
            </p>
          </div>,
        );
      }

      return null;
    };
  },
});

export default createTempFilesAndValidateInjectable;
