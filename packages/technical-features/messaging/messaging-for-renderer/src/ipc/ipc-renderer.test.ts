import { registerFeature } from "@freelensapp/feature-core";
import { createContainer, DiContainer } from "@ogre-tools/injectable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messagingFeatureForRenderer } from "../feature";
import ipcRendererInjectable from "./ipc-renderer.injectable";

import type { IpcRenderer } from "electron";

describe("ipc-renderer", () => {
  let di: DiContainer;
  const ipcRenderer = { invoke: () => {}, send: () => {}, on: () => {} } as unknown as IpcRenderer;

  beforeEach(() => {
    di = createContainer("irrelevant");
    // ogre 23 prevents side-effect injectables by default; this test injects real ones.
    di.permitSideEffects();

    registerFeature(di, messagingFeatureForRenderer);
    window.freelensViewBridge = { ipcRenderer, getPathForFile: () => "" };
  });

  afterEach(() => {
    delete window.freelensViewBridge;
  });

  it("is not undefined", () => {
    const actual = di.inject(ipcRendererInjectable);

    expect(actual).not.toBeUndefined();
  });

  it("is IPC-renderer of Electron", () => {
    const actual = di.inject(ipcRendererInjectable);

    expect(actual).toBe(ipcRenderer);
  });

  it("throws, naming the bridge, when the preload did not run", () => {
    delete window.freelensViewBridge;

    expect(() => di.inject(ipcRendererInjectable)).toThrow("window.freelensViewBridge is missing");
  });
});
