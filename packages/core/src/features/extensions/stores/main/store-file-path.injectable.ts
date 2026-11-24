/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import joinPathsInjectable from "../../../../common/path/join-paths.injectable";
import extensionLoaderInjectable from "../../../../extensions/extension-loader/extension-loader.injectable";
import prepareExtensionStoreInjectable from "./prepare.injectable";

import type { ExtensionStoreFileRequest } from "../common/channels";

const refusesName = (name: string) => /[/\\]/.test(name) || name.includes("..");

/** The path of a store's file, which main computes; a name that would leave the folder is refused. */
const extensionStoreFilePathInjectable = getInjectable({
  id: "extension-store-file-path",
  instantiate: (di) => {
    const joinPaths = di.inject(joinPathsInjectable);
    const extensionLoader = di.inject(extensionLoaderInjectable);
    const prepare = di.inject(prepareExtensionStoreInjectable);

    return ({ extensionId, configName, fileExtension = "json", cwd }: ExtensionStoreFileRequest) => {
      for (const name of [configName, fileExtension]) {
        if (refusesName(name)) {
          throw new Error(`"${name}" is not a name of a store file`);
        }
      }

      const extension = extensionLoader.getExtensionById(extensionId);

      if (!extension) {
        throw new Error(`Extension "${extensionId}" is not installed`);
      }

      const folder = prepare({
        extensionId,
        configName,
        cwd,
        storeName: extension.manifest.storeName || extension.manifest.name,
      });

      return joinPaths(folder, `${configName}.${fileExtension}`);
    };
  },
});

export default extensionStoreFilePathInjectable;
