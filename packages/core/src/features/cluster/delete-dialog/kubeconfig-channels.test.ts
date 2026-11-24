/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { Cluster } from "../../../common/cluster/cluster";
import readFileInjectable from "../../../common/fs/main/read-file.injectable";
import writeFileInjectable from "../../../common/fs/main/write-file.injectable";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import clustersStateInjectable from "../storage/common/state.injectable";
import clusterKubeconfigContextsListenerInjectable from "./main/kubeconfig-contexts-listener.injectable";
import removeClusterContextFromKubeconfigListenerInjectable from "./main/remove-context-listener.injectable";
import saveKubeconfigInjectable from "./main/save-kubeconfig.injectable";
import requestClusterKubeconfigContextsInjectable from "./renderer/request-kubeconfig-contexts.injectable";
import requestRemoveClusterContextInjectable from "./renderer/request-remove-context.injectable";

import type { KubeConfig } from "@kubernetes/client-node";
import type { DiContainer } from "@ogre-tools/injectable";

const token = "some-secret-token";

const kubeconfig = `
apiVersion: v1
kind: Config
clusters:
  - name: some-cluster
    cluster:
      server: https://some-server:6443
users:
  - name: some-user
    user:
      token: ${token}
contexts:
  - name: some-context
    context:
      cluster: some-cluster
      user: some-user
      namespace: some-namespace
  - name: some-other-context
    context:
      cluster: some-cluster
      user: some-user
current-context: some-context
`;

describe("cluster-kubeconfig-contexts and remove-cluster-context-from-kubeconfig", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;

  beforeEach(async () => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;
    await mainDi.inject(writeFileInjectable)("/some-kube/config", kubeconfig);
    mainDi
      .inject(clustersStateInjectable)
      .set(
        "some-cluster-id",
        new Cluster({ id: "some-cluster-id", contextName: "some-context", kubeConfigPath: "/some-kube/config" }),
      );
    both.listenInMain(
      clusterKubeconfigContextsListenerInjectable,
      removeClusterContextFromKubeconfigListenerInjectable,
    );
  });

  it("answers the contexts, the current one and the namespace of the cluster's context", async () => {
    expect(await rendererDi.inject(requestClusterKubeconfigContextsInjectable)("some-cluster-id")).toEqual({
      contexts: ["some-context", "some-other-context"],
      currentContext: "some-context",
      defaultNamespace: "some-namespace",
    });
  });

  it("answers no credential", async () => {
    const answer = await rendererDi.inject(requestClusterKubeconfigContextsInjectable)("some-cluster-id");

    expect(JSON.stringify(answer)).not.toContain(token);
  });

  it("refuses a cluster main does not have", async () => {
    await expect(rendererDi.inject(requestClusterKubeconfigContextsInjectable)("no-such-cluster")).rejects.toThrow(
      'Cluster "no-such-cluster" is not registered',
    );
    await expect(rendererDi.inject(requestRemoveClusterContextInjectable)("no-such-cluster")).rejects.toThrow(
      "is not registered",
    );
  });

  it("removes the cluster's context and sets the new current context, under the lock of the file", async () => {
    // the lock itself needs a real file, so the saver runs with its lock left out
    mainDi.override(saveKubeconfigInjectable, () => async (filePath: string, update: (config: KubeConfig) => void) => {
      const { KubeConfig } = await import("@kubernetes/client-node");
      const config = new KubeConfig();

      config.loadFromString(await mainDi.inject(readFileInjectable)(filePath));
      update(config);
      await mainDi.inject(writeFileInjectable)(filePath, config.exportConfig());
    });

    await rendererDi.inject(requestRemoveClusterContextInjectable)("some-cluster-id", "some-other-context");

    expect(await rendererDi.inject(requestClusterKubeconfigContextsInjectable)("some-cluster-id")).toEqual(
      expect.objectContaining({ contexts: ["some-other-context"], currentContext: "some-other-context" }),
    );
  });
});
