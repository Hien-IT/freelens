/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import ensureDirInjectable from "../../../common/fs/main/ensure-dir.injectable";
import readFileBufferInjectable from "../../../common/fs/main/read-file-buffer.injectable";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import writePickedFilesListenerInjectable from "./main/write-picked-listener.injectable";
import writePickedFilesInjectable from "./renderer/write-picked-files.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("extension-files:write-picked", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;

  beforeEach(async () => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;
    await mainDi.inject(ensureDirInjectable)("/some-user-data/extension-data/some-hash");
    await mainDi.inject(ensureDirInjectable)("/somewhere/else");
    both.listenInMain(writePickedFilesListenerInjectable);
  });

  it.each(["/some-user-data/extension-data/some-hash", "/somewhere/else"])(
    "writes the picked files into %s, the folder the extension gives, and answers their paths",
    async (uploadDir) => {
      const paths = await rendererDi.inject(writePickedFilesInjectable)(uploadDir, [
        new File(["some text"], "some.txt"),
        new File(["{}"], "other.json"),
      ]);

      expect(paths).toEqual([`${uploadDir}/some.txt`, `${uploadDir}/other.json`]);
      expect((await mainDi.inject(readFileBufferInjectable)(`${uploadDir}/some.txt`)).toString()).toBe("some text");
    },
  );

  it("writes a binary file of a few MB byte for byte", async () => {
    const bytes = Uint8Array.from({ length: 3 * 1024 * 1024 }, (_, index) => (index * 31) % 256);

    await rendererDi.inject(writePickedFilesInjectable)("/somewhere/else", [new File([bytes], "some.bin")]);

    expect(new Uint8Array(await mainDi.inject(readFileBufferInjectable)("/somewhere/else/some.bin"))).toEqual(bytes);
  });

  it.each(["../escape.txt", "nested/file.txt", "nested\\file.txt"])("refuses a file named %s", async (name) => {
    await expect(
      rendererDi.inject(writePickedFilesInjectable)("/somewhere/else", [new File(["x"], name)]),
    ).rejects.toThrow("is not the name of a picked file");
  });
});
