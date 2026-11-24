/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cluster } from "../../../common/cluster/cluster";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import clustersStateInjectable from "../storage/common/state.injectable";
import revealClusterKubeconfigRequestListenerInjectable from "./main/request-listener.injectable";
import showItemInFolderInjectable from "./main/show-item-in-folder.injectable";
import revealClusterKubeconfigInjectable from "./renderer/reveal-cluster-kubeconfig.injectable";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

describe("reveal-cluster-kubeconfig", () => {
  let rendererDi: DiContainer;
  let showItemInFolder: Mock<(path: string) => void>;

  beforeEach(() => {
    const { mainDi, rendererDi: renderer, listenInMain } = getMainAndRenderer();

    rendererDi = renderer;

    showItemInFolder = vi.fn<(path: string) => void>();
    mainDi.override(showItemInFolderInjectable, () => showItemInFolder);
    mainDi
      .inject(clustersStateInjectable)
      .set(
        "some-cluster",
        new Cluster({ id: "some-cluster", contextName: "some-context", kubeConfigPath: "/some/kube/config" }),
      );
    listenInMain(revealClusterKubeconfigRequestListenerInjectable);
  });

  it("shows the kubeconfig file of the cluster that main has", async () => {
    await rendererDi.inject(revealClusterKubeconfigInjectable)("some-cluster");

    expect(showItemInFolder).toHaveBeenCalledWith("/some/kube/config");
  });

  it("refuses a cluster that main does not have", async () => {
    await expect(rendererDi.inject(revealClusterKubeconfigInjectable)("some-other-cluster")).rejects.toThrow(
      'Cannot reveal the kubeconfig of cluster "some-other-cluster", which is not registered',
    );

    expect(showItemInFolder).not.toHaveBeenCalled();
  });
});
