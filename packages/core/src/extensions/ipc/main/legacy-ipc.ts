/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The legacy inter-process helpers of the extension system, main side. Only
// the extension tree uses them; the core's own code is on the channels of
// @freelensapp/messaging (specs/002-messaging-for-tauri, research R11).

import { loggerInjectionToken } from "@freelensapp/logger";
import clusterFramesInjectable from "../../../common/cluster-frames.injectable";
import { toJS } from "../../../common/utils/toJS";
import { getDiForExtensionApi } from "../../extension-api-di";
import ipcMainInjectionToken from "./ipc-main-injection-token";
import { webContentsInjectionToken } from "./web-contents-injection-token";

import type { Disposer } from "@freelensapp/utilities";

export function ipcMainHandle(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) {
  const di = getDiForExtensionApi();

  const ipcMain = di.inject(ipcMainInjectionToken);

  ipcMain.handle(channel, async (event, ...args) => {
    return sanitizePayload(await listener(event, ...args));
  });
}

/** Calls main's own listeners of the channel and sends it to every view and cluster frame. */
export async function broadcastFromMain(channel: string, ...args: any[]): Promise<void> {
  const di = getDiForExtensionApi();
  const webContents = di.inject(webContentsInjectionToken);

  if (!webContents) {
    return;
  }

  const ipcMain = di.inject(ipcMainInjectionToken);
  const logger = di.inject(loggerInjectionToken);
  const clusterFrames = di.inject(clusterFramesInjectable);

  ipcMain.listeners(channel).forEach((func) =>
    func(
      {
        processId: undefined,
        frameId: undefined,
        sender: undefined,
        senderFrame: undefined,
      },
      ...args,
    ),
  );

  const views = webContents.getAllWebContents();

  if (!views || !Array.isArray(views) || views.length === 0) return;

  args = args.map(sanitizePayload);

  for (const view of views) {
    let viewType = "unknown";

    // There will be a uncaught exception if the view is destroyed.
    try {
      viewType = view.getType();
    } catch {
      // We can ignore the view destroyed exception as viewType is only used for logging.
    }

    // Send message to views.
    try {
      logger.silly(`[IPC]: broadcasting "${channel}" to ${viewType}=${view.id}`, { args });
      view.send(channel, ...args);
    } catch (error) {
      logger.error(`[IPC]: failed to send IPC message "${channel}" to view "${viewType}=${view.id}"`, { error });
    }

    // Send message to subFrames of views.
    for (const frameInfo of clusterFrames.values()) {
      logger.silly(
        `[IPC]: broadcasting "${channel}" to subframe "frameInfo.processId"=${frameInfo.processId} "frameInfo.frameId"=${frameInfo.frameId}`,
        { args },
      );

      try {
        view.sendToFrame([frameInfo.processId, frameInfo.frameId], channel, ...args);
      } catch (error) {
        logger.error(
          `[IPC]: failed to send IPC message "${channel}" to view "${viewType}=${view.id}"'s subframe "frameInfo.processId"=${frameInfo.processId} "frameInfo.frameId"=${frameInfo.frameId}`,
          { error: String(error) },
        );
      }
    }
  }
}

export function ipcMainOn(channel: string, listener: (event: Electron.IpcMainEvent, ...args: any[]) => any): Disposer {
  const di = getDiForExtensionApi();

  const ipcMain = di.inject(ipcMainInjectionToken);

  ipcMain.on(channel, listener);

  return () => ipcMain.off(channel, listener);
}

/**
 * Sanitizing data for IPC-messaging before send.
 * Removes possible observable values to avoid exceptions like "can't clone object".
 */
function sanitizePayload<T>(data: any): T {
  return toJS(data);
}
