/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import ensureDirInjectable from "../../common/fs/main/ensure-dir.injectable";
import writeFileInjectable from "../../common/fs/main/write-file.injectable";
import homeDirectoryPathInjectable from "../../common/os/home-directory-path.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import pathExistsListenerInjectable from "./main/path-exists-listener.injectable";
import validateDirectoryListenerInjectable from "./main/validate-directory-listener.injectable";
import requestPathExistsInjectable from "./renderer/path-exists.injectable";
import validateDirectoryInjectable from "./renderer/validate-directory.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("validate-directory and path-exists", () => {
  let rendererDi: DiContainer;

  beforeEach(async () => {
    const both = getMainAndRenderer();

    rendererDi = both.rendererDi;
    both.mainDi.override(homeDirectoryPathInjectable, () => "/some-home");
    await both.mainDi.inject(ensureDirInjectable)("/some-home/some-directory");
    await both.mainDi.inject(writeFileInjectable)("/some-home/some-file", "some-content");
    both.listenInMain(validateDirectoryListenerInjectable, pathExistsListenerInjectable);
  });

  describe("validate-directory", () => {
    it("accepts a directory", async () => {
      expect(await rendererDi.inject(validateDirectoryInjectable)("/some-home/some-directory")).toEqual({
        callWasSuccessful: true,
        response: undefined,
      });
    });

    it("refuses a file, saying what it is", async () => {
      expect(await rendererDi.inject(validateDirectoryInjectable)("/some-home/some-file")).toEqual({
        callWasSuccessful: false,
        error: "the provided path is a file and not a directory.",
      });
    });

    it("refuses a missing path", async () => {
      expect(await rendererDi.inject(validateDirectoryInjectable)("/no-such-directory")).toEqual({
        callWasSuccessful: false,
        error: "the provided path does not exist.",
      });
    });

    it("resolves ~ to the home directory in main", async () => {
      expect(await rendererDi.inject(validateDirectoryInjectable)("~")).toEqual({
        callWasSuccessful: true,
        response: undefined,
      });
    });
  });

  describe("path-exists", () => {
    it.each([
      ["/some-home/some-file", true],
      ["/some-home/some-directory", true],
      ["~", true],
      ["/no-such-path", false],
    ])("answers whether %s exists", async (path, exists) => {
      expect(await rendererDi.inject(requestPathExistsInjectable)(path)).toBe(exists);
    });
  });
});
