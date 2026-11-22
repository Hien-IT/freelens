# Feature Specification: Experimental Shell Spike

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-22

**Status**: Draft

**Input**: User description: "Freelens needs an experimental macOS build on a different desktop shell, with its core written from scratch, that runs side by side with the current Electron build, to prove that the port meets its size and memory goals before the full port starts. A user can launch it, see the catalog of clusters from a kubeconfig file, and open one cluster in its own frame showing its namespaces. Success, measured as in specs/baseline.md: installer at most 85 MB, idle memory at most 394 MB RSS, startup no slower than 2.37 s. Out of scope: terminal, auto-update, tray, extensions, Windows and Linux. The Electron build keeps building and passing its tests."

In this specification, **the current build** is the Freelens desktop application
as it is built and shipped today, and **the experimental build** is the new
build this feature creates. The baseline figures of the current build, and how
they were measured, are in `specs/baseline.md`.

## Clarifications

### Session 2026-11-22

- Q: When measuring idle memory, do the processes the operating system starts on the experimental build's behalf to render its views, handle its network traffic and draw its graphics count, although they are not its child processes? → A: Yes. Every process that runs for the application counts, measured as resident memory like the baseline.
- Q: When the user launches the experimental build normally, without choosing a kubeconfig file, what does the catalog show? → A: The clusters of the user's default kubeconfig file, unless a launch option chooses another file or none; measurement runs choose none.
- Q: Besides idle memory with no cluster, does the spike also measure memory and the time until the namespace list appears with the reference cluster open, on both builds? → A: Yes, recorded for both builds in the go/no-go report, as information without a pass or fail threshold.
- Q: Do the credentials from the kubeconfig file (certificates, tokens) reach the views that display pages, or does only the core of the application hold them? → A: Only the core holds them; views never receive them, and every request to a cluster goes through the core.
- Q: When a cluster view is open and a namespace is created or deleted, does the list in the view have to update by itself? → A: No. The list is loaded once when the view opens; closing the view and opening it again loads it again.

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Measure the experimental build against the baseline (Priority: P1)

A maintainer installs the experimental build, launches it with no clusters
configured, and measures its installer size, its memory while idle and its
startup time exactly as the current build was measured. The figures decide
whether the full port goes ahead or stops.

**Why this priority**: The go/no-go decision is the reason the spike exists. It
needs only an experimental build that installs and opens its main window.

**Independent Test**: Build the installer, run the measurement procedure of
`specs/baseline.md` three times against it, and compare the medians with the
baseline row for macOS arm64.

**Acceptance Scenarios**:

1. **Given** the installer of the experimental build, **When** the maintainer
   measures its size, **Then** the size is recorded in MB (10^6 bytes) next to
   the 211.8 MB of the current build.
2. **Given** the experimental build launched with a fresh data location and the
   launch option that chooses no kubeconfig file, **When** its main window has
   loaded and 60 seconds have passed, **Then** the total resident memory of all
   processes that run for it, including those the operating system starts on
   its behalf, is recorded next to the 788 MB of the current build.
3. **Given** the same launch conditions, **When** the maintainer measures the
   time from launching the process to the main window having loaded, three
   times, **Then** the median is recorded next to the 2.37 s of the current
   build.
4. **Given** the current build is installed and running, **When** the
   maintainer installs, runs and then removes the experimental build, **Then**
   the current build keeps running, and its installation, settings and data are
   unchanged.
5. **Given** the reference cluster, **When** the maintainer opens it in each
   build with the same steps, three times, **Then** the time from opening it to
   its namespace list appearing, and the total resident memory 60 seconds
   later, are recorded for both builds, with no threshold.

---

### User Story 2 - See the catalog of clusters from a kubeconfig file (Priority: P2)

A user launches the experimental build with a kubeconfig file and sees every
cluster that file defines in the catalog, by name.

**Why this priority**: Reading a kubeconfig file and showing a catalog is the
first piece of real work the new core does; it shows the core can serve the
existing views. It is not needed for the measurements of User Story 1.

**Independent Test**: Launch the experimental build with a kubeconfig file that
defines three contexts and check that the catalog lists exactly those three.

**Acceptance Scenarios**:

1. **Given** a kubeconfig file with several contexts, **When** the user
   launches the experimental build with that file, **Then** the catalog lists
   one cluster per context, under the context's name.
2. **Given** no launch option, **When** the user launches the experimental
   build from the Finder, **Then** the catalog lists the contexts of the user's
   default kubeconfig file.
3. **Given** the launch option that chooses no kubeconfig file, **When** the
   user launches the experimental build, **Then** the catalog is empty and no
   kubeconfig file is read.
4. **Given** a kubeconfig file that cannot be parsed, **When** the user
   launches the experimental build with it, **Then** a message names the file
   and the problem, and the application stays usable.

---

### User Story 3 - Open a cluster in its own view and see its namespaces (Priority: P3)

From the catalog, a user opens one cluster. It opens in a view of its own,
separate from the main window, which lists the cluster's namespaces.

**Why this priority**: Each cluster in its own isolated view is how the current
build keeps clusters apart. The full port depends on that working in the new
shell, so the spike has to prove it. It builds on User Story 2.

**Independent Test**: Open the reference cluster from the catalog and compare
the namespaces shown with the namespaces the cluster reports for the same
context.

**Acceptance Scenarios**:

1. **Given** the catalog lists the reference cluster, **When** the user opens
   it, **Then** a view for that cluster opens and lists exactly the namespaces
   the cluster has.
2. **Given** a cluster view is open, **When** content in that view tries to
   read the data or the page of the main window, **Then** the attempt fails.
3. **Given** a cluster that cannot be reached, **When** the user opens it,
   **Then** its view shows an error that says the cluster cannot be reached,
   and the catalog stays usable.
4. **Given** a cluster view is open, **When** the user opens the same cluster
   again from the catalog, **Then** the existing view is shown rather than a
   second one.
5. **Given** a cluster view lists the namespaces of the reference cluster,
   **When** everything the view has received is inspected, **Then** no
   certificate, key or token from the kubeconfig file appears in it.

---

### Edge Cases

- The chosen kubeconfig file does not exist: the catalog is empty and a message
  names the missing file.
- No launch option is given and the user has no default kubeconfig file: the
  catalog is empty, with no error.
- The kubeconfig file has no contexts: the catalog is empty, with no error.
- The credentials of the user do not allow listing namespaces: the cluster view
  says that the permission is missing instead of showing an empty list.
- The connection to a cluster drops while its view is open: the open view
  keeps the list it loaded; closing it and opening the cluster again shows that
  the cluster cannot be reached, until the connection returns.
- The current build is running at the same moment as the experimental build:
  both keep working, and neither reads or writes the other's settings or data.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The experimental build MUST install and run on macOS on Apple
  Silicon as an application of its own, with a name and identity distinct from
  the current build.
- **FR-002**: The experimental build MUST keep its settings and data in its own
  location. Installing, running or removing it MUST NOT change the
  installation, the settings or the data of the current build, and both MUST be
  able to run at the same time.
- **FR-003**: Launched without a launch option, the experimental build MUST
  read the user's default kubeconfig file. A launch option MUST let the person
  launching it choose another kubeconfig file instead, or none.
- **FR-004**: The experimental build MUST NOT read any kubeconfig file other
  than the one in effect: the default one, the chosen one, or none.
- **FR-005**: The catalog MUST list one cluster per context of the kubeconfig
  file in effect, under the context's name.
- **FR-006**: Opening a cluster from the catalog MUST show it in a view of its
  own that lists the cluster's namespaces as they are when the view opens. The
  list does not have to update while the view stays open; closing the view and
  opening it again MUST load the list again.
- **FR-007**: Each cluster view MUST be isolated from the main window and from
  the view of any other cluster: content in one MUST NOT be able to read the
  data or the page of another.
- **FR-008**: A kubeconfig file that is missing or cannot be parsed, a cluster
  that cannot be reached, and a missing permission to list namespaces MUST each
  produce a message that says what failed, without making the rest of the
  application unusable.
- **FR-009**: The core of the experimental build MUST be new code. The
  experimental build MUST NOT include or start the core of the current build,
  nor the runtime that core needs.
- **FR-010**: The experimental build MUST record in its log the moment its main
  window has finished loading, so that its startup is measured the same way as
  the current build's.
- **FR-011**: A measurement procedure MUST produce the installer size, the idle
  memory and the startup time of the experimental build under the conditions of
  `specs/baseline.md`, and the results MUST be recorded next to the baseline.
  For both builds, it MUST also record, with the reference cluster opened by
  the same steps, the time from opening the cluster to its namespace list
  appearing and the total resident memory 60 seconds after that, medians of
  three runs. Memory counts every process that runs for the application,
  helper programs included, as in SC-002. These figures have no threshold.
- **FR-012**: Every helper program the experimental build ships or downloads
  MUST be verified against the digests pinned in the repository before it is
  used, as the current build does.
- **FR-013**: Which helper programs the installer bundles, and which the
  application downloads on first use instead, MUST be decided in planning, from
  the size each one adds to the installer. The installer measured for SC-001
  MUST contain every helper program decided as bundled, and the measurement
  report MUST list which helper programs are bundled and which are downloaded.
- **FR-014**: The current build MUST keep building and passing its tests, and
  its behaviour MUST NOT change because of this feature.
- **FR-015**: The credentials of the kubeconfig file (certificates, keys and
  tokens) MUST stay in the core of the experimental build. Views MUST NOT
  receive them, and every request a view makes to a cluster MUST go through
  the core.

### Key Entities

- **Kubeconfig file**: A file that defines clusters, users and contexts. The
  experimental build reads at most one: the user's default one, or the one a
  launch option chooses.
- **Cluster**: One context of the kubeconfig file, shown in the catalog by its
  name.
- **Cluster view**: The view that opens when a cluster is opened, isolated from
  the main window and from other cluster views.
- **Namespace**: A namespace of the opened cluster, shown by name in the cluster
  view.
- **Measurement run**: One launch of a build under the baseline conditions,
  producing a startup time and an idle memory figure, or, with the reference
  cluster open, the time to its namespace list and a memory figure.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: The installer of the experimental build is at most 85 MB (10^6
  bytes), about 60% smaller than the 211.8 MB of the current build.
- **SC-002**: 60 seconds after its main window has loaded, with a fresh data
  location and the launch option that chooses no kubeconfig file, the total
  resident memory of all processes that run for the experimental build is at
  most 394 MB, median of three runs, half of the 788 MB of the current build.
  The total includes the processes the operating system starts on its behalf
  to render its views, handle its network traffic and draw its graphics,
  although they are not its child processes, and excludes those it runs for
  other applications.
- **SC-003**: The time from launching the experimental build to its main window
  having loaded is at most 2.37 s, median of three runs.
- **SC-004**: With the reference cluster, the cluster view lists exactly the
  namespaces the cluster has, same names and same count, in each of three
  attempts.
- **SC-005**: In a check that tries it, content in a cluster view fails to read
  the data or the page of the main window and of another cluster view, in every
  attempt.
- **SC-006**: The settings and data of the current build are identical before
  installing the experimental build and after running and removing it.
- **SC-007**: The current build builds and passes its unit and integration
  tests with the changes of this feature, with no test failing that passes
  without them.
- **SC-008**: A go or no-go decision is recorded together with the three
  figures of SC-001 to SC-003, the baseline figures they are compared with, the
  figures of both builds with the reference cluster open, and the idle memory
  of SC-002 plus an estimate of the memory the full interface adds. If that sum
  exceeds 394 MB, the decision is no-go unless the record states why the
  estimate does not apply.
- **SC-009**: With the reference cluster open, none of its certificates, keys
  or tokens appears in anything a view has received, in a check of every
  response and message the view got.

## Assumptions

- The users of the experimental build are the maintainers of this fork. It is
  distributed internally, signed without a developer identity and not
  notarized, so each user allows it once in the macOS security settings.
- Measurements run on the machine and under the conditions recorded in
  `specs/baseline.md`. Measuring on another machine means measuring the current
  build there too.
- The reference cluster is a local test cluster created as in section 0.4 of
  `specs/tauri-port-runbook.md`.
- Credentials stored in the kubeconfig file, such as client certificates and
  tokens, are enough for the spike. Clusters whose credentials need an external
  command may show an error instead of opening.
- The user's default kubeconfig file is the one at the standard location in
  the home directory. A list of several kubeconfig files is not merged.
- The kubeconfig file is read at launch; changes to it while the application
  runs are not picked up.
- The views of the experimental build may look different from those of the
  current build; visual parity is not a goal of the spike.
- The experimental build shares no settings, catalog or data with the current
  build.
- Out of scope: the terminal, auto-update, the tray, extensions, Windows and
  Linux, every view other than the catalog and the namespace list, and
  updating the namespace list while its view stays open.
- If the spike misses SC-001, SC-002 or SC-003, or a cluster view on its own
  host does not load or is not isolated (SC-005), the full port stops, and the
  experimental build may be discarded.
