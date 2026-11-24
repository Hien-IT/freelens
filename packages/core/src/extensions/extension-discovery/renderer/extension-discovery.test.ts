/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { when } from "mobx";
import { beforeEach, describe, expect, it, vi } from "vitest";
import uninstallExtensionListenerInjectable from "../../../features/extensions/installer/main/uninstall-listener.injectable";
import { getMainAndRenderer } from "../../../test-utils/channels-between-main-and-renderer";
import ipcRendererInjectable from "../../ipc/ipc-renderer.injectable";
import extensionDiscoveryInjectable from "../main/extension-discovery.injectable";
import extensionDiscoveryFollowerInjectable from "./extension-discovery.injectable";

import type { DiContainer } from "@ogre-tools/injectable";
import type { IpcRenderer } from "electron";
import type { Mock } from "vitest";

import type { ExtensionDiscovery } from "../main/extension-discovery";

describe("the renderer's follower of extension discovery", () => {
  let rendererDi: DiContainer;
  let uninstallExtension: Mock<(extensionId: string) => Promise<void>>;
  let onState: (event: unknown, message: { isLoaded: boolean }) => void;

  beforeEach(() => {
    const both = getMainAndRenderer();

    rendererDi = both.rendererDi;
    uninstallExtension = vi.fn(async () => {});
    both.mainDi.override(extensionDiscoveryInjectable, () => ({ uninstallExtension }) as unknown as ExtensionDiscovery);
    both.listenInMain(uninstallExtensionListenerInjectable);

    // main's legacy channel of the discovery state
    rendererDi.override(
      ipcRendererInjectable,
      () =>
        ({
          invoke: async () => ({ isLoaded: true }),
          on: (_channel: string, listener: typeof onState) => {
            onState = listener;
          },
        }) as unknown as IpcRenderer,
    );
  });

  it("is loaded once main says so", async () => {
    const follower = rendererDi.inject(extensionDiscoveryFollowerInjectable);

    expect(follower.isLoaded).toBe(false);

    await follower.init();
    await when(() => follower.isLoaded);

    expect(follower.isLoaded).toBe(true);
  });

  it("follows what main sends afterwards", async () => {
    const follower = rendererDi.inject(extensionDiscoveryFollowerInjectable);

    await follower.init();
    await when(() => follower.isLoaded);
    onState({}, { isLoaded: false });

    expect(follower.isLoaded).toBe(false);
  });

  it("uninstalls in main", async () => {
    await rendererDi.inject(extensionDiscoveryFollowerInjectable).uninstallExtension("some-extension-id");

    expect(uninstallExtension).toHaveBeenCalledWith("some-extension-id");
  });
});
