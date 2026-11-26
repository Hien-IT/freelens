# Implementation Plan: Main Cluster Connection

**Branch**: `spec/tauri-port` | **Date**: 2026-11-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/009-main-cluster-connection/spec.md`

## Summary

The core of the Tauri build connects the clusters of the catalog and carries
their API to the cluster frames, as the Electron build's main side does with
freelens-k8s-proxy, and without it:

- one `kube::Client` per cluster, built from the cluster's own kubeconfig file
  and context, with kube's proxy and OIDC features on, no retries and the
  Electron build's limits per request (research R2);
- the credential plugins run by the core itself, once per cluster at a time,
  with the environment of the user's login shell, killed on a disconnect and on
  quit (R3), and the shell sync that gives that environment, ported from the
  Electron build without holding the window back (R4);
- the connection's steps, messages, status classification, backoff, timers,
  accessibility and metadata, as the Electron build's `ClusterConnection` and
  detectors have them (R5, R6, R7), with the phase of each cluster entity and
  the cluster state sent to the views (R8);
- the `/api-kube/` route for every method, with the Electron build's header,
  status, redirect and inactivity rules (R9), and the watches carried over the
  view's message queue of spec 002, which the scheme cannot stream (R10);
- disconnecting, deleting, the delete dialog's kubeconfig edits under the
  Electron build's lock, `execute-on-cluster`, and the other channels of the
  area (R11 to R14);
- the Tauri build's own catalog and frame pages, which connect, browse, watch,
  disconnect and delete as FR-029 asks, and run the measured scenario (R15).

The Electron build changes in no production file. A Vitest test runs its own
connection code over fixtures that the cargo tests assert too (R18), and a
script measures both builds with the same steps (R17).

## Technical Context

**Language/Version**: Rust 1.98.1 for the core
(`freelens-tauri/src-tauri/rust-toolchain.toml`); TypeScript for the Tauri
build's own pages, the Vitest parity test and the measurement script

**Primary Dependencies**: no crate new to `Cargo.lock`. kube 5.1.0 gains its
`http-proxy`, `socks5` and `oidc` features, whose dependencies are in
`Cargo.lock` already (R2); tokio gains its `process` feature (its
`signal-hook-registry` is in `Cargo.lock`); `sha2` 0.10.9 becomes a direct
dependency for the cluster id detector (R7). `libc` (process groups, `setsid`),
`objc2-foundation` (the locale of `LANG`), `serde-saphyr` (the kubeconfig
edits) and the catalog's loader of spec 008 are in the crate already. The
Electron build adds no package; the measurement script uses Playwright as
`specs/profile-main.mjs` does.

**Storage**: the cluster store, written only through `Stores::update` of spec
007 (metadata and deleted entries); the local storage files of spec 007,
removed on delete; the user's kubeconfig files, edited only by
`remove-cluster-context-from-kubeconfig` under the lock of R12.

**Testing**: cargo unit tests per module of `src/cluster/` and
`src/foundation/shell_env.rs`; `tests/cluster.rs`, `tests/api_kube.rs` and
`tests/shell_env.rs` against a fake API server over HTTP and TLS made at test
time; the shared fixtures of `tests/fixtures/cluster/` with the Vitest
`main/cluster/tauri-parity.test.ts`; `measure-connection.mjs` for SC-001 to
SC-006, SC-010, SC-011 and SC-013; the manual comparison of
[quickstart.md](./quickstart.md).

**Target Platform**: the Tauri build on macOS arm64; the Electron build on its
existing platforms, which only gain a test.

**Project Type**: desktop application; a new module directory of the existing
Rust crate, and the Tauri build's own pages.

**Performance Goals**: on the kind cluster, median time to the sidebar from
the click or the end of the shell sync, whichever is later, and from clicking
Pods to the first Pod row, no longer than the Electron build's; median CPU of the core over the 60 s of the scenario
no higher than the Electron build's main process (SC-002 to SC-004); a pod's
change reaching its list no later than in the Electron build (SC-005); the
first row of 3000 ConfigMaps recorded for both (SC-006).

**Constraints**: only the core holds credentials: no message, answer, log line
or dump carries one, nor a plugin's output or the shell's environment (FR-007,
R16); no local network port and no freelens-k8s-proxy (FR-018); no test or
measurement reads the user's own `~/.kube` or data directory; the Electron
build changes only by a test; no existing test is removed or weakened; the
cluster store is written only through `Stores`.

**Scale/Scope**: the sixteen channels of main-cluster-connection,
`shell-sync-failed-channel` among them, and four watch channels of the Tauri
build; every existing test of the area mapped to a cargo test (R19).

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| VII. Tauri build             | Targets the Tauri build; the Electron build gains one Vitest test and keeps every file, channel and answer, freelens-k8s-proxy included (FR-030), and its build, type check, unit, integration and knip checks run after the change. The Tauri build stays macOS arm64 only and gains no extension surface; `execute-on-cluster`, whose only sender is the Electron build's extension API, is answered for completeness of the channel list.                                                                                                                                                                                                                                                                                                                          | Pass   |
| VIII. Rust core              | A new module directory `src/cluster/`, replacing `src/clusters.rs`, and `src/foundation/shell_env.rs`. No crate new to `Cargo.lock`, which is committed: kube's `http-proxy`, `socks5` and `oidc` features and tokio's `process` feature use crates already locked, and `sha2` becomes direct (R2, R7). The core reaches the API server with kube-rs and tokio. `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` gate it. No Node ships: pwsh's shell sync uses a PowerShell script instead of the Electron build's Node one (R4).                                                                                                                                                                                                   | Pass   |
| II. Environments             | Rust core: every new module. Electron build: one test file under `main/`, out of both type-check programs. The Tauri pages and `kube-fetch.ts` are in `freelens-tauri/ui`, outside `freelens/src` and `packages/core/src`, and use no Node. What the views show about the connection, the shell sync's failure included, comes from the core over channels.                                                                                                                                                                                                                                                                                                                                                                                                           | Pass   |
| I. Dependency injection      | No injectable added, moved or renamed; `pnpm build:di` has nothing to regenerate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Pass   |
| III. Extension API           | No production file of the Electron build changes, so nothing `Common`, `Main` or `Renderer` reaches changes, `Renderer.K8sApi` and its `executeOnCluster` included. Checked against C1 to C15.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass   |
| IV. Styling                  | The Tauri pages add markup only, with no stylesheet or class system, as specs 004 and 008 left them.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass   |
| V. Verified changes          | Cargo tests for each FR and each channel against a fake API server, the fixtures asserted by both builds (R18), the existing tests mapped one by one (R19). Surroundings: the empty value (no allowed namespace, an empty resource list, an empty body, an empty `PATH`), the missing field (a context without a cluster, a store entry without preferences, a plugin without `expirationTimestamp`), and a change while running (a context leaving the file while connected, a pod created while its list is open, the network going away, a plugin still running at a disconnect) are test cases; the comparison of quickstart.md repeats each step on the Electron build of `main` as the control. Comparators: none added; the lists keep the API server's order. | Pass   |
| VI. Secrets and supply chain | No binary or pin changes; the Tauri build drops freelens-k8s-proxy from its own needs and the Electron build keeps it pinned. Credentials stay in the core: the views get the API server's answers, never the kubeconfig's credentials, a plugin's output or the shell's environment, and the logs carry none (R16). Test certificates and keys are made by `openssl` at test time into a temporary directory, as `tests/foundation.rs` makes them; the fixtures hold made-up servers and placeholder credentials only.                                                                                                                                                                                                                                               | Pass   |
| Conventions                  | New files get the single-line header; `src/clusters.rs`, a file of this port, keeps its own when it moves. The fixtures are data and are left out of Biome and Trunk, as the catalog fixtures are. Scratch output of the measurements goes to `$TMPDIR`. Nothing is added to `docs/`. The channel list's main-cluster-connection rows and `shell-sync-failed-channel` are updated (FR-027), and routes.md of spec 004 records the new `/api-kube/` rows.                                                                                                                                                                                                                                                                                                              | Pass   |

Re-check after Phase 1 design: unchanged. The contracts add no Tauri command,
no capability and no extension surface; what the views see is the answers of
the channels and routes of [contracts/](./contracts/), and log lines.

## Project Structure

### Documentation (this feature)

```text
specs/009-main-cluster-connection/
├── spec.md
├── plan.md                       # this file
├── research.md                   # Phase 0
├── data-model.md                 # Phase 1
├── quickstart.md                 # Phase 1
├── contracts/                    # Phase 1
│   ├── cluster-channels.md       # the answer of each channel of main-cluster-connection
│   ├── connection.md             # the steps, messages, classification, backoff, state, phase
│   ├── api-kube.md               # the /api-kube/ routes
│   ├── kube-watch.md             # the watch channels and kube-fetch.ts
│   ├── shell-sync.md             # the shell sync and its failure
│   └── clusters-api.md           # Clusters and ShellEnv, as the other core areas use them
├── measure-connection.mjs        # written in implementation (R17)
├── checklists/
│   └── requirements.md
└── tasks.md                      # /speckit-tasks
```

### Source Code (repository root)

```text
freelens-tauri/src-tauri/
├── Cargo.toml                    # kube: + http-proxy, socks5, oidc; tokio: + process; + sha2
├── src/
│   ├── lib.rs                    # shell sync, then Clusters after the catalog and the frames;
│   │                             # Core gains `clusters`; quit disconnects every cluster
│   ├── options.rs                # --scenario=lists; --messages-dump=<path>
│   ├── cluster/                  # new; replaces src/clusters.rs
│   │   ├── mod.rs                # Clusters: connections, states, deleting set, register()
│   │   ├── client.rs             # the kube Client of a cluster (R2)
│   │   ├── exec.rs               # credential plugins (R3)
│   │   ├── connection.rs         # activation, status, refreshes, backoff, disconnect (R5)
│   │   ├── access.rs             # admin, namespaces, API resources, resources to show (R6)
│   │   ├── detect.rs             # metadata detectors (R7)
│   │   ├── api_kube.rs           # /api-kube/ routes (R9)
│   │   ├── watch.rs              # watches over the view's queue (R10)
│   │   ├── kubeconfig_edit.rs    # contexts, removal, the lock (R12)
│   │   ├── execute.rs            # execute-on-cluster (R13)
│   │   └── channels.rs           # the channels of the area (R14)
│   ├── foundation/
│   │   ├── mod.rs                # Setup takes ShellEnv
│   │   └── shell_env.rs          # new: the shell sync (R4)
│   ├── catalog/
│   │   ├── mod.rs                # the phase and `enabled` of a cluster entity (R8)
│   │   └── entities.rs           # the same in the entity's status
│   ├── messaging/
│   │   ├── mod.rs                # Sender::send_named for cluster:<id>:connection-update (R14)
│   │   └── queues.rs             # a message that a later chunk of the same watch appends to (R10)
│   ├── frames.rs                 # forget() used by deactivate and delete
│   ├── routes.rs                 # unchanged; the /api-kube/ rows come from cluster/api_kube.rs
│   └── scheme.rs                 # loses the GET-only /api-kube/ route; State loses `clusters`
└── tests/
    ├── fixtures/cluster/         # new: shared with the Vitest parity test (R18)
    ├── cluster.rs                # new
    ├── api_kube.rs               # new
    ├── shell_env.rs              # new
    └── scheme.rs                 # the /api-kube/ cases move to api_kube.rs

freelens-tauri/ui/src/renderer/catalog.ts       # connect, progress, reconnect, disconnect, delete, scenario
freelens-tauri/ui/src/renderer/cluster.ts       # state, sidebar, namespaces, Pods and Config Maps, scenario
freelens-tauri/ui/src/renderer/kube-fetch.ts    # new: fetch with watches (R10)

packages/core/src/main/cluster/tauri-parity.test.ts   # new (R18)

biome.jsonc, .trunk/trunk.yaml                         # leave tests/fixtures/cluster alone
specs/002-messaging-for-tauri/contracts/channel-list.md # main-cluster-connection rows (FR-027)
specs/004-cluster-frames/contracts/routes.md            # the /api-kube/ rows (R9)
specs/baseline.md                                       # the figures of R17
```

**Structure Decision**: one module directory, `src/cluster/`, because every
part serves one shared handle, `Clusters`, as `src/catalog/` and `src/stores/`
do. The client and the plugin runner are modules of their own because later
areas (kubectl, helm, the terminals, metrics) take the client and the shell
environment from them; the route and the watches because their tests need no
connection state. The shell sync goes into `foundation/` because later areas
use it beyond clusters.

### Implementation order

Risk first:

1. **Watches** (Tauri): `watch.rs`, the queue's appended message,
   `kube-fetch.ts`, and a frame page that lists and watches the ConfigMaps of
   the kind cluster with the client of spec 008. A first run of the `lists` and
   `watch` modes of `measure-connection.mjs` for SC-003, SC-005 and SC-006; a
   figure slower than the Electron build's reopens R10 and R2.
2. **The client and the route** (Tauri): `client.rs` with the proxy and the
   timeouts, `api_kube.rs` with its rules, against the fake API server.
3. **Credentials** (Tauri, Electron test): `exec.rs` and `shell_env.rs`, the
   fake plugin and test shell, the parity case that fixes client-go's wording.
4. **The connection** (Tauri, Electron test): `connection.rs`, `access.rs`,
   `detect.rs`, the catalog phase and the cluster state, with the fixtures of
   R18 and the tests of R19.
5. **Disconnect, delete and the channels** (Tauri): `kubeconfig_edit.rs`,
   `execute.rs`, `channels.rs`, the frame record and quitting.
6. **The pages** (Tauri): the catalog and frame pages of R15 and
   `--scenario=lists`.
7. **Measurements and the lists** (both): `measure-connection.mjs` in full,
   the figures in `specs/baseline.md`, the channel list and routes.md.

## Complexity Tracking

No violation to justify.
