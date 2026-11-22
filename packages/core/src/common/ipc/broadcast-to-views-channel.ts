/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getRequestChannel } from "@freelensapp/messaging";

/** A view broadcasting `message` on `channel` to every view, through main. */
export interface BroadcastToViews {
  channel: string;
  message?: unknown;
}

export const broadcastToViewsChannel = getRequestChannel<BroadcastToViews, void>("broadcast-to-views");

/**
 * The message of a legacy channel: its only argument, or the list of them when
 * it has several (specs/002-messaging-for-tauri/data-model.md, Channel).
 */
export const toLegacyMessage = (args: unknown[]): unknown => (args.length > 1 ? args : args[0]);
