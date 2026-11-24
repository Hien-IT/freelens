/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import writeFileInjectable from "../../../common/fs/main/write-file.injectable";
import { readResourceFolderInjectionToken } from "../../../common/k8s/read-resource-folder";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import readResourceStackFolderListenerInjectable from "./main/read-folder-listener.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("extension-resource-stack:read-folder", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;
  const files = [
    { name: "deployment.yaml", contents: "kind: Deployment" },
    { name: "service.yaml.hb", contents: "kind: Service\nname: {{ name }}" },
  ];

  beforeEach(async () => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;

    for (const { name, contents } of files) {
      await mainDi.inject(writeFileInjectable)(`/some-extension/resources/${name}`, contents);
    }

    both.listenInMain(readResourceStackFolderListenerInjectable);
  });

  it("reads the folder directly in main", async () => {
    expect(await mainDi.inject(readResourceFolderInjectionToken)("/some-extension/resources")).toEqual(files);
  });

  it("gives the renderer the files main reads", async () => {
    expect(await rendererDi.inject(readResourceFolderInjectionToken)("/some-extension/resources")).toEqual(files);
  });

  it("fails in the renderer as main's read fails", async () => {
    await expect(rendererDi.inject(readResourceFolderInjectionToken)("/no-such-folder")).rejects.toThrow("ENOENT");
  });
});
