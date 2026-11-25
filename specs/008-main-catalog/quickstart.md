# Quickstart: Main Catalog

How to check that the feature works. Every run uses a temporary data
directory and temporary kubeconfig files with made-up servers; nothing here
reads the user's own `~/.kube` or data directory. Run from the repository
root.

## Prerequisites

- The Electron build packaged from the branch, `freelens/dist/mac-arm64/Freelens.app`
  (`pnpm build && pnpm build:app:dir`), and the Electron build of `main`
  packaged the same way for the controls.
- The Tauri build: `pnpm --filter @freelensapp/freelens-tauri tauri:build`.
- `specs/008-main-catalog/measure-catalog.mjs`, written in implementation
  (research R12). It creates its own temporary directory, prints its path as
  `workdir=`, and leaves it for inspection; remove it afterwards.

## 1. Tests

```bash
cd freelens-tauri/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

```bash
pnpm --filter @freelensapp/core exec vitest run src/main/catalog-sources/tauri-parity.test.ts
```

Expected: every test passes. The Vitest test and `tests/catalog.rs` assert the
same `expected/` files of `freelens-tauri/src-tauri/tests/fixtures/catalog/`
(research R13). To write those files again from the Electron build's code,
after a reviewed change of a case:

```bash
UPDATE_TAURI_PARITY=1 pnpm --filter @freelensapp/core exec vitest run src/main/catalog-sources/tauri-parity.test.ts
```

## 2. The same catalog in both builds (SC-001, Story 1)

```bash
node specs/008-main-catalog/measure-catalog.mjs dump
```

The script builds one data directory with the five stores, renamed clusters,
icons, labels and web links, and syncs of a file and of a folder holding
valid and invalid contexts, an ignored name, a file over 2 MiB, a UTF-16
file, a symbolic link and a subfolder. It starts each build on a copy, waits
until the catalog has been quiet for 2 seconds, and writes the last catalog
each sent to `electron.json` and `tauri.json`.

Expected: the two files are equal as JSON values; the script prints
`equal`. Repeat with the Electron build of `main`: the same.

## 3. Changes reach the catalog (SC-002, SC-003, Story 2)

```bash
node specs/008-main-catalog/measure-catalog.mjs changes
```

For each change of Story 2, five times per build: a context added to a synced
file, a context removed, a file added to the synced folder, a file removed,
a sync added in the settings. Then 100 rewrites of a synced file, half in
place and half by replacing it.

Expected: for each change the Tauri median is no higher than the Electron
median; the script prints both. No catalog received during the rewrites lacks
a cluster the file holds before and after. Record the medians in
`specs/baseline.md`.

## 4. The channels (SC-004, Story 3)

`tests/catalog.rs` sends each channel through the `/ipc/` routes, as
`tests/foundation.rs` does for spec 007, and checks the answers of
[contracts/catalog-channels.md](./contracts/catalog-channels.md). The answers
of `parse-kubeconfig-text` are also the Electron build's own, through the
fixtures of section 1. Among the cases:

1. `parse-kubeconfig-text` with each fixture text: the names and errors of the
   contract, and no value of the text in the answer.
2. `add-kubeconfig-text`: a file with mode `0600` in `<data dir>/kubeconfigs/`,
   and its contexts in the next `catalog:items`.
3. `discover-kubeconfig-sync-kind` with a file, a folder, a symbolic link to
   each and a missing path: `file`, `dir`, `file`, `dir`, and the `ENOENT`
   error.
4. `get-all-clusters` and `get-cluster-by-id` with a known id, an unknown one
   and an empty one.

## 5. Web links (Story 4)

```bash
node specs/008-main-catalog/measure-catalog.mjs weblinks
```

The script serves one link on `127.0.0.1` and names another on a closed port.

Expected: in both builds the first is `available` and the second
`unavailable` once the first checks end; removing a link from the store
removes it from the catalog and stops its checks.

## 6. Startup (SC-006, Story 5)

```bash
node specs/008-main-catalog/measure-catalog.mjs large-seed "${TMPDIR%/}/catalog-seed"
```

```bash
MEASURE_DATA_DIR="${TMPDIR%/}/catalog-seed" specs/001-tauri-shell-spike/measure.sh spike "$PWD/freelens-tauri/src-tauri/target/release/bundle/dmg/Freelens Spike_0.1.0_aarch64.dmg" 3 60
```

The seed holds the five stores, the large catalog's files, and a user store
whose syncs name them under the placeholder `__RUN_DIR__`, which `measure.sh`
replaces with each run's directory.

Expected: median startup at most 2.37 s. Record it in `specs/baseline.md`.

## 7. The large catalog (SC-007, Story 5)

```bash
node specs/008-main-catalog/measure-catalog.mjs large
```

Expected: three runs per build; the Tauri median from a view's `catalog:init`
to the whole catalog is no higher than the Electron median. Record both in
`specs/baseline.md`.

## 8. Credentials (SC-008)

Every mode of the script searches what each build sent on the channels of
main-catalog for the placeholder tokens, certificates and keys of its
kubeconfig files.

Expected: `credentials: none found` for every mode.

## 9. Channel list

The rows of the section "main-catalog" of
`specs/002-messaging-for-tauri/contracts/channel-list.md` name the core's
handlers, and `cluster-visibility` has moved there from
main-cluster-connection (FR-018).
