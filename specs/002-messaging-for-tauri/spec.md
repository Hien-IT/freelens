# Feature Specification: Messaging for the Tauri Build

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "The renderer talks to the new core through the same request and message channels it uses today, with no change to feature code in the renderer. Success: the renderer side has an implementation of the channels for the new shell; there is a list of every channel the Electron build registers with the core area that will answer it; no feature code outside the messaging packages talks to Electron IPC directly; the unit tests pass unchanged."

In this specification:

- **The Electron build** is the Freelens desktop application as it is built and
  shipped today; **the Tauri build** is the build on the new shell, whose main
  side is **the core**, started by `specs/001-tauri-shell-spike`.
- **A view** is a page of the user interface: the main window, or the frame of
  one open cluster.
- **A channel** is a named path between the views and the main side of a build.
  A **request channel** carries a question from a view and returns one answer
  or one error. A **message channel** carries a one-way message, from a view to
  the main side or from the main side to the views.
- **The messaging packages** are the packages under
  `packages/technical-features/messaging/`.
- **Feature code** is every source file outside the messaging packages that is
  not a test or test support.
- **Electron IPC** is Electron's own inter-process messaging: its main-side and
  renderer-side IPC objects, and sending to a window's web contents or frames.
- **A core area** is one of the areas of the main side that the specs of the
  port move to the core, as grouped in R9 of
  `specs/001-tauri-shell-spike/research.md`.

## Clarifications

### Session 2026-11-22

- Q: Does "the unit tests pass unchanged" forbid editing any existing test file, or may the tests of the files that move off Electron IPC be adapted? → A: They may be adapted, provided no test is removed and each still asserts what it asserted; every other test file stays unchanged.
- Q: Does this feature also carry a continuous stream of data from the core to one view, for watches and later the terminal? → A: No. It carries only the request and message channels the Electron build has; the spec that first needs a stream adds it.
- Q: Does the rule against direct Electron IPC cover the Electron build's extension system? → A: No. The extension system is an exception: it keeps its use of Electron IPC, the search of SC-001 leaves out its directory, and its channels are listed as not ported.

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the maintainers porting Freelens to the
Tauri build. Users of the application see no change: the Electron build behaves
as before, and the Tauri build gains no visible feature.

### User Story 1 - Views reach the core over the existing channels (Priority: P1)

A maintainer runs renderer code that uses the existing channels in the Tauri
build. Its requests reach the core and come back with the answer, its messages
reach the core, and messages from the core reach it, from the main window and
from a cluster frame, without any change to the code that uses the channels.

**Why this priority**: Every later spec of the port answers channels in the
core; none of them can start before the views can reach the core this way.

**Independent Test**: In the Tauri build, a view that uses the channels the way
renderer features do sends a request and a message to the core and receives a
message from it, once from the main window and once from a cluster frame. The
same code, given the Electron implementation, passes the same steps in the
Electron build.

**Acceptance Scenarios**:

1. **Given** the core answers a request channel, **When** a view sends a request
   on it, **Then** the view receives the core's answer with the same values it
   would receive in the Electron build.
2. **Given** a core area listens on a message channel, **When** a view sends a
   message on it, **Then** the core area receives that message once.
3. **Given** the main window and two cluster frames listen on a message channel,
   **When** the core sends a message on it, **Then** each of the three views
   receives it once, as each would in the Electron build.
4. **Given** the core does not answer a request channel, **When** a view sends a
   request on it, **Then** the request fails with an error that names the
   channel, and does not wait forever.
5. **Given** a cluster frame sends a request, **When** the core handles it,
   **Then** the core knows which view sent it, and content in one view cannot
   make a request appear to come from another view.

---

### User Story 2 - No feature code goes around the channels (Priority: P2)

A maintainer searches the sources for direct use of Electron IPC and finds it
only in the messaging packages and in the extension system, which the Tauri
build does not have. Every other path from a view to the main side, and back,
goes through a channel, so swapping the implementation of the channels is
enough to carry every feature to the Tauri build.

**Why this priority**: Feature code that talks to Electron IPC directly would
need rewriting for the Tauri build, which is what this feature exists to avoid.
It changes only the Electron build, and can be done before or after User Story
1.

**Independent Test**: Run the search of section 0.3 of
`specs/tauri-port-runbook.md` for direct use of Electron IPC in non-test
sources, leaving out `packages/core/src/extensions/`; it returns only files of
the messaging packages. The Electron build then passes its unit and
integration tests.

**Acceptance Scenarios**:

1. **Given** a feature that today sends or answers on Electron IPC directly,
   **When** it is moved onto a channel, **Then** it behaves in the Electron
   build exactly as before: same answers, same messages, same order.
2. **Given** all such features are moved, **When** the sources outside the
   extension system are searched for direct use of Electron IPC, **Then** only
   files of the messaging packages are found.
3. **Given** the Electron build after the move, **When** its unit and
   integration tests run, **Then** they pass.

---

### User Story 3 - Every channel has an owner in the core (Priority: P3)

A maintainer planning the port of a core area opens the list of channels and
sees every channel the Electron build registers: what it carries, in which
direction, where the Electron build answers it, and which core area will answer
it in the Tauri build.

**Why this priority**: The later `main-*` specs measure their completion by
"every channel of this area in the list is answered by the core". The list can
be written at any time, but it is only complete once User Story 2 has brought
every path onto a channel.

**Independent Test**: Compare the list with every place where the Electron
build registers a channel or answers on Electron IPC; every channel found
there is in the list, and every entry names a core area or the reason it is not
ported.

**Acceptance Scenarios**:

1. **Given** a channel the Electron build registers, **When** the maintainer
   looks it up in the list, **Then** the entry gives its kind, its direction,
   the code that answers or listens to it in the Electron build, and the core
   area that will answer it.
2. **Given** a channel whose name is built at run time (per cluster, per
   extension, or with a prefix), **When** the maintainer looks it up, **Then**
   the list holds its pattern, and the pattern covers every name the Electron
   build builds.
3. **Given** a channel that serves something the Tauri build does not have,
   such as extensions or auto-update, **When** the maintainer looks it up,
   **Then** the entry says it is not ported, and why.

---

### Edge Cases

- A core area fails while answering a request: the request fails in the view
  with the error's message, as it does in the Electron build, and the core keeps
  answering other requests.
- A value cannot cross the channel unchanged, for example a date, a map, a set,
  binary data, `undefined` inside a list, or a structure that refers to itself:
  it arrives with the same type and value as in the Electron build, or sending
  it fails with an error that names the channel. It never arrives silently
  changed.
- Observable values from the views' state are sent as plain data, as the
  Electron build sends them.
- A cluster frame closes while one of its requests is in flight: the answer is
  dropped, and no other view receives it or an error about it.
- The core sends a message before a view has finished loading: the view
  receives the messages that the Electron build would deliver to it at the same
  point, and no others.
- Two messages on one channel from one sender arrive in the order they were
  sent.
- Two core areas register an answer for the same request channel: the core
  refuses to start and names the channel, rather than letting one answer win.
- A large answer, such as the catalog of a kubeconfig with many contexts,
  arrives whole.
- No answer and no message from the core carries a certificate, key or token
  from a kubeconfig file, as required of the core by spec 001.

## Requirements _(mandatory)_

### Functional Requirements

#### Channels in the Tauri build

- **FR-001**: The Tauri build MUST provide, on the view side, an implementation
  of sending requests, sending messages and listening to messages, reached by
  feature code exactly as it reaches the Electron implementation today.
- **FR-002**: Which implementation a view uses MUST be decided where a build
  assembles its views, and nowhere in feature code. Running a feature in the
  Tauri build MUST NOT require changing that feature's code.
- **FR-003**: The channels MUST work from the main window and from every cluster
  frame of the Tauri build.
- **FR-004**: A message the core sends MUST reach the views the Electron build
  would deliver it to, each once.
- **FR-005**: The answer to a request MUST reach only the view that sent it.
- **FR-006**: For every request and message, the core MUST know which view sent
  it (the main window, or the frame of which cluster), and content in a view
  MUST NOT be able to claim to be another view.
- **FR-007**: A request on a channel the core does not answer MUST fail with an
  error naming the channel. A message on a channel nobody listens to MUST be
  dropped without an error in the sender.
- **FR-008**: A value carried by a channel MUST arrive with the same type and
  value as in the Electron build, or its sending MUST fail with an error naming
  the channel.
- **FR-009**: Messages on one channel from one sender MUST arrive in the order
  sent.
- **FR-010**: The core MUST offer one place where each core area registers the
  request channels it answers and the message channels it listens to and sends
  on. A request channel MUST have at most one answer; a second registration
  MUST stop the core at startup with an error naming the channel.
- **FR-011**: The Tauri build MUST show, from the main window and from a cluster
  frame, a request answered by the core and a message in each direction,
  carried by the view-side implementation of FR-001 on existing channels of the
  list of FR-016.
- **FR-012**: No channel MUST carry a certificate, key or token from a
  kubeconfig file to a view.
- **FR-013**: The feature MUST carry the two kinds of channels the Electron
  build has, request and message, and no other. A continuous stream of data
  from the core to one view, which a cluster's watches need because the Tauri
  build cannot stream them over its page requests (R4 of spec 001), and which
  the terminal of spec 005 needs, is added by the spec that first needs it.

#### Feature code without direct Electron IPC

- **FR-014**: Feature code MUST NOT use Electron IPC directly. Every path between
  a view and the main side MUST go through a channel of the messaging packages.
  The extension system of the Electron build, the files under
  `packages/core/src/extensions/`, is exempt: it keeps its use of Electron IPC,
  since the Tauri build has no extension system. Code outside that directory
  is not exempt, including code that serves extensions and the helpers the
  extension system shares with other features.
- **FR-015**: Moving a feature onto a channel MUST NOT change its behaviour in
  the Electron build, including what the extension API returns and how it fails
  (Principle III of the constitution).

#### The list of channels

- **FR-016**: The feature MUST produce a list of every channel the Electron
  build registers, including those it registers on Electron IPC directly
  today. Each entry MUST give the channel's name or name pattern, its kind
  (request or message), its direction, the code that answers or listens to it
  in the Electron build, and either the core area that will answer it in the
  Tauri build or the reason it is not ported.
- **FR-017**: A channel whose name is built at run time MUST be listed by a
  pattern that covers every name the Electron build builds for it.
- **FR-018**: Every core area named in the list MUST be one of the areas of R9
  of `specs/001-tauri-shell-spike/research.md`, so that each later `main-*`
  spec can select its channels from the list.

#### Tests and the Electron build

- **FR-019**: The existing unit tests MUST pass. A test file MAY be edited only
  where the code it tests, or a module it replaces with a fake, moves off
  Electron IPC; such an edit MUST NOT remove a test, and each test MUST still
  assert what it asserted. Every other test file MUST stay unchanged.
- **FR-020**: The view-side implementation of FR-001 MUST be covered by unit
  tests that run without the Tauri build, against a stand-in for the core, as
  the existing messaging packages are tested.
- **FR-021**: The Electron build MUST keep building and passing its unit and
  integration tests (Principle VII of the constitution).

### Key Entities

- **Channel**: a name, a kind (request or message), a direction, and the shape
  of the values it carries. Defined once and shared by the views and the main
  side.
- **View**: the main window or a cluster frame; the sender of requests and
  messages, and a receiver of messages. Identified to the core by which of the
  two it is and, for a frame, by its cluster.
- **Core area**: a part of the core that registers the channels it answers and
  listens to. Each request channel has at most one.
- **Channel list entry**: one channel or name pattern, with its kind, direction,
  answering code in the Electron build, and owning core area or reason it is
  not ported.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The search for direct use of Electron IPC of section 0.3 of
  `specs/tauri-port-runbook.md`, over non-test sources and leaving out
  `packages/core/src/extensions/`, returns only files of the messaging
  packages.
- **SC-002**: Every channel the Electron build registers is in the list, and
  every entry names a core area of R9 or a reason it is not ported: a review of
  every registration point finds no channel missing and no entry without an
  owner.
- **SC-003**: In the Tauri build, the request and the messages of FR-011
  succeed in 20 out of 20 attempts from the main window and in 20 out of 20
  from a cluster frame.
- **SC-004**: After User Story 2, no feature file changes to switch a view
  between the Electron and the Tauri implementation of the channels.
- **SC-005**: The unit tests pass, with test files edited only as FR-019
  allows, and the Electron build passes its integration tests.
- **SC-006**: No answer or message received by a view in the Tauri build
  contains a certificate, key or token from the kubeconfig file it was
  launched with.
- **SC-007**: The time from sending a request to receiving its answer, for
  answers of about 1 KB, 1 MB and 10 MB, is recorded for both builds, as
  information without a threshold.

## Assumptions

- The full renderer of the Electron build cannot run in the Tauri build before
  spec 003 (`renderer-without-node`), so FR-011 is shown with a view of the
  Tauri build that uses the view-side implementation, such as the pages of the
  spike, and the rest is proven by unit tests against a stand-in for the core.
- Answering a channel with the behaviour the Electron build has belongs to the
  spec of the core area that owns it. This feature provides the channels, the
  place where areas register them, and the channels FR-011 needs.
- Which views receive a message, and when, follows the Electron build, including
  that a cluster frame receives messages only after it has announced itself to
  the main side.
- Users of the Electron build see no change, and its settings and data are
  untouched.
- The list of channels lives with this feature's artifacts, where the later
  specs of the port read it. Each later spec that adds or moves a channel
  updates it.
- The Tauri build targets macOS on Apple Silicon only and has no extension
  system (Principle VII of the constitution). Channels that serve only
  extensions or auto-update, including every channel of the exempt extension
  system, are listed as not ported.
- R9 of spec 001 put a stream for watches in this feature. Under FR-013 it
  belongs to `main-cluster-connection`, the first spec that needs it.
- The search of SC-001 is the one of section 0.3 of the runbook. Sending to a
  window's web contents directly also counts as Electron IPC for FR-014, even
  where that search does not find it.
