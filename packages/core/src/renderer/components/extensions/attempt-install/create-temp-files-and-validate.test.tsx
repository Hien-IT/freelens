/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import os from "node:os";
import path from "node:path";
import fse from "fs-extra";
import { create } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import writeFileInjectable from "../../../../common/fs/write-file.injectable";
import tempDirectoryPathInjectable from "../../../../common/os/temp-directory-path.injectable";
import { getDiForUnitTesting } from "../../../getDiForUnitTesting";
import createTempFilesAndValidateInjectable from "./create-temp-files-and-validate.injectable";

import type { CreateTempFilesAndValidate } from "./create-temp-files-and-validate.injectable";

describe("createTempFilesAndValidate", () => {
  let createTempFilesAndValidate: CreateTempFilesAndValidate;
  let workDir: string;
  let tarball: Buffer;
  let written: { filePath: string; directoryMode: number }[];

  beforeEach(async () => {
    const di = getDiForUnitTesting();

    workDir = await fse.mkdtemp(path.join(os.tmpdir(), "freelens-create-temp-files-"));
    written = [];

    const sourceDir = path.join(workDir, "source");

    await fse.outputJson(path.join(sourceDir, "package", "package.json"), {
      name: "my-extension",
      version: "0.1.0",
      renderer: "out/renderer.js",
      engines: { freelens: "^2.0.0" },
    });
    await create({ gzip: true, file: path.join(workDir, "source.tgz"), cwd: sourceDir }, ["package"]);
    tarball = await fse.readFile(path.join(workDir, "source.tgz"));

    di.override(tempDirectoryPathInjectable, () => path.join(workDir, "tmp"));
    await fse.ensureDir(path.join(workDir, "tmp"));
    di.override(writeFileInjectable, () => async (filePath, content) => {
      written.push({ filePath, directoryMode: (await fse.stat(path.dirname(filePath))).mode & 0o777 });
      await fse.writeFile(filePath, content);
    });

    createTempFilesAndValidate = di.inject(createTempFilesAndValidateInjectable);
  });

  afterEach(async () => {
    await fse.remove(workDir);
  });

  it("writes each tarball alone into a fresh directory only its user can read", async () => {
    const first = await createTempFilesAndValidate({ fileName: "my-extension.tgz", data: tarball });
    const second = await createTempFilesAndValidate({ fileName: "my-extension.tgz", data: tarball });

    expect(first?.manifest.name).toBe("my-extension");
    expect(second?.manifest.name).toBe("my-extension");

    const firstDirectory = path.dirname(first!.tempFile);
    const secondDirectory = path.dirname(second!.tempFile);

    expect(path.dirname(firstDirectory)).toBe(path.join(workDir, "tmp"));
    expect(firstDirectory).not.toBe(secondDirectory);
    expect(path.basename(first!.tempFile)).toBe("my-extension.tgz");

    if (process.platform !== "win32") {
      expect(written.map(({ directoryMode }) => directoryMode)).toEqual([0o700, 0o700]);
    }
  });

  it("removes the directory of a tarball which fails validation", async () => {
    const result = await createTempFilesAndValidate({ fileName: "broken.tgz", data: Buffer.from("not a tarball") });

    expect(result).toBeNull();
    expect(written).toHaveLength(1);
    expect(await fse.pathExists(path.dirname(written[0].filePath))).toBe(false);
  });
});
