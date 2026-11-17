/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cluster } from "../../../../common/cluster/cluster";
import { getDiForUnitTesting } from "../../../../main/getDiForUnitTesting";
import installHelmChartInjectable from "../../../../main/helm/install-helm-chart.injectable";
import kubeconfigManagerInjectable from "../../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import { helmChartOf } from "../cluster-info";
import installTrafficSourceInjectable, { helmErrorMessage } from "../install-traffic-source.injectable";

import type { Mock } from "vitest";

import type { InstallHelmChart } from "../../../../main/helm/install-helm-chart.injectable";
import type { KubeconfigManager, ProxyKubeconfigPaths } from "../../../../main/kubeconfig-manager/kubeconfig-manager";
import type { InstallTrafficSource } from "../install-traffic-source.injectable";

const kubeconfig: ProxyKubeconfigPaths = {
  kubeconfigPath: "/some-directory-for-temp/kubeconfig-some-cluster-id",
  cacheDirectoryPath: "/some-directory-for-temp/kubecache-some-cluster-id",
};

describe("installing a traffic source", () => {
  let installHelmChartMock: Mock<InstallHelmChart>;
  let installTrafficSource: InstallTrafficSource;
  let cluster: Cluster;

  beforeEach(() => {
    const di = getDiForUnitTesting();

    installHelmChartMock = vi.fn<InstallHelmChart>(async () => ({
      log: "NAME: caretta",
      release: { name: "caretta", namespace: "caretta" },
    }));
    di.override(installHelmChartInjectable, () => installHelmChartMock);
    di.override(
      kubeconfigManagerInjectable,
      () => ({ ensurePaths: async () => kubeconfig }) as Partial<KubeconfigManager> as KubeconfigManager,
    );

    installTrafficSource = di.inject(installTrafficSourceInjectable);
    cluster = new Cluster({ id: "some-cluster-id", contextName: "some-context", kubeConfigPath: "/some-kubeconfig" });
  });

  it("installs the chart that main knows for the source, from its repository, through the proxy kubeconfig", async () => {
    const chart = helmChartOf("caretta")!;

    await installTrafficSource(cluster, "caretta");

    expect(installHelmChartMock).toHaveBeenCalledExactlyOnceWith({
      chart: chart.chartName,
      repoUrl: chart.repoUrl,
      name: chart.releaseName,
      namespace: chart.namespace,
      createNamespace: true,
      values: chart.values,
      version: undefined,
      kubeconfig,
    });
  });

  it("refuses a source that has no known chart, without running Helm", async () => {
    await expect(installTrafficSource(cluster, "hubble")).rejects.toThrow("No Helm chart is known for Hubble (Cilium)");
    expect(installHelmChartMock).not.toHaveBeenCalled();
  });

  it("fails with what Helm wrote to its standard error", async () => {
    installHelmChartMock.mockRejectedValue(
      Object.assign(new Error("Command failed: helm install caretta caretta"), {
        stderr: "Error: INSTALLATION FAILED: cannot re-use a name that is still in use\n",
      }),
    );

    await expect(installTrafficSource(cluster, "caretta")).rejects.toThrow(
      /^Error: INSTALLATION FAILED: cannot re-use a name that is still in use$/,
    );
  });
});

describe("helmErrorMessage", () => {
  it("prefers the standard error of Helm, trimmed, and falls back to the message of the error", () => {
    expect(helmErrorMessage(Object.assign(new Error("Command failed"), { stderr: "  Error: forbidden\n" }))).toBe(
      "Error: forbidden",
    );
    expect(helmErrorMessage(Object.assign(new Error(" Command failed \n"), { stderr: "" }))).toBe("Command failed");
    expect(helmErrorMessage("something else")).toBe("something else");
  });
});
