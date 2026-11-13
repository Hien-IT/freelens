/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { loggerInjectionToken } from "@freelensapp/logger";
import { getInjectable } from "@ogre-tools/injectable";
import { temporaryDirectory } from "tempy";
import removePathInjectable from "../../../common/fs/remove.injectable";
import writeFileInjectable from "../../../common/fs/write-file.injectable";
import joinPathsInjectable from "../../../common/path/join-paths.injectable";
import userPreferencesStateInjectable from "../../../features/user-preferences/common/state.injectable";
import kubeconfigManagerInjectable from "../../kubeconfig-manager/kubeconfig-manager.injectable";
import execHelmInjectable, { proxyKubeconfigHelmOptions } from "../exec-helm/exec-helm.injectable";
import getHelmReleaseInjectable from "./get-helm-release.injectable";

import type { Cluster } from "../../../common/cluster/cluster";

export interface UpdateChartArgs {
  chart: string;
  values: string;
  version: string;
  forceConflicts?: boolean;
}

const updateHelmReleaseInjectable = getInjectable({
  id: "update-helm-release",

  instantiate: (di) => {
    const logger = di.inject(loggerInjectionToken);
    const getHelmRelease = di.inject(getHelmReleaseInjectable);
    const writeFile = di.inject(writeFileInjectable);
    const removePath = di.inject(removePathInjectable);
    const joinPaths = di.inject(joinPathsInjectable);
    const execHelm = di.inject(execHelmInjectable);
    const state = di.inject(userPreferencesStateInjectable);

    return async (cluster: Cluster, releaseName: string, namespace: string, data: UpdateChartArgs) => {
      const proxyKubeconfigManager = di.inject(kubeconfigManagerInjectable, cluster);
      const proxyKubeconfig = await proxyKubeconfigManager.ensurePaths();
      const valuesDirectory = temporaryDirectory();
      const valuesFilePath = joinPaths(valuesDirectory, "values.yaml");

      logger.debug(`[HELM]: upgrading "${releaseName}" in "${namespace}" to ${data.version}`);

      try {
        await writeFile(valuesFilePath, data.values, { mode: 0o600 });

        // If forceConflicts is enabled, always use server-side
        // Otherwise, use the preference setting
        const useServerSide = data.forceConflicts || state.helmServerSide;

        const args = [
          "upgrade",
          releaseName,
          data.chart,
          "--version",
          data.version,
          "--values",
          valuesFilePath,
          "--namespace",
          namespace,
          "--kubeconfig",
          proxyKubeconfig.kubeconfigPath,
        ];

        if (data.forceConflicts) {
          args.push("--force-conflicts");
        }

        if (useServerSide) {
          args.push("--server-side=true");
        } else {
          args.push("--server-side=false");
        }

        const result = await execHelm(args, proxyKubeconfigHelmOptions(proxyKubeconfig));

        if (result.callWasSuccessful === false) {
          throw result.error; // keep the same interface
        }

        const releaseResult = await getHelmRelease({ cluster, releaseName, namespace });

        if (!releaseResult.callWasSuccessful) {
          throw releaseResult.error; // keep the same interface
        }

        return {
          log: result.response,
          release: releaseResult.response,
        };
      } finally {
        await removePath(valuesDirectory);
      }
    };
  },
});

export default updateHelmReleaseInjectable;
