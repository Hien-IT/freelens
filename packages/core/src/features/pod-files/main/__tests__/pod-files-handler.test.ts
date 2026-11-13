/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import withFreelensProxyCredentialEnvInjectable from "../../../../main/freelens-proxy/with-freelens-proxy-credential-env.injectable";
import { getDiForUnitTesting } from "../../../../main/getDiForUnitTesting";
import kubeconfigManagerInjectable from "../../../../main/kubeconfig-manager/kubeconfig-manager.injectable";
import createKubectlInjectable from "../../../../main/kubectl/create-kubectl.injectable";
import { createMockCluster } from "../../../cluster/execute/common/testing";
import clustersStateInjectable from "../../../cluster/storage/common/state.injectable";
import { maxEditorBytes } from "../../common/limits";
import podFilesHandlerInjectable from "../pod-files-handler.injectable";
import runKubectlInjectable from "../run-kubectl.injectable";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

import type { PodFilesOperation, PodFilesRequest } from "../../common/types";
import type { PodFilesHandler } from "../pod-files-handler.injectable";
import type { RunKubectlResult } from "../run-kubectl.injectable";

const target = { clusterId: "some-cluster", namespace: "default", pod: "web-0", container: "app" };
const request = (operation: PodFilesOperation): PodFilesRequest => ({ ...target, operation });
const ok = (output: string | Buffer): RunKubectlResult => ({
  callWasSuccessful: true,
  response: Buffer.isBuffer(output) ? output : Buffer.from(output),
});
const fail = (error: string): RunKubectlResult => ({ callWasSuccessful: false, error });

describe("pod files handler", () => {
  let di: DiContainer;
  let runKubectl: Mock;
  let handle: PodFilesHandler;

  /** The command run in the container by the nth call of kubectl. */
  const commandOfCall = (index = 0) => {
    const args: string[] = runKubectl.mock.calls[index][1];

    return args.slice(args.indexOf("--") + 1);
  };

  beforeEach(() => {
    di = getDiForUnitTesting();
    runKubectl = vi.fn();

    di.override(runKubectlInjectable, () => runKubectl);
    di.override(createKubectlInjectable, () => () => ({ getPath: async () => "/bundled/kubectl" }) as never);
    di.override(withFreelensProxyCredentialEnvInjectable, () => (env) => ({ ...env, PROXY_TOKEN: "token" }));
    di.override(
      kubeconfigManagerInjectable,
      () =>
        ({
          ensurePaths: async () => ({ kubeconfigPath: "/proxy/kubeconfig", cacheDirectoryPath: "/proxy/cache" }),
        }) as never,
    );

    di.inject(clustersStateInjectable).set(target.clusterId, createMockCluster(target.clusterId, true));
    handle = di.inject(podFilesHandlerInjectable);
  });

  it("runs the host's kubectl against the proxy kubeconfig", async () => {
    runKubectl.mockResolvedValue(ok(""));

    await handle(request({ type: "list", path: "/etc" }));

    const [kubectlPath, args, options] = runKubectl.mock.calls[0];

    expect(kubectlPath).toBe("/bundled/kubectl");
    expect(args).toEqual([
      "--kubeconfig",
      "/proxy/kubeconfig",
      "--cache-dir",
      "/proxy/cache",
      "exec",
      "--namespace",
      "default",
      "web-0",
      "--container",
      "app",
      "--",
      "ls",
      "-la",
      "--color=never",
      "--",
      "/etc/",
    ]);
    expect(options.env).toMatchObject({ KUBECACHEDIR: "/proxy/cache", PROXY_TOKEN: "token" });
  });

  it("lists a directory, directories first", async () => {
    runKubectl.mockResolvedValue(
      ok("total 8\n-rw-r--r-- 1 root root 5 Nov 13 13:21 b.txt\ndrwxr-xr-x 2 root root 4096 Nov 13 13:21 a\n"),
    );

    const result = await handle(request({ type: "list", path: "/srv" }));

    expect(result).toEqual({
      callWasSuccessful: true,
      response: [
        expect.objectContaining({ name: "a", path: "/srv/a", isDirectory: true }),
        expect.objectContaining({ name: "b.txt", path: "/srv/b.txt", size: 5 }),
      ],
    });
  });

  it("falls back to a short listing when the long one fails", async () => {
    runKubectl
      .mockResolvedValueOnce(fail("ls: unrecognized option: color=never"))
      .mockResolvedValueOnce(ok("bin/\nhosts\n"));

    const result = await handle(request({ type: "list", path: "/" }));

    expect(commandOfCall(1)).toEqual(["ls", "-1ap", "--", "/"]);
    expect(result).toEqual({
      callWasSuccessful: true,
      response: [
        expect.objectContaining({ name: "bin", isDirectory: true }),
        expect.objectContaining({ name: "hosts" }),
      ],
    });
  });

  it("reports the error of the short listing when both fail", async () => {
    runKubectl
      .mockResolvedValueOnce(fail("ls: /nope: No such file or directory"))
      .mockResolvedValueOnce(fail("ls: /nope/: No such file or directory"));

    expect(await handle(request({ type: "list", path: "/nope" }))).toEqual({
      callWasSuccessful: false,
      error: "ls: /nope/: No such file or directory",
    });
  });

  it("reads a text file", async () => {
    runKubectl.mockResolvedValue(ok("server { listen 80; }\n"));

    const result = await handle(request({ type: "read", path: "/etc/nginx/nginx.conf" }));

    expect(commandOfCall()).toEqual(["head", "-c", String(maxEditorBytes + 1), "--", "/etc/nginx/nginx.conf"]);
    expect(result).toEqual({
      callWasSuccessful: true,
      response: { content: "server { listen 80; }\n", truncated: false, isBinary: false },
    });
  });

  it("truncates a file longer than the editor limit", async () => {
    runKubectl.mockResolvedValue(ok(Buffer.alloc(maxEditorBytes + 1, "a")));

    const result = await handle(request({ type: "read", path: "/var/log/big.log" }));

    expect(result).toMatchObject({ callWasSuccessful: true, response: { truncated: true, isBinary: false } });
    expect((result as { response: { content: string } }).response.content).toHaveLength(maxEditorBytes);
  });

  it("detects a binary file by a NUL byte", async () => {
    runKubectl.mockResolvedValue(ok(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01])));

    expect(await handle(request({ type: "read", path: "/bin/app" }))).toEqual({
      callWasSuccessful: true,
      response: { content: "", truncated: false, isBinary: true },
    });
  });

  it("does not read a file with a binary extension", async () => {
    expect(await handle(request({ type: "read", path: "/srv/logo.png" }))).toEqual({
      callWasSuccessful: true,
      response: { content: "", truncated: false, isBinary: true },
    });
    expect(runKubectl).not.toHaveBeenCalled();
  });

  it("downloads the bytes of a file as base64", async () => {
    const bytes = Buffer.from([0, 1, 2, 255]);

    runKubectl.mockResolvedValue(ok(bytes));

    expect(await handle(request({ type: "download", path: "/srv/data.bin" }))).toEqual({
      callWasSuccessful: true,
      response: { contentBase64: bytes.toString("base64") },
    });
    expect(commandOfCall()).toEqual(["cat", "--", "/srv/data.bin"]);
  });

  it("writes a file through the standard input", async () => {
    runKubectl.mockResolvedValue(ok(""));

    const path = "/tmp/$(reboot) it's.txt";
    const result = await handle(
      request({ type: "write", path, contentBase64: Buffer.from("hello").toString("base64") }),
    );
    const [, args, options] = runKubectl.mock.calls[0];

    expect(result).toEqual({ callWasSuccessful: true, response: undefined });
    expect(args).toContain("--stdin");
    expect(commandOfCall()).toEqual(["sh", "-c", 'cat > "$1"', "sh", path]);
    expect(Buffer.from(options.input).toString()).toBe("hello");
  });

  it("deletes a directory recursively", async () => {
    runKubectl.mockResolvedValue(ok(""));

    await handle(request({ type: "delete", path: "/tmp/cache", recursive: true }));

    expect(commandOfCall()).toEqual(["rm", "-rf", "--", "/tmp/cache"]);
  });

  it.each(["/", "//", "/tmp/.."])("refuses to delete the root directory as %j", async (path) => {
    expect(await handle(request({ type: "delete", path, recursive: true }))).toEqual({
      callWasSuccessful: false,
      error: "Refusing to delete the root directory",
    });
    expect(runKubectl).not.toHaveBeenCalled();
  });

  it.each(["etc/hosts", "", "/etc/\0hosts"])("refuses the path %j", async (path) => {
    expect(await handle(request({ type: "read", path }))).toEqual({
      callWasSuccessful: false,
      error: "The path must be absolute",
    });
    expect(runKubectl).not.toHaveBeenCalled();
  });

  it("refuses a request without a container", async () => {
    expect(await handle({ ...request({ type: "list", path: "/" }), container: "" })).toMatchObject({
      callWasSuccessful: false,
    });
    expect(runKubectl).not.toHaveBeenCalled();
  });

  it("fails when the cluster is not connected", async () => {
    di.inject(clustersStateInjectable).set(target.clusterId, createMockCluster(target.clusterId, false));

    expect(await handle(request({ type: "list", path: "/" }))).toEqual({
      callWasSuccessful: false,
      error: "The cluster is not connected",
    });
  });

  it("reports the error of kubectl", async () => {
    runKubectl.mockResolvedValue(fail("rm: can't remove '/proc/1': Permission denied"));

    expect(await handle(request({ type: "delete", path: "/proc/1", recursive: false }))).toEqual({
      callWasSuccessful: false,
      error: "rm: can't remove '/proc/1': Permission denied",
    });
  });
});
