/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";
import installHelmChartInjectable from "../../../main/helm/install-helm-chart.injectable";
import kubeconfigManagerInjectable from "../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import { trafficSourceTitles } from "../common/types";
import { helmChartOf } from "./cluster-info";

import type { Cluster } from "../../../common/cluster/cluster";
import type { TrafficSourceName } from "../common/types";

export type InstallTrafficSource = (cluster: Cluster, source: TrafficSourceName) => Promise<void>;

/**
 * Why a Helm call failed: what Helm wrote to its standard error when it wrote
 * anything, else the message of the error, which for a failed command is only
 * the generic "Command failed: …".
 */
export function helmErrorMessage(error: unknown): string {
  const stderr =
    typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
      ? error.stderr.trim()
      : "";

  if (stderr) {
    return stderr;
  }

  return (error instanceof Error ? error.message : String(error)).trim();
}

/**
 * Installs a traffic source into a cluster with the Helm chart that main knows
 * for it, through the cluster's proxy. The caller names the source only: the
 * repository, the chart, the release, the namespace and the values come from
 * {@link helmChartOf}.
 */
const installTrafficSourceInjectable = getInjectable({
  id: "install-traffic-source",

  instantiate: (di): InstallTrafficSource => {
    const installHelmChart = di.inject(installHelmChartInjectable);

    return async (cluster, source) => {
      const chart = helmChartOf(source);

      if (!chart) {
        throw new Error(`No Helm chart is known for ${trafficSourceTitles[source]}`);
      }

      const kubeconfig = await di.inject(kubeconfigManagerInjectable, cluster).ensurePaths();

      try {
        await installHelmChart({
          chart: chart.chartName,
          repoUrl: chart.repoUrl,
          name: chart.releaseName,
          namespace: chart.namespace,
          createNamespace: true,
          values: chart.values ?? "",
          version: chart.version,
          kubeconfig,
        });
      } catch (error) {
        throw new Error(helmErrorMessage(error));
      }
    };
  },
});

export default installTrafficSourceInjectable;
