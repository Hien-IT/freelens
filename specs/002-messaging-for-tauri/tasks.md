---
description: "Task list for messaging in the Tauri build"
---

# Tasks: Messaging for the Tauri Build

**Input**: Design documents from `specs/002-messaging-for-tauri/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: required. FR-020 asks for unit tests of the view side against a
stand-in for the core, Principle V asks for tests with every behaviour change,
and Principle VIII for cargo tests of Rust code. Existing test files change
only as FR-019 allows (research R12).

**Existing code**: every task that edits a file that exists today says why,
after "Why:". Moves in the Electron build keep its behaviour (FR-015).

**Organization**: tasks are grouped by user story, so that each story can be
built and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an
  unfinished task)
- **[Story]**: the user story of spec.md the task belongs to (US1, US2, US3)

## Path Conventions

- View side: `packages/technical-features/messaging/messaging-for-tauri/`
  (below, `mft/`)
- Rust core: `freelens-tauri/src-tauri/` (`src/`, `tests/`)
- Check pages: `freelens-tauri/ui/src/renderer/`
- Electron moves: paths relative to `packages/core/src/` unless they start
  with `packages/`, `freelens/` or `freelens-tauri/`

New TypeScript and JavaScript files get the single-line Freelens header; a
moved file keeps its header; Rust files carry the header in a `/* … */` block
(plan.md, Conventions). Run `pnpm build:di` after any task that adds, moves or
deletes an `*.injectable.ts` file (Principle I).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: record the state the checks compare against.

- [ ] T001 Record the baseline of FR-019 and SC-001 on the current commit: run `pnpm test:unit` and save its summary (test files and tests per project) to `$TMPDIR/002-baseline/tests.txt`; save the output of both searches of quickstart.md "User Story 2" to `$TMPDIR/002-baseline/searches.txt`. Nothing is written in the repository.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: none. The three stories share no code: User Story 1 adds the
Tauri side, User Story 2 changes the Electron build only, and User Story 3 is
a document. Each story's prerequisites are in its own phase.

**Checkpoint**: user stories can start.

---

## Phase 3: User Story 1 - Views reach the core over the existing channels (Priority: P1) 🎯 MVP

**Goal**: the view-side implementation of the four messaging tokens for the
Tauri build, the core's `/ipc/` routes, queues and typed registration layer,
and the `--messaging-check` run from the main window and a cluster frame.

**Independent Test**: `pnpm --filter @freelensapp/messaging-for-tauri test:unit`
and the cargo checks pass, and the check run of quickstart.md prints 40
`passed` lines and no failure (SC-003).

### View side: package and wire format

- [ ] T002 [US1] Create the package `mft/` as a sibling of `messaging-for-renderer`: `mft/package.json` (name `@freelensapp/messaging-for-tauri`, private, description "Implementations for 'messaging' in the views of the Tauri build", `main` and `types` `./index.ts`, the `clean:dist` and `test:unit` scripts of `messaging-for-renderer/package.json` with the project name changed, dependencies `@freelensapp/application`, `@freelensapp/feature-core`, `@freelensapp/messaging`, `@ogre-tools/injectable`, dev dependencies as `messaging-for-renderer` minus `electron`), `mft/tsconfig.json` copied from `messaging-for-renderer/tsconfig.json`, `mft/index.ts` exporting `messagingFeatureForTauri`, and `mft/src/feature.ts` defining it with `dependencies: [messagingFeature]` (research R1). Add `"@freelensapp/messaging-for-tauri": ["./packages/technical-features/messaging/messaging-for-tauri/index.ts"]` to `paths` of `tsconfig.typecheck.json` (Why: the alias every package resolves through) and run `pnpm install`.
- [ ] T003 [P] [US1] Add `packages/technical-features/messaging/messaging-for-tauri/index.ts` and `packages/technical-features/messaging/messaging-for-tauri/src/**/*` to the `include` of `tsconfig.renderer.json`, and check that its `exclude` already keeps `*.test.ts` and `test-utils/` out (research R10, Principle II). Why: the package has no context segment in its path, so the renderer program only checks it when listed.
- [ ] T004 [P] [US1] Write `mft/src/wire.test.ts` for `wire.ts`: encoding `undefined` gives `{}` and any other value `{ payload }` (data-model.md `Envelope`); decoding is the inverse, `null` included; every value research R4 rejects throws a `TypeError` whose message names the channel id (data-model.md `Channel.values`), with one case per kind of value; a class instance, an observable MobX object and array, and an object property set to `undefined` pass.
- [ ] T005 [US1] Implement `mft/src/wire.ts`: `toEnvelope(channelId, value)`, which walks the value and throws as T004 expects before building the envelope, and `fromEnvelope(envelope)` (data-model.md `Envelope`, `Channel.values`; research R4). Make T004 pass.

### View side: fake core for the tests

- [ ] T006 [US1] Implement `mft/src/test-utils/get-core-fake.ts` in the shape of `messaging-fake-bridge` (research R10): `getCoreFake()` returns `involve(di, host)` for a main window (`renderer.freelens.app`) or a cluster frame (`<clusterId>.renderer.freelens.app`) (data-model.md `View.host`), `answer(channelId, handler)`, `listen(channelId, handler)`, `send(channelId, message)` and `messagePropagation()`. It overrides `postToCore` of each involved container with a function that applies the checks and answers of contracts/ipc-routes.md: the sender is the view of the involving host (data-model.md `View.View`); a request whose `Origin` names another host gets `403`; queues follow data-model.md `Queue.session`, `Queue.next seq`, `Queue.messages`, `Queue.pending poll`, with the 25-second hold driven by Vitest's fake timers.

### View side: the tokens

- [ ] T007 [US1] Implement `mft/src/post-to-core.injectable.ts`, the only code that calls `fetch` (research R10): `POST` to a relative `/ipc/…` URL with `Content-Type: application/json` and a JSON body, resolving with the status and the parsed body; `causesSideEffects: true`.
- [ ] T008 [P] [US1] Write `mft/src/message-to-channel.test.ts` against the fake core: a message reaches the core's listener once, with the sending view; messages sent while a batch is in flight go in the next batch, in sending order (data-model.md `Message batch`); a batch the core refuses is logged with its channel ids and not sent again; a message on a channel with no listener raises nothing in the sender (FR-007); a value R4 rejects throws before anything is sent.
- [ ] T009 [US1] Implement `mft/src/message-batches.injectable.ts` (one batch in flight per view, the states of data-model.md `Message batch`, `POST /ipc/messages`, a refused batch logged with `console.error`) and `mft/src/message-to-channel.injectable.ts` for `sendMessageToChannelInjectionToken` (research R5). Make T008 pass.
- [ ] T010 [P] [US1] Write `mft/src/request-from-channel.test.ts` against the fake core: the answer resolves, `undefined` for no `payload`; each status of contracts/ipc-routes.md "`POST /ipc/request`" rejects with exactly the message of its row (`No handler registered for '<id>'`, the handler's error, the parse error, other statuses, a failed `fetch`); a request sent after a message waits until that message's batch is accepted (research R5); concurrent requests do not wait for each other; a cluster frame's request reaches the core as that cluster.
- [ ] T011 [US1] Implement `mft/src/request-from-channel.injectable.ts` for `requestFromChannelInjectionToken`: wait for the batch in flight, `POST /ipc/request` with `{ channel, …envelope }`, and map statuses to the resolutions and rejections of contracts/ipc-routes.md (research R6). Make T010 pass.
- [ ] T012 [P] [US1] Write `mft/src/enlist-message-channel-listener.test.ts` against the fake core: the first enlisted listener starts polling with a random `session` matching `[A-Za-z0-9-]{1,64}` and `after: 0` (data-model.md `Queue.session`); messages reach the listeners of their channel in sequence order, each once, and an already handled sequence number is ignored; a poll answered empty after 25 seconds is followed by another at once; a failed poll is retried after 100 ms, doubling to 2 s, with the same `session` and `after`; three views involved at once each receive a message the core sends once (FR-004); a disposed listener receives nothing more.
- [ ] T013 [US1] Implement `mft/src/polling.injectable.ts` (the poll loop of research R3 and contracts/ipc-routes.md "`POST /ipc/poll`") and `mft/src/enlist-message-channel-listener.injectable.ts` for `enlistMessageChannelListenerInjectionToken`, which starts the loop on its first listener. Make T012 pass.
- [ ] T014 [P] [US1] Implement `mft/src/enlist-request-channel-listener.injectable.ts`, which throws as `messaging-for-renderer`'s does, and `mft/src/allow-communication.injectable.ts`, which sends `frame-communication-admin-channel` on load of the application as `messaging-for-renderer/src/allow-communication-to-iframe.injectable.ts` does; with `mft/src/allow-communication.test.ts` checking that the core receives the message from the loading view.
- [ ] T015 [US1] Run `pnpm build:di` to generate `mft/src/register-injectables.ts`, then `pnpm --filter @freelensapp/messaging-for-tauri test:unit` and `pnpm type:check`.

### Core: the messaging module

- [ ] T016 [US1] Create `freelens-tauri/src-tauri/src/messaging/mod.rs` with `View`, `RequestChannel`, `MessageChannel`, `ChannelError`, `Channels`, `DuplicateChannel` and `Messaging` as contracts/core-channels.md specifies (data-model.md `Channel.id`, `Channel.kind`, `View.View`), plus a crate-private `send_raw(channel_id, envelope)` for the relay; unit tests in the module for a second `answer` on one id, several `listen` on one id, `()` answered with no `payload` and `None` as `null`. Add `pub mod messaging;` to `src/lib.rs` (Why: the module joins the crate).
- [ ] T017 [US1] Create `freelens-tauri/src-tauri/src/messaging/queues.rs`: one queue per view host with the fields and states of data-model.md `Queue.host`, `Queue.session`, `Queue.next seq`, `Queue.messages`, `Queue.pending poll`, `Queue.last poll`; a poll held up to 25 seconds; closure after 60 seconds without a poll or above 10 000 messages, logged as contracts/check-log.md says; unit tests with tokio's paused clock for each row of the table in contracts/ipc-routes.md "`POST /ipc/poll`".
- [ ] T018 [US1] Create `freelens-tauri/src-tauri/src/messaging/routes.rs`: the checks of contracts/ipc-routes.md in their order, then `POST /ipc/request`, `POST /ipc/messages` and `POST /ipc/poll`, with the sender taken from the host (data-model.md `View.host`, `View.View`; research R7) and envelopes as data-model.md `Envelope`; a message that does not parse is dropped with the log line of contracts/check-log.md.
- [ ] T019 [US1] Route `/ipc/` from `freelens-tauri/src-tauri/src/scheme.rs` to `messaging::routes` and add the `Messaging` handle to `State`. Why: the spike refuses every method but `GET` and lets a request without `Origin` through, while the `/ipc/` routes need `POST` and a required `Origin` (research R7); every other route keeps its rules.
- [ ] T020 [P] [US1] Create `freelens-tauri/src-tauri/src/messaging/admin.rs`: listen to `frame-communication-admin-channel`, print `Messaging: <view> announced` and count announcements per view (research R7, R9); answer `ipc:broadcast-main` (`{ channel, message }`) by sending the message on that channel to every open queue with `send_raw`, then answering with no value.
- [ ] T021 [P] [US1] Create `freelens-tauri/src-tauri/src/version.rs`: answer `build-version` with the package version of the Tauri context (research R9).
- [ ] T022 [US1] Register the channels at startup in `freelens-tauri/src-tauri/src/lib.rs`: build `Channels`, call the `register` of `messaging::admin` and `version`, print `Channel "<id>" is answered twice` on standard error and exit with status 1 on `DuplicateChannel` (FR-010), and pass `Messaging` into `State`. Why: startup is where the spike builds `State`.
- [ ] T023 [US1] Write `freelens-tauri/src-tauri/tests/messaging.rs`, driving `scheme::handle` with the fixture kubeconfigs of `tests/fixtures/`: each check of contracts/ipc-routes.md answers its status; a cluster host's request cannot reach the main window's queue or be answered as `View::Main`; the request statuses and bodies; a batch handed to listeners in order; the relay reaching two open views; and `no_credentials_in_ipc_answers`, which fails if any answer or polled message contains a certificate, key or token of the fixtures (SC-006). Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`.

### The check run

- [ ] T024 [US1] Add `--messaging-check` to `freelens-tauri/src-tauri/src/options.rs` and its tests (Why: a launch option of contracts/check-log.md), and create `freelens-tauri/src-tauri/src/messaging/check.rs`, registered only with the option: `messaging-check:report`, printing the lines of contracts/check-log.md and judging the "message to core" step from the announcement count of T020 (data-model.md `Check round`), and `messaging-check:echo`, answering `{ text }` with the same text. With the option, `src/lib.rs` opens the main window at `/?messaging-check`.
- [ ] T025 [US1] Add the dependencies of the check to `freelens-tauri/package.json` (`@freelensapp/application`, `@freelensapp/feature-core`, `@freelensapp/messaging`, `@freelensapp/messaging-for-tauri`, `@ogre-tools/injectable`, `@ogre-tools/injectable-extension-for-mobx`, `mobx`; Why: the pages build a DI container, research R9) and run `pnpm install`. Create `freelens-tauri/ui/src/renderer/messaging-check.ts`: a container built as `freelens/src/renderer/index.ts` builds the renderer's (`createContainer`, `permitSideEffects`, `registerMobX`, `registerFeature` of `applicationFeature` and `messagingFeatureForTauri`, then `startApplicationInjectionToken`), and the 20 rounds of data-model.md `Check round` with channels declared by id (research R9), then the three echo sizes; results go to `messaging-check:report`, and a failure to report calls `GET /api/mark?name=messaging-check-failed`.
- [ ] T026 [US1] Run the check from `freelens-tauri/ui/src/renderer/catalog.ts` when the page URL has `messaging-check`, and add the query to the URL of the frame it creates; run it from `freelens-tauri/ui/src/renderer/cluster.ts` when its URL has it. Why: the check reuses the spike's two pages (research R9).
- [ ] T027 [US1] Run the check of quickstart.md "User Story 1" and keep its log in `$TMPDIR`: 40 `passed` lines, `build version 0.1.0` for both views, no `failed` line or `messaging-check-failed` mark (SC-003); then keep the app in the background for two minutes and check that a new round of the cluster frame passes (research R14). A failure in the carrier (POST bodies, held polls, a closed frame, `Origin` on `POST`) stops here and reopens research R2, as the plan's implementation order says.

**Checkpoint**: views of the Tauri build reach the core over the channels;
SC-003 and SC-006 hold.

---

## Phase 4: User Story 2 - No feature code goes around the channels (Priority: P2)

**Goal**: every file of research R11 is on typed channels or, for the
extension system, inside `extensions/`; the searches of SC-001 print nothing.

**Independent Test**: the two searches of quickstart.md "User Story 2" print
nothing; `pnpm test:unit`, `pnpm test:integration` and the running-application
checks pass, with test files changed only as research R12 lists.

Each move below follows "How a file moves" of research R11: the typed channel
keeps the legacy name as its id (data-model.md `Channel.id`), and a legacy
channel with several arguments carries the list of them (data-model.md
`Channel.values`). After each task, run the tests of the files it touched.

### Messaging packages

- [ ] T028 [US2] Add the optional `withSender` of research R11 to `RequestChannelListener` and `GetRequestChannelListenerInjectableInfo` in `packages/technical-features/messaging/messaging/src/features/actual/request/request-channel-listener-injection-token.ts`, with the handler's optional second parameter `sender?: ExtraData`, and pass `{ processId, frameId }` of the invoke event when it is set in `packages/technical-features/messaging/messaging-for-main/src/channel-listeners/enlist-request-channel-listener.injectable.ts`. Why: `cluster:set-frame-id` needs its sender, and existing handlers and their test must see no change. Cover it in a new `packages/technical-features/messaging/messaging-for-main/src/channel-listeners/enlist-request-channel-listener-with-sender.test.ts`.

### Broadcasts

- [ ] T029 [US2] Make `ipc:broadcast-main` a typed request channel (`{ channel, message }` → none) in `common/ipc/` and answer it in a `main/` listener injectable that sends the message to the views; reimplement `common/ipc/broadcast-message.injectable.ts` with the same id, path and `(channel, ...args)` signature on a per-process implementation: main sends with `sendMessageToChannel`, a view requests `ipc:broadcast-main`; one argument is the message, several are their list (data-model.md `Channel.values`). Why: research R11, broadcast row; the tests that fake the injectable stay unchanged (research R12).
- [ ] T030 [US2] Replace the direct `broadcastMessage` imports in `features/hotbar/storage/common/hotbar.ts`, `common/catalog-entities/kubernetes-cluster.ts`, `renderer/components/layout/sidebar-cluster.tsx`, `renderer/components/clusters/search-command.tsx` and `renderer/components/command-palette/command-dialog.tsx` with `broadcastMessageInjectable`, injected or reached through `getDiForExtensionApi()` as the helper reaches DI today. Why: these files hold the legacy helpers outside the extension tree (research R11); `KubernetesCluster` changes only inside.

### Moves by area

- [ ] T031 [US2] Window and history (desktop-integration): typed channels for `window:window-action`, `window:location-changed`, `window:open-app-context-menu`, `history:can-go-back` and `history:can-go-forward`; their listeners leave `main/electron-app/runnables/setup-ipc-main-handlers/setup-ipc-main-handlers.ts`, with `window:open-app-context-menu` finding the window from its sender as research R11 says; `main/ipc/window.ts` sends the history state with `sendMessageToChannel`; `renderer/ipc/index.ts` (`requestWindowAction`, `emitWindowLocationChanged`, `emitOpenAppMenuAsContextMenu`) and `renderer/components/layout/top-bar/start-state-sync.injectable.ts` use the tokens. Why: research R11.
- [ ] T032 [US2] Cluster channels (main-cluster-connection, cluster-frames): `cluster:set-frame-id` as a request listener with `withSender` (T028), which records nothing and still pushes the catalog when it has no sender; `cluster:refresh-accessibility` with `renderer/before-frame-starts/runnables/refresh-accessibility-on-crd-changes.injectable.ts` as its sender; `cluster:list-namespace-forbidden` in `renderer/ipc/register-ipc-listeners.injectable.ts`; `cluster:<clusterId>:connection-update` enlisted per cluster in `renderer/components/cluster-manager/cluster-status.tsx` while it is mounted; `network:offline` and `network:online` sent to main by `renderer/frames/root-frame/init-root-frame.injectable.ts` and listened to in `main/cluster/manager.ts`. Delete the `cluster:states` handler and `requestInitialClusterStates`, which nothing calls. Why: research R11.
- [ ] T033 [P] [US2] Catalog (main-catalog): `catalog:init`, `catalog:items` and `catalog-entity:run` as typed channels; `main/catalog-sync-to-renderer/catalog-sync-to-renderer.injectable.ts` listens to `catalog:init`; `renderer/api/catalog/entity/registry.ts` sends and listens through the tokens. Why: research R11.
- [ ] T034 [P] [US2] Shell tokens (terminal-pty): `cluster:shell-api` (`[clusterId, tabId]`) and `app:standalone-shell-api` (`tabId`) as typed request channels answered by listener injectables built from `main/freelens-proxy/proxy-functions/shell-request-authenticator/shell-request-authenticator.ts`, requested by `renderer/api/request-cluster-shell-token.injectable.ts` and `renderer/api/request-standalone-shell-token.injectable.ts`; adapt `shell-request-authenticator.test.ts` to take the handlers from the listener injectables, keeping every assertion (research R12). Why: research R11.
- [ ] T035 [P] [US2] Tray (desktop-integration): `tray:set-visible` sent by `features/preferences/renderer/preference-items/application/menu-bar/menu-bar.tsx` and listened to by `main/tray/electron-tray/electron-tray.injectable.ts`. Why: research R11.
- [ ] T036 [US2] Navigation and the window's `send` (desktop-integration): `renderer:navigate`, `renderer:navigate-in-cluster`, `reload-page-channel` and `navigate-for-extension` sent with `sendMessageToChannel` from `main/start-main-application/lens-window/navigate.injectable.ts`, `reload-current-application-window.injectable.ts` and `navigate-for-extension.injectable.ts`; a message meant for one cluster frame carries the cluster's id, and its listener (`renderer/navigation/navigation-channel-listener.injectable.ts`, `features/navigation/reload-page/renderer/register-listener.injectable.ts`) ignores the others'; a listener of `renderer:navigate` that exists in cluster frames ignores it there, as `webContents.send` never reached them. Then remove `send` from the window in `create-lens-window.injectable.ts` and `create-electron-window.injectable.ts`. Why: research R11.
- [ ] T037 [P] [US2] Protocol links (desktop-integration): listener injectables for `protocol-handler:internal`, `protocol-handler:extension` and `protocol-handler:invalid` replace the `ipcRenderer.on` calls of `renderer/protocol-handler/lens-protocol-router-renderer/lens-protocol-router-renderer.tsx`, each taking the list of the old arguments; `common/protocol-handler/router.ts` takes its process name from the main and renderer subclasses instead of reading `ipcRenderer`. Why: research R11.
- [ ] T038 [US2] Command palette and the legacy listen: `renderer/ipc/legacy-channel-listen.injectable.ts` keeps its id and enlists a message channel listener through `enlistMessageChannelListenerInjectionToken`; `renderer/components/command-palette/command-container.tsx` types `legacyOnChannelListen` from that injectable; `hotbar:too-many-items` moves to a listener injectable in `renderer/ipc/register-ipc-listeners.injectable.ts`. The command palette's per-cluster name keeps its current behaviour (contracts/channel-list.md note). Why: research R11; `cluster-frame.test.tsx` stays unchanged.
- [ ] T039 [US2] Bundled extensions: `extension-loader:bundled-extensions-loaded` sent by `renderer/frames/root-frame/init-root-frame.injectable.ts` with `sendMessageToChannel` and awaited once by a listener in `main/start-main-application/lens-window/application-window/wait-until-bundled-extensions-are-loaded.injectable.ts`. Why: these files are outside the exempt tree (FR-014).
- [ ] T040 [P] [US2] Confirm with a search that nothing injects `show-licenses-window.injectable.ts`, then delete `features/application-menu/main/menu-items/help/open-licenses/show-licenses-window.injectable.ts`; reword the comment that names `ipcMain` in `main/logger/file-transport.injectable.ts`. Why: research R11 (dead code; a comment the search would find).

### The legacy helpers move into the extension tree

- [ ] T041 [US2] Once T029 to T040 are done, split `common/ipc/ipc.ts` by process into the extension tree: `extensions/ipc/main/legacy-ipc.ts` (`ipcMainHandle`, `ipcMainOn`, the main branch of `broadcastMessage`), `extensions/ipc/renderer/legacy-ipc.ts` (`ipcRendererOn`, the view branch of `broadcastMessage`) and `extensions/ipc/common/legacy-ipc.ts` (`broadcastMessage` choosing its branch by process as today, re-exporting the rest; the extension tree imports only this file). Move `common/ipc/ipc-main-injection-token.ts` and `main/utils/channel/ipc-main/ipc-main.injectable.ts` with its global override to `extensions/ipc/main/`, and `renderer/utils/channel/ipc-renderer.injectable.ts` with its global override to `extensions/ipc/renderer/`. Move the extension-only functions of `renderer/ipc/index.ts` (`requestInitialExtensionDiscovery`, the `requestExtensionLoader*` functions) to `extensions/ipc/renderer/` unchanged, since their main handlers take several arguments. Drop the `./ipc` export of `common/ipc/index.ts`, and point the imports of `extensions/` at the new paths. Remove the `common/ipc/ipc.ts` entry from the renderer list of `scripts/type-check-environments/legacy.jsonc` and add none. In `extensions/__tests__/extension-loader-is-enabled-sync.test.ts`, the mock's path becomes `extensions/ipc/common/legacy-ipc.ts`; in `extensions/__tests__/extension-loader.test.ts`, the import of the wrapper follows it; nothing else changes (research R12). Run `pnpm build:di`. Why: research R11. The only renderer error of the file is `ipcMain.listeners`, which moves into the main part, so the list shrinks.
- [ ] T042 [US2] Run `pnpm type:check`; for every moved file that no longer fails its environment program, remove it from its list in `scripts/type-check-environments/legacy.jsonc` and from the `noNodejsModules` exemption of `biome.jsonc` together (Principle II; the script fails until both are removed). Why: the lists only shrink.
- [ ] T043 [US2] Run the two searches of quickstart.md "User Story 2" (SC-001) and expect no output; run `pnpm test:unit` and compare with `$TMPDIR/002-baseline/tests.txt` (no project has fewer tests), and read `git diff main -- '*.test.ts' '*.test.tsx'` against research R12 (FR-019); and check SC-004 with the third search of quickstart.md "User Story 2", which prints only `freelens/src/renderer/index.ts`, the one place a build picks its implementation (FR-002).
- [ ] T044 [US2] Run the running-application checks of quickstart.md "User Story 2" with `pnpm dev` and the reference kind cluster, then the same steps on `main` as the control, and `pnpm test:integration` (SC-005). Record any difference as a bug of this phase and fix it before going on.

**Checkpoint**: no feature code outside the messaging packages and the
extension tree uses Electron IPC; the Electron build behaves as on `main`.

---

## Phase 5: User Story 3 - Every channel has an owner in the core (Priority: P3)

**Goal**: contracts/channel-list.md is complete and current after the moves.

**Independent Test**: the searches of its "How the list was made" section find
no channel without a row, and every row has an owner or a reason (SC-002).

- [ ] T045 [US3] Re-run the searches of "How the list was made" in `specs/002-messaging-for-tauri/contracts/channel-list.md` after Phase 4 and reconcile every row: the file in the Electron column after each move, the `_legacy_` marks removed for moved channels, rows added for any channel found without one; each row filled with data-model.md `Channel list entry.name or pattern`, `Channel list entry.kind`, `Channel list entry.direction`, `Channel list entry.Electron answerer`, `Channel list entry.values` and `Channel list entry.owner`. Why: the list was written from the inventory before the moves (research R13).
- [ ] T046 [US3] Check every name pattern in `specs/002-messaging-for-tauri/contracts/channel-list.md` against the code that builds the names (data-model.md `Channel list entry.name or pattern`), every owner against the areas of R9 in `specs/001-tauri-shell-spike/research.md` (data-model.md `Channel list entry.owner`, FR-018), the directory of each row's Electron file against the areas of its owner's row in R9, nested `features/**/main` directories included, with a note on the row where they differ (data-model.md `Channel list entry.Electron answerer`), and every `non-JSON` flag against research R4 (data-model.md `Channel list entry.values`).

**Checkpoint**: every channel of the Electron build has a row and an owner.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: the figures, the full checks and the quickstart.

- [ ] T047 [P] Create `specs/002-messaging-for-tauri/measure-electron-ipc.cjs`: a minimal Electron app run with the build's Electron binary (quickstart.md command) that answers `ipcRenderer.invoke` of texts of about 1 KB, 1 MB and 10 MB with the same text in a hidden window and prints the round-trip time of each; if `pnpm knip:check` reports the file, add it to the root `entry` of `knip.jsonc` with a comment like the one for `specs/*.mjs` (Why: a measurement script run by hand).
- [ ] T048 Fill the "Answer times" table of `specs/002-messaging-for-tauri/contracts/channel-list.md` with the medians of three runs of T047 and of the echo lines of the check run, for both builds (SC-007).
- [ ] T049 Run every command of `specs/002-messaging-for-tauri/quickstart.md` from a clean checkout of the branch: `pnpm build`, `pnpm type:check`, `pnpm test:unit`, `pnpm knip:check`, `pnpm biome check`, `pnpm trunk check`, the cargo checks and the check run, and fix what fails.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: before anything else, so the baseline is the current
  commit.
- **Foundational (Phase 2)**: empty.
- **User Story 1 (Phase 3)**: after Phase 1. T027 is the carrier's go/no-go:
  if it fails, R2 is reopened before more is built on it.
- **User Story 2 (Phase 4)**: after Phase 1; independent of User Story 1.
- **User Story 3 (Phase 5)**: after Phase 4, since the list is only complete
  once every path is on a channel.
- **Polish (Phase 6)**: T047 any time after T024; T048 after T027 and T047;
  T049 last.

### Within User Story 1

- T002 → T003; T004 → T005; T005 and T006 → T007 → T008–T014 (each test
  before its implementation) → T015.
- T016 → T017 → T018 → T019; T020 and T021 after T016; T022 after T018 to
  T021 → T023.
- T024 after T022; T025 after T015 and T024 → T026 → T027.

### Within User Story 2

- T028 before T032.
- T029 before T030, T032, T036 and T037, which send through the broadcast.
- T031, T032, T038 and T039 share files (`renderer/ipc/index.ts` and
  `setup-ipc-main-handlers.ts` for T031 and T032,
  `renderer/ipc/register-ipc-listeners.injectable.ts` for T032 and T038,
  `renderer/frames/root-frame/init-root-frame.injectable.ts` for T032 and
  T039), so they run one after the other and carry no [P].
- T041 after T029 to T040; T042 after T041; T043 and T044 last.

### Parallel Opportunities

- The test tasks T004, T008, T010 and T012 once T006 exists, and T014.
- In the core, T020 and T021 beside T017 to T019.
- User Story 1 and User Story 2 as a whole: they share no file.
- In User Story 2, T033, T034, T035, T037 and T040 together, beside the
  sequence T031 → T032 → T038 → T039.

---

## Parallel Example: User Story 1

```bash
# Tests of the view side, once the fake core (T006) exists:
Task: "T008 Write mft/src/message-to-channel.test.ts"
Task: "T010 Write mft/src/request-from-channel.test.ts"
Task: "T012 Write mft/src/enlist-message-channel-listener.test.ts"

# Core channels beside the routes:
Task: "T020 Create src/messaging/admin.rs"
Task: "T021 Create src/version.rs"
```

## Parallel Example: User Story 2

```bash
Task: "T033 Catalog channels"
Task: "T034 Shell tokens"
Task: "T035 Tray"
Task: "T040 Dead licenses injectable and the logger comment"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: the baseline.
2. Phase 3: the view side with its tests, the core module with its tests, the
   check run.
3. **Stop and validate** at T027: SC-003 and SC-006. A failure of the carrier
   reopens research R2 before anything else.

### Incremental Delivery

1. User Story 1: the Tauri build's views reach the core (MVP).
2. User Story 2: one area of research R11 at a time, each leaving the Electron
   build working and its tests green, ending with T041 to T044.
3. User Story 3: the channel list reconciled with the code after the moves.
4. Polish: the SC-007 figures and the full quickstart.

---

## Notes

- [P] tasks touch different files and depend on no unfinished task.
- Commit after each task or logical group, staging file by file.
- Scratch output (baselines, logs) goes to `$TMPDIR`, never into the
  repository.
- A behaviour test that fails after a move means the move changed behaviour:
  fix the move, not the test (research R12).
