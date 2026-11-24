/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

// The preload of every frame: the window's and each cluster frame's. It runs
// sandboxed, so the page gets no Node; with context isolation off, its `window`
// is the page's. It hands the page Electron's IPC object and the path of a
// dropped or picked file, and nothing else. The type is declared in
// packages/core/src/renderer/view-bridge.d.ts.

import { ipcRenderer, webUtils } from "electron";

window.freelensViewBridge = {
  ipcRenderer,
  getPathForFile: (file) => webUtils.getPathForFile(file),
};
