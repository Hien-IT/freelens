# Feature Specification: Main Cluster Connection

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-26

**Status**: Draft

**Input**: User description: "In the macOS build, connecting to a cluster of the catalog, browsing and watching its resources through the /api-kube proxy, and disconnecting or deleting a cluster work as in the Electron build, without freelens-k8s-proxy. Success: every channel of main-cluster-connection in the list from specs/002-messaging-for-tauri is answered by the new core; the behaviour checked by the existing tests of this area holds; on the kind cluster of specs/baseline.md, the time from clicking a cluster to its sidebar and to the first Pod row is no longer than in the Electron build, and the core's CPU over 60 s is no higher than the Electron main's."

In this specification:

- **The Electron build**, **the Tauri build**, **the core**, **a view** and
  **the data directory** are as in `specs/007-main-foundation/spec.md`. "The
  macOS build" of the input is the Tauri build. **The main window** and **a
  cluster frame** are the views of `specs/004-cluster-frames/spec.md`.
- **The catalog**, **the cluster id** and **a cluster store entry** are as in
  `specs/008-main-catalog/spec.md`. A cluster of the catalog is named by its
  cluster id in every channel of this feature.
- **Connecting a cluster** is what the Electron build's main side does when a
  view sends `activate-cluster`: it checks that the API server of the
  cluster's context answers with the context's credentials, learns what the
  user may see there, records the cluster's distribution and version, and
  keeps all of it current until the cluster is disconnected. **The cluster
  state** is what it learns, the `ClusterState` the Electron build sends: online,
  disconnected, accessible, ready, admin, the allowed namespaces, the
  resources to show, the known API resources and whether a watch of all
  namespaces is possible.
- **The /api-kube proxy** is the route `/api-kube/` of a cluster frame's host
  (`specs/004-cluster-frames/contracts/routes.md`), through which the frame's
  requests reach the API server of its own cluster. In the Electron build,
  freelens-proxy forwards them to a freelens-k8s-proxy process per cluster,
  which adds the credentials. In the Tauri build the core adds them, and no
  freelens-k8s-proxy exists.
- **A watch** is a request of the /api-kube proxy whose query sets `watch` or
  `follow`, the two the Electron build's proxy treats as streams: its answer
  stays open and carries each event or line as the API server sends it.
- **The kind cluster** is the cluster of "Hiệu năng main" in
  `specs/baseline.md`: kind, one arm64 node, its system pods, and the
  namespace `load` with 3000 ConfigMaps, under the context
  `kind-freelens-profile`. **The scenario** is the steps of that section:
  open the catalog, click the cluster, open Config Maps, choose All
  Namespaces, open Pods, and leave the application idle until 60 s after the
  first click.
- **The channel list** is
  `specs/002-messaging-for-tauri/contracts/channel-list.md`. **The channels of
  main-cluster-connection** are the rows of its section
  "main-cluster-connection": `activate-cluster`, `deactivate-cluster`,
  `set-cluster-as-deleting`, `clear-cluster-as-deleting`, `delete-cluster`,
  `execute-on-cluster`, `cluster-state-sync`, `initial-cluster-state-sync`,
  `cluster:refresh-accessibility`, `cluster:list-namespace-forbidden`,
  `cluster:<clusterId>:connection-update`, `network:offline`,
  `network:online`, `cluster-kubeconfig-contexts` and
  `remove-cluster-context-from-kubeconfig`; and `shell-sync-failed-channel`,
  which the list gives to main-shell-env but which comes with the shell sync
  of FR-006, so this feature moves its row to main-cluster-connection.
- **The shell sync** is what the Electron build's main side does at startup
  to take the environment of the user's login shell (`features/shell-sync`):
  it runs the shell the settings name, or the user's default shell, reads its
  environment, and merges it into its own, the shell's `PATH` first.
- **The existing tests of this area** are the unit tests of the main side of
  the Electron build under the directories R9 of
  `specs/001-tauri-shell-spike/research.md` gives main-cluster-connection:
  `main/cluster`, `main/cluster-detectors`, `main/k8s`,
  `main/k8s-request.test.ts`, the main side of `features/cluster/activation`,
  `features/cluster/connections`, `features/cluster/delete-dialog`,
  `features/cluster/execute`, `features/cluster/state-sync` and
  `features/cluster/storage`, `features/cluster/refresh-accessibility-technical.test.ts`,
  the tests of `main/freelens-proxy` that check its `/api-kube` requests, and
  the tests of the shell sync under `features/shell-sync`, all under
  `packages/core/src`. Left out are those spec 008 already took over
  (`main/cluster/update-entity-metadata.test.ts`), those that check
  freelens-k8s-proxy as a process, its start, stop, port, certificate and
  credential command (`main/cluster/freelens-k8s-proxy-*.test.ts`,
  `main/cluster/stop-freelens-k8s-proxy.test.ts`, `main/freelens-k8s-proxy`),
  which has no counterpart in the Tauri build, and those of `main/freelens-proxy`
  that check the shell tokens and the upgrade requests, which belong to the
  areas that run shells and kubectl.

## Clarifications

### Session 2026-11-26

- Q: Which view does the user connect and browse a cluster in, at the end of this feature, given that the renderer does not run in the Tauri build yet? → A: The Tauri build's own catalog and frame pages, as in specs 004 and 005: they show the progress of the connection, a sidebar, the Pods and Config Maps lists (All Namespaces included) kept current by watches, and let the user disconnect and delete the cluster. The renderer's own views replace them in the spec that runs the renderer, on the same channels and the same /api-kube proxy (FR-029).
- Q: Which environment do the credential plugins the core starts get? → A: The environment of the user's login shell, as in the Electron build: this feature brings the shell sync forward from main-shell-env, with its failure message `shell-sync-failed-channel`; the lookup of the terminal's shell stays with main-shell-env (FR-006, FR-033 to FR-035).

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the users of the Tauri build, who must
be able to open a cluster of their catalog, see its resources change as the
cluster changes, and close or remove it, as they do in the Electron build; and
the maintainers of the port, whose later areas (kubectl and helm, the
terminal, metrics, port-forward) start from a connected cluster. Users of the
Electron build see no change.

### User Story 1 - Connect a cluster of the catalog (Priority: P1)

A user clicks a cluster of the catalog. The Tauri build shows the progress of
the connection, and then the cluster, as the Electron build does: with the
namespaces and the kinds of resources the user may see there. When the
connection fails (the API server does not answer, the credentials are
refused, a credential plugin fails or takes too long), the user sees the same
reason the Electron build shows, and can reconnect.

**Why this priority**: The input names it. Everything else a user does with a
cluster, and every later area of the port, starts from a connected cluster.

**Independent Test**: With the kind cluster in the catalog, connect it from a
view of each build and compare the progress messages and the cluster state
each sends. Repeat with a context whose API server does not answer, one whose
credentials are refused, and one whose credential plugin fails.

**Acceptance Scenarios**:

1. **Given** a cluster of the catalog, **When** a view asks to connect it,
   **Then** every view gets the progress messages the Electron build sends, in
   the same order and at the same levels, the cluster's status in the catalog
   goes from connecting to connected, and every view gets its cluster state,
   with the same values the Electron build gives for the same user and
   cluster.
2. **Given** a context whose API server does not answer, whose credentials are
   refused, or whose credential plugin fails or does not finish, **When** a view
   asks to connect it, **Then** the view gets the message the Electron build
   sends for that failure, the cluster is not accessible, and asking again
   tries again.
3. **Given** a user who may not list the namespaces of the cluster, **When** the
   cluster is connected, **Then** its allowed namespaces are those the user set
   in the cluster's settings, and when there are none the views get
   `cluster:list-namespace-forbidden`, as in the Electron build.
4. **Given** a connected cluster, **When** it is connected for the first time,
   **Then** its distribution, version and node count are recorded in its
   cluster store entry as the Electron build records them, and the catalog
   shows them.
5. **Given** a connected cluster whose credentials start to be refused, **When**
   the automatic refresh fails again and again, **Then** it waits and stops as
   the Electron build does, and tells the user that the automatic reconnection
   is paused.
6. **Given** a context whose credential plugin is found only on the `PATH` of
   the user's login shell, **When** the Tauri build is started from the Finder
   and the cluster is connected, **Then** the plugin runs and the cluster
   connects, as in the Electron build.

---

### User Story 2 - Browse and watch resources through /api-kube (Priority: P2)

With a cluster connected, the user lists its pods, config maps and other
resources, opens one, edits it, creates and deletes resources. Each list stays
current: a pod created, changed or removed in the cluster shows in the list
while it is open, as in the Electron build. The credentials of the kubeconfig
never reach the page.

**Why this priority**: The input names it. It is what a user does with a
connected cluster, and it depends on Story 1.

**Independent Test**: From a cluster frame of each build, send the same
requests through the /api-kube proxy (list, get, create, update, patch with
each patch type, delete, and a watch), and compare the status, the headers
the view reads and the body of each answer. With a watch of the pods open,
create and remove a pod with `kubectl` and measure when each event reaches
the view.

**Acceptance Scenarios**:

1. **Given** a connected cluster, **When** its frame sends a request of any
   method through the /api-kube proxy, **Then** the API server of its own
   cluster gets it with the credentials of the context, and the frame gets the
   answer the Electron build gives for the same request.
2. **Given** a watch sent by a frame, **When** the API server sends an event,
   **Then** the frame gets it as it comes, without waiting for the answer to
   end, and no later than in the Electron build.
3. **Given** many watches open in a frame at once, as the views open them,
   **When** a further request is sent, **Then** it is answered without waiting
   for a watch to end.
4. **Given** a watch, **When** the frame stops reading it, the cluster is
   disconnected or the frame is closed, **Then** the core stops the request to
   the API server.
5. **Given** a frame of one cluster, **When** it sends a request through the
   /api-kube proxy, **Then** the request reaches its own cluster and no other,
   whatever its path, query, headers or body say.

---

### User Story 3 - Disconnect and delete a cluster (Priority: P3)

The user disconnects a cluster, or deletes it from the catalog: removing its
context from their kubeconfig file, or the file when the Tauri build wrote it.
The Tauri build does what the Electron build does: the cluster is disconnected
and its frame closed, and a deleted cluster leaves the cluster store, its local
storage and, with the context, the catalog.

**Why this priority**: The input names it. It closes what Story 1 opens.

**Independent Test**: Connect a cluster, disconnect it from a view, and check
its state and that its watches end. Delete a cluster whose context is in a
synced file with other contexts, and one in a file of the application's
kubeconfig directory, from a view of each build, and compare the files, the
cluster store and the catalog after each.

**Acceptance Scenarios**:

1. **Given** a connected cluster, **When** a view asks to disconnect it, **Then**
   it is disconnected as in the Electron build: its state is offline,
   inaccessible and not ready, its status in the catalog is disconnected, its
   refreshes stop and its watches end.
2. **Given** a cluster the user starts to delete, **When** a view marks it as
   being deleted and clears the mark, **Then** its status in the catalog
   follows, as in the Electron build.
3. **Given** a cluster whose context is in a kubeconfig file with other
   contexts, **When** a view asks for the contexts of its file and to remove the
   context, **Then** the core answers their names, the current context and the
   default namespace, and no credential; and removes only that context, setting
   the new current context the view names, while the file is locked as the
   Electron build locks it.
4. **Given** a cluster, **When** a view asks to delete it, **Then** the core
   disconnects it, closes its frame, removes its cluster store entry and its
   local storage file, as the Electron build does.
5. **Given** a connected cluster, **When** its context leaves its synced file,
   **Then** it is disconnected, as in the Electron build.
6. **Given** connected clusters, **When** the Tauri build quits, **Then** every
   connection ends and no process the core started for them is left running.

---

### User Story 4 - The core answers every channel of main-cluster-connection (Priority: P4)

The views follow the state of every cluster, ask for it when they start, ask
for a cluster's accessibility to be refreshed, tell the core when the network
goes away or comes back, and the extension API of the Electron build runs
operations on a cluster. The core answers each of these as the Electron
build's main side does.

**Why this priority**: The renderer's cluster views and the delete dialog use
these channels, and the channel list is complete only when each has an
answer. It depends on Stories 1 and 3.

**Independent Test**: From a view, send each channel of main-cluster-connection
with the same input to both builds and compare the answers and the messages
the views get.

**Acceptance Scenarios**:

1. **Given** a view that starts, **When** it asks for the initial cluster states,
   **Then** it gets the state of every cluster the core has connected, and every
   later change on `cluster-state-sync`.
2. **Given** a connected cluster, **When** a view asks to refresh its
   accessibility, **Then** the core refreshes it as the Electron build does and
   answers once it is done.
3. **Given** a view that reports the network offline and then online, **When**
   the core gets each message, **Then** the connected clusters follow as in the
   Electron build.
4. **Given** a request that names a cluster the catalog does not have, **When**
   the core gets it, **Then** it answers as the Electron build answers an
   unknown cluster, and changes nothing.
5. **Given** an `execute-on-cluster` request for each operation (list, get,
   create, update, patch, delete), **When** the core gets it, **Then** it answers
   what the Electron build answers for the same cluster and resource.

---

### User Story 5 - As fast and as light as the Electron build (Priority: P5)

On the kind cluster, the Tauri build shows the cluster's sidebar and its first
Pod row no later than the Electron build, and the core uses no more CPU over
the scenario than the Electron build's main side.

**Why this priority**: The input names these measures, and the port's goal is
to be faster with large clusters. It is measured once the other stories work.

**Independent Test**: Run the scenario on the kind cluster three times with
each build, on the same machine, the Tauri build in its own pages (FR-029),
and compare the medians of the two times and of the CPU of the core with
those of the Electron build.

**Acceptance Scenarios**:

1. **Given** the kind cluster in the catalog, **When** the user clicks it, **Then**
   its sidebar shows no later than in the Electron build.
2. **Given** the cluster's sidebar, **When** the user opens Pods, **Then** the
   first Pod row shows no later than in the Electron build.
3. **Given** the scenario, **When** it has run for 60 s, **Then** the CPU time the
   core used is no higher than the Electron build's main side used.

---

### Edge Cases

- A cluster is asked to connect while it is connecting: it is connected once,
  and both requests end when the connection does, as in the Electron build.
  `force` reconnects a connected cluster.
- A cluster's API server stops answering while it is connected: the next
  refresh marks it offline and sends the message the Electron build sends;
  its open watches end, and the views restart them as they do in the Electron
  build.
- A credential plugin opens a browser for an interactive login and does not
  finish: the connection times out with the message the Electron build gives
  for a credential plugin, and the automatic refresh does not start the
  plugin again and again (FR-006).
- The cluster's settings name an HTTPS proxy: the core reaches the API server
  through it, as freelens-k8s-proxy does.
- The kubeconfig file or context of a connected cluster changes: the cluster
  is reached with the new content from the next request on, as in the
  Electron build.
- A watch whose API server ends the answer, or whose resource version is too
  old: the frame gets the end or the error the API server sends, as in the
  Electron build, and restarts the watch itself.
- The API server answers a request with a redirect: the frame is led back to
  the /api-kube proxy of the same cluster, never to the API server's address.
- A request with a path outside `/api/` and `/apis/`, or with `..`: answered as
  the spec 004 route answers it.
- A frame is closed with requests in flight: the core stops them.
- A cluster is deleted while connected: it is disconnected first, as in the
  Electron build.
- The kubeconfig file of a cluster cannot be read or written when its context
  is removed: the view gets the error, and the file is left as it was.
- Two views ask for different changes of the same kubeconfig file at once: the
  file lock orders them, and neither change is lost.
- The network goes away while watches are open: they end, and the clusters
  follow the `network:offline` message as in the Electron build.
- The user's login shell fails, prints an error, or takes longer than 30 s to
  give its environment: the core keeps its own, the main window shows the
  reason as the Electron build shows it, and a credential plugin that is not on
  the core's own `PATH` fails with the message of FR-002.
- The settings name a shell that does not exist: the shell sync fails as in
  the Electron build, with the same reason.

## Requirements _(mandatory)_

### Functional Requirements

#### Connecting a cluster

- **FR-001**: The core MUST connect a cluster when a view sends
  `activate-cluster`, as the Electron build's main side does: the same steps in
  the same order, the same progress messages on
  `cluster:<clusterId>:connection-update` with the same text and levels, and a
  cluster connected once however many requests arrive while it connects;
  `force` MUST reconnect a cluster that is already connected.
- **FR-002**: The core MUST find the connection status as the Electron build
  does: offline when the API server does not answer, access denied when it
  refuses the credentials, access granted otherwise; and send, for each
  failure, the message the Electron build sends (invalid credentials, a
  credential plugin that failed, a connection that timed out, with the hint
  about an interactive login when the context uses a credential plugin).
- **FR-003**: The core MUST learn the cluster state as the Electron build does:
  whether the user is an admin, the allowed namespaces (those the user may
  list, or those the cluster's settings name), the known API resources, the
  resources to show, whether the cluster is ready and whether a watch of all
  namespaces is possible; and send `cluster:list-namespace-forbidden` when the
  Electron build sends it.
- **FR-004**: The core MUST detect the cluster's metadata when the Electron build
  detects it (its distribution, version, node count, last seen time and the
  identifier the Electron build records) and write it into the cluster's
  cluster store entry, through the stores of spec 007, in the format the
  Electron build writes, so that the catalog shows it (FR-006 of spec 008).
- **FR-005**: While a cluster is connected, the core MUST refresh its connection
  status every 30 s and its accessibility and metadata every 15 minutes, as
  the Electron build does. After consecutive authentication failures of the
  automatic refresh, it MUST wait 1 minute after the first and 5 minutes after
  the second, stop after the third until the user reconnects, and send the
  message the Electron build sends; a success or a reconnect MUST reset the
  count.
- **FR-006**: The core MUST reach each cluster with what the context of its
  kubeconfig file says, in every way the Electron build connects with through
  freelens-k8s-proxy: the server's address, how its certificate is trusted,
  the client certificate, the token and every other credential the context
  names, credential plugins included, and the HTTPS proxy of the cluster's
  settings. Credential plugins MUST run with the environment the shell sync
  gives the core (FR-033), with the HTTPS proxy of the cluster's settings, as
  the Electron build gives freelens-k8s-proxy its own environment, so that a
  plugin found on the `PATH` of the user's login shell is found when the Tauri
  build is started from the Finder.
- **FR-007**: Only the core MUST hold the credentials of a cluster. No message
  or answer of the channels of main-cluster-connection, and no answer of the
  /api-kube proxy, MUST carry a credential of the kubeconfig file: a token, a
  password, a client key or certificate, or what a credential plugin returned.
- **FR-008**: The status of each cluster in the catalog MUST follow its
  connection as in the Electron build: connecting, connected, disconnected and
  deleting, sent on `catalog:items` as spec 008 sends the catalog.
- **FR-009**: The core MUST send a cluster's state to every view on
  `cluster-state-sync` each time it changes, and answer
  `initial-cluster-state-sync` with the state of every cluster it has, as the
  Electron build does.
- **FR-010**: The core MUST answer `cluster:refresh-accessibility` by refreshing
  the cluster's accessibility as the Electron build does, and answer once it is
  done.
- **FR-011**: The core MUST follow `network:offline` and `network:online` as the
  Electron build's cluster manager does.

#### The /api-kube proxy

- **FR-012**: The /api-kube proxy MUST forward a cluster frame's requests of
  every method the Electron build's proxy forwards to the API server of the
  frame's own cluster, which the core reads from the frame's host and never
  from the request (FR-006 of spec 004), with the credentials of the context
  added by the core. It MUST answer a watch as a watch rather than with the
  `400` spec 004 gives.
- **FR-013**: The API server MUST get the method, path, query and body of the
  frame's request, and the headers that reach it in the Electron build for the
  same request, such as the content type of a patch and the formats the frame
  accepts, except the frame's cookies and any credential the frame sends,
  which it MUST NOT get. The frame MUST get the status, the body and the headers the
  Electron build's proxy passes on, and an answer that no cache keeps, as in
  the Electron build.
- **FR-014**: The answer to a watch MUST reach the frame as a stream: its status
  and headers before the first event, then each event or line as the API
  server sends it, no later than in the Electron build. A frame MUST be able to
  keep as many watches open as the views open, without a request waiting for
  a watch to end.
- **FR-015**: The core MUST stop the request to the API server of a watch or of
  any request in flight when the frame stops reading its answer, when its
  frame is removed, and when its cluster is disconnected or deleted.
- **FR-016**: A redirect the API server answers MUST lead the frame back to the
  /api-kube proxy of the same cluster, as the Electron build's proxy does, and
  never to the API server's own address.
- **FR-017**: A request for a cluster that is not connected, or whose API server
  does not answer, MUST be answered as the Electron build answers it, and MUST
  NOT stay open longer than the Electron build lets it.
- **FR-018**: The Tauri build MUST NOT ship or start freelens-k8s-proxy, and this
  feature MUST NOT open a local network port.

#### Disconnecting and deleting

- **FR-019**: The core MUST disconnect a cluster when a view sends
  `deactivate-cluster`, as the Electron build does: offline, inaccessible, not
  ready and disconnected, its refreshes stopped and its requests in flight
  stopped (FR-015).
- **FR-020**: The core MUST disconnect a cluster whose context leaves its synced
  file, or that leaves the catalog for another reason, as the Electron build
  does (the part of FR-006 of spec 008 that this feature takes).
- **FR-021**: The core MUST mark a cluster as being deleted on
  `set-cluster-as-deleting` and clear the mark on `clear-cluster-as-deleting`,
  as the Electron build does.
- **FR-022**: The core MUST answer `delete-cluster` as the Electron build does:
  disconnect the cluster, remove its frame, remove its cluster store entry
  through the stores of spec 007, and remove its local storage file; and do
  nothing for a cluster it does not have.
- **FR-023**: The core MUST answer `cluster-kubeconfig-contexts` with the context
  names, the current context and the default namespace of the cluster's
  kubeconfig file, and never a credential; and `remove-cluster-context-from-kubeconfig`
  by removing the cluster's context from that file and setting the new
  current context the view names, holding the lock the Electron build takes on
  the file, and keeping the rest of the file's content as the Electron build
  keeps it. Both MUST refuse a cluster the catalog does not have.
- **FR-024**: When the Tauri build quits, the core MUST end every connection and
  every request in flight, and MUST leave no process it started for a cluster,
  a credential plugin included, running.

#### The channels of main-cluster-connection

- **FR-025**: The core MUST answer `execute-on-cluster` for each operation (list,
  get, create, update, patch and delete) as the Electron build does, the
  answers for a cluster it does not have or that is not accessible included.
- **FR-026**: A channel that names a cluster MUST be refused, and change
  nothing, when a cluster frame names a cluster other than its own; the main
  window may name any cluster of the catalog. Outside the extension API, which
  the Tauri build does not have, a cluster frame of the Electron build names
  only its own cluster (`cluster:refresh-accessibility`), and the activation
  and delete-dialog channels come from the main window, so no view sees a
  difference.
- **FR-027**: Each channel of main-cluster-connection MUST be answered by the
  core, and the channel list MUST say so, with any channel this feature adds,
  renames or stops sending, in the columns the list requires.
- **FR-028**: The core MUST log the connection of each cluster as the Electron
  build does (each step, each failure and each disconnect) in the core's log
  of spec 007, never with a credential.

#### What the user sees in the Tauri build

- **FR-029**: At the end of this feature, a user of the Tauri build MUST be able
  to do in its own catalog and frame pages (spec 004) what this feature
  ports: click a cluster of the catalog and see the progress and the failures
  of its connection; see, in its frame, a sidebar once the cluster is ready,
  with the Pods and Config Maps of the resources to show; open each list, for
  one namespace or All Namespaces, and see it change as the cluster changes,
  through watches of the /api-kube proxy; and disconnect a cluster and delete
  it, with the choices the Electron build's delete dialog offers (remove its
  context from the kubeconfig file, setting a new current context, or remove
  the file when the Tauri build wrote it). These pages use only the channels
  and the /api-kube proxy the renderer uses, so that the renderer's own views
  replace them, in the spec that runs the renderer, without a change of the
  core. The times of Story 5 are measured in them.

#### The shell sync

- **FR-033**: At startup, the core MUST take the environment of the user's login
  shell as the Electron build's shell sync does: from the shell the settings
  name, or the user's default shell; giving up after 30 s; putting the shell's
  `PATH` before its own, with no entry twice; keeping its own value of every
  other variable it already has; and setting `LANG` to a UTF-8 locale as the
  Electron build does. It MUST NOT delay the main window or the catalog while
  it does.
- **FR-034**: When the shell sync fails or gives up, the core MUST log the
  reason, keep its own environment, and send the reason to the main window on
  `shell-sync-failed-channel` once the window can show it, as the Electron
  build does.
- **FR-035**: A credential plugin that a connection starts before the shell sync
  has ended MUST wait for it, up to its 30 s, rather than run without the
  login shell's environment. The core MUST NOT log the environment it takes at
  a level the log of spec 007 writes by default, since it may hold secrets.

#### The Electron build and the tests

- **FR-030**: The Electron build MUST keep its behaviour, its files and its
  channels, freelens-k8s-proxy included. Its extension API MUST NOT change
  (Principle III of the constitution).
- **FR-031**: The Electron build MUST keep building, and MUST pass its unit and
  integration tests (Principle VII of the constitution). An existing test MUST
  NOT be removed or weakened to make it pass.
- **FR-032**: The behaviour that the existing tests of this area check MUST hold
  in the core, shown by tests of the core that check the same behaviour: the
  steps and messages of a connection, the authentication backoff, the
  connection status of each failure, the accessibility and the resources to
  show, the detection of the metadata, the API server's address, the checks
  and the redirects of the /api-kube requests, `execute-on-cluster`, the
  delete dialog's channels and deleting a cluster, and the shell sync: the
  environment it takes, the union of the `PATH`s, its time limit and its
  failure message.

### Key Entities

- **Cluster connection**: the core's link to one cluster's API server, with the
  credentials of its context; started by `activate-cluster`, kept current by
  the refreshes, ended by a disconnect, a delete or quitting.
- **Cluster state**: what the connection learns about a cluster; sent to every
  view.
- **Connection update**: a progress or failure message of a connection, with
  its level; sent to every view under the cluster's own channel name.
- **Cluster metadata**: the distribution, version, node count and the rest the
  connection detects; kept in the cluster store entry.
- **/api-kube request**: a cluster frame's request for its own cluster, answered
  by the API server through the core; a watch when its answer is a stream.
- **Login shell environment**: the variables the shell sync takes from the
  user's login shell at startup; the environment of the credential plugins.
- **Channel of main-cluster-connection**: one row of the channel list's section
  "main-cluster-connection", with the core's answer.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: Connecting the kind cluster, and contexts whose API server does
  not answer, whose credentials are refused and whose credential plugin fails,
  gives in the Tauri build the same progress and failure messages, in the same
  order, and the same cluster state as in the Electron build.
- **SC-002**: Over three runs of the scenario on the kind cluster, the median
  time from clicking the cluster to its sidebar showing is no longer in the
  Tauri build than in the Electron build, measured on the same machine and
  recorded in `specs/baseline.md`.
- **SC-003**: Over the same runs, the median time from clicking Pods to the first
  Pod row showing is no longer in the Tauri build than in the Electron build,
  recorded in `specs/baseline.md`.
- **SC-004**: Over the same runs, the median CPU time the core uses in the 60 s
  of the scenario is no higher than that of the Electron build's main
  process, measured without a profiler, as the "Không profile" column of
  `specs/baseline.md` measures it, and recorded there.
- **SC-005**: With a watch of the pods of a namespace open, the median of five
  times from `kubectl` creating or deleting a pod to the frame getting its
  event is no longer in the Tauri build than in the Electron build, recorded in
  `specs/baseline.md`.
- **SC-006**: The time from choosing All Namespaces in Config Maps to its first
  row, with the 3000 ConfigMaps of the kind cluster, is recorded for both
  builds in `specs/baseline.md`, as the channel list asks of the spec that
  ports the watches; no threshold.
- **SC-007**: A review of the channels of main-cluster-connection in the
  channel list finds, for each, a test of the core that shows its answer, and
  the same input gives the same answer in both builds.
- **SC-008**: Each behaviour the existing tests of this area check has a test of
  the core that checks the same behaviour, and the tests of the core pass.
- **SC-009**: With kubeconfig files whose contexts hold tokens, client
  certificates and keys, and one that uses a credential plugin, none of the
  messages and answers of the channels of main-cluster-connection, and none of
  the answers of the /api-kube proxy, that a view receives contains any of
  them.
- **SC-010**: During the scenario, no freelens-k8s-proxy process runs and the
  Tauri build listens on no network port; after it quits, no process the core
  started is left.
- **SC-011**: After a cluster is disconnected or deleted, or its frame is
  closed, none of its watches is still open at the API server.
- **SC-012**: The Electron build builds, and its unit and integration tests
  pass, with no existing test removed or weakened.
- **SC-013**: Started from the Finder, the Tauri build connects a context whose
  credential plugin is installed only in a folder that the user's login shell
  adds to `PATH`, as the Electron build does.

## Assumptions

- The behaviour to match is that of the Electron build's main side on macOS:
  the cluster connection and manager of `main/cluster`, the detectors of
  `main/cluster-detectors`, the listeners of `features/cluster/*` that the
  channel list names, and the `/api-kube` handling of `main/freelens-proxy`
  together with what freelens-k8s-proxy does for it. What the Electron build
  does only on Windows or Linux has no counterpart on macOS.
- The proxy kubeconfig the Electron build writes for each connected cluster is
  read only by the tools that run against it: kubectl and the resource
  applier, helm, the terminals, port-forward, pod files and the traffic map.
  It comes to the core with the first of those areas, as do the upgrade
  requests and the shell tokens of freelens-proxy. Nothing in this feature
  reads it.
- The Prometheus handler that the Electron build sets up on a connection belongs
  to main-metrics, as R9 orders it.
- The renderer does not run in the Tauri build at the end of this feature, as at
  the end of spec 008. The Tauri build's own pages of FR-029 show a sidebar
  with the two lists the scenario opens, not the renderer's cluster view; the
  times of Story 5 compare the moment each build shows the sidebar and the
  first Pod row, whatever draws them (Clarifications).
- The Electron build waits for the shell sync before it shows its window (the
  load of the application runs it before the window opens). The core does
  not (FR-033), so that a slow login shell does not delay the startup that
  specs 007 and 008 measure; FR-035 keeps a credential plugin from running
  before the shell sync ends, and nothing else in this feature reads the
  environment.
- Of main-shell-env, this feature takes only the shell sync and its failure
  message (Clarifications). The lookup of the terminal's shell
  (`look-up-terminal-shell`) and the shell environment of the terminals stay
  with main-shell-env and spec 005.
- `execute-on-cluster` is sent in the Electron build only by the extension API
  (`extensions/renderer-api/k8s.ts`). The Tauri build has no extension system
  (Principle VII), so it has no sender there; the core answers it because the
  input asks for every channel of the area.
- "The time from clicking a cluster to its sidebar and to the first Pod row"
  is read as the two times `specs/baseline.md` measures: from clicking the
  cluster to the sidebar, and from clicking Pods to the first Pod row.
- The CPU of the core is the CPU time of the Tauri build's main process,
  measured with `ps` as `specs/baseline.md` measures the Electron build's main
  process. It is compared with the Electron build's main process alone, as the
  input says, without the 0.06 s of freelens-k8s-proxy, whose work the core
  takes over.
- `specs/baseline.md` records the Electron times as the moments Playwright sees
  an element through the Chrome DevTools Protocol, which the Tauri build's
  WebKit view does not offer. Where the Tauri build has to take its times
  another way, the Electron build is measured again the same way, and both are
  recorded.
- The kind cluster authenticates with a client certificate. Tokens and
  credential plugins are checked by the tests of the core and by kubeconfig
  files made for them, never with the user's own clusters or kubeconfig files.
- Tests and measurements sync only the kubeconfig of the kind cluster, or the
  files made for them, in a data directory of their own, so neither build
  reads the user's own `~/.kube` (`specs/baseline.md`).
- The progress and failure messages of the Electron build are English text that
  the views show as they are; the core sends the same text.
- Depends on the channels of `specs/002-messaging-for-tauri`, the cluster frames
  and routes of `specs/004-cluster-frames`, the stores, local storage and log
  of `specs/007-main-foundation`, and the catalog and its cluster store
  entries of `specs/008-main-catalog`.
