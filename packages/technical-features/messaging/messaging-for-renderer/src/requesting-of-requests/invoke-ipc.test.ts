import { registerFeature } from "@freelensapp/feature-core";
import { createContainer, DiContainer } from "@ogre-tools/injectable";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { messagingFeatureForRenderer } from "../feature";
import invokeIpcInjectable from "./invoke-ipc.injectable";

import type { IpcRenderer } from "electron";

describe("ipc-renderer", () => {
  let di: DiContainer;
  // The IPC object the preload's bridge hands the view.
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

  it("is IPC-renderer invoke of Electron", () => {
    const actual = di.inject(invokeIpcInjectable);

    expect(actual).toBe(ipcRenderer.invoke);
  });
});
