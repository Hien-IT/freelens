/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { observable, when } from "mobx";
import { extensionDiscoveryStateChannel } from "../../../common/ipc/extension-handling";

import type { IpcRenderer } from "electron";

import type { LensExtensionId } from "../../installed-extension";

interface Dependencies {
  requestUninstallExtension: (extensionId: LensExtensionId) => Promise<void>;
  readonly ipcRenderer: Pick<IpcRenderer, "invoke" | "on">;
}

/** What the renderer knows of main's discovery of extensions: whether it has loaded them. */
export class ExtensionDiscoveryFollower {
  @observable accessor isLoaded = false;

  constructor(protected readonly dependencies: Dependencies) {}

  get whenLoaded() {
    return when(() => this.isLoaded);
  }

  async init(): Promise<void> {
    const onMessage = ({ isLoaded }: { isLoaded: boolean }) => {
      this.isLoaded = isLoaded;
    };

    // main's state on the legacy channel of the extension system
    this.dependencies.ipcRenderer.invoke(extensionDiscoveryStateChannel).then(onMessage);
    this.dependencies.ipcRenderer.on(extensionDiscoveryStateChannel, (_event, message: { isLoaded: boolean }) => {
      onMessage(message);
    });
  }

  /** Main resolves the extension and removes it. */
  uninstallExtension(extensionId: LensExtensionId): Promise<void> {
    return this.dependencies.requestUninstallExtension(extensionId);
  }
}
