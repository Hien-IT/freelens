/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { beforeEach, describe, expect, it } from "vitest";
import pathExistsInjectable from "../../../common/fs/main/path-exists.injectable";
import extensionLoaderInjectable from "../../../extensions/extension-loader/extension-loader.injectable";
import directoryForExtensionDataInjectable from "../../../extensions/extension-loader/file-system-provisioner-store/directory-for-extension-data.injectable";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import extensionFileFolderListenerInjectable from "./main/request-listener.injectable";
import requestExtensionFileFolderInjectable from "./renderer/request-extension-file-folder.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

import type { ExtensionLoader } from "../../../extensions/extension-loader/extension-loader";
import type { InstalledExtension } from "../../../extensions/installed-extension";

describe("extension-file-folder", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;

  beforeEach(() => {
    const both = getMainAndRenderer();
    const installed = new Map([
      [
        "some-extension-id",
        { manifest: { name: "some-extension", version: "1.0.0", storeName: "some-store" } } as InstalledExtension,
      ],
    ]);

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;
    mainDi.override(directoryForExtensionDataInjectable, () => "/some-extension-data");
    mainDi.override(
      extensionLoaderInjectable,
      () => ({ getExtensionById: (id: string) => installed.get(id) }) as unknown as ExtensionLoader,
    );
    both.listenInMain(extensionFileFolderListenerInjectable);
  });

  it("creates the folder of an installed extension in main, and answers its path", async () => {
    const folder = await rendererDi.inject(requestExtensionFileFolderInjectable)("some-extension-id");

    expect(folder.startsWith("/some-extension-data/")).toBe(true);
    expect(await mainDi.inject(pathExistsInjectable)(folder)).toBe(true);
  });

  it("answers the same folder the next time", async () => {
    const request = rendererDi.inject(requestExtensionFileFolderInjectable);

    expect(await request("some-extension-id")).toBe(await request("some-extension-id"));
  });

  it("refuses an extension that is not installed", async () => {
    await expect(rendererDi.inject(requestExtensionFileFolderInjectable)("no-such-extension")).rejects.toThrow(
      'Extension "no-such-extension" is not installed',
    );
  });
});
