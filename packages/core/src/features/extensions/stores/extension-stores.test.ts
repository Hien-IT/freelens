/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Conf from "conf";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import directoryForUserDataInjectable from "../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import fsInjectable from "../../../common/fs/main/fs.injectable";
import readFileInjectable from "../../../common/fs/main/read-file.injectable";
import writeFileInjectable from "../../../common/fs/main/write-file.injectable";
import extensionLoaderInjectable from "../../../extensions/extension-loader/extension-loader.injectable";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import readExtensionStoreFileForMainInjectable from "./main/read-store-file.injectable";
import { decryptStoreData, encryptStoreData } from "./main/store-crypto";
import extensionStoreWriteListenerInjectable from "./main/write-listener.injectable";
import writeExtensionStoreFileInjectable from "./renderer/write-store-file.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

import type { ExtensionLoader } from "../../../extensions/extension-loader/extension-loader";
import type { InstalledExtension } from "../../../extensions/installed-extension";
import type { ExtensionStoreFileRequest } from "./common/channels";

const installed = new Map([
  ["some-extension-id", { manifest: { name: "some-extension", version: "1.0.0", storeName: "some-store-name" } }],
]) as Map<string, InstalledExtension>;

const fakeExtensionLoader = () =>
  ({ getExtensionById: (id: string) => installed.get(id) }) as unknown as ExtensionLoader;

describe("extension-store:read and extension-store:write, in main", () => {
  let mainDi: DiContainer;
  let read: (request: ExtensionStoreFileRequest) => { path: string; contents?: string };

  beforeEach(() => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    mainDi.override(directoryForUserDataInjectable, () => "/some-user-data");
    mainDi.override(extensionLoaderInjectable, fakeExtensionLoader);
    both.listenInMain(extensionStoreWriteListenerInjectable);
    read = mainDi.inject(readExtensionStoreFileForMainInjectable);
  });

  it("answers the path main gives a store with no file yet, and no contents", () => {
    expect(read({ extensionId: "some-extension-id", configName: "some-store" })).toEqual({
      path: "/some-user-data/extension-store/some-store-name/some-store.json",
    });
  });

  it("answers the text of the file", async () => {
    await mainDi.inject(writeFileInjectable)("/some-user-data/extension-store/some-store-name/some-store.json", "{}");

    expect(read({ extensionId: "some-extension-id", configName: "some-store" }).contents).toBe("{}");
  });

  it("uses the folder the extension gives as it is", () => {
    expect(
      read({ extensionId: "some-extension-id", configName: "some-store", fileExtension: "yaml", cwd: "/elsewhere" }),
    ).toEqual({ path: "/elsewhere/some-store.yaml" });
  });

  it.each([
    [{ configName: "../escape" }, '"../escape" is not a name of a store file'],
    [{ configName: "nested/store" }, '"nested/store" is not a name of a store file'],
    [{ configName: "some-store", fileExtension: "json\\..\\x" }, "is not a name of a store file"],
    [{ configName: "some-store", extensionId: "no-such-extension" }, 'Extension "no-such-extension" is not installed'],
  ])("refuses %j", (request, error) => {
    expect(() => read({ extensionId: "some-extension-id", ...request })).toThrow(error);
  });

  it("writes what the renderer sends, and reads it back", async () => {
    const request = { extensionId: "some-extension-id", configName: "some-store" };

    await both().rendererDi.inject(writeExtensionStoreFileInjectable)(request, '{\n\t"some": "value"\n}');

    expect(
      await mainDi.inject(readFileInjectable)("/some-user-data/extension-store/some-store-name/some-store.json"),
    ).toBe('{\n\t"some": "value"\n}');
  });

  // the renderer of the test joined to main, for the write
  let joined: ReturnType<typeof getMainAndRenderer> | undefined;
  const both = () => {
    if (!joined) {
      joined = getMainAndRenderer();
      joined.mainDi.override(directoryForUserDataInjectable, () => "/some-user-data");
      joined.mainDi.override(extensionLoaderInjectable, fakeExtensionLoader);
      joined.listenInMain(extensionStoreWriteListenerInjectable);
      mainDi = joined.mainDi;
    }

    return joined;
  };

  afterEach(() => {
    joined = undefined;
  });

  it("encrypts with the store's key, and decrypts back what it wrote", async () => {
    const request = { extensionId: "some-extension-id", configName: "some-store", encryptionKey: "some-key" };

    await both().rendererDi.inject(writeExtensionStoreFileInjectable)(request, '{"secret":"value"}');

    const written = await mainDi.inject(readFileInjectable)(
      "/some-user-data/extension-store/some-store-name/some-store.json",
    );

    expect(written).not.toContain("secret");
    expect(mainDi.inject(readExtensionStoreFileForMainInjectable)(request).contents).toBe('{"secret":"value"}');
  });

  // conf writes once per step of a migration, and the renderer sends each write without waiting
  it("keeps the last of several writes sent at once, even when an earlier one finishes later", async () => {
    const joinedNow = getMainAndRenderer();
    // the file system of another container, wrapped below: an injected injectable cannot be overridden
    const fs = getMainAndRenderer().mainDi.inject(fsInjectable);
    let slowFirst = true;

    joinedNow.mainDi.override(directoryForUserDataInjectable, () => "/some-user-data");
    joinedNow.mainDi.override(extensionLoaderInjectable, fakeExtensionLoader);
    joinedNow.mainDi.override(fsInjectable, () => ({
      ...fs,
      writeFile: async (...args: Parameters<typeof fs.writeFile>) => {
        if (slowFirst) {
          slowFirst = false;
          await new Promise((resolve) => setTimeout(resolve, 50));
        }

        return fs.writeFile(...args);
      },
    }));
    joinedNow.listenInMain(extensionStoreWriteListenerInjectable);

    const write = joinedNow.rendererDi.inject(writeExtensionStoreFileInjectable);
    const request = { extensionId: "some-extension-id", configName: "some-store" };

    await Promise.all([write(request, '{"step":1}'), write(request, '{"step":2}'), write(request, '{"step":3}')]);

    expect(await fs.readFile("/some-user-data/extension-store/some-store-name/some-store.json", "utf-8")).toBe(
      '{"step":3}',
    );
  });
});

describe("the encryption of a store, compared with conf", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "extension-store-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  it.each(["aes-256-cbc", "aes-256-gcm"] as const)("decrypts a file conf wrote with %s", (encryptionAlgorithm) => {
    const conf = new Conf({ cwd, configName: "some-store", encryptionKey: "some-key", encryptionAlgorithm });

    conf.set("some", "value");

    const text = decryptStoreData(readFileSync(conf.path), "some-key", encryptionAlgorithm);

    expect(JSON.parse(text)).toEqual({ some: "value" });
  });

  it.each(["aes-256-cbc", "aes-256-gcm"] as const)("encrypts a file conf reads with %s", (encryptionAlgorithm) => {
    writeFileSync(join(cwd, "some-store.json"), encryptStoreData('{"some":"value"}', "some-key", encryptionAlgorithm));

    const conf = new Conf({ cwd, configName: "some-store", encryptionKey: "some-key", encryptionAlgorithm });

    expect(conf.store).toEqual({ some: "value" });
  });
});
