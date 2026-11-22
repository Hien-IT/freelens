# Implementation Plan: Messaging for the Tauri Build

**Branch**: `spec/tauri-port` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/002-messaging-for-tauri/spec.md`

## Summary

Feature code reaches messaging through four injection tokens of
`@freelensapp/messaging`. A new package, `messaging-for-tauri`, implements the
same tokens for the views of the Tauri build, and the Tauri entry point
registers it where the Electron renderer registers `messaging-for-renderer`
(research R1). On the Rust side, a `messaging` module of the core lets each
core area answer typed request channels, listen to typed message channels and
send messages (R8).

Tauri's own IPC does not reach the cluster frames (R5 of spec 001), so the
carrier is the custom scheme the spike already secures: requests and message
batches are `POST`s on the view's own host, which names the sender, and the
core pushes messages by long polling (R2, R3). Values travel as JSON, and a
value JSON would change fails with an error naming the channel (R4).

In the Electron build, every file outside the messaging packages and the
exempt extension system that uses Electron IPC directly moves onto typed
channels, without changing behaviour (R11), and the list of every channel the
Electron build registers names the core area that will answer it (R13).

## Technical Context

**Language/Version**: TypeScript 7.0.2 for the view side and the Electron
moves; Rust 1.98.1 for the core (`freelens-tauri/src-tauri/rust-toolchain.toml`)

**Primary Dependencies**: existing ones only. View side:
`@freelensapp/messaging`, `@freelensapp/feature-core`,
`@freelensapp/application`, `@ogre-tools/injectable`, `mobx`. Core: `tauri`
2.12.7 (wry 0.57.3), `serde`, `serde_json`, `tokio`, already in
`Cargo.toml`. No new crate and no new npm package.

**Storage**: none (data-model.md).

**Testing**: Vitest for `messaging-for-tauri`, against the fake core of R10;
`cargo test` for the `messaging` module (registration, routes, queues, the
`Origin` rules, the absence of credentials in answers); the Electron build's
unit tests under the rule of FR-019 (R12) and its integration tests; the
`--messaging-check` run and the running-application checks of
[quickstart.md](./quickstart.md).

**Target Platform**: the Tauri build on macOS arm64 (WKWebView); the Electron
build on its existing platforms.

**Project Type**: desktop application; one new workspace package and a module
of the existing Rust crate.

**Performance Goals**: none with a threshold. SC-007 records the time of
answers of about 1 KB, 1 MB and 10 MB in both builds.

**Constraints**: no Tauri command or capability; no Node and no `electron`
import in `messaging-for-tauri`; the Electron build behaves as before; test
files change only as FR-019 allows; no new dependency.

**Scale/Scope**: every channel the Electron build registers (R13). The core
answers messaging's own two channels, `frame-communication-admin-channel` and
the `ipc:broadcast-main` relay, plus `build-version` for the check (R7, R9);
every other channel waits for its area's spec.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| VII. Tauri build             | Targets both builds. The Tauri build gains the view-side package, the core's `messaging` module and the check. The Electron build changes only by the moves of User Story 2, which keep its behaviour; its build, type check, unit tests, integration tests and `knip:check` run after each phase.                                                                                                                                                                                                                                                                                                                                | Pass                 |
| VIII. Rust core              | `freelens-tauri/src-tauri/src/messaging/`, tokio and serde, no new crate; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`; `Cargo.lock` stays committed.                                                                                                                                                                                                                                                                                                                                                                                                                                           | Pass                 |
| II. Environments             | `messaging-for-tauri` is renderer code with no context segment in its path, so its sources join the `include` of `tsconfig.renderer.json` (R10). The moved Electron files stay in their `main/`, `renderer/` or `common/` directories, and the legacy helpers move into the exempt `extensions/` tree, split by process so that each part passes its program: the `common/ipc/ipc.ts` entry leaves the renderer legacy list and none is added (R11). A moved file that stops failing the environment check leaves its legacy list and the Biome exemption together. The core is reached only over channels, which is the feature. | Pass                 |
| I. Dependency injection      | Adds injectables in `messaging-for-tauri` and in core (the listener injectables of moved legacy channels), and moves the `ipc-main` and `ipc-renderer` wrappers into `packages/core/src/extensions/ipc/`; `pnpm build:di` regenerates the registrations, which are never edited by hand. The check pages of the spike now build a DI container.                                                                                                                                                                                                                                                                                   | Pass                 |
| III. Extension API           | The extension system is exempt and keeps Electron IPC (FR-014). The legacy helpers it uses move into its own tree with the same signatures; `Main.Ipc`, `Renderer.Ipc` and the `Common.Types` IPC aliases do not change, and nothing new is exported. Checked against C1 to C15, C3 and C14 in particular.                                                                                                                                                                                                                                                                                                                        | Pass                 |
| IV. Styling                  | No stylesheet or `className` changes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Pass                 |
| V. Verified changes          | Unit tests for every token and edge case of the view side (R10); cargo tests for the core; the Electron suites. Running-application checks in quickstart.md for each moved path (tray, protocol links, catalog sync, cluster status, shell tokens, history buttons, navigation, licenses window, network state, accessibility refresh on a CRD created while a cluster view is open), each repeated on `main` as the control. The check pages have no unit tests.                                                                                                                                                                 | Deviation, see below |
| VI. Secrets and supply chain | No binary, pin or secrets file is touched. The check and the cargo tests use the spike's fixture kubeconfigs with fake credentials.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass                 |
| Conventions                  | New TypeScript files get the single-line header and moved files keep theirs; Rust files carry it in a `/* … */` block. No JSON file gets comments. Scratch output goes to `$TMPDIR`. Nothing is added to `docs/`; the package's purpose is in its `package.json` description, like its siblings.                                                                                                                                                                                                                                                                                                                                  | Pass                 |

Re-check after Phase 1 design: unchanged. The contracts add no Tauri command,
no capability, no Node use in a view and no extension surface.

## Project Structure

### Documentation (this feature)

```text
specs/002-messaging-for-tauri/
├── spec.md
├── plan.md                    # this file
├── research.md                # Phase 0
├── data-model.md              # Phase 1
├── quickstart.md              # Phase 1
├── contracts/                 # Phase 1
│   ├── ipc-routes.md          # the /ipc/ routes of the scheme
│   ├── core-channels.md       # the registration API of the core
│   ├── check-log.md           # log lines of messaging and of the check
│   └── channel-list.md        # every channel of the Electron build and its owner
├── measure-electron-ipc.cjs   # SC-007 figures of the Electron build
├── checklists/
│   └── requirements.md
└── tasks.md                   # /speckit-tasks
```

### Source Code (repository root)

```text
packages/technical-features/messaging/messaging-for-tauri/   # new, @freelensapp/messaging-for-tauri
├── package.json               # private; test:unit like its siblings; no electron
├── index.ts                   # exports messagingFeatureForTauri
└── src/
    ├── feature.ts
    ├── register-injectables.ts           # generated by pnpm build:di
    ├── post-to-core.injectable.ts        # the only fetch (R10)
    ├── wire.ts                           # envelope and the JSON check (R4)
    ├── request-from-channel.injectable.ts
    ├── message-batches.injectable.ts     # one batch in flight; requests wait (R5)
    ├── message-to-channel.injectable.ts
    ├── polling.injectable.ts             # the long poll (R3)
    ├── enlist-message-channel-listener.injectable.ts
    ├── enlist-request-channel-listener.injectable.ts   # throws, as in Electron
    ├── allow-communication.injectable.ts # frame-communication-admin-channel on load
    ├── *.test.ts
    └── test-utils/get-core-fake.ts       # the fake core (R10)

freelens-tauri/
├── package.json               # + the messaging packages, feature-core, application, injectable, mobx
├── ui/src/renderer/
│   ├── messaging-check.ts     # new: DI container and the rounds of R9
│   ├── catalog.ts             # runs the check with ?messaging-check, passes the query to the frame
│   └── cluster.ts             # runs the check with ?messaging-check
└── src-tauri/
    ├── src/
    │   ├── messaging/
    │   │   ├── mod.rs         # View, channel types, Channels, Messaging (contracts/core-channels.md)
    │   │   ├── routes.rs      # /ipc/ routes (contracts/ipc-routes.md)
    │   │   ├── queues.rs      # queues and long polls (data-model.md)
    │   │   ├── admin.rs       # frame-communication-admin-channel, the ipc:broadcast-main relay (R7)
    │   │   └── check.rs       # --messaging-check channels (R9)
    │   ├── version.rs         # build-version, answered with the package version (R9)
    │   ├── options.rs         # + --messaging-check
    │   ├── scheme.rs          # POST on /ipc/ only, dispatch to messaging::routes
    │   └── lib.rs             # registrations at startup, Messaging in State
    └── tests/messaging.rs

packages/technical-features/messaging/
├── messaging/src/features/actual/request/request-channel-listener-injection-token.ts  # + optional withSender (R11)
└── messaging-for-main/src/channel-listeners/enlist-request-channel-listener.injectable.ts  # passes the sender when asked

packages/core/src/                                    # the moves of R11
├── extensions/ipc/{common,main,renderer}/  # + the legacy helpers split by process, and the ipc-main / ipc-renderer wrappers
├── common/ipc/                # legacy helpers leave; channel constants become typed channels
├── main/…, renderer/…, features/…                    # each file of R11 moves onto channels
tsconfig.renderer.json         # + messaging-for-tauri sources
scripts/type-check-environments/legacy.jsonc, biome.jsonc   # only shrink, if a moved file stops failing
```

**Structure Decision**: one new package beside its siblings, the
`messaging` module inside the existing crate (no new crate: it is the core's
carrier, not a library), and the Electron moves in place. The check reuses the
spike's two pages.

### Implementation order

Risk first:

1. **Carrier proof** (Tauri): the `/ipc/` routes, queues and long poll in the
   core, `messaging-for-tauri` with its unit tests, and the check with the
   admin channel and a check-only echo, from the main window and a cluster
   frame. This proves POST bodies, late answers to a held poll, a frame closed
   while polling, and the `Origin` rules on `POST` (R14). A failure here
   reopens R2.
2. **Typed layer and check channels** (Tauri): `Channels`, `Messaging`,
   duplicate registration, the relay, `build-version`, the rounds of R9, the
   credential test, the SC-007 timings in both builds.
3. **The channel list** (both): `contracts/channel-list.md`, written from the
   inventory of R13, checked again against every registration point once the
   moves are done (SC-002).
4. **The moves** (Electron), one group of files per area of R11, each with its
   tests and its running-application check, ending with the search of SC-001.

## Complexity Tracking

| Violation                                       | Why Needed                                                                                                                                             | Simpler Alternative Rejected Because                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principle V: the check pages have no unit tests | `messaging-check.ts` is itself a check: it runs rounds and prints what happened. The view side it drives has unit tests, and the core has cargo tests. | A DOM test setup for the spike's pages (Vitest project, fake scheme) would test the test, and the pages are replaced by the full renderer after spec 003. |
