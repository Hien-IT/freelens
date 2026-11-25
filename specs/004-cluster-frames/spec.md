# Feature Specification: Cluster Frames

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "Each open cluster runs isolated in its own origin in the macOS build, as it does in the Electron build. Success: three clusters open at the same time without sharing state, cookies or storage; closing one does not affect the others; the Electron build is unchanged; every channel that specs/002-messaging-for-tauri/contracts/channel-list.md gives to cluster-frames is answered by the new core, or the views stop sending it."

In this specification:

- **The Electron build** is the Freelens desktop application as it is built and
  shipped today; **the Tauri build** is the build on the new shell, for macOS,
  whose main side is **the core**. "The macOS build" of the input is the Tauri
  build.
- **A view** is a page of the user interface: the main window, or the frame of
  one open cluster. **A cluster frame** is the view of one open cluster, shown
  inside the main window.
- **An origin** is what the browser engine uses to decide which pages may read
  each other's documents, storage and cookies. Two pages of different origins
  cannot.
- **The cluster's origin** is the origin of the frame of one cluster. It is
  derived from the cluster's id, so it is the same every time that cluster is
  opened, and differs from the origin of every other cluster and of the main
  window.
- **An open cluster** is a cluster that has a frame, whether the frame is the
  one shown or is hidden behind another. **Closing a cluster** is what removes
  its frame: disconnecting the cluster, or removing it from the catalog.
- **Browser storage** is what a page keeps in the browser engine under its
  origin: local and session storage, databases, caches. **Page state** is what
  a page holds in memory while it is loaded.
- **The channel list** is
  `specs/002-messaging-for-tauri/contracts/channel-list.md`. **The channels of
  cluster-frames** are the rows of its section "cluster-frames (004)":
  `cluster:set-frame-id`, `current-visible-cluster` and
  `request-freelens-proxy-certificate`.
- **The frame page** is the page the Tauri build serves in a cluster frame at
  the time of this feature, and **the catalog page** the page it serves in its
  main window.

## Clarifications

### Session 2026-11-25

- Q: Should the Electron build also stop sending `request-freelens-proxy-certificate`, as the Tauri build does? → A: Yes. Both builds stop: no view of either build sends it, neither main side answers it, and the private key of the local proxy reaches no view. The channel moves to the section of channels removed by this feature in the channel list. This is the one change of FR-021 to the behaviour of the Electron build; no user or extension sees it, since nothing in the views reads the value.
- Q: Should the core check which kind of view sends the two channels of cluster-frames? → A: Yes, in the Tauri core and for these two only: `cluster:set-frame-id` is answered only from a cluster frame and for its own cluster, `current-visible-cluster` is heard only from the main window; the core refuses any other request on the first and ignores any other message on the second. Every other channel stays open to every view, as spec 003 decided. The per-route rule of FR-007 covers the routes the core serves, not the channels. The Electron build is unchanged.
- Q: When a cluster frame announces itself, does spec 004 only record it, or also send it the catalog? → A: It records the frame and shares the frame record with the other core areas: they can read it, learn when a frame is announced and when one is forgotten, and remove a cluster's frame, as disconnecting and deleting a cluster do. main-catalog sends the catalog through that; until then, a frame of the Tauri build gets no catalog after it announces itself.
- Q: At the end of spec 004, which page does the main window of the Tauri build run to open, switch and close the clusters? → A: The catalog page of the Tauri build, made to follow the frame lifecycle of the Electron build: one frame per cluster, hidden and shown without a reload, removed on close, and announcing itself and the visible cluster as the Electron build does. FR-014 requires that behaviour, not the same code; the renderer's own frame code runs in the Tauri build once its root frame starts there, in a later spec.
- Q: When the user closes a cluster on the catalog page, how does the core learn that its frame is gone? → A: Without a new channel: the core forgets a frame when the frame stops listening for its messages, no later than 60 seconds after, and forgets every frame at once when the main window is reloaded. Removing a frame at once on disconnecting or deleting a cluster comes with main-cluster-connection, through the frame record (FR-018).

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the users of the Tauri build, who open
several clusters side by side and must not see one cluster's data or state in
another, and the maintainers of the port, whose later core areas send data to
the frame of one cluster and rely on the frames being apart. Users of the
Electron build see no change.

### User Story 1 - Three clusters open at once, each on its own (Priority: P1)

A user of the Tauri build opens three clusters, one after another, and switches
between them. Each cluster is shown in its own frame, on its own origin.
Nothing one frame holds can be read or changed from another frame or, beyond
what the channels carry, from the main window: not its document, not its page
state, not its browser storage, not a cookie. A request for one cluster's data
from another cluster's frame is refused.

**Why this priority**: A cluster frame shows content that comes from the
cluster, which is not trusted, next to frames that hold other clusters,
possibly of other owners. The isolation is what the Electron build gives
today, and every later core area that serves a cluster frame is built on it.
Without it, no other part of this feature has a point.

**Independent Test**: Start the Tauri build with a kubeconfig of three
contexts, open the three clusters, and from each frame try to reach the other
two and the main window: their documents, their browser storage, a cookie,
their cluster's data. Every attempt fails, and each frame shows its own
cluster.

**Acceptance Scenarios**:

1. **Given** three clusters of the catalog, **When** the user opens each,
   **Then** three frames exist at the same time, each on an origin that differs
   from the other two and from the main window's.
2. **Given** three open clusters, **When** a page in one frame writes a value
   to its browser storage, **Then** the main window and the other two frames do
   not find that value.
3. **Given** three open clusters, **When** a page in one frame tries to read or
   change the document or the page state of another frame or of the main
   window, **Then** the attempt fails.
4. **Given** three open clusters, **When** a page in one frame tries to set a
   cookie, **Then** no other view receives it, and no request of another view
   carries it.
5. **Given** three open clusters, **When** a page in one frame asks for the
   data of another cluster on that cluster's origin, or for what only the main
   window may ask, **Then** the request is refused and returns nothing of the
   other cluster.
6. **Given** three open clusters, **When** the user switches from one to
   another and back, **Then** each frame still shows its own cluster, with the
   page state it had when the user left it.

---

### User Story 2 - Closing one cluster leaves the others alone (Priority: P2)

With three clusters open, the user closes one. Its frame goes away, and what
it was doing stops. The other two frames keep their page state, keep
answering, and keep their browser storage; the main window keeps working. When
the user opens the closed cluster again, it gets a new frame on the same
origin as before.

**Why this priority**: Users open and close clusters all day. A close that
disturbs another cluster loses work in it, and a frame that lingers after its
cluster is closed keeps holding that cluster's data. It depends on Story 1:
there has to be more than one isolated frame before closing one can be shown
to leave the rest alone.

**Independent Test**: With three clusters open and a mark left in the page
state and the browser storage of each, close the second one. The first and the
third still show their marks and still get answers from the core; the second
has no frame. Open the second again: it loads fresh, on the origin it had.

**Acceptance Scenarios**:

1. **Given** three open clusters, **When** the user closes one, **Then** its
   frame is removed, and the other two frames are not reloaded and keep their
   page state.
2. **Given** a closed cluster, **When** the other frames and the main window
   send requests and receive messages, **Then** they get their answers and
   messages as before the close.
3. **Given** a cluster closed while a request of its frame was in flight,
   **When** the answer is ready, **Then** it is dropped, reaches no other view,
   and causes no error in another view.
4. **Given** a closed cluster, **When** the core sends a message meant for the
   frame of that cluster, **Then** no view receives it.
5. **Given** a closed cluster, **When** the user opens it again, **Then** it
   gets a new frame on the same origin as before, with none of the page state
   of the earlier frame.

---

### User Story 3 - The core knows its frames (Priority: P3)

A maintainer porting a core area needs to act on the frame of one cluster:
send it a message, or learn which cluster the user is looking at. The core
knows which clusters have a frame and which one is visible, from the channels
of cluster-frames and from where each request comes from. Each of those
channels is answered by the core, or no view of the Tauri build sends it.

**Why this priority**: The later core areas depend on it, and the channel list
is complete only when each of its channels has an answer or a stated reason to
have none. It comes third because nothing a user sees in this feature depends
on it beyond Stories 1 and 2.

**Independent Test**: With clusters open, check what the core knows after each
step: which clusters have a frame, which one is visible. Send a message to the
frame of one cluster and see it arrive there alone. Look up each channel of
cluster-frames: the core answers it, or a search of the views of the Tauri
build finds no sender.

**Acceptance Scenarios**:

1. **Given** a cluster frame that has loaded, **When** it announces itself on
   `cluster:set-frame-id`, **Then** the core answers, and from then on knows
   that this cluster has a frame.
2. **Given** a cluster frame, **When** it announces itself with the id of
   another cluster, or the main window announces itself as a cluster frame,
   **Then** the core refuses the request and records no frame.
3. **Given** the main window, **When** the visible cluster changes or no
   cluster is visible any more, **Then** the core knows which cluster is
   visible, or that none is.
4. **Given** a cluster frame, **When** it sends the message that names the
   visible cluster, **Then** the core ignores it, and the visible cluster stays
   the one the main window named.
5. **Given** three open clusters, **When** the core sends a message to the
   frame of one of them, **Then** that frame receives it once, and the main
   window and the other two frames do not.
6. **Given** another area of the core that follows the frame record, **When**
   a frame is announced, or its cluster's frame is forgotten, **Then** that
   area learns it, with the cluster's id.
7. **Given** a view of either build, **When** it starts, **Then** it does not
   ask for the private key of a local proxy, and no channel hands it one.

---

### Edge Cases

- The user opens a cluster that already has a frame: no second frame is made;
  the existing one is shown.
- Two catalog entries have the same context name in different kubeconfig
  files: they are different clusters, with different ids and different origins.
- A page asks for the origin of a cluster that is not in the catalog, or for a
  host that is neither the main window's nor a cluster's: it gets nothing, the
  same answer whatever the path.
- A cluster is removed from the catalog, or its kubeconfig file changes so
  that it no longer exists, while its frame is open: its frame closes as in
  the Electron build, its origin stops being served, and the other frames are
  not affected.
- A cluster frame is reloaded: only that frame reloads, and it announces
  itself again; the core does not keep it recorded twice.
- The main window is reloaded while clusters are open: the frames go with it,
  as in the Electron build, and the core forgets them at once, so that it does
  not send to frames that no longer exist.
- A cluster is closed and opened again before the core has forgotten its
  earlier frame: the new frame gets none of the messages meant for the earlier
  one, and its announcement replaces the earlier record.
- A frame never announces itself, because its page failed to load: the core
  does not count it as a frame, and a message for that cluster's frame reaches
  no view.
- The visible cluster is closed: the core no longer has a visible cluster
  until the main window names one.
- Content shown in a frame comes from the cluster and is not trusted: a script
  in it can do in its own frame whatever the page can, and nothing in another
  frame or in the main window.
- More than three clusters are open: every rule holds for each pair of them;
  three is the number the check uses, not a limit.
- The Tauri build is started again: a cluster opened again has the origin it
  had in the earlier run, as in the Electron build.

## Requirements _(mandatory)_

### Functional Requirements

#### One origin per cluster

- **FR-001**: In the Tauri build, each open cluster MUST be shown in a frame of
  its own, on the cluster's origin: different from the origin of every other
  cluster and from the main window's, and the same each time that cluster is
  opened, across restarts of the application.
- **FR-002**: A page in a cluster frame MUST NOT be able to read or change the
  document or the page state of another cluster frame or of the main window.
- **FR-003**: Browser storage written in one view MUST NOT be readable or
  writable from another view.
- **FR-004**: A cookie set in one view MUST NOT be visible to another view,
  nor sent with another view's requests. The Tauri build MUST NOT depend on a
  cookie shared between views.
- **FR-005**: The core MUST serve a cluster's origin only while that cluster is
  in the catalog, and MUST give no content for any other host than the main
  window's and those cluster origins.
- **FR-006**: What the core serves on a cluster's origin for that cluster's
  data MUST come from that cluster alone. A request that reaches the core from
  one origin for another origin's routes MUST be refused, and the core MUST NOT
  let the page of one origin read a response meant for another.
- **FR-007**: Each route the core serves, such as a page, an asset or a
  cluster's data, MUST state which views may use it: the main window, the
  cluster frames, or both. A request from a view of the other kind MUST be
  refused. The later core areas add their routes under the same rule. The
  channels are not routes in this sense: every channel stays open to every
  view, as spec 003 decided, except the two of FR-016 and FR-017.
- **FR-008**: The core MUST take the identity of a view, the main window or the
  frame of which cluster, from where its request comes from, never from what
  the request says (FR-006 of `specs/002-messaging-for-tauri/spec.md`).

#### Opening, switching and closing

- **FR-009**: The Tauri build MUST keep at least three clusters open at the
  same time. The feature sets no upper limit.
- **FR-010**: Opening a cluster that already has a frame MUST show that frame
  and MUST NOT make another. Switching the visible cluster MUST NOT reload a
  frame or lose its page state.
- **FR-011**: Closing a cluster MUST remove its frame and MUST NOT reload,
  empty or delay another frame or the main window: their page state, their
  browser storage, their requests in flight and the messages they receive stay
  as they would have been without the close.
- **FR-012**: After a cluster is closed, the core MUST drop the answers and
  messages meant for its frame, so that nothing meant for it reaches another
  view or a later frame of the same cluster. The core MUST stop counting it as
  a frame no later than 60 seconds after the frame stops listening for the
  core's messages, and MUST forget every frame at once when the main window
  is reloaded. This feature adds no channel for closing; removing a frame at
  once when its cluster is disconnected or deleted belongs to the area that
  disconnects and deletes clusters, through FR-018.
- **FR-013**: A cluster opened again after being closed MUST get a new frame
  on the same origin, with none of the page state of the earlier frame.
- **FR-014**: When a cluster frame is created, shown, hidden and removed in the
  Tauri build MUST follow the Electron build: a frame is created when its
  cluster is first opened, hidden and shown without a reload, and removed when
  the cluster is closed; each frame announces itself, and the main window
  announces the visible cluster, as in the Electron build. In this feature the
  catalog page does this; the renderer's own code that manages the frames runs
  in the Tauri build once the renderer's root frame starts there, in a later
  spec.

#### The channels of cluster-frames

- **FR-015**: Every channel of cluster-frames MUST either be answered by the
  core, or have no sender in the views of the Tauri build. The channel list
  MUST say which, for each.
- **FR-016**: The core MUST answer `cluster:set-frame-id` from a cluster frame
  that names its own cluster, and MUST record that this cluster has a frame. A
  request from the main window, or naming a cluster other than the sender's
  own, MUST be refused and MUST record nothing. What else the Electron build
  does on that request for another area, such as sending the catalog, belongs
  to the spec of that area, which does it through FR-018.
- **FR-017**: The core MUST listen on `current-visible-cluster` from the main
  window, and MUST know, after each message, which cluster is visible or that
  none is. The message from a cluster frame MUST be ignored.
- **FR-018**: The core MUST share the frame record with its other areas, so
  that a later area adds behaviour without changing this feature's code. An
  area MUST be able to read which clusters have a frame and which one is
  visible; to learn when a frame is announced and when one is forgotten; to
  remove the frame of a cluster, as disconnecting or deleting a cluster does
  in the Electron build; and to send a message to the frame of one cluster, or
  of the visible cluster, so that it reaches that frame once and no other
  view. A message for a cluster without a frame MUST be dropped without an
  error.
- **FR-019**: No view of either build MUST send
  `request-freelens-proxy-certificate`, and neither the core nor the main
  process of the Electron build MUST answer it: the private key of a local
  proxy MUST NOT reach a view of either build. The channel MUST move to the
  section of channels removed by this feature in the channel list. Whatever a
  view needed that key or certificate for MUST work without it.
- **FR-020**: A channel this feature adds, renames or stops sending MUST be
  updated in the channel list, with the columns the list requires.

#### The Electron build and the tests

- **FR-021**: The Electron build MUST keep its behaviour: the same frames on
  the same origins, the same local proxy, the same cookie, the same channels
  with the same answers, except that `request-freelens-proxy-certificate` is
  no longer sent or answered (FR-019). Its extension API MUST NOT change
  (Principle III of the constitution).
- **FR-022**: The Electron build MUST keep building, and MUST pass its unit and
  integration tests (Principle VII of the constitution). An existing test MUST
  NOT be removed or weakened to make it pass.
- **FR-023**: Each rule of FR-005 to FR-008 and of FR-012, and each answer of
  FR-016 to FR-018, MUST be covered by tests of the core, including the
  refusals.

### Key Entities

- **Cluster frame**: the view of one open cluster. Belongs to one cluster, has
  that cluster's origin, is loaded or not, is visible or hidden.
- **Cluster's origin**: the identity under which the browser engine keeps one
  cluster's frame apart. Derived from the cluster's id; one per cluster.
- **Frame record**: what the core knows about the frames: which clusters have
  one, and which cluster is visible. Made from the announcements of the frames
  and of the main window; emptied of a cluster when it is closed. Shared with
  the other areas of the core, which read it, follow its changes and remove a
  cluster's frame from it (FR-018).
- **Route**: something the core serves to the views, with the kind of view
  that may use it.
- **Channel of cluster-frames**: one row of the section "cluster-frames (004)"
  of the channel list, with the core's answer or the reason no view sends it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In the Tauri build, with three clusters open at the same time,
  each of the three frames and the main window reports an origin that differs
  from the other three.
- **SC-002**: With three clusters open, every attempt from each frame to reach
  the main window or another frame fails: reading its document, reading or
  writing its browser storage, seeing a cookie it set, and getting its
  cluster's data. The check runs every attempt from every frame and finds no
  attempt that succeeds.
- **SC-003**: With three clusters open and a mark in the page state and the
  browser storage of each, closing one leaves both marks in each of the other
  two frames, neither of them reloads, and each still gets an answer from the
  core afterwards.
- **SC-004**: A cluster closed and opened again loads without the mark its
  earlier page state held, and reports the same origin as before.
- **SC-005**: A message the core sends to the frame of one of three open
  clusters arrives in that frame once and in no other view; a message for a
  closed cluster arrives nowhere. The core no longer counts a closed cluster's
  frame 60 seconds after the close, and counts no frame right after the main
  window is reloaded.
- **SC-006**: A review of the section "cluster-frames (004)" of the channel
  list finds, for each of its channels, a test of the core that shows its
  answer, or no sender in the views of the Tauri build; and no channel of
  either build carries a private key to a view.
- **SC-007**: The Electron build builds, and its unit and integration tests
  pass, with no existing test removed or weakened. A manual check of the
  Electron build, on the branch and on `main` as a control, shows the same
  result for opening three clusters, switching between them, closing one and
  opening it again.

## Assumptions

- The isolation asked for is the one the Electron build has, by origin in the
  browser engine, plus the core refusing what crosses origins. As in the
  Electron build, it does not restrict which channel a view may use, and a
  channel whose request names a cluster is answered for the cluster it names
  (Clarifications of `specs/003-renderer-without-node/spec.md`). The two
  channels of cluster-frames are the exception (FR-016, FR-017), because they
  tell the core what the frames themselves are.
- The Electron build shares one cookie between its views on purpose, the token
  of its local proxy. The Tauri build has no such cookie; the core knows each
  view by where its requests come from (FR-008).
- Neither the renderer's root frame nor its cluster view has to run in the
  Tauri build at the end of this feature: the areas that answer their channels
  come later in the order of R9 of `specs/001-tauri-shell-spike/research.md`.
  The rules are shown with the catalog page and the frame page, and hold for
  the pages a later spec serves, because they are rules of the origin and of
  the core, not of the page.
- Until `main-catalog` sends the catalog through the frame record (FR-018), a
  frame of the Tauri build gets no catalog after it announces itself. The
  frame page does not need one: it learns its cluster from its own origin.
- Data that travels continuously from the core to one frame, which watches and
  the terminal need, is not part of this feature
  (FR-013 of `specs/002-messaging-for-tauri/spec.md`).
- In the views of the Electron build, the only code that touches the
  certificate `request-freelens-proxy-certificate` returns is the step that
  stores it before a frame starts; nothing in the views, and nothing the
  extension API reaches, reads the stored value. Its readers are all on the
  main side. Removing the request from both builds (FR-019) therefore changes
  nothing a user or an extension sees; the plan rechecks that no reader has
  appeared.
- The check opens three clusters from a kubeconfig file with three contexts,
  given to the Tauri build with its launch option, not from the user's own
  kubeconfig. Showing a frame as isolated does not need three different
  clusters behind the three contexts.
- A cluster frame that crashes or hangs is not covered: whether the browser
  engine keeps the frames of different origins in different processes is not
  something this feature can require.
- The feature sets no target for memory or for the time to open a frame; the
  targets of the port are those of `specs/baseline.md` and of spec 001.
- The Tauri build runs on macOS on Apple Silicon only (Principle VII of the
  constitution), and has no extension system, so the frames and origins that
  serve extensions in the Electron build have no counterpart.
- Depends on the cluster frame proven in `specs/001-tauri-shell-spike` and on
  the channels and the sender of a request of
  `specs/002-messaging-for-tauri`.
