# Implementation Plan: Main Catalog

**Branch**: `spec/tauri-port` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/008-main-catalog/spec.md`

## Summary

The core of the Tauri build keeps the catalog the way the Electron build's
main side does:

- it syncs the files and folders of the kubeconfig sync setting and the
  application's kubeconfig directory, with the Electron build's folder rules,
  ignore list, cluster ids and `file` label (research R4);
- it reads each synced file with the Electron build's size limits, encodings
  and loader rules, js-yaml's, Joi's and client-node's, reproduced over a
  generic YAML value, so that the same file gives the same clusters, and no
  error ever quotes the file (R3);
- it follows the files through FSEvents, which only wake a scan, and reads a
  file once it has been still for 500 ms, half the Electron build's wait, so
  that a change arrives sooner and a file is never read half written (R5);
- it shapes each cluster from the cluster store as the cluster manager does,
  without connecting anything, lists the web links and checks them, adds the
  general pages, and sends the whole catalog to the views, coalesced as the
  Electron build coalesces it (R1, R2, R6, R7, R9);
- it answers the eight channels of main-catalog (R6, R8), and becomes the one
  catalog the scheme, the frames, the local storage and the cluster clients
  ask (R10).

The Electron build changes in no production file. One Vitest test runs its
own sync code over fixtures that the cargo tests assert too (R13), and a
script measures both builds with the same steps (R12).

## Technical Context

**Language/Version**: Rust 1.98.1 for the core
(`freelens-tauri/src-tauri/rust-toolchain.toml`); TypeScript for the spike
page, the Vitest parity test and the measurement script

**Primary Dependencies**: one new crate, `notify` 8 with its default features
(FSEvents on macOS) and the crates it brings into `Cargo.lock` (R5).
`serde-saphyr`, already in `Cargo.lock` through kube, becomes a direct
dependency for the YAML of R3. Everything else is in the crate already:
`md-5`, `uuid`, `serde_json`, the connection code of
`src/foundation/download.rs` for the web link checks, kube's `Kubeconfig` for
the cluster clients. The Electron build adds no package; the measurement
script uses the Playwright that `specs/profile-main.mjs` uses.

**Storage**: the synced kubeconfig files, read only; the files
`add-kubeconfig-text` writes into `<data dir>/kubeconfigs/`; the cluster
store, written only through `Stores::update` of spec 007.

**Testing**: cargo unit tests per module of `src/catalog/`; `tests/catalog.rs`
(channels, syncs and timing on a temporary directory, the shared fixtures);
the existing cargo tests moved to a `Catalog` built from a fixture; the Vitest
`main/catalog-sources/tauri-parity.test.ts`; `measure-catalog.mjs` and
`measure.sh` for SC-002, SC-006 and SC-007; the manual comparison of
[quickstart.md](./quickstart.md).

**Target Platform**: the Tauri build on macOS arm64; the Electron build on its
existing platforms, which only gain a test.

**Project Type**: desktop application; a new module directory of the existing
Rust crate.

**Performance Goals**: a change that adds or removes a cluster reaches a view
no later than in the Electron build, which waits 1.0 to 1.1 s for a change and
150 ms for a removal (SC-002, R5); median startup at most 2.37 s with the
large catalog (SC-006); the large catalog reaches a view no later than in the
Electron build (SC-007).

**Constraints**: no error, log line or message carries the text of a
kubeconfig file or a credential (FR-014, R3, R11); no test or measurement
reads the user's own `~/.kube` or data directory; the Electron build changes
only by a test; no existing test is removed or weakened; the cluster store is
written only through `Stores`.

**Scale/Scope**: eight channels, `cluster-visibility` among them; the large catalog of 500 contexts; every
existing test of the area mapped to a cargo test (R14).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Status |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| VII. Tauri build             | Targets the Tauri build; the Electron build gains one Vitest test and keeps every file, channel and answer (FR-023), and its build, type check, unit, integration and knip checks run after the change. The Tauri build stays macOS arm64 only and lists no extension entity.                                                                                                                                                                                                                                                                                                                                                                                             | Pass   |
| VIII. Rust core              | A new module directory `src/catalog/` in the existing crate, replacing `src/catalog.rs`. One new crate, `notify`, with `Cargo.lock` committed (R5 records why). `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` gate it. No Node ships: the Vitest test and the measurement script run on the development machine and in the Electron build's CI only.                                                                                                                                                                                                                                                                                  | Pass   |
| II. Environments             | Rust core: every new module. Electron build: one test file under `main/`, out of both type-check programs. The spike page is in `freelens-tauri/ui`, outside `freelens/src` and `packages/core/src`, and uses no Node. The values the views see about the files come from the core over channels.                                                                                                                                                                                                                                                                                                                                                                         | Pass   |
| I. Dependency injection      | No injectable added, moved or renamed; `pnpm build:di` has nothing to regenerate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Pass   |
| III. Extension API           | No production file of the Electron build changes, so nothing `Common`, `Main` or `Renderer` reaches changes, `Main.Catalog` included. Checked against C1 to C15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass   |
| IV. Styling                  | The spike page keeps its markup and adds no stylesheet or class.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Pass   |
| V. Verified changes          | Cargo tests for each FR and each channel, the fixtures asserted by both builds (R13), the existing tests mapped one by one (R14). Surroundings: the empty value (an empty file, an empty folder, an empty setting, empty pasted text), the missing field (a context without `context`, a store entry without `labels`, a missing sync path), and a change while running (a context added while a view listens, a sync removed, a store entry renamed) are test cases; the comparison of quickstart.md repeats each step on the Electron build of `main` as the control. Comparators: none added; the catalog keeps the Electron build's source order rather than sorting. | Pass   |
| VI. Secrets and supply chain | No binary or pin changes. `notify` is a source dependency locked in `Cargo.lock`. Kubeconfig text is parsed with snippets off and never logged; the cluster clients alone read credentials; `add-kubeconfig-text` writes `0600`. The fixtures hold made-up servers and placeholder credentials only.                                                                                                                                                                                                                                                                                                                                                                      | Pass   |
| Conventions                  | New files get the single-line header; `src/catalog.rs`, a file of this port, keeps its own when it moves. The fixtures are data and are left out of Biome and Trunk, as the store fixtures are. Scratch output of the measurements goes to `$TMPDIR`. Nothing is added to `docs/`. The channel list's main-catalog rows are updated (FR-018).                                                                                                                                                                                                                                                                                                                             | Pass   |

Re-check after Phase 1 design: unchanged. The contracts add no Tauri command,
no capability and no extension surface; what the views see is the answers of
existing channels, and one new log line.

## Project Structure

### Documentation (this feature)

```text
specs/008-main-catalog/
├── spec.md
├── plan.md                       # this file
├── research.md                   # Phase 0
├── data-model.md                 # Phase 1
├── quickstart.md                 # Phase 1
├── contracts/                    # Phase 1
│   ├── catalog-entities.md       # the JSON of each entity on catalog:items
│   ├── catalog-channels.md       # the answer of each channel of main-catalog
│   ├── synced-files.md           # syncs, synced files, loader rules, ids, labels, timing
│   └── catalog-api.md            # Catalog, as the other core areas use it
├── measure-catalog.mjs           # written in implementation: SC-002 and SC-007 (R12)
├── checklists/
│   └── requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
freelens-tauri/src-tauri/
├── Cargo.toml                    # + notify; serde-saphyr becomes direct
├── src/
│   ├── lib.rs                    # stores, then the catalog; Core gains `catalog`
│   ├── options.rs                # --kubeconfig: an extra file sync for the run
│   ├── catalog/                  # replaces src/catalog.rs
│   │   ├── mod.rs                # Catalog: sources, order, dedupe, categories, on_change
│   │   ├── kubeconfig.rs         # size, encoding, YAML, Joi and client-node rules, split
│   │   ├── syncs.rs              # the syncs, folder rules, ignore list, ids, labels
│   │   ├── watch.rs              # FSEvents wake-ups, scans, stability and removal windows
│   │   ├── entities.rs           # cluster, web link and general entities; the store's part
│   │   ├── weblinks.rs           # the checks
│   │   └── channels.rs           # the eight channels; the coalesced sending
│   ├── clusters.rs               # a client from a cluster's own file and context
│   ├── frames.rs                 # asks the catalog whether a cluster exists
│   ├── foundation/
│   │   ├── mod.rs                # Setup takes the Catalog
│   │   └── local_storage.rs      # asks the catalog
│   ├── messaging/routes.rs       # view of a host: asks the catalog
│   ├── routes.rs                 # the same
│   └── scheme.rs                 # /api/clusters from the catalog
└── tests/
    ├── fixtures/catalog/         # new: shared with the Vitest parity test (R13)
    ├── catalog.rs                # new
    └── *.rs                      # build a Catalog from a fixture instead of Catalog::load

freelens-tauri/ui/src/renderer/catalog.ts                  # list from catalog:items, cluster-visibility, marks

packages/core/src/main/catalog-sources/tauri-parity.test.ts   # new (R13)

biome.jsonc, .trunk/trunk.yaml                             # leave tests/fixtures/catalog alone
specs/001-tauri-shell-spike/measure.sh                     # seeds the syncs of each run
specs/002-messaging-for-tauri/contracts/channel-list.md    # main-catalog rows (FR-018)
specs/baseline.md                                          # the figures of R12
```

**Structure Decision**: one module directory, `src/catalog/`, because every
part of the area serves one shared handle, as `src/stores/` does for the
stores. The watcher is a module of its own so that its timing can be tested
apart from the loader, and the loader so that the fixtures test it without a
file system.

### Implementation order

Risk first:

1. **The loader** (Tauri, Electron test): `kubeconfig.rs` and the fixtures,
   with the Vitest test that proves them against the Electron build's own
   code. A case that differs here reopens R3.
2. **The watcher** (Tauri): `syncs.rs` and `watch.rs` on a temporary
   directory, then a first run of `measure-catalog.mjs` for SC-002 and SC-003.
   A change slower than the Electron build's reopens R5.
3. **The catalog and its entities** (Tauri): `mod.rs`, `entities.rs`, the
   cluster store's part, the general pages and the web links, with the
   fixtures of R13 and the tests of R14.
4. **The channels** (Tauri): `channels.rs`, the coalesced sending, the
   enumeration, the sync kind, the pasted text.
5. **The rest of the core** (Tauri): frames, local storage, routes, scheme,
   cluster clients and options on the new handle; the spike page; the
   existing cargo tests moved over.
6. **The web link checks** (Tauri): `weblinks.rs` with a local server.
7. **Measurements and the channel list** (both): `measure.sh`, SC-006, SC-007,
   the figures in `specs/baseline.md`, the main-catalog rows (FR-018).

## Complexity Tracking

No violation to justify.
