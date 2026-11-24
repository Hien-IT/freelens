/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { dumpYaml } from "@kubernetes/client-node";
import { getInjectable } from "@ogre-tools/injectable";
import * as lockFile from "proper-lockfile";
import writeFileInjectable from "../../../../common/fs/main/write-file.injectable";
import loadConfigFromFileInjectable from "../../../../common/kube-helpers/main/load-config-from-file.injectable";

import type { KubeConfig } from "@kubernetes/client-node";

/** Reads, changes and writes a kubeconfig file while holding its lock. */
export type SaveKubeconfig = (filePath: string, update: (config: KubeConfig) => void) => Promise<void>;

const saveKubeconfigInjectable = getInjectable({
  id: "save-kubeconfig",
  instantiate: (di): SaveKubeconfig => {
    const writeFile = di.inject(writeFileInjectable);
    const loadConfigFromFile = di.inject(loadConfigFromFileInjectable);

    return async (filePath, update) => {
      const release = await lockFile.lock(filePath);

      try {
        const { config } = await loadConfigFromFile(filePath);

        update(config);
        await writeFile(filePath, dumpYaml(JSON.parse(config.exportConfig())));
      } finally {
        await release();
      }
    };
  },
  causesSideEffects: true,
});

export default saveKubeconfigInjectable;
