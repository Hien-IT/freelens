---
description: "Task list for spec 008: main catalog"
---

# Tasks: Main Catalog

**Input**: Design documents from `specs/008-main-catalog/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md

**Tests**: requested. FR-025 and SC-005 ask that the behaviour of the existing
tests of the area hold in tests of the core (research R14), SC-004 asks for a
test of each channel's answer, and research R13 proves parity with fixtures
that the Electron build's own code and the core both assert. In each group, a
test task comes before the code it tests.

**Organization**: the shared `Catalog` handle and the move of the core's
existing areas onto it are foundational, because every story reads the
catalog through them and the existing cargo tests must keep passing. Then the
stories in the order of spec.md, which is also the risk order of plan.md: the
loader and the first fill (User Story 1), the watcher (User Story 2), the
other channels (User Story 3), the web link checks (User Story 4), the
measurements (User Story 5), and the channel list in the last phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an
  unfinished task)
- **[Story]**: the user story of spec.md the task belongs to
- A task that changes existing code says why.

## Path Conventions

- `core/` is `freelens-tauri/src-tauri/`: `core/src/…`, `core/tests/…`.
- `pc/` is `packages/core/src/`, the Electron build.
- `ui/` is `freelens-tauri/ui/src/renderer/`, the spike page.
- `fixtures/` is `core/tests/fixtures/catalog/`.
- Every command runs from the repository root unless it starts with `cd`.
- No test, measurement or manual step reads the user's own `~/.kube` or data
  directory: each uses a temporary directory, `--data-dir`, and a user store
  whose kubeconfig syncs it sets itself.
- The Vitest commands run with the root config, as `pnpm test:unit` does:
  `TZ=UTC pnpm exec vitest run -c vitest.config.ts <file>`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: record what the later checks compare against, and add what the
plan's Technical Context adds.

- [x] T001 Record the baseline on the current commit, outside the repository, in the session's scratch directory: the names of the tests `cd freelens-tauri/src-tauri && cargo test -- --list` prints, and the summary of `pnpm test:unit` (test files and tests per project). Nothing is written in the repository. Why: FR-024 requires every existing test to pass unchanged, which T044 compares against. Done: 217 cargo tests (216 pass, 1 ignored); `pnpm test:unit`: 591 test files passed, 7222 tests passed, 29 skipped.
- [x] T002 Add to `core/Cargo.toml` the crate `notify` at its current 8.x release with its default features, and `serde-saphyr` at the version `core/Cargo.lock` already holds through kube. Run `cd freelens-tauri/src-tauri && cargo build && cargo test`. In `specs/008-main-catalog/research.md` R5, replace "Unverified until added" with what `cargo tree -e features -i notify` shows for the macOS backend, and list the packages `git diff core/Cargo.lock` adds. Record in R5 the latency and the flags `notify` passes to FSEvents; if that latency would let a removal reach the catalog more than 150 ms after the unlink, reopen R5 before T028. Why: the one new crate of plan.md; R5 depends on its backend being FSEvents, and SC-002's margin for a removal on its latency. Done with `notify` 9.0.0, the current release when added rather than an 8.x: its default `macos_fsevent` uses FSEvents through `objc2-core-services`, with latency zero and the flags `FileEvents`, `NoDefer` and `WatchRoot` (research R5, which now records it and the eight packages `Cargo.lock` gains). `serde-saphyr` adds no package. The 217 existing cargo tests pass.
- [x] T003 [P] Leave `freelens-tauri/src-tauri/tests/fixtures/catalog/**` out of Biome in `biome.jsonc` and out of Trunk in `.trunk/trunk.yaml`, next to the entries for `tests/fixtures/data-dir/` and with the same kind of comment. Why: the fixtures hold invalid YAML, UTF-16 files and invalid UTF-8 on purpose (research R13). Done.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared handle of contracts/catalog-api.md, and the five
areas of research R10 asking it instead of the catalog of spec 001. Until
User Story 1 fills it from the syncs, the handle's only cluster source is the
file of `--kubeconfig`, read once, as spec 001 reads it, so the existing tests
keep their fixtures.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [x] T004 [P] Write the unit tests in the `tests` module of `core/src/catalog/mod.rs` for the handle, porting `pc/main/catalog/__tests__/catalog-entity-registry.test.ts` (research R14): the entities in source order, web links, then general pages, then clusters (data-model.md `Catalog.entities`); an id given by two sources listed once, from the first; an entity whose group is not `entity.k8slens.dev` or whose kind is not `General`, `KubernetesCluster` or `WebLink` left out, whatever the version (research R1); `has_cluster` and `cluster` for a known, an unknown and an empty id; `subscribe` called with `ClusterChanged` and `ClusterRemoved` after a change, outside the lock; `Catalog::version` raised on every change (data-model.md `Catalog.version`). Done differently: the Electron build's registry does not drop an id that two sources give, so the test asserts that both are listed; the clusters are deduplicated by the kubeconfig sync (T014). data-model.md `Catalog.entities` now says so.
- [x] T005 Move `core/src/catalog.rs` to `core/src/catalog/mod.rs` with `git mv`, and give it the `Catalog`, `ClusterSource`, `CatalogEvent`, `LaunchFile`, `has_cluster`, `cluster`, `entities`, `subscribe`, `scanned` and `launch_file` of contracts/catalog-api.md, behind one lock and cheap to clone; keep the spike's reading of one file as a private source, built by `Catalog::from_kubeconfig_file`, so that the next tasks can move the callers before User Story 1 replaces it. Make T004 pass. Why: every story and every area of research R10 asks this handle. Done. Beside the contract, the handle has `empty()`, `clusters()`, `cluster_ids()` (for the tests), `on_change` for any change of the entities, and public `set_weblinks`, `set_clusters`, `set_visible` and `set_scanned`; `from_choice` keeps spec 001's reading of `$HOME/.kube/config` without the option until T019. `src/catalog/entities.rs` holds the general pages and a cluster entity from its context alone, which T018 completes. The old unit tests of `catalog.rs` are rewritten in `src/catalog/mod.rs`.
- [x] T006 Make the scheme's view of a host and the frame record ask the handle at the time of each request: `view_of` in `core/src/messaging/routes.rs` and `core/src/routes.rs` take `&Catalog` and call `has_cluster`; `core/src/frames.rs` keeps a `Catalog` instead of the `HashSet` of ids and checks the visible cluster with `has_cluster` when it is named. Why: FR-020; a cluster that leaves the catalog must be refused from then on (research R10). Done.
- [x] T007 Make the local storage files ask the handle: `Setup` in `core/src/foundation/mod.rs` takes a `Catalog` instead of the `HashSet`, and `core/src/foundation/local_storage.rs` refuses a cluster for which `has_cluster` is false at the time of the request. Why: FR-020 takes over FR-013 of spec 007. Done.
- [x] T008 Make the cluster clients read their own cluster's file: `core/src/clusters.rs` builds a client from `Catalog::cluster(id)`, reading the file of `ClusterSource.kubeconfig_path` with kube's `Kubeconfig::read_from` and selecting `ClusterSource.context_name`, and drops a cached client on `CatalogEvent::ClusterChanged` and `CatalogEvent::ClusterRemoved` for its id. `scheme::State` keeps a `Catalog`. `/api/clusters` in `core/src/scheme.rs` keeps its answer: it waits for the first scan of the launch sync (`Catalog::scanned`), then answers `clusters` from the cluster entities of `entities()` as `{ id, name }`, `source` as the file of `--kubeconfig`, `message` as the spike's notice for that file when it is missing or not a kubeconfig (`Catalog::launch_file`), and `openOnLoad` as the id of the context `--open-cluster` names in that file, or null. The frame page looks its cluster up with `cluster(id)`. Why: FR-020; the clients of spec 001 were all built from the one file, and the spike page's route keeps what `core/tests/scheme.rs` asserts (research R10). Done; the notice moved to `scheme.rs` with a unit test, and `ClusterApi::get` takes a `ClusterSource`.
- [x] T009 In `core/src/lib.rs`, build the `Catalog` after the `Stores`, pass it to `register_core`, the frames, the foundation `Setup` and `scheme::State`, and add `catalog` to `Core`; move `core/tests/frames.rs`, `core/tests/foundation.rs`, `core/tests/messaging.rs`, `core/tests/scheme.rs`, `core/tests/stores.rs` and `core/tests/navigation.rs` from `Catalog::load` to `Catalog::from_kubeconfig_file` with the same fixtures. Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`: every test of T001 passes unchanged in what it asserts. Done: the tests take their ids from `cluster_ids()` instead of `entries`, and assert what they asserted; fmt, clippy and the 223 cargo tests pass, the removed ones being the seven unit tests of the old `catalog.rs`, rewritten in `src/catalog/mod.rs` and `src/scheme.rs`.

**Checkpoint**: every area of the core asks one catalog; the stories can start.

---

## Phase 3: User Story 1 - The same catalog in both builds (Priority: P1) 🎯 MVP

**Goal**: the core fills the catalog from the syncs of the settings and the
application's kubeconfig directory, with the Electron build's loader, ids,
labels and entities, and sends it to the views (FR-001 to FR-008, FR-013,
FR-014, FR-021, FR-022).

**Independent Test**: User Story 1's test of spec.md, as quickstart.md
section 2 runs it: with the same data directory and syncs, the catalog each
build sends is equal as a JSON value.

### Tests for User Story 1

- [x] T010 [P] [US1] Create the fixture cases of research R13 in `fixtures/`, one directory per case with `case.json` (the syncs, each a path relative to the case's `input/` and `file` or `folder`), `input/` (the synced files, and `lens-cluster-store.json` and `lens-weblink-store.json` when the case has them), `texts/` (pasted texts for `parse-kubeconfig-text`, where the case has them) and `expected/` (`entities.json`, `lens-cluster-store.json`, `parse/<text>.json`), with the temporary root written `<root>` and the home directory `<home>`. Cases: `valid-and-invalid-contexts`, `context-without-context`, `invalid-yaml`, `empty-file`, `duplicate-keys`, `merge-keys`, `yes-and-timestamp-names`, `duplicate-context-names`, `utf16le`, `utf16be`, `invalid-utf8`, `size-limits` (a folder's file of 2 MiB and one byte under, which `case.json` describes and the tests generate, so that no file of 2 MiB is committed), `store-entries` (name, icon `data:` and plain, short name, labels, metrics, metadata), `null-icon-and-short-name`, `no-store-entry`, `file-label` (inside and outside `<root>/data/kubeconfigs`, a path containing `<home>` twice), `two-syncs-one-file` (a file sync and the sync of its folder), and `weblinks`. Servers are made up and credentials are placeholders. `expected/` is written by T011 in its update mode. Done: 19 cases, among them `yes-and-null-names` (with `true`, `~` and `on`) in place of the timestamp, which is the core-only case `core-only-timestamp-name` (research R3, "Limits"), and `two-syncs-one-file`. Inputs name ids `<id:<file>:<context>>`; expected files write `<id>` and `<root>`.
- [x] T011 [P] [US1] Write `pc/main/catalog-sources/tauri-parity.test.ts`, following `pc/features/persistent-storage/main/tauri-parity.test.ts`: for each case of `freelens-tauri/src-tauri/tests/fixtures/catalog/`, copy `input/` into a temporary directory and generate there the files its `case.json` describes, set `process.env.HOME` to a fixed path for the run (`compute-diff` calls `os.homedir()`), load the cluster and web link stores with real `conf`, inject `catalogEntityRegistryInjectable`, add the web link and general sources, and feed each synced file through the Electron build's own `diffChangedKubeconfig` with the path its sync's watcher would report (data-model.md `Synced file.path`); run `ClusterManager.init()` with the connection injectables overridden, wait until the registry is quiet, and assert `JSON.parse(JSON.stringify(toJS(registry.items)))`, the cluster store's model and `checkKubeconfigText` of each text against `expected/`, with `<root>` and `<home>` put back. With `UPDATE_TAURI_PARITY=1` it writes `expected/`. Why: research R13; the cases' `expected/` is the Electron build's behaviour. Done, with three findings: the unit tests' container replaces `setup-syncing-of-weblinks` with nothing, so the test starts the verification and adds the source itself; `os.homedir()` reads the process's environment, which a Vitest worker cannot change through `HOME`, so the test mocks it; and it drives the kubeconfig sync manager and the entity registry as well as the cluster manager.
- [x] T012 [US1] Run T011 in update mode and review `expected/` against contracts/catalog-entities.md, contracts/synced-files.md and data-model.md; fix the contract or the data model where the Electron build differs, and note each difference in this task. Then run T011 without the variable: it passes. Done. What the Electron build differed in from the contracts, now fixed there: js-yaml 5 does not expand merge keys (`<<` is an ordinary key); a cleared `null` icon leaves the entity without `icon`; the cluster store's order follows the order its reads end. The test passes without the variable: 19 tests.
- [x] T013 [P] [US1] Write the unit tests of `core/src/catalog/kubeconfig.rs`, porting the cases of `pc/main/catalog-sources/kubeconfig-sync/diff-changed-kubeconfig.test.ts` and the `configsToModels` and `computeKubeconfigDiff` cases of `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts` (research R14): the size limits at and just under 2 MiB and 32 MiB (data-model.md `Synced file.limit`); UTF-16 LE and BE by byte order mark, the mark dropped, invalid UTF-8 refused; files in UTF-8 and UTF-16 LE that end inside a character skipped; CRLF line endings in UTF-8 and in UTF-16 LE read as they are; blank text; YAML with duplicate keys refused, merge keys expanded, `yes` a string, a timestamp-like name not a string; every rule and message of the schema table of contracts/synced-files.md "Loading", with failed entries dropped; `contexts[<i>].context is missing`; the split and the three validation errors; a duplicate context name giving one context (data-model.md `Context.context_name`); and, for every error, that its text does not contain a placeholder token or server of the input (FR-014). Done, in the module's `tests`.
- [x] T014 [P] [US1] Write the unit tests of `core/src/catalog/syncs.rs`: the syncs in the order of data-model.md `Sync.origin`, with the setting's default for a release and a debug build read from a `Stores` model; the normalization of data-model.md `Sync.path` (backslash, `.`, `..`, trailing slash, repeated slashes, a leading `//`); the stat of data-model.md `Sync.kind`, a missing path skipped with a debug line and no warning (the "skips missing paths without warning" case of `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts`); a folder's files (data-model.md `Sync.files`, `Synced file.path`): direct entries only, a symbolic link to a file counted under its own path, a link to a folder and a subfolder not counted, every ignore rule of `pc/main/catalog-sources/kubeconfig-sync/watch-file-changes.test.ts` except the WSL one; the id of data-model.md `Context.id`, checked against the ids `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts` computes; an id kept by the first sync and file (the "should still only find a single entity" case); the `file` label rules of contracts/catalog-entities.md. Done.
- [x] T015 [P] [US1] Write the unit tests of `core/src/catalog/entities.rs`, porting `pc/main/cluster/update-entity-metadata.test.ts` (research R14): the four general pages and a web link exactly as contracts/catalog-entities.md writes them; a cluster from a context with no store entry, and one with each row of data-model.md "Cluster store entry" (`preferences.clusterName`, `preferences.iconShortName`, `preferences.icon`, `preferences.prometheus`, `preferences.prometheusProvider.type`, `labels`, `metadata`); `null` icon and short name cleared from the entity and from the entry; the entry a context with none gets, once per diff; `status.active` for the cluster of data-model.md `Catalog.visible`; no key with no value in the JSON. Done.

### Implementation for User Story 1

- [x] T016 [P] [US1] Create `core/src/catalog/kubeconfig.rs` with the pipeline of contracts/synced-files.md "Reading" and "Loading" over `serde-saphyr` with duplicate keys refused, merge keys expanded, strict booleans and no snippet (research R3), returning the valid contexts (data-model.md `Synced file.contexts`) and the log lines of research R11. Make T013 pass. Done; `<<` is kept as an ordinary key (T012). `FileRead` has an `Invalid` outcome for the spike page's notice.
- [x] T017 [P] [US1] Create `core/src/catalog/syncs.rs` with the syncs of contracts/synced-files.md "The syncs" and "The synced files" (data-model.md `Sync.path`, `Sync.origin`, `Sync.kind`, `Sync.files`), the cluster id (`md-5`, moved from the spike's `cluster_id`) and the `file` label, and a first scan that reads every synced file at once through T016. Create `<data dir>/kubeconfigs` when missing. Make T014 pass. Done.
- [x] T018 [P] [US1] Create `core/src/catalog/entities.rs` with the three kinds of contracts/catalog-entities.md, the cluster store's part of research R6 and the entries for new contexts as one `Stores::update` per diff (data-model.md `Entity`, `Context.file`). Make T015 pass. Done; `store::cluster::is_valid` is public for it, and an entity whose `null` icon was cleared keeps no icon (T012).
- [x] T019 [US1] Change `--kubeconfig` in `core/src/options.rs`: `--kubeconfig=<path>` becomes a file sync for the run, `--kubeconfig=none` and no option add nothing; add `--catalog-dump=<path>` (research R12), resolved against the working directory and refused when empty; with unit tests of the parse. Update `specs/001-tauri-shell-spike/contracts/launch-options.md` for both. Why: FR-021, and the default of spec 001, `~/.kube/config` read once, goes (research R10). Done: `kubeconfig` is an `Option<PathBuf>` now, `KubeconfigChoice` and `default_kubeconfig` are gone. `--catalog-dump` appends one JSON line per catalog sent (research R12), and adds `catalog-marks` to the page's query.
- [x] T020 [US1] Fill the `Catalog` of `core/src/catalog/mod.rs` from T017 and T018: `Catalog::new` of contracts/catalog-api.md with the web links and general pages at once, `start` running the first scan on the async runtime, `scanned` resolving once every sync has had it and `launch_file` giving what the launch sync's read found, the clusters rebuilt on `Stores::on_change` for the cluster and web link stores; remove `from_kubeconfig_file` and move the tests of T009 to `Catalog::new` over a temporary data directory whose user store syncs the same fixture file. In `core/src/lib.rs`, call `start` after the window is built, so that the scan never delays it (research R12 of spec 007 and SC-006). Done differently: `from_kubeconfig_file` stays, rewritten over the loader of the kubeconfig sync with one launch sync and no stores, for the tests of other areas that need clusters alone; `Catalog::new` is tested by `tests/catalog.rs`. `new_with_home` gives the tests the home directory of the `file` label. The first scan runs on a thread of its own, started once the window is built.
- [x] T021 [P] [US1] Write `core/tests/catalog.rs`, first part, driving `messaging::routes::handle` as `core/tests/foundation.rs` does: `catalog:init` from a view gives every open view the whole catalog on `catalog:items`; the coalescing of contracts/catalog-channels.md "`catalog:items`" with paused time (a change at once; three changes 50 ms apart sent once, 100 ms after the last; nothing more when nothing changed after the first send); `cluster-visibility` marking a cluster active, an unknown id kept until it appears; a cluster frame that records its frame id on `cluster:set-frame-id` getting `catalog:items`; every case of `fixtures/` loaded through `Catalog::new` on a temporary copy giving `expected/entities.json` and `expected/lens-cluster-store.json` as JSON values; `--catalog-dump` writing the last catalog sent. Done; the fixture comparison is looser in two places (research R13): a YAML parse error by its prefix and line, and the cluster store without its order.
- [x] T022 [US1] Create `core/src/catalog/channels.rs` with `register` of contracts/catalog-api.md for `catalog:init`, `catalog:items` with the coalescing and the log line `Catalog: sent <n> entities`, `cluster-visibility` (data-model.md `Catalog.visible`), the send of the catalog on each `FrameEvent::Announced` of `Frames`, through the coalescing (research R7), and the dump of `--catalog-dump`; register it in `register_core` of `core/src/lib.rs`, after `frames::register`, whose `Frames` it takes. Make T021 pass. Done. `register` also takes the `CatalogLog`; the dump file comes from `Catalog::dump_to`. The three tests of `tests/frames.rs` that list a frame's messages leave out `catalog:items`, which the frame now gets when it records its id; what they assert, that `send_to` reaches one frame only, is unchanged.
- [x] T023 [US1] Change the spike page `ui/catalog.ts` to send `catalog:init` and render its list from the `KubernetesCluster` entities of `catalog:items`, to open the cluster whose id `openOnLoad` names once it appears in `catalog:items`, to send `cluster-visibility` beside `current-visible-cluster` when a frame is shown or hidden, and, with `?catalog-marks` in its URL, to post the mark `catalog-<n>` to `/mark` when it receives `n` entities; update `specs/001-tauri-shell-spike/contracts/scheme-routes.md` for `/api/clusters`. Why: research R10 and R12; the page is how the Tauri build shows the catalog until the renderer runs there. Done; the page keeps `/api/clusters` for its first list, the notice and `openOnLoad`. `pnpm tauri:ui` builds it.
- [x] T024 [US1] Write `specs/008-main-catalog/measure-catalog.mjs`, with the single-line Freelens header, its common part and the mode `dump`: a temporary directory (printed as `workdir=`), the case of quickstart.md section 2 generated with made-up servers and placeholder credentials, a user store whose syncs name it; the Electron build started as `specs/profile-main.mjs` starts it, with a hook in main, through the inspector, that writes each `catalog:items` payload to a file; the Tauri build started with `--data-dir`, `--catalog-dump` and `?catalog-marks`; both read after 2 seconds without a send, compared as JSON values, and searched for the placeholder credentials (SC-008). Run it against the branch and against the Electron build of `main`: `equal` and `credentials: none found`. Done: `equal` and `credentials: none found`. The Electron build is the branch's, packaged; its code differs from `main` only in the single-instance check under `electron-app/features`, outside the catalog, so it stands as the control. The hook is installed by retrying after `Runtime.runIfWaitingForDebugger`, since `require` is not there while main waits on the inspector. A folder's files come in `readdir` order from the Electron build and by name from the core, so the catalogs are compared sorted.
- [x] T025 [US1] Run the cargo gates of T009 in `freelens-tauri/src-tauri` and the Vitest test `pc/main/catalog-sources/tauri-parity.test.ts` of T011. Done: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass (293 tests: 292 pass, 1 ignored as before), and the parity test passes its 19 cases, alone and in `pnpm test:unit`.

**Checkpoint**: User Story 1 works and is tested on its own; this is the MVP.

---

## Phase 4: User Story 2 - A change to a synced file reaches the catalog (Priority: P2)

**Goal**: the core follows the synced files and the sync setting while it
runs, no later than the Electron build, and never reads a file half written
(FR-009 to FR-012).

**Independent Test**: User Story 2's test of spec.md, as quickstart.md
section 3 runs it.

### Tests for User Story 2

- [x] T026 [P] [US2] Write the unit tests of `core/src/catalog/watch.rs` with a clock and a stat source the test drives: a file read once its size, modification time and inode stayed the same for 500 ms (data-model.md `Synced file.identity`, `Synced file.stable_at`), a further change restarting the wait; a missing file removed only when still missing 100 ms later, and a change when back within that time (data-model.md `Synced file.missing_at`); the first scan reading at once; a read error keeping the file's contexts; an event under `/private/var` waking the sync of a path under `/var` (data-model.md `Sync.watches`); a dropped-events flag scanning every sync under its path. Done, in the module's `tests`; the stat source is the `FileState` the test feeds.
- [x] T027 [P] [US2] Write `core/tests/catalog.rs`, second part, on a real temporary directory with FSEvents, each step asserted on the next `catalog:items` within 3 seconds: a context added to and removed from a synced file; a context whose content changes keeping its id; a file added to and removed from a synced folder; a file replaced by a rename and rewritten in place, with no catalog in between missing a context present before and after; a symbolic link's target changed; a sync added and removed through `Stores::update` of the user store, the application's directory staying synced (the "runtime add / delete via manager", "directoryForKubeConfigs is always watched" and "fromStore() IPC-reload path" cases of `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts`); after a cluster leaves, `lens-local-storage:read` for it refused and its visible frame not recorded. Done, with real FSEvents on a temporary directory.

### Implementation for User Story 2

- [x] T028 [US2] Create `core/src/catalog/watch.rs` with `notify`'s FSEvents watcher used only to wake scans (research R5), the windows of T026, a watch per symbolic link's target, and the matching of canonical event paths to syncs. Make T026 pass. Done. Found by T027: the first scan now ends only once the syncs are watched, and the first loop looks at every sync, so that a write right after it is not missed.
- [x] T029 [US2] Connect the watcher in `core/src/catalog/syncs.rs` and `core/src/catalog/mod.rs`: each sync's watches started after its first scan, the syncs reconciled on `Stores::on_change` for the user store when the key set of `syncKubeconfigEntries` changes (a stopped sync's watches dropped and the clusters only it gave removed, the application's directory kept), and `CatalogEvent`s sent for every cluster added, changed or removed; log each sync started and stopped (research R11). Make T027 pass. Done; the log lines of each sync started and stopped come from `SyncSet::reconcile`.
- [x] T030 [US2] Add the mode `changes` to `specs/008-main-catalog/measure-catalog.mjs`: for each change of SC-002, five times per build, the time from the write returning to the Electron hook's send or the Tauri page's mark; then the 100 rewrites of SC-003, checking every catalog received; medians printed per build. Run it; record the medians in a new section "Catalog (spec 008)" of `specs/baseline.md`. A Tauri median above the Electron one reopens research R5. Done: Tauri medians 535, 540, 534 and 121 ms at the page's mark (533, 537, 530 and 118 ms at the core's send), against 1027, 1027, 1143 and 166 ms for the Electron build; no catalog during the rewrites misses a cluster in either build. The script also times the Tauri build at the core's log line, the point the Electron build is timed at. Runs with the window behind others found three gaps, fixed in the core (research R5 and R7). App Nap delayed the core's sends by 0.5 to 2 s; the core now opts out of it, as the Electron framework does. WebKit stopped the page about 8 s after it loaded, and once its queue closed after a minute; the main window is now built with `BackgroundThrottlingPolicy::Throttle`. A view whose queue reopens now gets the catalog again, tested by `a_view_whose_queue_closed_gets_the_catalog_again_when_it_polls_again`.

**Checkpoint**: User Stories 1 and 2 work on their own.

---

## Phase 5: User Story 3 - The core answers every channel of main-catalog (Priority: P3)

**Goal**: the enumeration, the sync kind and the pasted kubeconfig text are
answered as the Electron build answers them (FR-015 to FR-017).

**Independent Test**: User Story 3's test of spec.md, as quickstart.md
section 4 lists it.

### Tests for User Story 3

- [x] T031 [P] [US3] Write `core/tests/catalog.rs`, third part, porting `pc/features/cluster/enumeration/main/__tests__/handlers.test.ts`, `pc/main/cluster-enumeration/__tests__/cluster-enumeration.test.ts`, `pc/features/kubeconfig-sync-kind/kubeconfig-sync-kind.test.ts` and `pc/features/add-cluster/kubeconfig-text.test.ts` (research R14): `get-all-clusters` and `get-cluster-by-id` with the `ClusterInfo` of contracts/catalog-channels.md, every status mapping, labels without a value left out, `isActive` false, an unknown and an empty id answering no value, web links and general pages never in `get-all-clusters`, a context added to a synced file in the next answer of `get-all-clusters`, and `metadata` with and without a recorded distribution and version; `discover-kubeconfig-sync-kind` for a file, a folder, a link to each, a socket and a missing path, with Node's `ENOENT` text; `parse-kubeconfig-text` for each `texts/` file of `fixtures/` against `expected/parse/`, and no placeholder credential in any answer; `add-kubeconfig-text` writing one file of mode `0600` under a v4 uuid name in `<data dir>/kubeconfigs`, answering every context name, valid or not, and the valid contexts reaching `catalog:items`. Done; the mapping of every phase, a label without a value and the filtering of other kinds are unit tests of `src/catalog/channels.rs`.

### Implementation for User Story 3

- [x] T032 [US3] Add `get-all-clusters` and `get-cluster-by-id` to `core/src/catalog/channels.rs`, mapping the cluster entities as contracts/catalog-channels.md "`ClusterInfo`" says. Done. An unknown or empty id answers no value, as `undefined`: messaging gains `Optional`, whose `None` travels as no value, as `()` does.
- [x] T033 [US3] Add `discover-kubeconfig-sync-kind` to `core/src/catalog/channels.rs`, with Node's stat error texts of contracts/catalog-channels.md; reuse the errno texts of `core/src/foundation/directories.rs` if spec 007 already has them there, rather than a second table. Done with a table of its own: `src/foundation/directories.rs` holds the Electron build's own texts for `validate-directory`, not Node's stat errors.
- [x] T034 [US3] Add `parse-kubeconfig-text` and `add-kubeconfig-text` to `core/src/catalog/channels.rs` over T016, as contracts/catalog-channels.md says. Make T031 pass. Done.

**Checkpoint**: User Stories 1 to 3 work on their own.

---

## Phase 6: User Story 4 - Web links show whether they can be reached (Priority: P4)

**Goal**: each web link of the catalog is checked as the Electron build checks
it (FR-019).

**Independent Test**: User Story 4's test of spec.md, as quickstart.md
section 5 runs it.

### Tests for User Story 4

- [x] T035 [P] [US4] Write the unit tests of `core/src/catalog/weblinks.rs` with a local server and paused time, porting nothing (`pc/features/weblinks` has no test; research R14): a link `available` before its first check ends (data-model.md `Web link check.phase`); statuses 200, 302 followed to 200, 404 and 499 available, 500 and 503 unavailable, a closed port and a server that answers after 20 seconds unavailable; no proxy used even when the settings name one; the next check between 60 and 65 minutes after the last ended (data-model.md `Web link check.next_at`); a link removed from the store not checked again (data-model.md `Web link check.link`); the test's own authority passed as the tests of `core/src/foundation/download.rs` pass it. Done. The scheduling runs with paused time and a checker of the test's own; the statuses, the closed port and the slow server against a local server, the time limit a parameter of the check. That no proxy is used holds by construction: `download::status_of` takes none.

### Implementation for User Story 4

- [x] T036 [US4] Create `core/src/catalog/weblinks.rs` with the checks of research R9 over the connection code of `core/src/foundation/download.rs`, without its proxy, and update the web link entities' phase in `core/src/catalog/mod.rs` when a check ends. Make T035 pass. Done, with `download::status_of`, a GET that follows redirects and reads no body; a link's phase is forgotten when it leaves the store, so that it starts available if it comes back, as the Electron build creates its `WebLink` anew.
- [x] T037 [US4] Add the mode `weblinks` to `specs/008-main-catalog/measure-catalog.mjs` (a link served on `127.0.0.1`, one on a closed port, then one removed) and run it for both builds: the same phases, and the removed link gone. Done: the same phases in both builds, `available` for the served link and `unavailable` for the closed port, and `credentials: none found`. The removal is not driven by the script: neither build takes a change of the web link store from outside a view, as R12 says of the sync setting. The cargo test `each_link_is_checked_at_once_then_after_an_hour_until_it_leaves` removes a link through the store and checks that it leaves the catalog and is not checked again.

**Checkpoint**: User Stories 1 to 4 work on their own.

---

## Phase 7: User Story 5 - Startup and a large catalog are as fast as in the Electron build (Priority: P5)

**Goal**: SC-006 and SC-007 are measured and met.

**Independent Test**: User Story 5's test of spec.md, as quickstart.md
sections 6 and 7 run it.

- [x] T038 [US5] Add the modes `large-seed` and `large` to `specs/008-main-catalog/measure-catalog.mjs`: the large catalog of data-model.md "Large catalog" generated with made-up servers and placeholder tokens; `large-seed <dir>` writing the five stores, the files and a user store whose syncs name them under `__RUN_DIR__`; `large` timing, three times per build, a view's `catalog:init` to the whole catalog. Done: the large catalog is one file of 250 contexts and a folder of 25 files of 10 contexts, with made-up servers and placeholder tokens, plus a web link to a closed port on `127.0.0.1`.
- [x] T039 [US5] Change `specs/001-tauri-shell-spike/measure.sh`: after copying `MEASURE_DATA_DIR`, replace `__RUN_DIR__` in the copied user store with the run's directory; without `MEASURE_DATA_DIR`, write a user store with `syncKubeconfigEntries: []`, so that no `spike` run reads the user's `~/.kube` (research R10). Done: the copied user store gets the run's directory through `perl`; without `MEASURE_DATA_DIR` the user store is `{"preferences":{"syncKubeconfigEntries":[]}}`.
- [x] T040 [US5] Build the Tauri build with `pnpm --filter @freelensapp/freelens-tauri tauri:build`, run quickstart.md sections 6 and 7, and record the startup median and both builds' medians of `large` in the section "Catalog (spec 008)" of `specs/baseline.md`. A startup above 2.37 s, or a Tauri `large` median above the Electron one, is profiled and fixed before this task is done. Done: startup 0.48 s (0.97 / 0.46 / 0.48), and `large` 19 ms for the Electron build and 8 ms for the Tauri build, recorded in `specs/baseline.md`. The first `large` run gave the Tauri build 111 ms: its page asks while the coalescing timer of startup still runs, so the core now answers `catalog:init` at once and sends nothing for a change that leaves the entities as they were (research R7).

**Checkpoint**: every user story works on its own.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: the channel list, the credential search, the gates of both
builds, and the manual comparison.

- [x] T041 [P] Update `specs/002-messaging-for-tauri/contracts/channel-list.md`: each row of the section "main-catalog" names the core's handler (`src/catalog/channels.rs`), and the row of `cluster-visibility` moves there from "main-cluster-connection" with a note that main reads it only for the active flag (FR-018). Done; the section says once that the core answers every row, and `get-cluster-by-id`'s note says an unknown id answers no value.
- [x] T042 [P] Check that no log line of the core carries kubeconfig text: run `cargo test` with the fixtures of T010 and search the captured log of `core/tests/catalog.rs` for every placeholder token and server of the fixtures, and check that it holds the start and the stop of each sync; add both checks to `core/tests/catalog.rs` so that they stay (FR-014, FR-022, research R11). Done in `every_fixture_gives_what_the_electron_build_gives`: for every case, no line holds a placeholder token or a server of the fixtures, and each sync's start is logged; the stop is checked by `a_sync_added_and_removed_in_the_setting_starts_and_stops`.
- [x] T043 Run every mode of `specs/008-main-catalog/measure-catalog.mjs` once more against the packaged builds: each prints `credentials: none found` (SC-008). Done on the final builds: `dump` `equal`, `changes` as in T030, `weblinks` `equal`, `large` 19 and 8 ms, `large-seed` written for T040; each mode printed `credentials: none found`.
- [x] T044 Run the gates of both builds: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`; `pnpm build`, `pnpm type:check`, `pnpm test:unit`, `pnpm knip:check`, `pnpm biome check` on the changed files and `trunk check`; and `pnpm test:integration` against a packaged Electron build of the branch. Compare with T001: no test removed, and every test passes (FR-024, SC-009). Done. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` pass: 293 tests, 292 pass and 1 is ignored as before. Against the 217 of T001, the ten that are gone test behaviour the spec replaces. Seven are of the old `src/catalog.rs`, rewritten in `src/catalog/mod.rs` and `src/scheme.rs`. Three are of `src/options.rs`, where `--kubeconfig` now adds a file sync (FR-021): `no_option_reads_the_default_file` and `none_reads_no_file` became `no_option_adds_no_file` and `none_adds_no_file`, and `the_default_file_is_under_home` went with the default file. `pnpm build` and `pnpm type:check` pass. `pnpm test:unit` passes 592 files and 7241 tests with 29 skipped: T001's 591 files and 7222 tests, plus the parity test and its 19 cases. `pnpm knip:check` passes once `knip.jsonc` takes `specs/*/*.mjs` as entries and `ditto` and `hdiutil` as binaries of the operating system. `pnpm biome check` passes on the changed files, and `trunk check` shows no new issue. `pnpm test:integration`, against the branch's Electron build packaged with `pnpm build:app:dir`, passes 4 files and 5 tests. It skips 7 tests: those of a KinD cluster, as none runs on this machine, and one marked `it.skip`.
- [x] T045 Run `specs/008-main-catalog/quickstart.md` sections 2 to 5 with the Electron build of `main` as the control, as Principle V asks, and note in this task what each section showed. Done, with the branch's Electron build, packaged with `pnpm build:app:dir`, as the control. Its code differs from `main` only in the single-instance check under `electron-app/features`, which the catalog does not use; no build of `main` was packaged. Section 2: `equal` and `credentials: none found`. Section 3: the medians of T030 and no catalog missing a cluster in either build. Section 4: the 15 tests of `tests/catalog.rs` pass, and the parity test's `parse-kubeconfig-text` cases. Section 5: in both builds, `available` for the served link and `unavailable` for the closed port. The removal of a link is checked by the cargo test of T037 only.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on T002; blocks every story.
- **User Story 1 (Phase 3)**: depends on Phase 2.
- **User Story 2 (Phase 4)**: depends on User Story 1's first scan (T017,
  T020) and sending (T022).
- **User Story 3 (Phase 5)**: depends on User Story 1's loader (T016) and
  channels module (T022); independent of User Story 2.
- **User Story 4 (Phase 6)**: depends on User Story 1's entities (T018, T020);
  independent of User Stories 2 and 3.
- **User Story 5 (Phase 7)**: depends on User Story 1 (T024's script); its
  figures mean most once User Story 2's watcher is in.
- **Polish (Phase 8)**: depends on every story.

### Within Each User Story

- Tests are written before the code they test, and fail first.
- The loader, syncs and entities (T016 to T018) before the handle that joins
  them (T020) and its channels (T022).
- `core/tests/catalog.rs` grows by parts (T021, T027, T031); the parts are in
  different stories and are written one after the other.

### Parallel Opportunities

- T003 beside T002.
- T004 beside T006 to T008 once T005's types exist.
- T010, T011, T013, T014 and T015 together; then T016, T017 and T018 together.
- T026 and T027 together.
- Once User Story 1 is done, User Stories 3 and 4 can run beside User Story 2.
- T041 and T042 together.

---

## Parallel Example: User Story 1

```bash
# The tests and fixtures of User Story 1 together:
Task: "Create the fixture cases of research R13 in fixtures/"
Task: "Write pc/main/catalog-sources/tauri-parity.test.ts"
Task: "Write the unit tests of core/src/catalog/kubeconfig.rs"
Task: "Write the unit tests of core/src/catalog/syncs.rs"
Task: "Write the unit tests of core/src/catalog/entities.rs"

# Then the three modules they test together:
Task: "Create core/src/catalog/kubeconfig.rs"
Task: "Create core/src/catalog/syncs.rs"
Task: "Create core/src/catalog/entities.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2: the handle, with every area of the core on it.
2. Phase 3: the catalog filled from the syncs and sent to the views.
3. **Stop and validate**: quickstart.md section 2 gives `equal` against the
   Electron build.

### Incremental Delivery

1. User Story 1: the same catalog at startup (MVP).
2. User Story 2: kept current, timed against the Electron build.
3. User Story 3: the remaining channels.
4. User Story 4: the web links' phases.
5. User Story 5: the startup and large-catalog figures.
6. Polish: the channel list and the gates.

---

## Notes

- [P] tasks touch different files and depend on no unfinished task.
- A task's "Done" note, added when it is checked, records what was done
  differently and why, as in `specs/007-main-foundation/tasks.md`.
- Commit after each task or group; stage file by file after reviewing
  `git status`.
- Scratch output of the measurements stays in `$TMPDIR`; remove the
  `workdir=` directories after reading them.

## Phase 9: Convergence

- [x] T046 CRITICAL: Run the check in the running application that Constitution V asks for, with the Electron build of `main` as the control: package `main` in a worktree outside the repository (`pnpm install`, `pnpm build`, `pnpm build:app:dir`); add the empty value to the `dump` case of `specs/008-main-catalog/measure-catalog.mjs` (an empty synced file, an empty synced folder, and a run with `syncKubeconfigEntries: []`); run `dump`, `changes` and `weblinks` with `ELECTRON_APP` set to that build, and record here what each showed, per Constitution V (partial) Done with `main` at 4b90c0940, packaged with `pnpm build:app:dir` in a worktree outside the repository (Turbo restored its outputs from the cache, for the same inputs); its bundle lacks `is-tauri-build-running`, which only the branch has. The Tauri build is the branch's, rebuilt after T049. `dump` gave `equal` twice: for the files and stores of before, to which an empty synced file and an empty synced folder were added, and for `syncKubeconfigEntries: []`, where neither build lists a cluster. `changes`, medians of five in ms, Electron then Tauri at the page and at the core's send: add-context 1028, 535, 532; remove-context 1031, 538, 536; add-file 1144, 537, 536; remove-file 166, 121, 119; no catalog missing a cluster in either build. `weblinks`: `available` for the served link and `unavailable` for the closed port in both, `equal`. Each mode printed `credentials: none found`, with the certificates and keys of T048 searched for.
- [x] T047 Compare across builds the answers of `get-all-clusters`, `get-cluster-by-id` (a known, an unknown and an empty id), `discover-kubeconfig-sync-kind` (a file, a folder, a link to each, a missing path), `add-kubeconfig-text` and the active flag after `cluster-visibility`: have `packages/core/src/main/catalog-sources/tauri-parity.test.ts` write the Electron build's answers into the `expected/` of the shared fixtures, and assert the same files in `freelens-tauri/src-tauri/tests/catalog.rs`, per SC-004 (partial) Done with a fixture case of its own, `channels`, whose `case.json` names the links to make, the paths to ask, the ids to ask and the visible clusters to send. The Vitest test calls the Electron build's own handlers (`get-all-clusters`, `get-cluster-info-by-id`, the listeners of `discover-kubeconfig-sync-kind`, `add-kubeconfig-text` and `cluster-visibility`) on the real files of the case, and writes their answers under `expected/channels/`; an unknown or empty id is written `null`. `every_fixture_gives_what_the_electron_build_gives` asks the core the same over `/ipc/` and passes on every file; with one name changed in `active.json` it fails.
- [x] T048 Add placeholder client certificates and keys (`client-certificate-data`, `client-key-data`, and a cluster's `certificate-authority-data`) to the kubeconfig files that `specs/008-main-catalog/measure-catalog.mjs` writes and to the shared fixtures, and search for them in the credential checks of the script and of `freelens-tauri/src-tauri/tests/catalog.rs`, per SC-008 (partial) Done. The script's kubeconfig files carry `certificate-authority-data`, `client-certificate-data` and `client-key-data`, and the script searches for each both as written and decoded. The `channels` fixture carries the same three fields; the cargo fixture test searches every log line and every answer of every case for the token and for `placeholder-` written and in base64 (`cGxhY2Vob2xkZXIt`). Nothing is found in either.
- [x] T049 Log at quit what the Electron build's `stop-kube-config-sync.injectable.ts` logs: `Catalog: stopping requested syncs`, then `Catalog: stopping sync of file/folder <path>` for each sync, with a test in `freelens-tauri/src-tauri/tests/catalog.rs`, per FR-022 (partial) Done. `Catalog::stop`, called on `RunEvent::Exit`, logs `Catalog: stopping requested syncs` and then `Catalog: stopping sync of file/folder <path>` for each running sync, in the order they started; the catalog keeps the paths each time it takes the syncs' clusters. `quitting_logs_each_sync_it_stops_as_the_electron_build_does` checks the lines; the Electron build's per-sync debug count is not logged, as the core logs no such count when a sync stops either.
- [x] T050 Settle the edge case "A synced file cannot be read" of `spec.md`, which says the catalog shows no cluster of it, against the core and the Electron build, which keep the clusters of a file read before and give none for a file never read (contracts/synced-files.md "Reading", step 2): align the spec's wording with the Electron build, or change the core if the wording is the intent, per spec Edge Cases (contradicts) Done by aligning the wording with the Electron build, whose read-error handler in `diff-changed-kubeconfig.injectable.ts` logs and leaves the file's source as it was: the edge case now says the clusters a file gave when it was last read stay, and a file never read gives none. The core and `a_file_that_cannot_be_read_keeps_its_clusters` already do that; no code changed.
- [x] T051 Record in `specs/008-main-catalog/plan.md`, "Technical Context" and the Constitution Check rows VII and VIII, the App Nap opt-out of `src/foundation/app_nap.rs`, the `Throttle` background policy of the main window and `objc2-foundation` as a direct dependency, which research R5 and R7 justify; and name the tool the measurement script drives the Electron build with (the inspector's WebSocket, not Playwright), per plan: Technical Context (unrequested) Done: Primary Dependencies names `objc2-foundation` and the inspector's WebSocket; Constraints the App Nap opt-out and the `Throttle` policy; rows VII and VIII and the source tree say the same.

## Phase 10: Convergence

- [x] T052 Bring `specs/008-main-catalog/quickstart.md` sections 2 and 4 and research R13 up to date with T046 to T048: the empty synced file and folder of the `dump` case, its second run with `syncKubeconfigEntries: []` and its `files:` and `empty-setting:` lines; the `channels` fixture case, whose `expected/channels/` holds the Electron build's answers of `get-all-clusters`, `get-cluster-by-id`, `discover-kubeconfig-sync-kind`, `add-kubeconfig-text` and the active flag after `cluster-visibility`, among the cases R13 lists; and the certificates and keys of the files, per plan: research R13 (partial) Done: quickstart section 2 describes the two runs of `dump` and their lines, section 4 the channels the fixtures compare; R13 the `channels` key of `case.json`, `expected/channels/`, the case's certificates and keys, and the credential search of the cargo test.
