# Implementation Plan: Main Foundation

**Branch**: `spec/tauri-port` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/007-main-foundation/spec.md`

## Summary

The core of the Tauri build learns to use the Electron build's data directory
the way the Electron build's main side does:

- it takes the data directory only when no build runs there, through a lock
  both builds read, with Chromium's own lock as the signal of an Electron
  build of any version (research R5);
- it loads the five stores, builds their models with the Electron build's
  rules, gives them to the views and writes them back with the bytes `conf`
  writes, atomically, keeping what it does not know and never lowering the
  recorded version (R1 to R4);
- it answers the other channels of main-foundation with the Electron build's
  answers and error strings: the paths, the machine values, the local storage
  files, the directory checks, the templates folder, the JSON download and
  the sync box (R6 to R9);
- it writes its log next to the Electron build's (R10), and shares the
  settings with the later areas of the core (R11).

The Electron build changes in one place: the runnable that takes its single
instance lock also refuses to start while the Tauri build holds the data
directory (R5). Parity is proven by one set of fixtures that a Vitest test of
the Electron build's own store code and the cargo tests of the core both
assert (R13).

## Technical Context

**Language/Version**: Rust 1.98.1 for the core
(`freelens-tauri/src-tauri/rust-toolchain.toml`); TypeScript for the Electron
build's lock check and the parity test

**Primary Dependencies**: no crate that `Cargo.lock` does not already have.
New direct dependencies at their locked versions: `libc` (`kill`),
`objc2-app-kit` with the `NSAlert` feature and `objc2-foundation` (the alert),
`hyper`, `hyper-util` with `client-legacy`, `client-proxy` and `http1`,
`hyper-rustls`, `rustls-platform-verifier` (the download),
`iana-time-zone` (`localeTimezone`) and `uuid` with `v4` (the default
hotbar). `serde_json` gains its `preserve_order` feature. The Electron build
adds no package.

**Storage**: the five store files, the local storage files and the lock link in
the data directory; the log file in the log directory. Formats in
[contracts/store-format.md](./contracts/store-format.md).

**Testing**: cargo unit tests per store module; `tests/stores.rs` (format,
corrupt files, versions, sync over the `/ipc/` routes, the parity fixtures),
`tests/foundation.rs` (every other channel), `tests/instance.rs` (the lock);
Vitest `tauri-parity.test.ts` and the lock check's test in the Electron build;
the startup measurement and the manual steps of
[quickstart.md](./quickstart.md).

**Target Platform**: the Tauri build on macOS arm64; the Electron build on its
existing platforms (the lock check runs on every platform, and only finds a
Tauri lock on macOS).

**Project Type**: desktop application; new modules of the existing Rust crate
and one injectable of the Electron build.

**Performance Goals**: median startup of three runs at most 2.37 s with a data
directory holding the five stores (SC-006); templates changes reach the views
within 2 seconds.

**Constraints**: the user's own data directory is never used by a test or a
measurement; nothing of the data directory is written before the lock is
held; the Electron build changes only by the lock check; no existing test is
removed or weakened; no new crate in `Cargo.lock`.

**Scale/Scope**: five stores (the largest seen is a cluster store of 150 KB),
15 channels, 17 path names, one Electron injectable.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Status |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| VII. Tauri build             | Targets both builds. The Electron build gains one injectable and one call in an existing runnable, and keeps every file, channel and answer (FR-020); its build, type check, unit, integration and knip checks run after it. The Tauri build stays macOS arm64 only and has no extension store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass   |
| VIII. Rust core              | New modules `src/stores/`, `src/foundation/`, `src/instance.rs` in the existing crate; no crate outside `Cargo.lock`; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`; `Cargo.lock` committed. No Node ships: the Vitest test runs in CI of the Electron build only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pass   |
| II. Environments             | The new Electron injectable is under `main/`; the parity test is a test file, out of both programs. No renderer or common file changes; the legacy lists are not touched.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Pass   |
| I. Dependency injection      | One injectable added in `main/electron-app/features/`, injected by the existing runnable; `pnpm build:di` regenerates the registration.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass   |
| III. Extension API           | Nothing `Common`, `Main` or `Renderer` reaches changes: the runnable and the new injectable are not exported, and the stores' behaviour in the Electron build is untouched. Checked against C1 to C15; C14 in particular, since the user store is readable through `Common.App.Preferences`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass   |
| IV. Styling                  | No stylesheet or `className`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass   |
| V. Verified changes          | Cargo tests for each FR of the stores, each channel with its refusals, the lock in both directions and with a stale link; the shared fixtures asserted by both builds (R13); the Electron build's suites. Surroundings: the empty value (an empty data directory, an empty templates folder, an empty proxy setting), the missing field (a preference absent, a cluster without `labels`), and a change while running (a view's change reaching the others, a template added while a view listens) are cases of the tests; a newer file is the case the Electron build itself does not cover. The manual steps of quickstart.md repeat the round trip with the Electron build on `main` as the control. Comparators: none added; the template list is sorted by path with a total order. | Pass   |
| VI. Secrets and supply chain | No binary or pin. The download refuses nothing the Electron build allows and adds no credential (FR-016). Fixtures hold no real kubeconfig or credential. The measurement and the tests never read the user's data directory; the lock check of the Electron build reads only a link's target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass   |
| Conventions                  | New files get the single-line header; the edited Electron runnable keeps its two-line header. No JSON file gets comments: the fixtures are data. Scratch output and the Electron probe go to `$TMPDIR`. Nothing is added to `docs/`. The channel list is updated as FR-018 asks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   |

Re-check after Phase 1 design: unchanged. The contracts add no Tauri command,
no capability, no Node use in a view and no extension surface; the one new
WebView-visible thing is the answers of existing channels.

## Project Structure

### Documentation (this feature)

```text
specs/007-main-foundation/
├── spec.md
├── plan.md                       # this file
├── research.md                   # Phase 0
├── data-model.md                 # Phase 1
├── quickstart.md                 # Phase 1
├── contracts/                    # Phase 1
│   ├── store-format.md           # the bytes of a store and of a local storage file
│   ├── foundation-channels.md    # the answer of each channel of main-foundation
│   ├── instance-lock.md          # the lock both builds read (FR-023)
│   └── stores-api.md             # Stores, as the later core areas use it
├── checklists/
│   └── requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
freelens-tauri/src-tauri/
├── Cargo.toml                    # direct dependencies of the Technical Context; serde_json preserve_order
├── src/
│   ├── lib.rs                    # data dir, lock, stores, then the channels; Core gains `stores`
│   ├── options.rs                # + --data-dir=<path>
│   ├── instance.rs               # new: the lock and the alert (contracts/instance-lock.md)
│   ├── stores/
│   │   ├── mod.rs                # new: Stores, initial values, store-sync (contracts/stores-api.md)
│   │   ├── file.rs               # new: read, write, backup, version (contracts/store-format.md)
│   │   ├── js_json.rs            # new: JSON.stringify's printing: key order, numbers, tabs
│   │   ├── user.rs               # new: preference descriptors, legacy theme keys
│   │   ├── hotbar.rs             # new
│   │   ├── favorites.rs          # new
│   │   ├── cluster.rs            # new: validation and projection only
│   │   └── weblinks.rs           # new
│   └── foundation/
│       ├── mod.rs                # new: registers the channels below
│       ├── paths.rs              # new: data directory, app-paths, machine-values
│       ├── local_storage.rs      # new
│       ├── directories.rs        # new: validate-directory, path-exists
│       ├── templates.rs          # new: the templates folder, polled
│       ├── download.rs           # new: download-json-channel
│       ├── sync_box.rs           # new
│       └── log_file.rs           # new: freelens-tauri.log and its rotation
└── tests/
    ├── fixtures/data-dir/        # new: shared with the Vitest parity test (R13)
    ├── stores.rs                 # new
    ├── foundation.rs             # new
    └── instance.rs               # new

packages/core/src/                                         # Electron build
├── main/electron-app/features/is-tauri-build-running.injectable.ts   # new
├── main/electron-app/runnables/enforce-single-application-instance.injectable.ts  # + the check
├── main/electron-app/runnables/enforce-single-application-instance.test.ts       # new
└── features/persistent-storage/main/tauri-parity.test.ts             # new (R13)

specs/002-messaging-for-tauri/contracts/channel-list.md    # main-foundation rows (FR-018)
specs/001-tauri-shell-spike/measure.sh                     # + MEASURE_DATA_DIR, a seed copied per run (SC-006)
```

**Structure Decision**: two module directories beside `messaging` and
`frames`, because the stores are shared by every later area and the other
channels are small and independent. The lock is a module of its own because
it runs before anything else and must not depend on the rest. The Electron
build gets the smallest change that gives FR-023 both directions.

### Implementation order

Risk first:

1. **The store file format** (Tauri): `js_json.rs` and `file.rs`, with the
   parity fixtures and the Vitest test that proves them against real `conf`.
   A byte that differs here reopens R1.
2. **The lock** (both): `instance.rs`, the alert, the Electron injectable and
   its test; checked by hand in both directions on the development machine.
   An alert that cannot show before Tauri starts reopens R5.
3. **The five models and the sync** (Tauri): the store modules, `Stores`,
   `persistent-storage-initial-values` and `store-sync-*`, with the fixtures of
   R13 and the ported tests of R14.
4. **The other channels** (Tauri): paths after the Electron probe, machine
   values, local storage, directories, sync box, then the templates and the
   download.
5. **The log and startup** (Tauri): `log_file.rs`, the order of `run()`, the
   measurement of SC-006.
6. **Channel list** (both): the main-foundation rows (FR-018).

## Complexity Tracking

No violation to justify.
