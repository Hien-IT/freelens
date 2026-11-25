# Research: Cluster Frames

Each section states what was found, with **Verified** for what the sources or
a run of the application show and **Unverified** for what they do not, then
the decision and the alternatives considered. Paths of the Electron build are
relative to `packages/core/src/`; paths of the core are relative to
`freelens-tauri/src-tauri/`.

## R1. What setup-hostnames and the local proxy do, and their counterparts

**Finding** (**Verified**, sources): the Electron build gives every view an
origin of its own through five pieces.

| Electron build                                                                                                                                                                                                                   | What it does                                                                                                                                                                                                                        | Tauri build                                                                                                                                                                                                                                           | Owner                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `main/start-main-application/runnables/setup-hostnames.injectable.ts`                                                                                                                                                            | Chromium's `host-resolver-rules` maps `renderer.freelens.app` and `*.renderer.freelens.app` to `127.0.0.1`                                                                                                                          | the scheme `freelens-app` with the same host names, answered by the core (`src/scheme.rs`); no name resolution happens                                                                                                                                | 001, kept                                          |
| `main/freelens-proxy/freelens-proxy.ts`                                                                                                                                                                                          | an HTTP/2 TLS server on `127.0.0.1` that serves the renderer's files, `/api-kube/…` to the cluster of the host, the router's `/api/…` routes, and upgrades (shells, watches); it also serves kubectl and helm on `127.0.0.1/<id>/…` | the scheme handler serves files, `/api-kube/…` (GET, no watch) and the route table of R3; upgrades and watches cannot cross a scheme (R4 of spec 001); kubectl and helm reach the clusters through the core in a later area                           | 004: files, routes, origins; later areas: the rest |
| `main/freelens-proxy/get-cluster-for-request.injectable.ts`, `common/utils/cluster-id-url-parsing.ts`                                                                                                                            | the cluster of a request is the first label of its host                                                                                                                                                                             | `View` of `src/messaging/mod.rs`, taken from the host by `view_of` in `src/messaging/routes.rs` and `host_of` in `src/scheme.rs`                                                                                                                      | 002, kept                                          |
| `main/freelens-proxy/allowed-request.ts`, `freelens-proxy-token.ts`, `lens-window/application-window/set-freelens-proxy-token-cookie.injectable.ts`, `lens-window/application-window/session-certificate-verifier.injectable.ts` | refuses a foreign `Host` or `Origin`; requires a token on `/api…`, carried by the cluster frames as a `SameSite=Strict` cookie on `.renderer.freelens.app`; accepts the self-signed certificate of the proxy                        | no TLS, no certificate and no cookie: a scheme served by a handler is a secure context (**Verified**, T015 of spec 001); WebKit refuses cross-origin requests before the handler; the core refuses an `Origin` other than the request's own host (R3) | 001 and 002, kept; 004 adds the audiences of R3    |
| `renderer/components/cluster-manager/cluster-frame-handler.ts`, `main/cluster/set-frame-id-listener.injectable.ts`, `lens-window/current-cluster-frame/`                                                                         | one iframe per cluster on `//<id>.<host>`, hidden and shown, removed when the cluster disconnects; main records the frame and the visible cluster                                                                                   | the catalog page (R7) and the frame record of the core (R4)                                                                                                                                                                                           | 004                                                |

The `freelens-extension://` scheme of the Electron build has no counterpart:
the Tauri build has no extensions (Principle VII).

**Decision**: keep the scheme, hosts and `Origin` rule that spec 001 proved
and spec 002 builds on, and add what is missing for several frames at once:
audiences on routes (R3), the frame record (R4, R5), the two channels (R6) and
the lifecycle of the pages (R7). No WKWebView setting changes (R2).

**Alternatives considered**: a loopback HTTP server in the core with
`<id>.localhost` hosts, rejected in R4 of spec 001 (a port, a server, and for a
secure context a certificate WKWebView must trust).

## R2. Isolation on WKWebView and the website data store

**Finding**:

- The origin of a frame is the tuple `freelens-app://<id>.renderer.freelens.app`;
  frames of two clusters do not share `localStorage`, cannot read each other's
  document or `localStorage` through `window.parent.frames`, and cannot fetch
  each other's `/api-kube` (**Verified**, T015 and T041 of spec 001, two
  frames). A third frame adds no new mechanism; SC-001 and SC-002 prove it with
  three (R9).
- Cookies cannot be set on a custom scheme in WKWebView (**Verified**, Tauri
  maintainer statement, R4 of spec 001). Whether `document.cookie` silently
  keeps a value inside one page is **Unverified**; R9 checks that no other view
  sees it and that no request reaching the core carries a `Cookie` header.
- The window is built with `.incognito(true)` (`src/lib.rs`): a
  non-persistent website data store, so browser storage does not outlive a
  run. Isolation within the store is still by origin (**Verified** for two
  frames, T041 of spec 001).
- Whether WebKit gives each origin its own WebContent process is
  **Unverified** (R10 of spec 001); the spec leaves crash isolation out.

**Decision**: no change to the WKWebView settings. The non-persistent store
stays: no view keeps anything in browser storage across runs, because the
renderer's own storage goes through main (`lens-local-storage:*` of spec 003),
and FR-001 asks the same origin across restarts, which the id gives, not the
same storage. Whether a persistent store is wanted belongs to
`desktop-integration` (006), with the settings.

**Alternatives considered**: a persistent store per cluster with
`data_store_identifier` (macOS 14 and later): it would isolate storage a
second time, but nothing needs storage that outlives a run, and it adds a
store to clean when a cluster is removed.

## R3. Routes with audiences (FR-005 to FR-008)

**Finding** (**Verified**, `src/scheme.rs`, `src/lib.rs`): the core answers
every request in one `match` on host and path: `/` serves a page per host
kind, `/api-kube/…` cluster hosts only, `/api/clusters` the main host only,
`/api/mark` and `/assets/…` both, and `/ipc/…` both (dispatched in `lib.rs`).
The audience of each route is implicit in the arms. An unknown host, or a
cluster id not in the catalog, gets `404`. The later areas add routes the
Electron router has: helm, metrics, port-forward, the resource applier and the
service-account kubeconfig, all under `/api/…` and all needing the cluster of
the host (`ClusterLensApiRequest` in `main/router/route.ts`), with methods
other than `GET`.

**Decision**: a route table in a new module `src/routes.rs`, with the same
shape as `Channels`:

- each route has a method, a path (exact, or a prefix ending in `/`), an
  audience (`Main`, `Clusters` or `Both`) and a handler that gets the `View`;
- a second route with the same method and path stops the core at startup, as
  a duplicate channel does;
- the handler of the scheme checks, in this order: known host (else `404`),
  a route for the path (else `404`) and the method (else `405`), `Origin`
  equal to the request's own origin when present (else `403`), the audience
  (else `404`, so a route of the other kind of view looks absent), then the
  handler. The method comes before the `Origin` because the `/ipc/` routes of
  spec 002 answer a foreign preflight with `405`, which `tests/messaging.rs`
  expects; every `403` the tests expect is for an existing route and method;
- the routes of today become rows of the table, `/ipc/…` included, with the
  audiences they have now, so behaviour does not change; `contracts/routes.md`
  lists them.

`404` for a route of the other audience keeps what the contract of spec 001
answers today for `/api/clusters` on a cluster host and `/api-kube` on the
main host.

**Alternatives considered**: an audience check inside each handler (every
later area would repeat it, and forget it once); `403` for the wrong audience
(tells a page which routes exist for the other kind of view, and changes the
answers spec 001's tests expect).

## R4. The frame record (FR-016 to FR-018)

**Finding** (**Verified**, sources):

- In the Electron build, `common/cluster-frames.injectable.ts` is an
  observable map from cluster id to the frame's `{ frameId, processId }`.
  `set-frame-id-listener` adds to it and then pushes the catalog;
  `features/cluster/activation/main/request-deactivation.injectable.ts` and
  `features/cluster/delete-dialog/main/delete-channel-listener.injectable.ts`
  remove from it; `current-cluster-frame.injectable.ts` combines it with the
  visible cluster, and `navigate`, `reload-current-application-window` and
  `navigate-for-extension` send to that frame.
- The core's `Messaging::send` appends to every open queue (`src/messaging/queues.rs`,
  `push`); nothing sends to one view. The channel list already names two
  channels that need it (`reload-page-channel`, `renderer:navigate-in-cluster`).

**Decision**: a module `src/frames.rs` with a `Frames` value, cheap to clone,
built at startup and handed to every area that needs it:

- state: the clusters that have a frame, and the visible cluster or none
  (data-model.md);
- reads: `has_frame(id)`, `frames()`, `visible()`;
- changes from the views: `announce(id)` and `set_visible(id | none)`, called
  only by the listeners of R6;
- changes from the areas: `forget(id)`, for disconnecting and deleting;
- events: `subscribe(callback)`, called with `Announced(id)` and
  `Forgotten(id)`, in the order the changes happen, outside the lock;
- sending: `send_to(id, channel, message)` and
  `send_to_visible(channel, message)`, which append to the queue of that
  frame's view only, through a new `Queues::push_to(view, …)`, and drop the
  message without an error when the cluster has no frame (FR-018).

Announcing a cluster that already has a frame changes nothing and emits no
event, so a reloaded frame is not recorded twice. `contracts/frames-api.md`
is the API the later areas use.

**Alternatives considered**: keeping the record inside the listener of
`cluster:set-frame-id` (the later areas would edit 004's code, which the
clarification rules out); a tokio broadcast channel for the events (a
subscriber that lags loses events; a callback list is simpler and keeps the
order).

## R5. Forgetting a frame (FR-012)

**Finding** (**Verified**, `src/messaging/queues.rs` and R3 of spec 002):

- a queue opens at a view's first poll, starts afresh on a new `session` (a
  reload), and closes when it has no poll and no poll waiting for 60 seconds,
  or holds more than 10 000 messages;
- the idle check runs only inside `poll` and `push`, so a closed frame stays
  counted until some view polls or the core sends;
- a poll that WebKit cancels when the frame goes away keeps waiting in the
  core until its 25-second hold ends (wry keeps the task, R3 of spec 002), and
  its start is the queue's last poll. A frame that goes away at time `t`
  therefore has its last poll at or before `t`, no poll waiting from `t + 25 s`
  at the latest, and an idle queue at `t + 60 s` at the latest.

**Decision**:

- `Queues` reports two events to subscribers: `Closed(view)`, when it closes a
  queue, and `Restarted(view)`, when a new session replaces one;
- the frame record forgets cluster `id` on `Closed(Cluster(id))`, and every
  frame on `Restarted(Main)`, the reload of the main window; a
  `Restarted(Cluster(id))` changes nothing, as the reloaded frame announces
  itself again;
- every read of the record runs the idle check first, so a read at
  `t + 60 s` finds the frame gone, and a background task runs it once a
  second, so the `Forgotten` event comes at most a second later;
- a message for a cluster whose queue has restarted reaches nothing of the
  earlier page: the queue starts afresh (spec 002), so nothing meant for the
  earlier frame reaches the later one.

**Alternatives considered**: a channel on which the catalog page reports a
close, rejected by the clarification of 2026-11-25; a shorter idle limit for
cluster frames (it would also drop a frame whose poll is slow, and the limit
is spec 002's definition of a gone view).

## R6. The two channels and their senders

**Finding** (**Verified**, sources):

- `cluster:set-frame-id` is `getRequestChannel<ClusterId, void>`
  (`common/ipc/cluster.ts`); the cluster frame requests it while it starts, in
  `renderer/frames/cluster-frame/init-cluster-frame/init-cluster-frame.ts`.
- `current-visible-cluster` is `MessageChannel<ClusterId>`
  (`common/cluster/current-cluster-channel.ts`), sent from the main frame only
  (`setup-current-cluster-broadcast.injectable.ts` runs on
  `beforeMainFrameStartsFirstInjectionToken`) whenever the matched cluster
  changes, including to `undefined`, which messaging-for-tauri sends as no
  payload and the core reads as `null` (R4 of spec 002).

**Decision**, in `src/frames.rs`:

- `cluster:set-frame-id`, `RequestChannel<String, ()>`: from
  `View::Cluster(own)` with a payload equal to `own`, `announce(own)` and
  answer nothing; otherwise answer the error
  `cluster:set-frame-id is answered only for the sending frame's own cluster`,
  record nothing, and log it;
- `current-visible-cluster`, `MessageChannel<Option<String>>`: from
  `View::Main`, `set_visible` with the id if it is in the catalog, or none for
  `null` or an unknown id; from a cluster frame, drop the message and log it;
- nothing else: sending the catalog belongs to `main-catalog`, which
  subscribes to `Announced`.

The log lines are in `contracts/frames-log.md`. The Electron build is
unchanged.

## R7. The catalog page and the frame page (FR-009 to FR-011, FR-014)

**Finding** (**Verified**, `ui/src/renderer/`): the catalog page creates one
section and frame per cluster on first open, hides the others, and removes
the section on Close; the frame page lists namespaces once. Neither page
loads messaging except in a `--messaging-check` run, which builds its
container in `messaging-check.ts`. The Electron frame handler also sets the
frame's `src` to `""` before removing it, because Chromium crashed otherwise;
no such crash is known for WKWebView (**Unverified**).

**Decision**:

- a module `ui/src/renderer/messaging.ts` builds the messaging container, as
  `messaging-check.ts` does today; `messaging-check.ts` uses it;
- the frame page always starts messaging and, once it is loaded, requests
  `cluster:set-frame-id` with its own id, which it reads from its host as the
  Electron renderer does;
- the catalog page always starts messaging and sends `current-visible-cluster`
  with the id of the shown frame when it opens or shows one, and `null` when
  it closes the shown frame;
- Close keeps removing the section; the page does not blank the frame first.

The renderer's own `ClusterFrameHandler` stays as it is; it runs in the Tauri
build once its root frame does (clarification of 2026-11-25).

## R8. Removing `request-freelens-proxy-certificate` (FR-019)

**Finding** (**Verified**, sources and `git log -L`):

- the listener, `main/freelens-proxy/freelens-proxy-certificate-request-handler.injectable.ts`,
  answers `{ cert, public, private: "" }`: the private key has not crossed to
  a view since at least the rename of the proxy to `FreelensProxy`. The note of
  the channel list that says it crosses is wrong;
- in the views, `renderer/before-frame-starts/runnables/setup-freelens-proxy-certificate.injectable.ts`
  stores the answer in `common/certificate/freelens-proxy-certificate.injectable.ts`,
  and no renderer, common or extension code reads it there; its readers are in
  main (the proxy, its dispatcher, the kubeconfig manager, the session
  certificate verifier), which set it themselves through
  `main/start-main-application/runnables/setup-freelens-proxy-certificate.injectable.ts`;
- no test refers to the channel, its listener or the renderer runnable; no
  document under `docs/` names it.

**Decision**: delete, in the Electron build:

- `common/certificate/freelens-proxy-certificate-channel.ts`;
- `main/freelens-proxy/freelens-proxy-certificate-request-handler.injectable.ts`;
- `renderer/certificate/request-freelens-proxy-certificate.injectable.ts` and
  its now empty `renderer/certificate/` directory;
- `renderer/before-frame-starts/runnables/setup-freelens-proxy-certificate.injectable.ts`;

then run `pnpm build:di`. `common/certificate/freelens-proxy-certificate.injectable.ts`
and its global override stay: main uses them. In the channel list, the row
moves from "cluster-frames (004)" to "Removed by this feature" with the
reason, and the wrong note goes. The extension API does not reach any of
these files (Principle III), so nothing an extension sees changes.

**Alternatives considered**: keeping the channel in the Electron build
(rejected by the clarification); moving `freelens-proxy-certificate.injectable.ts`
to `main/` now that only main reads it (a move with no effect on behaviour;
left out to keep the change to the deletions FR-019 asks for).

## R9. Proving isolation: the `--frames-check` run

**Finding**: spec 001 proved isolation with temporary pages that were never
committed; spec 002 committed a check run (`--messaging-check`) whose lines a
reader compares. SC-001 to SC-005 need every attempt from three frames, a close
and a reopen, which is too many steps to repeat by hand in Safari's Web
Inspector.

**Decision**: a launch option `--frames-check`, like `--messaging-check`:

- the core registers the check-only message channel `frames-check:report`
  and prints each report (`contracts/frames-log.md`), and in this run it also
  prints each request that reaches it with a `Cookie` header;
- the catalog page opens the first three clusters of the catalog; each frame
  records its origin, a page-state mark (a random value held in memory), a
  `localStorage` mark and a cookie, then tries to read the main window and the
  other two frames: their documents through `window.parent` and
  `window.parent.frames`, their `localStorage` and cookie values, the main
  host's `/api/clusters`, another cluster's `/api-kube/api/v1/namespaces`,
  `cluster:set-frame-id` with another cluster's id, and
  `current-visible-cluster` from the frame; each attempt is reported as
  blocked or not;
- a check-only request `frames-check:send-to` makes the core call
  `Frames::send_to` with a check-only message for the cluster it names, and
  answers whether that cluster had a frame; every view reports each check-only
  message it receives, so the log shows who got it;
- the catalog page then sends to the first cluster, closes the second one,
  sends to the second one, has the first and third frames report their marks
  again, waits 65 seconds with both hidden, asks the core whether the second
  cluster still has a frame, has the first and third report again, and reopens
  the second cluster, whose new frame reports its origin and a new page-state
  mark.

The pass condition is in `contracts/frames-log.md` and quickstart.md.

**Alternatives considered**: temporary pages, as in spec 001 (not
repeatable); a WebDriver run (that Tauri's WebDriver support does not cover
WKWebView on macOS is **Unverified**: it comes from memory of the Tauri
documentation, not from a source read for this plan; the check run needs no
driver either way).

## R10. The Electron build

**Decision**: the Electron build changes only by the deletions of R8. Its
build, `pnpm type:check`, unit tests, integration tests and `knip:check` run
after that change; the manual check of SC-007 (three clusters opened,
switched, one closed and reopened) runs on the branch and on `main`.

## R11. Risks

- **A hidden frame stops polling.** If WebKit suspends a frame inside a hidden
  section, its queue closes after 60 seconds and the record forgets a frame
  that is still there; messages sent to it are then dropped. The poll loop
  re-polls at once after each answer and uses timers only after a failure, so
  timer throttling alone does not stop it (**Verified**,
  `messaging-for-tauri/src/polling.injectable.ts`); suspension of a hidden
  frame is **Unverified**. The check keeps the second and third frames hidden
  for more than 60 seconds before they report their marks again (R9).
- **wry dropping a cancelled poll.** R5 relies on wry keeping the task of a
  cancelled poll until its hold ends. If a later wry dropped it, the pending
  poll would stay and the queue would never idle; a cargo test of `Queues`
  pins the behaviour the record relies on, and the check's forgetting step
  shows it in the running application.
- **Removing a frame without blanking it** crashed Chromium; whether WKWebView
  has a problem with it is **Unverified**. The check closes and reopens a
  frame.
