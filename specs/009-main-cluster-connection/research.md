# Research: Main Cluster Connection

Findings are marked **Verified** when read in the sources named, **Inference**
when deduced from code that was read but not run, and **Unverified** when they
rest on documentation, memory or reasoning that this research did not check.
Paths of the Electron build are relative to `packages/core/src/`; paths of the
core to `freelens-tauri/src-tauri/`; `R/` is the cargo registry source of the
exact versions in `Cargo.lock`.

## R1. What this feature ports, and where it goes

**Finding** (Verified, R9 of `specs/001-tauri-shell-spike/research.md` and the
sources): the area is the cluster connection of `main/cluster/`, the detectors
of `main/cluster-detectors/`, `main/k8s-request.injectable.ts`, the main side of
`features/cluster/{activation,connections,delete-dialog,execute,state-sync}`,
the `/api-kube` branch of `main/freelens-proxy/freelens-proxy.ts` together with
what freelens-k8s-proxy does for it, and, by the clarification of the spec, the
shell sync of `features/shell-sync/`. The core today has a GET-only
`/api-kube/` route (`src/scheme.rs:85-160`) over one `kube::Client` per cluster
(`src/clusters.rs`), from spec 001.

**Decision**: a module directory `src/cluster/`, which replaces `src/clusters.rs`
and takes the `/api-kube/` route out of `src/scheme.rs`, and a module
`src/foundation/shell_env.rs` for the shell sync:

| Module                       | Ports                                                                                   |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `cluster/mod.rs`             | `Clusters`, the shared handle: the connections, their states, the deleting set          |
| `cluster/client.rs`          | the `kube::Client` of a cluster (R2), replacing `src/clusters.rs`                       |
| `cluster/exec.rs`            | the credential plugins (R3)                                                             |
| `cluster/connection.rs`      | `ClusterConnection`: activation, status, refreshes, backoff, disconnect (R5)            |
| `cluster/access.rs`          | admin, namespaces, API resources, resources to show (R6)                                |
| `cluster/detect.rs`          | the metadata detectors (R7)                                                             |
| `cluster/api_kube.rs`        | the `/api-kube/` route for answers in one piece (R9)                                    |
| `cluster/watch.rs`           | watches over the view's queue (R10)                                                     |
| `cluster/kubeconfig_edit.rs` | `cluster-kubeconfig-contexts`, `remove-cluster-context-from-kubeconfig`, the lock (R12) |
| `cluster/execute.rs`         | `execute-on-cluster` (R13)                                                              |
| `cluster/channels.rs`        | the channels of main-cluster-connection (R14)                                           |
| `foundation/shell_env.rs`    | the shell sync (R4)                                                                     |

The catalog (`src/catalog/`) gains the phase of each cluster entity (R8); the
frame record and the queues of the messaging gain what R10 and R11 need. The
Tauri build's own pages gain the views of FR-029 (R15).

## R2. The client of a cluster

**Finding** (Verified, R/kube-client-5.1.0 and `Cargo.lock`):

- `kube` 5.1.0 runs with its default features `client`, `config`, `rustls-tls`
  and `ring`; `http-proxy`, `socks5`, `oidc`, `ws` and `gzip` are off. Its
  stack is HTTP/1.1 only (`config_ext.rs:468`): each request in flight, each
  watch included, holds its own TCP and TLS connection; idle connections are
  pooled 90 s, with no limit per host.
- `Client::send` passes any method, path, query, header and body, and returns
  the status, the headers and a streamed body, without turning a status into
  an error (`client/mod.rs:211-232`). `request_text` and its siblings collect
  the body and drop the headers. Dropping the response future or body drops
  the request (tower `Buffer`, `worker.rs:170-177`).
- It sets `Authorization` for token, token file, basic and refreshable
  credentials, overwriting the request's own; with a client certificate, an
  incoming `Authorization` passes through (`config_ext.rs:352-366`). It adds
  `Host`, impersonation headers, and nothing else.
- `default_retry: true` retries 429, 503 and 504 up to 15 times for every
  method (`client/retry.rs:96-167`). Timeouts: connect 30 s, read none, write
  295 s, each per I/O operation (`config/mod.rs:446-447`); no limit on a
  request as a whole. Redirects are not followed.
- The proxy URL is the kubeconfig's `proxy-url`, else `HTTPS_PROXY` or
  `https_proxy` (`file_loader.rs:139-155`); `Config.proxy_url` is public. With
  `http-proxy` and `socks5` off, any proxy URL fails the client's build with
  `ProxyProtocolDisabled` (`builder.rs:232-295`), so an `HTTPS_PROXY` in the
  core's environment breaks every cluster today. With them on, `http` and
  `https` proxies tunnel with CONNECT and Basic proxy credentials from the URL,
  and `socks5` resolves names at the proxy; `NO_PROXY` is honoured. Their
  dependencies (ipnet, percent-encoding, base64 0.23.1) are in `Cargo.lock`.
- TLS: the context's certificate authority alone when it names one, else
  rustls-platform-verifier; `insecure-skip-tls-verify` accepts any
  certificate; `tls-server-name` sets the SNI and the name verified. Client
  keys in PKCS8, PKCS1 or SEC1 PEM; RSA, ECDSA P-256 and P-384 and Ed25519.
- `auth-provider: oidc` without the `oidc` feature sends the `id-token` as it
  is; with it, kube refreshes the token in memory with the refresh token and
  does not write it back (`auth/oidc.rs`). `gcp` with `cmd-path` is supported;
  `azure` is refused with a pointer to kubelogin.
- `src/clusters.rs` sets a 30 s read timeout, which would cut a watch that is
  quiet for 30 s, and leaves `default_retry` on.

**Finding** (Verified, `main/cluster/freelens-k8s-proxy-manager.injectable.ts`
and `create-freelens-k8s-proxy.injectable.ts`): the Electron build starts one
freelens-k8s-proxy per cluster with `--kubeconfig <file>`, the context in
`FREELENS_PROXY_CONTEXT`, and the environment of its main process, plus
`HTTPS_PROXY` from the cluster's `httpsProxy` setting when it is set.
freelens-k8s-proxy is client-go; its source is not in this repository
(`freelens/package.json`, `k8sProxyVersion` 2.0.1). That client-go takes the
kubeconfig's `proxy-url` before `HTTPS_PROXY`, and honours `NO_PROXY` for the
latter, is **Unverified** here.

**Decision**:

- One `kube::Client` per cluster, built on first use from
  `Kubeconfig::read_from(<file>)` and the context, as spec 008 builds it, with
  `default_retry = false` (the Electron build's chain retries nothing),
  `connect_timeout` 30 s and no `read_timeout`: the inactivity limits of the
  Electron build's proxy are applied per request (R9, R10).
- kube's `http-proxy`, `socks5` and `oidc` features are turned on; no crate is
  added to `Cargo.lock` (Verified when added: the lock gains only the edges
  from kube-client to `form_urlencoded` and `ipnet`, and from the crate to
  `sha2` 0.10.9, all three packages already locked). The proxy is the kubeconfig's `proxy-url`, else the
  cluster's `httpsProxy` setting, else kube's own reading of `HTTPS_PROXY`, the
  order the Electron build's environment gives client-go (Unverified for
  client-go, checked by quickstart section 4).
- A context with `exec` gets its credential from R3; the client is built with
  that credential in place of `exec` and built again when it renews.
- The client is dropped on `ClusterChanged` and `ClusterRemoved` of the
  catalog (spec 008), on a disconnect, and when its credential renews.
- HTTP/1.1 stays. **Rejected**: HTTP/2 to the API server, as client-go uses
  (Unverified for freelens-k8s-proxy). It needs the `h2` crate, absent from
  `Cargo.lock`, and a service stack built by hand around kube's layers. The
  scenario opens a handful of watches; SC-004 and SC-005 measure whether one
  connection per watch costs more than the Electron build, and a failure
  reopens this choice.

## R3. Credential plugins

**Finding** (Verified, R/kube-client-5.1.0 `client/auth/mod.rs:565-646`,
`config_ext.rs:353,416,550`, `builder.rs:423`): kube runs an `exec` plugin
with `std::process::Command::output()`, synchronously, without a timeout, three
times for each client it builds, inheriting the core's whole environment plus
the kubeconfig's `env` entries. With `interactiveMode` unset, `IfAvailable` or
`Always` it hands the plugin the core's stdin and stderr. A token with an
expiry is renewed 60 s before it, under a lock that holds every request of the
client. A client certificate from a plugin is never renewed. kube does not
react to a `401`.

**Finding** (Verified, `main/cluster/cluster-connection.injectable.ts:90-231`
and `cluster-connection-auth-backoff.test.ts`): the Electron build learns of a
plugin's failure as freelens-k8s-proxy's `500` whose body is client-go's error,
`getting credentials: exec: …`, and of a plugin that does not finish as its own
30 s timeout. freelens-k8s-proxy runs headless; that client-go keeps the
plugin running past the timeout, and renews a credential after a `401`, is
**Unverified** here.

**Decision**: the core runs the plugins itself, in `cluster/exec.rs`, and hands
kube the result as a `token`, or as `client-certificate-data` and
`client-key-data`, in place of `exec`:

- The command is the kubeconfig's, resolved against the file's folder when it
  contains `/`, and otherwise looked up on the `PATH` of the shell sync (R4)
  before it runs, so that the lookup does not depend on how `std` searches a
  `PATH` set for the child (Unverified, `rust-src` is not installed).
- Its environment is the core's, merged with the shell sync's (R4), plus the
  kubeconfig's `env` entries, which win; `KUBERNETES_EXEC_INFO` holds the
  `ExecCredential` with the kubeconfig's `apiVersion`, `spec.interactive:
  false` and, with `provideClusterInfo`, `spec.cluster`. stdin is empty;
  stdout is the credential and is never logged; stderr is kept for the error.
  The plugin runs in a process group of its own (`setsid`).
- One run per cluster at a time: a request that needs the credential while a
  run is going waits for it. The status check of R5 gives up after 30 s with
  the Electron build's timeout message, while the run goes on, so that an
  interactive login can still finish and serve the next attempt.
- A credential with `expirationTimestamp` is used until 60 s before it, as
  kube does; one without is used until a `401` or a disconnect. A `401` from
  the API server drops it, and the next request runs the plugin again.
- A disconnect, a delete and quitting kill the process group of a run.
- A failure is worded as client-go words it (`getting credentials: exec:
  executable <command> failed with exit code <n>`, `… not found`), so that
  R5 classifies it as the Electron build does. The exact client-go texts are
  Unverified; the parity case of R18 with a failing plugin fixes them.
- `interactiveMode: Always` fails as client-go fails it without a terminal
  (Unverified text, fixed by the same case).

**Rejected**: kube's own runner, with the shell sync's variables put into
`auth_info.exec.env`. It runs a plugin three times for each client, which opens
three browser tabs for an interactive login, blocks a worker thread without a
timeout, and gives no process to kill on quit (FR-024).

## R4. The shell sync

**Finding** (Verified, `features/shell-sync/main/*`,
`common/vars/main/default-shell.injectable.ts`,
`features/user-preferences/main/shell-setting.injectable.ts`):

- The shell is the `shell` setting, else the user's login shell
  (`os.userInfo().shell`), else `$SHELL`, else `zsh` on macOS.
- It runs detached (a new session) with arguments chosen by the shell's base
  name: `-l -i -c <command>` for bash, sh, zsh and the rest; `-l -c <command>`
  for fish; `-l` with the command on stdin for csh and tcsh; `-Login` with a
  Node script for pwsh. The command is
  `printf '%s' <mark>; /usr/bin/env -0; printf '%s' <mark>`, the mark 32 hex
  characters. The shell gets the main process's environment plus
  `ITERM_SHELL_INTEGRATION_INSTALLED=1`, `TERM=screen-256color-bce` and
  `VSCODE_SHELL_INTEGRATION=1`, which are reset in the result.
- The output between the marks is split on NUL, each record on its first `=`;
  a record without `=` is skipped. Failures: `Failed to spawn <path>: <json>`,
  `Shell did not exit successfully: <json>`,
  `Something has blocked the shell from producing the environment variables`.
  After 30 s the process group is killed with `SIGKILL` and the error is
  `Resolving shell environment is taking very long. Please review your shell
  configuration: timeout: <json>`.
- The merge: the shell's `PATH` first, the main process's after it, no entry
  twice; for every other variable the main process's own value wins; `LANG`,
  when the shell has none, is the locale with `_` and `.UTF-8`, and `.UTF-8` is
  appended to one without it.
- It runs in `onLoadOfApplication`, so the window opens after it (Inference,
  `start-application.injectable.ts:20-24`). A failure is logged as
  `[SHELL-SYNC]: <error>`, kept, and sent once on `shell-sync-failed-channel`
  after the root frame has rendered; the renderer shows
  `Failed to sync shell environment: <error>`.

**Decision**: `foundation/shell_env.rs` does the same, with three differences:

- It starts at startup on the async runtime and does not hold the window back
  (FR-033); the credential plugins wait for it, up to its 30 s (FR-035).
- It does not change the core's process environment, which other threads read
  (`set_var` is unsafe there); it keeps the merged environment as a shared
  value that the plugins of R3, and later kubectl, helm and the terminals,
  read.
- pwsh gets `-Login -Command` with a PowerShell script that prints the marks
  around the environment as JSON, since the Tauri build ships no Node; the
  result is parsed the same way as the Electron build's JSON.

The locale of `LANG` is the first preferred language of macOS
(`NSLocale.preferredLanguages`, through the direct dependency
`objc2-foundation`), with its first `-` made `_`, as the Electron build makes
it from `app.getLocale()`. The failure is sent on `shell-sync-failed-channel` to
the main window when its page first loads (the `Restarted` event of its queue),
once.

## R5. Connecting

**Finding** (Verified, `main/cluster/cluster-connection.injectable.ts`,
`main/cluster/manager.ts`, `features/cluster/activation/main/*`, and their
tests):

- `activate(force)`: an activated cluster is left alone unless forced; an
  activation in flight is shared; a forced one waits for the one in flight.
  Unknown ids are ignored. `activated` becomes true at the end even when the
  status check found the cluster offline or refused.
- The activation, in order, with its messages on
  `cluster:<id>:connection-update` (`{ message, level }`):
  1. if disconnected or not accessible: `info` `Starting connection ...`, then
     reconnect (reset the backoff, restart the proxy, `disconnected = false`);
     on failure `error` `Failed to start connection: <error>`, and stop;
  2. `info` `Refreshing connection status ...`, the status check; on failure
     `error` `Failed to connection status: <error>`, and stop;
  3. if accessible: `info` `Refreshing cluster accessibility ...`, R6; on
     failure `error` `Failed to refresh accessibility: <error>`, and stop;
     then `info` `Connected, waiting for view to load ...`.
- The status check is `GET /version` with a 30 s limit. Success records
  `metadata.version` and `metadata.lastSeen`, resets the backoff, and gives
  access granted. The failures, all at level `error`:

  | Failure                                              | Message                                                                               | Backoff | Status        |
  | ---------------------------------------------------- | ------------------------------------------------------------------------------------- | ------- | ------------- |
  | HTTP status 400 to 499                               | `Invalid credentials`                                                                 | counted | access denied |
  | other status, body names a credential plugin failure | `Failed to fetch credentials: <body>`                                                 | counted | access denied |
  | other status                                         | the body, or the status text when it is empty                                         | no      | offline       |
  | 30 s passed, the context uses `exec`                 | `Connection timed out, the credential plugin may be waiting for an interactive login` | counted | offline       |
  | 30 s passed                                          | `Connection timed out`                                                                | no      | offline       |
  | anything else                                        | the error's text                                                                      | no      | offline       |

  A body names a plugin failure when it matches `getting credentials`,
  `exec plugin` or `credential plugin`, without regard to case.
- The backoff: after the n-th counted failure the 30 s refresh waits 60 s,
  then 300 s; at the third it logs and sends `error` `Authentication failed 3
  times, automatic reconnection paused: reconnect to try again`, and stops
  until a reconnect. A success, a reconnect and a disconnect reset it.
- Timers: every 30 s the connection status, when not disconnected and the
  backoff allows; every 15 minutes the accessibility and the metadata, when
  available. Overlapping 30 s refreshes are skipped.
- `bindEvents` runs on every activation, because the disposer's `length` is
  always 0 (`cluster-connection.injectable.ts:307`), so each activation adds
  another pair of timers until a disconnect.
- A disconnect does not cancel an activation in flight.

**Decision**: `cluster/connection.rs` reproduces the steps, the texts, the
levels, the order, the classification and the backoff, and the `activated`
flag. The core's failures map to the table as follows: an API status as the
table says; a credential plugin's failure (R3) as the plugin row, with
client-go's wording as the body; a connection refused, a name not resolved or
a certificate not trusted as "anything else", with the core's own text naming
the cause (FR-002); the 30 s limit as the timeout rows. Reconnect builds the
client (R2) where the Electron build restarts the proxy; a client that cannot
be built (an unreadable file, a context without a cluster) fails step 1 with
its reason. Two deliberate differences, neither visible in a message or a
state: a connection binds one pair of timers, however many times it is
activated; and an activation stops applying what it learns once the cluster
has been disconnected (a generation count), where the Electron build lets it
finish.

## R6. Accessibility

**Finding** (Verified, `cluster-connection.injectable.ts:422-641`,
`common/cluster/create-can-i.injectable.ts`,
`common/cluster/create-request-namespace-list-permissions.injectable.ts`,
`main/cluster/request-*.injectable.ts`): in this order, through the proxy (so
under its 30 s inactivity limit):

1. `isAdmin`: `SelfSubjectAccessReview` `{namespace: "kube-system", resource:
   "*", verb: "create"}`; `status.allowed`, `false` on any error (logged
   `[AUTHORIZATION-REVIEW]: failed to create access review: <error>`).
2. `isGlobalWatchEnabled`: the same with `{verb: "watch", resource: "*"}`.
3. Allowed namespaces: the `accessibleNamespaces` of the cluster's settings when
   any, else the names of `GET /api/v1/namespaces`; on an error, the default
   namespace of the cluster's settings or of its context; when that is empty
   and the error was a `403`, log and send `cluster:list-namespace-forbidden`
   with the cluster id.
4. Known resources: `GET /api` and `GET /apis`, each in up to 5 attempts after
   1, 2, 4 and 8 s, every failed attempt sending `warning`
   `Failed to list kube API resource kinds, attempt <n>: <error>`; then each
   group version path, 5 at a time, a failed one sending `warning`
   `Kube APIs under "<path>" may not be displayed`. Each resource is
   `{apiName, kind, group, version, namespaced}`, subresources included. On a
   failure with no earlier list: `error` `Failed to list kube API resources,
   please reconnect...` and an empty list; with an earlier list, keep it.
5. Resources to show: none without allowed namespaces; else a
   `SelfSubjectRulesReview` per namespace, 5 at a time, keeping a resource
   that any namespace allows to `list` (an incomplete or failed review allows
   all); `skipNamespaceAuthorizationCheck` skips the reviews. Each is written
   `<group>/<apiName>`, or `<apiName>` for the core group.
6. `ready` is whether any resource is known. The state changes in one step.

**Decision**: `cluster/access.rs` does the same, with the core's client and the
30 s inactivity limit of R9 on each request. The tests port the cases of
`common/cluster/request-namespace-list-permissions.test.ts` and the skipped
cases of `features/cluster/refresh-accessibility-technical.test.ts`, whose
order of requests they assert.

## R7. Metadata

**Finding** (Verified, `main/cluster-detectors/*`,
`cluster-connection.injectable.ts:413-420`): the detectors run in parallel;
for each key the highest accuracy wins, a tie going to the later; a detector
that throws or answers nothing is left out; the result replaces the cluster's
metadata, so a key not detected this time disappears, `prometheus` included.

| Key            | Request                                                                | Value                                                                                                         | Accuracy |
| -------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------- |
| `version`      | `GET /version`                                                         | `gitVersion`                                                                                                  | 100      |
| `id`           | `GET /api/v1/namespaces/default`                                       | SHA-256 hex of its `metadata.uid`; on an error, of the server URL as `new URL()` writes it                    | 100      |
| `lastSeen`     | `GET /version`                                                         | the time, as `Date.toJSON()` writes it                                                                        | 100      |
| `nodes`        | `GET /api/v1/nodes?limit=1`, and the whole list when it has `continue` | items plus `remainingItemCount`, or the whole list's length                                                   | 1000     |
| `distribution` | `GET /version`; `GET /` for a version with `+`                         | the first of 21 rules on the version, the context name and the server's host (`rke`, `k3s`, `eks`, `kind`, …) | 10 to 90 |

Detection runs on the 15-minute timer and on `cluster:refresh-accessibility`,
not on activation. Each successful status check also records `version` and
`lastSeen`. The metadata is part of the cluster store entry.

**Decision**: `cluster/detect.rs` ports the five detectors, the 21 rules in
their order, and the replacement, writing the entry through `Stores::update`
of spec 007. Dropping `prometheus` is kept: the cluster store must be the
Electron build's, and main-metrics owns that key. `sha2` 0.10.9, in
`Cargo.lock` already, becomes a direct dependency for the id. The URL is
written as WHATWG URL serialization writes it for the forms a kubeconfig
server takes (scheme and host in lower case, the default port dropped, an
empty path as `/`); the parity cases of R18 cover them.

## R8. The catalog status and the cluster state

**Finding** (Verified, `main/cluster/manager.ts:134-183`,
`features/cluster/state-sync/main/*`, `common/cluster/cluster.ts`):

- The phase of a cluster entity: `deleting` with `enabled: false` while the
  cluster is in the deleting set; else `connected` when accessible,
  `connecting` when not disconnected, `disconnected` otherwise, with `enabled:
  true`. Clearing the deleting mark recomputes nothing until the next change
  (Inference).
- The state is `{online, ready, disconnected, accessible, isAdmin,
  allowedNamespaces, resourcesToShow, knownResources, isGlobalWatchEnabled}`,
  starting disconnected with everything false or empty. A disconnect sets
  `disconnected`, clears `online`, `accessible`, `ready` and the allowed
  namespaces, and keeps the rest.
- `cluster-state-sync` sends `{clusterId, state}` to every view whenever a
  cluster's state differs from the last one sent, every cluster once at
  startup; `initial-cluster-state-sync` answers every cluster's state.

**Decision**: `Catalog` gains the phase and `enabled` of each cluster entity,
set by `Clusters`, and sends `catalog:items` with spec 008's coalescing. Clearing
the deleting mark recomputes the phase at once, a deliberate difference that
only removes a stale `deleting`. `Clusters` keeps a state per cluster of the
catalog, sends it on change with the field order above, and answers the
initial request with every cluster the catalog has.

## R9. The /api-kube proxy, for answers in one piece

**Finding** (Verified, `main/freelens-proxy/freelens-proxy.ts:462-570`,
`cluster-route-redirect.ts`, `freelens-k8s-proxy-target.ts`,
`freelens-k8s-proxy-manager.injectable.ts:42-43`):

- A path that is not normalized (`/./`, `%2e`, `..`, a backslash, an absolute
  form) gets `400` `Bad Request`, `text/plain`. Any other path under
  `/api-kube` goes to the cluster, with any method.
- A disconnected cluster gets `503` with the `Status`
  `{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"Cluster <id> is not connected","reason":"ServiceUnavailable","code":503}`;
  a proxy that cannot start the same with `Failed to start the proxy of
  cluster <id>: <error>`.
- Request headers: `Authorization`, `Cookie`, `Origin`, `Host`, `Connection`,
  `Keep-Alive`, `Proxy-Connection`, `TE`, `Transfer-Encoding`, `Upgrade`,
  `Expect`, `Accept-Encoding` and every header a `Connection` header names are
  removed; the rest, `Accept`, `Content-Type`, `User-Agent` and `X-*` among
  them, are forwarded.
- Response: the status and headers of the API server, without
  `Transfer-Encoding`, `Connection` and `Keep-Alive`, with `Cache-Control:
  no-store`; a `3xx` `Location` inside the API server's base path is rewritten
  to `/api-kube<path>` with its query and fragment, any other left alone. An
  error before the headers gives `500` `Oops, something went wrong.\n<error>`;
  after them, the response just ends.
- Inactivity limits: 30 s for a request, 4 h for a watch.
- `watch` and `follow` make a request a watch unless absent, `false`, `f` or
  `0`; the renderer sends `watch=1&resourceVersion=<rv>&timeoutSeconds=600`
  and reads pod logs by polling, never with `follow`
  (`packages/utility-features/kube-api/src/kube-api.ts:805-833`,
  `renderer/components/dock/logs/store.ts:142-196`).

**Finding** (Verified, R/wry-0.57.3 `wkwebview/class/url_scheme_handler.rs`):
the scheme hands the core the whole request body; a response goes out in one
piece; a repeated response header keeps only its last value, and a value that
is not visible ASCII is dropped; when the page cancels a request, the core is
not told.

**Decision**: `cluster/api_kube.rs` adds one `/api-kube/` route for each
method the renderer uses (`GET`, `POST`, `PUT`, `PATCH`, `DELETE`, `HEAD`), for
the cluster views only, the cluster from the view (spec 004). It drops the
`/api/` and `/apis/` restriction of specs 001 and 004 and applies the
normalization rule instead, as the Electron build does; routes.md of spec 004
changes with it. It reproduces the statuses and bodies above, the header rules,
`no-store` and the redirect rule, sends through `Client::send`, and applies the
30 s inactivity limit while it waits for the head and between chunks of the
body. A request whose query makes it a watch gets `400` with a `Status` that
names the watch channel of R10, since no answer in one piece can carry it. A
request the page cancels runs until its answer or its limit, since the scheme
does not report the cancellation; the core cancels it when the frame goes away
or the cluster is disconnected (R11). The wry header limits are recorded in
the contract; no header the renderer reads repeats (Inference).

## R10. Watches

**Finding**: no way of the Tauri build carries a stream to a cluster frame
today. A scheme answer is one piece (R9). `tauri::ipc::Channel` delivers by
`evaluateJavaScript` in the main frame only, and its scripts are injected in the
main frame only (Verified, R/tauri-2.12.7 `ipc/channel.rs:292-321`,
`manager/webview.rs:160-205`), so it cannot reach a frame on another origin.
The messaging of spec 002 already delivers messages to each view in order,
over one long poll per view that the core answers as soon as a message waits
(`specs/002-messaging-for-tauri/contracts/ipc-routes.md`); a queue closes
above 10 000 waiting messages.

**Decision**: a watch travels over the view's queue:

- The frame asks `kube-watch:open` `{id, path, headers}`; the core sends the
  request as R9 sends one, and answers once the API server's head arrives:
  `{status, headers}`, with the whole `body` when the status is not 2xx, which
  ends it.
- The core then sends `kube-watch:data` `{id, text}` as the body arrives, and
  `kube-watch:end` `{id, error?}` when it ends. The text is the body decoded as
  UTF-8 across chunk boundaries, as the renderer's `TextDecoder` does.
- A watch has at most one `data` message waiting in its view's queue: a chunk
  that arrives while one waits is appended to it. The queue therefore holds at
  most one message per watch, never reaches its limit, and a poll carries all
  that arrived since the last.
- The frame sends `kube-watch:close` `{id}` when it stops reading. The core also
  ends a view's watches when its queue restarts or closes, when its frame is
  forgotten, and when its cluster is disconnected, deleted or leaves the
  catalog (R11). The inactivity limit is 4 h, as the Electron build's.
- On the page, `kube-fetch.ts` gives `fetch`'s shape to it: for a watch URL it
  returns a `Response` whose body is a `ReadableStream` fed by these messages,
  and whose cancel sends `kube-watch:close`; any other URL goes to `fetch`. The
  renderer's own fetch can take it in the spec that runs the renderer.
- The four channels are Tauri-only rows of main-cluster-connection in the
  channel list (FR-027).

**Rejected**: a streaming scheme response, which needs a fork of wry and Tauri
(`respond` takes a whole body in both); `tauri::ipc::Channel`, for the reason
above; a long poll route per watch, which duplicates the queue and adds a poll
per watch; a WebSocket on a local port, which FR-018 forbids.

**First measurement** (T015, on the kind cluster of `specs/baseline.md`, the
branch's packaged Electron build against the Tauri release build, medians of
three runs, five for the pods): the first Config Map row of All Namespaces
105 ms in the Electron build, 35 ms in the Tauri build; the first Pod row
29 ms and 3 ms; a pod's row after `kubectl` returns, 427 ms and under 1 ms to
appear, 953 ms and under 1 ms to leave (the Tauri page marks a row before
`kubectl` has exited, hence times at or below zero); CPU of the main process
over 60 s, 0.73 s and 0.06 s, the Electron figure counted from before the
cluster is opened and the Tauri one from the click of Config Maps, since the
Tauri pages had no connection yet. The Tauri pages render each event at once,
where the renderer's object store batches them; T064 measures the pages of
FR-029. The figures leave R10 and R2 as decided.

## R11. Disconnecting, deleting, frames and quitting

**Finding** (Verified, `features/cluster/activation/main/request-deactivation.injectable.ts`,
`features/cluster/delete-dialog/main/*`, `main/cluster/disconnect-clusters-removed-from-catalog.injectable.ts`,
`main/cluster/stop-cluster-connections-on-quit.injectable.ts`,
`renderer/components/delete-cluster-dialog/view.tsx:51-70`):

- `deactivate-cluster`: an unknown id does nothing; else disconnect and forget
  the frame. Disconnecting a disconnected cluster only stops its proxy.
- The delete dialog sets the deleting mark, removes the context from the file,
  removes the cluster from the hotbars, asks `delete-cluster`, and clears the
  mark; it never removes a file. `delete-cluster`: an unknown id does nothing;
  else disconnect, forget the frame, remove the cluster store entry and remove
  `lens-local-storage/<id>.json`, ignoring an error. The deleting set takes any
  id without a check.
- A cluster that leaves the catalog and is still in the cluster store is
  disconnected, logged as `[CLUSTER]: cluster left the catalog,
  disconnecting`. Quitting disconnects every cluster.
- Both builds emit an app event in `deactivate-cluster` and `delete-cluster`
  for the app event bus, which serves the extension API (Inference).

**Decision**: `Clusters` does the same with the frame record of spec 004, the
stores of spec 007 and the local storage of spec 007. A disconnect also ends
the cluster's watches and requests in flight (R9, R10), drops its client and
kills a credential plugin run. Quitting disconnects every cluster and kills
the shell sync's shell if it still runs. The app event has no counterpart
(Principle VII).

## R12. The kubeconfig of a cluster

**Finding** (Verified, `features/cluster/delete-dialog/main/*`,
`node_modules/.pnpm/proper-lockfile@4.1.2/…/lib/lockfile.js`):

- `cluster-kubeconfig-contexts`: an unknown cluster fails with
  `Cluster "<id>" is not registered`; the file is read strictly, so any entry
  that fails the schema fails the request; the answer is the context names,
  `currentContext` when set, and the namespace of the cluster's own context.
- `remove-cluster-context-from-kubeconfig`: the same refusal; under the lock,
  read the file (validation errors ignored), drop the contexts of the
  cluster's name, set `current-context` to the new one when given, and write
  the file back with client-node's `dumpYaml`, in place. The clusters and users
  stay; whatever client-node does not model is lost.
- The lock is the directory `<real path>.lock`, made with `mkdir`; it is stale
  when its time is older than 10 s, its holder touches it every 5 s, and a
  lock held and not stale fails at once with `Lock file is already being
  held`.

**Decision**: `cluster/kubeconfig_edit.rs` answers the contexts with spec 008's
loader and its strict validation, and removes a context under the same lock
directory with the same timings and error, so that both builds exclude each
other on a file (Inference: neither tool checks the other's lock otherwise).
It edits the YAML as a generic value: it removes the context entries and sets
`current-context`, and keeps every other entry and field, which is at least
what the Electron build keeps (FR-023). It writes to a temporary file next to
the real path and renames it, keeping the file's mode, so that a symbolic link
stays and a reader never sees half a file. Formatting and key order follow the
core's YAML writer; the parity cases compare the parsed result.

## R13. execute-on-cluster

**Finding** (Verified, `features/cluster/execute/main/execute-handler.injectable.ts`,
`packages/utility-features/kube-api/src/kube-api-parse.ts:87-111`,
`packages/utility-features/utilities/src/lowerAndPluralize.ts`): the request
`{clusterId, operation, resource: {apiVersion, kind, namespace?, name?,
labelSelector?, fieldSelector?}, body?, patchType?}`; refusals `503`
`ClusterNotAccessible` for an unknown or inaccessible cluster, `500`
`ConfigurationError` for a context without a server, `400` `BadRequest` for an
unknown operation; the URL `/api` or `/apis`, the version, the namespace, the
kind lowered and pluralized (`y` to `ies`; `s`, `x`, `z`, `ch`, `sh` take
`es`; else `s`) and the name; `GET`, `POST`, `PUT`, `PATCH` (strategic by
default, merge or JSON patch) or `DELETE`; `User-Agent: Freelens/<version>`;
answers `{success, data?, error?: {message, code?, reason?}}`. Its only sender
is the extension API (`extensions/renderer-api/k8s.ts`).

**Decision**: `cluster/execute.rs` ports it with the core's client.

## R14. The other channels

**Decision** (each from the sources named in the channel list, Verified):

- `cluster:refresh-accessibility` answers `true` after R6 and R7, and `true` at
  once for an unknown id; an error reaches the view.
- `network:offline` marks every connected cluster offline and inaccessible,
  then checks its status; `network:online` checks the status of every
  connected cluster; neither consults the backoff.
- `cluster:<id>:connection-update` is a name per cluster; `Sender` gains a
  send by a name built at run time, since `MessageChannel` ids are static.
- `shell-sync-failed-channel` moves to this area (R4).
- FR-026: `activate-cluster`, `deactivate-cluster`, `set-cluster-as-deleting`,
  `clear-cluster-as-deleting`, `delete-cluster`, `cluster:refresh-accessibility`,
  `cluster-kubeconfig-contexts`, `remove-cluster-context-from-kubeconfig` and
  `execute-on-cluster` refuse a cluster frame that names another cluster, with
  a log line, as `cluster:set-frame-id` does in spec 004.

## R15. The Tauri build's own pages

**Decision** (FR-029): the catalog page (`freelens-tauri/ui/src/renderer/catalog.ts`)
requests `activate-cluster` when a cluster is clicked, shows the connection
updates and the phase from `catalog:items`, offers Reconnect (`force`),
Disconnect, and Delete with the Electron build's dialog steps (R11): the
contexts of the file, the choice of a new current context when the removed
one is current, the deleting mark around the requests. It shows the shell
sync's failure. The frame page (`cluster.ts`) follows `cluster-state-sync`,
shows a sidebar once the cluster is ready with Pods and Config Maps when they
are among the resources to show, a namespace choice of the allowed namespaces
or All Namespaces, kept for both lists as the renderer keeps it, and each list
as a table of name and namespace, loaded with a list request and kept current
with a watch through `kube-fetch.ts`, as the renderer's store does (list, then
watch from the list's `resourceVersion`, one watch for all namespaces when
global watch is possible, else one per namespace). The pages use no channel
the renderer does not use but the watch channels, and no stylesheet beyond the
markup they have.

`--scenario=lists`, a launch option for measurements like `--open-cluster`,
makes the pages run the scenario themselves and post a mark with the wall
clock at each step (R17).

## R16. The log

**Decision**: the core logs what the Electron build logs, with the same
prefixes (`[CLUSTER]`, `[CLUSTER-MANAGER]`, `[AUTHORIZATION-REVIEW]`,
`[AUTHORIZATION-NAMESPACE-REVIEW]`, `[LIST-API-RESOURCES]`, `[SHELL-SYNC]`,
`[execute-api]`), in the log of spec 007. It never logs a credential, a
plugin's stdout, a request's or response's `Authorization`, or the shell's
environment; a plugin failure logs the command's name and exit code.

## R17. Measuring

**Finding** (Verified, `specs/baseline.md` and `specs/profile-main.mjs`): the
Electron figures were taken with Playwright over CDP, as the moment Playwright
saw an element, with the main inspector open; the CPU with `ps -o time` from the
first click to the end, without the profiler (`NO_PROFILE=1`): sidebar 882 ms,
first Pod row 25 ms, main CPU 0.75 s. WKWebView offers no CDP.

**Decision**: `specs/009-main-cluster-connection/measure-connection.mjs`
measures both builds with the same steps on the kind cluster, in a data
directory of its own that syncs only the kind kubeconfig:

- **`lists`** (SC-002, SC-003, SC-004, SC-006), three runs per build. Each time
  is taken in the page, as the wall clock (`performance.timeOrigin +
  performance.now()`) at the click and when the element is in the document: the
  Tauri pages post them under `--scenario=lists`; in the Electron build a
  script that the measurement injects through CDP into both frames records the
  same points with a `MutationObserver`, so that neither build is timed by
  polling. The CPU is `ps -o time` of the main process from the first click to
  60 s later; the Electron build runs as `NO_PROFILE=1` runs it. The Electron
  build is measured again rather than taken from `specs/baseline.md`, whose
  build is older and timed differently.
- **`watch`** (SC-005), five times each for a pod created and deleted with
  `kubectl`: the time from `kubectl` returning to the row appearing or
  leaving, observed the same way.
- **`messages`** (SC-001, SC-009, SC-013): the connection updates and states
  each build sends for the kind context and for made-up contexts (a refused
  port, a token the API server refuses, a plugin that fails, a plugin found
  only on the `PATH` of a test shell named by the `shell` setting, a token and
  key held in the file), recorded by the main inspector hook of spec 008 for the
  Electron build and by `--messages-dump=<path>` for the Tauri build, which
  appends every message the core sends, as `--catalog-dump` does; then
  searched for the placeholder credentials. The app is started with `open -n`,
  as from the Finder.
- **`ports`** (SC-010, SC-011): `lsof` of the core's listening sockets and
  `ps` of its children during and after the scenario; the API server's
  `apiserver_longrunning_requests` for `WATCH` before a disconnect and after.

The figures go into `specs/baseline.md`.

## R18. Proving parity

**Decision**:

- Cargo tests run the connection, the accessibility, the detectors, the
  `/api-kube` route, the watches, the plugins and the kubeconfig edits against
  a fake API server in the test, over plain HTTP and over TLS with a
  certificate made by `openssl` at test time, as `tests/foundation.rs` makes
  its own; no key is committed.
- Shared fixtures in `tests/fixtures/cluster/<case>/`: the API server's answers
  for a case and what the core must send (the connection updates, the states,
  the metadata, the entity's phase, the answers of the channels). A Vitest test
  of the Electron build, `main/cluster/tauri-parity.test.ts`, feeds the same
  answers through the Electron build's own `ClusterConnection`, detectors and
  handlers, with `k8sRequest` and client-node replaced as their own tests
  replace them, and asserts the same files; `UPDATE_TAURI_PARITY=1` writes
  them, as in spec 008. A fake plugin script in the fixtures fixes client-go's
  wording of R3 against the kubeconfig of a case.
- Every log line, message and answer of the cargo tests is searched for the
  placeholder credentials, as written and in base64 (SC-009).

## R19. The existing tests of the area

**Decision**: each test maps to cargo tests that check the same behaviour:

| Electron test                                                                                                                  | Behaviour                                                                                                                                                                                          | Core test                                 |
| ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `main/cluster/cluster-connection-activation.test.ts`                                                                           | shared and forced activations, `activated`, the start failure                                                                                                                                      | `src/cluster/connection.rs`               |
| `main/cluster/cluster-connection-auth-backoff.test.ts`                                                                         | the status classification, the backoff, the pause, the reset                                                                                                                                       | `src/cluster/connection.rs`, the fixtures |
| `main/__test__/cluster.test.ts`                                                                                                | activate, reconnect and disconnect do not fail                                                                                                                                                     | `src/cluster/connection.rs`               |
| `main/cluster/request-non-core-api-versions.test.ts`                                                                           | the group versions of `/apis`                                                                                                                                                                      | `src/cluster/access.rs`                   |
| `common/cluster/request-namespace-list-permissions.test.ts`                                                                    | the rules review and its predicate                                                                                                                                                                 | `src/cluster/access.rs`                   |
| `features/cluster/refresh-accessibility-technical.test.ts`                                                                     | the order of the requests of R6 and the resources to show                                                                                                                                          | `tests/cluster.rs`                        |
| `main/cluster/update-entity-spec.test.ts`                                                                                      | the icon and the metrics of the entity's spec                                                                                                                                                      | spec 008 (`src/catalog/entities.rs`)      |
| `main/cluster-detectors/cluster-nodes-count-detector.test.ts`                                                                  | the node count                                                                                                                                                                                     | `src/cluster/detect.rs`                   |
| `main/cluster-detectors/detect-cluster-metadata.test.ts`                                                                       | the keys of the metadata                                                                                                                                                                           | `src/cluster/detect.rs`                   |
| `main/k8s-request.test.ts`                                                                                                     | the error of a failed request, the body or the status text                                                                                                                                         | `src/cluster/client.rs`                   |
| `features/cluster/connections/main/__tests__/api-url.test.ts`                                                                  | the server URL, read again when the file changes                                                                                                                                                   | `src/cluster/client.rs`                   |
| `features/cluster/delete-dialog/kubeconfig-channels.test.ts`                                                                   | the contexts, no credential, the unknown cluster, the removal                                                                                                                                      | `src/cluster/kubeconfig_edit.rs`          |
| `features/cluster/execute/main/__tests__/*.test.ts`                                                                            | the refusals, the URLs, the methods, the patch types, the errors, the selectors                                                                                                                    | `src/cluster/execute.rs`                  |
| `features/cluster/storage/cluster-storage.test.ts`                                                                             | the cluster store                                                                                                                                                                                  | spec 007 (`src/stores/cluster.rs`)        |
| `main/freelens-proxy/freelens-proxy.test.ts`, "kube api requests", "redirects", "refused target", "cluster proxy cannot start" | `no-store`, the 503s, the forwarded and dropped headers, the body of a POST, the watch's head before its first event, cancellation, the end of a watch, the 500 of a refused target, the redirects | `tests/api_kube.rs`                       |
| `main/freelens-proxy/cluster-route-redirect.test.ts`                                                                           | the `Location` rewrite                                                                                                                                                                             | `src/cluster/api_kube.rs`                 |
| `main/__test__/freelens-proxy.test.ts`                                                                                         | what makes a request a watch                                                                                                                                                                       | `src/cluster/api_kube.rs`                 |
| `features/shell-sync/main/compute-unix-shell-environment.test.ts`                                                              | the arguments by shell, stdin, the failures, the abort, the parsing                                                                                                                                | `src/foundation/shell_env.rs`             |
| `features/shell-sync/main/union-env-path.test.ts`                                                                              | the union of the `PATH`s                                                                                                                                                                           | `src/foundation/shell_env.rs`             |
| `features/shell-sync/startup-failure-notification.test.ts`                                                                     | the failure sent once                                                                                                                                                                              | `tests/shell_env.rs`                      |

No counterpart: the token, host and origin checks of freelens-proxy, which the
scheme's own checks of spec 004 replace (`allowed-request.test.ts`,
`freelens-proxy-token.test.ts`, the token cases of `freelens-proxy.test.ts`);
the HTTP/2 session, GOAWAY and stream limit cases, which concern the hop
between freelens-proxy and freelens-k8s-proxy; `main/k8s/cluster-api-address.test.ts`,
the address of freelens-proxy; and the pwsh cases' Node script (R4).

## R20. What this feature does not port

- freelens-k8s-proxy, its manager, its certificate and its `credential`
  command; the proxy kubeconfig and its manager (`main/kubeconfig-manager`,
  `load-proxy-kubeconfig`, `remove-proxy-kubeconfig`, the reaction on the
  default namespace); the `127.0.0.1/<cluster id>` route of kubectl and helm;
  and the upgrade requests (exec, attach, port-forward). They come with
  main-kube-tools, spec 005 and main-port-forward, which run kubectl, helm and
  the terminals.
- The Prometheus handler of a connection (main-metrics).
- The app event bus (Principle VII).
- What the Electron build does only on Windows or Linux, or in a Snap or a
  Flatpak.
