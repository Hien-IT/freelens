/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectionToken } from "@ogre-tools/injectable";

/** One window, and optionally one frame of it; without a frame, the window's main frame. */
export interface WindowTarget {
  windowId: number;
  frame?: { processId: number; frameId: number };
}

/** Sends a message to one window or frame, where `sendMessageToChannel` sends to every view. Main only. */
export type SendMessageToWindow = (target: WindowTarget, channelId: string, message?: unknown) => void;

export const sendMessageToWindowInjectionToken = getInjectionToken<SendMessageToWindow>({
  id: "send-message-to-window",
});
