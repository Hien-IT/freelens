/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { disposer } from "@freelensapp/utilities";
import { observable, runInAction } from "mobx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import directoryForUserDataInjectable from "../../../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import getConfigurationFileModelInjectable from "../../../../common/get-configuration-file-model/get-configuration-file-model.injectable";
import { BaseExtensionStore } from "../../../../extensions/base-extension-store";
import { Disposers } from "../../../../extensions/lens-extension";
import { getDiForUnitTesting as getRendererDi } from "../../../../renderer/getDiForUnitTesting";
import prepareExtensionStoreInjectable from "./prepare.injectable";
import writeExtensionStoreFileInjectable from "./write-store-file.injectable";

import type { Mock } from "vitest";

import type { LensExtension } from "../../../../extensions/lens-extension";
import type { ExtensionStoreFileRequest, ExtensionStoreReadAnswer } from "../common/channels";

interface SomeStoreModel {
  stored: string;
  added: number;
}

class SomeStore extends BaseExtensionStore<SomeStoreModel> {
  @observable accessor model: Partial<SomeStoreModel> = {};

  constructor() {
    super({ configName: "some-store", defaults: { stored: "default", added: 1 } });
  }

  fromStore(data: Partial<SomeStoreModel>) {
    runInAction(() => {
      this.model = data;
    });
  }

  toJSON() {
    return this.model as SomeStoreModel;
  }

  folder() {
    return this.cwd();
  }
}

const someExtension = () =>
  ({
    id: "some-extension-id",
    storeName: "some-store-name",
    version: "1.0.0",
    [Disposers]: disposer(),
  }) as unknown as LensExtension;

describe("an extension's store, in the renderer", () => {
  let sendSync: Mock<(channel: string, request: ExtensionStoreFileRequest) => ExtensionStoreReadAnswer>;
  let write: Mock<(request: ExtensionStoreFileRequest, contents: string) => Promise<void>>;

  beforeEach(() => {
    const di = getRendererDi();

    // the real loading of the renderer, with main's side faked
    di.unoverride(prepareExtensionStoreInjectable);
    di.unoverride(getConfigurationFileModelInjectable);
    di.override(directoryForUserDataInjectable, () => "/some-user-data");
    write = vi.fn(async () => {});
    di.override(writeExtensionStoreFileInjectable, () => write);
    sendSync = vi.fn(() => ({
      ok: true as const,
      file: { path: "/main/gives/this/some-store.json", contents: JSON.stringify({ stored: "value" }) },
    }));
    window.freelensViewBridge = { ipcRenderer: { sendSync } } as unknown as typeof window.freelensViewBridge;
    SomeStore.resetInstance();
  });

  afterEach(() => {
    delete window.freelensViewBridge;
  });

  it("reads the file through main, synchronously, naming the store", () => {
    SomeStore.createInstance<SomeStore>().loadExtension(someExtension());

    expect(sendSync).toHaveBeenCalledWith(
      "extension-store:read",
      expect.objectContaining({ extensionId: "some-extension-id", configName: "some-store" }),
    );
  });

  it("loads what main read, with the defaults it lacks", () => {
    const store = SomeStore.createInstance<SomeStore>();

    store.loadExtension(someExtension());

    expect(store.model).toEqual({ stored: "value", added: 1 });
  });

  it("writes back what conf writes on load", () => {
    SomeStore.createInstance<SomeStore>().loadExtension(someExtension());

    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({ extensionId: "some-extension-id", configName: "some-store" }),
      JSON.stringify({ stored: "value", added: 1 }, undefined, "\t"),
    );
  });

  it("gives the folder of the path main answered as the store's folder", () => {
    const store = SomeStore.createInstance<SomeStore>();

    store.loadExtension(someExtension());

    expect(store.folder()).toBe("/main/gives/this");
  });

  it("fails as main's read fails", () => {
    sendSync.mockReturnValue({ ok: false, error: '"../x" is not a name of a store file' });

    expect(() => SomeStore.createInstance<SomeStore>().loadExtension(someExtension())).toThrow(
      '"../x" is not a name of a store file',
    );
  });
});
