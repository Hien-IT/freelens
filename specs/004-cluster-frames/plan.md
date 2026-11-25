# Implementation Plan: Cluster Frames

**Branch**: `spec/tauri-port` | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/004-cluster-frames/spec.md`

## Summary

The Electron build gives each cluster frame its own origin with Chromium's
host mapping and a local TLS proxy (research R1). The Tauri build already has
the counterpart that spec 001 proved for two frames: the scheme
`freelens-app` with one host per cluster, a secure context without a
certificate, and WebKit refusing what crosses origins (R2). This plan adds what
several frames at once need from the core:

- a route table in which every route states its audience, the main window,
  the cluster frames or both, so that the later areas add routes under one
  rule, and in which a host with a port or a user name names no view (R3);
- frames that cannot move the main window or each other, open a window, get a
  permission or reach outside their origin, and pages that cannot be framed
  where they do not belong: the `sandbox` attribute on each frame, a
  navigation handler on the main window, and the pages' content security
  policies (R12);
- a frame record shared with the later areas: which clusters have a frame,
  which one is visible, events when a frame is announced or forgotten, and a
  send to one frame (R4), with frames forgotten when messaging closes their
  queue or the main window reloads (R5);
- answers to `cluster:set-frame-id` and `current-visible-cluster` that accept
  only the right kind of sender (R6);
- the catalog page and the frame page following the frame lifecycle of the
  Electron build (R7);
- a `--frames-check` run that proves SC-001 to SC-005 with three frames (R9).

In the Electron build, `request-freelens-proxy-certificate` and the code that
sends, answers and stores it are deleted; nothing read the value (R8).

## Technical Context

**Language/Version**: Rust 1.98.1 for the core
(`freelens-tauri/src-tauri/rust-toolchain.toml`); TypeScript 7.0.2 for the
pages of the Tauri build and the Electron deletions

**Primary Dependencies**: existing ones only. Core: `tauri` 2.12.7, `http`,
`serde`, `serde_json`, `tokio`. Pages: `@freelensapp/messaging`,
`@freelensapp/messaging-for-tauri`, `@freelensapp/feature-core`,
`@ogre-tools/injectable`, `mobx`, already in `freelens-tauri/package.json`.
No new crate and no new npm package.

**Storage**: none. The frame record lives in memory; the website data store
stays non-persistent (R2).

**Testing**: `cargo test` for the route table, the frame record, the two
channels and the queue events (`tests/scheme.rs`, new `tests/frames.rs` and
`tests/navigation.rs`, unit
tests in `src/messaging/queues.rs`); the `--frames-check` run and the manual
steps of [quickstart.md](./quickstart.md); the Electron build's
`pnpm type:check`, unit tests, integration tests and `knip:check` after the
deletions of R8.

**Target Platform**: the Tauri build on macOS arm64 (WKWebView); the Electron
build on its existing platforms.

**Project Type**: desktop application; two modules of the existing Rust crate
and changes to the pages of the Tauri build.

**Performance Goals**: none with a threshold (Assumptions of the spec). A
closed frame is forgotten within 60 seconds of its close (SC-005).

**Constraints**: no Tauri command or capability; no change to the website
data store; the only new WebView setting is the main window's navigation
handler (R12); the Electron build changes only by the deletions of R8; no
existing test is removed or weakened; no new dependency.

**Scale/Scope**: three frames in the check; no upper limit (FR-009). The
channels of cluster-frames: two answered by the core, one removed from both
builds.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | Status               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| VII. Tauri build             | Targets both builds. The Tauri build gains the route table, the frame record, the two channels, the page changes and the check. The Electron build changes only by deleting four files that send, answer and store a value nothing reads (FR-019, FR-021); its build, type check, unit tests, integration tests and `knip:check` run after that change.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass                 |
| VIII. Rust core              | `freelens-tauri/src-tauri/src/routes.rs` and `src/frames.rs`, changes to `src/scheme.rs`, `src/lib.rs`, `src/options.rs` and `src/messaging/`; no new crate; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`; `Cargo.lock` stays committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Pass                 |
| II. Environments             | New TypeScript is renderer code of the Tauri pages under `freelens-tauri/ui/src/renderer/`, which already have no Node. The Electron deletions are in `main/`, `renderer/` and `common/` directories and leave no file on a legacy list; none is added. The core is reached only over the scheme and the channels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass                 |
| I. Dependency injection      | Removes three injectables of the Electron build (the listener, the renderer request and the renderer runnable); `pnpm build:di` regenerates the registrations, and the empty `renderer/certificate/` aggregator goes with them. No injectable is added. The Tauri pages use the messaging container of spec 002.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Pass                 |
| III. Extension API           | Nothing the `Common`, `Main` and `Renderer` namespaces reach changes: none of the deleted files is reached by them (R8). Checked against C1 to C15, C3 and C14 in particular.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass                 |
| IV. Styling                  | No stylesheet or `className` changes; the pages of the Tauri build have no stylesheet.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pass                 |
| V. Verified changes          | Cargo tests for every rule of FR-005 to FR-008, FR-012 and FR-016 to FR-018, refusals included, and for the navigation rule and the policies (FR-023); the Electron suites after R8; the `--frames-check` run for what the engine enforces, FR-024 to FR-028 included, and the manual check of SC-007 on the branch and on `main`. The pages of the Tauri build have no unit tests (Complexity Tracking). Surroundings: no comparator and no view that edits data is touched; the running-application checks try an empty catalog and an invalid kubeconfig with `--frames-check` (the empty value), a host whose cluster id is not in the catalog (the missing field, the existing cargo test `unknown_hosts_and_unknown_cluster_ids_get_404_everywhere` of `tests/scheme.rs`), and repeat the steps by hand on `main` as the control (quickstart.md "Surroundings and the control"). A change in the cluster while a frame is open does not apply: the frame page reads its cluster once and holds nothing a watch updates. | Deviation, see below |
| VI. Secrets and supply chain | No binary, pin or secrets file is touched. The check and the tests use the fixture kubeconfigs of spec 001, which hold fake credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pass                 |
| Conventions                  | New Rust and TypeScript files get the single-line header; the Electron files are deleted, not edited. No JSON file gets comments. Scratch output goes to `$TMPDIR`. Nothing is added to `docs/`. The channel list is updated as FR-020 asks.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Pass                 |

Re-check after Phase 1 design: unchanged. The contracts add no Tauri command,
no capability, no Node use in a view and no extension surface.

## Project Structure

### Documentation (this feature)

```text
specs/004-cluster-frames/
├── spec.md
├── plan.md                  # this file
├── research.md              # Phase 0
├── data-model.md            # Phase 1
├── quickstart.md            # Phase 1
├── contracts/               # Phase 1
│   ├── routes.md            # the route table and its audiences
│   ├── frames-api.md        # the frame record as the later areas use it
│   └── frames-log.md        # log lines, and the --frames-check run
├── checklists/
│   └── requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
freelens-tauri/
├── ui/src/renderer/
│   ├── messaging.ts           # new: the messaging container, taken out of messaging-check.ts
│   ├── messaging-check.ts     # uses messaging.ts
│   ├── frames-check.ts        # new: the --frames-check run of R9, in both pages
│   ├── catalog.ts             # sends current-visible-cluster; sandboxed frames; opens three clusters in the check
│   └── cluster.ts             # requests cluster:set-frame-id once loaded
└── src-tauri/
    ├── src/
    │   ├── routes.rs          # new: Routes, Route, Audience (contracts/routes.md)
    │   ├── frames.rs          # new: Frames, FrameEvent, the two channels (contracts/frames-api.md)
    │   ├── frames_check.rs    # new: check-only channels of --frames-check
    │   ├── scheme.rs          # dispatches through Routes; today's routes become rows; frame-ancestors 'none' on the catalog page
    │   ├── options.rs         # + --frames-check
    │   ├── lib.rs             # builds Routes and Frames, wires queue events, the 1-second sweep, the navigation handler
    │   └── messaging/
    │       ├── mod.rs         # Sender::send_to
    │       └── queues.rs      # push_to, sweep, Closed and Restarted events
    └── tests/
        ├── scheme.rs          # + audiences, Origin, duplicates, the /ipc/ rows, hosts with a port or user name, the policies
        ├── navigation.rs      # new: the navigation rule of the main window
        └── frames.rs          # new: record, events, forgetting, sending, the two channels

packages/core/src/                                   # Electron build, R8: deleted
├── common/certificate/freelens-proxy-certificate-channel.ts
├── main/freelens-proxy/freelens-proxy-certificate-request-handler.injectable.ts
├── renderer/certificate/                            # the whole directory
└── renderer/before-frame-starts/runnables/setup-freelens-proxy-certificate.injectable.ts

specs/002-messaging-for-tauri/contracts/channel-list.md   # cluster-frames rows (FR-020)
```

**Structure Decision**: two modules in the existing crate beside `messaging`,
because both are shared by every later area as `Channels` is; the pages of the
spike keep their place and gain the lifecycle of R7. The Electron build only
loses files.

### Implementation order

Risk first:

1. **Queue events and forgetting** (Tauri): `Closed` and `Restarted`, `sweep`,
   `push_to`, with cargo tests of the timing of R5, including a cancelled poll
   that keeps waiting until its hold ends. A failure here reopens R5.
2. **Frame record and the two channels** (Tauri): `Frames`, its events and
   sends, the sender checks, cargo tests.
3. **Route table** (Tauri): `Routes`, today's routes as rows, the audiences,
   hosts with a port or a user name, `tests/scheme.rs` passing unchanged and
   extended.
4. **Pages, navigation and the check** (Tauri): `messaging.ts`, the lifecycle
   of R7, the sandboxed frames, the policies and the navigation handler of
   R12, the `--frames-check` run on macOS with three frames. A frame that the
   sandbox does not stop reopens R12.
5. **Certificate removal** (Electron): the deletions of R8, `pnpm build:di`,
   the Electron suites, the manual check of SC-007.
6. **Channel list** (both): the rows of cluster-frames (FR-015, FR-020).

## Complexity Tracking

| Violation                                                                                                                                | Why Needed                                                                                                                                                                                                                                                                                                | Simpler Alternative Rejected Because                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principle V: the pages of the Tauri build (`ui/frames-check.ts`, `ui/catalog.ts`, `ui/cluster.ts`, `ui/messaging.ts`) have no unit tests | They run only in WKWebView, and what they change is shown by the core: the check's attempts and the `Frames:` lines of their announcements and visible clusters, which the pass condition of `contracts/frames-log.md` requires. The core's side has cargo tests, and the messaging they use has its own. | A DOM test in Vitest would run in a different engine, which is exactly what the check must not stand in for: the isolation and the lifecycle are WebKit's. |
