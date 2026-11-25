---
description: "Task list for spec 004: cluster frames"
---

# Tasks: Cluster Frames

**Input**: Design documents from `specs/004-cluster-frames/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md

**Tests**: requested. FR-023 asks for tests of the core for every rule of
FR-005 to FR-008 and FR-012 and every answer of FR-016 to FR-018, refusals
included; the `--frames-check` run shows what the browser engine enforces
(FR-024 to FR-028, SC-001 to SC-005). In each group, a test task comes before
the code it tests.

**Organization**: the phases follow the implementation order of plan.md,
risk first: the queue events and the frame record, which every story needs,
are foundational; then User Story 1 (routes, navigation, sandboxed frames,
the isolation attempts of the check), User Story 2 (closing and reopening),
and User Story 3, which holds the Electron deletions of research R8 as one
group with their own checks, and the channel list.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an
  unfinished task)
- **[Story]**: the user story of spec.md the task belongs to
- A task that changes existing code says why.

## Path Conventions

- `core/` is `freelens-tauri/src-tauri/`: `core/src/…`, `core/tests/…`.
- `ui/` is `freelens-tauri/ui/src/renderer/`.
- `pc/` is `packages/core/src/`, the Electron build.
- Every command runs from the repository root unless it starts with `cd`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: record what the later checks compare against.

- [x] T001 Record the baseline on the current commit, outside the repository: the names of the tests `cd freelens-tauri/src-tauri && cargo test -- --list` prints, to `$TMPDIR/004-baseline/cargo-tests.txt`, and the summary of `pnpm test:unit` (test files and tests per project), to `$TMPDIR/004-baseline/unit-tests.txt`. Nothing is written in the repository. Why: FR-022 and the plan require every existing test to pass unchanged, which T024 and T029 compare against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: steps 1 and 2 of the implementation order of plan.md. The queue
events and the forgetting of research R5 are the riskiest part, and the frame
record of research R4 is what all three stories use.

### Queue events and forgetting

- [x] T002 Write the unit tests in the `tests` module of `core/src/messaging/queues.rs`, with tokio's paused clock: `Closed(view)` is reported once when a queue closes for no poll in 60 seconds and once when it goes over 10 000 messages; `Restarted(view)` is reported when a poll names a new session for an open queue, and not on its first poll (data-model.md `Queue events.Closed`, `Queue events.Restarted`); `sweep()` closes an idle queue with no poll or send happening; a poll still waiting when its view goes away keeps the queue open until its 25-second hold ends, and the queue closes no later than 60 seconds after that poll started (research R5); `push_to(view, …)` appends to that view's queue alone, takes that queue's next sequence number and answers its waiting poll, and does nothing for a view without a queue (data-model.md `Targeted message.cluster`, `Targeted message.channel`, `Targeted message.payload`).
- [x] T003 Implement in `core/src/messaging/queues.rs`: a list of subscribers called with `Closed(view)` and `Restarted(view)` outside the lock, `pub fn sweep(&self)`, and `pub fn push_to(&self, view: &View, channel: &str, payload: Option<Value>)`. Make T002 pass, with every existing test of the module unchanged. Why: the frame record learns from the queues when a frame is gone (research R5), and a send to one frame needs a queue of its own (research R4). Done with one addition: a waiting poll whose request has been dropped no longer keeps its queue open, so a queue closes 60 seconds after its last poll started even if the web view drops a cancelled request, the risk research R11 named; a test covers both cases.
- [x] T004 In `core/src/messaging/mod.rs`, add `Sender::send_to<M>(&self, view: &View, channel: MessageChannel<M>, message: &M)` over `push_to`, `Messaging::sweep()`, and a way to subscribe to the queue events before `Channels::build`, with a unit test of `send_to` reaching one of two open views. Why: the frame record and the check send to one view through the typed channels (contracts/frames-api.md).

### The frame record and the two channels

- [x] T005 Write `core/tests/frames.rs` with the fixture `core/tests/fixtures/three-contexts.yaml`, building the channels with `register_channels` and driving `messaging::routes::handle` as `core/tests/messaging.rs` does: `cluster:set-frame-id` from the frame of its own cluster records it and answers no value; from another cluster's frame and from the main window it answers the error of contracts/frames-api.md and records nothing; `current-visible-cluster` from the main window with an id, with `null` and with an unknown id; from a cluster frame it is dropped (data-model.md `Frame record.frames`, `Frame record.visible`); `Announced` comes once for two announcements of one cluster; `Forgotten` comes on a closed queue, on a `Restarted(Main)` for every recorded frame, and on `forget(id)`, and not on a `Restarted` of a frame; a read of the record after a queue's idle time finds the frame gone without waiting for the sweep; `send_to` reaches one frame of three, and drops the message for a cluster with no frame and for an earlier frame whose queue a later frame of the same cluster restarted; `send_to_visible` reaches the visible frame and drops the message when there is none. Each refusal checks its log line of contracts/frames-log.md.
- [x] T006 Create `core/src/frames.rs` with `Frames`, `FrameEvent` and the two channels as contracts/frames-api.md specifies (data-model.md `Frame record.frames`, `Frame record.visible`, and the states and events of `Frame record`), with the log lines of contracts/frames-log.md, and `pub fn register(channels: &mut Channels, …) -> Result<Frames, DuplicateChannel>`. Add `pub mod frames;` to `core/src/lib.rs`.
- [x] T007 Wire the record in `core/src/lib.rs`: `register_channels` calls `frames::register`, subscribes the record to the queue events, and returns the `Frames` with the `Messaging`; `run` spawns a task that calls `Messaging::sweep()` once a second. Make T005 pass. Done differently: the record is returned by a new `register_core(check, version, catalog, log) -> Result<Core, DuplicateChannel>`, `Core` holding `messaging` and `frames`, which `run` and `core/tests/frames.rs` use; `register_channels` keeps its signature, with an empty catalog, so that `core/tests/messaging.rs` stays unchanged. Why: the record must learn of a closed frame within a second of its queue closing without any view polling (research R5), and the tests and later areas need the record that startup builds.
- [x] T008 [P] Create `ui/messaging.ts`, which builds and starts the messaging container as `ui/messaging-check.ts` does today, and make `ui/messaging-check.ts` use it. Why: the catalog page and the frame page now start messaging on every run, not only in a `--messaging-check` run (research R7).
- [x] T009 Run `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` and `cargo test` in `freelens-tauri/src-tauri`, and `pnpm --filter @freelensapp/freelens-tauri tauri:ui`. T005 fails here if the queue events do not behave as research R5 expects, which reopens R5 before anything is built on it.

**Checkpoint**: the core keeps a frame record that forgets closed frames and
sends to one frame; every story can start.

---

## Phase 3: User Story 1 - Three clusters open at once, each on its own (Priority: P1) 🎯 MVP

**Goal**: one origin per cluster, routes with audiences, frames that cannot
cross into each other or the main window, and the first half of the
`--frames-check` run (steps 3 and 4 of the implementation order of plan.md).

**Independent Test**: the cargo checks pass, and steps 1 and 2 of the pass
condition of contracts/frames-log.md hold in a `--frames-check` run with three
clusters (SC-001, SC-002).

### Tests for User Story 1

- [x] T010 [P] [US1] Extend `core/tests/scheme.rs`, leaving every existing test as it is: each step of the order of checks of contracts/routes.md answers its status, including an unknown path, a known path with another method, a foreign `Origin` on an existing route, and a route of the other audience (`404`) (data-model.md `Route.method`, `Route.path`, `Route.audience`, `Audience`); a host in upper case is served, a host with a trailing dot, a port or a user name gets `404` on every path (FR-005); the catalog page carries `frame-ancestors 'none'` and both policies match the table of contracts/routes.md; adding a route that overlaps one already added fails with the method and the path (data-model.md `Route.handler` receives the view of the host).
- [x] T011 [P] [US1] Write `core/tests/navigation.rs`, the tests of `routes::allows_navigation`, the navigation rule of the main window, with URLs parsed as `tauri::Url` and the fixture catalog: allowed are a URL of the scheme whose host names a view, `about:blank` and `about:srcdoc`; refused are `https:`, `file:`, `data:`, any other `about:` URL, and a URL of the scheme whose host names no view, a port or a user name included (contracts/routes.md "Navigation of the main window").

### Implementation for User Story 1

- [x] T012 [US1] Create `core/src/routes.rs` with `Audience`, `Route`, `Routes::add` and the dispatch in the order of contracts/routes.md (data-model.md `Route.method`, `Route.path`, `Route.audience`, `Route.handler`, `Audience`), the host check that refuses a port or a user name (research R3), and `pub fn allows_navigation(url: &tauri::Url, catalog: &Catalog) -> bool`. Add `pub mod routes;` to `core/src/lib.rs`. Make T011 pass.
- [x] T013 [US1] Turn the `match` of `core/src/scheme.rs` into the rows of contracts/routes.md "The table when this feature ends", added to `Routes`, and add `frame-ancestors 'none'` to the policy of the catalog page. Why: one table where every route states its audience (FR-007, research R3), and the catalog page kept out of frames (FR-025, research R12). Make T010 pass with every existing test of `core/tests/scheme.rs` and `core/tests/messaging.rs` unchanged. Done with one existing assertion changed: `the_main_host_serves_the_catalog_page` compared the catalog page's policy with the old one, which the new `frame-ancestors 'none'` cannot equal; it now expects the policy of contracts/routes.md. Every other existing test is unchanged.
- [x] T014 [US1] In `core/src/lib.rs`, send every request of the scheme through `Routes`, with `/ipc/` as its row of contracts/routes.md instead of the prefix test before `scheme::handle`, and give the main window an `on_navigation` handler that calls `routes::allows_navigation` and prints `Frames: refused a navigation of the main window to <scheme>` when it refuses (contracts/frames-log.md). No `on_new_window` handler: the default opens nothing (research R12). Why: the table covers `/ipc/` too, and the main window must not leave the scheme (FR-024).
- [x] T015 [P] [US1] In `ui/cluster.ts`, start messaging with `ui/messaging.ts` on every run and, once the page has loaded, request `cluster:set-frame-id` with the cluster id read from the page's own host, as `pc/renderer/frames/cluster-frame/init-cluster-frame/init-cluster-frame.ts` does; the page adds no `message` listener on the window (FR-027), which the review of this task confirms. Why: each frame announces itself as in the Electron build (FR-014, research R7).
- [x] T016 [US1] In `ui/catalog.ts`, start messaging with `ui/messaging.ts` on every run; create each frame with `sandbox="allow-scripts allow-same-origin allow-forms"` and no `allow` attribute (research R12); send `current-visible-cluster` with the id of the shown frame when a cluster is opened or shown, and `null` when the shown frame is closed; in a `--frames-check` run, add `siblings=<id>,<id>`, the other two clusters, to the query of each frame it opens, and `reopened` when it opens a cluster again (contracts/frames-log.md); add no `message` listener on the window (FR-027), which the review of this task confirms. Close keeps removing the section. Why: the lifecycle of FR-014 and research R7, and FR-024 to FR-027. Done with one addition for T015 and T016: `ui/messaging-check.ts` now runs on the page's own container (`runMessagingCheck(di)`), because a second container polls with a session of its own and restarts the view's queue; a short `--messaging-check` run still passes 20 of 20 rounds in both views.

### The check, isolation steps

- [x] T017 [US1] Add `--frames-check` to `core/src/options.rs` and its tests, as `--messaging-check` is (Why: a launch option of contracts/frames-log.md); create `core/src/frames_check.rs`, registered only with the option: `frames-check:report`, which prints the lines of contracts/frames-log.md and compares each view's marks with the ones it reported before; `frames-check:send-to`, which calls `Frames::send_to` with `frames-check:ping` and answers whether the cluster had a frame; `frames-check:send-to-visible`, which calls `Frames::send_to_visible` with `frames-check:ping` and answers whether there was a visible frame; and, in `core/src/routes.rs`, the `Cookie` line for any request that carries the header while the option is on. With the option, `core/src/lib.rs` opens the main window at `/?frames-check`. Done with `register_core` taking `Checks { messaging, frames }` in place of its `check` flag; `core/tests/frames.rs` passes `Checks::default()`, and `register_channels` keeps its signature.
- [x] T018 [US1] Create `ui/frames-check.ts` with the first part of research R9, loaded by a dynamic import from `ui/catalog.ts` and `ui/cluster.ts` when their URL has `frames-check`, as `messaging-check.ts` is: the catalog page opens the first three clusters of the catalog with the query, or, with fewer than three, reports `not run` and opens none (contracts/frames-log.md); each view, the catalog page included, reports its origin and sets its page-state mark, and a mark in each kind of browser storage of the spec's definition and a cookie, each named after the view (`main` or its cluster id) and set only where the view finds none of its own; a frame with `reopened` in its query makes no attempt, reports its origin and marks, and broadcasts `frames-check:step-done` with `marks`; each frame reads the other two clusters from the query `siblings` and then runs every attempt of contracts/frames-log.md "The attempts are named", `outside address` included, each `sibling …` attempt against both siblings with one line each, the `move` attempts last, and reports `blocked` or `isolation failed`, except `visible from frame`, which sends `current-visible-cluster` naming its own cluster and reports `sent`; after its last attempt, each frame broadcasts `frames-check:step-done` with `attempts`; the catalog page runs the `frame document` attempts and `frame permissions` on each frame and the storage and cookie attempts on its own storage, waits for the three `step-done` messages, or reports `isolation failed: step not finished` after 30 seconds, then calls `frames-check:send-to-visible`. Every view reports each `frames-check:ping` it receives. A failure to report calls `GET /api/mark?name=frames-check-failed`. Done with three additions: a frame waits for the `step-done` with `marks` of both siblings before its attempts, and broadcasts its own again on the first one it receives from each, so that the storage attempts run once every view has set its marks; a page moved by a `move` attempt carries `moved-by=<view>` and reports `isolation failed: moved by <view>`; the catalog page's `frame document` and `frame permissions` lines carry the cluster id.
- [x] T019 [US1] Run the check of quickstart.md "User Stories 1 to 3 in the Tauri build: the check run" on macOS and keep its log in `$TMPDIR/004-check/`: steps 1 and 2 of the pass condition of contracts/frames-log.md hold. A frame the sandbox does not stop, or an attempt that succeeds, reopens research R12 before User Story 2. Then steps 1 and 2 of quickstart.md "By hand in the Tauri build", the runs of quickstart.md "Surroundings and the control" with the empty and the invalid kubeconfig, the same steps by hand on `main` as the control (Principle V), and `pnpm type:check`, whose renderer program includes `freelens-tauri/ui/src/renderer/`. Done: the check run passes steps 1 and 2; a control run without the `sandbox` attribute let `move main to scheme` reload the main window, so the sandbox is what stops it; the runs with the empty and the invalid kubeconfig print `not run` and open no frame; `pnpm type:check` passes. That control run also found that a page with no message listener never polls, so neither page of a run without a check had a queue for the forgetting of research R5 to follow; `ui/messaging.ts` now always enlists a listener (research R7), and a second control run showed a reload of the main window forgetting every frame at once; the check run with the sandbox passes steps 1 and 2 again. The steps by hand pass on the branch: opening the three clusters printed one `announced` per cluster, each switch one `visible cluster` line, and neither switching nor opening an open cluster made a frame or reloaded one. On `main` as the control, the same steps opened three frames and made or reloaded none, with no `Frames:` line.

**Checkpoint**: three clusters open at once, each on its own origin, and no
attempt from one crosses into another (SC-001, SC-002).

---

## Phase 4: User Story 2 - Closing one cluster leaves the others alone (Priority: P2)

**Goal**: closing, forgetting and reopening, shown by the second half of the
`--frames-check` run (step 4 of the implementation order of plan.md).

**Independent Test**: steps 3 to 7 of the pass condition of
contracts/frames-log.md hold, and steps 3 and 4 of quickstart.md "By hand in
the Tauri build" give the lines they expect (SC-003 to SC-005).

- [x] T020 [US2] Add the second part of research R9 to `ui/frames-check.ts`, each step starting only on what the catalog page observes (contracts/frames-log.md): after `send-to-visible` has answered, send to the first cluster through `frames-check:send-to`; show the second cluster and close it, so that no frame is shown; send to the second cluster, and to the first and the third; broadcast `frames-check:report-marks` through `broadcast-to-views` so that every frame reports its marks and then broadcasts `frames-check:step-done` with `marks`, which the catalog page waits for; wait 65 seconds with the first and third frames hidden; send to the second cluster again, and to the first and the third, and report the marks again; reopen the second cluster with `reopened`, wait for its `step-done` with `marks`, then print `done` (contracts/frames-log.md). Why: SC-003 to SC-005 and FR-028.
- [x] T021 [US2] Run the check again, keep its log in `$TMPDIR/004-check/`, and verify the whole pass condition of contracts/frames-log.md, steps 1 to 7, and the two searches of quickstart.md. A frame forgotten while hidden reopens research R11 ("A hidden frame stops polling"). Then steps 3 and 4 of quickstart.md "By hand in the Tauri build". Done: the check run passes steps 1 to 7 of the pass condition and both searches of quickstart.md; the first and third frames, hidden for 65 seconds, stayed recorded and received their pings, so research R11 holds for a hidden frame. Its close of the shown cluster printed `Frames: no visible cluster` and, within the wait, `forgotten: its queue closed`, and the control run of T019 showed a reload of the main window forgetting every frame at once. Steps 3 and 4 by hand pass on the branch: closing the shown cluster printed `Frames: no visible cluster` and, once its queue closed, `forgotten: its queue closed`; reloading the main window with two frames open forgot both at once.

**Checkpoint**: a closed cluster leaves the others alone, is forgotten within
60 seconds of its frame's removal, and reopens on its origin with new page
state (SC-003 to SC-005).

---

## Phase 5: User Story 3 - The core knows its frames (Priority: P3)

**Goal**: the channels of cluster-frames all accounted for (FR-015 to
FR-020). The core side is in Phase 2; this phase removes
`request-freelens-proxy-certificate` from the Electron build and updates the
channel list (steps 5 and 6 of the implementation order of plan.md).

**Independent Test**: the search of quickstart.md "The Electron build" finds
nothing, the Electron suites pass with no test removed, and the channel list
reads as quickstart.md "The channel list" says (SC-006, SC-007).

### The Electron deletions of research R8, with their own checks

This group touches only the Electron build and no file of the other phases,
so it may run at any time after Phase 1.

- [x] T022 [P] [US3] Delete, in the Electron build: `pc/common/certificate/freelens-proxy-certificate-channel.ts`, `pc/main/freelens-proxy/freelens-proxy-certificate-request-handler.injectable.ts`, the directory `pc/renderer/certificate/` and `pc/renderer/before-frame-starts/runnables/setup-freelens-proxy-certificate.injectable.ts`. Keep `pc/common/certificate/freelens-proxy-certificate.injectable.ts` and its global override: main uses them (research R8). Why: FR-019, and nothing in the views reads the value.
- [x] T023 [US3] Run `pnpm build:di` and check with `git status` that it removed the registrations of the deleted injectables and the `renderer/certificate/` aggregator, and changed no other registration. Then run the search of quickstart.md "The Electron build"; it must find nothing.
- [x] T024 [US3] Run the checks of the group: `pnpm type:check`; `pnpm test:unit`, whose summary must match `$TMPDIR/004-baseline/unit-tests.txt` of T001 with no test file or test fewer; `pnpm build` then `pnpm knip:check`; `pnpm test:integration`. Fix what fails without removing or weakening a test (FR-022). Done: all pass, and `pnpm test:unit` matches the baseline, 589 test files and 7201 tests passed with 29 skipped. `pnpm test:integration` ran without `KUBECONFIG`, on a machine with no kind context in `~/.kube/config`, so its kind tests were skipped (5 passed, 7 skipped); the cluster frame of the Electron build is shown by T025.
- [x] T025 [US3] Run the manual check of quickstart.md "The Electron build" on the branch and on `main` as the control, with the kind cluster of `specs/tauri-port-runbook.md` section 0.4 and `--kubeconfig` on every `kind` and `kubectl` command: open three clusters, switch between them, close one and open it again; the results must be the same (SC-007). Done with a Playwright script driving the packaged application instead of hands, on a kind cluster with three contexts, without `KUBECONFIG`, and with a user store that syncs that kubeconfig file alone; `main` was built in a worktree of its own. On both, each cluster opened in a frame of its own whose first screen names it, switching made no new frame and reloaded none, disconnecting the second cluster removed its frame alone, and opening it again made a new frame with new page state; the results of the two runs are identical.

### The channel list

- [x] T026 [US3] Update `specs/002-messaging-for-tauri/contracts/channel-list.md`: in "cluster-frames (004)", say that the core answers `cluster:set-frame-id` and listens on `current-visible-cluster` in `freelens-tauri/src-tauri/src/frames.rs`, with their sender checks; move `request-freelens-proxy-certificate` to "Removed by this feature" with FR-019 of spec 004 as the reason, and drop the note that says the private key crosses (research R8); add the check-only channels of contracts/frames-log.md to "Channels of the check" (FR-015, FR-020, SC-006).

**Checkpoint**: every channel of cluster-frames is answered by the core or
sent by no view, and the Electron build still builds and passes its tests.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: the full checks and the quickstart.

- [x] T027 [P] Run `pnpm biome check` and `pnpm trunk check` on the changed files of `freelens-tauri/`, `packages/core/src/` and `specs/`, and fix what they report. Done: neither reports anything on the files the feature changed.
- [x] T028 Run every command of `specs/004-cluster-frames/quickstart.md` from a clean checkout of the branch: the cargo checks, the check run, the steps by hand, the Electron commands and the channel list, and fix what fails. Done, in a worktree of the branch: the cargo checks, the check run with steps 1 to 7 of its pass condition, the runs with the empty and the invalid kubeconfig, `build:di` with no change to the generated files, `type:check`, `test:unit` matching the baseline, `build`, `knip:check`, `build:app:dir`, `test:integration` and the search all pass. Two commands of quickstart.md failed on a fresh checkout and its prerequisites now say why: the core does not compile until `stage-payload.sh` has staged `src-tauri/payload/`, and the unit tests need the Electron binary installed first. An instance left running afterwards stopped polling in every page and its frames were forgotten while open, which research R11 records as a risk. The steps by hand pass on the branch and on `main` as the control (T019, T021).
- [x] T029 Compare the output of `cd freelens-tauri/src-tauri && cargo test -- --list` with `$TMPDIR/004-baseline/cargo-tests.txt` of T001: every test listed there is still listed (FR-022). Done: all 58 are listed, among 92.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: first, so the baseline is the current commit.
- **Foundational (Phase 2)**: after Phase 1; blocks User Stories 1 and 2. T009
  is the go or no-go of research R5.
- **User Story 1 (Phase 3)**: after Phase 2. T019 is the go or no-go of
  research R12.
- **User Story 2 (Phase 4)**: after Phase 3, whose check and pages it
  extends.
- **User Story 3 (Phase 5)**: the Electron group (T022 to T025) after Phase 1
  only; T026 after T019 and T022.
- **Polish (Phase 6)**: last.

### Within Phase 2

- T002 → T003 → T004; T005 after T004; T006 → T007 → T009; T008 beside any
  of them.

### Within User Story 1

- T010 and T011 first; T011 → T012 → T013 → T014.
- T015 and T016 after T008 and T014; T017 after T014; T018 after T015 to
  T017 → T019.

### Within User Story 3

- T022 → T023 → T024 → T025; T026 after T019 and T022.

### Parallel Opportunities

- T008 beside the core tasks of Phase 2.
- T010 and T011, which are different files.
- T015 beside T016 and T017.
- The whole Electron group (T022 to T025) beside Phases 2 to 4: it shares no
  file with them.

---

## Parallel Example: User Story 1

```bash
# The tests of User Story 1, in different files:
Task: "T010 Extend core/tests/scheme.rs"
Task: "T011 Write core/tests/navigation.rs"

# The frame page beside the core's check channels:
Task: "T015 Announce the frame in ui/cluster.ts"
Task: "T017 Add --frames-check and core/src/frames_check.rs"
```

## Parallel Example: User Story 3

```bash
# The Electron group can run beside the Tauri phases:
Task: "T022 Delete the certificate channel's files in packages/core/src"
Task: "T012 Create core/src/routes.rs"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1, then Phase 2, whose T009 decides whether research R5 holds.
2. Phase 3: routes, navigation, sandboxed frames and the isolation half of the
   check.
3. Stop at T019: three clusters open at once, each on its own (SC-001,
   SC-002). If an attempt crosses, R12 is reopened before going on.

### Incremental Delivery

1. Phases 1 and 2: the frame record, invisible to the user.
2. User Story 1: the isolation, shown by the check.
3. User Story 2: closing and reopening, shown by the rest of the check.
4. User Story 3: the Electron deletions and the channel list, which can land
   at any point after Phase 1.
5. Polish.

---

## Notes

- `checklists/isolation.md` is reviewed by its owner before
  `/speckit-implement`; no task sets its markers.
- Scratch output goes to `$TMPDIR`, never into the repository; stage files one
  by one, never with `git add -A`.
- New Rust and TypeScript files get the single-line Freelens header.
