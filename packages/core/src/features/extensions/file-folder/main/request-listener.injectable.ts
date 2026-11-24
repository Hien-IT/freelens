/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannelListenerInjectable } from "@freelensapp/messaging";
import extensionLoaderInjectable from "../../../../extensions/extension-loader/extension-loader.injectable";
import ensureHashedDirectoryForExtensionInjectable from "../../../../extensions/extension-loader/file-system-provisioner-store/main/ensure-hashed-directory-for-extension.injectable";
import { extensionFileFolderChannel } from "../common/channel";

const extensionFileFolderListenerInjectable = getRequestChannelListenerInjectable({
  id: "extension-file-folder-listener",
  channel: extensionFileFolderChannel,
  getHandler: (di) => {
    const ensureHashedDirectoryForExtension = di.inject(ensureHashedDirectoryForExtensionInjectable);
    const extensionLoader = di.inject(extensionLoaderInjectable);

    return (extensionId) => {
      const extension = extensionLoader.getExtensionById(extensionId);

      if (!extension) {
        throw new Error(`Extension "${extensionId}" is not installed`);
      }

      // the store name, as LensExtension.storeName gives it
      return ensureHashedDirectoryForExtension(extension.manifest.storeName || extension.manifest.name);
    };
  },
});

export default extensionFileFolderListenerInjectable;
