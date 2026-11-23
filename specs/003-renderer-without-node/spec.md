# Feature Specification: Renderer Without Node

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-23

**Status**: Draft

**Input**: User description: "The renderer works without Node.js: everything it needs from the file system, processes or the operating system comes from the main side over request channels. Success: the renderer list in scripts/type-check-environments/legacy.jsonc is empty; the app works with Node integration off in the window and in the cluster frames; the unit and integration tests pass."

In this specification:

- **The Electron build** is the Freelens desktop application as it is built and
  shipped today; **the Tauri build** is the build on the new shell, whose main
  side is **the core**.
- **A view** is a page of the user interface: the main window, or the frame of
  one open cluster. **The renderer** is the code that runs in the views; **the
  main side** is the main process of the Electron build, or the core of the
  Tauri build.
- **A request channel** carries a question from a view to the main side and
  returns one answer or one error, as defined in
  `specs/002-messaging-for-tauri/spec.md`.
- **Node** is what a page has only through Node integration: Node's built-in
  modules, its globals (such as `process`, `Buffer` and `require`), the types
  that describe them, and Electron's own modules, which a page reaches through
  Node's module loader.
- **Node integration** is the setting of the Electron build that gives a page
  Node. It is set for the window and, separately, for the frames inside it,
  which hold the cluster frames.
- **The renderer legacy list** is the `renderer` list of
  `scripts/type-check-environments/legacy.jsonc`: the renderer and common files
  whose use of Node the type check still tolerates. **The Biome exemption** is
  the list of files that `biome.jsonc` exempts from the rule against importing
  Node modules in renderer and common code.
- **A value of the machine** is a value that depends on the computer or on the
  process that reads it: the contents of a file, a directory of the user or of
  the application, the platform and architecture, the user's account, the
  environment of a process, how the application was packaged.
- **The channel list** is
  `specs/002-messaging-for-tauri/contracts/channel-list.md`, the list of every
  channel of the Electron build with the core area that will answer it, by the
  areas of R9 of `specs/001-tauri-shell-spike/research.md`.

## Clarifications

### Session 2026-11-23

- Q: How far should the new channels through which views ask main to touch files or run programs be restricted? → A: Each channel does one task; none takes a program or a command line from a view; file contents are read or written only at a path the user chose. Every view, the window and each cluster frame alike, may use every channel; restricting channels by view is not part of this feature.
- Q: What happens to an extension whose renderer code still uses Node once Node integration is off? → A: Node goes off for extensions in this feature too. Such an extension fails alone, its failure is logged with its name as other failures to load an extension are logged today, and no notification is added; the application and the other extensions keep working.
- Q: Does this feature also turn on context isolation in the window and the cluster frames? → A: No. Only Node integration goes off; context isolation stays off, and turning it on is a separate change.
- Q: How much slower than `main` may startup be after the change, for the window and for opening a cluster frame? → A: At most 10%, median of three runs, measured on the same machine.
- Q: Electron loads a preload script into the frames only while Node integration in subframes is on; with both settings off, the cluster frames have no channel to main. Which way do they reach it? → A: Node integration goes off and the sandbox stays on; the setting for subframes stays on only so that the preload loads into every frame, and no frame can reach Node, which a spike proves before the rest of the work. If the spike fails, the cluster frames relay through the window instead.
- Q: How does FR-007 apply to the extension API calls that take a folder from the extension, the upload folder of `FilePicker`, the folder of `createResourceStack` and the `cwd` of an `ExtensionStore`? → A: They are exempt: the main side reads or writes the folder the extension names, as today. Failing for another folder would be a breaking change to the extension API, which Principle III allows only in a major release.
- Q: The main side cannot tell whether a path a view sends came from the user. What does FR-007 promise then? → A: It bounds what each channel does, not who calls it. With context isolation off, any script in a page can call any channel, as it can use Node today; restricting the callers needs context isolation, which is out of scope.

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the maintainers porting Freelens to the
Tauri build, whose views have no Node, and the maintainers of the Electron
build, whose views lose direct access to the machine. Users of the Electron
build see the same application, with the exceptions listed under Assumptions.

### User Story 1 - Values and actions of the machine come from the main side (Priority: P1)

A maintainer opens a part of the application that reads a value of the
machine or acts on it from a view: the stored preferences, clusters and
hotbars, the directories of the user and of the application, the platform, the
default shell, a file the user picked, the user's resource templates, opening a
link in the browser. The view gets each value, and has each action done, by
the main side over a request channel, and behaves as before.

**Why this priority**: The Tauri build cannot give its views any value of the
machine except over a channel, so this is the work that lets the full renderer
run there. It is also most of the work: the rest of the feature depends on it.

**Independent Test**: For a file that leaves the renderer legacy list this
way, run the parts of the application that use it in the Electron build, on
the branch and on `main` as a control, and compare: same values shown, same
files written, same errors. The file is off the renderer legacy list and the
Biome exemption, and the type check passes.

**Acceptance Scenarios**:

1. **Given** a view that read a value of the machine itself, **When** it needs
   that value after the change, **Then** it receives from the main side the
   value the main side sees, and shows what it showed before.
2. **Given** a view that read, wrote, listed or watched a file or a directory
   itself, **When** it does so after the change, **Then** the main side does it
   on the view's request, with the same result and the same error on failure.
3. **Given** a value the view needs before it renders its first screen, such as
   the stored preferences or the theme, **When** the window or a cluster frame
   starts, **Then** its first screen already shows the stored value, not a
   default that is replaced afterwards.
4. **Given** a value the renderer took from its own environment that differs
   from the main side's, such as the default shell, **When** the view shows it
   after the change, **Then** it shows the main side's value.
5. **Given** a new request channel, **When** the maintainer looks it up in the
   channel list, **Then** its entry names the core area that will answer it in
   the Tauri build.

---

### User Story 2 - The renderer computes without Node (Priority: P2)

A maintainer finds renderer code that uses Node for work that needs nothing
from the machine: checking a condition, joining or splitting a path, encoding
binary data, a timer, an event emitter, a type such as a timer handle. That
code does the same work with what both a browser page and Node have, and gives
the same results.

**Why this priority**: Many files of the renderer legacy list are of this kind.
They need no channel, so each can leave the list on its own, at any time, but
they block Node integration from being turned off as much as the files of User
Story 1 do.

**Independent Test**: For a file that leaves the renderer legacy list this
way, its unit tests, and new ones for any computation whose result depends on
the platform, pass; the file is off the renderer legacy list and the Biome
exemption, and the type check passes.

**Acceptance Scenarios**:

1. **Given** a computation on a path, **When** it runs in a view for a path of
   the platform the application runs on, including the drive letters and
   separators of Windows, **Then** it gives the result the main side gives for
   the same input.
2. **Given** a check that stopped the code with an error, **When** its
   condition fails after the change, **Then** it stops the code with an error
   as it did.
3. **Given** binary data or text in another encoding that the renderer
   converts, **When** it converts it after the change, **Then** the result is
   the same, byte for byte.

---

### User Story 3 - The application runs with Node integration off (Priority: P3)

A maintainer starts the Electron build with Node integration off. The window
loads, clusters open in their frames, and every
feature works as before, including the terminal, logs, Helm, editing and
creating resources, preferences and extensions; nothing in a view can reach
Node.

**Why this priority**: It is the proof that Stories 1 and 2 are complete, and
it can only be done after both: turning Node integration off before the
renderer legacy list is empty breaks the application.

**Independent Test**: Start the Electron build, try to reach Node from the
window and from a cluster frame and find nothing, then run the integration
tests and the manual check of the paths the moved values served.

**Acceptance Scenarios**:

1. **Given** Node integration is off, **When** the application starts, **Then**
   the window loads and shows the same first screen as before.
2. **Given** Node integration is off, **When** the user opens a cluster,
   **Then** its frame loads without Node, talks to the main side over the
   channels, and shows the cluster as before.
3. **Given** Node integration is off, **When** code in the window or in a
   cluster frame tries to reach Node, **Then** it finds nothing.
4. **Given** an installed extension whose renderer code uses Node, **When** the
   application loads it, **Then** that extension fails alone, the failure is
   logged with the extension's name, and the application and the other
   extensions keep working.
5. **Given** Node integration is off, **When** the unit and integration tests
   run, **Then** they pass.

---

### Edge Cases

- The main side cannot do what a view asks, because a file is missing,
  unreadable or the disk is full: the view shows the same error or
  notification it showed before, and does not wait forever.
- The user changes a preference and closes the window or quits at once: the
  change is saved, as it is today.
- The window and a cluster frame change the same store at about the same time:
  neither loses a change it would not have lost before.
- A file the view watches, such as the directory of resource templates,
  changes: the view shows the change as it does today.
- A file the user picks or drops is large, or binary, such as an extension
  package: it arrives whole and unchanged, and the operation works as before.
- A path on Windows, with a drive letter, backslashes or a network share, and a
  path on Linux or macOS: every computation on it gives the main side's result.
- The application runs as a Flatpak or Snap package, or in development mode: the
  view learns this from the main side, and behaves as it did.
- A value fixed when the application is built, such as development or
  production mode, is not a value of the machine: it stays fixed by the build.
- An extension calls a function of the extension API in the renderer that read
  a value of the machine synchronously: it still gets the value synchronously,
  with the same type and result.
- An extension's renderer code calls `require` or reads `process`: it fails as
  C4 of `docs/extensions/api.md` allows, alone, and its failure names it.
- Content shown in a cluster frame comes from the cluster and is not trusted:
  no channel this feature adds runs a command line it sends, and each channel
  does one task. A script in the page can still call every channel, as it can
  use Node today (FR-007).

## Requirements _(mandatory)_

### Functional Requirements

#### Values and actions of the machine

- **FR-001**: Every value of the machine the renderer uses MUST come from the
  main side over a request channel, and MUST be the value the main side sees
  (Principle II of the constitution).
- **FR-002**: Every action of the renderer on the file system or on processes,
  such as reading, writing, listing, watching or removing a file or a
  directory, running a program, opening a link in the browser or a file with
  the operating system, MUST be done by the main side on the view's request.
- **FR-003**: Where a view showed or used a value from its own environment that
  differs from the main side's, it MUST show or use the main side's value after
  the change.
- **FR-004**: A value a view needs before its first screen MUST be in the view
  before the code that reads it runs, so that the window and each cluster frame
  show the user's stored values on their first screen, not defaults first.
- **FR-005**: A failure of the main side to do what a view asks MUST reach the
  view as an error, and the view MUST handle it as it handled the same failure
  before: same message, same notification, no wait without end.
- **FR-006**: A change a view asks the main side to save MUST NOT be lost in
  a case where it was not lost before, including when the view closes or the
  application quits right after the change.
- **FR-007**: Each channel the feature adds MUST do one task of the
  renderer, not offer the file system or processes in general. It MUST NOT
  accept a program or a command line to run, and MUST NOT read or write the
  contents of a file at a path sent by a view, except a path the user chose in
  that view, in a file dialog, by dropping a file, or by typing it into a
  setting that exists for that path. The extension API calls that take a folder
  from the extension, the upload folder of `FilePicker`, the folder of
  `createResourceStack` and the `cwd` of an `ExtensionStore`, are exempt: the
  main side reads or writes the folder the extension names, as today
  (FR-014). These rules hold for every view alike; the feature does not
  restrict which view may use which channel. They bound what each channel
  does, not who calls it: the main side cannot tell whether a path came from
  the user, and with context isolation off any script in a page can call any
  channel, as it can use Node today.

#### Computations without Node

- **FR-008**: Renderer code that needs nothing from the machine MUST do its
  work with what both a browser page and Node have, and MUST give the same
  results as before.
- **FR-009**: A computation on paths in a view MUST give the result the main
  side gives for the same input, on every platform the Electron build runs on.

#### The legacy list and the Node integration

- **FR-010**: Every file MUST leave the renderer legacy list, including the
  files of the extension system. A file that is in the Biome exemption MUST
  leave it together with the renderer legacy list. A file MUST NOT be added to
  either list. The `main` list of `legacy.jsonc` is not part of this feature,
  except that a file moved out of `common/` also leaves the `main` list.
- **FR-011**: A common file that the main side also uses MUST keep its
  behaviour in the main side, which keeps Node.
- **FR-012**: The Electron build MUST create its window with Node integration
  off and the sandbox on, once the renderer legacy list is empty. A view MUST
  NOT be able to reach Node. The setting for subframes MAY stay on only so that
  the preload loads into every frame, and only while no frame can reach Node
  (SC-002). Context isolation stays off; this feature does not change it.
- **FR-013**: The channels MUST keep working from the window and from every
  cluster frame with Node integration off, and the views MUST reach the main
  side only over them, except the extension system's own IPC under
  `packages/core/src/extensions/`, which spec 002 exempts, and which the Tauri
  build does not have.

#### Extensions

- **FR-014**: The extension API of the Electron build MUST NOT change: what the
  `Common`, `Main` and `Renderer` namespaces reach keeps its types, whether it
  is synchronous or asynchronous, its results and its failures (Principle III
  of the constitution, C14 of `docs/extensions/api.md`).
- **FR-015**: Renderer code of an extension MUST get no Node, as C4 of
  `docs/extensions/api.md` states, from the same change that turns Node
  integration off for the core. An extension whose renderer code depends on
  Node MUST fail alone: its failure is logged with its name, as other failures
  to load an extension are logged today, without a notification to the user,
  and the application and the other extensions keep working.
- **FR-016**: Installing, validating and removing an extension from the
  application's views MUST keep working, with the work on the file system done
  by the main side.

#### The Tauri build

- **FR-017**: Every channel the feature adds MUST be added to the
  channel list, with the columns the list requires and a core area of R9 of
  `specs/001-tauri-shell-spike/research.md` as its owner. A channel that serves
  only the extension system, which the Tauri build does not have, goes to the
  list's section of channels that are not ported, with that reason.
- **FR-018**: A channel the feature adds MUST carry only values that the
  channels of both builds carry unchanged (FR-008 of
  `specs/002-messaging-for-tauri/spec.md`); no entry it adds to the channel
  list is marked `non-JSON`.

#### Tests and the Electron build

- **FR-019**: The existing unit tests MUST pass. A test file MAY be edited only
  where the code it tests, or a module it replaces with a fake, moves off Node
  or to the main side; such an edit MUST NOT remove a test, and each test MUST
  still assert what it asserted. Every other test file MUST stay unchanged. A
  test of code this feature deletes is deleted with it, and a test of code
  that moves to the main side moves with it; the task that does it names each
  such test.
- **FR-020**: Each channel the feature adds MUST be covered by unit tests on
  both sides: the view's side against a stand-in for the main side, and the
  main side's answer or listener, including its failure.
- **FR-021**: The Electron build MUST keep building, and MUST pass its unit and
  integration tests with Node integration off (Principle VII of the
  constitution).

### Key Entities

- **Value of the machine**: a value that depends on the computer or the process
  that reads it. Read by the main side, sent to the views that need it.
- **Machine action**: an operation on the file system or on processes that a
  view needs done. Done by the main side, on a request that names one task.
- **Legacy list entry**: a renderer or common file whose use of Node the type
  check tolerates. Leaves the list, and the Biome exemption, once it no longer
  uses Node.
- **Channel list entry**: one channel this feature adds, with its kind,
  direction, answering code in the Electron build, values, and the core area
  that will answer it.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The renderer list of `scripts/type-check-environments/legacy.jsonc`
  and the Biome exemption are both empty, and `pnpm type:check` passes.
- **SC-002**: In the Electron build, from the window and from a cluster frame,
  each attempt to reach Node (its module loader, `process`, `Buffer`), or any
  module of Electron other than the IPC object the bridge hands the page, finds
  nothing.
- **SC-003**: The unit tests pass, with test files edited only as FR-019
  allows, and the integration tests pass with Node integration off.
- **SC-004**: The manual check of the application, on the branch and on `main`
  as a control, shows the same result for every part that used a moved value
  or action: the first screen of the window and of a cluster frame,
  preferences, hotbars, adding a cluster from pasted kubeconfig text and from a
  synced kubeconfig file, resource
  templates, the terminal, logs, Helm install and edit, and installing an
  extension.
- **SC-005**: The time from the start of the application to its window being
  loaded, median of three runs, measured as in `specs/baseline.md`, is no more
  than 10% above the same measurement of `main`, built the same way, on the
  same machine. The time from clicking a connected cluster to the first page of
  its frame being shown, median of three runs, is no more than 10% above
  `main`'s.
- **SC-006**: A review of every channel the feature adds finds each in the
  channel list with a core area of R9 as owner, or among the channels not
  ported for serving only the extension system, none marked `non-JSON`, none
  that takes a program or a command line, and each one that reads or writes
  file contents taking only a path of a kind FR-007 lists.
- **SC-007**: For paths of Windows, Linux and macOS, the computations of the
  views give the main side's result in unit tests, with no case that differs.

## Assumptions

- Users of the Electron build see no change, except that a value the renderer
  took from its own environment now shows the main side's value (FR-003), and
  that an extension whose renderer code depends on Node stops working, as C4 of
  the extension API allows in any release.
- Context isolation stays off in the window and the cluster frames (FR-012).
  Turning it on is a separate change, which C4 of the extension API already
  allows for.
- Node integration is turned off only once the renderer legacy list is empty;
  before that, the files still on the list need it.
- The full renderer does not have to run in the Tauri build at the end of this
  feature. The core answers each channel this feature adds in the spec of the
  core area that owns it, by the channel list; this feature adds the channels,
  their entries in the list, and the Electron build's answers.
- Unit tests run with both a browser page's API and Node, so they do not prove
  the absence of Node; the type check of the renderer program and the
  integration tests with Node integration off do.
- The `main` list of `legacy.jsonc`, main or common files that need a browser
  page's API, is unchanged by this feature.
- The Electron build runs on macOS, Windows and Linux; the manual check of
  SC-004 runs on macOS, and the platform cases of paths are proven by unit
  tests (SC-007).
- Values fixed when the application is built, such as development or
  production mode, stay fixed by the build and need no channel.
- A request to the main side ends with an answer or an error, which is what
  FR-005 asks by "no wait without end". Electron rejects a request that no
  listener answers, and every listener this feature adds answers or throws; no
  timeout is added.
