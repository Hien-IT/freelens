# Quickstart: Renderer Without Node

How to prove the feature, story by story. Run every command from the repository
root, and write scratch output to `$TMPDIR` (AGENTS.md). The contracts are in
[contracts/](./contracts/); this guide only says how to check them.

## Prerequisites

- `mise install`, then `pnpm install`.
- `node freelens/node_modules/electron/install.js`, so that Electron's binary
  is there; `electron` is a dependency of `freelens/`, not of the root.
- A kind cluster for the cluster checks, created with an explicit
  `--kubeconfig` into `$TMPDIR`, so that no real kubeconfig is touched.
- A checkout of `main` beside this branch, built the same way, as the control.

## The spike (research R3), before anything else

A minimal Electron app in `$TMPDIR/spike/`, run on the repository's Electron:

```sh
cd <repo>/freelens && pnpm exec electron "$TMPDIR/spike/main.cjs"
```

Its window uses the settings of [preload-bridge.md](./contracts/preload-bridge.md)
and loads a page with a cross-origin iframe. It prints one line per check, for
the window and for the frame:

1. `typeof require`, `typeof process` and `typeof Buffer` are all `undefined`;
2. `window.freelensViewBridge` is present;
3. an `invoke` from the frame is answered, and main logs the frame as its
   sender;
4. a `sendToFrame` from main reaches the frame;
5. `getPathForFile` returns the path of a file dropped on the page.

Every line must pass. A failure stops the work and reopens research R3.

## Gates that hold after every change

```sh
pnpm build:di
```

```sh
pnpm type:check
```

```sh
pnpm biome check
```

```sh
pnpm test:unit
```

```sh
pnpm build && pnpm knip:check
```

`pnpm type:check` fails when a file is on the renderer legacy list or exempt
from `noNodejsModules` in `biome.jsonc`. `pnpm build` fails when the renderer
bundle brings in Node ([bundle-gate.md](./contracts/bundle-gate.md)).

## User Story 1: values and actions of the machine

For each feature moved to a channel, run the check below on this branch and on
`main`, and compare. The two must match, except where FR-003 says the value now
comes from main.

| Check                                                                                                                                 | Expected                                                                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| First screen of the window and of a cluster frame                                                                                     | same as on `main`                                                                                                              |
| Start the app; open Preferences                                                                                                       | stored preferences on the first screen, no default shown first                                                                 |
| Change a preference, then quit at once; start again                                                                                   | the change is kept                                                                                                             |
| Change the same preference from the window and from a cluster frame's settings within a second                                        | the stored value is the one `main` stores after the same steps                                                                 |
| Window controls and menus on each platform at hand                                                                                    | as on `main` (platform from `machine-values`)                                                                                  |
| Preferences › Kubernetes › add a sync entry for a file and for a folder                                                               | kind shown as on `main`; a missing path shows the same error                                                                   |
| Cluster settings › Terminal › working directory: a valid folder, a missing one, `~/x`                                                 | same validation messages as on `main`                                                                                          |
| Cluster settings › kubeconfig › "show in folder"                                                                                      | the file is revealed                                                                                                           |
| Add cluster: paste a valid kubeconfig, an invalid one, one with a bad context                                                         | same errors per context; clusters added                                                                                        |
| Delete a cluster from a kubeconfig with several contexts, choosing a new current context                                              | the context is removed and the current context set; the file has nothing else changed                                          |
| Create resource: add a template under `~/.freelens/templates` while the dock is open                                                  | the template appears without a reload                                                                                          |
| Open a link from the terminal and from a port-forward                                                                                 | it opens in the browser; a `file:` link is refused                                                                             |
| Stop a port-forward and start it again at once                                                                                        | the port is free before it starts again                                                                                        |
| Install an extension from a file (dialog), by drop, from a URL and from a folder; uninstall it                                        | as on `main`; the confirm dialog's "open folder" opens it                                                                      |
| An extension that uses `FilePicker` with an upload folder in its data folder, and one outside                                         | files written to the folder the extension names, in both cases, as on `main`                                                   |
| An extension with a renderer-only `ExtensionStore` that has defaults, a migration and an `encryptionKey`: load it, change it, restart | the file is written encrypted and migrated, and after the restart the store holds what it holds on `main` after the same steps |
| Per-cluster UI state (a sorted table, then reopen the cluster)                                                                        | the state is kept                                                                                                              |
| Hotbars: add, reorder and remove items, then restart                                                                                  | kept                                                                                                                           |
| Open a local terminal and a pod shell, run a command                                                                                  | works as on `main`                                                                                                             |
| Pod logs: open, follow, download                                                                                                      | as on `main`                                                                                                                   |
| Helm: install a chart, then edit the release's values                                                                                 | as on `main`                                                                                                                   |
| Cluster settings › Terminal › working directory, and Preferences › kubectl and helm paths, left empty                                 | same as on `main`: the default applies, no error                                                                               |
| Open a Deployment's details and its edit dock, then scale it with `kubectl --kubeconfig "$TMPDIR/kind.yaml" scale …`                  | the details update; unsaved edits in the dock are kept, as on `main`                                                           |
| Open the namespace list, then delete a namespace with `kubectl`                                                                       | the list updates, as on `main`                                                                                                 |

## User Story 2: computations

- `pnpm test:unit` covers the path port against `node:path`'s `posix` and `win32`
  (SC-007), `assert`, the query `stringify` of `json-api`, `base64`, the
  terminal URL without undefined values, and the renderer logger's lines.
- `pnpm type:check` passes with each file off the renderer legacy list.

## User Story 3: Node integration off

After the last task:

```sh
grep -n -A6 "webPreferences" packages/core/src/main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts
```

shows `nodeIntegration: false`, `sandbox: true` and a `preload`.

Then:

- `scripts/type-check-environments/legacy.jsonc` has an empty `renderer` list
  and no `rendererBundle` list, the Biome exemption override is gone, and
  `pnpm type:check` passes (SC-001).
- `pnpm build` has no runtime-require shim left:
  `grep -c 'globalThis\["require"\]' freelens/static/build/assets/*.js` prints
  `0` for every file.
- The integration tests pass:

  ```sh
  pnpm build:app:dir && pnpm test:integration
  ```

  This includes the SC-002 test, which evaluates `typeof require`,
  `typeof process` and `typeof Buffer` in the window and in a cluster frame.
- By hand, in DevTools of the window and of a cluster frame:
  `typeof require`, `typeof process` and `typeof Buffer` give `"undefined"`.
- An extension whose renderer code calls `require` fails alone: the log names
  it, and the app and the other extensions keep working (FR-015). Build it in
  `$TMPDIR/require-extension/`, a copy of `packages/fixture-extension` whose
  renderer entry calls `require("fs")`, and install it from its folder.
- The full check of User Story 1, once more, with Node off.

## SC-005: startup

- **Window**, on packaged builds of this branch and of `main`, on the same
  machine:

  ```sh
  specs/measure-baseline.sh freelens/dist/Freelens-<version>-arm64-mac.zip 3 60
  ```

  The median startup of this branch is at most 10% above `main`'s.
- **Cluster frame**: the Playwright script of research R15, which T075 writes
  to `$TMPDIR/003-sc005/cluster-frame.mjs`, three runs on each build: this
  branch, `main`, and this branch with `sandbox: false` in
  `create-electron-window.injectable.ts`. The median time from the click to
  the first page of the build with the sandbox off is at most 10% above
  `main`'s; the difference between this branch and that build is the
  sandbox's own cost, which goes with the figures.

## SC-006: the channels

Review [channels.md](./contracts/channels.md) against the code and against
`specs/002-messaging-for-tauri/contracts/channel-list.md`:

- every channel added is in the list, with its owner or under "Not ported";
- none is marked `non-JSON`;
- none takes a command line;
- each one that touches file contents takes only a path of a kind FR-007
  lists: a path the user chose in the view, or a folder an extension passes to
  the extension API;
- every row whose answering file this feature moved points at the new file.
