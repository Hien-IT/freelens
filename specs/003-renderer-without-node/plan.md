# Implementation Plan: Renderer Without Node

**Branch**: `spec/tauri-port` | **Date**: 2026-11-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/003-renderer-without-node/spec.md`

## Summary

The renderer of the Electron build stops using Node, file by file through the
renderer legacy list, as the user input asks
([contracts/legacy-inventory.md](./contracts/legacy-inventory.md)):

- **Pure computations** use what a browser page and Node both have (research
  R8): `node:assert`, about half the list, gives way to one typed `assert`.
- **Values of the machine** come from main in one `machine-values` request
  before the frame starts, like the app paths, so every synchronous reader and
  public getter stays synchronous (R4).
- **The stores** get their contents from main in the same way and keep saving
  over their existing channels (R5).
- **Each file-system or process action** becomes a request channel answered in
  main, shaped by its task, as AGENTS.md's "Values computed in main" asks (R6,
  [contracts/channels.md](./contracts/channels.md)).
- **Paths** use a Node-free port of Node's posix and win32 rules, chosen by
  main's platform (R7).
- **The logger** gets a Node-free renderer implementation (R9).

The legacy list does not hold all of the renderer's Node. The bundle also pulls
it in through `@kubernetes/client-node`, `conf`, `tar`, `fs-extra`, `winston`,
`chokidar`, `tcp-port-used` and through workspace packages outside the type
check (R2). A gate in the renderer build therefore tracks every builtin and
`electron` import on a list that only shrinks, and ends by refusing them all
([contracts/bundle-gate.md](./contracts/bundle-gate.md)).

With Node gone, the views reach main through a sandboxed preload that loads
into every frame and hands the page Electron's IPC object
([contracts/preload-bridge.md](./contracts/preload-bridge.md)). Electron loads a
preload into subframes only while `nodeIntegrationInSubFrames` is on, so that
setting stays on while `nodeIntegration` goes off. This was decided with the
user against the input's wording, and a spike proves it first (R3, spec
Clarifications). Turning Node integration off is the last task. The extension
API does not change: its namespaces, types, synchronous members, results and
failures stay, and the folders an extension passes are read and written as
today (R10, FR-007, FR-014).

## Technical Context

**Language/Version**: TypeScript 7.0.2 (renderer, main and the preload).
Electron 44.10.1, electron-vite 6.0.0, Vite 8.3.8, Rolldown 1.2.19.

**Primary Dependencies**: existing ones only:

- `@freelensapp/messaging` and its `messaging-for-main` and
  `messaging-for-renderer`;
- `@freelensapp/application`, `@ogre-tools/injectable`, `mobx`;
- `@freelensapp/event-emitter`, `@freelensapp/utilities`;
- in main only: `conf`, `chokidar`, `tar`, `fs-extra`, `proper-lockfile`,
  `tcp-port-used`, `@kubernetes/client-node`, `winston`.

No new npm package. The path functions are a port of Node's `lib/path.js` that
keeps its upstream notice (R7).

**Storage**: the existing files: the stores, `lens-local-storage`,
kubeconfigs, extensions. Formats unchanged ([data-model.md](./data-model.md)).

**Testing**:

- **Vitest**, under FR-019's rule for moved code. New channels are tested on both
  sides against `messaging-fake-bridge`. The path port is tested against
  `node:path`'s posix and win32, the renderer logger against today's output,
  and the gate's walk on a small module graph.
- **The integration tests**, with Node off, plus a new SC-002 check.
- **The spike of R3**, and the running-application checks of
  [quickstart.md](./quickstart.md), each repeated on `main` as the control.

**Target Platform**: the Electron build on macOS, Windows and Linux. The
Tauri build changes only by the rows added to spec 002's channel list.

**Project Type**: desktop application; changes inside existing packages, plus a
preload entry in `freelens/`.

**Performance Goals**: SC-005. The window's startup and the opening of a cluster
frame are at most 10% slower than `main`, median of three runs on the same
machine; for the cluster frame, the build measured against `main` is one with
the sandbox off, as the sandbox's own cost is accepted (FR-012). The startup requests (`app-paths`, `machine-values`, the store
snapshot) go in parallel (R4, R5); the read of the window's local storage
follows them, as `initialize-state` does today.

**Constraints**:

- Extension API v2 unchanged (FR-014).
- No channel offers the file system or processes in general, or carries
  kubeconfig credentials to a view (FR-007; FR-012 of spec 002).
- Context isolation stays off.
- The legacy lists and the Biome exemption only shrink.
- The Electron build keeps building and passing its tests after every task
  (Principle VII).

**Scale/Scope**:

- every file of the renderer legacy list;
- the `electron` imports and workspace packages of the renderer bundle;
- the npm packages that bring Node into it;
- the new channels of `contracts/channels.md`.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| VII. Tauri build             | **Targets the Electron build.** The Tauri build gains only rows in `specs/002-messaging-for-tauri/contracts/channel-list.md`, which the core will answer in the specs of their owners (R14). **The Electron build keeps building and passing**: its build, type check and unit tests after each task, and its integration tests and `knip:check` after each phase; the last task makes the integration tests run with Node off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass                 |
| VIII. Rust core              | No Rust code changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass                 |
| II. Environments             | **The feature is this principle**: every renderer and common file leaves the renderer legacy list, and every exemption the Biome override, together (FR-010). **Files that split by process** go under `main/` and `renderer/`, beside a `common/` token. **New channels** are defined in `common/` and answered in `main/`. **The values the renderer shows** about main come from main over request channels (R4, R6). **The bundle gate** extends the check to code the type check cannot see (R2). **The `rendererBundle` list is not a list of new exceptions**: T004 seeds it once from the modules that bring Node into the bundle on the commit the work starts from, as the two lists were seeded when the type check was introduced; nothing is added to it afterwards, and it ends empty and removed (T071). **The preload's environment** is neither main nor renderer, and its path has no context segment. These three are recorded in Complexity Tracking: the preload, `freelens/build-plugins/`, and the seeding of `rendererBundle`.                                                                    | Deviation, see below |
| I. Dependency injection      | **New injectables**: the `machine-values` state and runnable, renderer and main implementations of split tokens, the channel listeners and requesters, the renderer logger. **Moved injectables**: common ones that main alone uses go to `main/`. `pnpm build:di` regenerates the registrations after each move; they are never edited by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass                 |
| III. Extension API           | **Checked against C1 to C15**, C3, C4, C5, C6 and C14 in particular (R10). **No member is added or removed**: `assert` joins the list of `@freelensapp/utilities` members kept out of `Util`, and the members that leave that barrel were already kept out. **Synchronous members stay synchronous**: `Common.App.is*`, `ExtensionStore.loadExtension`/`cwd`, `Renderer.Ipc`'s constructor. **`ExtensionStore` keeps every `conf` option** in the renderer, encryption included, through a `Conf`-compatible class tested against `conf` itself (R5). **Assertion failures** keep `AssertionError` and `ERR_ASSERTION`. **Folders an extension passes** (`FilePicker`'s upload, `createResourceStack`, `ExtensionStore`'s `cwd`) are read and written as today, so no failure changes and no breaking change needs a major release. **The documents** change where they describe what changes: C4's paragraph on `require`, and "Node and Electron in the renderer" in the migration guide; the section names the plugin skills cite stay. **mobx, React and monaco stay single instances**, and no class is re-exported. | Pass                 |
| IV. Styling                  | No stylesheet or `className` changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass                 |
| V. Verified changes          | **Tests**: unit tests for each channel on both sides, the path port, `assert`, the query `stringify`, `base64`, the terminal URL, the logger, the store snapshot and the gate. **Checks**: `pnpm type:check`, `pnpm test:unit`, `pnpm biome check`, `trunk check`, `pnpm knip:check` after `pnpm build`, and `pnpm test:integration` with Node off. **In the running application** (quickstart.md), on the branch and on `main`: the empty value, the missing file, and a change while the view is open (an empty path in the settings; a Deployment scaled in the cluster while its details and edit dock are open; a namespace deleted while its list is open; a template added while the dock is open). **Views that edit data** keep their unsaved edits when a store sends a new model, as today, since the sync path does not change. **Comparators**: the feature changes no comparator or sort key; the path port is not used to sort.                                                                                                                                                                            | Pass                 |
| VI. Secrets and supply chain | **No binary or pin is touched.** **No kubeconfig credential reaches a view**: the kubeconfig channels answer with names, namespaces and errors (contracts/channels.md, rule 4). The spike and the checks use a kind cluster with a kubeconfig in `$TMPDIR`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass                 |
| Conventions                  | **Headers**: new files get the single-line header; moved and split files keep theirs; the path port keeps Node's upstream notice as vendored code. **No JSON gets comments**: `rendererBundle` goes in `legacy.jsonc`. **Scratch output** goes to `$TMPDIR`. **Documents**: AGENTS.md's "Runtime Environments in Type-Checking" gains the `rendererBundle` list and loses the node-integrated renderer once the work is done; `docs/extensions/api.md` and the migration guide change as above, with no issue numbers or history.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass                 |

Re-check after Phase 1 design: unchanged.

- The contracts add no general file-system or process channel, and no
  credential reaches a view.
- No Node use is left in a view, and no extension surface is added.
- The three deviations below stand, all of Principle II.

## Project Structure

### Documentation (this feature)

```text
specs/003-renderer-without-node/
├── spec.md
├── plan.md                     # this file
├── research.md                 # Phase 0
├── data-model.md               # Phase 1
├── quickstart.md               # Phase 1
├── contracts/                  # Phase 1
│   ├── legacy-inventory.md     # every Node use and its disposition
│   ├── channels.md             # the channels this feature adds
│   ├── preload-bridge.md       # the preload and window.freelensViewBridge
│   └── bundle-gate.md          # the renderer build gate
├── checklists/
│   └── requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
freelens/
├── src/preload/index.ts                 # new: the sandboxed preload (preload-bridge.md)
├── build-plugins/renderer-bundle-gate.ts (+ .test.ts)   # new: the gate's walk (bundle-gate.md); joins the include of tsconfig.typecheck.json
└── electron.vite.config.ts              # + preload section; the gate in runtimeRequireExternalsPlugin

scripts/type-check-environments/legacy.jsonc   # + rendererBundle (temporary); renderer list shrinks to empty
biome.jsonc                                    # the noNodejsModules exemption override shrinks, then goes

packages/technical-features/messaging/messaging-for-renderer/src/ipc/ipc-renderer.injectable.ts  # reads the bridge

packages/utility-features/
├── utilities/src/common/assert.ts       # new (R8); tar.ts and union-env-path.ts leave the barrel
├── utilities/src/{base64.ts,type-narrowing.ts}
├── json-api/src/json-api.ts             # local stringify
├── kube-api/src/kube-api.ts, kube-api-specifics/src/specifics/*.ts   # assert
└── run-many/src/{helpers.ts,run-many-for.ts}

packages/logger/
├── package.json                         # + exports: ".", "./main", "./renderer" (R9)
└── src/{common,main,renderer}/          # tokens and prefixed logger; winston and loggerFeatureForMain; the Node-free logger and loggerFeatureForRenderer

packages/core/src/
├── features/machine-values/{common,main,renderer}/        # new (R4)
├── features/persistent-storage/{common,main,renderer}/    # snapshot channel; create.injectable splits (R5)
├── features/local-storage/{common,main}/                  # new (R5)
├── features/user-resource-templates/{common,main}/        # new (R6)
├── features/validate-directory/, kubeconfig-sync-kind/, add-cluster/, port-forward/, open-link-in-browser/   # new channels (R6)
├── features/cluster/{delete-dialog,reveal-kubeconfig}/main/   # kubeconfig channels (R6)
├── features/extensions/{installer,file-folder,file-picker,resource-stack}/main/   # extension channels (R6)
├── common/{fs,os,path,vars,utils,certificate,cluster,kube-helpers,k8s}/   # split by process or moved to main/ (inventory)
├── extensions/{extension-discovery,extension-loader,ipc,stores,lens-extension.ts,base-extension-store.ts,common-api/utils.ts}   # stores: extension-store:read and :write (R5)
├── renderer/…                           # each file of the inventory
└── main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts   # last task

docs/extensions/{api.md,migrating-from-v1.md}, AGENTS.md   # as in the Constitution Check
specs/002-messaging-for-tauri/contracts/channel-list.md    # a row per new channel
```

**Structure Decision**:

- New channels live in feature directories under `packages/core/src/features/`,
  split by process, as Principle I asks.
- Existing common injectables split in place, or move to `main/`, so that their
  callers keep their imports where they can.
- The preload is a new entry of the `freelens` package, beside `src/main` and
  `src/renderer`.
- `freelens/build-plugins/` is build tooling, like `electron.vite.config.ts`
  that uses it, not application code. It joins the combined type-check program
  only so that its types are checked (Complexity Tracking).
- The extension stores' channels live under `packages/core/src/extensions/`,
  whose IPC spec 002 and FR-013 exempt, because one of them is synchronous
  Electron IPC.

### Implementation order

Research R12, as tasks.md orders it: risk first, then file by file and
smallest first:

1. **The spike** (R3, T001). If it fails, stop and revise R3.
2. **The gate in list mode** (T003, T004), with the `rendererBundle` list seeded
   once from the current build.
3. **The preload and the bridge**, with Node integration still on, and
   `assert` (T005 to T009).
4. **User Story 2** (T010 to T041):
   - the `assert`-only files and workspace packages;
   - Node's types, the frame role and the build-time values;
   - the terminal URL and the pod menus;
   - the renderer logger and the path port;
   - the files only main uses, and the IPC hash.
5. **User Story 1** (T042 to T068):
   - `machine-values` and the injectables that read it;
   - the one-task channels and the templates;
   - store snapshots and local storage;
   - the kubeconfig channels;
   - the extension system;
   - the last `fs` injectables move to main.
6. **User Story 3** (T069 to T071): the `require` warning goes, the lists are
   empty, and the gate refuses all Node.
7. **Documents and checks** (T072 to T074).
8. **Last** (T075): the window gets `nodeIntegration: false` with the sandbox;
   the SC-002 integration test, the integration tests, the quickstart and the
   SC-005 measurement run with Node off.

Every step leaves the Electron build passing, and removes from the legacy list
and the Biome exemption each file it frees.

## Complexity Tracking

| Violation                                                                                                                                                                                         | Why Needed                                                                                                                                                                                                                                                                                   | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principle II**: the preload, `freelens/src/preload/index.ts`, has no context segment and is checked by the combined program only (`tsconfig.typecheck.json`), not by either environment program | A sandboxed preload is a third environment: Electron's `ipcRenderer` and `webUtils` and the page's `window`, with no Node builtins. Neither environment program models it, and AGENTS.md allows a file no program classifies to be checked by the combined one.                              | Under `renderer/`, the preload would be the one renderer file that imports `electron`, which the bundle gate exists to refuse, and Electron's types reference Node's, which the renderer program absorbs [inferred]. Under `main/`, the main program has no DOM. A fourth environment program for one file of a few lines costs more than it checks. |
| **Principle II**: `freelens/build-plugins/renderer-bundle-gate.ts` is new TypeScript with no context segment                                                                                      | It is build tooling that `freelens/electron.vite.config.ts` imports, not application code: it runs in the build's Node, never in main or a view. It joins the combined program so that its types are checked.                                                                                | A context directory would classify it as main, renderer or common code, which it is not, and put it in an environment program whose rules do not fit a build script. Leaving it unchecked, as the config itself is, would leave the gate's walk without a type check.                                                                                |
| **Principle II**: the `rendererBundle` list is added to `scripts/type-check-environments/legacy.jsonc`, a file whose lists may only shrink                                                        | The type check cannot see the Node that npm and workspace packages bring into the renderer bundle (research R2), so the gate needs a record of today's uses to shrink from. T004 seeds it once from the commit the work starts from; nothing is added afterwards, and T071 removes it empty. | Failing the build on every Node import at once would break the build until the last task. A separate file would duplicate the list mechanics and the rule that lists only shrink.                                                                                                                                                                    |
