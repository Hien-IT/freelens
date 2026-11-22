# Research: Messaging for the Tauri Build

Each section records a finding, the decision taken from it, and the
alternatives that were rejected. **Verified** marks what was read in the
sources of this repository or of the pinned dependencies; **Unverified** marks
what still needs the proof of the first implementation phase.

## R1. What a view-side implementation of messaging provides

**Finding**: feature code reaches messaging only through four injection tokens
of `@freelensapp/messaging` (**Verified**):

| Token                                        | Electron renderer (`messaging-for-renderer`)                       |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `requestFromChannelInjectionToken`           | `ipcRenderer.invoke(channel.id, request)`                          |
| `sendMessageToChannelInjectionToken`         | `ipcRenderer.send(channel.id, message)`                            |
| `enlistMessageChannelListenerInjectionToken` | `ipcRenderer.on(channel.id, …)`, the handler gets the message only |
| `enlistRequestChannelListenerInjectionToken` | throws: a view does not answer requests                            |

`@freelensapp/messaging` itself enlists every `messageChannelListenerInjectionToken`
and `requestChannelListenerInjectionToken` on load of the application
(`listening-of-channels.injectable.ts`). `messaging-for-renderer` adds one
runnable, `allow-communication-to-iframe.injectable.ts`, which sends
`frame-communication-admin-channel` on load, so that main starts sending to
the frame (`messaging-for-main/src/send-message-to-channel/`). Main hands a
message listener `{ processId, frameId }` as the sender; a request handler
gets the request only. The renderer DI container picks the implementation in
`freelens/src/renderer/index.ts`, which registers `messagingFeatureForRenderer`.

**Decision**: a new package, `packages/technical-features/messaging/messaging-for-tauri`
(`@freelensapp/messaging-for-tauri`), exports `messagingFeatureForTauri`,
which depends on `messagingFeature` and implements the same four tokens and the
same admin runnable. A view of the Tauri build registers it in place of
`messagingFeatureForRenderer`; that registration is the only place that
differs between the builds (FR-001, FR-002). The package has no dependency on
`electron` or on Tauri's JavaScript API.

**Alternatives considered**: a Tauri branch inside `messaging-for-renderer`
(feature code would then load both implementations, and the package's
`electron` import would follow it into a Node-free view); overriding the
tokens from the Tauri entry point instead of a feature (it scatters the
implementation over the entry points of the views).

## R2. How requests and messages reach the core

**Finding**:

- Tauri's IPC is defined in the main frame only, delivers responses and events
  with `evaluateJavaScript` in the main frame, and grants every frame of a
  registered scheme the main window's capabilities (R5 of
  `specs/001-tauri-shell-spike/research.md`, **Verified** there). A cluster
  frame could therefore not receive events, and could call any command.
- The spike's scheme handler already knows which view sent a request: the host
  names the view (`renderer.freelens.app` for the main window,
  `<clusterId>.renderer.freelens.app` for a cluster frame), and a request whose
  `Origin` names another host is refused (`freelens-tauri/src-tauri/src/scheme.rs`,
  **Verified**). The spike proved that a cluster frame reaches its own host and
  cannot reach another's (T015 and T041 of spec 001).
- wry 0.57.3 hands the handler the body of a `POST`, from `HTTPBody` or by
  reading `HTTPBodyStream` (`wkwebview/class/url_scheme_handler.rs`,
  **Verified**).

**Decision**: requests and messages from a view are `POST` requests on the
view's own host of the `freelens-app` scheme, under `/ipc/`, with the channel
id and the value in a JSON body
([contracts/ipc-routes.md](./contracts/ipc-routes.md)). The core registers no
Tauri command and the configuration grants no capability, as in the spike. The
"typed command and event layer" of the plan's input is the core's registration
API (R8): a request channel is a command with one typed answer, a message
channel is a typed event; only the carrier is the scheme rather than Tauri's
`invoke` and `emit`, because those do not reach the cluster frames.

**Rationale**: one carrier for every view, the same in the main window and in a
cluster frame, with the sender identified by WebKit's `Origin` and host rather
than by anything the page sends (FR-003, FR-006).

**Alternatives considered**:

- Tauri `invoke` and `emit` from the main window, with `postMessage` relays to
  and from the cluster frames: two carriers, a relay in the main window that
  every cluster frame depends on, and commands that a frame can still call
  directly with the main window's capabilities.
- Tauri `invoke` from the frames through its `ipc://` fetch: whether the
  command can tell the frame's origin is **Unverified**, and events still go
  to the main frame only.

## R3. Messages from the core to the views

**Finding**: the scheme cannot stream: wry delivers each response in one piece
and a scheme carries no WebSocket (R4 of spec 001, **Verified** there). wry
0.57.3 keeps the tasks WebKit has stopped and ignores a response to one
(`check_task_is_valid` in `url_scheme_handler.rs`, **Verified**), so the core
may hold a request open and answer it late, or never, without harm.

**Decision**: long polling. Each view keeps one `POST /ipc/poll` open; the core
answers it as soon as it has messages for that view, or empty after 25
seconds, and the view polls again at once.

- The core keeps one queue per view, keyed by host. A queue opens at the
  view's first poll, which the view sends when messaging starts listening on
  load. Before that the view has no listener in the Electron build either, so
  nothing it would have received is lost.
- Each message in a queue has a sequence number. A poll names the page load
  (`session`, random per load) and the last number it has handled (`after`);
  the core drops what is acknowledged and answers with the rest, so a poll
  cancelled in flight loses nothing and no message is handled twice. A new
  `session` on the same host is a reload: the queue starts afresh, as a
  reloaded page in the Electron build loses what was sent to the old one.
- A queue with no poll for 60 seconds, or with more than 10 000 messages, is
  closed and the closure logged: the view is gone or stuck.
- A message the core sends goes to every open queue, once (FR-004).

**Rationale**: the only push that works from every frame without Tauri IPC,
a port or a second carrier, and it delivers in order (FR-009).

**Alternatives considered**: a streamed response or server-sent events
(delivered in one piece, so never); a WebSocket server on the loopback
interface (needs a port, an authentication token and a certificate WKWebView
trusts, rejected in R4 of spec 001); Tauri events with a relay (R2).

A continuous stream for watches or the terminal is not part of this feature
(FR-013); the spec that adds it measures whether long polling carries it.

## R4. Values on the wire

**Finding**: Electron copies values with the structured clone algorithm, which
keeps `undefined`, `NaN`, `bigint`, `Date`, `RegExp`, `Map`, `Set`, `Error`,
typed arrays and cycles, turns any other class instance into a plain object of
its own enumerable properties, ignores `toJSON`, and fails on functions and
symbols. The body of a scheme request and its response are bytes; the core
reads them with serde.

**Decision**: JSON, in an envelope that distinguishes "no value" from `null`
([contracts/ipc-routes.md](./contracts/ipc-routes.md)). Before sending, the
view walks the value and throws a `TypeError` naming the channel wherever JSON
and the structured clone would disagree (FR-008): a `Date`, `RegExp`, `Map`,
`Set`, `Error`, `ArrayBuffer` or typed array, a `bigint`, a non-finite number,
`undefined` inside an array, an object with a `toJSON` method, or a cycle; and,
as in Electron, a function or a symbol. Any other class instance passes and
arrives as a plain object of its own enumerable properties, as in Electron;
the catalog entities of `catalog:items` travel that way today. An object
property whose value is `undefined` is allowed and dropped, since reading it
gives `undefined` on both sides. MobX observable objects and arrays pass, as
`JSON.stringify` reads them as plain data.

The channel list flags every channel whose type can hold such a value; the spec
that ports its area changes the type at the channel's definition, in both
builds, before the core answers it.

**Alternatives considered**: a tagged encoding that keeps dates, maps and sets
(the core would have to decode the tags for every channel in serde, for types
that few channels carry); converting silently (a `Date` arriving as a string is
the silent change FR-008 forbids).

## R5. Order

**Finding**: Electron carries `send` and `invoke` of one frame over one pipe,
so a message and a later request from the same frame arrive in order. Two
`fetch` calls in flight at once may reach the core in either order.

**Decision**: the view sends messages in batches, one batch in flight at a
time: messages sent while a batch is in flight go into the next one, and the
core handles a batch's messages in order. A request waits until the batch in
flight, if any, has been accepted, so it never overtakes a message sent before
it. Requests are not ordered among themselves, as in the Electron build, where
handlers run concurrently.

## R6. Errors

**Finding**: in Electron, `invoke` on a channel with no handler rejects with
`Error invoking remote method '<id>': Error: No handler registered for '<id>'`,
and a handler that throws rejects it with
`Error invoking remote method '<id>': Error: <message>` (**Verified**: the
templates `Error invoking remote method '${…}': ${…}` and
`No handler registered for '` are in the framework binary of Electron
44.10.1, the version the build uses). A message nobody listens to is dropped.

**Decision**: the view-side implementation rejects with the same two messages,
built from the error the core answers with; a failure of the carrier itself
(the core gone, the request refused) rejects with
`Error invoking remote method '<id>': <reason>`. A message batch the core
refuses is logged in the view and not retried. A message on a channel with no
listener in the core is accepted and dropped (FR-007).

## R7. Who sent it

**Decision**: the core derives the sender of every request and message from
the host of the request: `View::Main`, or `View::Cluster(id)` for a host the
catalog knows. A `POST` under `/ipc/` must carry an `Origin` equal to its own
host; the spike's rule lets a request without `Origin` through, which is
right for page loads but not for these routes. A request handler and a message
listener in the core receive the `View` with the payload, where Electron's
main hands a listener `{ processId, frameId }` (FR-006).

The core listens on `frame-communication-admin-channel`, owned by messaging,
logs the view that announced itself and counts its announcements for the check
(R9); queues open at the first poll (R3), so the message changes nothing else.

The core also answers `ipc:broadcast-main`, the relay the Electron build uses
when a view broadcasts (`broadcastMessage` in a renderer): it sends the
carried message on the carried channel to every open view, then answers. It is
messaging's own channel, so this feature implements it.

## R8. The registration layer in the core

**Decision**: a `messaging` module in `freelens-tauri/src-tauri/src/`
([contracts/core-channels.md](./contracts/core-channels.md)):

- A channel is a Rust constant that carries its id and its types:
  `RequestChannel<Req, Res>` and `MessageChannel<M>`, with
  `Req, M: DeserializeOwned` and `Res, M: Serialize`.
- Each core area exposes `register(&mut Channels)`, which calls
  `answer(CHANNEL, handler)` for each request channel and
  `listen(CHANNEL, handler)` for each message channel it handles. Handlers are
  async and get the payload and the `View`.
- A second `answer` for one channel id is an error that names the channel, and
  startup stops on it (FR-010). A message channel may have several listeners,
  as in the Electron build.
- `Channels::build` freezes the registrations into a `Messaging` handle,
  shared by the scheme handler and by every area that sends:
  `messaging.send(CHANNEL, &message)` appends to every open queue (R3).

**Alternatives considered**: Tauri commands with `#[tauri::command]` (R2);
untyped handlers on `serde_json::Value` (each area would parse by hand, and a
type mismatch would surface at run time instead of in `cargo check`);
generating the Rust types from the TypeScript channels (a generator for types
that are written once per channel, when its area is ported).

## R9. Showing it end to end

**Finding**: the full renderer does not load in the Tauri build before spec
003 (R3 of spec 001), and the spike's pages do not use dependency injection.

**Decision**: with `--messaging-check`, both pages of the spike build a small
DI container with `messagingFeature` and `messagingFeatureForTauri` and, from
the main window and from the frame of the cluster `--open-cluster` opens, run
20 rounds on existing channels of the list
([contracts/channel-list.md](./contracts/channel-list.md#channels-of-the-check)).
A round has three steps:

1. **Request**: `build-version`, which the core answers from then on with the
   version of the Tauri package, as Electron's main answers it with
   `app.getVersion()`. It passes when the answer is a non-empty string.
2. **Message to the core**: `frame-communication-admin-channel`. The core
   counts the view's announcements, and the step passes when the count has
   grown by the time the round's report arrives, which R5 orders after it.
3. **Message to the view**: a request on `ipc:broadcast-main` carrying
   `renderer:navigate` with the URL `/messaging-check/<view>/<round>`. It
   passes when the core answers and the view's listener of `renderer:navigate`
   receives that URL exactly once within five seconds.

The pages declare these channels with `getRequestChannel` and
`getMessageChannel` and the same ids, rather than importing them from
`packages/core`, which the spike does not depend on. Each view reports its
results on the check-only message channel `messaging-check:report`, and the
core prints them as `contracts/check-log.md` describes (FR-011, SC-003).

The same run sends texts of about 1 KB, 1 MB and 10 MB on the check-only
request channel `messaging-check:echo`, which answers each with the same text,
and reports the round-trip time of each (SC-007); the 10 MB one is also the
large request body of R14.
Both check-only channels are registered only with the flag and are not in the
Electron build. The Electron build's figures come from
`measure-electron-ipc.cjs`, which times `ipcRenderer.invoke` with the same
sizes in the Electron binary the build uses.

**Alternatives considered**: a third, check-only page (the pages exist, and the
cluster frame is the case that matters); waiting for spec 003 to run the full
renderer (it would leave this feature unproven until then).

## R10. Unit tests of the view side

**Finding**: `messaging-fake-bridge` connects several DI containers by
overriding the four tokens in each, and `messagePropagation()` resolves when
the messages in flight are delivered (**Verified**).

**Decision**: the transport of `messaging-for-tauri` is one injectable,
`postToCore`, the only code that calls `fetch`. Its tests override it with a
fake core, `getCoreFake()` in the package's `src/test-utils/`, shaped like the
fake bridge: `involve(...dis)` connects a main window and any number of
cluster frames, each with its host; `answer(channel, handler)`,
`listen(channel, handler)` and `send(channel, message)` play the core; and
`messagePropagation()` resolves when the requests, batches and polls in flight
are settled. The tests cover every acceptance scenario of User Story 1 and the
edge cases of the spec that the view side owns (R3 to R6). The fake checks the
same `Origin` and host rules as the core, so a test of a cluster frame cannot
pass by reaching the main window's host.

The package is renderer code without a context segment in its path, so its
sources are added to the `include` of `tsconfig.renderer.json`, which rejects
Node there (Principle II); its tests and `test-utils/` stay out of both
environment programs, as everywhere.

## R11. Electron IPC outside the messaging packages

The search of section 0.3 of `specs/tauri-port-runbook.md`, over non-test
sources, finds the files below; the sends to a window's web contents that it
cannot see were found by searching for `webContents`, `sendToFrame` and the
`send` method of the lens windows. The extension system under
`packages/core/src/extensions/` is exempt (FR-014) and left out. Paths are
relative to `packages/core/src/`; nothing in `freelens/src` or another package
is found.

**How a file moves**: each legacy channel becomes a typed channel with
`getRequestChannel` or `getMessageChannel`, keeping its name as the id, in the
`common/` directory of its area; its handler or listener becomes an injectable
of `getRequestChannelListenerInjectable` or
`getMessageChannelListenerInjectable` in the area's `main/` or `renderer/`
directory; its senders inject `requestFromChannelInjectionToken` or
`sendMessageToChannelInjectionToken`. A legacy channel with several arguments
carries the list of them as its message (data-model.md).

| File                                                                                                                                                                                                                                                       | Electron IPC today                                                                                                                                                                         | Move                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `common/ipc/ipc.ts`                                                                                                                                                                                                                                        | the legacy helpers `ipcMainHandle`, `ipcMainOn`, `ipcRendererOn`, `broadcastMessage`                                                                                                       | once only the extension system calls it, splits by process into `extensions/ipc/main/legacy-ipc.ts` (`ipcMainHandle`, `ipcMainOn`, the main branch of `broadcastMessage`), `extensions/ipc/renderer/legacy-ipc.ts` (`ipcRendererOn`, the view branch) and `extensions/ipc/common/legacy-ipc.ts` (`broadcastMessage` choosing its branch, re-exporting the rest). Its entry leaves the renderer legacy list and none is added: its only error in the renderer program is `ipcMain.listeners` (line 46, **Verified** with `tsc -p tsconfig.renderer.json`), which needs Node's `EventEmitter` and moves into the main part |
| `common/ipc/ipc-main-injection-token.ts`                                                                                                                                                                                                                   | token for Electron's `ipcMain`                                                                                                                                                             | moves to `extensions/ipc/main/` with the helpers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `main/utils/channel/ipc-main/ipc-main.injectable.ts`, its global override                                                                                                                                                                                  | wraps `ipcMain`                                                                                                                                                                            | move to `extensions/ipc/main/`; `pnpm build:di` regenerates `register-injectables.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `renderer/utils/channel/ipc-renderer.injectable.ts`, its global override                                                                                                                                                                                   | wraps `ipcRenderer`                                                                                                                                                                        | move to `extensions/ipc/renderer/`, with the extension-only functions of `renderer/ipc/index.ts`, unchanged; `pnpm build:di` regenerates `register-injectables.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `common/ipc/broadcast-message.injectable.ts` (calls `broadcastMessage`)                                                                                                                                                                                    | broadcast to main's listeners and every view                                                                                                                                               | keeps its id, path and signature, so the tests that fake it stay unchanged; delegates to a main implementation (`sendMessageToChannel` to the views) and a renderer one (a request on the typed `ipc:broadcast-main`, whose main handler sends it to the views). The legacy helper also called main's own listeners; the only broadcast channels main listens to are `network:offline` and `network:online`, which the root frame now sends to main directly (row of `init-root-frame` below), so dropping that call changes nothing                                                                                     |
| `features/hotbar/storage/common/hotbar.ts`, `common/catalog-entities/kubernetes-cluster.ts`, `renderer/components/layout/sidebar-cluster.tsx`, `renderer/components/clusters/search-command.tsx`, `renderer/components/command-palette/command-dialog.tsx` | import `broadcastMessage` from `common/ipc` (not found by the search, but they hold the helpers outside the extension tree)                                                                | `broadcastMessageInjectable`, through `getDiForExtensionApi()` where the code is not an injectable, as the helper reaches DI today. `KubernetesCluster` is reachable through the extension API; only its implementation changes                                                                                                                                                                                                                                                                                                                                                                                          |
| `common/protocol-handler/router.ts`                                                                                                                                                                                                                        | reads `ipcRenderer` to log "renderer" or "main"                                                                                                                                            | the main and renderer subclasses give the process name                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `main/electron-app/runnables/setup-ipc-main-handlers/setup-ipc-main-handlers.ts`                                                                                                                                                                           | handles `cluster:set-frame-id`, `window:window-action`, `window:location-changed`, `ipc:broadcast-main`, `window:open-app-context-menu`, `cluster:states`, `cluster:refresh-accessibility` | one listener injectable per channel in its area; the file goes. `cluster:states` has no sender (`requestInitialClusterStates` is never called), so its handler and that function are deleted rather than moved                                                                                                                                                                                                                                                                                                                                                                                                           |
| `main/ipc/window.ts`                                                                                                                                                                                                                                       | `webContents.getAllWebContents()` and `broadcastMessage` for the history state                                                                                                             | sends `history:can-go-back` and `history:can-go-forward` with `sendMessageToChannel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `main/catalog-sync-to-renderer/catalog-sync-to-renderer.injectable.ts`                                                                                                                                                                                     | `ipcMain.on(catalogInitChannel)`                                                                                                                                                           | message channel listener                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `main/cluster/manager.ts`                                                                                                                                                                                                                                  | `ipcMainOn("network:offline" / "network:online")`                                                                                                                                          | message channel listeners                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `main/freelens-proxy/proxy-functions/shell-request-authenticator/shell-request-authenticator.ts`                                                                                                                                                           | `ipcMainHandle("cluster:shell-api" / "app:standalone-shell-api")`                                                                                                                          | request channel listeners                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `main/tray/electron-tray/electron-tray.injectable.ts`                                                                                                                                                                                                      | `ipcMain.on("tray:set-visible")`                                                                                                                                                           | message channel listener                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `main/start-main-application/lens-window/application-window/wait-until-bundled-extensions-are-loaded.injectable.ts`                                                                                                                                        | `ipcMain.once(bundledExtensionsLoaded)`                                                                                                                                                    | message channel listener that resolves once                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `main/start-main-application/lens-window/application-window/create-electron-window.injectable.ts`, `create-lens-window.injectable.ts`                                                                                                                      | the window's `send({ channel, data, frameInfo })`: `webContents.send` / `sendToFrame`                                                                                                      | `send` leaves the window once its callers below have moved                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `main/start-main-application/lens-window/navigate.injectable.ts`, `navigate-for-extension.injectable.ts`, `reload-current-application-window.injectable.ts`                                                                                                | the window's `send`, to the main frame or to one cluster frame                                                                                                                             | messages on typed channels; a message meant for one cluster frame carries the cluster's id, and the cluster frame's listener ignores the others'                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `features/application-menu/main/menu-items/help/open-licenses/show-licenses-window.injectable.ts`                                                                                                                                                          | `ipcMain.once("request-license-content")`, `event.sender.send("license-content")` for its own window                                                                                       | deleted: the injectable is registered but nothing injects it, nothing sends `request-license-content`, and the typed `license-content` request channel already serves the licenses; the task confirms no injection first                                                                                                                                                                                                                                                                                                                                                                                                 |
| `main/logger/file-transport.injectable.ts`                                                                                                                                                                                                                 | none: a comment names `ipcMain`                                                                                                                                                            | the comment is reworded, so the search stops finding it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `features/preferences/renderer/preference-items/application/menu-bar/menu-bar.tsx`                                                                                                                                                                         | `ipcRenderer.send("tray:set-visible")`                                                                                                                                                     | `sendMessageToChannel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `renderer/api/catalog/entity/registry.ts`                                                                                                                                                                                                                  | `ipcRendererOn(catalogItemsChannel, catalogEntityRunListener)`, `ipcRenderer.send(catalogInitChannel)`                                                                                     | listener injectables and `sendMessageToChannel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `renderer/api/request-cluster-shell-token.injectable.ts`, `request-standalone-shell-token.injectable.ts`                                                                                                                                                   | `ipcRenderer.invoke` of the shell channels                                                                                                                                                 | `requestFromChannel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderer/before-frame-starts/runnables/refresh-accessibility-on-crd-changes.injectable.ts`                                                                                                                                                                | `ipcRenderer.invoke(clusterRefreshAccessibilityChannel)`                                                                                                                                   | `requestFromChannel`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderer/components/cluster-manager/cluster-status.tsx`                                                                                                                                                                                                   | `ipcRendererOn("cluster:<id>:connection-update")`                                                                                                                                          | a listener of a message channel per cluster id, enlisted with `enlistMessageChannelListenerInjectionToken` while the view is mounted                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderer/components/command-palette/command-container.tsx`, `renderer/ipc/legacy-channel-listen.injectable.ts`                                                                                                                                            | `ipcRendererOn` behind `legacyOnChannelListen`                                                                                                                                             | `enlistMessageChannelListenerInjectionToken`; `legacy-channel-listen.injectable.ts` keeps its id and becomes a thin call of it, so the tests that fake it stay unchanged                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `renderer/components/layout/top-bar/start-state-sync.injectable.ts`                                                                                                                                                                                        | `ipcRenderer.on` of the history channels                                                                                                                                                   | listener injectables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderer/frames/root-frame/init-root-frame.injectable.ts`                                                                                                                                                                                                 | `ipcRenderer.send(bundledExtensionsLoaded)`; `broadcastMessage` of `network:offline` and `network:online`                                                                                  | `sendMessageToChannel` for both                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `renderer/ipc/index.ts`                                                                                                                                                                                                                                    | `requestMain` and `emitToMain` over `ipcRendererInjectable`                                                                                                                                | the exported functions use the tokens through `getDiForExtensionApi()`, as they reach `ipcRenderer` today                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `renderer/ipc/register-ipc-listeners.injectable.ts`                                                                                                                                                                                                        | `ipcRenderer.on` of `cluster:list-namespace-forbidden` and the hotbar channel                                                                                                              | listener injectables                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `renderer/protocol-handler/lens-protocol-router-renderer/lens-protocol-router-renderer.tsx`                                                                                                                                                                | `ipcRenderer.on` of the three protocol channels                                                                                                                                            | listener injectables; their messages are the lists of the old arguments                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

Two of the channels need their sender in main:

- `window:open-app-context-menu` pops the menu up on the sender's window. Its
  message listener gets `{ processId, frameId }` and finds the window with
  `BrowserWindow.fromWebContents(webContents.fromFrame(webFrameMain.fromId(processId, frameId)))`
  (both functions are in the typings of Electron 44.10.1, **Verified**).
- `cluster:set-frame-id` is a request the cluster frame awaits, and records the
  sender's frame. A request handler of `@freelensapp/messaging` gets the
  request only, and `messaging-for-main`'s test asserts exactly that call, so
  the handler cannot simply gain a parameter. Instead a request listener may
  set `withSender: true`, and `messaging-for-main` then calls its handler with
  `(request, { processId, frameId })`. Listeners without the flag, and their
  tests, are unchanged. None of these handler types is in the published
  `packages/extensions/dist/extension-api.d.ts` (**Verified**), so the change
  stays out of the extension API.

## R12. Tests that follow the moves

Tests that fake or call a module that moves off Electron IPC (FR-019):

| Test                                                                                                                                                                                                                                                                                                                    | Couples to                                       | What changes                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `main/freelens-proxy/proxy-functions/shell-request-authenticator/shell-request-authenticator.test.ts`                                                                                                                                                                                                                   | mocks `common/ipc` to capture `ipcMainHandle`    | takes the handlers from the channel listener injectables instead; each assertion stays     |
| `extensions/__tests__/extension-loader-is-enabled-sync.test.ts`                                                                                                                                                                                                                                                         | mocks `common/ipc`                               | the mock's path follows the helpers to `extensions/ipc/common/legacy-ipc.ts`; nothing else |
| `extensions/__tests__/extension-loader.test.ts`                                                                                                                                                                                                                                                                         | `renderer/utils/channel/ipc-renderer.injectable` | the import path follows the wrapper; nothing else                                          |
| `main/__test__/freelens-k8s-proxy.test.ts`, `main/cluster/freelens-k8s-proxy-manager.test.ts`, `main/cluster/stop-freelens-k8s-proxy.test.ts`, `main/freelens-k8s-proxy/create-freelens-k8s-proxy.test.ts`, `main/protocol-handler/__test__/router.test.ts`, `features/cluster/refresh-accessibility-technical.test.ts` | override `broadcastMessageInjectable`            | unchanged: the injectable keeps its id and signature                                       |
| `renderer/frames/cluster-frame/cluster-frame.test.tsx`                                                                                                                                                                                                                                                                  | overrides `legacyOnChannelListenInjectable`      | unchanged: the injectable keeps its id                                                     |

The global overrides used by `getDiForUnitTesting` (`ipc-main`,
`ipc-renderer`, `broadcast-message`) keep working: the first two move with
their injectables, the third is unchanged. A behaviour test that ran through a
moved path with the fake bridge, rather than through a fake of the module, is
not edited; if one fails, the move changed behaviour and is fixed, not the
test.

## R13. The channel list

**Finding**: a read-only inventory of the sources found channels in four
mechanisms: the typed channels of `@freelensapp/messaging`, the legacy helpers
of `common/ipc/`, raw `ipcMain`/`ipcRenderer` calls with literal names, and the
window's `send`. Names built at run time are the store paths of
`persistent-storage`, the per-cluster `connection-update` and command-palette
names, and the per-extension prefix. Findings that change the plan:

- Some channels are dead: `cluster:states` has no sender, and the injectable
  of `request-license-content` is never injected. R11 deletes them rather than
  moving them.
- `sync-box-*` is registered but carries nothing, and `computed-channel` is not
  registered at all.
- Values `non-JSON` under R4 are the `Uint8Array` shell tokens (terminal-pty)
  and the binary download (extensions only). The catalog entities of
  `catalog:items` are class instances, which arrive as plain objects in both
  builds, so R4 lets them through.
- No main listener exists on a channel main broadcasts, except
  `network:offline` and `network:online`, which R11 sends to main directly.
- No channel belongs to main-metrics or main-port-forward.

**Decision**: [contracts/channel-list.md](./contracts/channel-list.md) groups
every row by its owner, with the searches that rebuild it, so SC-002 can be
checked by running them again. Where the inventory left the owner open, the
list decides: channels used only by extensions are not ported; `cluster:set-frame-id`
and `current-visible-cluster` belong to cluster-frames; `get-latest-version-channel`
to desktop-integration; `look-up-terminal-shell` to main-shell-env; the store
channels and `app-paths` to main-foundation, which answers what 003 reads; the
shell tokens to terminal-pty, though their handler is in `freelens-proxy`;
and the channels that only views send through the relay
(`hotbar:too-many-items`, `catalog-entity:run`,
`command-palette:<clusterId>:open`) to messaging, whose relay is all they ask
of the core. Every caller of the hotbar's `addEntity` and `toggleEntity` is in
the renderer (**Verified**), so `hotbar:too-many-items` is one of them.

## R14. Risks

- **A view stops polling without closing**, for example a frame suspended by
  WebKit: its queue grows until the 60-second or 10 000-message limit closes
  it, and it then misses messages. The check run keeps a cluster frame in the
  background for two minutes and checks that it still receives.
- **Large request bodies.** wry reads `HTTPBodyStream` while bytes are
  available; whether a 10 MB body always arrives whole is **Unverified**. The
  SC-007 run sends one, and the core refuses a body whose JSON does not parse,
  so a cut body fails loudly.
- **Order between a message and a request** holds only by R5; a feature that
  relied on more (an answer of main arriving before a message main sent
  earlier) would see a difference. No such feature is known.
