# Research: Renderer Without Node

Phase 0 of [plan.md](./plan.md). Each section gives the decision, why, and what
else was weighed. Facts were checked in the code at the commit this plan was
written on; inferences are marked [inferred]. The per-file result is
[contracts/legacy-inventory.md](./contracts/legacy-inventory.md), and the new
channels are [contracts/channels.md](./contracts/channels.md).

## R1. What the renderer uses Node for

The renderer program of the type check (`tsc -p tsconfig.renderer.json`) gives
every file of the renderer legacy list at least one error, and each error is a
use of Node:

- **`node:assert` alone**: about half the list, the resource stores of
  `renderer/components/**/store.injectable.ts` among them. The strict-null
  errors of some files (`edit-resource-model`, `dock/terminal/view.tsx`,
  `create-terminal`) are knock-on errors: without Node's types, `assert` loses
  its `asserts value` narrowing.
- **Pure computations**: `node:path`, `Buffer`, `node:timers`, `node:events`,
  `node:url`, `node:querystring`, and Node's types (`NodeJS.Timeout`,
  `NodeJS.Platform`, `BufferEncoding`, `Stats`, `Dirent`).
- **Values of the machine**: `process.platform`, `process.env.*`,
  `process.resourcesPath`, `os.homedir`/`tmpdir`/`userInfo`, and Electron's
  `process.isMainFrame`.
- **Actions on the machine**: `fs`, `fs-extra`, `chokidar`, `conf`, `tar`,
  `node:child_process`, `node:tls`, `node:crypto`.

Common files are registered in both DI containers, so a common injectable that
uses Node runs in the renderer even when no renderer code injects it
(`register-injectables-renderer.ts` registers all of `common/`).

**Decision**: classify every file with one disposition and record it in
`contracts/legacy-inventory.md`:

- **S**: the same work with what a browser page and Node both have;
- **I**: a value the renderer reads synchronously, fetched from main before the
  frame starts and held in state (R4);
- **C**: a request channel answered in main, one task each (R6);
- **M**: the Node part is needed by main only and moves under `main/`, or the
  file is split by process behind one injection token;
- **D**: dead in the renderer, deleted.

**Rationale**: the user input asks to go file by file; one code per file lets
`/speckit-tasks` group the work and order it smallest first.

## R2. The renderer bundle is the real boundary

The legacy list covers only the sources of `freelens/src` and
`packages/core/src`. The renderer bundle, `freelens/static/build/assets/`,
holds more Node than that:

- **Workspace packages outside the type-check programs**:
  `packages/utility-features/kube-api` and `kube-api-specifics` (`node:assert`),
  `json-api` (`node:querystring`), `run-many` (`node:assert`, `node:events`),
  `utilities` (`Buffer` in `base64.ts`, `tar` in `tar.ts`, `node:path` in
  `union-env-path.ts`, a global `Buffer` in `isBuffer`).
- **npm packages**, each reached at module load, so the renderer would throw at
  startup without Node:
  - `@kubernetes/client-node` with `undici`, `agent-base`, `hpagent`, `socks`
    and `tar-fs`, through `common/kube-helpers.ts`;
  - `conf` with `atomically`, `stubborn-fs` and `env-paths`, through
    `common/get-configuration-file-model`;
  - `tar`, `fs-extra` with `graceful-fs` and `jsonfile`, `proper-lockfile` with
    `signal-exit`;
  - `winston` with `logform`, `@colors/colors`, `winston-transport` and
    `readable-stream`, through `packages/logger`;
  - `chokidar` with `readdirp`;
  - `tcp-port-used`.
- **`electron` as a value**, in `web-frame.injectable.ts`,
  `attempt-install.injectable.tsx`, `cluster-settings/kubeconfig.tsx`,
  `common/utils/open-link-in-browser.injectable.ts`,
  `extensions/extension-discovery/extension-discovery.ts`,
  `extensions/ipc/**`, and `messaging-for-renderer`'s `ipc-renderer.injectable.ts`.

Three packages import a builtin that never runs: `@ogre-tools/*` (a guarded
probe of lodash), `es-toolkit` (a JSDoc example) and `monaco-editor` (inside a
TypeScript worker function, tree-shaken).

The renderer build rewrites every builtin and `electron` import into
`globalThis["require"](…)` (`runtimeRequireExternalsPlugin` in
`freelens/electron.vite.config.ts`). It claims the id before Vite applies a
package's `browser` map, so even `"fs": false` entries reach the shim.

**Decision**: the plan proves Node's absence on the bundle, not only on the
legacy list. A build gate in `runtimeRequireExternalsPlugin`
([contracts/bundle-gate.md](./contracts/bundle-gate.md)) records, for every
builtin or `electron` import, the importer chain up to the entry. It names the
first workspace module of the chain, the file that brings the Node use in. That
module must be on a list that only shrinks, the `rendererBundle` list of
`scripts/type-check-environments/legacy.jsonc`. At the end, the list is empty
and removed, and the plugin stops shimming: any builtin or `electron` import in
the renderer graph fails the build, in development too.

For the npm packages, the code that uses them moves to main (R6, R9). The
packages leave the renderer graph rather than being replaced by browser builds:
none of them does work the renderer should do once the machine is main's.

**Alternatives considered**:

- Add the utility packages to the renderer type-check program: covers the
  workspace but not the npm packages, and a type check cannot see a builtin an
  npm package requires.
- Let Vite apply `browser` maps and its `__vite-browser-external` stubs: fails
  silently at runtime instead of at build time [inferred from Vite's behaviour
for unmapped builtins, not checked on Vite 8].

Node globals in npm code (`signal-exit` reads `global.process` at module top)
are outside the gate. The integration tests with Node off are the backstop
(R13).

## R3. How the views reach main with Node off

Today every view gets `ipcRenderer` through `require("electron")`, possible only
with Node integration. Electron documents that a preload script loads into
subframes only while `nodeIntegrationInSubFrames` is on (`electron.d.ts` of
Electron 44.10.1). Main sends to a cluster frame with
`webContents.sendToFrame([processId, frameId])`, after the frame registers
itself on `frame-communication-admin-channel`
(`messaging-for-main/src/send-message-to-channel/`). A frame without a preload
would have no IPC at all.

**Decision** (clarification of the spec, Session 2026-11-23):

- The window is created with `nodeIntegration: false`, `sandbox: true` and
  `nodeIntegrationInSubFrames: true`, and with `contextIsolation: false` as
  today.
- A sandboxed preload, built by the `preload` section of electron-vite, loads
  into every frame. It puts one object on `window`, the view bridge of
  [contracts/preload-bridge.md](./contracts/preload-bridge.md).
- `messaging-for-renderer`'s `ipc-renderer.injectable.ts` and the extension
  system's renderer IPC (`packages/core/src/extensions/ipc/`) take the
  IPC object from the bridge instead of from `require("electron")`.
- Main's side of messaging does not change: `event.senderFrame`,
  `frame-communication-admin-channel` and `sendToFrame` work as before.

A sandboxed renderer has no Node engine, so the subframe setting gives the
frames the preload and nothing else [inferred from Electron's documentation of
`sandbox`: it disables the Node.js engine for the renderer]. The first task is a
spike that proves it before anything else changes. It is a minimal Electron app
in `$TMPDIR` on the repository's Electron, with a cross-origin iframe. In the
window and in the frame it checks:

1. `typeof require`, `typeof process` and `typeof Buffer` are `"undefined"`;
2. the bridge is present;
3. an `invoke` from the frame reaches main, and main sees the frame as the
   sender;
4. `sendToFrame` reaches the frame;
5. `webUtils.getPathForFile` works in the preload.

**Fallback** if the spike fails: keep both settings off. The cluster frames
send to the window with `postMessage`, and the window relays to main, naming
the frame by the browser-checked `event.origin`. That changes
`messaging-for-renderer` and `messaging-for-main` (frame registration, sending
to a frame, the sender of a request), and it reopens this section.

**Alternatives considered**:

- Both settings off with the relay, as the user input first asked: more change
  in the messaging packages, for no gain in what a page can reach. It was put to
  the user, who chose the preload.
- The HTTP carrier of `messaging-for-tauri` for the Electron frames: a second
  carrier in Electron main, to be written in TypeScript next to the Rust one.

## R4. Values of the machine at startup

About seventeen renderer files and five public getters
(`Common.App.isWindows`, `isMac`, `isLinux`, `isSnap` and `isFlatpak`) read
the platform and the environment synchronously, at injection time. The app
paths already come from main: `setup-app-paths`, a
`beforeApplicationIsLoadingInjectionToken` runnable, awaits the `app-paths`
request and fills `app-paths-state`. `start-frame` runs in
`onLoadOfApplication`, after every `beforeApplicationIsLoading` runnable.

**Decision**:

- **One request channel, `machine-values`**, answered in main from main's own
  injectables, fetched by a renderer runnable beside `setup-app-paths` and held
  in a state injectable. Its fields are those of
  [data-model.md](./data-model.md#machinevalues): the platform, the debugging,
  Snap and Flatpak flags, the home and kube directories, and the bundled helm
  path.
- **Each common injectable that read one of these splits by process** behind
  one injection token: a main implementation keeps Node, and a renderer
  implementation reads the state. Callers and the public getters do not
  change, and stay synchronous.
- **`directory-for-user-data`** returns `appPaths.userData` in the renderer.
  Main already sets the user data directory to the integration-testing one when
  `FREELENS_INTEGRATION_TESTING_DIR` is set, so the renderer's own override is
  dropped.
- **`default-shell`** leaves the renderer. Its only renderer use is a
  placeholder, which starts empty until the existing `look-up-terminal-shell`
  request answers.
- **`process-arch`, `lens-resources-dir` and `user-info`** move to main. The
  renderer gets their only results through `machine-values`.

Values fixed by the build are not values of the machine:

- **Development or production mode** (`node-env.injectable.ts`, `virtual-list`)
  reads `import.meta.env`, which Vite defines in the bundle and Vitest in the
  tests. The renderer program gets `ImportMeta.env` types from a renderer
  declaration file, not from `vite/client`, so that no other ambient type comes
  with it.
- **The test switch of `reactive-now`** moves to `import.meta.env.MODE`, and
  the file moves under `renderer/`.

Which frame a view is: `currently-in-cluster-frame.injectable.ts` becomes
`window.top !== window`. `bootstrap.tsx`, `frame-application-root`,
`setup-logging-for-navigation` and the catalog registry inject it instead of
reading `process.isMainFrame`.

**Rationale**: one request at the point where the app paths are fetched adds
one round trip to startup, in parallel with `app-paths` (SC-005). The public
getters stay synchronous (FR-014).

**Alternatives considered**:

- A request per value: more round trips, with no benefit.
- Sync boxes: they push values that change; these are fixed for the life of the
  process.
- `navigator.userAgentData.platform`: the renderer's view, not main's (FR-003).

## R5. Persistent storage without `conf` in the renderer

Today, `loadAndStartSyncing()` creates a `conf` instance in the renderer
(`common/get-configuration-file-model`). `conf` reads
`<cwd>/<configName>.json` synchronously, then `fromStore(config.store)` runs.
`conf` also writes from the renderer when its initialisation applies defaults or
migrations. In steady state, the renderer sends its model on
`store-sync-main:<config.path>`; main writes it and broadcasts on
`store-sync-renderer:<path>`. The renderer stores, loaded at
`beforeFrameStartsSecond`, are user preferences, clusters, hotbars, favorites,
weblinks, enabled extensions, installed extensions and the file-system
provisioner. Main loads all of them too, earlier. No built-in store registers a
migration.

**Decision**:

- **Built-in stores**: a request channel, `persistent-storage-initial-values`
  (none → `{ path, model }[]`), answered by main from its in-memory registry of
  loaded storages, not from disk. A renderer runnable before the frame starts
  fills a map. The renderer's implementation of the configuration-file model is
  an in-memory object of the `Conf` shape, seeded from the map with main's
  `path`, which keeps the channel ids equal to main's (`conf` resolves symlinks,
  so a path the renderer joined itself could differ). `loadAndStartSyncing`
  stays synchronous. Saving does not change: the reaction sends to
  `store-sync-main:<path>`.
- **Each `store-sync-renderer:<path>` listener is registered as soon as the
  snapshot answers**, since the paths come from that answer. A change main
  broadcasts between its answer and the registration is missed, in the same
  window as today's, between the renderer reading the file and registering the
  listener, so FR-006 holds. Every later change arrives whole, as today.
- **Extension stores keep every `conf` option**, synchronously, because
  `ExtensionStore.loadExtension` is synchronous and public, and its params
  expose `conf`'s options: `encryptionKey`, `serialize`/`deserialize`,
  `fileExtension`, `schema`, migrations on a `Conf<T>`, and the rest (FR-014).
  - **Reading**: `loadExtension` asks main over `extension-store:read`, the
    one synchronous channel of this feature. It is the extension system's own
    Electron IPC (`sendSync` through the bridge's `ipcRenderer`), which spec 002
    exempts and the Tauri build does not have. Main reads the file in the
    store's folder, the `cwd` the extension gave or else the extension's store
    directory, which main computes, as `conf` names it from the `configName`
    and the `fileExtension`. It decrypts the file with the store's
    `encryptionKey` as `conf` does, and returns the text. The `cwd` is read as
    given, as today (FR-007).
  - **Loading**: the renderer runs `conf`'s load logic on that text in a
    `Conf`-compatible class, the in-memory object of the built-in stores grown
    to `conf`'s surface: `deserialize`, `defaults`, the `ajv` schema,
    dot-notation access, migrations by `conf`'s algorithm and `projectVersion`,
    and change events.
  - **Writing**: when that logic changes the stored data, where `conf` writes
    the file back on load today, the renderer serializes it and sends it on
    `extension-store:write`. Main encrypts it if the store has a key and writes
    it atomically. This holds for a store that only the renderer loads, too.
  - **Saving later** keeps the existing `store-sync-main` path, as today.
- **`process.nextTick`** becomes `queueMicrotask`.
- **The backup of a corrupt file** (`read-file-buffer-sync`,
  `write-buffer-sync`) is main's, since main loads every store first.
- **The per-cluster local storage** (`renderer/utils/create-storage/`, which
  reads and writes `<userData>/lens-local-storage/<clusterId|app>.json` with
  `fs`) goes through `lens-local-storage:read` and `lens-local-storage:write`.
  Main builds the path from the cluster id.

**Risks**:

- **The `Conf`-compatible class can drift from `conf`.** Unit tests, which can
  load `conf`, run each scenario through `conf` itself and through the class,
  and compare the store and the text written: defaults, a schema failure,
  migrations across versions, dot notation, encryption, and custom
  `serialize`/`deserialize`. A bump of `conf` runs them again.
- **Synchronous IPC blocks the renderer** while main reads one small file, once
  per extension store at load. It is limited to the extension system.
- **Saves are sent without waiting for an answer**, as today. A change made just
  before quitting depends on Electron delivering queued messages, as it does
  now; the quickstart checks it (FR-006).

**Alternatives considered**:

- One request per store, at load: more round trips at startup, and
  `loadAndStartSyncing` would become asynchronous.
- Sync boxes: they exist, but no sync box is defined, and the stores already
  sync through their own channels.
- For extension stores, a snapshot fetched before the entry point runs, with
  encrypted stores failing unless main had loaded them: it changes how a public
  API fails, which FR-014 does not allow, and the user chose to keep the
  behaviour instead.
- Bundling `conf` itself in the renderer: it imports `node:fs`, `node:crypto`
  and `node:path` at module top.

## R6. Actions on the machine become one-task channels

**Decision**: every file-system or process action of the renderer becomes a
request channel answered in main, shaped by the task and not by the file
system. The full list, with values, checks and owners, is
[contracts/channels.md](./contracts/channels.md). In short:

- **Kubeconfig work moves to main whole**: parsing a pasted kubeconfig, adding
  it, listing a cluster's contexts, removing a context when a cluster is
  deleted, and revealing the file. Answers carry names, namespaces and errors,
  never a certificate, key or token (FR-012 of spec 002). This takes
  `@kubernetes/client-node` out of the renderer. `defaultYamlDumpOptions` moves
  to its own module, so the six views that need only that constant stop pulling
  `common/kube-helpers.ts` in, and the `create-core-api` and
  `create-authorization-api` injectables, used by main only, move to `main/`.
- **The resource templates** are watched in main, sent once on request, and sent
  again on change, as `features/theme/files` already does with imported themes.
- **Extension install** moves to main in stages: from a path (dialog, drop,
  typed) or a URL, then commit or discard. The renderer keeps the dialogs, the
  notifications and the install-state store. A `stagingId` names the staged
  package, so the renderer never names a temporary or managed path.
- **Uninstall, the extension's file folder** (`getExtensionFileFolder`) and
  **opening the extension's folder** are channels in which main computes every
  path.
- **Settings that take a typed path**: checking a directory, whether a path
  exists (the `isPath` input validator, also public as
  `Renderer.Component.InputValidators`), and the kind of a kubeconfig sync
  entry. Main resolves `~` itself.
- **Opening a link** is a channel: main accepts `http:` and `https:` only.
  `shell.openExternal` stays in main's implementation of the same token.
- **Waiting for a port to be free** after a port-forward stops is a channel, so
  `tcp-port-used` leaves the renderer.
- **The extension API calls that take a folder** are exempt from FR-007's
  rule on paths (clarification, Session 2026-11-23): `FilePicker`'s upload
  writes the picked files into the folder the extension names, and
  `createResourceStack` reads the folder it applies, as today. Failing for some
  folders would be a breaking change, which Principle III allows only in a
  major release. A file name with a path separator or `..` is still refused,
  as it cannot be a picked file's name. In main, `Main.K8sApi.createResourceStack`
  reads the folder directly, with no channel.
- **Who calls a channel** is beyond these rules: main cannot tell whether a
  path came from the user, and with context isolation off any script in a page
  can call any channel, as it can use Node today (clarification, Session
  2026-11-23).

**Rationale**: FR-007 asks that no channel offer the file system in general.
The task shape also keeps each channel testable on both sides (FR-020) and lets
the Tauri core answer it without a file-system API.

**Alternatives considered**:

- A general `fs` channel: this is the "general" access FR-007 forbids.
- `window.open(url)` for links, which `setWindowOpenHandler` already opens in
  the browser: it works in Electron, but it leaves the rule implicit, and the
  Tauri build needs an explicit channel anyway.

## R7. Paths in the renderer

Renderer path results are not only display strings:

- `is-in-local-kubeconfig` compares main's `kubeConfigPath` with a directory
  joined in the renderer;
- `extension-loader`'s `servedUrlOf` takes the basename of main's absolute path;
- `ExtensionStore`'s synchronous `cwd()` joins the user data directory.

Neither `pathe` nor `path-browserify` is in the tree, and both are posix only.

**Decision**:

- The renderer stops computing file-system paths that main can give it whole.
  The paths of R6 move to main with the work that uses them.
- What remains (`join`, `basename`, `dirname`, `parse`, `sep`, `isAbsolute`)
  runs on a Node-free implementation of Node's posix and win32 rules, chosen by
  `machine-values.platform`. It is ported from Node's `lib/path.js` and keeps
  that file's upstream notice, as vendored code does (AGENTS.md).
- `resolve` and `relative`, which need a working directory, stay in main.
- The path injectables split by process. Main keeps `node:path`.
- Unit tests compare the port with `node:path`'s `posix` and `win32` on a table
  of inputs that covers drive letters, UNC shares, mixed separators, trailing
  separators, `.` and `..` (SC-007). The tests run on Node, so the reference is
  at hand.
- `lens-templates` and URL paths use the last `/` segment: they are always
  posix.

**Alternatives considered**:

- Compute every path in main over a channel: the synchronous public
  `ExtensionStore.cwd()` rules it out.
- `pathe`: it normalises to `/`, which differs from main on Windows.
- A new dependency: a port of a few pure functions does not justify one.

## R8. Computations without Node

**Decision**:

- **`assert`**: one function, `assert(value: unknown, message?: string): asserts value`,
  in `@freelensapp/utilities`. It throws an `Error` named `AssertionError`
  with `code: "ERR_ASSERTION"`, so the failures of `KubeApi`, `KubeObjectStore`
  and `ExtensionStore` keep their name and code (FR-014). The snapshot of
  `common/initializable-state/create.test.ts` expects the name. It joins the
  members that `packages/core/src/extensions/common-api/utils.ts` keeps out of
  `Util`, so the extension API gains no member. One home serves `packages/core`
  and the `utility-features` packages, which cannot import core.
- **`node:querystring`** in `json-api`: a local `stringify`, equal to Node's for
  spaces, `!~*'()`, Unicode, arrays, empty arrays and non-finite numbers.
  `URLSearchParams` differs on each of these (`+` for space, `NaN` written
  out, arrays joined with commas).
- **`node:events`** in `run-many` and `extension-discovery`:
  `@freelensapp/event-emitter`.
- **`Buffer`**:
  - `utilities/src/base64.ts` uses `atob`/`btoa` with `TextEncoder` and
    `TextDecoder`. `Uint8Array.fromBase64` is not used, because the Node that
    Vitest runs on lacks it.
  - `terminal-api.ts` encodes the shell token with `btoa`.
  - `isBuffer` checks `typeof Buffer` first.
- **`terminal-api.ts`** builds its WebSocket URL with `URL` and
  `URLSearchParams`, leaving out undefined values. `url.format` dropped them,
  and `node=undefined` would open a node shell for a node named "undefined".
  A unit test covers it.
- **`setImmediate`**: `setTimeout(…, 0)`.
- **Node's types**: `ReturnType<typeof setTimeout>`, the platform union of
  `common/vars/platform.injectable.ts`, and the DOM's `Uint8Array`.
- **`IpcRegistrar`** (`Renderer.Ipc`) hashes the extension id synchronously in
  its public constructor. The extension loader computes the SHA-256 with
  `crypto.subtle.digest` before it creates the extension's instance, and caches
  it by id. The constructor reads the cache, so the prefix stays equal to
  main's. This is the only hash the renderer needs synchronously.
- **`kubectl-download-mirror.tsx`**: `isDisabled` and the `platforms` set go.
  Every mirror lists all three platforms, so the option was never disabled on a
  supported platform.
- **`webFrame.frameToken`** appears only in log lines; main identifies frames
  by the IPC sender. It is replaced by a per-frame `crypto.randomUUID()` for
  those lines, and `web-frame.injectable.ts` goes.
- **The `FileFilter` type from Electron**: a local type with the same shape.
- **`require-deprecation-warning`** and `warn-on-extension-require` go (D):
  without Node there is no `globalThis.require` to wrap. A throwing stub would
  send UMD bundles that test `typeof require` down their CommonJS branch
  [inferred].

## R9. The logger in the renderer

`packages/logger/src/winston-logger.injectable.ts` builds the renderer's logger
with `winston`. Its transports, `renderer/logger/browser-console-transport.ts`
and `features/population-of-logs-to-a-file/renderer/ipc-transport.ts`, extend
`winston-transport`, whose `readable-stream` base needs `buffer`, `events` and
`process.nextTick` even in its browser build.

Today one `loggerFeature`, registered by both `freelens/src/main/index.ts` and
`freelens/src/renderer/index.ts`, registers every injectable of the package;
`loggerInjectable` injects `winstonLoggerInjectable` directly, and the
transport token is typed by `winston-transport`.

**Decision**: `packages/logger` splits by process.

- `src/common/` holds the logger tokens, the prefixed logger and the `Logger`
  type.
- `src/main/` holds the winston logger, a transport token typed
  `TransportStream`, and `loggerFeatureForMain`.
- `src/renderer/` holds the Node-free logger, a transport token typed by a
  local interface, and `loggerFeatureForRenderer`. It formats entries as today
  and writes them to the console transport and to the IPC transport, which
  sends on the existing `ipc-file-logger-channel`.
- The package's `exports` give `.` (common), `./main` and `./renderer`. Each
  `freelens/src/*/index.ts` registers its own feature, and renderer code imports
  only `.` and `./renderer`, so `winston` never enters the renderer graph.
- The prefixed logger and every caller of the logger tokens are unchanged.
  Unit tests compare the renderer's output lines with today's for each level
  and for an error with a stack.

**Alternatives considered**: add `events` and `buffer` polyfills, honour the
`util: false` browser map and stub `os` for winston's handlers. That is several
new dependencies to keep a library that does three things in the renderer.

## R10. What the extension API sees

Checked against C1 to C15 of `docs/extensions/api.md`, C3, C4, C5, C6 and C14
in particular:

| Surface                                                                         | Today                                   | After                                                                                                                         |
| ------------------------------------------------------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `Common.App.isWindows` / `isMac` / `isLinux` / `isSnap` / `isFlatpak`           | sync, from `process`                    | sync, from `machine-values` state (R4)                                                                                        |
| `Common.Store.ExtensionStore` (`loadExtension`, `cwd`, migrations on `Conf<T>`) | sync, `conf` reads the file             | sync, `extension-store:read` and a `Conf`-compatible class tested against `conf`; every option kept, encryption included (R5) |
| `LensExtension.getExtensionFileFolder()`                                        | async, fs in the renderer               | async, a channel (R6); same result                                                                                            |
| `K8sApi.createResourceStack` (`kubectlApplyFolder`, `kubectlDeleteFolder`)      | async, reads the folder in the renderer | async, a channel reading the same folder; in main, read directly                                                              |
| `Renderer.Component.FilePicker` with `uploadDir`                                | writes in the renderer                  | a channel writing to the same folder                                                                                          |
| `Renderer.Component.InputValidators.isPath`                                     | async, `fs-extra` in the renderer       | async, the `path-exists` channel; same message                                                                                |
| `KubeApi`, `KubeObjectStore`, `ExtensionStore` assertion failures               | `AssertionError`, `ERR_ASSERTION`       | same name and code (R8)                                                                                                       |
| `Renderer.Ipc` channel prefix                                                   | sync SHA-256 in the constructor         | precomputed, same value (R8)                                                                                                  |
| `Renderer.Component.ReactiveDuration`                                           | `reactive-now` in common                | the same component; the module moves under `renderer/`                                                                        |
| `require` in extension renderer code                                            | reachable, warned                       | absent (C4 already allows it)                                                                                                 |

**Decision**:

- Nothing is added to or removed from the namespaces.
- The documents change where they describe what changes:
  - the paragraph of C4 on `globalThis.require`, which becomes "absent";
  - "Node and Electron in the renderer" in `migrating-from-v1.md`, which says
    they are still reachable.
- No failure changes, so no breaking change needs a major release
  (Principle III).
- The section names that the `freelens` plugin skills cite stay unchanged.

## R11. Electron's own renderer modules

| Use                         | Where                                                                | After                                                                                                             |
| --------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `ipcRenderer`               | `messaging-for-renderer`, `extensions/ipc/**`, `extension-discovery` | the bridge (R3); `extension-discovery` tests the process with the entry-point-name token instead of `ipcRenderer` |
| `ipcMain` as a process test | `extension-loader.ts`                                                | the entry-point-name token                                                                                        |
| `shell.openExternal`        | `common/utils/open-link-in-browser.injectable.ts`                    | `open-link-in-browser` channel (R6)                                                                               |
| `shell.showItemInFolder`    | `cluster-settings/kubeconfig.tsx`                                    | `reveal-cluster-kubeconfig` channel                                                                               |
| `shell.openPath`            | `attempt-install.injectable.tsx`                                     | `extension-install:open-folder` channel                                                                           |
| `webFrame.frameToken`       | `frame-token`, `web-frame`                                           | removed (R8)                                                                                                      |
| `webUtils.getPathForFile`   | needed by drop install: `File.path` is gone since Electron 32        | the bridge's `getPathForFile`                                                                                     |

## R12. Order of the work

**Decision**, risk first, then file by file, smallest first, as the user input
asks:

1. **The spike of R3.** A failure stops the plan at this point and reopens R3.
2. **The gate of R2 in list mode**, with the `rendererBundle` list filled from
   the current bundle.
3. **The preload and the bridge**, with Node integration still on, so that the
   IPC path is proven while everything else still works.
4. **The computations (User Story 2)**:
   - `assert` first, which covers most of the list;
   - Node's types, the frame role and the build-time values (R4);
   - the logger (R9) and the path port (R7);
   - the files only main uses.
5. **The values and actions of the machine (User Story 1)**:
   - `machine-values` (R4);
   - the channels of R6, one feature at a time: links, settings,
     port-forward, templates;
   - persistent storage and local storage (R5);
   - kubeconfig;
   - the extension system;
   - the last `fs` injectables move to main.
6. **The gate stops shimming** and the `rendererBundle` list goes.
7. **Last**: the window gets `nodeIntegration: false` with the sandbox.

Each file leaves the renderer legacy list and the Biome exemption in the same
change (FR-010); `scripts/type-check-environments.mjs` fails until it does.

## R13. Tests

- **Unit tests** follow FR-019. A test changes only where the code it tests, or
  a module it fakes, moves:
  - the global overrides of the path, platform, process-arch, default-shell and
    user-info injectables follow the split by process;
  - the ten tests that override `platformInjectable` keep doing so;
  - the two pod-menu tests replace `vi.spyOn(os, "platform")` with an override
    of `platformInjectable`.
- **New code is tested on both sides** (FR-020): the renderer's request against
  `messaging-fake-bridge`, and main's listener with its failures. That covers
  each new channel, the path port against `node:path`, the logger, the snapshot
  stores and `assert`.
- **Integration tests** run with Node off as they are. They drive main with
  `app.evaluate` and need no Node in the page (checked in
  `freelens/integration`). A new test checks SC-002: in the window and in a
  cluster frame, `typeof require`, `typeof process` and `typeof Buffer` are
  `"undefined"`.

## R14. The channel list of spec 002

**Decision**: each channel of `contracts/channels.md` is added to
`specs/002-messaging-for-tauri/contracts/channel-list.md` in the change that
adds it, under its owner's section. The owners:

- main-foundation, for machine values, store and local-storage snapshots,
  directory checks and templates;
- main-catalog, for the pasted kubeconfig and the kind of a sync entry;
- main-cluster-connection, for a cluster's contexts and the removal of a
  context;
- main-port-forward;
- desktop-integration (006), for links and revealing the file.

The extension-only channels go to "Not ported", with that reason (FR-017).
Every value is JSON, so no row is marked `non-JSON` (FR-018); file bytes travel
as base64 strings, as `pod-files` does.

## R15. Measuring startup (SC-005)

**Decision**:

- **The window**: `specs/measure-baseline.sh` on a packaged build of this branch
  and of `main`, three runs each, on the same machine. It already times "window
  loaded".
- **The cluster frame**: a Playwright script in `$TMPDIR` that reuses
  `freelens/integration/helpers`. It clicks a connected kind cluster in the
  catalog and times until the first page of the frame is visible, three runs on
  each build.

The figures go in the pull request, not in a document.

## R16. Risks

1. **The spike of R3 fails.** The relay fallback grows the messaging work, and
   the plan stops at task 1 to revise R3.
2. **A Node global in npm code**, which the gate does not see, survives. The
   integration tests and the SC-002 test catch it at runtime.
3. **The `Conf`-compatible class of the extension stores** drifts from `conf`;
   the comparison tests of R5 catch it.
4. **Drop install depends on `webUtils`** in a sandboxed preload; the spike
   checks it.
5. **Startup round trips**: `machine-values`, `app-paths` and the store snapshot
   are requested in parallel, before the frame starts; SC-005 measures the
   cost.
6. **Ordering**: `queueMicrotask` runs before the I/O callbacks that
   `nextTick` also preceded, so the order is the same [inferred]; the storage
   tests cover it.
