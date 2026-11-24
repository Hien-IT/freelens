import { getInjectable } from "@ogre-tools/injectable";

// The view has no Node, so Electron's IPC object comes from the bridge the
// preload puts on `window` (freelens/src/preload/index.ts), typed in
// packages/core/src/renderer/view-bridge.d.ts.
const ipcRendererInjectable = getInjectable({
  id: "ipc-renderer",
  instantiate: () => {
    const bridge = globalThis.window?.freelensViewBridge;

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
