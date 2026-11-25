---
description: "Task list for spec 007: main foundation"
---

# Tasks: Main Foundation

**Input**: Design documents from `specs/007-main-foundation/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md

**Tests**: requested. FR-022 and SC-005 ask that the behaviour of the existing
tests of the area hold in tests of the core, SC-004 asks for a test of each
channel's answer, and research R13 proves parity with one set of fixtures
that the Electron build's own code and the core both assert. In each group, a
test task comes before the code it tests.

**Organization**: the phases follow the implementation order of plan.md, risk
first. The store file format (step 1) and the lock (step 2) are foundational,
because every story reads or writes the data directory; then User Story 1
(the five models and their sync, step 3), User Story 2 (broken and newer
files), User Story 3 (the other channels, step 4), User Story 4 (the log and
startup, step 5), and the channel list in the last phase (step 6). The
Electron probe of quickstart.md step 1 is in Setup, before any task that
encodes `app-paths`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an
  unfinished task)
- **[Story]**: the user story of spec.md the task belongs to
- A task that changes existing code says why.

## Path Conventions

- `core/` is `freelens-tauri/src-tauri/`: `core/src/…`, `core/tests/…`.
- `pc/` is `packages/core/src/`, the Electron build.
- `fixtures/` is `core/tests/fixtures/data-dir/`.
- Every command runs from the repository root unless it starts with `cd`.
- No test and no manual step uses the user's own data directory: each uses a
  temporary directory, `--data-dir`, or `FREELENS_INTEGRATION_TESTING_DIR`
  under `$TMPDIR`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: record what the later checks compare against, settle the values
research R6 marks Unverified, and add the dependencies of the plan.

- [x] T001 Record the baseline on the current commit, outside the repository: the names of the tests `cd freelens-tauri/src-tauri && cargo test -- --list` prints, to `$TMPDIR/007-baseline/cargo-tests.txt`, and the summary of `pnpm test:unit` (test files and tests per project), to `$TMPDIR/007-baseline/unit-tests.txt`. Nothing is written in the repository. Why: FR-021 requires every existing test to pass unchanged, which T055 compares against. Done: 99 cargo tests; `pnpm test:unit`: 589 test files passed, 7201 tests passed, 29 skipped. Kept in the session's scratch directory rather than `$TMPDIR`.
- [x] T002 Run the Electron probe of quickstart.md step 1 in `$TMPDIR/probe/` and copy its output into the table "app-paths" of `specs/007-main-foundation/contracts/foundation-channels.md`, replacing each "as the probe shows it" with the value, the home directory written as `~`, a name that throws written as `""`; mark the `getPath` values of research R6 Verified in `specs/007-main-foundation/research.md`. Why: T036 and T042 encode these values, and the plan's input asks that the probe come before them. Done with Electron 44.10.1. The probe sets `appData` to a temporary directory first, because Chromium creates `Crashpad` under `userData` as soon as the paths are read; quickstart.md now says so. `logs` is `~/Library/Logs/Freelens` in a development build too, `crashDumps` follows `userData`, `recent` throws, `temp` keeps its trailing `/`.
- [x] T003 Add to `core/Cargo.toml` the direct dependencies of plan.md's Technical Context, each at the version `core/Cargo.lock` already holds: `libc`, `objc2-foundation`, `objc2-app-kit` with the `NSAlert` feature, `hyper`, `hyper-util` with `client-legacy`, `client-proxy` and `http1`, `hyper-rustls`, `rustls-platform-verifier`, `iana-time-zone`, `uuid` with `v4`; and the `preserve_order` feature of `serde_json`. Run `cd freelens-tauri/src-tauri && cargo build && cargo test`, and check that `git diff core/Cargo.lock` adds no `[[package]]` entry, only dependency edges and features. Why: plan.md's constraint of no new crate; `preserve_order` changes key order for every `serde_json` map of the crate, so the existing tests must still pass before anything is built on it. Done differently: `rustls` and `http-body-util` are added too (the download needs both); `rustls`, `hyper-rustls` and the AppKit crates take no default features, because their defaults added six packages (`aws-lc-rs` among them); `serde_json` also gets `float_roundtrip` (T005). The AppKit crates were removed again by T011. `Cargo.lock` keeps its 505 packages; the 99 existing tests pass.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: steps 1 and 2 of the implementation order of plan.md. The bytes of
a store file are the riskiest part (research R1), and nothing of the data
directory may be written before the lock is held (research R5, FR-023).

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

### The store file format

- [x] T004 [P] Write the unit tests in the `tests` module of `core/src/stores/js_json.rs` for what contracts/store-format.md "A store file" specifies: tab indentation, `": "`, `{}` and `[]`, no trailing newline; array-index keys first in ascending order (`"2"` before `"10"`, `"01"` and `"4294967295"` are not indices and keep their place); other keys in insertion order; numbers `1e21` → `1e+21`, `1e-7`, `0.1`, `-0` → `0`, `2^53 + 1` printed as JavaScript prints it; strings with a control character (`\u001f`, lowercase), `\b \f \n \r \t`, non-ASCII and U+2028 left as they are; a key removed keeps the order of the others.
- [x] T005 Create `core/src/stores/js_json.rs` with `pub fn to_js_string(value: &serde_json::Value) -> String` and `pub fn remove_key(map: &mut serde_json::Map<String, Value>, key: &str)` (with `shift_remove`), over `serde_json`'s pretty printer with a tab indent and a formatter that writes numbers as JavaScript does (research R1). Add `pub mod stores;` to `core/src/lib.rs` and `core/src/stores/mod.rs` with `pub mod js_json;`. Make T004 pass. Done. `serde_json` needs its `float_roundtrip` feature: without it `123456789012345680000` reads one unit in the last place away from what `JSON.parse` reads (research R1).
- [x] T006 Write `core/tests/stores.rs`, first part, the file layer, with temporary directories: a missing file is written as the exact `__internal__` block of contracts/store-format.md and read as `{}`; a BOM is stripped; valid JSON that is not an object reads as `{}`; the version is set to `0.1.0` when absent, a range or lower, and a higher one is kept; a write leaves the bytes of `to_js_string`, keeps the mode of an existing file (`0644` stays `0644`), gives a new file `0666` less the umask, and leaves no `.tmp-` file after a success or after a rename that fails; merging a model replaces top-level keys in place, appends new ones, removes absent ones with the others' order kept, and keeps keys the model does not have (data-model.md `Store.path`, `Store.file`, and "Merging"); invalid JSON, an unreadable file and an unpaired surrogate escape each come back as a distinct load error, which T033 turns into the policy of User Story 2.
- [x] T007 Create `core/src/stores/file.rs` with the reading, version and atomic writing of contracts/store-format.md "Reading" (first four rows) and "Writing" (temporary name `<file>.tmp-<10 digits><6 hex>`, fsync, mode, rename, removal on failure), returning the load errors of T006 for the other rows. Make T006 pass. Done, with a JSON grammar check that tells a file JavaScript reads from an invalid one, and a version order that follows `semver`.

### The data directory and the lock

- [x] T008 [P] Write the unit tests in `core/src/foundation/paths.rs` for the data directory (data-model.md `Data directory.path`, `Data directory.app_name`): `--data-dir` wins; `FREELENS_INTEGRATION_TESTING_DIR` gives `<dir>/<app name>` wherever it points, as the Electron build's `userData` does, and an empty value is ignored; the default is `~/Library/Application Support/<app name>`, `Freelens` in a release build and `FreelensDev` in a debug build. The function takes the environment, the home directory and the build kind as arguments, so the tests set them. Done. Correction made first: the Electron build uses `<dir>/<app name>` whenever `FREELENS_INTEGRATION_TESTING_DIR` is set, not only under the temporary directory, because its `appData` follows the variable too; research R6 and data-model.md were fixed with it.
- [x] T009 Add `--data-dir=<path>` to `core/src/options.rs`, resolved against the working directory and refused when empty, as `--kubeconfig` is, with unit tests of the parse; create `core/src/foundation/mod.rs` and `core/src/foundation/paths.rs` with the data directory function; add `pub mod foundation;` to `core/src/lib.rs`. Make T008 pass. Why: measurements and tests need a data directory that is never the user's (research R6, R12). Done; `--data-dir` is also in `specs/001-tauri-shell-spike/contracts/launch-options.md`.
- [x] T010 [P] Write `core/tests/instance.rs` with one test per Tauri-build row of the table "Cases the tests cover" of contracts/instance-lock.md, in temporary directories: a live pid is a child process the test starts (`sleep 60`) and kills at the end, a dead pid is one of a child already reaped, another host is a target with a hostname that is not this one's, a data directory that cannot be written is a directory of mode `0555` (data-model.md `Instance lock.path`, `Instance lock.target`, `Instance lock.live`); a refusal writes nothing else in the directory and returns the build it names; the link is removed on drop only while it still names this process. The alert is a parameter of the refusal, so the tests record it rather than show it.
- [x] T011 Create `core/src/instance.rs` with `pub fn acquire(data_dir: &Path) -> Result<InstanceLock, Refusal>` following steps 1 to 3 and 5 of contracts/instance-lock.md, `Drop for InstanceLock`, and `Refusal::show_alert(&self)`, which shows the `NSAlert` of step 4 with its message and informative text, on the main thread, before Tauri starts. Add `pub mod instance;` to `core/src/lib.rs`. Make T010 pass. Done differently: the alert is `osascript`'s `display alert`, the texts passed as arguments of the script. `NSAlert`, run before Tauri sets the application up, returned at once without showing, even with the activation policy set and `finishLaunching` called (research R5, contracts/instance-lock.md); the AppKit crates were dropped with it.
- [x] T012 [P] Write `pc/main/electron-app/runnables/enforce-single-application-instance.test.ts` with the DI of the Electron build's unit tests, overriding `requestSingleInstanceLockInjectable`, `forceAppExitInjectable`, `showErrorPopupInjectable` and the new injectable's file and process reads: the lock not obtained → `forceAppExit` without the check and without a popup; obtained and no link → no exit; a live link → `showErrorPopup` with the title and text of contracts/instance-lock.md, then `forceAppExit`; a dead pid, a target that does not parse, a read error → no exit; another host → exit. Done; the parse and the liveness are a pure `isLiveTarget` tested on its own, and the runnable is tested with the injectable overridden. A read error is the injectable's `catch`, not tested on its own. A global override returns `undefined`, so the tests that start the application are unaffected.
- [x] T013 Create `pc/main/electron-app/features/is-tauri-build-running.injectable.ts`, which reads `<userData>/FreelensTauriLock` with `readlinkSync`, parses `<hostname>-<pid>`, and decides liveness with `os.hostname()` and `process.kill(pid, 0)` (`EPERM` counts as live) as contracts/instance-lock.md says; call it in `pc/main/electron-app/runnables/enforce-single-application-instance.injectable.ts` after `requestSingleInstanceLock()` returned true; run `pnpm build:di`. Make T012 pass. Why: the one change of FR-020 to the Electron build, so that it does not start while the Tauri build holds the data directory (FR-023).
- [x] T014 In `core/src/lib.rs` `run()`: resolve the data directory (T009), create it, and call `instance::acquire` before any other read or write of it (data-model.md `Data directory.lock`); on a refusal, log it, show the alert and exit with status 1; keep the `InstanceLock` until the process exits. Then check by hand steps 1 to 3 of quickstart.md section 5 on the development machine. Why: FR-023; an alert that cannot show before Tauri starts reopens research R5. Done: the link is removed on `RunEvent::Exit`, since the event loop ends the process without dropping the locals of `run()`. Checked by hand with the debug binary and `--data-dir`: with a live `SingletonLock` the core logs the refusal, shows the alert, waits until it is closed, exits with status 1 and writes nothing; without one the window loads and the link is made; a process killed leaves a stale link, which the next start replaces. Step 2 of quickstart.md section 5, the Electron build refusing while the Tauri build runs, needs a rebuilt Electron build and is left to T056; its logic is covered by T012.
- [x] T015 Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`, and `TZ=UTC pnpm exec vitest run -c vitest.config.ts packages/core/src/main/electron-app/runnables/enforce-single-application-instance.test.ts`.Done: 138 cargo tests pass (the 99 of T001 among them), clippy and fmt clean; the Electron test passes, and Biome is clean on the changed files.

**Checkpoint**: the core writes the bytes `conf` writes and holds its data
directory alone; every story can start.

---

## Phase 3: User Story 1 - The same settings and stores in both builds (Priority: P1) 🎯 MVP

**Goal**: the core loads the five stores from the Electron build's files,
gives the views the Electron build's models, and writes changes back with the
Electron build's bytes (FR-001 to FR-005, FR-010).

**Independent Test**: User Story 1's test of spec.md, as quickstart.md section 3
runs it: a data directory written by the Electron build round-trips through
the Tauri build with only the changed values different.

### Tests for User Story 1

- [x] T016 [P] [US1] Create the fixture cases of research R13 in `fixtures/`, each laid out as contracts/store-format.md "Fixtures" says: `empty`; `all-preferences`, with every key of data-model.md `User store.preferences` away from its default and a change of one; `legacy-theme`; `hotbars-pad-and-cut` and `hotbar-duplicates` (data-model.md `Hotbar store.hotbars`, `Hotbar store.activeHotbarId`); `favorites` (data-model.md `Favorites store.items`, `Favorites store.useShortNames`); `invalid-clusters` and `array-index-labels` (data-model.md `Cluster store.clusters`); `weblink-duplicates` (data-model.md `Web link store.weblinks`). Write `expected/` from data-model.md; T018 confirms it against the Electron build. No real kubeconfig, host name or credential goes into a fixture. Done differently: the cases are `empty`, `all-preferences`, `defaults-written`, `legacy-theme`, `hotbars-pad-and-cut`, `hotbar-duplicates`, `favorites`, `invalid-clusters`, `array-index-labels` and `weblink-duplicates`; `expected/` was written by T017 in its update mode rather than by hand, then reviewed (T018). Biome and Trunk leave `fixtures/` alone (`biome.jsonc`, `.trunk/trunk.yaml`), since the files are `conf`'s bytes.
- [x] T017 [P] [US1] Write `pc/features/persistent-storage/main/tauri-parity.test.ts`: for each case of `freelens-tauri/src-tauri/tests/fixtures/data-dir/` whose name does not start with `core-only-`, copy `input/` into a temporary directory, load the five stores with the Electron build's own storage injectables, overriding `getConfigurationFileModelInjectable` with `(options) => new Conf(options)` (real `conf`), the user data directory with the temporary one, the production flag with true and the home directory with a fixed path; assert each `toJSON()` against `expected/models.json` (the `Default` hotbar's id by shape); apply `change.json` through each store's `fromStore` and the real `persistStateToConfig`; assert each file's bytes against `expected/<config_name>.json`. `pnpm test:unit` already runs with `TZ=UTC`. Done. It runs with the root config, as `pnpm test:unit` does (`TZ=UTC pnpm exec vitest run -c vitest.config.ts …`): run inside `packages/core`, `getDiForUnitTesting` does not load. It restores the shared editor and terminal defaults after each case, because the Electron build's deep merge changes them in place. `UPDATE_TAURI_PARITY=1` writes `expected/`.
- [x] T018 [US1] Run T017 and correct `expected/` of the fixtures until it passes against the Electron build's own code, noting in this task each value that differed from data-model.md and fixing data-model.md where it was wrong. Why: from here on `expected/` is the Electron build's behaviour, which the cargo tests then assert (SC-001, SC-002). Done: `expected/` written by T017's update mode and reviewed. Nothing in data-model.md was wrong; it gained what the review showed: the defaults of a valid cluster, the place of a collapsed duplicate, and what a store keeps between two models.
- [x] T019 [P] [US1] Write the unit tests of `core/src/stores/user.rs`: each row of the table "Preferences" of data-model.md (`User store.preferences`), read and written; the cases of `pc/features/user-preferences/common/migrate-legacy-theme-preferences.test.ts`; the cases of `pc/features/user-preferences/sync-kubeconfig-entries-default.test.ts` for a production and a development build; `localeTimezone` with the time zone given as an argument. Done, with the cases of the two Electron tests and the order of sync entries read again.
- [x] T020 [P] [US1] Write the unit tests of `core/src/stores/hotbar.rs` for the load and normalization cases of `pc/features/hotbar/storage/storage-technical.test.ts`: the `Default` hotbar with the welcome and catalog items, 12 cells, padding and cutting, duplicate ids, the active id (data-model.md `Hotbar store.hotbars`, `Hotbar store.activeHotbarId`).
- [x] T021 [P] [US1] Write the unit tests of `core/src/stores/favorites.rs` for the load cases of `pc/features/favorites/storage-technical.test.ts` (data-model.md `Favorites store.items`, `Favorites store.useShortNames`).
- [x] T022 [P] [US1] Write the unit tests of `core/src/stores/cluster.rs` and `core/src/stores/weblinks.rs`: each validation rule and the projection (data-model.md `Cluster store.clusters`), an invalid model kept unless a valid one has its id, duplicate web link ids (data-model.md `Web link store.weblinks`).
- [x] T023 [US1] Extend `core/tests/stores.rs` with the store layer, driving `messaging::routes::handle` as `core/tests/messaging.rs` does: `persistent-storage-initial-values` answers the five stores with `configName`, `path` and `model` (contracts/foundation-channels.md "Stores"; data-model.md `Store.config_name`, `Store.model`); a model sent on `store-sync-main:<path>` from one view is written and sent on `store-sync-renderer:<path>` to every open view, the sender included; an equal model writes and sends nothing; a model that is not an object is logged and dropped; two views that send changes to the same store one right after the other both end with the last model, which the file holds; `Stores::update` and `Stores::on_change` behave as contracts/stores-api.md says; after every case the data directory holds no file but the five stores, the lock link and what the case put there, and a `lens-extensions.json` and an `installed-extensions.json` placed in it beforehand are byte for byte unchanged (FR-009); and every fixture case loads to `expected/models.json` and, after `change.json`, writes `expected/<config_name>.json`. Done; the second view is the frame of a cluster of `core/tests/fixtures/three-contexts.yaml`, because a host that names no cluster is refused before its message reaches the core.

### Implementation for User Story 1

- [x] T024 [P] [US1] Create `core/src/stores/user.rs` with `from_store`, `to_json` and the typed `Preferences` of contracts/stores-api.md, porting `pc/features/user-preferences/common/preference-descriptors.injectable.ts`, `pc/features/user-preferences/common/storage.injectable.ts` (the key order of `toJSON`) and `pc/features/user-preferences/common/migrate-legacy-theme-preferences.ts` (data-model.md `User store.preferences`); the time zone from `iana-time-zone`, honouring `TZ`. Make T019 pass. Done. `normalize` takes the model before, for the state the Electron build keeps between two reads (data-model.md, "What a store keeps between two models").
- [x] T025 [P] [US1] Create `core/src/stores/hotbar.rs`, porting `pc/features/hotbar/storage/common/storage.injectable.ts` and `toJSON` of `pc/features/hotbar/storage/common/hotbar.ts`, with the welcome and catalog entities' `uid`, `name` and `source` as `pc/common/catalog-entities/general-catalog-entities/implementations/` define them and a v4 uuid for the `Default` hotbar (data-model.md `Hotbar store.hotbars`, `Hotbar store.activeHotbarId`). Make T020 pass.
- [x] T026 [P] [US1] Create `core/src/stores/favorites.rs`, porting `pc/features/favorites/common/storage.injectable.ts` (data-model.md `Favorites store.items`, `Favorites store.useShortNames`). Make T021 pass.
- [x] T027 [P] [US1] Create `core/src/stores/cluster.rs` and `core/src/stores/weblinks.rs`, porting the validation of `pc/common/cluster-types.ts`, the load of `pc/features/cluster/storage/common/storage.injectable.ts`, `toJSON` of `pc/common/cluster/cluster.ts`, and `pc/features/weblinks/common/storage.injectable.ts` (data-model.md `Cluster store.clusters`, `Web link store.weblinks`); nothing that connects or syncs a cluster. Make T022 pass.
- [x] T028 [US1] Complete `core/src/stores/mod.rs` with `Stores` and `StoreName` of contracts/stores-api.md: load the five stores from the data directory (data-model.md `Store.config_name`, `Store.path`, `Store.file`, `Store.model`), merge and write a changed model (data-model.md "Merging"), `update`, `on_change`, and `pub fn register(channels: &mut Channels, stores: Stores)` for `persistent-storage-initial-values`, `store-sync-main:<path>` and `store-sync-renderer:<path>`, with the channel ids leaked once at startup (research R4). In `core/src/lib.rs`, load the stores after the lock, add `stores` to `Core`, and register the channels in `register_core`; `register_channels` keeps its signature with an empty temporary data directory, so that `core/tests/messaging.rs` stays unchanged. Make T023 pass. Why: every later area reads the settings through `Stores` (FR-010). Done differently for `register_core`: it takes the `Stores` as a parameter, and `core/tests/frames.rs` passes `Stores::in_memory`; `register_channels` keeps its signature with in-memory stores. `Machine::current` reads the home directory of the user database, as `os.userInfo()` does (`foundation::paths::user_home`).
- [x] T029 [US1] Run the cargo gates of T015 and `TZ=UTC pnpm exec vitest run -c vitest.config.ts packages/core/src/features/persistent-storage/main/tauri-parity.test.ts`;then run quickstart.md section 3 by hand, with the control on `main`. Done: 177 cargo tests, clippy and fmt clean; the parity test passes against the Electron build's own code. In place of the round trip by hand of quickstart.md section 3, a copy of the five stores of the Electron build on the development machine was loaded by the Tauri build without a change of a byte, and the user, cluster (150 KB) and hotbar stores, written again from their models, gave the same bytes; the favorites and web link stores, which the Electron build had never saved past their version, gained their default keys, as the Electron build's first save adds them. The round trip through both applications is left to T056.

**Checkpoint**: User Story 1 works and is tested on its own; this is the MVP.

---

## Phase 4: User Story 2 - A broken or newer file does not cost the user's setup (Priority: P2)

**Goal**: a damaged file is kept aside as the Electron build keeps it, a newer
file keeps its version and what the core does not know, and no write leaves a
part of a file (FR-005 to FR-008).

**Independent Test**: User Story 2's test of spec.md, as quickstart.md section 4
runs it.

### Tests for User Story 2

- [ ] T030 [P] [US2] Add the fixture cases `invalid-json` and `empty-file` (each with `expected/corrupt`), `newer-version` (version `9.0.0` and an unknown top-level key), and the core-only cases `core-only-unknown-preferences` and `core-only-unknown-cluster-keys` (research R3) to `fixtures/`; run T017, which must pass on the shared cases and skip the `core-only-` ones.
- [ ] T031 [US2] Extend `core/tests/stores.rs` with the rows of contracts/store-format.md "Reading" from the fifth on: the corrupt copy's name `<config_name>.corrupt-<milliseconds>.json` and its content, the reset file's bytes, a copy that fails in a read-only directory keeps the file and makes the store unwritable, an unreadable file (mode `000`) and an unpaired surrogate escape make it unwritable with the file unchanged (data-model.md `Store.writable`); an unwritable store still answers its model and sends changes to the views without writing; a failed write removes its `.tmp-` file, logs the line of contracts/store-format.md "Writing" and still sends the model; the other stores load as usual in each case; the version of a newer file is never lowered.
- [ ] T032 [US2] Add to `core/tests/stores.rs` the interruption test of FR-006: the test binary re-runs itself as a child, selected by an environment variable, that writes a store in a loop with alternating models; the parent kills it with `SIGKILL` at varying moments, twenty times, and each time the file parses and equals one of the two models.

### Implementation for User Story 2

- [ ] T033 [US2] In `core/src/stores/mod.rs` and `core/src/stores/file.rs`, apply the policy of contracts/store-format.md "Reading" to the load errors of T007: the backup copy, the reset, the unwritable store and its log lines (research R2). Make T031 and T032 pass.
- [ ] T034 [US2] In `core/src/stores/mod.rs`, keep the keys the model does not know inside `preferences` and inside each cluster matched by `id` when merging (data-model.md "Merging", research R3). Make the `core-only-` cases of T030 pass in `core/tests/stores.rs`.
- [ ] T035 [US2] Run the cargo gates of T015 and the Vitest test of T017; then run quickstart.md section 4 by hand.

**Checkpoint**: User Stories 1 and 2 both work; no file of the data directory
can be lost by the core.

---

## Phase 5: User Story 3 - The core answers every channel of main-foundation (Priority: P3)

**Goal**: the paths, the machine values, the local storage files, the
directory checks, the templates, the JSON download and the sync box are
answered as the Electron build answers them (FR-011 to FR-017).

**Independent Test**: User Story 3's test of spec.md: each channel, sent from a
view with the same input to both builds, gets the same answer, apart from the
paths FR-012 allows to differ.

### Tests for User Story 3

- [ ] T036 [P] [US3] Extend the unit tests of `core/src/foundation/paths.rs`: `app-paths` answers the 17 names with the values recorded by T002 in contracts/foundation-channels.md, `appData` replaced by `FREELENS_INTEGRATION_TESTING_DIR` when set and `userData` following it (data-model.md `Data directory.path`); `machine-values` gives each field of the table of contracts/foundation-channels.md, `DEBUG` with each accepted value and a refused one, the integration-testing home under the temporary directory and not elsewhere, `kubeDirectory` unaffected by it. The home directory, the environment and the bundle paths are arguments. Depends on T002.
- [ ] T037 [P] [US3] Write `core/tests/foundation.rs`, local storage part, over the `/ipc/` routes with the fixture kubeconfig `core/tests/fixtures/three-contexts.yaml`: the files `lens-local-storage/app.json` and `lens-local-storage/<clusterId>.json`; `{}` for a missing, invalid, unreadable or non-object file, an array passed through; a write's bytes (two spaces, trailing newline), mode `0600`, directory `0700`; the refusal text of contracts/foundation-channels.md for an unknown and for an empty `clusterId`, on both channels (data-model.md `Local storage file`).
- [ ] T038 [P] [US3] Extend `core/tests/foundation.rs` with the directories: each `validate-directory` error of contracts/foundation-channels.md, the errno mapping tested on synthetic `io::Error` codes for those a test cannot provoke (`ENAMETOOLONG` aside, which a long path provokes) and `error: undefined` for an unnamed one; `~` and `~/` resolved, `~/foo` taken as it is; `path-exists` true for a file and a directory, false for a missing path and a broken link.
- [ ] T039 [P] [US3] Extend `core/tests/foundation.rs` with the templates, under a temporary home and a poll interval the test sets: the first answer, the groups and options (data-model.md `Template.group`, `Template.label`, `Template.value`) sorted by path, `.YAML` not counted, a folder that appears later, a folder removed while watched (an empty list, then the templates again when it comes back), an update within two intervals after a file is added, changed and removed, no update when nothing changed, a symbolic link loop walked once.
- [ ] T040 [P] [US3] Extend `core/tests/foundation.rs` with the download against a local server the test starts on `127.0.0.1`: a JSON body is answered; `404` gives `404: Not Found`; a body that is not JSON gives an error; a `timeout` gives `Operation timed out: timeout <duration>` with the duration as `formatDuration` of `@freelensapp/utilities` writes it for 1 500 ms and 150 000 ms; `httpsProxy` `ftp://x` gives the unsupported-scheme error; no request carries a cookie or an `Authorization` header. Then the cases of `pc/main/fetch/https-agent.test.ts` and `pc/main/fetch/https-proxy-agent.test.ts` (research R14), with a TLS server, an `http:` proxy, an `https:` proxy and a SOCKS5 proxy the test starts, and a self-signed certificate the test makes with `openssl req -x509 -newkey ec` in a temporary directory, never in the repository: the server behind each proxy is reached and trusted when the client is given that certificate as its authority; it is refused when the client trusts other authorities and `allowUntrustedCAs` is off, and reached when it is on; the `https:` proxy is spoken to in TLS and the SOCKS5 proxy in plain text; each proxy records the request.
- [ ] T041 [P] [US3] Extend `core/tests/foundation.rs` with the sync box: `sync-box-initial-value-channel` answers `[]`, and a message on `sync-box-channel` is accepted and sends nothing.

### Implementation for User Story 3

- [ ] T042 [US3] Add the `app-paths` and `machine-values` answers to `core/src/foundation/paths.rs`, with the values T002 recorded and the Tauri build's own executable, resources and bundled helm (FR-012). Make T036 pass.
- [ ] T043 [P] [US3] Create `core/src/foundation/local_storage.rs`, writing as contracts/store-format.md "A local storage file" says and checking clusters against the core's catalog. Make T037 pass.
- [ ] T044 [P] [US3] Create `core/src/foundation/directories.rs` with `validate-directory`, `path-exists` and the resolution of `~` of contracts/foundation-channels.md. Make T038 pass.
- [ ] T045 [P] [US3] Create `core/src/foundation/templates.rs`: the poll of research R8, started by the first request, sending `user-resource-templates-update` to every view when the list changes. Make T039 pass.
- [ ] T046 [P] [US3] Create `core/src/foundation/download.rs`: the client of research R9 built from `Stores::preferences()` (`httpsProxy`, `allowUntrustedCAs`), rebuilt when either changes, with the trusted authorities as a parameter (the system's through `rustls-platform-verifier` in the application, a test's own in T040), and the answers and error strings of contracts/foundation-channels.md. Make T040 pass.
- [ ] T047 [P] [US3] Create `core/src/foundation/sync_box.rs`. Make T041 pass.
- [ ] T048 [US3] In `core/src/foundation/mod.rs`, register the channels of T042 to T047, and call it from `register_core` in `core/src/lib.rs`; run the cargo gates of T015 and quickstart.md section 6 by hand.

**Checkpoint**: every channel of main-foundation is answered by the core.

---

## Phase 6: User Story 4 - The Tauri build starts as fast as the Electron build (Priority: P4)

**Goal**: the log next to the Electron build's (FR-019), and a startup at most
2.37 s with the five stores loaded (SC-006). The log is here because it opens
at startup, in the order research R12 fixes.

**Independent Test**: User Story 4's test of spec.md, as quickstart.md section 7
runs it.

### Tests for User Story 4

- [ ] T049 [P] [US4] Write the unit tests of `core/src/foundation/log_file.rs` (data-model.md `Log file`): a line is `<level>: <message>`; a line with `error: ` or `warn: ` is written as it is, any other gets `info: `; at 1 MiB the file rotates with `tailable` naming, `freelens-tauri.log` always the newest and `freelens-tauri15.log` the oldest kept; a directory that cannot be written leaves standard output working.

### Implementation for User Story 4

- [ ] T050 [US4] Create `core/src/foundation/log_file.rs`, and in `core/src/lib.rs` make the core's `Log` write each line to standard output, as today, and to the log file in the `logs` directory of `app-paths`. Make T049 pass. Why: the checks of specs 002 and 004 read standard output, which must not change (research R10).
- [ ] T051 [US4] Order `run()` in `core/src/lib.rs` as research R12 says: data directory, lock, log, stores, channels, window, with nothing else of this feature before the window and the templates folder untouched until a view asks.
- [ ] T052 [US4] Add the `MEASURE_DATA_DIR` variable to `specs/001-tauri-shell-spike/measure.sh`: when set, each run copies that directory into a fresh temporary one and passes it with `--data-dir`; when unset, the script measures as before. Run quickstart.md section 7 with a seed holding the five stores of quickstart.md section 3, and record the three runs and the median next to the figures of spec 001 in `specs/baseline.md`.

**Checkpoint**: all four stories work.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: step 6 of the implementation order of plan.md, and the gates.

- [ ] T053 Update the main-foundation rows of `specs/002-messaging-for-tauri/contracts/channel-list.md`: each says that the core answers it and names the module of `core/src/` that does, in the columns the list requires (FR-018, SC-004).
- [ ] T054 [P] Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`, and `pnpm biome check` and `trunk check` on the changed files.
- [ ] T055 Run the Electron build's gates: `pnpm build:di`, `pnpm build`, `pnpm type:check`, `pnpm test:unit`, `pnpm test:integration` and `pnpm knip:check`; compare the test names and counts with T001 and confirm that no test was removed or weakened and that the only new tests are those of T012 and T017 (SC-007, FR-021).
- [ ] T056 Run quickstart.md sections 3 to 6 once more on the finished branch, with the Electron build on `main` as the control where the section says so, and note in this task what each showed (SC-001 to SC-004, SC-008).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none. T002 blocks T036 and T042; T003 blocks every Rust task.
- **Foundational (Phase 2)**: depends on Setup; blocks every story.
- **User Story 1 (Phase 3)**: depends on Foundational.
- **User Story 2 (Phase 4)**: depends on User Story 1 (it extends the load and the merge of `Stores`).
- **User Story 3 (Phase 5)**: depends on Foundational; T046 needs `Stores::preferences()` of T028; the other tasks need only the channels.
- **User Story 4 (Phase 6)**: depends on User Story 1 (the stores to load) and T042 (the `logs` path).
- **Polish (Phase 7)**: depends on every story.

### Within Each Story

- A test task comes before the code it tests, and fails before it.
- In User Story 1, T016 to T018 come before the cargo assertions of T023 use
  `expected/`.
- The store modules (T024 to T027) come before `Stores` (T028).

### Parallel Opportunities

- T004, T008, T010 and T012 are in different files and can run together.
- In User Story 1, T016, T017 and T019 to T022 can run together, then T024 to
  T027.
- In User Story 3, T036 to T041 can run together, then T043 to T047.
- User Story 3 can run beside User Story 2 once User Story 1 is done.

---

## Parallel Example: User Story 1

```bash
# The tests and fixtures together:
Task: "Create the fixture cases of research R13 in fixtures/"
Task: "Write pc/features/persistent-storage/main/tauri-parity.test.ts"
Task: "Write the unit tests of core/src/stores/user.rs"
Task: "Write the unit tests of core/src/stores/hotbar.rs"

# Then the store modules together:
Task: "Create core/src/stores/user.rs"
Task: "Create core/src/stores/hotbar.rs"
Task: "Create core/src/stores/favorites.rs"
Task: "Create core/src/stores/cluster.rs and core/src/stores/weblinks.rs"
```

## Parallel Example: User Story 3

```bash
Task: "Create core/src/foundation/local_storage.rs"
Task: "Create core/src/foundation/directories.rs"
Task: "Create core/src/foundation/templates.rs"
Task: "Create core/src/foundation/download.rs"
Task: "Create core/src/foundation/sync_box.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 and Phase 2: the format and the lock, the riskiest parts.
2. Phase 3: the five stores round-trip with the Electron build.
3. Stop and validate with quickstart.md section 3.

### Incremental Delivery

1. Setup and Foundational: the core writes `conf`'s bytes and holds its data
   directory alone.
2. User Story 1: the stores in both builds (MVP).
3. User Story 2: no file lost to a crash or a newer build.
4. User Story 3: the renderer's other start-up channels answered.
5. User Story 4: the log, and the startup measured.
6. Polish: the channel list and the gates of both builds.

---

## Notes

- [P] tasks = different files, no dependency on an unfinished task.
- Commit after each task or logical group.
- Scratch output goes to `$TMPDIR`, never into the working tree.
