/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The extension system's requests to main over the legacy channels, whose
// handlers take several arguments (specs/002-messaging-for-tauri, research R11).

import {
  extensionDiscoveryStateChannel,
  extensionLoaderFromMainChannel,
  extensionLoaderLoadFailuresFromMainChannel,
  extensionLoaderSetIsEnabledChannel,
  extensionLoaderTornDownChannel,
} from "../../../common/ipc/extension-handling";
import { toJS } from "../../../common/utils";
import { getDiForExtensionApi } from "../../extension-api-di";
import ipcRendererInjectable from "../ipc-renderer.injectable";

import type { ExtensionLoadFailure } from "../../extension-loader/load-failure";
import type { InstalledExtension, LensExtensionId } from "../../installed-extension";

function requestMain(channel: string, ...args: any[]) {
  const di = getDiForExtensionApi();

  const ipcRenderer = di.inject(ipcRendererInjectable);

  return ipcRenderer.invoke(channel, ...args.map(toJS));
}

export function requestInitialExtensionDiscovery(): Promise<{ isLoaded: boolean }> {
  return requestMain(extensionDiscoveryStateChannel);
}

export function requestExtensionLoaderInitialState(): Promise<[LensExtensionId, InstalledExtension][]> {
  return requestMain(extensionLoaderFromMainChannel);
}

export function requestExtensionLoaderMainLoadFailures(): Promise<[LensExtensionId, ExtensionLoadFailure][]> {
  return requestMain(extensionLoaderLoadFailuresFromMainChannel);
}

export function requestExtensionLoaderSetIsEnabled(extensionId: LensExtensionId, isEnabled: boolean): Promise<void> {
  return requestMain(extensionLoaderSetIsEnabledChannel, extensionId, isEnabled);
}

export function requestExtensionLoaderTornDown(extensionId: LensExtensionId): Promise<void> {
  return requestMain(extensionLoaderTornDownChannel, extensionId);
}
