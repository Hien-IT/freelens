---
description: "Task list for spec 009: main cluster connection"
---

# Tasks: Main Cluster Connection

**Input**: Design documents from `specs/009-main-cluster-connection/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/,
quickstart.md

**Tests**: requested. FR-032 and SC-008 ask that the behaviour of the existing
tests of the area hold in tests of the core (research R19), SC-007 asks for a
test of each channel's answer, SC-009 for a search of every message for
credentials, and research R18 proves parity with fixtures that the Electron
build's own code and the core both assert. In each group, a test task comes
before the code it tests.

**Organization**: the phases follow the implementation order of plan.md, risk
first, rather than the priority order of spec.md: the shared `Clusters`
handle and the client are foundational; then the watches and the `/api-kube/`
route (User Story 2), measured once before anything else is built on them;
the credentials and the shell sync, then the connection (User Story 1);
disconnecting and deleting (User Story 3) and the other channels (User Story
4); the Tauri build's own pages, whose tasks carry the story each serves; the
measurements (User Story 5); and the channel list and routes in the last
phase. Every phase ends with the cargo gates.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an
  unfinished task)
- **[Story]**: the user story of spec.md the task belongs to
- A task that changes existing code says why.

## Path Conventions

- `core/` is `freelens-tauri/src-tauri/`: `core/src/…`, `core/tests/…`.
- `pc/` is `packages/core/src/`, the Electron build.
- `ui/` is `freelens-tauri/ui/src/renderer/`, the Tauri build's own pages.
- `fixtures/` is `core/tests/fixtures/cluster/`.
- **The cargo gates**: `cd freelens-tauri/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test`.
- Every command runs from the repository root unless it starts with `cd`.
- No test, measurement or manual step reads the user's own `~/.kube` or data
  directory, nor uses `KUBECONFIG` implicitly: each uses a temporary
  directory, `--data-dir`, a user store whose syncs it sets itself, and
  `--kubeconfig` on every `kubectl` and `kind` command.
- The Vitest commands run with the root config, as `pnpm test:unit` does:
  `TZ=UTC pnpm exec vitest run -c vitest.config.ts <file>`.
- No key or certificate file is committed: tests make them with `openssl` in
  a temporary directory, as `core/tests/foundation.rs` does, and fixtures hold
  placeholder credentials only.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: record what the later checks compare against, add what the
plan's Technical Context adds, and build the fake API server every later test
uses.

- [x] T001 Record the baseline on the current commit, outside the repository, in the session's scratch directory: the names of the tests `cd freelens-tauri/src-tauri && cargo test -- --list` prints, and the summary of `pnpm test:unit` (test files and tests per project). Nothing is written in the repository. Why: FR-031 requires every existing test to pass unchanged, which T070 compares against. Done: 294 cargo tests listed (293 pass, 1 ignored); `pnpm test:unit`: 592 test files passed, 7242 tests passed, 29 skipped.
- [x] T002 In `core/Cargo.toml`, turn on kube's `http-proxy`, `socks5` and `oidc` features beside its defaults, tokio's `process` feature, and add `sha2` at the 0.10.9 that `core/Cargo.lock` already holds. Run `cd freelens-tauri/src-tauri && cargo build && cargo test`. Check with `git diff core/Cargo.lock` that no package is added; record the result in research R2 of `specs/009-main-cluster-connection/research.md`, and if a package is added, list it there and reopen R2 before T008. Why: plan.md's Primary Dependencies; R2 rests on adding no crate. Done: `cargo build` and the 293 tests pass; `Cargo.lock` gains no package, only the edges from kube-client to `form_urlencoded` and `ipnet` and from the crate to `sha2`, recorded in research R2.
- [x] T003 [P] Leave `freelens-tauri/src-tauri/tests/fixtures/cluster/**` out of Biome in `biome.jsonc` and out of Trunk in `.trunk/trunk.yaml`, next to the entries for `tests/fixtures/catalog/` and with the same kind of comment. Why: the fixtures are the API server's answers and the expected messages, data rather than code (research R18). Done.
- [x] T004 [P] Create the fake API server `core/tests/fake_api/mod.rs`, written in the way of `server()` and `acceptor()` of `core/tests/foundation.rs`: HTTP/1.1 over a `TcpListener`, plain or TLS with a certificate and key that `openssl` makes in a temporary directory; answers scripted by method and path (status, headers, body); a streamed answer whose chunks the test pushes and ends, for watches; a delayed answer; a connection dropped before or after the head; every request recorded with its method, path, query, headers and body; and the count of open connections. Add a helper that writes a kubeconfig in a temporary directory naming the server, with a context per credential kind (a placeholder token, a token file, a user and password, an `auth-provider: oidc` `id-token`, `as` and `as-groups`, a client certificate and key made by `openssl`, an `exec` plugin script the test writes, `proxy-url`), and a TLS mode that asks for a client certificate and records the one presented, and a helper that writes a credential plugin script answering a given `ExecCredential`, failing with a given code, or sleeping. Unit tests in `core/src/cluster/` include it with `#[cfg(test)] #[path = "../../tests/fake_api/mod.rs"] mod fake_api;`. Why: research R18; every test of the area needs an API server it controls. Done. The certificates are a CA and a server and a client certificate signed by it, since kube trusts the CA of `certificate-authority-data`; the kubeconfig is written as JSON, which is YAML. `core/tests/cluster.rs` starts with two tests of the server itself: kube over TLS with a client certificate, and a streamed watch with the connections counted.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the shared handle of contracts/clusters-api.md with the client of
research R2, and the two additions to the messaging that the watches and the
connection updates need. Until User Story 1 adds the connection, `Clusters`
treats every cluster of the catalog as connected, as the route of spec 001
did, so that the watches can be built and measured first.

**⚠️ CRITICAL**: no user story work can begin until this phase is complete.

- [x] T005 [P] Write the unit tests in the `tests` module of `core/src/messaging/queues.rs` for a message that a later one appends to: `push_appending(view, channel, key, text)` pushes a message when none with that key waits, appends `text` to the `text` of the one that waits otherwise, and pushes a new one once the waiting one has been delivered (a poll whose `after` covers it); the message keeps its sequence number; a view's queue holds at most one waiting message per key, so 20 000 appended chunks do not close it (data-model.md `Watch.id`). Why: research R10; a watch must never reach the queue's 10 000 limit. Done, in the module's `tests`; a keyed message answered by a poll takes no more text even before the view acknowledges it, so that no text is lost.
- [x] T006 [P] Write the unit tests in the `tests` module of `core/src/messaging/mod.rs` for `Sender::send_named(name, message)`, which sends on a channel whose name is built at run time to every open view, as `send` does for a static `MessageChannel`. Why: `cluster:<clusterId>:connection-update` is one name per cluster (research R14). Done.
- [x] T007 Add `push_appending` to `core/src/messaging/queues.rs` and `send_named` and a `send_appending_to(view, channel, key, message)` to `Sender` in `core/src/messaging/mod.rs`. Make T005 and T006 pass. Why: T005 and T006. Done. The key is recorded before the message is appended, since appending can answer a waiting poll, which clears the keys.
- [x] T008 [P] Write the unit tests of `core/src/cluster/client.rs` against the fake API server, porting `pc/main/k8s-request.test.ts` and `pc/features/cluster/connections/main/__tests__/api-url.test.ts` (research R19): the core's own JSON request answers the parsed body on 200, and on another status fails with `statusCode`, `error` the trimmed body or the status text when the body is empty, and the message `Failed to get <path> for clusterId=<id>: <error>`, within a 30 s limit; a changed server in the kubeconfig file reaches the next request once the catalog reports `ClusterChanged`, and the same file read once while unchanged. Add: no retry of a `503`, `429` or `504` from the API server for any method (data-model.md `Connection.client`); a streamed body that stays quiet for 40 s is not cut (paused time); the proxy taken from the kubeconfig's `proxy-url`, else the cluster's `httpsProxy` setting, else `HTTPS_PROXY` of the environment the test gives the builder, through a CONNECT proxy like `connect_proxy()` of `core/tests/foundation.rs`, with `NO_PROXY` honoured for the last; an `HTTPS_PROXY` no longer failing the client's build; the client dropped on `ClusterRemoved`. Add also: each credential kind of T004 reaching the fake server as the API server sees it: a token and an `id-token` as `Authorization: Bearer`, a token file read again once it changes (paused time, after 60 s), a user and password as Basic, a client certificate presented in the TLS handshake, `as` and `as-groups` as the impersonation headers (FR-006). Why: research R2. Done, in the module's `tests` with the fake API server. Three differences: the 30 s limit is tested with a shorter limit the test sets, since paused time also advances kube's connect limit while a real socket connects; that a quiet answer is not cut is checked on the client's configuration (no read or write timeout, no retry, a 30 s connect limit) for the same reason; and the token file is checked on its first read, since kube reads it again on the wall clock, not on tokio's, 50 s later (research R2). The environment's `HTTPS_PROXY` and `NO_PROXY` are tested in `core/tests/cluster_proxy_env.rs`, a binary of its own, since the test sets the process environment, which kube reads.
- [x] T009 Move `core/src/clusters.rs` to `core/src/cluster/client.rs` with `git mv`, create `core/src/cluster/mod.rs` with the `Clusters` handle and the `ClusterClient` of contracts/clusters-api.md, and build each client as research R2 decides: `Kubeconfig::read_from` and the context, `default_retry = false`, `connect_timeout` 30 s, no `read_timeout`, the proxy order of T008 (data-model.md `Connection.client`), dropped on `ClusterChanged` and `ClusterRemoved`. Keep the core's own JSON request of T008 on `ClusterClient`. Until T046, `Clusters` reports every cluster of the catalog as connected. Make T008 pass. Why: every later area takes its client from `Clusters`; spec 001's `KubeClusters` and `ClusterApi` go. Done differently: `ClusterApi` and `ApiOutcome` stay in `core/src/cluster/client.rs`, implemented for `Clusters`, until T020 removes the spike's GET route with them, so that `core/tests/scheme.rs` keeps its fake; `Clusters::client` answers a `Result` whose `ClientError` gives the route its reason (contracts/clusters-api.md now says so). `Catalog::store_entry` gives the client the cluster's `httpsProxy`.
- [x] T010 In `core/src/lib.rs`, build `Clusters` after the catalog, the stores and the frame record, add `clusters` to `Core`, and give `scheme::State` the handle in place of `clusters: Box<dyn ClusterApi>`, so that the spike's GET `/api-kube/` route of `core/src/scheme.rs` keeps its answers through `ClusterClient` until T020 replaces it. Run the cargo gates: every test of T001 passes unchanged in what it asserts. Why: T009's handle replaces `KubeClusters`. Done: `Core` gains `clusters`, built in `build`; `scheme::State` keeps a `Box<dyn ClusterApi>`, now `Clusters`. fmt, clippy and 314 cargo tests pass (293 of T001, none gone, and 21 new).

**Checkpoint**: one handle gives every area its cluster client; the stories can start.

---

## Phase 3: User Story 2 - Browse and watch resources through /api-kube (Priority: P2)

**Goal**: a cluster frame's requests of every method reach its own cluster's
API server with the context's credentials, with the Electron build's rules,
and its watches stream to it over its queue (FR-012 to FR-018). The watches
come first and are measured before the rest is built on them (plan.md,
implementation order 1).

**Independent Test**: User Story 2's test of spec.md: the same requests from a
cluster frame of each build give the same answers, and a pod created or
removed with `kubectl` reaches an open list no later than in the Electron
build (quickstart.md section 3).

### Watches, first

- [x] T011 [P] [US2] Write `core/tests/api_kube.rs`, watch part, driving `messaging::routes::handle` as `core/tests/foundation.rs` does, against the fake API server, for every row of contracts/kube-watch.md: `kube-watch:open` from a cluster frame answered with the head before the first event (the "watch headers arrive before the first event" cases of `pc/main/freelens-proxy/freelens-proxy.test.ts`); `kube-watch:data` in order, a character split across chunks kept for the next message, chunks appended while one waits (data-model.md `Watch.decoder`); `kube-watch:end` without `error` when the server ends the body (the "a watch ends when the target drops its connection" case) and with `error` when the request fails; a non-2xx head answered with its whole `body` and nothing more; `kube-watch:close` dropping the request, seen as a closed connection at the fake server (the "a client HTTP/2 cancel ends the upstream stream" and "a client closing its HTTP/1.1 connection ends the upstream stream" cases); the frame's queue restarting or closing and its frame forgotten ending its watches (data-model.md `Watch.view`); 4 h without a chunk ending it with `error` (data-model.md `Watch.last_activity`, paused time); the main window refused; an id in use, an id outside `[A-Za-z0-9-]{1,64}` and a path that is not normalized refused (data-model.md `Watch.id`); the filtered headers of contracts/api-kube.md reaching the server; and twenty watches open at once while a list request through `/api-kube/` is answered without waiting for any of them to end (FR-014). Done, 14 cases in `core/tests/api_kube.rs`, among them twenty watches beside a request (FR-014) and a cluster leaving the catalog, and the frame recorded with `cluster:set-frame-id` first, since the frame record forgets only a frame it has.
- [x] T012 [US2] Create `core/src/cluster/watch.rs` with the four channels of contracts/kube-watch.md (data-model.md `Watch.id`, `Watch.view`, `Watch.request`, `Watch.decoder`, `Watch.last_activity`): the request sent through `ClusterClient::send` with the header filter of contracts/api-kube.md, the head answered, the body decoded and sent with `send_appending_to` keyed by the watch, the end, and the watch dropped on `kube-watch:close`, on the view's `QueueEvent::Restarted` and `QueueEvent::Closed`, and on `FrameEvent::Forgotten`. Register it from `core/src/cluster/mod.rs`. Make T011 pass. Done. The open request is answered from a task that sends the request and streams the body, so that `kube-watch:close`, a queue event, a forgotten frame or the cluster leaving the catalog can abort it at any point; a watch is forgotten by a token, so that an id reused after its end is not dropped by the old task. `register_with` takes another inactivity limit for tests.
- [x] T013 [P] [US2] Create `ui/kube-fetch.ts` with `kubeFetch` of contracts/kube-watch.md: a watch URL under `/api-kube` opened with `kube-watch:open` through the page's messaging of `ui/messaging.ts`, answered as a `Response` whose body is a `ReadableStream` fed by `kube-watch:data`, closed by `kube-watch:end`, errored by an `end` with `error`, and whose cancel or `init.signal` sends `kube-watch:close`; any other URL passed to `fetch`. Build the pages with `pnpm --filter @freelensapp/freelens-tauri tauri:ui`. Done.
- [x] T014 [US2] Give the frame page `ui/cluster.ts` a first version of the lists of research R15: Config Maps and Pods for all namespaces, each a table of name and namespace, loaded with a list request through `/api-kube/` and kept current with a watch from the list's `resourceVersion` through `kubeFetch`, applying `ADDED`, `MODIFIED` and `DELETED`; post a mark with the wall clock when each list's first row is in the document. Keep the namespace list of spec 001 until T059. Why: the first measurement of plan.md needs a page that lists and watches. Done, with the list in `ui/kube-list.ts` (`LiveList`): one watch for all namespaces with `globalWatch`, else one per namespace, opened again a second after it ends, the list loaded again after a `410`. The frame marks `<step>-<wall clock ms>`, the core's marks taking only a name, and, for SC-005, `row-in-` and `row-out-` of the pods named `measure-<n>`. The scenario of `--scenario=lists` (T061) came forward: the option, the flag passed to the catalog page and on to the frame, and the frame running Config Maps then Pods.
- [x] T015 [US2] Write `specs/009-main-cluster-connection/measure-connection.mjs`, with the single-line Freelens header, its common part (a temporary directory printed as `workdir=`, a user store that syncs only the kind kubeconfig, the Electron build started as `specs/profile-main.mjs` starts it, the Tauri build with `--data-dir`) and first versions of the modes `lists` and `watch` of research R17: the times to the first Config Map row (All Namespaces, 3000 ConfigMaps) and to the first Pod row, and from `kubectl --kubeconfig … create` or `delete` of a pod to its row appearing or leaving, taken in the page in both builds (the Tauri page's marks; in the Electron build a script injected through CDP into both frames, recording the same points with a `MutationObserver`). Run it three times per build on the kind cluster of `specs/baseline.md`. Record the medians in research R10 of `specs/009-main-cluster-connection/research.md`. A Tauri median above the Electron one reopens research R10 and R2 before T017. Done: the medians are in research R10 (Electron, then Tauri: first Config Map row 105 and 35 ms, first Pod row 29 and 3 ms, a pod's row 427 and under 1 ms to appear, 953 and under 1 ms to leave, CPU 0.73 and 0.06 s); R10 and R2 stand. The Electron build detects a pod's row by the frame's text, since its table renders a row under several elements.
- [x] T016 [US2] Run the cargo gates. Done: fmt, clippy and the cargo tests pass.

### The /api-kube/ route

- [x] T017 [P] [US2] Write `core/tests/api_kube.rs`, route part, porting the groups "kube api requests", "redirects", "refused target" and "cluster proxy cannot start" of `pc/main/freelens-proxy/freelens-proxy.test.ts` (research R19), for every row of contracts/api-kube.md: `Cache-Control: no-store` on every answer, the refused ones included, whatever the API server sends; each method of the rows forwarded with its path, query and body (a POST body included); `Authorization`, `Cookie`, `Origin`, `Host`, the hop-by-hop headers, `Accept-Encoding` and the headers a `Connection` header names not reaching the server, `Accept`, `Content-Type`, `User-Agent` and an `X-` header reaching it; the context's credentials added; a refused target answering `500` `Oops, something went wrong.\n<reason>` with no retry; a client that cannot be built answering the `503` `Status` with `Failed to start the proxy of cluster <id>: <reason>`; a response cut after its head answered with the head and the body so far; no head within 30 s and 30 s without a chunk (paused time); a `503` of the API server passed on as it is; a watch query answered `400` with the `Status` naming `kube-watch:open`; a path that is not normalized answered `400` `Bad Request`; the main window refused (spec 004); the cluster taken from the frame's host, never from the path. Move the `/api-kube/` cases of `core/tests/scheme.rs` here, where they keep what they assert. Done, 12 more cases in `core/tests/api_kube.rs`. The eight `/api-kube/` tests of `core/tests/scheme.rs` move here with the behaviour of the route: the status and body passed through and the error status passed through keep what they assert; the main host's 404 and the refused watch too, the watch now with a `Status` naming `kube-watch:open`; the GET-only, the `/api/`-and-`/apis/`-only and the 502 of an unreachable cluster give way to every method, any normalized path and the 500 of contracts/api-kube.md; and the view's headers are now filtered rather than all dropped. The 503 of a disconnected cluster comes with T042.
- [x] T018 [P] [US2] Write the unit tests of the `Location` rewrite in the `tests` module of `core/src/cluster/api_kube.rs`, porting every case of `pc/main/freelens-proxy/cluster-route-redirect.test.ts` (research R19): `/api` to `/api-kube/api/`, the query kept, a relative location, an absolute URL of the API server, another host and another port left alone, an unreadable location left alone, a server with a base path (below it, relative below it, the base itself, outside it, a path sharing its first letters), a trailing slash on the server URL. Done, with WHATWG URL resolution from the `url` crate, already locked through Tauri and now a direct dependency.
- [x] T019 [P] [US2] Write the unit tests of what makes a request a watch in the `tests` module of `core/src/cluster/api_kube.rs`, porting `pc/main/__test__/freelens-proxy.test.ts` (research R19): `watch=true`, `watch=1` and a bare `watch` are watches, `watch=false`, `watch=0` and none are not, the same for `follow`, and `F` and `FALSE` in any case are false. Done, in `core/src/cluster/api_kube.rs` with the normalization rule.
- [x] T020 [US2] Create `core/src/cluster/api_kube.rs` with the routes of contracts/api-kube.md, added to the route table from `core/src/cluster/mod.rs`, and remove the GET `/api-kube/` route, `kube()` and the `ClusterApi` use from `core/src/scheme.rs`. Make T017, T018 and T019 pass. Why: FR-012 to FR-017; the spike's GET-only route goes (research R9). Done; `ClusterApi`, `ApiOutcome` and `State.clusters` go with the spike's route. The client keeps the API server's URL for the redirects.
- [x] T021 [US2] Run the cargo gates. Done: fmt, clippy and 349 cargo tests pass (285 of T001 and 64 new; the eight of T017 moved).

**Checkpoint**: a frame lists, edits and watches its cluster through the core; User Story 2 works with every cluster treated as connected.

---

## Phase 4: User Story 1 - Connect a cluster of the catalog (Priority: P1), credentials and the shell sync

**Goal**: credential plugins run by the core with the login shell's
environment (FR-006, FR-033 to FR-035).

**Independent Test**: User Story 1's acceptance scenario 6, as quickstart.md
section 2 runs it for the plugin on the test shell's `PATH`.

- [x] T022 [P] [US1] Write the unit tests of `core/src/foundation/shell_env.rs` with a spawner the test drives, porting `pc/features/shell-sync/main/compute-unix-shell-environment.test.ts` (research R19) for every row of contracts/shell-sync.md: the arguments and stdin for csh and tcsh, for bash, sh and zsh, and for fish; stdin closed; the three variables added for the shell and reset in the result; `Failed to spawn …`, `Shell did not exit successfully: …` for an exit code and for a signal; the parsing of multi-line values, values with `=`, an exported function, noise outside the marks, records without `=`, and missing marks; the 30 s limit killing the process group once, a later close still giving the timeout, a close or an error before the limit killing nothing, an already passed limit sending no command, and no pid killing nothing. For pwsh and pwsh-preview, the `-Login -Command` script of research R4 and its JSON, with no `ELECTRON_*` variable. Why: research R4. Done differently: the run of a shell is split into pure parts, tested as the Electron test checks them (the invocation by shell, the stdin, the parsing, the overrides reset, the failure texts), and a runner on real scripts, tested in T024 (the limit killing the process group, a shell that cannot start). The Electron test's fake spawn checks the order of events of a Node child process, which `tokio::process` does not have. The failure of a spawn carries `{error: {message}}`, where Node's carries its own error object.
- [x] T023 [P] [US1] Write the unit tests of the merge in `core/src/foundation/shell_env.rs`, porting `pc/features/shell-sync/main/union-env-path.test.ts` (research R19): one `PATH` unchanged, doubled separators collapsed, repeats removed with the new entries appended in order, for two and three inputs; and the rules of contracts/shell-sync.md "The result": the core's own value winning for any other variable, `LANG` made from the preferred language when the shell gives none, `.UTF-8` appended when missing. Done.
- [x] T024 [P] [US1] Write `core/tests/shell_env.rs`, porting `pc/features/shell-sync/startup-failure-notification.test.ts` (research R19) with real test shells written as scripts in a temporary directory and named by the `shell` setting of a temporary user store: a shell that exits 1 gives `shell-sync-failed-channel` to the main window once its page first polls, with the error, and nothing on a second page load; a successful shell sends nothing; `ShellEnv::start` returns at once while a slow shell runs, and `vars()` resolves when it ends, or with the core's own environment when the limit passes (a short limit for the test); the shell environment never in the log. Done, five cases. The queues gain a listener of a view's first poll (`Sender::on_queue_opened`), since no `QueueEvent` reports a first page load and adding one changed what the tests of specs 002 and 004 assert.
- [x] T025 [US1] Create `core/src/foundation/shell_env.rs` with `ShellEnv` of contracts/clusters-api.md (data-model.md "Shell environment") and the shell sync of contracts/shell-sync.md: the shell from the `shell` setting, the system's user database (`getpwuid`), `$SHELL` or `zsh`; `setsid` and its own process group through `libc`; the 30 s limit with `SIGKILL` of the group; the merge, with the locale from `NSLocale.preferredLanguages` through `objc2-foundation`; the failure logged `[SHELL-SYNC]: <error>` and kept. In `core/src/lib.rs`, start it at startup without awaiting it, send its failure on `shell-sync-failed-channel` on the main window's `QueueEvent::Restarted`, and stop it on quit. Make T022 to T024 pass. Done. `run` starts the shell sync inside `tauri::async_runtime::block_on`, so that its task runs on the runtime, without waiting for it; `Clusters` keeps the process environment until `set_shell` gives it the shell sync's. objc2-foundation gains its `NSArray`, `NSEnumerator` and `NSLocale` features, no crate.
- [x] T026 [P] [US1] Write the unit tests of `core/src/cluster/exec.rs` with plugin scripts the test writes, for research R3: a command with `/` resolved against the kubeconfig's folder, a bare one found on the `PATH` of the `ShellEnv` and not on the core's own; the plugin's environment, the kubeconfig's `env` entries winning over the shell's; `KUBERNETES_EXEC_INFO` with the kubeconfig's `apiVersion`, `spec.interactive: false`, and `spec.cluster` only with `provideClusterInfo`; a token result and a client certificate and key result (data-model.md `Credential.token`, `Credential.client_tls`); the credential reused until 60 s before its `expirationTimestamp`, then renewed (data-model.md `Credential.expires_at`, paused time); one without expiry reused until a `401` drops it; two requests during a run sharing it (data-model.md `Credential.run`); a run killed with its process group by `stop`, no process left; a plugin that waits for the shell sync before it runs (FR-035); the failure texts of research R3 for an exit code and a missing command; `interactiveMode: Always`; the plugin's stdout in no log line. Done: 11 cases in `core/src/cluster/exec.rs` with plugin scripts, and two in `core/src/cluster/client.rs` (a `401` drops the credential and the next client runs the plugin again; a failing plugin is a `ClientError::Credential` with no request sent). The fake API module is loaded once in the lib, from `core/src/cluster/mod.rs`.
- [x] T027 [US1] Create `core/src/cluster/exec.rs` with the runner of research R3 on `tokio::process` (data-model.md `Credential.token`, `Credential.client_tls`, `Credential.expires_at`, `Credential.run`), and make `core/src/cluster/client.rs` build a context with `exec` from its credential: the `AuthInfo` given the `token`, or `client-certificate-data` and `client-key-data`, in place of `exec`, the client built again when the credential renews or a `401` drops it. Make T026 pass. Done. The plugin's credential replaces the user's `exec` through a JSON round trip of kube's `Kubeconfig`; a client keeps the credential's expiry and is built again 60 s before it. The expiry is read with the `jiff` that k8s-openapi re-exports.
- [x] T028 [US1] Run the cargo gates. Done: fmt, clippy and 386 cargo tests pass.

**Checkpoint**: the core reaches clusters with every credential kind, credential plugins included, with the login shell's environment.

---

## Phase 5: User Story 1 - Connect a cluster of the catalog (Priority: P1) 🎯 MVP, the connection

**Goal**: the connection's steps, messages, classification, backoff, timers,
accessibility, metadata, state and phase, as the Electron build has them
(FR-001 to FR-011, FR-028).

**Independent Test**: User Story 1's test of spec.md: connecting the kind
cluster and the made-up contexts gives the same messages and states in both
builds (quickstart.md section 2).

### Parity fixtures

- [x] T029 [P] [US1] Create the fixture cases of research R18 in `fixtures/`, one directory per case with `case.json` (the kubeconfig context with a placeholder credential, the cluster store entry's settings, the steps: activate, refresh, the 30 s or 15 min timer, network offline or online), `api/` (the API server's answers by method and path, a status, a body, a delay or a refused connection) and `expected/` (`updates.json`, `states.json`, `metadata.json`, `phases.json`), written by T030 in its update mode. Cases: `connected` (as the kind cluster answers), `refused-port`, `token-refused-401`, `forbidden-403`, `server-error-500`, `credential-plugin-failure`, `timeout`, `timeout-with-exec`, `third-auth-failure`, `namespaces-forbidden` and `namespaces-forbidden-with-default`, `accessible-namespaces-setting`, `skip-namespace-authorization-check`, `incomplete-rules-review`, `api-group-failing`, `api-list-failing-first-time`, `network-offline-online`; and for the metadata, `distribution-<rule>` for each of the 21 rules of research R7, `nodes-remaining-count`, `nodes-continue`, `id-from-namespace` and `id-from-server-url` with servers written in the forms research R7 lists. Done, 44 cases. `api.json` is one file of rules rather than an `api/` directory, and `expected/` also holds `forbidden.json`, the count of `cluster:list-namespace-forbidden`; the twentieth rule gives `distribution-openshift` and `distribution-custom`, and `id-from-server-url-with-path` adds a path form.
- [x] T030 [P] [US1] Write `pc/main/cluster/tauri-parity.test.ts`, following `pc/main/catalog-sources/tauri-parity.test.ts`: for each case of `freelens-tauri/src-tauri/tests/fixtures/cluster/`, build the Electron build's own `ClusterConnection` and `detectClusterMetadata` with `k8sRequest`, client-node's requests and the proxy manager replaced as `pc/main/cluster/cluster-connection-auth-backoff.test.ts` and `pc/features/cluster/refresh-accessibility-technical.test.ts` replace them, answering from the case's `api/`; run its steps with fake timers; record the messages of `broadcastConnectionUpdate`, the states, the metadata and the entity phases of `ClusterManager`; assert them against `expected/`. With `UPDATE_TAURI_PARITY=1` it writes `expected/`. Done. The transport is replaced under `k8sRequest` (`lensFetch`) and under client-node (its HTTP library), so the Electron build's own error texts, state sync and `ClusterManager` phases are what the files record.
- [x] T031 [US1] Run T030 in update mode and review `expected/` against contracts/connection.md and data-model.md; fix the contract or the data model where the Electron build differs, and note each difference in this task. Then run T030 without the variable: it passes. Done. One difference, fixed in the core: `network:offline` sends `online` and `accessible` cleared as two states, as the cluster manager sets them outside an action. Kept as the Electron build does it: a first-time failure of the API list still ends with `Connected, waiting for view to load ...` and the phase `connected` with `ready` false; the 30 s timer that fires with the timeout of `/version` is skipped, so one timeout update.

### Tests for the connection

- [x] T032 [P] [US1] Write the unit tests of `core/src/cluster/connection.rs`, porting `pc/main/cluster/cluster-connection-activation.test.ts` (research R19): two non-forced activations sharing one run, one client build and one `[CLUSTER]: activate` line; a forced activation waiting for the one in flight, after its success and after its failure; a non-forced activation after a success doing nothing, a forced one running again; a failed start sending `Failed to start connection: <error>` and a later non-forced activation running again (data-model.md `Connection.activated`, `Connection.activation`). Done.
- [x] T033 [P] [US1] Write the unit tests of the status check and the backoff in `core/src/cluster/connection.rs`, porting `pc/main/cluster/cluster-connection-auth-backoff.test.ts` (research R19) with paused time: every row of contracts/connection.md "The status check"; the 30 s check; a counted failure skipping the next check and allowing one after 60 s, then 300 s (data-model.md `Connection.next_refresh_allowed_at`); the third counted failure's message and the pause, even 600 s later (data-model.md `Connection.consecutive_auth_failures`); a reconnect and a disconnect then activation resetting it; a success after a failure resetting it; a timeout without `exec` and a 5xx without a plugin's text not counted; two concurrent checks making one request (data-model.md `Connection.refreshing`). Done.
- [x] T034 [P] [US1] Write the unit tests porting `pc/main/__test__/cluster.test.ts` (research R19) in `core/src/cluster/connection.rs`: activate, reconnect and disconnect do not fail; and the deliberate differences of research R5: one pair of timers however many activations (data-model.md `Connection.timers`), an activation applying nothing after a disconnect (data-model.md `Connection.generation`). Done.
- [x] T035 [P] [US1] Write the unit tests of `core/src/cluster/access.rs`, porting `pc/main/cluster/request-non-core-api-versions.test.ts` (research R19): `/apis` requested; no group, one group with one version, several versions, several groups, each version a `{group, version, path}` in order. Done.
- [x] T036 [P] [US1] Write the unit tests of the rules review in `core/src/cluster/access.rs`, porting `pc/common/cluster/request-namespace-list-permissions.test.ts` (research R19): the review sent for the namespace; an incomplete review allowing all; `*` on `*` first or last; `list` on `*`; `list` on the exact group and resource, first or last; `get` alone refused; `list` on another resource refused; a failed review allowing all (data-model.md `ClusterState.resourcesToShow`). Done.
- [x] T037 [P] [US1] Write `core/tests/cluster.rs`, accessibility part, porting `pc/features/cluster/refresh-accessibility-technical.test.ts` (research R19), its skipped cases included, against the fake API server: the requests in the order of contracts/connection.md "Accessibility" (the two access reviews, the namespaces, `/api`, `/apis`, each group version, the rules review per namespace); an incomplete review showing `pods` and `namespaces`; an empty rules list, a `list` rule on `pods`, and several rules with `list` not first each showing `pods` and not `namespaces`; `knownResources` entries as data-model.md `ClusterState.knownResources` gives them, `ready` from them (data-model.md `ClusterState.ready`), `allowedNamespaces` and `isGlobalWatchEnabled` and `isAdmin` (data-model.md `ClusterState.allowedNamespaces`, `ClusterState.isGlobalWatchEnabled`, `ClusterState.isAdmin`). Done.
- [x] T038 [P] [US1] Write the unit tests of `core/src/cluster/detect.rs`, porting `pc/main/cluster-detectors/cluster-nodes-count-detector.test.ts` (research R19): `limit=1` with `remainingItemCount` 41 and one item giving 42 in one request; `continue` without a count requesting the whole list (3); one page without `continue` giving its length. Done.
- [x] T039 [P] [US1] Write the unit tests of `core/src/cluster/detect.rs`, porting `pc/main/cluster-detectors/detect-cluster-metadata.test.ts` (research R19): `lastSeen`, `version`, `id`, `nodes` and `distribution` added; and the rules of research R7: the highest accuracy per key, a tie to the later, a failed detector left out, the result replacing the metadata (`prometheus` dropped), the 21 distribution rules in order, the id as SHA-256 hex of the namespace's uid and of the server URL written as research R7 writes it. Done.
- [x] T040 [P] [US1] Check that the tests of spec 008 in `core/src/catalog/entities.rs` cover every case of `pc/main/cluster/update-entity-spec.test.ts` (research R19): a `data:` icon on `spec.icon.src`, a colour on `spec.icon.background` with no `src`, a `null` icon clearing both and the setting, the metrics `source` made `local`, a non-local source left alone, a local source given the Prometheus address and type, and switching between image and colour; add the missing cases. Done, two tests added to `core/src/catalog/entities.rs`.
- [x] T041 [P] [US1] Check that the tests of spec 007 in `core/src/stores/cluster.rs` cover every case of `pc/features/cluster/storage/cluster-storage.test.ts` (research R19): a cluster stored with its preferences, several clusters, a kubeconfig written by the custom path read back, a store file loaded with its preferences, three clusters in file order, a model that fails validation not loaded and written back unchanged after the valid ones; add the missing cases. Done, covered by the spec 007 fixture `invalid-clusters`.
- [x] T042 [P] [US1] Write `core/tests/cluster.rs`, connection part, through the channels against the fake API server: `activate-cluster` giving the updates of contracts/connection.md on `cluster:<id>:connection-update` in order (data-model.md "Connection update"), the state on `cluster-state-sync` with its fields in order (data-model.md `ClusterState.online`, `ClusterState.disconnected`, `ClusterState.accessible`), every cluster's state once at startup, `initial-cluster-state-sync` answering every cluster of the catalog, the entity's phase on `catalog:items` from `disconnected` to `connecting` to `connected` (data-model.md "Phase of a cluster entity"), `version` and `lastSeen` in the cluster store entry after a status check and the other keys after `cluster:refresh-accessibility`; `cluster:refresh-accessibility` answering `true`, and `true` at once for an unknown id; `cluster:list-namespace-forbidden`; `network:offline` and `network:online` per contracts/cluster-channels.md; an unknown id on `activate-cluster` doing nothing; the `/api-kube/` route answering the `503` `Status` `Cluster <id> is not connected` before activation (the "503 Status for a disconnected cluster" case of `pc/main/freelens-proxy/freelens-proxy.test.ts`); every case of `fixtures/` giving its `expected/` files; `--messages-dump` writing every message sent; and every log line, message and answer searched for the placeholder credentials, as written and in base64 (SC-009). Done. The fixture part, `every_fixture_case_gives_what_the_electron_build_gives`, runs each case on `Connection` through a fixture `Backend` with the clock paused.

### Implementation for the connection

- [x] T043 [US1] Add the phase and `enabled` of a cluster entity to `core/src/catalog/entities.rs` and a setter to `Catalog` in `core/src/catalog/mod.rs` (data-model.md "Phase of a cluster entity"), sent with the coalescing of spec 008. The tests of spec 008 pass unchanged. Why: FR-008; spec 008 left every cluster `disconnected` (research R8). Done.
- [x] T044 [US1] Create `core/src/cluster/access.rs` with the six steps of contracts/connection.md "Accessibility" (data-model.md `ClusterState.isAdmin`, `ClusterState.isGlobalWatchEnabled`, `ClusterState.allowedNamespaces`, `ClusterState.knownResources`, `ClusterState.resourcesToShow`, `ClusterState.ready`) and their log lines (research R16), each request under the 30 s inactivity limit. Make T035 to T037 pass. Done.
- [x] T045 [US1] Create `core/src/cluster/detect.rs` with the detectors of research R7 and their merge, writing the metadata of the cluster store entry through `Stores::update` (data-model.md "Cluster metadata"). Make T038 and T039 pass. Done.
- [x] T046 [US1] Create `core/src/cluster/connection.rs` with `ClusterConnection` (data-model.md `Connection.cluster_id`, `Connection.state`, `Connection.activated`, `Connection.activation`, `Connection.generation`, `Connection.consecutive_auth_failures`, `Connection.next_refresh_allowed_at`, `Connection.refreshing`, `Connection.timers`, `Connection.client`; data-model.md `ClusterState.online`, `ClusterState.disconnected`, `ClusterState.accessible`): the activation, the status check and its classification of the core's errors (research R5), `version` and `lastSeen` written at each success, the backoff, the timers, and the log lines of research R16. In `core/src/cluster/mod.rs`, keep one connection per cluster, the states, and the phase set on the catalog; remove the "every cluster connected" of T009, so that the route and the watches answer `503` for a disconnected cluster; make the setup of `core/tests/api_kube.rs` (T011, T017) activate its cluster through `activate-cluster` before its requests, with the fake API server answering the status check and the accessibility, so that those tests keep what they assert. Make T032 to T034 pass. Done.
- [x] T047 [US1] Create `core/src/cluster/channels.rs` with `activate-cluster`, `cluster-state-sync` (sent on change and once for every cluster at startup), `initial-cluster-state-sync`, `cluster:refresh-accessibility`, `cluster:list-namespace-forbidden`, `cluster:<id>:connection-update` through `send_named` (data-model.md "Connection update"), `network:offline` and `network:online`, per contracts/cluster-channels.md. Add `--messages-dump=<path>` to `core/src/options.rs` (research R17), resolved against the working directory and refused when empty, appending every message the core sends as one JSON line, with unit tests of the parse; update `specs/001-tauri-shell-spike/contracts/launch-options.md`. Make T042 pass. Done.
- [x] T048 [US1] Run the cargo gates and the Vitest test `pc/main/cluster/tauri-parity.test.ts` of T030. Done; the Vitest test passes its 45 tests.

**Checkpoint**: User Story 1 works and is tested on its own, with User Story 2 now refusing a disconnected cluster; this is the MVP.

---

## Phase 6: User Story 3 - Disconnect and delete a cluster (Priority: P3)

**Goal**: disconnecting, deleting, the delete dialog's kubeconfig edits under
the Electron build's lock, a cluster leaving the catalog, and quitting
(FR-019 to FR-024).

**Independent Test**: User Story 3's test of spec.md, as quickstart.md section
5 runs it.

- [x] T049 [P] [US3] Write the unit tests of `core/src/cluster/kubeconfig_edit.rs`, porting `pc/features/cluster/delete-dialog/kubeconfig-channels.test.ts` (research R19): the contexts, the current context and the default namespace answered, with no token in the answer; an unknown cluster refused with `Cluster "<id>" is not registered` by both requests; the context removed and the new current context set. Add, for research R12: a file with an entry that fails validation failing the contexts request and not the removal; the clusters, users, other contexts and fields the Electron build does not model kept; the mode kept; a symbolic link kept and its target written; the lock of data-model.md "Kubeconfig lock": `<real path>.lock` made and removed, a held lock failing with `Lock file is already being held`, a lock older than 10 s taken over, the lock touched every 5 s during a long edit (paused time). Done, nine unit tests; the refusal of an unknown cluster is in `core/tests/cluster.rs`.
- [x] T050 [P] [US3] Write `core/tests/cluster.rs`, disconnect part, against the fake API server: `deactivate-cluster` giving the state of contracts/cluster-channels.md "Disconnect" (data-model.md `ClusterState.disconnected`, `ClusterState.allowedNamespaces`, `ClusterState.isAdmin` kept), the phase `disconnected`, the timers stopped, the frame forgotten, the open watches and a request in flight closed at the fake server, a credential plugin run killed; an already disconnected cluster; an unknown id; `set-cluster-as-deleting` and `clear-cluster-as-deleting` giving `deleting`, `enabled: false` and back at once; `delete-cluster` removing the cluster store entry and `lens-local-storage/<id>.json`, an unknown id doing nothing; a context removed from its synced file disconnecting its cluster with the log line; quitting disconnecting every cluster with no child process left and no connection open at the fake server (SC-010, SC-011). Done, six tests. A credential plugin run killed is covered by `stop_kills_a_run_with_its_process_group` of `core/src/cluster/exec.rs`, the timers by the disconnect tests of `core/src/cluster/connection.rs`.
- [x] T051 [US3] Create `core/src/cluster/kubeconfig_edit.rs` with the two requests and the lock of research R12 (data-model.md "Kubeconfig lock"), reading with spec 008's loader and editing the YAML as a generic value through `serde-saphyr`, written to a temporary file next to the real path and renamed. Make T049 pass. Done.
- [x] T052 [US3] Add the disconnect, the deleting set, the delete, a cluster leaving the catalog (`CatalogEvent::ClusterRemoved`) and `disconnect_all` to `core/src/cluster/mod.rs` and `core/src/cluster/connection.rs` per contracts/cluster-channels.md, using `Frames::forget` of `core/src/frames.rs`, `Stores::update` and the local storage directory of spec 007; register `deactivate-cluster`, `set-cluster-as-deleting`, `clear-cluster-as-deleting`, `delete-cluster`, `cluster-kubeconfig-contexts` and `remove-cluster-context-from-kubeconfig` in `core/src/cluster/channels.rs`; call `disconnect_all` and `ShellEnv::stop` on quit in `core/src/lib.rs`. Make T050 pass. Done. A request of the `/api-kube/` route in flight ends at a disconnect through `Clients::close`. A change of the cluster store alone no longer adds missing entries in `core/src/catalog/mod.rs`, as the Electron build adds them only when its catalog changes; otherwise a deleted cluster's entry came back before its context left the catalog.
- [x] T053 [US3] Run the cargo gates. Done.

**Checkpoint**: User Stories 1 to 3 work on their own.

---

## Phase 7: User Story 4 - The core answers every channel of main-cluster-connection (Priority: P4)

**Goal**: `execute-on-cluster`, the frame rule, and a test of every channel's
answer (FR-025 to FR-027, SC-007).

**Independent Test**: User Story 4's test of spec.md, as quickstart.md section
6 runs it.

- [x] T054 [P] [US4] Write the unit tests of `core/src/cluster/execute.rs` against the fake API server, porting `pc/features/cluster/execute/main/__tests__/execute-handler.test.ts` and `main-k8s-api.test.ts` (research R19): an unknown and an inaccessible cluster answering `503` `ClusterNotAccessible`; a context without a server `500` `ConfigurationError`; the URLs of a core v1, an `apps/v1`, a cluster-scoped and a named resource; `list`, `get`, `create` (POST to the collection), `update` (PUT), `delete`; `patch` strategic by default, `json` and `merge`; an unknown operation `400` `BadRequest`; an API `Status` passed into `error` with `code` and `reason`; a network error's message; `labelSelector`, `fieldSelector` and both; `User-Agent: Freelens/<version>`; the pluralization of research R13. Done: the URL, query, pluralization, patch types, request shape and error mapping as unit tests of `core/src/cluster/execute.rs`; the operations against the fake API server, through the channel, in `core/tests/cluster.rs` (T055). An API `Status` gives its `message`, `code` and `reason`; [Inference, from `json-api.ts`] the Electron build's `JsonApiErrorParsed` has no `message`, so outside a `GET` answered `403` it answers `Unknown error` there, which the core does not copy. Parts of the resource that would name another path (`..`, a `/` or `?` in a name) are refused with `400` `BadRequest`, a check the Electron build does not have. The `500` `ConfigurationError` of a context without a server has no test: the catalog gives no cluster for such a context.
- [x] T055 [P] [US4] Write `core/tests/cluster.rs`, channels part: each row of contracts/cluster-channels.md answered as it says from the main window, with the same input as the Electron build's handler tests use; and the frame rule of FR-026: each of the nine channels that name a cluster refused from a cluster frame for another cluster, with the error of the contract, nothing changed and a log line, and answered for the frame's own cluster. Done, three tests: the operations with the cluster's credentials, the refusals, and the frame rule over the nine channels.
- [x] T056 [US4] Create `core/src/cluster/execute.rs` with the handler of research R13 and register `execute-on-cluster`; add the frame rule of contracts/cluster-channels.md to every request of `core/src/cluster/channels.rs` that names a cluster. Make T054 and T055 pass. Done.
- [x] T057 [US4] Run the cargo gates. Done.

**Checkpoint**: every channel of the area has an answer and a test.

---

## Phase 8: The Tauri Build's Own Pages (FR-029)

**Goal**: a user of the Tauri build connects, browses, watches, disconnects
and deletes a cluster in its own pages, which run the measured scenario
(research R15).

**Independent Test**: quickstart.md sections 2, 3 and 5, by hand.

- [x] T058 [US1] In the catalog page `ui/catalog.ts`, request `activate-cluster` when a cluster is clicked, show the updates of `cluster:<id>:connection-update` and the phase from `catalog:items`, offer Reconnect (`force: true`) when the connection failed, and show `Failed to sync shell environment: <error>` when `shell-sync-failed-channel` arrives. Request `activate-cluster` for the cluster that `openOnLoad` names when the page opens it, so that `--open-cluster` connects it as a click does. Build with `pnpm --filter @freelensapp/freelens-tauri tauri:ui`. Done. A click, and the `openOnLoad` cluster, open the frame and request `activate-cluster`; each open cluster's section lists its updates and offers Reconnect after an error; the listener of `shell-sync-failed-channel` is enlisted when the page starts, before the core can send it. The channels the pages use are in `ui/src/renderer/cluster-channels.ts`.
- [x] T059 [US2] Complete the frame page `ui/cluster.ts` per research R15: follow `initial-cluster-state-sync` and `cluster-state-sync`; show a sidebar once the cluster is ready, with Pods and Config Maps when they are in `resourcesToShow` (data-model.md `ClusterState.resourcesToShow`); a namespace choice of `allowedNamespaces` or All Namespaces, kept for both lists; one watch for all namespaces when `isGlobalWatchEnabled`, else one per namespace (data-model.md `ClusterState.isGlobalWatchEnabled`); a watch opened again 1 s after it ends, and the list loaded again after a `410` error, as the renderer's store does; replace the namespace list of spec 001 with the namespace choice, and post its mark `namespaces-shown` when the choice holds the allowed namespaces, so that the `spike-cluster` mode of `specs/001-tauri-shell-spike/measure.sh` keeps working. Post a mark with the wall clock when the sidebar is in the document. Done. The choice starts on `default` when it is allowed, else All Namespaces [Inference: the renderer starts on the context's default namespace]; a new state that changes the allowed namespaces or global watch reloads the list shown; a state not ready hides the sidebar and stops the list.
- [x] T060 [US3] In `ui/catalog.ts`, offer Disconnect (`deactivate-cluster`) and Delete with the steps of research R11: `cluster-kubeconfig-contexts`, the choice of a new current context when the cluster's is current, `set-cluster-as-deleting`, `remove-cluster-context-from-kubeconfig`, `delete-cluster`, `clear-cluster-as-deleting` in a `finally`, and `Cannot remove cluster, failed to process config file. <error>` on a failure, as the Electron build's dialog shows it. Done, as a `<dialog>`. Removing the entity from the hotbars has no counterpart: the pages have no hotbar.
- [x] T061 [US5] Add `--scenario=lists` to `core/src/options.rs` (research R15), with unit tests of the parse, passed to the pages as `--open-cluster` is; make the pages run the scenario themselves (click the cluster of the kind context, wait for the sidebar, open Config Maps, choose All Namespaces, open Pods) and post each step's mark with the wall clock; update `specs/001-tauri-shell-spike/contracts/launch-options.md`. Done. `--scenario=lists` was parsed and passed since T014; the catalog page clicks the first cluster whose context starts with `kind-` (mark `cluster-clicked`) and disconnects it 70 s later (mark `disconnected`, for SC-011); the frame then shows Config Maps, chooses All Namespaces (mark `all-namespaces-chosen`) and shows Pods, each first row marked. `launch-options.md` of spec 001 also gains `--messages-dump`.
- [x] T062 [US2] Build the pages, run the cargo gates, and walk through the manual parts of quickstart.md sections 2, 3 and 5 on the Tauri build and on the Electron build of `main`; note each difference in this task and fix it, or record why it stays. Done in part. The pages build, the cargo gates pass, and sections 2 and 3 ran on both builds as the measured scenario (T064); the messages run (T065) compared the connection of five contexts. Two differences of the core were found and fixed: a failing credential plugin failed the start of the connection rather than the status check, without the plugin's stderr; and `--messages-dump` interleaved the lines of messages sent at once. Section 5 walked by hand afterwards: the Electron build of the branch through CDP, the Tauri window clicked by a person, with a copy of the kind kubeconfig holding two made-up contexts. Both builds: the context leaves the file with its cluster and user entries kept, the chosen context becomes current, the cluster leaves the catalog, the cluster store and `lens-local-storage/<id>.json`, and the entity shows `deleting` meanwhile; with the lock held, both show `Cannot remove cluster, failed to process config file. Error: Error invoking remote method 'remove-cluster-context-from-kubeconfig': Error: Lock file is already being held` and leave the file as it was; a lock older than 10 s is taken over. Differences that stay: after a refused delete the Electron row keeps `deleting` until the next change, while the core computes the phase again at once (research R8, deliberate), so the Tauri row shows `disconnected` between the delete and the entity leaving the catalog; and the Tauri spike page's dialog has neither the Electron dialog's warning lines nor its optional choice of a current context for a context that is not the current one, which is page work, not the core's.

**Checkpoint**: the stories can be checked by hand in the Tauri build.

---

## Phase 9: User Story 5 - As fast and as light as the Electron build (Priority: P5)

**Goal**: SC-001 to SC-006, SC-010, SC-011 and SC-013 measured on the kind
cluster, and the figures recorded.

**Independent Test**: User Story 5's test of spec.md, as quickstart.md
section 7 runs it.

- [x] T063 [US5] Complete `specs/009-main-cluster-connection/measure-connection.mjs` with the modes of research R17: `lists` with the whole scenario, three runs per build, the times of SC-002, SC-003 and SC-006 and the CPU of the main process from the first click to 60 s later with `ps -o time` (the Electron build without the profiler, as `NO_PROFILE=1` runs it; the Tauri build under `--scenario=lists`); `watch` five times; `messages` for SC-001, SC-009 and SC-013 with the contexts of research R17 (a refused port, a refused token, a failing plugin, a plugin on a test shell's `PATH` only, a token and a key held in the file), the Electron build's messages hooked through the inspector as `specs/008-main-catalog/measure-catalog.mjs` hooks them and the Tauri build's from `--messages-dump`, both started with `open -n`, compared and searched for the placeholder credentials; `ports` for SC-010 and SC-011 with `lsof`, `ps` and the API server's `apiserver_longrunning_requests` for `WATCH`. Done. `lists` times the CPU and the sidebar from the click on the cluster in both builds, and the first Config Map row from the choice of All Namespaces; `messages` writes the contexts with the kind cluster's own client certificate, a placeholder token and a plugin that prints the kind certificate, found only on the `PATH` of a test shell; `ports` is for the Tauri build, which disconnects 70 s after the click under `--scenario=lists`.
- [x] T064 [US5] Run `lists` and `watch` on the kind cluster and record the medians in a new section "Kết nối cluster (spec 009)" of `specs/baseline.md`, with the conditions as the section "Hiệu năng main" writes them. A Tauri median above the Electron one, or a Tauri CPU above the Electron main's, reopens research R10 or R2; fix it before T065. Done, in the section "Kết nối cluster (spec 009)" of `specs/baseline.md`. Every Tauri median is below the Electron one, and so is the CPU, but the time from the click to the sidebar when the click comes while the shell sync runs: with the proxy chosen from the shell sync's environment (T068), the client waits for it, and the scenario clicks 0.3 to 0.9 s after launch, before a shell sync of 1.2 to 1.6 s ends (903 ms against 478 ms; 48 ms from the end of the shell sync). This reopened R2, which now records why the wait stays: the Electron build opens no window before its shell sync, and deciding without it would send a proxy set in the shell's files direct. SC-002 was then reworded to time the sidebar from the click or the end of the shell sync, whichever is later, which `measure-connection.mjs` now computes from the core's `[SHELL-SYNC]` line; by it the Tauri build passes (48 ms against 478 ms), and the time from the click alone is recorded beside it.
- [x] T065 [US5] Run `messages` and `ports`; record the result in the same section of `specs/baseline.md`: SC-001's differences (none expected but the core's own wording of FR-002), SC-009's `credentials: none found`, SC-013's connection, SC-010's ports and processes, SC-011's watches after a disconnect. Done, in the same section: the same states for all five contexts; the updates differ only where the Electron build's proxy speaks and in the wording of a refused port; `credentials: none found`; the plugin on the test shell's `PATH` connects; no port, no child process, and the watches back to the count before, after the disconnect.

**Checkpoint**: every success criterion is measured.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: the lists of specs 002 and 004, the checks of the Electron build,
and the final comparison with T001.

- [x] T066 [P] Update `specs/002-messaging-for-tauri/contracts/channel-list.md` (FR-027): the section "main-cluster-connection" says the core answers every row in 009 (`src/cluster/channels.rs`); `shell-sync-failed-channel` moves there from "main-shell-env" with the reason; the four channels of contracts/kube-watch.md are added as rows of the Tauri build only, with the reason of research R10. Done.
- [x] T067 [P] Replace the `/api-kube/` row of `specs/004-cluster-frames/contracts/routes.md` with the rows of contracts/api-kube.md, and say there that watches go through contracts/kube-watch.md of spec 009. Done. The cancellation rule of contracts/api-kube.md now says what the core does: a request of a frame that is forgotten or reloads runs to its answer or its limit, as the scheme does not tell the core; only a disconnect or a delete drops a cluster's requests.
- [x] T068 [P] Walk through quickstart.md sections 4 (proxies) and 8 (the shell sync) on both builds; record in research R2 what the Electron build does for the order of `proxy-url`, `httpsProxy` and `HTTPS_PROXY`, marked Unverified there, and fix the core where it differs. Done in part. Fixed in the core: the proxy is no longer kube's reading of the core's own environment, which a launch from the Finder leaves without the shell's variables, but `HTTPS_PROXY` or `https_proxy` of the shell sync's environment, with `NO_PROXY` and the loopback rule of Go's `httpproxy` (research R2), tested in `core/src/cluster/client.rs`; `core/tests/cluster_proxy_env.rs`, added by this spec for kube's reading, goes. Quickstart section 4 now uses a non-loopback server name, which both builds need. Sections 4 and 8 walked by hand afterwards on both builds. Section 4, with two CONNECT proxies and the kind API server by a name only they resolve: the `httpsProxy` setting, `proxy-url` over the setting, the loopback server going direct, `HTTPS_PROXY` from the login shell and `NO_PROXY` gave the same result in both builds; `HTTPS_PROXY` in the application's own environment did not: the Electron build moves it to `APP_HTTPS_PROXY` at startup (`setup-proxy-env.injectable.ts`) and goes direct, the core used it. Fixed in `foundation/shell_env.rs`, tested there, and recorded in research R2; quickstart section 4 now names the server as it was run. Section 8: a shell that exits 1 gives the same `Failed to sync shell environment: Shell did not exit successfully: …` text in both windows, sent once, and the Electron build does not show it again after a reload; the Tauri spike window offers no reload, so that part stays with the core's tests. A shell that sleeps 40 s: the Tauri page loads in 0.4 s and gets the timeout message at 30 s; the Electron window opens only at 31.5 s (research R4).
- [x] T069 Run the checks of the Electron build: `pnpm build`, `pnpm type:check`, `pnpm test:unit` (compared with T001: the only new tests are those of `pc/main/cluster/tauri-parity.test.ts`), `pnpm test:integration`, `pnpm knip:check`, `pnpm biome check` and `trunk check`. Why: FR-030, FR-031 and SC-012. Done. `pnpm build`, `pnpm type:check`, `pnpm test:integration` (4 files passed, 1 skipped), `pnpm biome check` and `trunk check` pass; `pnpm test:unit` gives 593 files and 7287 tests passed, 29 skipped, against 592 and 7242 at T001: the one new file and its 45 tests are `pc/main/cluster/tauri-parity.test.ts`. `pnpm knip:check` reported `kubectl`, which `measure-connection.mjs` calls, as an unlisted binary; `knip.jsonc` now lists it with the binaries the scripts take from the machine.
- [x] T070 Run the cargo gates; compare the test names with T001: no test is gone but those moved by T017 from `core/tests/scheme.rs`, listed in this task with where each went. Done: every test name of T001 is still there but the eight of T017, now in `core/tests/api_kube.rs`: `kube_requests_pass_status_and_body_through` and `view_headers_are_not_forwarded_and_no_credential_comes_back` as `every_method_reaches_the_api_server_with_its_path_query_and_body` and `the_frame_s_credentials_and_hop_by_hop_headers_stay_and_the_context_s_are_added`; `an_error_status_of_the_api_server_passes_through` as `an_error_status_of_the_api_server_passes_through_without_retry`; `kube_requests_are_not_served_on_the_main_host` as `the_main_window_has_no_api_kube_route`; `kube_watches_are_refused` as `a_watch_on_the_route_is_refused_with_a_status_naming_the_watch_channel`; `kube_requests_accept_get_only` and `kube_paths_must_start_with_api_or_apis` as the every-method test and `any_normalized_path_goes_to_the_cluster_and_others_get_400`; `an_unreachable_cluster_gives_502_with_json` as `a_refused_target_answers_500_without_retry`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependency.
- **Foundational (Phase 2)**: after Setup; blocks every story.
- **User Story 2 (Phase 3)**: after Foundational. T015's first measurement
  gates the rest of the phase and of the feature: a figure slower than the
  Electron build's reopens research R10 or R2 first.
- **User Story 1, credentials (Phase 4)**: after Foundational; independent of
  Phase 3 except for `client.rs`, which both change (T020 does not touch it,
  T027 does).
- **User Story 1, connection (Phase 5)**: after Phase 4 (the status check of a
  context with `exec`) and Phase 3 (the `503` of the route and the watches for
  a disconnected cluster).
- **User Story 3 (Phase 6)**: after Phase 5 (a disconnect needs a connection).
- **User Story 4 (Phase 7)**: after Phase 6 (the frame rule covers the delete
  dialog's channels).
- **The pages (Phase 8)**: after Phases 3 to 7, whose channels they use.
- **User Story 5 (Phase 9)**: after Phase 8 (`--scenario=lists`).
- **Polish (Phase 10)**: after everything.

### Within Each Phase

- A test task before the code it tests; the code task names the tests it
  makes pass.
- `client.rs` before `exec.rs`'s use of it; `access.rs` and `detect.rs` before
  `connection.rs`; `connection.rs` before `channels.rs`.
- The cargo gates end each phase.

### Parallel Opportunities

- T003 and T004.
- T005, T006 and T008.
- T011 and T013; T017, T018 and T019.
- T022, T023, T024 and T026.
- T029 and T030; T032 to T042.
- T049 and T050; T054 and T055.
- T066, T067 and T068.

---

## Parallel Example: User Story 1, connection

```bash
# The fixtures and the Electron test together:
Task: "T029 Create the fixture cases of research R18 in fixtures/"
Task: "T030 Write pc/main/cluster/tauri-parity.test.ts"

# Then the ported tests, each in its own file or module:
Task: "T032 activation tests in core/src/cluster/connection.rs"
Task: "T035 /apis tests in core/src/cluster/access.rs"
Task: "T038 node count tests in core/src/cluster/detect.rs"
Task: "T040 check spec 008's entity tests in core/src/catalog/entities.rs"
```

---

## Implementation Strategy

### MVP First

1. Phases 1 and 2.
2. Phase 3 to T016: the watches and their first measurement. Stop if the
   figures reopen research R10.
3. The rest of Phase 3, then Phases 4 and 5: a frame connects, browses and
   watches with the Electron build's messages and states. This is the MVP:
   User Story 1 with User Story 2.

### Incremental Delivery

1. MVP as above.
2. Phase 6: disconnect and delete.
3. Phase 7: every channel answered and tested.
4. Phase 8: the pages, checked by hand.
5. Phase 9: the measurements recorded.
6. Phase 10: the lists and the Electron build's checks.

---

## Notes

- Each task is a commit or a part of one; stop at each checkpoint and review
  the diff.
- A task that finds the Electron build different from a contract fixes the
  contract, the data model or the research with it, and says so in the task.
- Mark a task done with a short "Done" note of what differed from its text,
  as spec 008's tasks do.
