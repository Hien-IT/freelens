/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import type { IpcRenderer } from "electron";

/**
 * What the preload of `freelens/src/preload/index.ts` puts on `window` in every
 * frame: the view's only way to reach main once the page has no Node.
 */
export interface FreelensViewBridge {
  /** Electron's IPC object, as `require("electron").ipcRenderer` gave it before. */
  readonly ipcRenderer: IpcRenderer;
  /** The path of a file dropped or picked in the page; `""` when it has none. */
  getPathForFile(file: File): string;
}

declare global {
  interface Window {
    /** Absent where no preload ran, as in unit tests. */
    freelensViewBridge?: FreelensViewBridge;
  }
}
