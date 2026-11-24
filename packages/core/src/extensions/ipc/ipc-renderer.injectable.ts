/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Copyright (c) OpenLens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import { getInjectable } from "@ogre-tools/injectable";

import type { IpcRenderer } from "electron";

// The view has no Node, so Electron's IPC object comes from the bridge the
// preload puts on `window` (freelens/src/preload/index.ts). Its global type, in
// packages/core/src/renderer/view-bridge.d.ts, is not used here: this file is
// also compiled for the extension API's declaration, which must not carry it.
const ipcRendererInjectable = getInjectable({
  id: "ipc-renderer",
  instantiate: () => {
    const bridge = (globalThis as { freelensViewBridge?: { readonly ipcRenderer: IpcRenderer } }).freelensViewBridge;

    if (!bridge) {
      throw new Error(
        "window.freelensViewBridge is missing: the preload of freelens/src/preload/index.ts did not run in this frame",
      );
    }

    return bridge.ipcRenderer;
  },
  causesSideEffects: true,
});

export default ipcRendererInjectable;
