/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import preparedExtensionStoreFilesInjectable from "../../../features/extensions/stores/renderer/prepared-files.injectable";
import persistentStorageInitialValuesInjectable from "../../../features/persistent-storage/renderer/initial-values.injectable";
import joinPathsInjectable from "../../path/join-paths.injectable";
import { configurationFileModelImplementationInjectionToken } from "../implementation-token";
import { ConfCompatible } from "./conf-compatible";

import type Config from "conf";
import type { Options as ConfOptions } from "conf";

import type { GetConfigurationFileModel } from "../get-configuration-file-model.injectable";

/**
 * The model main holds, seeded from what it answered before the frame
 * started. The renderer writes nothing to the file: its changes go to main,
 * which saves them.
 */
const getConfigurationFileModelForRendererInjectable = getInjectable({
  id: "get-configuration-file-model-for-renderer",
  instantiate: (di): GetConfigurationFileModel => {
    const initialValues = di.inject(persistentStorageInitialValuesInjectable);
    const joinPaths = di.inject(joinPathsInjectable);
    const preparedExtensionStoreFiles = di.inject(preparedExtensionStoreFilesInjectable);

    return <T extends Record<string, unknown>>(options: ConfOptions<T>) => {
      const { configName = "config", cwd = "", fileExtension = "json", defaults } = options;
      const preparedKey = joinPaths(cwd, configName);
      const preparedFile = preparedExtensionStoreFiles.get(preparedKey);

      // an extension's store, whose file main read for it: every option of conf applies
      if (preparedFile) {
        preparedExtensionStoreFiles.delete(preparedKey);

        return new ConfCompatible(options, preparedFile) as unknown as Config<T>;
      }

      const entry = initialValues.get(configName);

      return {
        store: (entry?.model ?? defaults ?? {}) as T,
        // a store main has not loaded is named as main would name its file
        path: entry?.path ?? joinPaths(cwd, `${configName}.${fileExtension}`),
      } as Partial<Config<T>> as Config<T>;
    };
  },
  injectionToken: configurationFileModelImplementationInjectionToken,
});

export default getConfigurationFileModelForRendererInjectable;
