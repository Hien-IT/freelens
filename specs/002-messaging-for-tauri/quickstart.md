# Quickstart: Messaging for the Tauri Build

How to check every success criterion of [spec.md](./spec.md). The commands
become runnable as the tasks land: `messaging-for-tauri`, `--messaging-check`
and `measure-electron-ipc.cjs` do not exist before that. Run every command
from the repository root.

## Prerequisites

The prerequisites of `specs/001-tauri-shell-spike/quickstart.md` (mise, pnpm,
rustup, Xcode Command Line Tools), then:

```bash
mise install
```

```bash
pnpm install
```

For the integration tests and the running-application checks of the Electron
build: Docker and the reference kind cluster of section 0.4 of
`specs/tauri-port-runbook.md`, with its context in `~/.kube/config` (the
integration tests read `os.userInfo().homedir`, not `$HOME`; see
`specs/baseline.md`).

## User Story 1: the channels in the Tauri build

Unit tests of the view side, against the fake core:

```bash
pnpm --filter @freelensapp/messaging-for-tauri test:unit
```

Expected: every scenario of User Story 1 and every view-side edge case has a
passing test (research R10).

Core tests, including the routes, the queues, the `Origin` rules, duplicate
registration and the credential test:

```bash
cd freelens-tauri/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

The check run (SC-003), on the fixture kubeconfig, whose fake contexts open a
frame without reaching any cluster:

```bash
pnpm --filter @freelensapp/freelens-tauri tauri:ui && cd freelens-tauri/src-tauri && cargo run -- --kubeconfig="$PWD/tests/fixtures/three-contexts.yaml" --open-cluster=context-a --messaging-check 2>&1 | tee "$TMPDIR/messaging-check.log"
```

Expected ([contracts/check-log.md](./contracts/check-log.md)):
`Messaging: main announced` and `Messaging: cluster <id> announced`,
`build version 0.1.0` (the version of `tauri.conf.json`) for both views, 20
`passed` lines for each of the two views, `done, 20 of 20 rounds passed` for
both, no `failed` line and no `messaging-check-failed` mark:

```bash
grep -c 'round .* passed' "$TMPDIR/messaging-check.log"; grep -E 'failed|messaging-check-failed' "$TMPDIR/messaging-check.log"
```

Expected: `40`, and nothing from the second search. With the run still open,
switch to another application for two minutes, come back, and check that a new
round of the cluster frame still passes (research R14).

The answer times of SC-007 are the `answer of … bytes in … ms` lines of the
same log. The Electron build's figures, with the Electron binary the build
uses:

```bash
pnpm --filter @freelensapp/freelens exec electron "$PWD/specs/002-messaging-for-tauri/measure-electron-ipc.cjs"
```

Record both in [contracts/channel-list.md](./contracts/channel-list.md#answer-times),
medians of three runs, with no threshold.

## User Story 2: no feature code on Electron IPC

The search of section 0.3 of the runbook, without the exempt extension system
(SC-001), and the sends to web contents it does not see:

```bash
grep -rlE 'ipcMain|ipcRenderer' packages/*/src freelens/src --include='*.ts' --include='*.tsx' | grep -v test | grep -v '^packages/core/src/extensions/'
```

```bash
grep -rlE 'webContents\.(send|sendToFrame)|\.sendToFrame\(|sender\.send\(' packages/*/src freelens/src --include='*.ts' --include='*.tsx' | grep -v test | grep -v '^packages/core/src/extensions/'
```

Expected: both print nothing. `packages/*/src` does not reach the messaging
packages, which are deeper.

The Electron build's checks (SC-005):

```bash
pnpm build && pnpm type:check && pnpm test:unit && pnpm knip:check && pnpm biome check && pnpm trunk check
```

```bash
pnpm test:integration
```

FR-019: a test file changed only where the code it tests, or a module it
fakes, moved off Electron IPC, with no test removed. Compare the number of
tests before and after, and read the diff of every changed test file:

```bash
git diff --stat main -- '*.test.ts' '*.test.tsx'
```

Running-application checks of the Electron build, each repeated on `main` as
the control, with the same steps: the tray icon toggled in Preferences; a
`freelens://` link, valid and invalid; the catalog filled at start and updated
when a kubeconfig changes; the status of a cluster while it connects and when
it fails; a terminal tab in a cluster and a local one (shell tokens); the
back and forward buttons after navigating; the application menu opened as a
context menu; navigation from the tray and from a protocol link into a cluster
frame; the licenses window; the network going offline and online with a
cluster open; a CRD created while a cluster view is open, so its kind appears
in the sidebar (the accessibility refresh). No difference from `main` is
expected.

## User Story 3: the channel list

[contracts/channel-list.md](./contracts/channel-list.md) is complete when the
searches of its "How the list was made" section find no channel without a row,
and every row names a core area of R9 of spec 001 or a reason it is not
ported (SC-002).

## SC-006: no credentials reach a view

The cargo test `no_credentials_in_ipc_answers` of `tests/messaging.rs` runs the
routes with the fixture kubeconfig and the check channels, and fails if any
answer or polled message contains a certificate, key or token of the fixture.
