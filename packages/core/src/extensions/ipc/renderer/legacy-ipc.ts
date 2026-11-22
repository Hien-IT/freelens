/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The legacy inter-process helpers of the extension system, renderer side
// (specs/002-messaging-for-tauri, research R11).

import { toJS } from "../../../common/utils/toJS";
import { getDiForExtensionApi } from "../../extension-api-di";
import { broadcastMainChannel } from "../common/broadcast-main-channel";
import ipcRendererInjectable from "../ipc-renderer.injectable";

import type { Disposer } from "@freelensapp/utilities";

/** Broadcasts through main, which calls its own listeners and sends to every view. */
export async function broadcastFromRenderer(channel: string, ...args: any[]): Promise<void> {
  const ipcRenderer = getDiForExtensionApi().inject(ipcRendererInjectable);

  return ipcRenderer.invoke(broadcastMainChannel, channel, ...args.map((arg) => toJS(arg)));
}

export function ipcRendererOn(
  channel: string,
  listener: (event: Electron.IpcRendererEvent, ...args: any[]) => any,
): Disposer {
  const di = getDiForExtensionApi();

  const ipcRenderer = di.inject(ipcRendererInjectable);

  ipcRenderer.on(channel, listener);

  return () => ipcRenderer.off(channel, listener);
}
