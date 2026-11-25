# Feature Specification: Terminal

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "The terminal dock works in the macOS build with the same shells, environment and behaviour as in the Electron build. Success: the shell starts with the environment the host gives kubectl and helm (contract C15 in docs/extensions/api.md describes it); resize, copy and paste, and several tabs work; every channel that specs/002-messaging-for-tauri/contracts/channel-list.md gives to terminal-pty is answered by the new core."

In this specification:

- **The Electron build** is the Freelens desktop application as it is built and
  shipped today; **the Tauri build** is the build on the new shell, for macOS,
  whose main side is **the core**. "The macOS build" of the input is the Tauri
  build.
- **A view** is a page of the user interface: the main window, or the frame of
  one open cluster (`specs/004-cluster-frames/spec.md`).
- **A terminal** is one tab of the terminal dock, with the shell it runs. The
  Electron build has three kinds:
  - **a cluster terminal**, a local shell opened from a cluster's view, set up
    to reach that cluster;
  - **a node terminal**, a shell on one node of a cluster, reached through a
    short-lived pod the application creates on that node;
  - **a standalone terminal**, a local shell opened outside any cluster, which
    keeps the user's own kubeconfig and tools.
- **The terminal environment** is the set of variables a terminal's shell
  starts with. Its base is what contract C15 of `docs/extensions/api.md` calls
  the environment, for a cluster or without one, plus the variables only a
  terminal has (C15 names `PTYSHELL`, `ZDOTDIR` and `TERM_PROGRAM`).
- **The user's terminal settings** are the preferences the Electron build reads
  for its terminals: the shell, the terminal's font and font size, copy on
  select, the working directory of a cluster's terminal, the kubectl and helm
  paths and whether to download kubectl, the proxy of the application and of a
  cluster, and the image and pull secret of a node terminal.
- **The channel list** is
  `specs/002-messaging-for-tauri/contracts/channel-list.md`. **The channels of
  terminal-pty** are the rows of its section "terminal-pty (005)":
  `cluster:shell-api` and `app:standalone-shell-api`, which hand a view the
  single-use token that opens a terminal.
- **The terminal's data** is what flows while a terminal is open: the shell's
  output to the view, and the keystrokes, pastes and size changes from the
  view. The Electron build carries it outside the channels, and spec 002 left
  it to this feature (FR-013 of `specs/002-messaging-for-tauri/spec.md`).

## Clarifications

### Session 2026-11-25

- Q: The renderer's own dock runs only once the renderer's root frame and cluster view start in the Tauri build. Which view runs the terminal dock at the end of this feature? → A: The Tauri build's own pages: the catalog page runs the dock of standalone terminals, and the frame page of a cluster runs the dock of that cluster's terminals and node terminals, with tabs, resize, copy and paste as in the Electron build. The renderer's own dock replaces them in the spec that runs the renderer in the Tauri build, on the same channels and the same data path.
- Q: A cluster terminal needs the access to its cluster through the application, the version-matched kubectl and the user's settings, which the areas main-foundation, main-cluster-connection, main-kube-tools and main-shell-env give in the order of R9 of `specs/001-tauri-shell-spike/research.md`, and none is ported yet. How does this feature get them? → A: It waits for them, as R9 orders: the specification is written now, and the plan and the implementation come after those four areas are ported. This feature uses what they give and adds none of it: it adds the shells, the terminal sessions, the tokens, the terminal's data path and the dock.
- Q: May any view ask for any cluster's shell token, as in the Electron build? → A: No, in the Tauri core: a cluster's token is handed only to that cluster's frame, the standalone token only to the main window, and a terminal opens only from the view the token was handed to. Any other request is refused. The Electron build is unchanged.

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the users of the Tauri build, who run
kubectl, helm and their own tools from the terminal dock, and the maintainers
of the port, who need the terminal in the Tauri build before it can replace
the Electron build (Principle VII of the constitution). Users of the Electron
build see no change.

### User Story 1 - A terminal for a cluster, ready to use (Priority: P1)

A user of the Tauri build opens a cluster and opens a terminal for it. The
shell the user has set starts, in the working directory set for that cluster,
with the user's own shell setup, and `kubectl` and `helm` reach that cluster
without any further step, as in the Electron build. The user types commands,
sees their output, and closes the tab when done, which ends the shell.

**Why this priority**: Running kubectl against the cluster on screen is what
the terminal dock is for, and the environment is what makes it work: without
it, kubectl reaches the wrong cluster or none. It is the gate of this feature
in `specs/tauri-port-runbook.md`.

**Independent Test**: With the same settings in both builds, open a terminal
for the same cluster in the Electron build and in the Tauri build, and print
the environment, the working directory and the result of `kubectl get ns` and
`helm list -A` in each. The results are the same, and the variables differ
only where FR-007 allows.

**Acceptance Scenarios**:

1. **Given** an open cluster, **When** the user opens a terminal, **Then** the
   shell of the user's shell setting starts, in the working directory set for
   the cluster, or the home directory when none is set or it does not exist.
2. **Given** a cluster terminal, **When** the user runs kubectl or helm by
   name, **Then** it reaches that cluster, and no other, through the
   application, whatever the user's own kubeconfig variables say.
3. **Given** a cluster terminal, **When** the user prints its environment,
   **Then** it follows C15 for a cluster: the `PATH` order, `KUBECONFIG`,
   `KUBECACHEDIR`, the cluster's proxy as `HTTPS_PROXY`, `localhost` and
   `127.0.0.1` in `NO_PROXY`, no empty `PATH` entry; plus the terminal's own
   variables, as in the Electron build.
4. **Given** a cluster terminal of a zsh, bash or fish user, **When** the
   user's own startup files change `PATH` or `KUBECONFIG`, **Then** the
   application's kubectl directory and kubeconfig still win, as in the
   Electron build.
5. **Given** a running cluster terminal, **When** the user closes its tab,
   **Then** the shell is ended, as in the Electron build.
6. **Given** a cluster terminal, **When** the shell exits on its own, **Then**
   the terminal says that the process exited, with its exit code, and accepts
   no more input.

---

### User Story 2 - Several terminals, resized, copied and pasted (Priority: P2)

A user keeps several terminals open at once, for one cluster, for different
clusters and outside any cluster, switches between their tabs, resizes the
dock, copies output and pastes commands, as in the Electron build.

**Why this priority**: These are the everyday interactions the input names.
They depend on Story 1: there has to be a working terminal before several of
them can be shown to stay apart.

**Independent Test**: Open five terminals across two clusters and the
standalone dock. In each, start a long-running command, switch tabs, resize
the dock, run `stty size`, copy a line of output and paste it into another
terminal, close one tab. Each terminal keeps its own shell and output, sizes
follow the dock, copied text arrives unchanged, and closing one ends only its
shell.

**Acceptance Scenarios**:

1. **Given** several open terminals, **When** the user types in one, **Then**
   the input reaches that terminal's shell only, and each terminal shows only
   its own shell's output.
2. **Given** an open terminal, **When** the user resizes the dock or the
   window, **Then** the shell learns the new number of rows and columns, and
   full-screen programs redraw to fit.
3. **Given** text selected in a terminal, **When** the user copies it with the
   keyboard shortcut, or selects it with copy on select turned on, **Then** the
   clipboard holds that text.
4. **Given** text on the clipboard, **When** the user pastes it with the
   keyboard shortcut, or with the secondary click when copy on select is
   turned on, **Then** the shell receives that text once, multi-line text
   included, as in the Electron build.
5. **Given** several open terminals, **When** the user closes one tab, **Then**
   its shell ends, and the other terminals keep running with their output.
6. **Given** a terminal that is not the selected tab, **When** its shell
   prints output, **Then** the output is there when the user selects the tab.
7. **Given** open terminals, **When** the user changes the terminal font or
   font size setting, **Then** the open terminals use it.

---

### User Story 3 - A standalone terminal (Priority: P3)

A user opens a terminal outside any cluster. It is the user's own shell, as a
normal terminal application would start it: the user's own kubeconfig, the
user's own kubectl and helm when installed, and the application's bundled
kubectl and helm only as a fallback.

**Why this priority**: The Electron build has it, and it is how a user works
with kubeconfig files and clusters the catalog does not show. It reuses
everything of Stories 1 and 2 but the cluster.

**Independent Test**: With a kubectl of the user's own on `PATH`, open a
standalone terminal in both builds and print the environment and
`command -v kubectl`. The user's kubectl wins in both; without it, the bundled
one is found. `KUBECONFIG` is the user's own.

**Acceptance Scenarios**:

1. **Given** no cluster, **When** the user opens a standalone terminal, **Then**
   the user's shell starts as a login shell, reading the user's own startup
   files, in the home directory.
2. **Given** a standalone terminal, **When** the user prints its environment,
   **Then** it follows C15 without a cluster: the bundled binaries directory
   last on `PATH`, the user's own `KUBECONFIG`, the application's proxy as
   `HTTPS_PROXY` when set.

---

### User Story 4 - A terminal on a node (Priority: P4)

A user opens a shell on one node of a cluster. The application starts a pod
on that node with the image the cluster's settings name, waits for it, attaches
the terminal to it, and removes the pod when the terminal closes, as in the
Electron build.

**Why this priority**: It is one of the shells the Electron build has, and
"the same shells" includes it. It depends on Story 1's cluster terminal and
is used less often.

**Independent Test**: On a test cluster, open a node terminal, run `hostname`,
close the tab, and list the pods of `kube-system`: the shell ran on the node,
and the pod is gone.

**Acceptance Scenarios**:

1. **Given** an open cluster, **When** the user opens a terminal on one of its
   nodes, **Then** the terminal reports that it creates the pod and waits for
   it, then attaches to a shell on that node.
2. **Given** a node terminal, **When** its tab is closed at any point, before
   the pod runs included, **Then** the pod is removed and no pod of the
   application is left behind.
3. **Given** a node terminal whose pod fails or does not run within two
   minutes, **When** the wait ends, **Then** the terminal shows why, and the
   pod is removed.

---

### User Story 5 - The core answers the terminal's channels (Priority: P5)

A maintainer checks that the core answers each channel of terminal-pty, and
that a terminal opens only with a token the core handed out for it.

**Why this priority**: The channel list is complete only when each of its
channels has an answer, and the renderer's own terminal code sends these two
channels when it runs in the Tauri build. Nothing a user sees depends on it
beyond Stories 1 to 4.

**Independent Test**: Ask the core for a token on each channel, open a
terminal with it, and try to open one again with the same token, with no
token, with a token for another tab, and with one for another cluster: only
the first opens.

**Acceptance Scenarios**:

1. **Given** a view, **When** it asks for a token on either channel of
   terminal-pty, **Then** the core answers with a token that opens the one
   terminal the request names.
2. **Given** a token, **When** it has opened a terminal, or names another tab
   or another cluster, **Then** it opens no other terminal.
3. **Given** the frame of one cluster, **When** it asks for another cluster's
   token or for the standalone token, or opens a terminal with a token handed
   to another view, **Then** the core refuses, and no terminal opens.

---

### Edge Cases

- The shell setting names a shell that does not exist or cannot run: the
  terminal shows an error that names the shell, as in the Electron build, and
  the other terminals are not affected.
- Reading the environment of the user's login shell fails or hangs: the
  terminal starts with the application's own environment, plus the
  application's directories and variables, and shows why, as in the Electron
  build.
- The user changes the shell setting while terminals are open: the open ones
  keep their shell; the next one starts the new shell with that shell's
  environment.
- The view of a terminal is reloaded: the shell keeps running, the terminal
  reconnects to it and shows its last output, as in the Electron build.
- A view stops reading the terminal's data for more than 60 seconds, as when
  the application sits in the background: the shell keeps running, and the
  terminal catches up when the view reads again. What the core keeps for a
  view that does not read is bounded (FR-014).
- A program prints output fast and without end: the output is shown in order,
  the application stays responsive, and Ctrl+C stops it.
- A multi-byte character arrives split across two pieces of output: it is
  shown whole.
- A cluster is disconnected or closed while its terminals run: their shells
  end, as in the Electron build. The standalone terminals are not affected.
- The application quits with terminals open: no shell it started keeps
  running.
- A token is asked for but never used: it opens nothing later for another
  tab, and the core does not keep tokens without bound.
- The user's kubectl is not installed and downloading kubectl is turned off:
  the bundled kubectl is found on `PATH`, as in the Electron build.
- A node of a cluster runs Windows, or runs Bottlerocket OS: the node terminal
  starts the shell the Electron build starts for that node.

## Requirements _(mandatory)_

### Functional Requirements

#### The terminal dock

- **FR-001**: The Tauri build MUST offer the terminal dock on its own pages:
  the catalog page MUST run the dock of standalone terminals, and the frame
  page of a cluster the dock of that cluster's terminals and node terminals,
  with the behaviour of the Electron build's dock that FR-002 to FR-005
  require. The renderer's own dock replaces them in the spec that runs the
  renderer in the Tauri build, on the channels and the data path of this
  feature, without a change of either.
- **FR-002**: A user MUST be able to open, select and close several terminals
  at once, of every kind, for several clusters. The feature sets no upper
  limit; the check uses five.
- **FR-003**: A terminal MUST follow the size of its area: the shell MUST get
  the rows and columns shown, when the terminal opens and after each resize.
  A terminal starts at 80 columns and 30 rows until the view gives its size,
  as in the Electron build.
- **FR-004**: Copy and paste MUST work as in the Electron build: copying a
  selection with the keyboard shortcut, copy on select when its setting is on,
  pasting with the keyboard shortcut, and pasting with the secondary click
  when copy on select is on. The views that show a terminal MUST be granted
  the clipboard for this, and only on the user's action; spec 004 grants a
  cluster frame no browser permission and leaves this grant to this feature
  (FR-026 of `specs/004-cluster-frames/spec.md`).
- **FR-005**: The terminal MUST use the user's terminal font and font size
  settings, and MUST keep the key mappings of the Electron build on macOS.

#### The shell and its environment

- **FR-006**: A terminal MUST start the shell the Electron build starts with
  the same settings: the shell setting, else the user's default shell; with
  the same arguments for zsh, bash and fish, for a cluster and without one; in
  the same working directory.
- **FR-007**: A terminal's environment MUST be the one C15 describes for its
  kind, a cluster or none, computed with the same rules as the Electron build,
  plus the terminal's own variables (`PTYSHELL`, `TERM_PROGRAM`,
  `TERM_PROGRAM_VERSION`, `PTYPID`, and `ZDOTDIR` with the startup files a
  cluster terminal needs). Compared with the Electron build under the same
  settings, it MAY differ only in values that name the application itself:
  its process id, its name and version, the paths of its bundled binaries and
  of the files it writes for a cluster.
- **FR-008**: The base of the environment MUST be that of a login shell of the
  user's shell, as main-shell-env reads it in the core, and the application's
  own environment when it cannot be read, with the reason shown in the
  terminal that waits for it. A terminal MUST reuse the environment already
  read for its cluster, or for none, and its shell, and MUST NOT wait for it
  to be read again; it MUST be read anew for a terminal of a shell not read
  before, as when the shell setting changes.
- **FR-009**: A cluster terminal MUST take its access to the cluster, its
  kubectl and helm and the user's settings from the core areas that give them:
  main-cluster-connection, main-kube-tools and main-foundation. This feature
  MUST NOT add any of them. While the version-matched kubectl is prepared, the
  terminal MUST show the phases, the download progress and any problem, as
  the Electron build's terminal does.
- **FR-010**: A node terminal MUST create, wait for, attach to and remove its
  pod as the Electron build does, with the cluster's node shell image and pull
  secret settings, the same pod for Linux, Bottlerocket and Windows nodes, and
  a wait of at most two minutes. Its pod MUST be removed whenever the terminal
  closes, during the wait included.

#### The terminal's life

- **FR-011**: Closing a terminal's tab MUST end its shell. A shell that exits
  on its own MUST be reported in the terminal with its exit code.
- **FR-012**: A terminal whose view reloads, or stops reading its data, MUST
  keep its shell running, and MUST show the shell's last output once the view
  reads again, as the Electron build does after a reload.
- **FR-013**: Disconnecting or closing a cluster MUST end its terminals'
  shells, and quitting the application MUST end every shell it started.

#### The terminal's data

- **FR-014**: The Tauri build MUST carry each terminal's data between the core
  and the one view that shows it, in order, without loss or duplication while
  the view reads, and to no other view. This is the continuous data path that
  spec 002 left to this feature. What the core holds for a view that does not
  read MUST be bounded; when the bound is reached, the terminal MUST show the
  shell's most recent output when the view reads again, as after a reload.
- **FR-015**: Output MUST be shown as the shell wrote it, with characters
  split across pieces of output shown whole, and the shell MUST receive input
  as typed or pasted, in order.

#### The channels of terminal-pty

- **FR-016**: The core MUST answer `cluster:shell-api` and
  `app:standalone-shell-api` with a single-use token for the terminal the
  request names, and MUST open a terminal only with a valid token for that
  terminal: a token opens one terminal, of the cluster and tab it was given
  for, once. The core MUST hand a cluster's token only to that cluster's
  frame, and the standalone token only to the main window, and MUST open a
  terminal only from the view the token was handed to. Any other request
  MUST be refused. The Electron build keeps answering every view.
- **FR-017**: The token MUST travel as a value the channels of both builds
  carry. The channel list marks it `non-JSON`, which R4 of spec 002 rejects,
  so both builds MUST change its type before the core answers it; the
  Electron build keeps its behaviour otherwise.
- **FR-018**: A token MUST NOT appear in a log, and the core MUST NOT keep
  unused tokens without bound.
- **FR-019**: The channel list MUST say, for each channel of terminal-pty, that
  the core answers it, with its new type, and MUST record any channel this
  feature adds, renames or stops sending, with the columns the list requires.

#### The Electron build and the tests

- **FR-020**: The Electron build MUST keep its behaviour: the same shells,
  environment, terminal dock and channels, except the type of the token
  (FR-017). Its extension API MUST NOT change (Principle III of the
  constitution), C15 included.
- **FR-021**: The Electron build MUST keep building, and MUST pass its unit and
  integration tests (Principle VII of the constitution). An existing test MUST
  NOT be removed or weakened to make it pass.
- **FR-022**: The core's tests MUST cover the environment of each kind of
  terminal against the rules of C15 and FR-007, the arguments of each shell,
  the working directory, the tokens with their refusals, the order and
  completeness of the terminal's data, and the end of a shell on each of the
  events of FR-011 and FR-013.

### Key Entities

- **Terminal**: one tab of the dock. Has a kind (cluster, node, standalone), a
  tab id, the cluster it belongs to when it has one, and its shell while it
  runs. Outlives a reload of its view.
- **Shell**: the process a terminal runs, with its size, its environment and
  its working directory. Ended when its terminal closes, its cluster
  disconnects, or the application quits.
- **Terminal environment**: the variables a shell starts with: the login-shell
  environment of the user, the C15 rules for the terminal's kind, and the
  terminal's own variables.
- **Shell token**: a single-use secret handed to a view for one terminal of
  one cluster, or of none, and spent when that terminal opens.
- **Terminal data**: the shell's output and the view's input and size changes
  for one terminal, in order.
- **Channel of terminal-pty**: one row of the section "terminal-pty (005)" of
  the channel list, with the core's answer.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With the same settings and the same cluster, the environment of
  a cluster terminal and of a standalone terminal in the Tauri build equals
  that of the Electron build in every variable except those FR-007 allows to
  differ, and `kubectl get ns` and `helm list -A` give the same result in
  both.
- **SC-002**: A test of the core shows, for each kind of terminal, every rule
  of C15 for its environment, the shell's arguments for zsh, bash and fish,
  and its working directory (the gate of this feature in the runbook).
- **SC-003**: Five terminals open at once, across two clusters and the
  standalone dock, each keep their own shell and output; closing one ends its
  shell within 2 seconds and leaves the other four running.
- **SC-004**: After a resize, `stty size` in the terminal reports the rows and
  columns shown, within 1 second.
- **SC-005**: Text copied from a terminal, 1 000 lines included, arrives on
  the clipboard unchanged; text pasted into a terminal reaches the shell once
  and unchanged, in each way FR-004 names.
- **SC-006**: 95 % of typed characters are shown back by the shell within
  50 ms on the development machine, and output of 10 MB is shown completely
  and in order in no more than twice the time the Electron build takes on the
  same machine.
- **SC-007**: After the view of a running terminal reloads, or stops reading
  for 2 minutes, the shell is still running, and the terminal shows its last
  output within 2 seconds of reading again.
- **SC-008**: No shell the application started is running 5 seconds after its
  tab closes, its cluster disconnects, or the application quits; and no node
  terminal's pod is left in the cluster after its tab closes.
- **SC-009**: A review of the section "terminal-pty (005)" of the channel list
  finds, for each of its channels, a test of the core that shows its answer,
  and the tests of FR-016 find that no token opens a second terminal, a
  terminal it was not given for, or a terminal from a view it was not handed
  to, and that no view gets a token of a cluster other than its own.
- **SC-010**: The Electron build builds, and its unit and integration tests
  pass, with no existing test removed or weakened. A manual check of the
  Electron build, on the branch and on `main` as a control, shows the same
  result for opening, resizing, copying, pasting and closing terminals of
  each kind.

## Assumptions

- The behaviour to match is that of the Electron build's main side
  (`packages/core/src/main/shell-session/` and the shell token authenticator
  of `freelens-proxy`) and of its terminal dock, on macOS. What the Electron
  build does only on Windows or Linux has no counterpart: the Tauri build
  runs on macOS on Apple Silicon only (Principle VII of the constitution).
- The Tauri build has no extension system, so no extension's
  `terminalShellEnvModifier` changes a terminal's environment, and C15's
  `Main.Shell` functions have no caller there. The environment rules of C15
  still apply, because the terminal follows them.
- The user's settings come from main-foundation, which reads the files the
  Electron build writes; this feature does not change them.
- The docks of the catalog page and the frame page are the Tauri build's own
  until the renderer runs there; what they must match is the behaviour of the
  Electron build's dock, not its code.
- The isolation of spec 004 still holds: the clipboard grant of FR-004 is
  for the pages that show a terminal, and the tokens of FR-016 are tied to
  the view, so a cluster's frame opens no terminal of another cluster.
- The application ships the same pinned kubectl and helm in both builds
  (Principle VI of the constitution); a version-matched kubectl is verified
  against the same pins before it runs.
- The shell's input and output are the user's data: the core does not log
  them, as the Electron build does not.
- In the Electron build, the keyboard shortcuts for copy and paste come from
  the Edit menu of the application menu, which spec 006 ports. FR-004 holds in
  the Tauri build at the end of this feature whether or not spec 006 has
  ported that menu.
- Sending a command into a terminal from elsewhere in the user interface, such
  as the shell of a pod, is part of the renderer's own views, and comes to
  the Tauri build with them.
- The bound on what the core holds for a view that does not read (FR-014) is
  set by the plan, high enough that a view reading normally never reaches it.
- The latency and throughput targets of SC-006 are measured on the
  development machine of `specs/baseline.md`, with the Electron build as the
  control.
- Depends on the channels and the sender of a request of
  `specs/002-messaging-for-tauri`, on the views and origins of
  `specs/004-cluster-frames`, and, in the order of R9 of
  `specs/001-tauri-shell-spike/research.md`, on main-foundation (the
  settings), main-cluster-connection (the access to a cluster through the
  application, and its disconnect), main-kube-tools (the kubectl and helm a
  terminal runs, and the version-matched kubectl) and main-shell-env (the
  login-shell environment). The plan starts once those four are ported.
