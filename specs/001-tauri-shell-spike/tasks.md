---
description: "Task list for the experimental shell spike"
---

# Tasks: Experimental Shell Spike

**Input**: Design documents from `specs/001-tauri-shell-spike/`

**Prerequisites**: [plan.md](./plan.md), [spec.md](./spec.md),
[research.md](./research.md), [data-model.md](./data-model.md),
[contracts/](./contracts/), [quickstart.md](./quickstart.md)

**Tests**: the plan requires cargo tests for the Rust core (Principle V). The
spike UI has none (Complexity Tracking of plan.md), so every test task is a
Rust one.

**Existing code**: no task changes `packages/core` or `freelens/src`. Every
task that edits a file that exists today says why, after "Why:".

**Organization**: tasks are grouped by user story, so that each story can be
built and checked on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an
  unfinished task)
- **[Story]**: the user story of spec.md the task belongs to (US1, US2, US3)

## Path Conventions

- Package: `freelens-tauri/`
- Rust core: `freelens-tauri/src-tauri/` (`src/`, `tests/`)
- Spike UI: `freelens-tauri/ui/` (pages) and `freelens-tauri/ui/src/renderer/`
  (scripts)
- Measurement: `specs/001-tauri-shell-spike/`

New TypeScript and JavaScript files get the single-line Freelens header; Rust
files carry the same text in a `/* … */` block (plan.md, Conventions).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the package, the crate and the UI build, with no behaviour yet.

- [x] T001 Create `freelens-tauri/package.json`: name `@freelensapp/freelens-tauri`, `private: true`, `type: "module"`, devDependencies `@tauri-apps/cli` and `vite` as `catalog:`, scripts `tauri:ui` (`vite build`) and `tauri:dev` (`pnpm tauri:ui && tauri dev`). No script named `build`, `dev`, `test:unit` or `type:check`, so that the root's turbo pipelines never run one (research R1). Create `freelens-tauri/.gitignore` with `src-tauri/target/`, `src-tauri/payload/` and `src-tauri/gen/`.
- [x] T002 Edit `pnpm-workspace.yaml`: add `freelens-tauri` to `packages` and `'@tauri-apps/cli': 2.12.6` to `catalog`, add it to the `workspaces` field of the root `package.json`, which mirrors that list and makes pnpm warn when the two differ, then run `pnpm install` so that `pnpm-lock.yaml` records it. Why: the package has to be a workspace member to pin its CLI through the catalog; no existing package's dependencies change.
- [x] T003 [P] Create the crate in `freelens-tauri/src-tauri/`: `Cargo.toml` (package `freelens-tauri`, edition 2024, a library target and the binary; dependencies `tauri`, `kube`, `k8s-openapi` with feature `v1_37`, `tokio`, `serde`, `serde_json` and an MD5 crate at the versions of research R2, build dependency `tauri-build`, and the release profile of research R2), `rust-toolchain.toml` (channel `1.98.1`, components `rustfmt` and `clippy`), `build.rs` calling `tauri_build::build()`, `src/main.rs` calling `freelens_tauri::run()`, and `src/lib.rs` with an empty `run`. Generate `Cargo.lock` and keep it.
- [x] T004 [P] Create `freelens-tauri/src-tauri/tauri.conf.json`, plain JSON without comments: `productName` `Freelens Spike`, `mainBinaryName` `freelens-spike`, `version` `0.1.0`, `identifier` `app.freelens.FreelensSpike`, `build.frontendDist` `../ui/dist`, `app.windows` `[]` (the core creates the window, T014), `bundle.active` `true`, `bundle.targets` `["dmg"]`, `bundle.icon` listing the files of T005, `bundle.macOS.signingIdentity` `-`. Create no `capabilities/` directory (research R5).
- [x] T005 [P] Generate the icons into `freelens-tauri/src-tauri/icons/` with `pnpm --filter @freelensapp/freelens-tauri exec tauri icon ../freelens/build/icons/512x512.png --output src-tauri/icons`, and keep only `icon.icns`, `32x32.png`, `128x128.png` and `128x128@2x.png`.
- [x] T006 [P] Create `freelens-tauri/vite.config.ts` (root `ui`, inputs `ui/index.html` and `ui/cluster.html`, `outDir` `dist`, `emptyOutDir` `true`, `base` `/`), the pages `freelens-tauri/ui/index.html` and `freelens-tauri/ui/cluster.html`, each loading its script as a module, and stubs `freelens-tauri/ui/src/renderer/catalog.ts` and `freelens-tauri/ui/src/renderer/cluster.ts` that only set the page heading.
- [x] T007 Edit `tsconfig.typecheck.json` (add `freelens-tauri/ui/src/**/*` to `include`) and `tsconfig.renderer.json` (add `freelens-tauri/ui/src/renderer/**/*` to `include`). Why: `pnpm type:check` is the gate for TypeScript (Principle II), and the renderer program has DOM and no Node, so it rejects Node in the spike UI; every existing file keeps its classification.
- [x] T008 Run `pnpm knip:check` after `pnpm build`, and edit `knip.jsonc` for what it reports: ignore the build output `freelens-tauri/src-tauri/target/**` and `freelens-tauri/ui/dist/**` and the staged payload `freelens-tauri/src-tauri/payload/**`, which the development pass sees because it runs with `--no-gitignore`; add `specs/*.mjs` as root entries, since the measurement scripts are run by hand; and ignore `playwright` at the root, which `specs/profile-main.mjs` resolves from `freelens/package.json`. Why: knip's file check reported these files, and `knip:check` has failed since `specs/profile-main.mjs` and `specs/analyze-profile.mjs` were committed.

**Checkpoint**: `pnpm --filter @freelensapp/freelens-tauri tauri:ui` writes `freelens-tauri/ui/dist`, `cargo build --manifest-path freelens-tauri/src-tauri/Cargo.toml` succeeds, and `pnpm build` runs nothing of the new package.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the core, the catalog, the custom scheme and the main window, and
the proof that a cluster frame on a second host of the scheme loads and is
isolated (research R4). A failed proof ends the spike, as the gate of spec 001
says.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [x] T009 [P] Create the fixtures in `freelens-tauri/src-tauri/tests/fixtures/`: `three-contexts.yaml` (three contexts, server `https://127.0.0.1:1`, users with the fake `token: FAKE-TOKEN-0001` and `client-certificate-data` and `client-key-data` set to the base64 of `FAKE-CERT` and `FAKE-KEY`), `no-contexts.yaml` and `invalid.yaml`. YAML only, no `.pem` or `.key` file (Principle VI).
- [x] T010 [P] Implement the launch options in `freelens-tauri/src-tauri/src/options.rs` as contracts/launch-options.md specifies, with `data-model.md` `Launch options.kubeconfig`; `Default` resolves to `$HOME/.kube/config`; unknown options and a missing value are errors. Unit tests in the same file cover every row of the contract's table and both errors.
- [x] T011 Implement the catalog in `freelens-tauri/src-tauri/src/catalog.rs`: read the file of T010 once with `kube::config::Kubeconfig::read_from`, and produce `data-model.md` `Kubeconfig source.path` and `Kubeconfig source.state`, and per context `Catalog entry.id`, `Catalog entry.name` and `Catalog entry.source`. Keep the parsed kubeconfig inside the module for the clients of T026, never in what `/api/clusters` serializes. Unit tests: the three fixtures, a missing chosen file and a missing default file (message and no message, per the state table of data-model.md), and the id of a fixed path and context equal to the output of `md5 -s "<path>:<context>"`.
- [x] T012 Implement the scheme routing in `freelens-tauri/src-tauri/src/scheme.rs` as contracts/scheme-routes.md specifies, as `async fn handle(request, &State) -> Response` with no Tauri type in its signature: host parsing into the main host, a cluster host (`data-model.md` `Cluster view.clusterId`, which must be in the catalog) or an unknown one; `/` and `/assets/<file>` from the embedded UI through a closure over Tauri's asset resolver; `GET /api/clusters` built from T011 only; `GET /api/mark` as contracts/log-lines.md specifies; `405` for other methods and for `OPTIONS`; `403` under the Origin rule; no `Access-Control-*` header; `Content-Security-Policy` `default-src 'self'; frame-src freelens-app:` on the main page and `default-src 'self'; frame-ancestors freelens-app://renderer.freelens.app` on the cluster page. `/api-kube/*` answers `404` until T027.
- [x] T013 Write `freelens-tauri/src-tauri/tests/scheme.rs` for T012: every row of the routes table on the main host, a cluster host and an unknown host; an unknown cluster id; the Origin rule; no CORS header in any response; the mark name rule; and no `FAKE-TOKEN`, `RkFLRS1DRVJU` (base64 of `FAKE-CERT`) or `127.0.0.1:1` in the `/api/clusters` body of `three-contexts.yaml`.
- [x] T014 Wire the core in `freelens-tauri/src-tauri/src/lib.rs`: parse the options first (on error, print it on standard error and exit with status 2), build the catalog, register `freelens-app` with `register_asynchronous_uri_scheme_protocol` so that it runs `scheme::handle` on the async runtime, create the window `main` with `WebviewWindowBuilder` on `freelens-app://renderer.freelens.app/` with `incognito(true)` (research R7), and print `Window "main" loaded` when its page load finishes (contracts/log-lines.md).
- [x] T015 Prove the cluster frame (done with a temporary page in the git-ignored `ui/dist` that ran each attempt and reported it as a mark, since Safari's Web Inspector cannot be driven from a script; see R4) in `pnpm --filter @freelensapp/freelens-tauri tauri:dev -- -- --kubeconfig=src-tauri/tests/fixtures/three-contexts.yaml`, with Safari's Web Inspector: from the main window's console, fetch `/api/clusters` and append an iframe on the first id's host; check that it loads the cluster stub page, that `isSecureContext` is true in it, and that every attempt under "Isolation expected in the browser" of contracts/scheme-routes.md fails (the `/api-kube` one answers `404` until T027). Record the result, with the macOS and Safari versions, under R4 of `specs/001-tauri-shell-spike/research.md`. Why: research.md marks these facts Unverified until this check. If the frame does not load or is not isolated, stop and record a no-go.

**Checkpoint**: the main window loads from the custom scheme, a cluster frame on its own host loads and is isolated, and `cargo test` passes. User stories can start.

---

## Phase 3: User Story 1 - Measure the experimental build against the baseline (Priority: P1) 🎯 MVP

**Goal**: an installer with the payload of research R8, and the startup, idle
memory and size figures measured as the baseline was.

**Independent Test**: build the dmg, run `measure.sh spike` and
`measure.sh electron` three times each, and compare the medians with the
baseline row for macOS arm64 (quickstart.md, User Story 1).

### Implementation for User Story 1

- [x] T016 [P] [US1] Write `freelens-tauri/scripts/stage-payload.sh`: run `pnpm --filter freelens build:binaries`, which re-verifies kubectl and helm against `freelens/binaries.lock.json` (Principle VI); copy `freelens/binaries/client/darwin/arm64/kubectl` and `helm` to `freelens-tauri/src-tauri/payload/arm64/`; copy `freelens/static/build` without `*.map` and `main.js*` to `freelens-tauri/src-tauri/payload/renderer/`; fail with a message if `freelens/static/build/index.html` is missing. It copies no freelens-k8s-proxy (research R8). It refuses to run when `FREELENS_SKIP_DOWNLOAD_BINARIES=true`, which would skip the verification.
- [x] T017 [US1] Bundle the payload: in `freelens-tauri/src-tauri/tauri.conf.json`, `bundle.resources` maps `payload/arm64/kubectl` to `arm64/kubectl`, `payload/arm64/helm` to `arm64/helm` and `payload/renderer/` to `renderer/`; in `freelens-tauri/package.json`, add the script `tauri:build` running `pnpm tauri:ui && sh scripts/stage-payload.sh && tauri build`. The glob of the renderer payload flattens its directories; the bytes are the same, and the payload is never loaded.
- [x] T018 [P] [US1] Write `specs/001-tauri-shell-spike/responsible-rss.py`: for a given pid, find the pid itself and every process whose responsible pid is that pid, using `responsibility_get_pid_responsible_for_pid` from `/usr/lib/system/libquarantine.dylib` through `ctypes`; print one `proc=<pid> <name> <rss_mb>` line per process and `rss_mb=<total>`, in MB of 10^6 bytes (research R7).
- [x] T019 [US1] Write `specs/001-tauri-shell-spike/measure.sh <mode> <app bundle> <runs> <idle seconds> [kubeconfig]` with the modes `spike` and `electron`, producing the output of contracts/measurement-report.md and the fields `data-model.md` `Measurement run.build`, `Measurement run.run`, `Measurement run.startupS`, `Measurement run.idleRssMb` and `Measurement run.processes`. `spike` starts `Contents/MacOS/freelens-spike --kubeconfig=none` and times it to `Window "main" loaded`; `electron` starts the current build with the data directory and preseeded `lens-user-store.json` of `specs/measure-baseline.sh` and times it to `"first-application-window" loaded`. Both then wait the idle time, take the RSS through T018, count `/.kube` in the log, quit the app and warn about leftover processes. `spike` also prints `dmg_bytes` and `dmg_format` for the dmg in the bundle's sibling `dmg/` directory. Output goes under `$TMPDIR`. The script starts both builds with `open -n`, because started from a shell the app's responsible process is the shell's application and the WebKit helpers are not found (research R7), and it accepts a dmg, which it mounts to copy the app from.
- [x] T020 [US1] Build with `pnpm build` and `pnpm --filter @freelensapp/freelens-tauri tauri:build`, then check the bundle as the Build section of quickstart.md says. If macOS kills the app at launch, re-sign the bundle with `codesign --force --deep --sign - --pagesize 4096` and record it under R10 of `specs/001-tauri-shell-spike/research.md`. Why: research.md lists that risk as unconfirmed. Tauri removes the intermediate `.app` when the dmg is the only target, so the bundle is checked inside the mounted dmg.
- [x] T021 [US1] Run `measure.sh spike` and `measure.sh electron`, three runs of 60 s each, as quickstart.md says; keep the output under `$TMPDIR`. Check SC-001, SC-002 and SC-003, and that the electron runs find the four process kinds of the baseline.
- [x] T022 [US1] Run the side-by-side check of quickstart.md (SC-006, acceptance scenario 4 of User Story 1). Done without the user's installed Freelens, which would use real data and clusters: the current build of `freelens/dist` ran with a temporary data directory alongside the experimental build, and the file metadata (not the contents) of `~/Library/Application Support/Freelens`, `~/Library/Preferences/app.freelens.Freelens.plist` and `/Applications/Freelens.app` was compared before and after.

**Checkpoint**: the three gate figures exist for the experimental build, and the current build's figures agree with the baseline under the new method.

---

## Phase 4: User Story 2 - See the catalog of clusters from a kubeconfig file (Priority: P2)

**Goal**: the main window lists the contexts of the kubeconfig file in effect,
with the messages of FR-008.

**Independent Test**: launch with each option and fixture of the User Story 2
table of quickstart.md and compare the catalog with the table.

### Implementation for User Story 2

- [x] T023 [US2] Implement the catalog page in `freelens-tauri/ui/src/renderer/catalog.ts` and `freelens-tauri/ui/index.html`: fetch `/api/clusters`; show `message` when it is not null; list one button per entry, labelled with `data-model.md` `Catalog entry.name` and carrying `Catalog entry.id`; show a line saying the catalog is empty when there is no entry; request `/api/mark?name=catalog-shown` once the list is in the page. No stylesheet, no framework, no Node.
- [x] T024 [US2] Run the User Story 2 table of quickstart.md in `tauri:dev`, and the no-option row with the built app opened from the Finder. Done with the debug build and a temporary script added to the git-ignored `ui/dist`, which reported as marks the number of cluster buttons, whether a message showed and which file it named, and whether the empty line showed, never the context names. Without an option, the catalog was empty with no message, since the machine has no `~/.kube/config`; the release app opened with `open -n` and no option loaded its window and showed the catalog.

**Checkpoint**: User Stories 1 and 2 work on their own.

---

## Phase 5: User Story 3 - Open a cluster in its own view and see its namespaces (Priority: P3)

**Goal**: a cluster opens in its own isolated frame, which lists its
namespaces through the core, with no credential reaching a view.

**Independent Test**: open the reference cluster and compare the frame's list
with `kubectl get namespaces` (quickstart.md, User Story 3).

### Tests for User Story 3

> Write these first and make sure they fail before T027.

- [x] T025 [P] [US3] Add the `/api-kube` cases to `freelens-tauri/src-tauri/tests/scheme.rs`, with a fake `ClusterApi`: the path must start with `api/` or `apis/`; a `watch` parameter gets `400`; `404` on the main host and for an unknown id; the query string arrives unchanged; no request header of the view is forwarded; the fake's Unreachable becomes `502` with the contract's JSON; status and body pass through otherwise; no response contains `FAKE-TOKEN` or `RkFLRS1DRVJU`.

### Implementation for User Story 3

- [x] T026 [P] [US3] Implement `freelens-tauri/src-tauri/src/clusters.rs`: a `ClusterApi` trait (`get(cluster id, path and query)` returning a status and a body, or Unreachable) and its implementation, which keeps one `kube::Client` per cluster id, created on first use from the kubeconfig kept by T011 with `Config::from_custom_kubeconfig` and the context's name (research R6). Connection failures and timeouts become Unreachable.
- [x] T027 [US3] Implement `/api-kube/<api path>` in `freelens-tauri/src-tauri/src/scheme.rs` as contracts/scheme-routes.md specifies, through `ClusterApi`, and put the implementation of T026 into the `State` built in `freelens-tauri/src-tauri/src/lib.rs`. T025 passes.
- [x] T028 [US3] Add the cluster frames to `freelens-tauri/ui/src/renderer/catalog.ts`: clicking an entry shows its iframe on `freelens-app://<id>.renderer.freelens.app/` and creates it only if it is absent (acceptance scenario 4 of User Story 3); a close control removes the iframe, so that the next open loads the list again (the transitions of `data-model.md` `Cluster view.state`, FR-006).
- [x] T029 [US3] Implement the namespace page in `freelens-tauri/ui/src/renderer/cluster.ts` and `freelens-tauri/ui/cluster.html`: fetch `/api-kube/api/v1/namespaces` once; show the `data-model.md` `Namespace.name` of each item in the order of the response, or the state of `data-model.md` `Cluster view.state` (`502` unreachable, `403` permission missing, any other failure with its status); request `/api/mark?name=namespaces-shown` once the list is in the page.
- [x] T030 [US3] Run the User Story 3 checks of quickstart.md against the reference kind cluster: SC-004 in three attempts, reopening, a namespace created while the frame is open, a stopped cluster, a missing permission, the isolation attempts of SC-005 including the `/api-kube` fetch to another cluster's host, and the credential check of SC-009. Done with the debug build and temporary scripts in the git-ignored `ui/dist`, which drove the catalog and reported what each frame showed as marks; the cluster frame was opened three times. The stopped cluster was replaced by a kubeconfig whose server is the closed port `127.0.0.1:1`, which gives the same refused connection without stopping the kind cluster that Phase 6 needs. The missing permission used a temporary service account without roles. For SC-009, the API server's namespace response held no fragment of the kubeconfig's client certificate or key.

**Checkpoint**: all three user stories work on their own.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: the cluster-open figures of FR-011, the checks of the Electron
build and the Rust core, and the go/no-go report.

- [x] T031 Implement the option `--open-cluster` of contracts/launch-options.md: in `freelens-tauri/src-tauri/src/options.rs` (`data-model.md` `Launch options.openCluster`, with unit tests), as `openOnLoad` of `/api/clusters` in `freelens-tauri/src-tauri/src/scheme.rs` (with a case in `freelens-tauri/src-tauri/tests/scheme.rs`), and in `freelens-tauri/ui/src/renderer/catalog.ts`, which opens that cluster once the catalog is shown and requests the mark `cluster-opened` whenever it creates a cluster's iframe (contracts/log-lines.md).
- [x] T032 Add the mode `spike-cluster` to `specs/001-tauri-shell-spike/measure.sh`: launch with the given kubeconfig and `--open-cluster=kind-freelens-profile`, take `data-model.md` `Measurement run.namespacesShownS` as the time from `Mark "cluster-opened"` to `Mark "namespaces-shown"`, and `Measurement run.clusterRssMb` 60 s after the latter, through T018. The interval is taken by `specs/001-tauri-shell-spike/mark-interval.py`, which reads the log every millisecond; a grep loop could not resolve the few milliseconds it lasts.
- [x] T033 [P] Add a Namespaces scenario to `specs/profile-main.mjs` (environment variable `SCENARIO=namespaces`): after the cluster connects, open the sidebar item `namespaces`, mark when the row `kube-system` shows, wait 60 s, record the RSS of every process of the app through `specs/001-tauri-shell-spike/responsible-rss.py` (freelens-k8s-proxy included), and the JavaScript heap used by the root frame (`Runtime.getHeapUsage` over a CDP session of the root page) for research R3. Why: the current build's cluster-open figures have to come from the same steps (FR-011); the default scenario and its output stay as they are. The scenario starts the app with `open -n`, without the main inspector, so that `responsible-rss.py` finds all of its processes, and reads the heap after the idle seconds with the kind cluster in the catalog.
- [x] T034 Run the cluster-open figures for both builds, three runs each, as the "Cluster-open figures" section of quickstart.md says.
- [ ] T035 Run the Electron checks of quickstart.md (`pnpm build && pnpm type:check && pnpm test:unit`, `pnpm knip:check`, `pnpm test:integration`) for SC-007, and confirm that `git diff --stat 98a9e6e70 -- packages/core freelens/src` prints nothing. Done except `pnpm test:integration`: it needs a kind context in `~/.kube/config`, which this machine does not have and which the run would have to write, and it runs the packaged app of `freelens/dist`, which is the 2.1.0-0 build and not this branch. `pnpm build`, `pnpm type:check`, `pnpm test:unit` (548 files, 6328 tests) and `pnpm knip:check` pass, and the diff is empty.
- [x] T036 Run the Rust checks of quickstart.md, after `pnpm --filter @freelensapp/freelens-tauri tauri:ui`, since Tauri's context macro needs `ui/dist`: `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`, all with `--manifest-path freelens-tauri/src-tauri/Cargo.toml`.
- [x] T037 Run `pnpm biome check` and `pnpm trunk check` over the change; taplo covers `Cargo.toml` and `rust-toolchain.toml`, shellcheck and shfmt the shell scripts.
- [x] T038 Repeat the running-application checks of T024 and T030 on the current build (`freelens/dist/mac-arm64/Freelens.app`) as the control of Principle V, with the same kubeconfig files given through `syncKubeconfigEntries` in a fresh data directory: a missing file, a file without contexts, an invalid file, the reference cluster's Namespaces view, a namespace created while it is open, a stopped cluster, a missing permission. Record each result next to the experimental build's for the report of T039. Done with a scratch Playwright script outside the repository; the stopped cluster was again the closed port of `three-contexts.yaml`, and the missing permission a temporary service account. The script looks for messages in the notifications area and the page text only.
- [x] T039 Write the report into `specs/baseline.md` as `specs/001-tauri-shell-spike/contracts/measurement-report.md` lays out: the figures of T021 and T034, the dmg format, the helper programs bundled and not bundled (FR-013), the JavaScript heap estimate of T033 and its sum with the idle RSS of T021, the result of the method control, and the go or no-go decision (SC-008). Why: `specs/baseline.md` holds the baseline that spec 001 is measured against.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: after Setup; blocks every user story. T015 is
  the go/no-go point for the platform risk.
- **User Story 1 (Phase 3)**: after Foundational.
- **User Story 2 (Phase 4)**: after Foundational.
- **User Story 3 (Phase 5)**: after User Story 2, whose catalog page T028
  extends.
- **Polish (Phase 6)**: T031, T032 and T034 after User Stories 1 and 3; T033
  after T018; T035 to T039 last.

### Within the phases

- T003 before T009 to T014; T010 before T011; T011 before T012; T012 before
  T013 and T014.
- T016 and T017 before T020; T018 before T019; T019 and T020 before T021.
- T025 before T027; T026 before T027; T027 and T028 before T029's check in
  T030.

### Parallel Opportunities

- Setup: T003, T004, T005 and T006 together.
- Foundational: T009 and T010 together.
- User Story 1: T016 and T018 together.
- User Story 3: T025 and T026 together.
- Polish: T033 alongside T031 and T032.

## Parallel Example: User Story 1

```bash
Task: "Write freelens-tauri/scripts/stage-payload.sh (T016)"
Task: "Write specs/001-tauri-shell-spike/responsible-rss.py (T018)"
```

## Parallel Example: User Story 3

```bash
Task: "Add the /api-kube cases to freelens-tauri/src-tauri/tests/scheme.rs (T025)"
Task: "Implement freelens-tauri/src-tauri/src/clusters.rs (T026)"
```

## Implementation Strategy

### MVP first

1. Phase 1 and Phase 2. Stop at T015: if the cluster frame on the custom
   scheme does not load or is not isolated, record a no-go and stop.
2. Phase 3 (User Story 1): the three gate figures. If SC-001, SC-002 or
   SC-003 fails, apply the levers of research R8 or record a no-go.

### Incremental delivery

1. Setup and Foundational: the shell and the frame proof.
2. User Story 1: the gate figures.
3. User Story 2: the catalog.
4. User Story 3: the cluster view and the credential and isolation checks.
5. Polish: the cluster-open figures, the checks and the report.

Run the checks of quickstart.md after each phase and commit the phase's files
by name, never with `git add -A`.

## Notes

- [P] tasks touch different files and depend on no unfinished task.
- Scratch output of builds and measurements goes under `$TMPDIR`, never into
  the repository.
- The commands of quickstart.md are the acceptance checks of each phase.

---

## Phase 7: Convergence

- [ ] T040 Run `pnpm test:integration` of the Electron build on this branch, after `pnpm build:app` repackages `freelens/dist` and with a kind context the tests can reach, and record the result for SC-007 in `specs/baseline.md` per SC-007 (partial) Partly done: on the repackaged app, the three test files that need no cluster pass (4 tests, 2 skipped). The four KinD tests fail to find `kind-kind` in the catalog, because the run put the kind kubeconfig in a temporary `HOME` to keep the user's kubeconfigs out of it, and the app reads `~/.kube` from `os.userInfo().homedir`, not from `HOME`. Running them needs a kind context in a real file under `~/.kube`, which is the user's decision.
- [x] T041 Check, with two cluster frames open at once, that content in one cannot read the document, the `localStorage` keys or the `/api-kube` data of the other, and record the result under R4 of `specs/001-tauri-shell-spike/research.md` per SC-005 (partial)
- [x] T042 Show a loading line in `freelens-tauri/ui/src/renderer/cluster.ts` until the namespace request answers, for the `Loading` state of `data-model.md` `Cluster view.state` per plan: data model (partial)
- [x] T043 Correct the `knip.jsonc` line of the source tree in `specs/001-tauri-shell-spike/plan.md`, which names a workspace for `freelens-tauri` where the change added ignore entries and spec-script entries per plan: project structure (contradicts)
