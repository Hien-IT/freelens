/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getMessageChannel, getRequestChannel } from "@freelensapp/messaging";

export const windowActionHandleChannel = "window:window-action";
export const windowOpenAppMenuAsContextMenuChannel = "window:open-app-context-menu";
export const windowLocationChangedChannel = "window:location-changed";

/**
 * The supported actions on the current window. The argument for `windowActionHandleChannel`
 */
export enum WindowAction {
  /**
   * Request that the current window goes back one step of browser history
   */
  GO_BACK = "back",

  /**
   * Request that the current window goes forward one step of browser history
   */
  GO_FORWARD = "forward",

  /**
   * Request that the current window is minimized
   */
  MINIMIZE = "minimize",

  /**
   * Request that the current window is maximized if it isn't, or unmaximized
   * if it is
   */
  TOGGLE_MAXIMIZE = "toggle-maximize",

  /**
   * Request that the current window is closed
   */
  CLOSE = "close",
}

// Typed channels of the legacy names above (specs/002-messaging-for-tauri, research R11).
export const windowActionChannel = getRequestChannel<WindowAction, void>(windowActionHandleChannel);
export const openAppMenuAsContextMenuChannel = getMessageChannel<void>(windowOpenAppMenuAsContextMenuChannel);
// The location is sent but not read by main.
export const locationChangedChannel = getMessageChannel<unknown>(windowLocationChangedChannel);
export const historyCanGoBackChannel = getMessageChannel<boolean>("history:can-go-back");
export const historyCanGoForwardChannel = getMessageChannel<boolean>("history:can-go-forward");
