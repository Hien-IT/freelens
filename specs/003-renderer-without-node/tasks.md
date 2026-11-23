---
description: "Task list for the renderer without Node"
---

# Tasks: Renderer Without Node

**Input**: Design documents from `specs/003-renderer-without-node/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required. FR-019 governs existing tests, FR-020 asks for unit tests
of every new channel on both sides, and Principle V asks for tests with every
behaviour change. Each task carries its own tests; a test file changes only as
FR-019 allows.

**Organization**: by user story. Following the user input, the phases run
smallest first rather than in priority order: User Story 2 (computations, the
smallest files) before User Story 1 (values and actions of the machine), and
User Story 3 (Node integration off) last. The stories' priorities in spec.md
are unchanged.

## Conventions used by every task

- **Free a file**: in the same task, remove it from the `renderer` list of
  `scripts/type-check-environments/legacy.jsonc` and, if it is there, from the
  `noNodejsModules` exemption override of `biome.jsonc`. `pnpm type:check`
  passes only then (FR-010).
- **Leave the bundle list**: when a task removes the last Node or `electron`
  import that a workspace module brings into the renderer bundle, it removes
  that module from the `rendererBundle` list of `legacy.jsonc` in the same task
  (`data-model.md` Renderer bundle list entry). `pnpm build` passes only then.
  A listed module that moves leaves the list in the same task; its new path is
  never added, so its importers move or stop importing it in that task too
  (`contracts/legacy-inventory.md`, section 6).
- **Add a channel row**: a task that adds a channel adds its row to
  `specs/002-messaging-for-tauri/contracts/channel-list.md`, as
  `contracts/channels.md` gives it (`data-model.md` Channel list entry).
- **Every task ends green**: `pnpm build:di` if an `*.injectable.ts` was added,
  moved or deleted; then `pnpm build`, `pnpm type:check`, `pnpm biome check`
  and `pnpm test:unit` pass, and the app still starts. The integration tests
  and `pnpm knip:check` pass at the end of each phase (Principle VII).
- **Headers**: new files get the single-line Freelens header; moved or split
  files keep theirs; the path port keeps Node's upstream notice (plan.md,
  Conventions).
- **Paths** are relative to `packages/core/src/` unless they start with
  `freelens/`, `packages/`, `scripts/`, `docs/`, `specs/`, `biome.jsonc`,
  `AGENTS.md` or `tsconfig`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel: different source files, no dependency on an
  unfinished task. Tasks marked [P] may all remove lines from `legacy.jsonc`
  and `biome.jsonc`; those are one-line removals that merge cleanly.
- **[Story]**: the user story of spec.md (US1, US2, US3).

---

## Phase 1: Setup

**Purpose**: prove the one assumption the plan rests on, and record what the
checks compare against.

- [ ] T001 Run the spike of research R3 and gate every later task on it. In `$TMPDIR/spike/`, write `main.cjs`, `preload.cjs`, `index.html` and `frame.html`. The window uses the settings of `contracts/preload-bridge.md`: `nodeIntegration: false`, `sandbox: true`, `nodeIntegrationInSubFrames: true`, `contextIsolation: false`, and the preload. It loads `index.html` with `frame.html` in a cross-origin iframe (two hosts, for example a `protocol.handle` scheme with two host names). Run it with `pnpm exec electron "$TMPDIR/spike/main.cjs"` from `freelens/`, where `electron` is installed, and print one line per check of quickstart.md "The spike", for the window and for the frame. If any check fails, stop: no later task starts, and research R3, plan.md and `contracts/preload-bridge.md` are revised for the relay fallback first. Nothing is written in the repository.
- [ ] T002 Record the baseline on the current commit, in `$TMPDIR/003-baseline/`:
  - the summary of `pnpm test:unit` (test files and tests per project), for FR-019;
  - the `renderer` list of `scripts/type-check-environments/legacy.jsonc`;
  - after `pnpm build`, the output of `grep -oh 'globalThis\["require"\]("[^"]*")' freelens/static/build/assets/*.js | sort | uniq -c`.

  Nothing is written in the repository.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**:

- the build gate in list mode, so that every later task is measured against
  the bundle;
- the preload and the bridge, with Node integration still on;
- the `assert` that most files need.

- [ ] T003 [P] Write the gate's walk in `freelens/build-plugins/renderer-bundle-gate.ts`, as `contracts/bundle-gate.md` "Phase 1" describes. Given the recorded builtin and `electron` imports and a `getModuleInfo` function, it returns, for each import, the first workspace module up the importer chain and the chain itself. It also compares the result with a list and reports the two failure kinds (not listed; listed but no longer bringing Node in), with the error format of the contract. Unit tests in `freelens/build-plugins/renderer-bundle-gate.test.ts` cover a small graph: a direct import, an import through `node_modules`, a dynamic importer, and both failure kinds. Add `freelens/build-plugins/**/*.ts` to the `include` of `tsconfig.typecheck.json`.
- [ ] T004 Wire the gate into `runtimeRequireExternalsPlugin` in `freelens/electron.vite.config.ts`, for the renderer build and its worker build, in list mode (record in `resolveId(id, importer)` when building; check in `buildEnd`; `this.error` on failure). Seed the `rendererBundle` list of `scripts/type-check-environments/legacy.jsonc` once, with the modules the first build reports (`data-model.md` Renderer bundle list entry), sorted; nothing is added to it afterwards. Extend the file's header comment to say what that list is and that it only shrinks. Describe the list in the "How the check works" part of "Runtime Environments in Type-Checking" in `AGENTS.md`. Depends on T003.
- [ ] T005 [P] Add the preload of `contracts/preload-bridge.md` in `freelens/src/preload/index.ts`. It sets `window.freelensViewBridge = { ipcRenderer, getPathForFile }` from `electron`'s `ipcRenderer` and `webUtils.getPathForFile`, and nothing else. Add a `preload` section to `freelens/electron.vite.config.ts` that builds it as one CommonJS file into `freelens/static/build/`. Add the bridge's type, as a global declaration of `window.freelensViewBridge`, to `packages/core/src/renderer/view-bridge.d.ts`. It is the one declaration of the bridge: the renderer program includes it through its `renderer/` path, and the combined program includes it for every package, `messaging-for-renderer` among them, which declares nothing of its own.
- [ ] T006 Load the preload into the window: add `preload` to `webPreferences` in `main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts`, with Node integration still on. Check that `window.freelensViewBridge` is defined in the window and in a cluster frame. Depends on T005.
- [ ] T007 Make `packages/technical-features/messaging/messaging-for-renderer/src/ipc/ipc-renderer.injectable.ts` return `window.freelensViewBridge.ipcRenderer`, typed by the global declaration of T005, throwing an error that names the bridge when it is missing; it no longer imports `electron` as a value. Adapt `ipc-renderer.test.ts` beside it (FR-019: the module it fakes moves). Leave the bundle list for its entry. Depends on T006.
- [ ] T008 Make the extension system's renderer IPC take the same object from the bridge in `extensions/ipc/ipc-renderer.ts`, `extensions/ipc/ipc-renderer.injectable.ts` and `extensions/ipc/common/legacy-ipc.ts`. None of them imports `electron` as a value afterwards. Move `extensions/ipc/ipc-main.ts`, `extensions/ipc/ipc-main.injectable.ts` and `extensions/ipc/relay-legacy-broadcasts.injectable.ts`, which import `ipcMain` and are registered in the renderer today, under `extensions/ipc/main/`, with their global override, and update their importer `extensions/main-api/index.ts`. Adapt their tests as FR-019 allows, and leave the bundle list for their entries. Depends on T006.
- [ ] T009 [P] Add `assert(value: unknown, message?: string): asserts value` to `packages/utility-features/utilities/src/common/assert.ts`, under a context directory as Principle II asks, exported from the package's `index.ts`. It throws an `Error` whose `name` is `AssertionError` and whose `code` is `"ERR_ASSERTION"` (research R8). Unit tests in `assert.test.ts` cover a truthy and a falsy value, the message, the name and the code. Add `assert` to the members that `extensions/common-api/utils.ts` keeps out of `Util`, so that the extension API gains no member.

**Checkpoint**:

- the app starts and works as before, with the preload in every frame;
- `pnpm build` passes with the gate in list mode;
- the messaging packages no longer import `electron` in the renderer.

---

## Phase 3: User Story 2 - The renderer computes without Node (Priority: P2)

**Goal**: every computation that needs nothing from the machine uses what a
browser page and Node both have, with the same results.

**Independent Test**: each task's unit tests pass; the files it frees are off
the renderer legacy list and the Biome exemption, and `pnpm type:check` passes
(spec.md, User Story 2).

### `node:assert` only (inventory section 1)

- [ ] T010 [P] [US2] Replace `node:assert` with `assert` from `@freelensapp/utilities` in the config stores, and free each. The files are under `renderer/components/`: `config-horizontal-pod-autoscalers/store.injectable.ts`, `config-leases/store.injectable.ts`, `config-limit-ranges/store.injectable.ts`, `config-maps/store.injectable.ts`, `config-mutating-webhook-configurations/mutating-webhook-configuration-store.injectable.ts`, `config-pod-disruption-budgets/store.injectable.ts`, `config-priority-classes/store.injectable.ts`, `config-resource-quotas/store.injectable.ts`, `config-runtime-classes/store.injectable.ts`, `config-secrets/store.injectable.ts`, `config-validating-admission-policies/validating-admission-policy-store.injectable.ts`, `config-validating-admission-policy-bindings/validating-admission-policy-binding-store.injectable.ts`, `config-validating-webhook-configurations/validating-webhook-configuration-store.injectable.ts` and `config-vertical-pod-autoscalers/store.injectable.ts`.
- [ ] T011 [P] [US2] The same for these stores under `renderer/components/`: `cluster/store.injectable.ts`, `custom-resource-definitions/store.injectable.ts`, `events/store.injectable.ts`, `namespaces/store.injectable.ts`, `network-endpoint-slices/store.injectable.ts`, `network-endpoints/store.injectable.ts`, `network-ingresses/ingress-class-store.injectable.ts`, `network-ingresses/ingress-store.injectable.ts`, `network-policies/store.injectable.ts`, `network-services/store.injectable.ts`, `nodes/store.injectable.ts` and `pod-security-policies/store.injectable.ts`.
- [ ] T012 [P] [US2] The same for these stores under `renderer/components/`: `storage-classes/store.injectable.ts`, `storage-volume-claims/store.injectable.ts`, `storage-volumes/store.injectable.ts`, `user-management/cluster-role-bindings/store.injectable.ts`, `user-management/cluster-roles/store.injectable.ts`, `user-management/role-bindings/store.injectable.ts`, `user-management/roles/store.injectable.ts` and `user-management/service-accounts/store.injectable.ts`.
- [ ] T013 [P] [US2] The same for these stores under `renderer/components/`: `workloads-cronjobs/store.injectable.ts`, `workloads-daemonsets/store.injectable.ts`, `workloads-deployments/store.injectable.ts`, `workloads-jobs/store.injectable.ts`, `workloads-pods/store.injectable.ts`, `workloads-replicasets/store.injectable.ts` and `workloads-statefulsets/store.injectable.ts`.
- [ ] T014 [P] [US2] The same in the dock, and free each: `renderer/components/dock/edit-resource/edit-resource-model/edit-resource-model.injectable.tsx`, `renderer/components/dock/install-chart/install-chart-model.injectable.tsx`, `renderer/components/dock/logs/logs-view-model.ts`, `renderer/components/dock/terminal/terminal-spawning-pool.injectable.ts`, `renderer/components/dock/terminal/terminal.ts` and `renderer/components/dock/terminal/view.tsx`. Also free `renderer/components/dock/terminal/create-terminal.injectable.ts`, whose only error was a knock-on of the pool's `assert`.
- [ ] T015 [P] [US2] The same in Helm, and free each: `renderer/components/helm-charts/helm-chart-details.tsx`, `renderer/components/helm-releases/release-details/release-details-model/release-details-model.injectable.tsx` and `renderer/components/helm-releases/releases.injectable.ts`.
- [ ] T016 [P] [US2] The same in these shared components, and free each: `renderer/components/chart/bar-chart.tsx`, `renderer/components/slider/slider.tsx`, `renderer/components/table/table.tsx` and `renderer/components/cluster-manager/cluster-frame-handler.ts`. The first three are reached through `Renderer.Component`; their behaviour does not change.
- [ ] T017 [P] [US2] The same in these frame and API files, and free each: `renderer/api/request-cluster-shell-token.injectable.ts`, `renderer/cluster-frame-context/for-namespaced-resources.injectable.ts`, `renderer/k8s/api-kube.injectable.ts`, `renderer/protocol-handler/bind-protocol-add-route-handlers/bind-protocol-add-route-handlers.tsx` and `renderer/frames/cluster-frame/init-cluster-frame/init-cluster-frame.injectable.ts`.
- [ ] T018 [P] [US2] The same, and free each: `renderer/utils/storage-helper.ts`, `renderer/utils/sync-box/provide-initial-values-for-sync-boxes.injectable.ts`, `features/hotbar/storage/common/remove.injectable.ts` and `features/namespace-filtering/renderer/storage.injectable.ts`.
- [ ] T019 [P] [US2] The same in `common/initializable-state/create.ts`, and free it. The snapshot in `create.test.ts` expects `AssertionError`, which the new `assert` keeps.
- [ ] T020 [P] [US2] In `common/k8s-api/kube-object.store.ts`, replace `node:assert` with `assert` and `NodeJS.Timeout` with `ReturnType<typeof setTimeout>`, and free it. `K8sApi.KubeObjectStore` keeps its failure name and code.
- [ ] T021 [P] [US2] Replace `node:assert` with `assert` from `@freelensapp/utilities` in `packages/utility-features/kube-api/src/kube-api.ts`, every `packages/utility-features/kube-api-specifics/src/specifics/*.api.injectable.ts`, and `packages/utility-features/run-many/src/helpers.ts`, adding the package dependency where it is missing. Leave the bundle list for their entries.

### Other pure computations (inventory sections 2 to 4)

- [ ] T022 [P] [US2] Replace `node:events` with `@freelensapp/event-emitter` in `packages/utility-features/run-many/src/run-many-for.ts`. Its tests still pass, including a handler that removes itself during an emit. Leave the bundle list.
- [ ] T023 [P] [US2] Replace `node:querystring` in `packages/utility-features/json-api/src/json-api.ts` with a local `stringify`, equal to Node's (research R8). Unit tests compare it with `node:querystring`'s on spaces, `!~*'()`, Unicode, arrays, empty arrays, `NaN` and `Infinity`. Leave the bundle list.
- [ ] T024 [P] [US2] Rewrite `packages/utility-features/utilities/src/base64.ts` with `atob`/`btoa`, `TextEncoder` and `TextDecoder({ fatal: true })` (research R8), and guard `isBuffer` in `type-narrowing.ts` with `typeof Buffer !== "undefined"`. Unit tests compare the base64 results with `Buffer`'s on ASCII, Unicode, binary and invalid input. Leave the bundle list.
- [ ] T025 [P] [US2] Move `packages/utility-features/utilities/src/union-env-path.ts` out of the package into `features/shell-sync/main/union-env-path.ts`, beside its only caller `features/shell-sync/main/setup-shell.injectable.ts`, with its tests. Remove its export from the package's `index.ts` and its name from the list in `extensions/common-api/utils.ts`.
- [ ] T026 [P] [US2] In `renderer/before-frame-starts/runnables/refresh-accessibility-on-crd-changes.injectable.ts`, replace `NodeJS.Timeout` with `ReturnType<typeof setTimeout>`, and free it.
- [ ] T027 [P] [US2] Delete `common/fs/lstat.injectable.ts` and `common/utils/platform-specific-version.injectable.ts`, which nothing imports, with their global overrides if any, and free both.
- [ ] T028 [P] [US2] Remove `isDisabled` from `features/preferences/renderer/preference-items/kubernetes/kubectl/kubectl-download-mirror/kubectl-download-mirror.tsx`, and the `platforms` set from `features/user-preferences/common/preferences-helpers.ts` (research R8), and free both. A unit test shows that every mirror is offered on each platform.
- [ ] T029 [P] [US2] Replace the `FileFilter` type from `electron` in `features/helm-charts/child-features/preferences/renderer/adding-of-custom-helm-repository/helm-file-input/get-file-paths.injectable.ts` with a local type `{ name: string; extensions: string[] }`.
- [ ] T030 [US2] Make `renderer/routes/currently-in-cluster-frame.injectable.ts` return `window.top !== window`. Then inject it instead of reading `process.isMainFrame` in:
  - `renderer/api/catalog/entity/registry.ts`, with a test that the root frame now adds the `catalog-entity:run` listener;
  - `renderer/bootstrap.tsx`, also replacing its `node:assert` with `assert`;
  - `renderer/frames/frame-application-root.injectable.ts`;
  - `renderer/navigation/setup-logging-for-navigation.injectable.ts`, also using `window.location`.

  Free all five.
- [ ] T031 [US2] Delete `renderer/frames/cluster-frame/init-cluster-frame/frame-token/web-frame/web-frame.injectable.ts` and `frame-token.injectable.ts`, with their registration directories. Add `renderer/frames/frame-log-id.injectable.ts`, which holds one `crypto.randomUUID()` per frame. The log lines that used the token, in `renderer/frames/cluster-frame/init-cluster-frame/init-cluster-frame.ts`, its injectable `init-cluster-frame.injectable.ts` beside it, and `renderer/before-frame-starts/runnables/listen-unload.injectable.ts`, inject that value instead (research R8). Leave the bundle list for the `electron` import. Depends on T017.
- [ ] T032 [US2] Give the renderer program `ImportMeta.env` types in `packages/core/src/renderer/import-meta-env.d.ts` and `freelens/src/renderer/import-meta-env.d.ts`, declaring only `MODE`, `DEV` and `PROD`. Make `freelens/src/renderer/node-env.injectable.ts` return `import.meta.env.DEV ? "development" : "production"`, and make `renderer/components/virtual-list/virtual-list.tsx` test `import.meta.env.MODE === "test"`. Free both. A unit test shows `node-env` answering `"development"` and `"production"` for the two values of `DEV`.
- [ ] T033 [US2] Move `common/utils/reactive-now/reactive-now.ts` to `renderer/utils/reactive-now/reactive-now.ts`, switching its test detection to `import.meta.env.MODE === "test"`. Update its importers (`reactive-duration.tsx`, `secret-certificates-section.tsx` and the `Renderer.Component` export path) without changing `ReactiveDuration`. Remove it from both the `main` and the `renderer` lists of `legacy.jsonc`. Depends on T032.
- [ ] T034 [P] [US2] In `renderer/api/terminal-api.ts`, build the WebSocket URL with `URL` and `URLSearchParams`, leaving out undefined values, and encode the token with `btoa` (research R8). Free it. A unit test shows that an undefined `node` is not sent, and that the token decodes as main's `Buffer.from(…, "base64")` does.
- [ ] T035 [P] [US2] In `renderer/components/node-pod-menu/pod-attach-menu.tsx` and `renderer/components/node-pod-menu/pod-shell-menu.tsx`, inject `isWindowsInjectable` instead of calling `os.platform()`. Free both. Their tests replace `vi.spyOn(os, "platform")` with an override of `platformInjectable` (FR-019).
- [ ] T036 [US2] Split `packages/logger` by process (research R9):
  - `src/common/`: the logger tokens, the prefixed logger and the `Logger` type, with `loggerInjectable` no longer injecting winston directly;
  - `src/main/`: `winston-logger.injectable.ts`, a transport token typed `TransportStream`, and `loggerFeatureForMain`;
  - `src/renderer/`: a Node-free logger that formats entries as the winston logger does and writes them to the renderer's transports, a transport token typed by a local interface, and `loggerFeatureForRenderer`;
  - `package.json` `exports`: `.` (common), `./main` and `./renderer`; `freelens/src/main/index.ts` and `freelens/src/renderer/index.ts` each register their own feature.

  Run `pnpm build:di` and check that it generates a registration for each directory; if it registers the package as one unit, stop and record it before going on. Unit tests compare the lines of the two loggers for each level, with a prefix, and for an error with a stack. Main's transports import the token from `@freelensapp/logger/main`.
- [ ] T037 [US2] Give `renderer/logger/browser-console-transport.ts` and `features/population-of-logs-to-a-file/renderer/ipc-transport.ts` a Node-free transport base, replacing `setImmediate` with `setTimeout(…, 0)`, and register them on the renderer's transport token from `@freelensapp/logger/renderer`. Free both, and leave the bundle list for `winston`, which no renderer module imports afterwards. The IPC transport still sends on `ipc-file-logger-channel`. Depends on T036.
- [ ] T038 [US2] Port the posix and win32 forms of `join`, `normalize`, `basename`, `dirname`, `parse`, `sep` and `isAbsolute` from Node's `lib/path.js` into `renderer/path/node-path-port.ts`, keeping Node's upstream notice (research R7). Unit tests in `node-path-port.test.ts` compare every function with `node:path`'s `posix` and `win32` on a table that covers drive letters, UNC shares, mixed separators, trailing separators, `.`, `..` and empty strings, with no case that differs (SC-007).
- [ ] T039 [US2] Split the path injectables by process, keeping their ids and types in `common/path/`:
  - `common/path/join-paths.injectable.ts`, `common/path/get-basename.injectable.ts`, `common/path/get-dirname.injectable.ts`, `common/path/parse.injectable.ts` and `common/path/separator.injectable.ts` get a main implementation on `node:path` under `common/path/main/` and a renderer implementation on the port of T038, chosen by `platformInjectable`, under `common/path/renderer/`;
  - `common/path/get-absolute-path.injectable.ts` moves to main only, with its only common importers, `common/path/is-logical-child-path.injectable.ts` and `common/path/resolve-path.injectable.ts`;
  - the global overrides follow.

  Free the six files. Depends on T038.
- [ ] T040 [P] [US2] Move `common/certificate/ca-certificates.injectable.ts`, `common/fs/create-read-file-stream.injectable.ts` and `common/fs/exec-file.injectable.ts` under `main/`: no renderer code uses them. Update their main importers and global overrides, and free all three. `common/fs/exec-file.test.ts` moves with its code (FR-019).
- [ ] T041 [US2] In `extensions/extension-loader/extension-loader.ts`, do three things (research R8):
  - test the process with the entry-point-name token instead of `ipcMain`;
  - move `fileUrlOf` behind a main-only injectable;
  - compute each extension id's SHA-256 with `crypto.subtle.digest` before creating the extension's instance, caching it by id.

  Make `extensions/ipc/ipc-registrar.ts` read the cache instead of `node:crypto`. Free both (the loader stays on the `main` list). A unit test shows that the prefix equals the one main computes with `node:crypto`.

**Checkpoint**: every US2 file of `contracts/legacy-inventory.md` is free, and
the app works as before.

---

## Phase 4: User Story 1 - Values and actions of the machine come from the main side (Priority: P1) 🎯 MVP

**Goal**: every value of the machine the renderer uses comes from main, and every
action on the file system or on processes is done by main, over the channels of
`contracts/channels.md`.

**Independent Test**: for each moved feature, the check of quickstart.md "User
Story 1" gives the same result on the branch and on `main`. The freed files are
off the renderer legacy list and the Biome exemption, and `pnpm type:check`
passes.

### Values at startup (research R4)

- [ ] T042 [US1] Add the `machine-values` request channel in `features/machine-values/`:
  - the channel in `common/channel.ts`;
  - main's listener in `main/request-listener.injectable.ts`, answering from main's own injectables;
  - a renderer state in `renderer/state.injectable.ts` that throws when read before it is set;
  - a `beforeApplicationIsLoadingInjectionToken` runnable in `renderer/setup.injectable.ts`, beside `setup-app-paths`, that requests it and fills the state. Every other `beforeApplicationIsLoading` runnable that reads machine values, directly or through the path injectables, `initialize-state` among them, runs after it (`runAfter`).

  The answer has the fields `data-model.md` MachineValues.platform, MachineValues.isDebugging, MachineValues.isSnap, MachineValues.isFlatpak, MachineValues.homeDirectory, MachineValues.kubeDirectory and MachineValues.bundledHelmPath. Unit tests cover both sides against `messaging-fake-bridge`, and reading the state before it is set. Add the channel row.
- [ ] T043 [US1] Split `common/vars/platform.injectable.ts`, `common/vars/is-debugging.injectable.ts`, `common/vars/is-snap-package.injectable.ts` and `common/vars/is-flatpak-package.injectable.ts` by process. Main keeps `process`; the renderer reads the state of T042. Callers and `Common.App.isWindows`, `isMac`, `isLinux`, `isSnap` and `isFlatpak` stay synchronous. Free all four, keeping the existing overrides of `platformInjectable` in tests. A unit test shows the renderer reading the platform and the three flags from the state. Depends on T042.
- [ ] T044 [US1] Split `common/os/home-directory-path.injectable.ts` and `common/os/kube-directory-path.injectable.ts` by process. Main keeps its implementation, including the integration-testing override; the renderer reads `homeDirectory` and `kubeDirectory` from the state. Free both. A unit test shows the renderer reading both directories from the state. Depends on T042.
- [ ] T045 [US1] Move `common/vars/user-info.injectable.ts`, `common/vars/process-arch.injectable.ts` and `common/vars/lens-resources-dir.injectable.ts` under `main/`. The renderer's helm placeholder in `features/preferences/renderer/preference-items/kubernetes/helm/helm-path-to-binary/helm-path-to-binary.tsx` reads `bundledHelmPath` from the state. With them move their importers that only main uses afterwards: `common/vars/normalized-platform-architecture.injectable.ts`, `common/vars/bundled-resources-dir.injectable.ts`, `common/vars/base-bundled-binaries-dir.injectable.ts`, `common/utils/bundled-binary-path.injectable.ts` and `features/user-preferences/common/shell-setting.injectable.ts` (`contracts/legacy-inventory.md`, section 6). Free all three. A unit test shows the placeholder showing the state's `bundledHelmPath`. Depends on T044.
- [ ] T046 [P] [US1] Split `common/app-paths/directory-for-user-data/directory-for-user-data.injectable.ts` by process. The renderer returns `appPaths.userData`; main keeps the integration-testing override. Free it. A unit test shows the renderer returning `appPaths.userData`.
- [ ] T047 [P] [US1] Move `common/vars/default-shell.injectable.ts` under `main/`. The placeholder of `features/preferences/renderer/preference-items/terminal/terminal-shell-path/terminal-shell-path.tsx` starts empty until `look-up-terminal-shell` answers. Free it. A unit test shows the placeholder empty first, then showing main's answer.

### One-task channels (research R6)

- [ ] T048 [P] [US1] Make `common/utils/open-link-in-browser.injectable.ts` an injection token. Main's implementation keeps `shell.openExternal`, and the renderer's requests the new `open-link-in-browser` channel, answered in `features/open-link-in-browser/main/`, which refuses any URL that is not `http:` or `https:`. Unit tests cover both sides and the refusal. Move the global override and the `open-whats-new` test override to the main implementation (FR-019). Add the channel row, and leave the bundle list for the `electron` import.
- [ ] T049 [P] [US1] Add `reveal-cluster-kubeconfig` in `features/cluster/reveal-kubeconfig/`. Main reveals the `kubeConfigPath` of the cluster with that id, and refuses an unknown id. `renderer/components/cluster-settings/kubeconfig.tsx` requests it instead of calling `shell`. Tests on both sides; add the channel row; leave the bundle list.
- [ ] T050 [P] [US1] Add `wait-until-port-free` in `features/port-forward/`. Main waits with `tcp-port-used`'s `waitUntilFree` (200 ms interval, 1000 ms timeout). `renderer/port-forward/port-forward-store/port-forward-store.ts` requests it. Tests on both sides. Add the channel row in a new "main-port-forward" section of `specs/002-messaging-for-tauri/contracts/channel-list.md`, and drop main-port-forward from that list's sentence saying no channel belongs to it; leave the bundle list.
- [ ] T051 [P] [US1] Add `validate-directory` and `path-exists` in `features/validate-directory/`, with main resolving `~`. Then:
  - move `common/fs/validate-directory.injectable.ts` under `main/`;
  - make `renderer/components/cluster-settings/local-terminal-settings.tsx` request `validate-directory`;
  - make `isPath` in `renderer/components/input/input_validators.ts` request `path-exists`, staying an async validator with the same message, since `Renderer.Component.InputValidators` reaches it;
  - make `renderer/components/input/validators/is-path.injectable.ts`, the validator of the custom Helm repository dialog, request `path-exists` instead of injecting `common/fs/path-exists.injectable.ts`.

  Tests on both sides, including a missing path and `~`. Add both channel rows, free `validate-directory.injectable.ts`, and leave the bundle list for `input_validators.ts` if it brings in nothing else.
- [ ] T052 [P] [US1] Add `discover-kubeconfig-sync-kind` in `features/kubeconfig-sync-kind/`, and make `features/preferences/renderer/preference-items/kubernetes/kubeconfig-sync/discover-sync-kind.injectable.ts` request it instead of `stat`. Tests on both sides, including a missing path; add the channel row.
- [ ] T053 [US1] Move the resource templates to main in `features/user-resource-templates/`. Main watches `~/.freelens/templates` as `renderer/components/dock/create-resource/user-templates.injectable.ts` does today, answers `initial-user-resource-templates`, and sends `user-resource-templates-update` on change, as `features/theme/files` does with themes. The renderer injectable requests and listens. Move `common/utils/wait-for-path.ts` and `common/path/get-relative-path.injectable.ts` under `main/`; `common/fs/watch/watch.injectable.ts` stays where it is until T063, because `extension-discovery.injectable.ts` still imports it in the renderer. The answers carry `data-model.md` Resource templates.label, Resource templates.options[].label and Resource templates.options[].value. Tests on both sides, including a template added after the first answer. Add both channel rows, and free the three files.

### Storage (research R5)

- [ ] T054 [US1] Add `lens-local-storage:read` and `lens-local-storage:write` in `features/local-storage/`. Main builds `<userData>/lens-local-storage/<clusterId|app>.json` and refuses an unregistered cluster id (`data-model.md` Local storage request.clusterId, Local storage request.state). `renderer/utils/create-storage/initialize-state.injectable.ts`, which both reads the file and saves it on change, requests them instead of `readJsonFile` and `writeJsonFile`. Tests on both sides, including a missing file and an unknown cluster. Add both channel rows, and leave the bundle list.
- [ ] T055 [US1] Add `persistent-storage-initial-values` in `features/persistent-storage/`:
  - main answers from its registry of loaded storages (`data-model.md` Store snapshot entry.configName, Store snapshot entry.path, Store snapshot entry.model), and each renderer store finds its entry by `configName`;
  - a renderer runnable on `beforeApplicationIsLoadingInjectionToken`, beside `setup-app-paths` and the runnable of T042, so the three requests go in parallel, requests the snapshot, fills a map, and registers each `store-sync-renderer:<path>` listener as soon as the answer arrives (research R5). The stores load at `beforeFrameStartsSecond`, after it.

  Tests on both sides, including a store missing from the answer. Add the channel row.
- [ ] T056 [US1] Give the renderer an implementation of `common/get-configuration-file-model/get-configuration-file-model.injectable.ts`: an in-memory object of the `Conf` shape, seeded from the map of T055 with main's `path`. Split `features/persistent-storage/common/create.injectable.ts` by process: the renderer uses that model and `queueMicrotask` instead of `nextTick`, and the corrupt-file backup stays in main. Move `common/fs/read-file-buffer-sync.injectable.ts` and `common/fs/write-buffer-sync.injectable.ts` under `main/`. Free all three, and leave the bundle list for `conf`. Update the `store-sync-main:<conf path>` and `store-sync-renderer:<conf path>` rows of `specs/002-messaging-for-tauri/contracts/channel-list.md` for the files that now answer them. The storage unit tests pass, and quickstart's "change a preference, then quit at once" keeps the change. Depends on T055.

### Kubeconfig (research R6)

- [ ] T057 [P] [US1] Move `defaultYamlDumpOptions` out of `common/kube-helpers.ts` into `common/kube-helpers/yaml-dump-options.ts`, and point at it the views that import only that constant and `common/k8s/resource-stack.ts`, which `Renderer.K8sApi` reaches.
- [ ] T058 [US1] Add `parse-kubeconfig-text` and `add-kubeconfig-text` in `features/add-cluster/`. Main parses and splits the pasted text and writes it into the kubeconfig directory, as `renderer/components/add-cluster/add-cluster.tsx` does today. The answers carry `data-model.md` Pasted kubeconfig check.contexts and Pasted kubeconfig check.error, and no credential. The dialog requests them. Tests on both sides with a valid text, an invalid one and a bad context, checking that no answer contains a certificate, key or token. Add both channel rows.
- [ ] T059 [US1] Add `cluster-kubeconfig-contexts` and `remove-cluster-context-from-kubeconfig` in `features/cluster/delete-dialog/`. Main loads the cluster's kubeconfig, answers `data-model.md` Kubeconfig summary.contexts, Kubeconfig summary.currentContext and Kubeconfig summary.defaultNamespace, and removes the context and sets the new current one under the file lock. Make these request them instead of loading the file:
  - the delete dialog (`renderer/components/delete-cluster-dialog/view.tsx` and its state);
  - the dialog's opener `renderer/before-frame-starts/runnables/setup-kubernetes-cluster-context-menu-open.injectable.ts`;
  - `renderer/components/cluster-settings/local-terminal-setting-presenter.injectable.ts`.

  Delete `renderer/components/delete-cluster-dialog/save-kubeconfig.injectable.ts` and its global override. Tests on both sides, checking that no answer carries a credential. Add both channel rows.
- [ ] T060 [US1] Move `common/kube-helpers/load-config-from-file.injectable.ts`, `common/cluster/load-kubeconfig.injectable.ts`, `common/cluster/create-core-api.injectable.ts` and `common/cluster/create-authorization-api.injectable.ts` under `main/`, with `common/kube-helpers/load-validated-config-from-file.injectable.ts`, `common/kube-helpers/read-kubeconfig-file.injectable.ts` and what of `common/kube-helpers.ts` only main uses. `common/kube-helpers/load-config-from-file.test.ts` moves with its code (FR-019). Leave the bundle list for `@kubernetes/client-node`; no renderer module brings it in afterwards. Depends on T057, T058 and T059.

### Extension system (research R5, R6; channels Not ported)

- [ ] T061 [US1] Add `extension-file-folder` in `features/extensions/file-folder/`. Main computes the store name, records it and ensures the folder, and `LensExtension.getExtensionFileFolder()` requests it, staying async with the same result. Move `extensions/extension-loader/file-system-provisioner-store/get-hash.injectable.ts`, `common/utils/random-bytes.injectable.ts` and their importer `extensions/extension-loader/file-system-provisioner-store/ensure-hashed-directory-for-extension.injectable.ts` under `main/`, and split `extensions/lens-extension.ts` by process so that only main's `getExtensionFileFolder` reaches it: `extensions/lens-renderer-extension.ts` requests the channel, and `extensions/lens-main-extension.ts` keeps the direct call. `get-hash.test.ts` and `ensure-hashed-directory-for-extension.test.ts` beside them move with their code (FR-019). Tests on both sides; add the channel row under "Not ported"; free both.
- [ ] T062 [US1] Keep every `conf` option of `ExtensionStore` in the renderer (research R5):
  - **Class**: grow the in-memory object of T056 into a `Conf`-compatible class in `common/get-configuration-file-model/renderer/conf-compatible.ts`. It covers `serialize`/`deserialize`, `defaults`, the `ajv` schema, dot-notation access, migrations by `conf`'s algorithm with `projectVersion`, and change events. Unit tests run each scenario through `conf` itself and through the class, and compare the store and the text written: defaults, a schema failure, migrations across versions, dot notation, custom serialization.
  - **Read**: add `extension-store:read` in `extensions/stores/main/`, under the extension system whose IPC FR-013 exempts, as synchronous IPC: `ipcMain.on` with `event.returnValue` in main, and `sendSync` through `window.freelensViewBridge.ipcRenderer` in `extensions/stores/renderer/`. Main reads the store's folder, the `cwd` as given or else the store directory it computes, refuses a bad name, and decrypts with the store's key as `conf` does (`data-model.md` Extension store read.extensionId, Extension store read.configName, Extension store read.fileExtension, Extension store read.encryptionKey, Extension store read.cwd, Extension store read.path, Extension store read.contents).
  - **Write**: add the request `extension-store:write` beside it. Main encrypts when keyed and writes atomically (`data-model.md` Extension store write.extensionId, Extension store write.configName, Extension store write.fileExtension, Extension store write.encryptionKey, Extension store write.cwd, Extension store write.contents).
  - **Loading**: `extensions/base-extension-store.ts` loads through them synchronously and writes back what `conf` would write on load, also for a store only the renderer loads. `cwd()` returns the folder of the `path` main answered, so the renderer computes no store path.

  Tests in main cover a missing file, a bad name, a `cwd` given by the extension, and an encryption round trip against files `conf` wrote with a key. Tests in the renderer run the store against a fake `sendSync` and a fake `extension-store:write`. Add both channel rows under "Not ported", adding `sync` to the list's definition of **Kind** for `extension-store:read`, and free the file. Depends on T039 and T056.
- [ ] T063 [US1] Split `extensions/extension-discovery/extension-discovery.ts` and its injectable by process (research R6):
  - scanning, watching and sweeping stay in main;
  - the renderer keeps a follower of the state for `isLoaded`, on `@freelensapp/event-emitter`, tested with the entry-point-name token;
  - `renderer/components/extensions/uninstall-extension.injectable.tsx` requests a new `extension:uninstall` channel, answered in `features/extensions/installer/main/`, in which main resolves the extension itself.

  Move `features/extensions/installer/common/sweep-orphaned-builds.injectable.ts` and, now that no renderer module imports it, `common/fs/watch/watch.injectable.ts` under `main/`; `managed-directory.ts` moves in T065, once its last renderer importer is gone. Update the `extension-discovery:state` row of `specs/002-messaging-for-tauri/contracts/channel-list.md` for the files that now answer it. Tests on both sides; add the channel row under "Not ported"; free the three files; leave the bundle list for `chokidar` and `electron`.
- [ ] T064 [US1] Add the install channels of `contracts/channels.md` in `features/extensions/installer/main/`: `extension-install:stage-from-path`, `extension-install:stage-from-url`, `extension-install:commit`, `extension-install:discard`, `extension-install:register-directory` and `extension-install:open-folder`.
  - **Answers**: staging answers `data-model.md` Staged extension.kind, Staged extension.stagingId, Staged extension.fileName, Staged extension.manifest and Staged extension.verified.
  - **What main does**: the stat, the read, the checksum sidecar, the temporary copy, validation, unpacking and activation, from the current renderer code.
  - **State**: a `stagingId` is valid for one commit or discard, and main removes what it still holds on quit.
  - **Checksums**: split `features/extensions/installer/common/checksums.ts`; the digests move to main, and `parseChecksumSidecar` and `shortenDigest` stay common.

  Tests in main for each channel, including an unknown or reused `stagingId`, a bad checksum and a package without a manifest. Tests in the renderer for each request against `messaging-fake-bridge`. `features/extensions/installer/common/checksums.test.ts` follows the split: the digest tests move with the digests (FR-019). Add the channel rows under "Not ported", and free `checksums.ts`.
- [ ] T065 [US1] Make the renderer's install flow request the channels of T064:
  - **Request instead of doing the work**: `renderer/components/extensions/attempt-install/attempt-install.injectable.tsx` (its `shell.openPath` becomes `open-folder`), `renderer/components/extensions/attempt-install/install-from-file.injectable.tsx`, `install-from-url.injectable.tsx` and `install-from-directory.injectable.tsx` in the same directory, `renderer/components/extensions/attempt-install-by-info.injectable.tsx`, and `renderer/components/extensions/install-from-select-file-dialog.injectable.ts`. The uninstall is T063's.
  - **Drop install**: `renderer/components/extensions/install-on-drop.injectable.ts` takes paths from `window.freelensViewBridge.getPathForFile`.
  - **Stat in main**: `renderer/components/extensions/attempt-installs.injectable.ts` and `renderer/components/extensions/install-extension-from-input.injectable.tsx` stop calling `stat`; `stage-from-path` answers the kind.
  - **Move under `main/`**: `renderer/components/extensions/attempt-install/validate-package.tsx`, `renderer/components/extensions/attempt-install/unpack-extension.injectable.tsx`, `renderer/components/extensions/attempt-install/get-extension-dest-folder.injectable.ts`, `renderer/components/extensions/attempt-install/create-temp-files-and-validate.injectable.tsx`, `features/extensions/installer/common/activate-installed-build.injectable.ts` and `features/extensions/installer/common/managed-directory.ts`, with `common/fs/extract-tar.injectable.ts`, `common/os/temp-directory-path.injectable.ts` and `packages/utility-features/utilities/src/tar.ts`. The last leaves the package barrel and the list in `extensions/common-api/utils.ts`.
  - **Delete**: `renderer/components/extensions/read-file-notify/read-file-notify.injectable.ts`.
  - **Tests (FR-019)**, all under `renderer/components/extensions/`: `attempt-install/unpack-extension.test.tsx` and `attempt-install/create-temp-files-and-validate.test.tsx` move with their code to main, beside the tests of T064's channels, as do `features/extensions/installer/common/managed-directory.test.ts` and `activate-installed-build.test.ts` beside it. `attempt-install/attempt-install.test.tsx`, `attempt-install/install-from-directory.test.tsx`, `attempt-install/install-from-url.test.ts`, `attempt-install-by-info.test.ts`, `attempt-install-by-info-download.test.ts`, `attempt-install-by-info-registry-url.test.ts` and `install-extension-from-input.test.tsx` stay in the renderer and fake the channels; `get-tarball-download-url.test.ts` is unchanged. No test is removed.

  Free every listed file, and leave the bundle list for `tar` and `fs-extra` where nothing else brings them in. The notifications and the confirm dialog stay in the renderer. Depends on T064.
- [ ] T066 [US1] Add `extension-files:write-picked` in `features/extensions/file-picker/`. Main writes the picked files into the `uploadDir` the extension names, as today (FR-007), and refuses a file name with a separator or `..` (`contracts/channels.md`, rule 4). `renderer/components/file-picker/file-picker.tsx` reads the picked files' bytes in the page and requests it for `uploadDir`, and keeps memory mode as it is. Tests in main for a folder inside and outside the extension's directories, both written, a binary file of a few MB written byte for byte, and a name with a separator, refused; a test in the renderer against `messaging-fake-bridge`. Add the channel row under "Not ported", and free the file.
- [ ] T067 [US1] Add `extension-resource-stack:read-folder` in `features/extensions/resource-stack/`, reading the folder the extension names, as today (FR-007). Split `common/k8s/create-resource-stack.injectable.ts` by process: in the renderer, `common/k8s/resource-stack.ts` requests the channel for `kubectlApplyFolder` and `kubectlDeleteFolder`, staying async; `Main.K8sApi.createResourceStack` reads the folder directly. Move `common/fs/read-directory.injectable.ts` under `main/`. Tests in main for the channel and for the direct read, and a test in the renderer against `messaging-fake-bridge`. Add the channel row under "Not ported", and free `read-directory.injectable.ts`.
- [ ] T068 [US1] Move `common/fs/fs.injectable.ts`, `common/fs/stat.injectable.ts`, `common/fs/write-file.injectable.ts` and every wrapper of `common/fs/` over `fs.injectable.ts` (`access-path`, `copy`, `ensure-dir`, `path-exists`, `path-exists-sync`, `read-file`, `read-file-buffer`, `read-file-sync`, `read-json-file`, `read-json-sync`, `realpath`, `remove`, `unlink`, `write-file-sync`, `write-json-file`, `write-json-sync`; `contracts/legacy-inventory.md`, section 6) under `main/`, now that no renderer code calls them, with their global overrides and with `common/fs/read-yaml-file.injectable.ts`, which only main uses. `common/fs/write-json-file.test.ts` moves with its code (FR-019). Free the three listed files, and leave the bundle list for `fs-extra`. Depends on T027, T040 and T051 to T067.

**Checkpoint**:

- the renderer legacy list holds only
  `features/extensions/loader/renderer/require-deprecation-warning.ts`;
- the `rendererBundle` list is empty;
- quickstart.md "User Story 1" matches `main`, with Node integration still on.

---

## Phase 5: User Story 3 - The application runs with Node integration off (Priority: P3)

**Goal**: nothing in the renderer needs Node, the build refuses Node, and the
window runs without it.

**Independent Test**: quickstart.md "User Story 3", after the last task.

- [ ] T069 [US3] Delete `features/extensions/loader/renderer/require-deprecation-warning.ts`, `features/extensions/loader/renderer/warn-on-extension-require.injectable.ts`, their call in `renderer/frames/load-extensions.injectable.ts`, and their test `features/extensions/loader/renderer/require-deprecation-warning.test.ts`, which goes with the code it tests (FR-019). Free the file. In `docs/extensions/api.md`, rewrite C4's paragraph on `globalThis.require` to say that it is absent in the renderer (research R10). Add a unit test in `extensions/extension-loader/` showing that an extension whose renderer entry point throws `ReferenceError: require is not defined`, once at import (a top-level `require`) and once on activation, is logged with its name and does not stop the next extension from loading (FR-015).
- [ ] T070 [US3] Check that the `renderer` list of `scripts/type-check-environments/legacy.jsonc` is empty, and remove the now-empty `noNodejsModules` exemption override from `biome.jsonc`. Make `scripts/type-check-environments.mjs` accept the missing override, and keep the empty `renderer` list so that a new entry is still refused; rewrite its comment, which still speaks of the node-integrated renderer. `pnpm type:check` passes (SC-001).
- [ ] T071 [US3] Switch the gate to "Phase 2" of `contracts/bundle-gate.md` in `freelens/electron.vite.config.ts`:
  - remove the empty `rendererBundle` list and its comment from `legacy.jsonc`;
  - stop emitting the runtime-require shims;
  - fail on any builtin, `electron` or `__vite-browser-external` import in the renderer graph, in development as well as in builds;
  - update `freelens/build-plugins/renderer-bundle-gate.test.ts`.

  After `pnpm build`, `grep -c 'globalThis\["require"\]' freelens/static/build/assets/*.js` is `0` for every file, and `pnpm dev` starts.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: documents and checks, before the last task.

- [ ] T072 [P] Update the documents of plan.md's Conventions row:
  - "Node and Electron in the renderer" in `docs/extensions/migrating-from-v1.md`, which no longer says they are reachable;
  - "Runtime Environments in Type-Checking" in `AGENTS.md`, which drops the node-integrated renderer, the Biome exemption and the description of the `rendererBundle` list that T004 added, and states the gate's rule as it stands after T071.

  No section name that the `freelens` plugin skills cite changes.
- [ ] T073 [P] Review every channel of `contracts/channels.md` against the code and `specs/002-messaging-for-tauri/contracts/channel-list.md`, as quickstart.md "SC-006" lists, and every existing row of that list whose answering file this feature moved, and fix any row that differs.
- [ ] T074 Run `pnpm build && pnpm knip:check` and `trunk check`. Compare `pnpm test:unit` with `$TMPDIR/003-baseline/` (FR-019): no test removed, and every test file edit is one FR-019 allows.

---

## Phase 7: Node integration off (last task)

- [ ] T075 [US3] Set `webPreferences` in `main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts` to `nodeIntegration: false` and `sandbox: true`, keeping `nodeIntegrationInSubFrames: true`, `contextIsolation: false` and the preload (FR-012). Then:
  1. Add `freelens/integration/__tests__/renderer-without-node.tests.ts`. In the window and in a cluster frame of a kind cluster, `typeof require`, `typeof process` and `typeof Buffer` evaluate to `"undefined"`, and `window.freelensViewBridge` has no member but `ipcRenderer` and `getPathForFile` (SC-002).
  2. Run `pnpm build:app:dir && pnpm test:integration`; every test passes (SC-003).
  3. Run quickstart.md "User Story 3" and the "User Story 1" table, with Node off, on the branch and on `main`.
  4. Write the Playwright script of research R15 to `$TMPDIR/003-sc005/cluster-frame.mjs`, reusing `freelens/integration/helpers`. Run quickstart.md "SC-005" on packaged builds of both, keeping the figures in `$TMPDIR/003-sc005/` for the pull request.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 gates everything. If it fails, nothing else starts.
- **Foundational (Phase 2)**: after T001. T003 → T004; T005 → T006 → T007 and
  T008; T009 alone. Blocks every story.
- **User Story 2 (Phase 3)**: after Phase 2.
- **User Story 1 (Phase 4)**: after Phase 2. It uses three US2 results: the
  path port of T039 in T062, and T027 and T040 before T068, which moves
  `fs.injectable.ts` once nothing in the renderer imports it. It may run beside
  Phase 3, with T062 waiting for T039 and T068 for T027 and T040.
- **User Story 3 (Phase 5)**: after Phases 3 and 4. It needs an empty legacy
  list and an empty bundle list.
- **Polish (Phase 6)**: after Phase 5.
- **Phase 7 (T075)**: the last task, after everything.

### Within the stories

- T017 → T031; T032 → T033; T036 → T037; T038 → T039.
- T042 → T043, T044 → T045.
- T055 → T056 → T062; T057, T058, T059 → T060.
- T053 → T063: `watch.injectable.ts` moves to main in T063, once both of its
  renderer importers are gone.
- T064 → T065; T027, T040 and T051 to T067 → T068.
- T069, T070, T071 in order.

### Parallel Opportunities

- Phase 2: T003, T005 and T009 together.
- Phase 3: T010 to T029 are independent of each other, as are T034, T035 and
  T040.
- Phase 4: T046 to T052 and T057 together, after T042.
- Phase 6: T072 and T073 together.

---

## Parallel Example: User Story 2

```bash
# The assert-only groups touch disjoint files:
Task: "T010 Replace node:assert in the config stores"
Task: "T011 Replace node:assert in the cluster, network, node and event stores"
Task: "T012 Replace node:assert in the storage and user-management stores"
Task: "T013 Replace node:assert in the workload stores"
Task: "T021 Replace node:assert in kube-api, kube-api-specifics and run-many"
```

## Parallel Example: User Story 1

```bash
# After T042, the small channels touch disjoint features:
Task: "T048 open-link-in-browser"
Task: "T049 reveal-cluster-kubeconfig"
Task: "T050 wait-until-port-free"
Task: "T051 validate-directory and path-exists"
Task: "T052 discover-kubeconfig-sync-kind"
```

---

## Implementation Strategy

### Gate first

1. T001 (the spike). On failure, stop and revise research R3.
2. Phase 2: the gate and the preload, with the app unchanged for its users.

### Smallest first, then the MVP

3. Phase 3 (User Story 2): most of the legacy list leaves with small, safe
   changes.
4. Phase 4 (User Story 1, the MVP of spec.md): every value and action of the
   machine comes from main. **Stop and validate** with quickstart.md "User Story
   1" against `main`, with Node integration still on.

### Last

5. Phase 5 and Phase 6.
6. T075 turns Node integration off and runs every check with Node gone.

Each task leaves the Electron build green, so the work can stop at any task and
still ship.

---

## Notes

- A task that cannot free a file because of a use the inventory missed adds
  that use to `contracts/legacy-inventory.md` and stops, rather than putting a
  file back on a list.
- Commit after each task or group, staging only the files the task touched
  (AGENTS.md).
