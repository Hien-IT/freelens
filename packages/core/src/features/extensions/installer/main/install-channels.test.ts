/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import os from "node:os";
import path from "node:path";
import { requestFromChannelInjectionToken } from "@freelensapp/messaging";
import fse from "fs-extra";
import { create } from "tar";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ensureDirInjectable from "../../../../common/fs/main/ensure-dir.injectable";
import fsInjectable from "../../../../common/fs/main/fs.injectable";
import writeFileInjectable from "../../../../common/fs/main/write-file.injectable";
import writeJsonFileInjectable from "../../../../common/fs/main/write-json-file.injectable";
import tempDirectoryPathInjectable from "../../../../common/os/main/temp-directory-path.injectable";
import { getMainAndRenderer } from "../../../../test-utils/channels-between-main-and-renderer";
import extensionsRootInjectable from "../common/extensions-root.injectable";
import {
  commitExtensionPackageChannel,
  discardExtensionPackageChannel,
  extensionPathKindChannel,
  openExtensionFolderChannel,
  readExtensionPathChannel,
  stageExtensionPackageChannel,
} from "../common/install-channels";
import commitExtensionPackageListenerInjectable from "./commit-listener.injectable";
import openExtensionFolderListenerInjectable from "./open-folder-listener.injectable";
import openPathInjectable from "./open-path.injectable";
import { extensionPathKindListenerInjectable, readExtensionPathListenerInjectable } from "./path-listeners.injectable";
import stagedExtensionPackagesInjectable from "./staged-packages.injectable";
import {
  discardExtensionPackageListenerInjectable,
  stageExtensionPackageListenerInjectable,
} from "./staging-listeners.injectable";

import type { RequestFromChannel } from "@freelensapp/messaging";

import type { DiContainer } from "@ogre-tools/injectable";
import type { Mock } from "vitest";

const manifest = {
  name: "my-extension",
  version: "0.1.0",
  renderer: "out/renderer.js",
  engines: { freelens: "^2.0.0" },
};

describe("the install channels of main", () => {
  let mainDi: DiContainer;
  let request: RequestFromChannel;
  let workDir: string;
  let openPath: Mock<(path: string) => Promise<string>>;

  const packageOf = async (contents: Record<string, unknown> | undefined) => {
    const source = path.join(workDir, `source-${Math.random()}`);
    const file = `${source}.tgz`;

    await fse.ensureDir(path.join(source, "package"));

    if (contents) {
      await fse.outputJson(path.join(source, "package", "package.json"), contents);
    } else {
      await fse.outputFile(path.join(source, "package", "index.js"), "");
    }

    await create({ gzip: true, file, cwd: source }, ["package"]);

    return (await fse.readFile(file)).toString("base64");
  };

  beforeEach(async () => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    workDir = await fse.mkdtemp(path.join(os.tmpdir(), "freelens-install-channels-"));
    await fse.ensureDir(path.join(workDir, "tmp"));
    mainDi.override(tempDirectoryPathInjectable, () => path.join(workDir, "tmp"));
    mainDi.override(extensionsRootInjectable, () => "/some-user-data/extensions");
    // the temp files of staging are real, as tar reads them; the rest is the fake file system
    const fakeFs = mainDi.inject(fsInjectable);

    mainDi.override(writeFileInjectable, () => async (filePath: string, content: string | Uint8Array) => {
      if (filePath.startsWith(workDir)) {
        return fse.outputFile(filePath, content);
      }

      await fakeFs.ensureDir(path.dirname(filePath));
      await fakeFs.writeFile(filePath, content);
    });
    openPath = vi.fn(async (_path: string) => "");
    mainDi.override(openPathInjectable, () => openPath);
    both.listenInMain(
      stageExtensionPackageListenerInjectable,
      discardExtensionPackageListenerInjectable,
      commitExtensionPackageListenerInjectable,
      extensionPathKindListenerInjectable,
      readExtensionPathListenerInjectable,
      openExtensionFolderListenerInjectable,
    );
    request = both.rendererDi.inject(requestFromChannelInjectionToken);
  });

  afterEach(async () => {
    await fse.remove(workDir);
  });

  it("stages a package and answers its manifest", async () => {
    const { stagingId, manifest: staged } = await request(stageExtensionPackageChannel, {
      fileName: "my-extension.tgz",
      base64: await packageOf(manifest),
    });

    expect(staged).toMatchObject(manifest);
    expect(mainDi.inject(stagedExtensionPackagesInjectable).has(stagingId)).toBe(true);
  });

  it("refuses a package without a manifest", async () => {
    await expect(
      request(stageExtensionPackageChannel, { fileName: "broken.tgz", base64: await packageOf(undefined) }),
    ).rejects.toThrow("package.json not found");
  });

  it("refuses a file name with a path in it", async () => {
    await expect(request(stageExtensionPackageChannel, { fileName: "../escape.tgz", base64: "" })).rejects.toThrow(
      "is not the name of a package",
    );
  });

  it("refuses to commit an id it did not stage", async () => {
    await expect(request(commitExtensionPackageChannel, { stagingId: "no-such-id", verified: true })).rejects.toThrow(
      "the package is not staged",
    );
  });

  it("refuses to commit an id it discarded", async () => {
    const { stagingId } = await request(stageExtensionPackageChannel, {
      fileName: "my-extension.tgz",
      base64: await packageOf(manifest),
    });
    const { tempFile } = mainDi.inject(stagedExtensionPackagesInjectable).get(stagingId)!;

    await request(discardExtensionPackageChannel, { stagingId });

    expect(await fse.pathExists(tempFile)).toBe(false);
    await expect(request(commitExtensionPackageChannel, { stagingId, verified: true })).rejects.toThrow(
      "the package is not staged",
    );
  });

  it.each([
    ["/some-dir", "directory"],
    ["/some-dir/some.tgz", "file"],
    ["/no-such-path", "missing"],
  ])("answers what %s is: a %s", async (filePath, kind) => {
    await mainDi.inject(ensureDirInjectable)("/some-dir");
    await mainDi.inject(writeFileInjectable)("/some-dir/some.tgz", "x");

    expect(await request(extensionPathKindChannel, { path: filePath })).toBe(kind);
  });

  it("reads a package the user chose, with the sidecar beside it", async () => {
    await mainDi.inject(writeFileInjectable)("/some-dir/some.tgz", "some bytes");
    await mainDi.inject(writeFileInjectable)("/some-dir/some.tgz.sha256", "abc  some.tgz");

    expect(await request(readExtensionPathChannel, { path: "/some-dir/some.tgz" })).toEqual({
      kind: "file",
      base64: Buffer.from("some bytes").toString("base64"),
      sidecar: "abc  some.tgz",
    });
  });

  it("reads the manifest of a directory the user chose", async () => {
    await mainDi.inject(writeJsonFileInjectable)("/some-extension/package.json", manifest);

    expect(await request(readExtensionPathChannel, { path: "/some-extension" })).toEqual({
      kind: "directory",
      manifest: expect.objectContaining(manifest),
    });
  });

  it("opens the directory of an extension's builds", async () => {
    await request(openExtensionFolderChannel, { name: "@freelensapp/some-extension" });

    expect(openPath).toHaveBeenCalledWith("/some-user-data/extensions/freelensapp--some-extension");
  });
});
