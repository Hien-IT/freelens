/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The legacy inter-process helpers of the extension system, for code that runs
// in either process (specs/002-messaging-for-tauri, research R11).

import { broadcastFromMain } from "../main/legacy-ipc";
import { broadcastFromRenderer } from "../renderer/legacy-ipc";

export { ipcMainHandle, ipcMainOn } from "../main/legacy-ipc";
export { ipcRendererOn } from "../renderer/legacy-ipc";
export { broadcastMainChannel } from "./broadcast-main-channel";

/**
 * Sends to main's listeners and to every view, from either process. A view has
 * a `window` and main has none, which tells the two apart without Electron.
 */
export function broadcastMessage(channel: string, ...args: any[]): Promise<void> {
  return "window" in globalThis ? broadcastFromRenderer(channel, ...args) : broadcastFromMain(channel, ...args);
}
