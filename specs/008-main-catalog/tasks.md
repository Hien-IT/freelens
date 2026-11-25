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

- [ ] T001 Record the baseline on the current commit, outside the repository, in the session's scratch directory: the names of the tests `cd freelens-tauri/src-tauri && cargo test -- --list` prints, and the summary of `pnpm test:unit` (test files and tests per project). Nothing is written in the repository. Why: FR-024 requires every existing test to pass unchanged, which T044 compares against.
- [ ] T002 Add to `core/Cargo.toml` the crate `notify` at its current 8.x release with its default features, and `serde-saphyr` at the version `core/Cargo.lock` already holds through kube. Run `cd freelens-tauri/src-tauri && cargo build && cargo test`. In `specs/008-main-catalog/research.md` R5, replace "Unverified until added" with what `cargo tree -e features -i notify` shows for the macOS backend, and list the packages `git diff core/Cargo.lock` adds. Record in R5 the latency and the flags `notify` passes to FSEvents; if that latency would let a removal reach the catalog more than 150 ms after the unlink, reopen R5 before T028. Why: the one new crate of plan.md; R5 depends on its backend being FSEvents, and SC-002's margin for a removal on its latency.
- [ ] T003 [P] Leave `freelens-tauri/src-tauri/tests/fixtures/catalog/**` out of Biome in `biome.jsonc` and out of Trunk in `.trunk/trunk.yaml`, next to the entries for `tests/fixtures/data-dir/` and with the same kind of comment. Why: the fixtures hold invalid YAML, UTF-16 files and invalid UTF-8 on purpose (research R13).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared handle of contracts/catalog-api.md, and the five
areas of research R10 asking it instead of the catalog of spec 001. Until
User Story 1 fills it from the syncs, the handle's only cluster source is the
file of `--kubeconfig`, read once, as spec 001 reads it, so the existing tests
keep their fixtures.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [ ] T004 [P] Write the unit tests in the `tests` module of `core/src/catalog/mod.rs` for the handle, porting `pc/main/catalog/__tests__/catalog-entity-registry.test.ts` (research R14): the entities in source order, web links, then general pages, then clusters (data-model.md `Catalog.entities`); an id given by two sources listed once, from the first; an entity whose group is not `entity.k8slens.dev` or whose kind is not `General`, `KubernetesCluster` or `WebLink` left out, whatever the version (research R1); `has_cluster` and `cluster` for a known, an unknown and an empty id; `subscribe` called with `ClusterChanged` and `ClusterRemoved` after a change, outside the lock; `Catalog::version` raised on every change (data-model.md `Catalog.version`).
- [ ] T005 Move `core/src/catalog.rs` to `core/src/catalog/mod.rs` with `git mv`, and give it the `Catalog`, `ClusterSource`, `CatalogEvent`, `LaunchFile`, `has_cluster`, `cluster`, `entities`, `subscribe`, `scanned` and `launch_file` of contracts/catalog-api.md, behind one lock and cheap to clone; keep the spike's reading of one file as a private source, built by `Catalog::from_kubeconfig_file`, so that the next tasks can move the callers before User Story 1 replaces it. Make T004 pass. Why: every story and every area of research R10 asks this handle.
- [ ] T006 Make the scheme's view of a host and the frame record ask the handle at the time of each request: `view_of` in `core/src/messaging/routes.rs` and `core/src/routes.rs` take `&Catalog` and call `has_cluster`; `core/src/frames.rs` keeps a `Catalog` instead of the `HashSet` of ids and checks the visible cluster with `has_cluster` when it is named. Why: FR-020; a cluster that leaves the catalog must be refused from then on (research R10).
- [ ] T007 Make the local storage files ask the handle: `Setup` in `core/src/foundation/mod.rs` takes a `Catalog` instead of the `HashSet`, and `core/src/foundation/local_storage.rs` refuses a cluster for which `has_cluster` is false at the time of the request. Why: FR-020 takes over FR-013 of spec 007.
- [ ] T008 Make the cluster clients read their own cluster's file: `core/src/clusters.rs` builds a client from `Catalog::cluster(id)`, reading the file of `ClusterSource.kubeconfig_path` with kube's `Kubeconfig::read_from` and selecting `ClusterSource.context_name`, and drops a cached client on `CatalogEvent::ClusterChanged` and `CatalogEvent::ClusterRemoved` for its id. `scheme::State` keeps a `Catalog`. `/api/clusters` in `core/src/scheme.rs` keeps its answer: it waits for the first scan of the launch sync (`Catalog::scanned`), then answers `clusters` from the cluster entities of `entities()` as `{ id, name }`, `source` as the file of `--kubeconfig`, `message` as the spike's notice for that file when it is missing or not a kubeconfig (`Catalog::launch_file`), and `openOnLoad` as the id of the context `--open-cluster` names in that file, or null. The frame page looks its cluster up with `cluster(id)`. Why: FR-020; the clients of spec 001 were all built from the one file, and the spike page's route keeps what `core/tests/scheme.rs` asserts (research R10).
- [ ] T009 In `core/src/lib.rs`, build the `Catalog` after the `Stores`, pass it to `register_core`, the frames, the foundation `Setup` and `scheme::State`, and add `catalog` to `Core`; move `core/tests/frames.rs`, `core/tests/foundation.rs`, `core/tests/messaging.rs`, `core/tests/scheme.rs`, `core/tests/stores.rs` and `core/tests/navigation.rs` from `Catalog::load` to `Catalog::from_kubeconfig_file` with the same fixtures. Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`: every test of T001 passes unchanged in what it asserts.

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

- [ ] T010 [P] [US1] Create the fixture cases of research R13 in `fixtures/`, one directory per case with `case.json` (the syncs, each a path relative to the case's `input/` and `file` or `folder`), `input/` (the synced files, and `lens-cluster-store.json` and `lens-weblink-store.json` when the case has them), `texts/` (pasted texts for `parse-kubeconfig-text`, where the case has them) and `expected/` (`entities.json`, `lens-cluster-store.json`, `parse/<text>.json`), with the temporary root written `<root>` and the home directory `<home>`. Cases: `valid-and-invalid-contexts`, `context-without-context`, `invalid-yaml`, `empty-file`, `duplicate-keys`, `merge-keys`, `yes-and-timestamp-names`, `duplicate-context-names`, `utf16le`, `utf16be`, `invalid-utf8`, `size-limits` (a folder's file of 2 MiB and one byte under, which `case.json` describes and the tests generate, so that no file of 2 MiB is committed), `store-entries` (name, icon `data:` and plain, short name, labels, metrics, metadata), `null-icon-and-short-name`, `no-store-entry`, `file-label` (inside and outside `<root>/data/kubeconfigs`, a path containing `<home>` twice), `two-syncs-one-file` (a file sync and the sync of its folder), and `weblinks`. Servers are made up and credentials are placeholders. `expected/` is written by T011 in its update mode.
- [ ] T011 [P] [US1] Write `pc/main/catalog-sources/tauri-parity.test.ts`, following `pc/features/persistent-storage/main/tauri-parity.test.ts`: for each case of `freelens-tauri/src-tauri/tests/fixtures/catalog/`, copy `input/` into a temporary directory and generate there the files its `case.json` describes, set `process.env.HOME` to a fixed path for the run (`compute-diff` calls `os.homedir()`), load the cluster and web link stores with real `conf`, inject `catalogEntityRegistryInjectable`, add the web link and general sources, and feed each synced file through the Electron build's own `diffChangedKubeconfig` with the path its sync's watcher would report (data-model.md `Synced file.path`); run `ClusterManager.init()` with the connection injectables overridden, wait until the registry is quiet, and assert `JSON.parse(JSON.stringify(toJS(registry.items)))`, the cluster store's model and `checkKubeconfigText` of each text against `expected/`, with `<root>` and `<home>` put back. With `UPDATE_TAURI_PARITY=1` it writes `expected/`. Why: research R13; the cases' `expected/` is the Electron build's behaviour.
- [ ] T012 [US1] Run T011 in update mode and review `expected/` against contracts/catalog-entities.md, contracts/synced-files.md and data-model.md; fix the contract or the data model where the Electron build differs, and note each difference in this task. Then run T011 without the variable: it passes.
- [ ] T013 [P] [US1] Write the unit tests of `core/src/catalog/kubeconfig.rs`, porting the cases of `pc/main/catalog-sources/kubeconfig-sync/diff-changed-kubeconfig.test.ts` and the `configsToModels` and `computeKubeconfigDiff` cases of `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts` (research R14): the size limits at and just under 2 MiB and 32 MiB (data-model.md `Synced file.limit`); UTF-16 LE and BE by byte order mark, the mark dropped, invalid UTF-8 refused; files in UTF-8 and UTF-16 LE that end inside a character skipped; CRLF line endings in UTF-8 and in UTF-16 LE read as they are; blank text; YAML with duplicate keys refused, merge keys expanded, `yes` a string, a timestamp-like name not a string; every rule and message of the schema table of contracts/synced-files.md "Loading", with failed entries dropped; `contexts[<i>].context is missing`; the split and the three validation errors; a duplicate context name giving one context (data-model.md `Context.context_name`); and, for every error, that its text does not contain a placeholder token or server of the input (FR-014).
- [ ] T014 [P] [US1] Write the unit tests of `core/src/catalog/syncs.rs`: the syncs in the order of data-model.md `Sync.origin`, with the setting's default for a release and a debug build read from a `Stores` model; the normalization of data-model.md `Sync.path` (backslash, `.`, `..`, trailing slash, repeated slashes, a leading `//`); the stat of data-model.md `Sync.kind`, a missing path skipped with a debug line and no warning (the "skips missing paths without warning" case of `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts`); a folder's files (data-model.md `Sync.files`, `Synced file.path`): direct entries only, a symbolic link to a file counted under its own path, a link to a folder and a subfolder not counted, every ignore rule of `pc/main/catalog-sources/kubeconfig-sync/watch-file-changes.test.ts` except the WSL one; the id of data-model.md `Context.id`, checked against the ids `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts` computes; an id kept by the first sync and file (the "should still only find a single entity" case); the `file` label rules of contracts/catalog-entities.md.
- [ ] T015 [P] [US1] Write the unit tests of `core/src/catalog/entities.rs`, porting `pc/main/cluster/update-entity-metadata.test.ts` (research R14): the four general pages and a web link exactly as contracts/catalog-entities.md writes them; a cluster from a context with no store entry, and one with each row of data-model.md "Cluster store entry" (`preferences.clusterName`, `preferences.iconShortName`, `preferences.icon`, `preferences.prometheus`, `preferences.prometheusProvider.type`, `labels`, `metadata`); `null` icon and short name cleared from the entity and from the entry; the entry a context with none gets, once per diff; `status.active` for the cluster of data-model.md `Catalog.visible`; no key with no value in the JSON.

### Implementation for User Story 1

- [ ] T016 [P] [US1] Create `core/src/catalog/kubeconfig.rs` with the pipeline of contracts/synced-files.md "Reading" and "Loading" over `serde-saphyr` with duplicate keys refused, merge keys expanded, strict booleans and no snippet (research R3), returning the valid contexts (data-model.md `Synced file.contexts`) and the log lines of research R11. Make T013 pass.
- [ ] T017 [P] [US1] Create `core/src/catalog/syncs.rs` with the syncs of contracts/synced-files.md "The syncs" and "The synced files" (data-model.md `Sync.path`, `Sync.origin`, `Sync.kind`, `Sync.files`), the cluster id (`md-5`, moved from the spike's `cluster_id`) and the `file` label, and a first scan that reads every synced file at once through T016. Create `<data dir>/kubeconfigs` when missing. Make T014 pass.
- [ ] T018 [P] [US1] Create `core/src/catalog/entities.rs` with the three kinds of contracts/catalog-entities.md, the cluster store's part of research R6 and the entries for new contexts as one `Stores::update` per diff (data-model.md `Entity`, `Context.file`). Make T015 pass.
- [ ] T019 [US1] Change `--kubeconfig` in `core/src/options.rs`: `--kubeconfig=<path>` becomes a file sync for the run, `--kubeconfig=none` and no option add nothing; add `--catalog-dump=<path>` (research R12), resolved against the working directory and refused when empty; with unit tests of the parse. Update `specs/001-tauri-shell-spike/contracts/launch-options.md` for both. Why: FR-021, and the default of spec 001, `~/.kube/config` read once, goes (research R10).
- [ ] T020 [US1] Fill the `Catalog` of `core/src/catalog/mod.rs` from T017 and T018: `Catalog::new` of contracts/catalog-api.md with the web links and general pages at once, `start` running the first scan on the async runtime, `scanned` resolving once every sync has had it and `launch_file` giving what the launch sync's read found, the clusters rebuilt on `Stores::on_change` for the cluster and web link stores; remove `from_kubeconfig_file` and move the tests of T009 to `Catalog::new` over a temporary data directory whose user store syncs the same fixture file. In `core/src/lib.rs`, call `start` after the window is built, so that the scan never delays it (research R12 of spec 007 and SC-006).
- [ ] T021 [P] [US1] Write `core/tests/catalog.rs`, first part, driving `messaging::routes::handle` as `core/tests/foundation.rs` does: `catalog:init` from a view gives every open view the whole catalog on `catalog:items`; the coalescing of contracts/catalog-channels.md "`catalog:items`" with paused time (a change at once; three changes 50 ms apart sent once, 100 ms after the last; nothing more when nothing changed after the first send); `cluster-visibility` marking a cluster active, an unknown id kept until it appears; a cluster frame that records its frame id on `cluster:set-frame-id` getting `catalog:items`; every case of `fixtures/` loaded through `Catalog::new` on a temporary copy giving `expected/entities.json` and `expected/lens-cluster-store.json` as JSON values; `--catalog-dump` writing the last catalog sent.
- [ ] T022 [US1] Create `core/src/catalog/channels.rs` with `register` of contracts/catalog-api.md for `catalog:init`, `catalog:items` with the coalescing and the log line `Catalog: sent <n> entities`, `cluster-visibility` (data-model.md `Catalog.visible`), the send of the catalog on each `FrameEvent::Announced` of `Frames`, through the coalescing (research R7), and the dump of `--catalog-dump`; register it in `register_core` of `core/src/lib.rs`, after `frames::register`, whose `Frames` it takes. Make T021 pass.
- [ ] T023 [US1] Change the spike page `ui/catalog.ts` to send `catalog:init` and render its list from the `KubernetesCluster` entities of `catalog:items`, to open the cluster whose id `openOnLoad` names once it appears in `catalog:items`, to send `cluster-visibility` beside `current-visible-cluster` when a frame is shown or hidden, and, with `?catalog-marks` in its URL, to post the mark `catalog-<n>` to `/mark` when it receives `n` entities; update `specs/001-tauri-shell-spike/contracts/scheme-routes.md` for `/api/clusters`. Why: research R10 and R12; the page is how the Tauri build shows the catalog until the renderer runs there.
- [ ] T024 [US1] Write `specs/008-main-catalog/measure-catalog.mjs`, with the single-line Freelens header, its common part and the mode `dump`: a temporary directory (printed as `workdir=`), the case of quickstart.md section 2 generated with made-up servers and placeholder credentials, a user store whose syncs name it; the Electron build started as `specs/profile-main.mjs` starts it, with a hook in main, through the inspector, that writes each `catalog:items` payload to a file; the Tauri build started with `--data-dir`, `--catalog-dump` and `?catalog-marks`; both read after 2 seconds without a send, compared as JSON values, and searched for the placeholder credentials (SC-008). Run it against the branch and against the Electron build of `main`: `equal` and `credentials: none found`.
- [ ] T025 [US1] Run the cargo gates of T009 in `freelens-tauri/src-tauri` and the Vitest test `pc/main/catalog-sources/tauri-parity.test.ts` of T011.

**Checkpoint**: User Story 1 works and is tested on its own; this is the MVP.

---

## Phase 4: User Story 2 - A change to a synced file reaches the catalog (Priority: P2)

**Goal**: the core follows the synced files and the sync setting while it
runs, no later than the Electron build, and never reads a file half written
(FR-009 to FR-012).

**Independent Test**: User Story 2's test of spec.md, as quickstart.md
section 3 runs it.

### Tests for User Story 2

- [ ] T026 [P] [US2] Write the unit tests of `core/src/catalog/watch.rs` with a clock and a stat source the test drives: a file read once its size, modification time and inode stayed the same for 500 ms (data-model.md `Synced file.identity`, `Synced file.stable_at`), a further change restarting the wait; a missing file removed only when still missing 100 ms later, and a change when back within that time (data-model.md `Synced file.missing_at`); the first scan reading at once; a read error keeping the file's contexts; an event under `/private/var` waking the sync of a path under `/var` (data-model.md `Sync.watches`); a dropped-events flag scanning every sync under its path.
- [ ] T027 [P] [US2] Write `core/tests/catalog.rs`, second part, on a real temporary directory with FSEvents, each step asserted on the next `catalog:items` within 3 seconds: a context added to and removed from a synced file; a context whose content changes keeping its id; a file added to and removed from a synced folder; a file replaced by a rename and rewritten in place, with no catalog in between missing a context present before and after; a symbolic link's target changed; a sync added and removed through `Stores::update` of the user store, the application's directory staying synced (the "runtime add / delete via manager", "directoryForKubeConfigs is always watched" and "fromStore() IPC-reload path" cases of `pc/main/catalog-sources/__test__/kubeconfig-sync.test.ts`); after a cluster leaves, `lens-local-storage:read` for it refused and its visible frame not recorded.

### Implementation for User Story 2

- [ ] T028 [US2] Create `core/src/catalog/watch.rs` with `notify`'s FSEvents watcher used only to wake scans (research R5), the windows of T026, a watch per symbolic link's target, and the matching of canonical event paths to syncs. Make T026 pass.
- [ ] T029 [US2] Connect the watcher in `core/src/catalog/syncs.rs` and `core/src/catalog/mod.rs`: each sync's watches started after its first scan, the syncs reconciled on `Stores::on_change` for the user store when the key set of `syncKubeconfigEntries` changes (a stopped sync's watches dropped and the clusters only it gave removed, the application's directory kept), and `CatalogEvent`s sent for every cluster added, changed or removed; log each sync started and stopped (research R11). Make T027 pass.
- [ ] T030 [US2] Add the mode `changes` to `specs/008-main-catalog/measure-catalog.mjs`: for each change of SC-002, five times per build, the time from the write returning to the Electron hook's send or the Tauri page's mark; then the 100 rewrites of SC-003, checking every catalog received; medians printed per build. Run it; record the medians in a new section "Catalog (spec 008)" of `specs/baseline.md`. A Tauri median above the Electron one reopens research R5.

**Checkpoint**: User Stories 1 and 2 work on their own.

---

## Phase 5: User Story 3 - The core answers every channel of main-catalog (Priority: P3)

**Goal**: the enumeration, the sync kind and the pasted kubeconfig text are
answered as the Electron build answers them (FR-015 to FR-017).

**Independent Test**: User Story 3's test of spec.md, as quickstart.md
section 4 lists it.

### Tests for User Story 3

- [ ] T031 [P] [US3] Write `core/tests/catalog.rs`, third part, porting `pc/features/cluster/enumeration/main/__tests__/handlers.test.ts`, `pc/main/cluster-enumeration/__tests__/cluster-enumeration.test.ts`, `pc/features/kubeconfig-sync-kind/kubeconfig-sync-kind.test.ts` and `pc/features/add-cluster/kubeconfig-text.test.ts` (research R14): `get-all-clusters` and `get-cluster-by-id` with the `ClusterInfo` of contracts/catalog-channels.md, every status mapping, labels without a value left out, `isActive` false, an unknown and an empty id answering no value, web links and general pages never in `get-all-clusters`, a context added to a synced file in the next answer of `get-all-clusters`, and `metadata` with and without a recorded distribution and version; `discover-kubeconfig-sync-kind` for a file, a folder, a link to each, a socket and a missing path, with Node's `ENOENT` text; `parse-kubeconfig-text` for each `texts/` file of `fixtures/` against `expected/parse/`, and no placeholder credential in any answer; `add-kubeconfig-text` writing one file of mode `0600` under a v4 uuid name in `<data dir>/kubeconfigs`, answering every context name, valid or not, and the valid contexts reaching `catalog:items`.

### Implementation for User Story 3

- [ ] T032 [US3] Add `get-all-clusters` and `get-cluster-by-id` to `core/src/catalog/channels.rs`, mapping the cluster entities as contracts/catalog-channels.md "`ClusterInfo`" says.
- [ ] T033 [US3] Add `discover-kubeconfig-sync-kind` to `core/src/catalog/channels.rs`, with Node's stat error texts of contracts/catalog-channels.md; reuse the errno texts of `core/src/foundation/directories.rs` if spec 007 already has them there, rather than a second table.
- [ ] T034 [US3] Add `parse-kubeconfig-text` and `add-kubeconfig-text` to `core/src/catalog/channels.rs` over T016, as contracts/catalog-channels.md says. Make T031 pass.

**Checkpoint**: User Stories 1 to 3 work on their own.

---

## Phase 6: User Story 4 - Web links show whether they can be reached (Priority: P4)

**Goal**: each web link of the catalog is checked as the Electron build checks
it (FR-019).

**Independent Test**: User Story 4's test of spec.md, as quickstart.md
section 5 runs it.

### Tests for User Story 4

- [ ] T035 [P] [US4] Write the unit tests of `core/src/catalog/weblinks.rs` with a local server and paused time, porting nothing (`pc/features/weblinks` has no test; research R14): a link `available` before its first check ends (data-model.md `Web link check.phase`); statuses 200, 302 followed to 200, 404 and 499 available, 500 and 503 unavailable, a closed port and a server that answers after 20 seconds unavailable; no proxy used even when the settings name one; the next check between 60 and 65 minutes after the last ended (data-model.md `Web link check.next_at`); a link removed from the store not checked again (data-model.md `Web link check.link`); the test's own authority passed as the tests of `core/src/foundation/download.rs` pass it.

### Implementation for User Story 4

- [ ] T036 [US4] Create `core/src/catalog/weblinks.rs` with the checks of research R9 over the connection code of `core/src/foundation/download.rs`, without its proxy, and update the web link entities' phase in `core/src/catalog/mod.rs` when a check ends. Make T035 pass.
- [ ] T037 [US4] Add the mode `weblinks` to `specs/008-main-catalog/measure-catalog.mjs` (a link served on `127.0.0.1`, one on a closed port, then one removed) and run it for both builds: the same phases, and the removed link gone.

**Checkpoint**: User Stories 1 to 4 work on their own.

---

## Phase 7: User Story 5 - Startup and a large catalog are as fast as in the Electron build (Priority: P5)

**Goal**: SC-006 and SC-007 are measured and met.

**Independent Test**: User Story 5's test of spec.md, as quickstart.md
sections 6 and 7 run it.

- [ ] T038 [US5] Add the modes `large-seed` and `large` to `specs/008-main-catalog/measure-catalog.mjs`: the large catalog of data-model.md "Large catalog" generated with made-up servers and placeholder tokens; `large-seed <dir>` writing the five stores, the files and a user store whose syncs name them under `__RUN_DIR__`; `large` timing, three times per build, a view's `catalog:init` to the whole catalog.
- [ ] T039 [US5] Change `specs/001-tauri-shell-spike/measure.sh`: after copying `MEASURE_DATA_DIR`, replace `__RUN_DIR__` in the copied user store with the run's directory; without `MEASURE_DATA_DIR`, write a user store with `syncKubeconfigEntries: []`, so that no `spike` run reads the user's `~/.kube` (research R10).
- [ ] T040 [US5] Build the Tauri build with `pnpm --filter @freelensapp/freelens-tauri tauri:build`, run quickstart.md sections 6 and 7, and record the startup median and both builds' medians of `large` in the section "Catalog (spec 008)" of `specs/baseline.md`. A startup above 2.37 s, or a Tauri `large` median above the Electron one, is profiled and fixed before this task is done.

**Checkpoint**: every user story works on its own.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: the channel list, the credential search, the gates of both
builds, and the manual comparison.

- [ ] T041 [P] Update `specs/002-messaging-for-tauri/contracts/channel-list.md`: each row of the section "main-catalog" names the core's handler (`src/catalog/channels.rs`), and the row of `cluster-visibility` moves there from "main-cluster-connection" with a note that main reads it only for the active flag (FR-018).
- [ ] T042 [P] Check that no log line of the core carries kubeconfig text: run `cargo test` with the fixtures of T010 and search the captured log of `core/tests/catalog.rs` for every placeholder token and server of the fixtures, and check that it holds the start and the stop of each sync; add both checks to `core/tests/catalog.rs` so that they stay (FR-014, FR-022, research R11).
- [ ] T043 Run every mode of `specs/008-main-catalog/measure-catalog.mjs` once more against the packaged builds: each prints `credentials: none found` (SC-008).
- [ ] T044 Run the gates of both builds: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`; `pnpm build`, `pnpm type:check`, `pnpm test:unit`, `pnpm knip:check`, `pnpm biome check` on the changed files and `trunk check`; and `pnpm test:integration` against a packaged Electron build of the branch. Compare with T001: no test removed, and every test passes (FR-024, SC-009).
- [ ] T045 Run `specs/008-main-catalog/quickstart.md` sections 2 to 5 with the Electron build of `main` as the control, as Principle V asks, and note in this task what each section showed.

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
