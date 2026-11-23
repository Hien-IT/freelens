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
API keeps its namespaces, types and synchronous members. It changes in one
place, decided with the user: an extension folder outside the extension's own
directories now fails (R10, FR-007).

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
machine. The startup requests (`app-paths`, `machine-values`, the store
snapshot) go in parallel (R4, R5).

**Constraints**:

- Extension API v2 unchanged except the folder rule (FR-014).
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

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Status               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| VII. Tauri build             | **Targets the Electron build.** The Tauri build gains only rows in `specs/002-messaging-for-tauri/contracts/channel-list.md`, which the core will answer in the specs of their owners (R14). **The Electron build keeps building and passing** its unit tests, integration tests, type check and `knip:check` after each task; the last task makes the integration tests run with Node off.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass                 |
| VIII. Rust core              | No Rust code changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass                 |
| II. Environments             | **The feature is this principle**: every renderer and common file leaves the renderer legacy list, and every exemption the Biome override, together (FR-010). **Files that split by process** go under `main/` and `renderer/`, beside a `common/` token. **New channels** are defined in `common/` and answered in `main/`. **The values the renderer shows** about main come from main over request channels (R4, R6). **The bundle gate** extends the check to code the type check cannot see (R2). **The preload's environment** is neither main nor renderer, and its path has no context segment (Complexity Tracking).                                                                                                                                                                                                                                                                               | Deviation, see below |
| I. Dependency injection      | **New injectables**: the `machine-values` state and runnable, renderer and main implementations of split tokens, the channel listeners and requesters, the renderer logger. **Moved injectables**: common ones that main alone uses go to `main/`. `pnpm build:di` regenerates the registrations after each move; they are never edited by hand.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass                 |
| III. Extension API           | **Checked against C1 to C15**, C3, C4, C5, C6 and C14 in particular (R10). **No member is added or removed**: `assert` joins the list of `@freelensapp/utilities` members kept out of `Util`, and the members that leave that barrel were already kept out. **Synchronous members stay synchronous**: `Common.App.is*`, `ExtensionStore.loadExtension`/`cwd`, `Renderer.Ipc`'s constructor. **Assertion failures** keep `AssertionError` and `ERR_ASSERTION`. **The folder rule** changes how `FilePicker`'s upload and `createResourceStack` fail for a folder outside the extension's directories. **The documents** change where they describe what changes: C4's paragraph on `require`, "Node and Electron in the renderer" in the migration guide, and the folder rule; the section names the plugin skills cite stay. **mobx, React and monaco stay single instances**, and no class is re-exported. | Deviation, see below |
| IV. Styling                  | No stylesheet or `className` changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass                 |
| V. Verified changes          | **Tests**: unit tests for each channel on both sides, the path port, `assert`, the query `stringify`, `base64`, the terminal URL, the logger, the store snapshot and the gate. **Checks**: `pnpm type:check`, `pnpm test:unit`, `pnpm biome check`, `trunk check`, `pnpm knip:check` after `pnpm build`, and `pnpm test:integration` with Node off. **In the running application** (quickstart.md), on the branch and on `main`: the empty value, the missing file, and a change while the view is open (a template added while the dock is open; a store changed in main while a view is open). **Views that edit data** keep their unsaved edits when a store sends a new model, as today, since the sync path does not change.                                                                                                                                                                           | Pass                 |
| VI. Secrets and supply chain | **No binary or pin is touched.** **No kubeconfig credential reaches a view**: the kubeconfig channels answer with names, namespaces and errors (contracts/channels.md, rule 4). The spike and the checks use a kind cluster with a kubeconfig in `$TMPDIR`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass                 |
| Conventions                  | **Headers**: new files get the single-line header; moved and split files keep theirs; the path port keeps Node's upstream notice as vendored code. **No JSON gets comments**: `rendererBundle` goes in `legacy.jsonc`. **Scratch output** goes to `$TMPDIR`. **Documents**: AGENTS.md's "Runtime Environments in Type-Checking" gains the `rendererBundle` list and loses the node-integrated renderer once the work is done; `docs/extensions/api.md` and the migration guide change as above, with no issue numbers or history.                                                                                                                                                                                                                                                                                                                                                                           | Pass                 |

Re-check after Phase 1 design: unchanged.

- The contracts add no general file-system or process channel, and no
  credential reaches a view.
- No Node use is left in a view, and no extension surface is added.
- The two deviations below stand.

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
├── utilities/src/assert.ts              # new (R8); tar.ts and union-env-path.ts leave the barrel
├── utilities/src/{base64.ts,type-narrowing.ts}
├── json-api/src/json-api.ts             # local stringify
├── kube-api/src/kube-api.ts, kube-api-specifics/src/specifics/*.ts   # assert
└── run-many/src/{helpers.ts,run-many-for.ts}

packages/logger/src/                     # the winston logger becomes main's; a renderer implementation joins it (R9)

packages/core/src/
├── features/machine-values/{common,main,renderer}/        # new (R4)
├── features/persistent-storage/{common,main,renderer}/    # snapshot channel; create.injectable splits (R5)
├── features/local-storage/{common,main}/                  # new (R5)
├── features/user-resource-templates/{common,main}/        # new (R6)
├── features/validate-directory/, kubeconfig-sync-kind/, add-cluster/, port-forward/, open-link-in-browser/   # new channels (R6)
├── features/cluster/{delete-dialog,reveal-kubeconfig}/main/   # kubeconfig channels (R6)
├── features/extensions/{installer,file-folder,stores,file-picker,resource-stack}/main/   # extension channels (R6)
├── common/{fs,os,path,vars,utils,certificate,cluster,kube-helpers}/   # split by process or moved to main/ (inventory)
├── extensions/{extension-discovery,extension-loader,ipc,base-extension-store.ts,common-api/utils.ts}
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

### Implementation order

Research R12, risk first, then file by file and smallest first:

1. **The spike** (R3). If it fails, stop and revise R3.
2. **The gate in list mode**, with the `rendererBundle` list filled from the
   current build.
3. **The preload and the bridge**, with Node integration still on.
4. **`assert`**, then the other S files and workspace packages.
5. **`machine-values`, the frame role, the build-time values.**
6. **The renderer logger.**
7. **Store snapshots and local storage.**
8. **The channels of R6, one feature at a time**, each with its row in spec
   002's channel list.
9. **Extension install, uninstall, file folder, stores**; IPC hash
   precomputed; `require` warning removed.
10. **M and D moves** of the common injectables main alone uses; the
    kubeconfig helpers leave the renderer graph.
11. **Last**:
    - the gate refuses all Node, and the `rendererBundle` list goes;
    - the window gets `nodeIntegration: false` with the sandbox;
    - the SC-002 integration test;
    - AGENTS.md and the extension documents;
    - the SC-005 measurement.

Every step leaves the Electron build passing, and removes from the legacy list
and the Biome exemption each file it frees.

## Complexity Tracking

| Violation                                                                                                                                                                                         | Why Needed                                                                                                                                                                                                                                                      | Simpler Alternative Rejected Because                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Principle II**: the preload, `freelens/src/preload/index.ts`, has no context segment and is checked by the combined program only (`tsconfig.typecheck.json`), not by either environment program | A sandboxed preload is a third environment: Electron's `ipcRenderer` and `webUtils` and the page's `window`, with no Node builtins. Neither environment program models it, and AGENTS.md allows a file no program classifies to be checked by the combined one. | Under `renderer/`, the preload would be the one renderer file that imports `electron`, which the bundle gate exists to refuse, and Electron's types reference Node's, which the renderer program absorbs [inferred]. Under `main/`, the main program has no DOM. A fourth environment program for one file of a few lines costs more than it checks. |
| **Principle III**: `FilePicker`'s upload and `createResourceStack` now fail for a folder outside the extension's install or data directory                                                        | FR-007, clarified with the user: no channel reads or writes file contents at a path a view sends, other than one the user chose. These two calls take the folder from the extension, so main checks it against the directories it computes.                     | Exempting the two calls from FR-007 keeps the API unchanged, but leaves two channels through which any view can write or read files anywhere. The user chose the restriction.                                                                                                                                                                        |
