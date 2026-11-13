/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { Cluster } from "../../common/cluster/cluster";
import { ResourceApplier } from "./resource-applier";

import type { Logger } from "@freelensapp/logger";

import type { Mock } from "vitest";

import type { ExecFile } from "../../common/fs/exec-file.injectable";
import type { RemovePath } from "../../common/fs/remove.injectable";
import type { WriteFile } from "../../common/fs/write-file.injectable";
import type { KubeconfigManager } from "../kubeconfig-manager/kubeconfig-manager";
import type { Kubectl } from "../kubectl/kubectl";

const kubeconfigPath = "/some-directory-for-temp/kubeconfig-some-cluster-id";
const cacheDirectoryPath = "/some-directory-for-temp/kubecache-some-cluster-id";

describe("ResourceApplier", () => {
  let execFileMock: ReturnType<typeof vi.fn>;
  let writeFileMock: Mock<WriteFile>;
  let deleteFileMock: Mock<RemovePath>;
  let ensureKubectlMock: Mock<Kubectl["ensureKubectl"]>;
  let resourceApplier: ResourceApplier;

  beforeEach(() => {
    execFileMock = vi.fn(async () => ({ callWasSuccessful: true, response: "{}" }));
    writeFileMock = vi.fn<WriteFile>(async () => {});
    deleteFileMock = vi.fn<RemovePath>(async () => {});

    const cluster = new Cluster({
      id: "some-cluster-id",
      contextName: "some-context",
      kubeConfigPath: "/some-kubeconfig",
      preferences: { httpsProxy: "http://some-https-proxy:3128" },
    });
    ensureKubectlMock = vi.fn<Kubectl["ensureKubectl"]>(async () => true);

    const kubectl = {
      ensureKubectl: ensureKubectlMock,
      getPath: async () => "/some-kubectl",
    } as Partial<Kubectl> as Kubectl;
    const proxyKubeconfigManager = {
      ensurePaths: async () => ({ kubeconfigPath, cacheDirectoryPath }),
    } as Partial<KubeconfigManager> as KubeconfigManager;

    resourceApplier = new ResourceApplier(
      {
        emitAppEvent: vi.fn(),
        writeFile: writeFileMock,
        deleteFile: deleteFileMock,
        execFile: execFileMock as unknown as ExecFile,
        joinPaths: (...paths) => paths.join("/"),
        createKubectl: () => kubectl,
        withFreelensProxyCredentialEnv: (env) => env,
        proxyKubeconfigManager,
        logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), silly: vi.fn(), warn: vi.fn() } as Logger,
      },
      cluster,
    );
  });

  const withKubeCacheDir = () => expect.objectContaining({ KUBECACHEDIR: cacheDirectoryPath });

  it("patches with the proxy kubeconfig and its cache directory", async () => {
    await resourceApplier.patch("some-pod", "Pod", [], "some-namespace");

    expect(execFileMock).toHaveBeenCalledWith(
      "/some-kubectl",
      [
        "--kubeconfig",
        kubeconfigPath,
        "--cache-dir",
        cacheDirectoryPath,
        "patch",
        "Pod",
        "some-pod",
        "--namespace",
        "some-namespace",
        "--type",
        "json",
        "--patch",
        "[]",
        "-o",
        "json",
      ],
      { env: withKubeCacheDir() },
    );
  });

  it("applies with the proxy kubeconfig and its cache directory", async () => {
    await resourceApplier.create("apiVersion: v1\nkind: Pod\nmetadata:\n  name: some-pod\n");

    expect(execFileMock).toHaveBeenCalledWith(
      "/some-kubectl",
      [
        "apply",
        "--kubeconfig",
        kubeconfigPath,
        "--cache-dir",
        cacheDirectoryPath,
        "-o",
        "json",
        "-f",
        expect.any(String),
      ],
      { env: withKubeCacheDir() },
    );
  });

  // The cluster's HTTPS proxy is for the hop from the Freelens proxy to the API
  // server. kubectl only talks to the Freelens proxy on 127.0.0.1.
  it.each([
    ["patch", (applier: ResourceApplier) => applier.patch("some-pod", "Pod", [])],
    ["apply", (applier: ResourceApplier) => applier.create("apiVersion: v1\nkind: Pod\nmetadata:\n  name: some-pod\n")],
    ["apply all", (applier: ResourceApplier) => applier.kubectlApplyAll(["some-resource"])],
    ["delete all", (applier: ResourceApplier) => applier.kubectlDeleteAll(["some-resource"])],
  ])("does not give kubectl the cluster's HTTPS proxy for %s", async (_, run) => {
    await run(resourceApplier);

    const [, , { env }] = execFileMock.mock.calls[0] as [string, string[], { env: NodeJS.ProcessEnv }];

    expect(env.HTTPS_PROXY).not.toBe("http://some-https-proxy:3128");
  });

  it.each([
    ["apply", (applier: ResourceApplier) => applier.kubectlApplyAll(["some-resource"])],
    ["delete", (applier: ResourceApplier) => applier.kubectlDeleteAll(["some-resource"])],
  ])("runs %s on a directory with the proxy kubeconfig and its cache directory", async (subCommand, run) => {
    await run(resourceApplier);

    expect(execFileMock).toHaveBeenCalledWith("/some-kubectl", expect.any(Array), { env: withKubeCacheDir() });

    const [, args] = execFileMock.mock.calls[0] as [string, string[]];

    expect(args.slice(0, 5)).toEqual([subCommand, "--kubeconfig", kubeconfigPath, "--cache-dir", cacheDirectoryPath]);
  });

  it.each([
    ["succeeds", async () => ({ callWasSuccessful: true, response: "{}" })],
    ["fails", async () => ({ callWasSuccessful: false, error: Object.assign(new Error("failed"), { stderr: "" }) })],
    [
      "throws",
      async () => {
        throw new Error("spawn failed");
      },
    ],
  ])("writes the manifests owner-only and removes their directory when kubectl %s", async (_, execFile) => {
    execFileMock.mockImplementation(execFile);

    await resourceApplier.kubectlApplyAll(["some-resource", "another-resource"]).catch(() => undefined);

    const [, args] = execFileMock.mock.calls[0] as [string, string[]];
    const directory = args.at(-1);

    expect(writeFileMock.mock.calls).toEqual([
      [`${directory}/0.yaml`, "some-resource", { mode: 0o600 }],
      [`${directory}/1.yaml`, "another-resource", { mode: 0o600 }],
    ]);
    expect(deleteFileMock).toHaveBeenCalledWith(directory);
  });

  it("does not ensure kubectl separately from getting its path", async () => {
    await resourceApplier.kubectlApplyAll(["some-resource"]);

    expect(ensureKubectlMock).not.toHaveBeenCalled();
  });
});
