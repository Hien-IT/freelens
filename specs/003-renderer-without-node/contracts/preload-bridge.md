# Contract: The Preload and the View Bridge

How a view of the Electron build reaches main once it has no Node (research
R3). It stands only once the spike of R3 passes; if the spike fails, this
contract is replaced by the relay of R3's fallback.

## The window

`create-electron-window.injectable.ts` creates the window with:

| Setting                      | Today                                      | After                                                       |
| ---------------------------- | ------------------------------------------ | ----------------------------------------------------------- |
| `nodeIntegration`            | `true`                                     | `false`                                                     |
| `sandbox`                    | not set; off while `nodeIntegration` is on | `true`                                                      |
| `nodeIntegrationInSubFrames` | `true`                                     | `true`, only so the preload loads into every frame (FR-012) |
| `contextIsolation`           | `false`                                    | `false` (FR-012)                                            |
| `preload`                    | none                                       | the built preload                                           |

The preload is added while Node integration is still on (research R12, step 3).
The settings change last (step 11).

## The preload

- **Source**: `freelens/src/preload/index.ts`. Its environment is the
  sandboxed preload, which is neither main nor renderer (plan, Complexity
  Tracking).
- **Build**: the `preload` section of `freelens/electron.vite.config.ts`, as
  one CommonJS file in `freelens/static/build/`. A sandboxed preload cannot load
  other files.
- **What it may use**: `ipcRenderer` and `webUtils` from `electron`. A sandboxed
  preload has no other Node.
- **What it does**: it assigns one object to `window.freelensViewBridge`, and
  nothing else.

```ts
// The shape only; not an implementation.
interface FreelensViewBridge {
  // Electron's own object, as require("electron").ipcRenderer gave it to the
  // views until now.
  readonly ipcRenderer: Electron.IpcRenderer;
  // The path of a file dropped or picked in the page; "" when it has none.
  getPathForFile(file: File): string;
}
```

## Rules

1. **Every frame gets the bridge**: the window and every cluster frame. With
   context isolation off, the preload's `window` is the page's `window`.
2. **The page gets no Node.** In the window and in every frame, `typeof require`,
   `typeof process` and `typeof Buffer` are `"undefined"` (SC-002). The
   preload's own `require` and `process` stay inside its scope.
3. **Who reads the bridge**:
   - `messaging-for-renderer`'s `ipc-renderer.injectable.ts` returns
     `window.freelensViewBridge.ipcRenderer`, and throws an error naming the
     bridge when it is missing;
   - the extension system's IPC under `packages/core/src/extensions/`, which
     spec 002 and FR-013 exempt, takes the same object: its renderer IPC in
     `extensions/ipc/`, and the `sendSync` of `extension-store:read` in
     `extensions/stores/`;
   - `install-on-drop.injectable.ts` calls `getPathForFile`.

   No other code reads it. The type of `window.freelensViewBridge` is declared
   once, in `packages/core/src/renderer/view-bridge.d.ts`.
4. **Main does not change**: requests still arrive with `event.senderFrame`, and
   frames still register on `frame-communication-admin-channel` and receive
   `sendToFrame`.
5. **What a page can reach is no more than today.** Every frame reaches IPC as it
   did through Node, and no longer reaches Node itself; the channels it can call
   follow the rules of [channels.md](./channels.md).
6. **Tests.** Unit tests fake the bridge, as they fake `ipcRenderer` today. The
   SC-002 integration test checks rule 2 in the window and in a cluster frame.
