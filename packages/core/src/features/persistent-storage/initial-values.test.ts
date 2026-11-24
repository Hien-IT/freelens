/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { sendMessageToChannelInjectionToken } from "@freelensapp/messaging";
import { observable, runInAction } from "mobx";
import { beforeEach, describe, expect, it } from "vitest";
import directoryForUserDataInjectable from "../../common/app-paths/directory-for-user-data/directory-for-user-data.injectable";
import getConfigurationFileModelInjectable from "../../common/get-configuration-file-model/get-configuration-file-model.injectable";
import { getMainAndRenderer } from "../../test-utils/channels-between-main-and-renderer";
import createPersistentStorageInjectable from "./common/create.injectable";
import persistentStorageInitialValuesListenerInjectable from "./main/initial-values-listener.injectable";
import persistentStorageInitialValuesInjectable from "./renderer/initial-values.injectable";
import setupPersistentStorageInitialValuesInjectable from "./renderer/setup-initial-values.injectable";

import type { DiContainer } from "@ogre-tools/injectable";

describe("persistent-storage-initial-values", () => {
  let mainDi: DiContainer;
  let rendererDi: DiContainer;

  beforeEach(async () => {
    const both = getMainAndRenderer();

    mainDi = both.mainDi;
    rendererDi = both.rendererDi;
    mainDi.override(directoryForUserDataInjectable, () => "/some-user-data");

    const state = observable({ items: ["some-item"] });

    mainDi
      .inject(createPersistentStorageInjectable)({
        configName: "some-store",
        projectVersion: "1.0.0",
        defaults: { items: [] as string[] },
        fromStore: (data: { items?: string[] }) => runInAction(() => (state.items = data.items ?? state.items)),
        toJSON: () => ({ items: [...state.items] }),
      })
      .loadAndStartSyncing();

    both.listenInMain(persistentStorageInitialValuesListenerInjectable);
    // the renderer's model, not the fake of the file that unit tests use
    rendererDi.unoverride(getConfigurationFileModelInjectable);
    await rendererDi.inject(setupPersistentStorageInitialValuesInjectable).run();
  });

  it("gives the renderer each store main has loaded, with main's path and model", () => {
    expect(rendererDi.inject(persistentStorageInitialValuesInjectable).get("some-store")).toEqual({
      configName: "some-store",
      path: "/some-user-data/some-store.json",
      model: { items: ["some-item"] },
    });
  });

  it("seeds the renderer's model of a store from it", () => {
    const config = rendererDi.inject(getConfigurationFileModelInjectable)({
      configName: "some-store",
      cwd: "/some-user-data",
      projectVersion: "1.0.0",
    });

    expect(config.store).toEqual({ items: ["some-item"] });
    expect(config.path).toBe("/some-user-data/some-store.json");
  });

  it("gives a store main has not loaded its defaults, and the path main would give it", () => {
    const config = rendererDi.inject(getConfigurationFileModelInjectable)({
      configName: "some-other-store",
      cwd: "/some-user-data",
      projectVersion: "1.0.0",
      defaults: { some: "default" },
    });

    expect(config.store).toEqual({ some: "default" });
    expect(config.path).toBe("/some-user-data/some-other-store.json");
  });

  it("keeps a change main sends before the store loads", () => {
    mainDi.inject(sendMessageToChannelInjectionToken)(
      { id: "store-sync-renderer:/some-user-data/some-store.json" },
      { items: ["some-item", "some-new-item"] },
    );

    expect(rendererDi.inject(persistentStorageInitialValuesInjectable).get("some-store")?.model).toEqual({
      items: ["some-item", "some-new-item"],
    });
  });
});
