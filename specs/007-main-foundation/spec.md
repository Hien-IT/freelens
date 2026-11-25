# Feature Specification: Main Foundation

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "In the macOS build, the settings, hotbar, favorites and the other stores the Electron build keeps work as in the Electron build, read from and written to the same files. Success: every channel of this area in the list from specs/002-messaging-for-tauri is answered by the new core; the behaviour checked by the existing tests of this area holds; startup is no slower than the 2.37 s of specs/baseline.md."

In this specification:

- **The Electron build** is the Freelens desktop application as it is built and
  shipped today; **the Tauri build** is the build on the new shell, for macOS,
  whose main side is **the core**. "The macOS build" of the input is the Tauri
  build.
- **A view** is a page of the user interface: the main window, or the frame of
  one open cluster (`specs/004-cluster-frames/spec.md`).
- **The data directory** is the directory where the Electron build keeps its
  files: `Freelens` under the user's application support directory for a
  packaged build, `FreelensDev` for a development build, or the directory an
  integration test names.
- **A store** is one of the files the Electron build keeps in the data
  directory and shares between its main side and its views: `lens-user-store`
  (the settings), `lens-hotbar-store` (the hotbars), `freelens-favorites-store`
  (the favorites), `lens-cluster-store` (the clusters added to the catalog) and
  `lens-weblink-store` (the web links). **The model** of a store is the content
  its views see and send.
- **The local storage files** are the files the Electron build keeps under
  `lens-local-storage/` in the data directory, one for the main window and one
  per cluster, holding what a view stores across runs
  (`specs/003-renderer-without-node/spec.md`).
- **The templates folder** is `~/.freelens/templates`, whose files the views
  offer as templates for new resources.
- **The channel list** is
  `specs/002-messaging-for-tauri/contracts/channel-list.md`. **The channels of
  main-foundation** are the rows of its section "renderer-without-node (003)
  and main-foundation" whose owner is main-foundation: `app-paths`,
  `machine-values`, `persistent-storage-initial-values`,
  `lens-local-storage:read`, `lens-local-storage:write`, `validate-directory`,
  `path-exists`, `initial-user-resource-templates`,
  `user-resource-templates-update`, `store-sync-main:<conf path>`,
  `store-sync-renderer:<conf path>`, `build-version`, `download-json-channel`,
  `sync-box-channel` and `sync-box-initial-value-channel`.
- **The existing tests of this area** are the unit tests of the Electron build
  under the directories R9 of `specs/001-tauri-shell-spike/research.md` gives
  main-foundation, and those of the injectables the channel list names for
  its channels.

## Clarifications

### Session 2026-11-25

- Q: What must happen when the Electron build and the Tauri build run at the same time on the same data directory? → A: The build started second does not start, and says that the other build is running on that data directory. This holds in both directions, so the Electron build gets a check of its own; it is the one change of FR-020 to the Electron build's behaviour. Builds on different data directories are not affected.
- Q: Does this feature port the building blocks R9 gives main-foundation that no channel or store of it uses (starting processes, the command-line arguments, the system proxy lookup, the hardware acceleration flag, random identifiers)? → A: No. Each comes to the core with the first area that uses it; what only the extension API uses is not ported. This feature ports the stores, the channels of main-foundation and the log.

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the users who move between the Electron
build and the Tauri build, who must find their settings, hotbars, favorites
and clusters in both, and the maintainers of the port, whose later areas read
the settings and the stores from the core. Users of the Electron build see no
change.

### User Story 1 - The same settings and stores in both builds (Priority: P1)

A user of the Electron build starts the Tauri build on the same machine. The
Tauri build reads the settings, hotbars, favorites, clusters and web links the
Electron build wrote, from the same files. What the user changes in the Tauri
build is written back to the same files in the same format, and the Electron
build finds it at its next start.

**Why this priority**: The input names it, and the port cannot replace the
Electron build if a user loses their setup on the way. Every later area reads
the settings from here.

**Independent Test**: Take a data directory written by the Electron build with
non-default settings, several hotbars, favorites, clusters and web links.
Start the Tauri build on it, ask the core for every store over the channels,
change one value in each store from a view, quit, and start the Electron
build on the same directory. The Tauri build reports every value the Electron
build wrote; the Electron build shows every change and nothing else changed.

**Acceptance Scenarios**:

1. **Given** a data directory written by the Electron build, **When** the Tauri
   build starts, **Then** each view gets, for each store, the model the
   Electron build's main side would give it for the same file.
2. **Given** a running Tauri build, **When** a view sends a changed model of a
   store, **Then** the core writes it to the store's file in the format the
   Electron build writes, and every other view gets the change.
3. **Given** a store's file changed by the Tauri build, **When** the Electron
   build starts on it, **Then** it loads it without a reset, a backup of a
   corrupt file or a migration it would not otherwise run.
4. **Given** a store's file that holds keys the Tauri build does not know,
   **When** the Tauri build writes the store, **Then** those keys are kept as
   they were.
5. **Given** a data directory with no store files, **When** the Tauri build
   starts, **Then** each view gets the defaults the Electron build starts
   with, and the files the Tauri build writes are those the Electron build
   would write.

---

### User Story 2 - A broken or newer file does not cost the user's setup (Priority: P2)

A store's file may be damaged, or may have been written by a newer Electron
build. The Tauri build handles both as the Electron build does, or more
safely, and never leaves a file that the Electron build cannot read.

**Why this priority**: Both builds run on the same files, often of different
versions, for as long as the port lasts. Losing a user's setup to a bad file
is worse than any missing feature. It depends on Story 1.

**Independent Test**: Start the Tauri build once with a store's file that is
not valid JSON, and once with a file whose recorded version is newer than any
the Tauri build knows. In the first case, a copy of the damaged file is kept
next to it and the store starts from the defaults; in the second, the file's
recorded version and unknown content are unchanged after the Tauri build
writes it.

**Acceptance Scenarios**:

1. **Given** a store's file that is not valid JSON, **When** the Tauri build
   starts, **Then** it copies the file aside under the name the Electron build
   uses for such a copy, logs it, and starts that store from its defaults;
   the other stores load as usual.
2. **Given** a store's file that cannot be copied aside, **When** the Tauri
   build starts, **Then** the file is not cleared, as in the Electron build.
3. **Given** a store's file written by a newer build, with a recorded version
   the Tauri build does not know, **When** the Tauri build writes the store,
   **Then** the recorded version stays as it was, and the content the Tauri
   build does not know is kept.
4. **Given** a write that is interrupted, as by a crash or a full disk,
   **When** either build starts next, **Then** it finds the store's file as it
   was before the write or after it, never a part of it.

---

### User Story 3 - The core answers every channel of main-foundation (Priority: P3)

The views ask the core for the paths of the application, the values of the
machine, the stores, the local storage files, the templates, a directory
check and a JSON download, as they ask the Electron build's main side. Each of
these channels is answered by the core with the answer the Electron build
gives.

**Why this priority**: The renderer reads these values before a view starts
(`specs/003-renderer-without-node/spec.md`), so the renderer cannot run in the
Tauri build without them, and the channel list is complete only when each of
them has an answer. Nothing a user sees in the Tauri build of this feature
depends on it beyond Stories 1 and 2.

**Independent Test**: From a view, send each channel of main-foundation with
the same input to both builds and compare the answers. They are equal, except
where FR-012 allows a difference.

**Acceptance Scenarios**:

1. **Given** a view, **When** it asks for the paths of the application, **Then**
   the core answers every name the Electron build answers, each with the
   Electron build's path.
2. **Given** a view, **When** it reads or writes the local storage file of the
   main window or of a cluster in the catalog, **Then** the core reads or
   writes the file the Electron build uses; for a cluster the catalog does not
   have, the core refuses.
3. **Given** a templates folder with template files, **When** a view asks for
   the templates and a file is added, changed or removed later, **Then** the
   view gets the templates, and then every change, as in the Electron build.
4. **Given** a path the user typed, `~` included, **When** a view asks whether
   it exists or is a directory, **Then** the core answers as the Electron
   build does, and reads nothing of the path's contents.
5. **Given** a URL, **When** a view asks the core to download it as JSON,
   **Then** the core fetches it with the user's proxy and certificate
   settings, and answers with the JSON or the error, as the Electron build
   does.

---

### User Story 4 - The Tauri build starts as fast as the Electron build (Priority: P4)

Loading the stores at startup does not make the Tauri build slower to start
than the Electron build of `specs/baseline.md`.

**Why this priority**: The input names it, and the port was started for its
size, memory and speed. It is measured once the other stories work.

**Independent Test**: Measure the startup of the Tauri build as
`specs/baseline.md` measures it, three times, with a data directory that holds
the five stores of Story 1.

**Acceptance Scenarios**:

1. **Given** a data directory with the five stores, **When** the Tauri build
   is started three times, **Then** the median startup time is at most
   2.37 s.

---

### Edge Cases

- The user starts one build while the other runs on the same data directory:
  the build started second does not start, and says that the other build is
  running (FR-023). A build that ended without cleaning up, as in a crash,
  does not stop the other from starting.
- The two builds run on different data directories, such as a development
  build next to a packaged one: both start.
- A store's file is missing: the store starts from the defaults, as in the
  Electron build. A file that exists but cannot be read, for a permission or
  an I/O error, is kept as it is and logged, and the store runs from its
  defaults for the run without writing the file; the Electron build fails to
  start instead, and keeping the file is the safer of the two (User Story 2).
  A write that fails is logged, and the model is still sent to the views, as
  in the Electron build.
- A view sends a model of a store that is not an object, or names a store the
  core does not keep: the core ignores it and logs it, and writes nothing.
- Two views send changes to the same store at the same time: the core applies
  them in the order it receives them, every view ends with the same model,
  and the file holds that model.
- The settings name a proxy that cannot be reached, or allow untrusted
  certificates: a JSON download fails with the reason, or succeeds without
  checking the certificate, as in the Electron build.
- The templates folder does not exist, or is created or removed while the
  Tauri build runs: the views get an empty list, then the templates once it
  appears, as in the Electron build.
- A view asks for the local storage of a cluster removed from the catalog
  while it runs: the core refuses, as for any cluster it does not have.
- The data directory is on a read-only volume: the Tauri build cannot write
  its lock, logs it, and still refuses to start while the Electron build
  runs there (FR-023); otherwise the stores load, each write fails and is
  logged, and the views keep the model they were sent for the run, as in the
  Electron build.
- The Electron build's extension stores (`installed-extensions`,
  `lens-extensions`, `lens-filesystem-provisioner-store`) are in the data
  directory: the Tauri build neither reads nor writes them.

## Requirements _(mandatory)_

### Functional Requirements

#### The data directory and the stores

- **FR-001**: The Tauri build MUST use the data directory of the Electron build:
  the one of a packaged build for a release build, the one of a development
  build for a development build, and the one an integration test names
  through the same means as the Electron build. It MUST also accept a data
  directory given at launch, for measurements and tests.
- **FR-023**: Only one build MUST run at a time on a data directory: a build,
  Electron or Tauri, started while the other runs on the same data directory
  MUST NOT start, MUST NOT write any file of it, and MUST tell the user that
  the other build is running. A build that is no longer running MUST NOT
  stop the other from starting. Starting the Electron build while the
  Electron build runs MUST behave as before.
- **FR-002**: The core MUST keep the five stores: load each from its file in
  the data directory at startup, before any view asks for it, and give each
  view, on `persistent-storage-initial-values`, the model of each store the
  Electron build's main side gives for the same file.
- **FR-003**: The model of each store MUST be the one the Electron build's
  main side builds from the file: the defaults of a missing value, the
  normalization of a value the Electron build normalizes, and the values the
  Electron build drops. For `lens-cluster-store` and `lens-weblink-store` this
  feature builds the model as the Electron build's main side builds it from
  the file, and nothing more: what that side does with the clusters and the
  web links, such as connecting a cluster or syncing a kubeconfig file, comes
  with main-cluster-connection and main-catalog, the areas R9 gives them to.
- **FR-004**: The core MUST listen on `store-sync-main:<conf path>` for each
  store, write each model a view sends to the store's file, and send it to
  every other view on `store-sync-renderer:<conf path>`, as the Electron
  build's main side does. A change the core makes to a store itself MUST
  reach the file and every view in the same way.
- **FR-005**: The core MUST write a store's file in the format the Electron
  build writes: the same keys, the same JSON encoding, the same recorded
  version, and every key of the file the core does not know kept as it was.
  A file the core writes MUST load in the Electron build without a reset, a
  backup of a corrupt file or a migration.
- **FR-006**: A write MUST replace the file whole or not at all: an
  interrupted write MUST leave the file as it was before the write or after
  it.
- **FR-007**: A store's file that is not valid JSON MUST be copied aside under
  the name the Electron build uses for such a copy, logged, and replaced by
  the defaults, as in the Electron build; a file that cannot be copied aside
  MUST NOT be cleared. Another store MUST NOT be affected.
- **FR-008**: The core MUST run the migrations the Electron build runs on a
  store's file, and MUST NOT lower the version a file records: a file written
  by a newer build MUST keep its recorded version and the content the core
  does not know.
- **FR-009**: The core MUST NOT read or write the Electron build's extension
  stores, and MUST NOT change any other file of the data directory but the
  stores, the local storage files, its own log and what FR-023 needs to know
  which build runs.
- **FR-010**: The core MUST make the settings, as the model of FR-003 gives
  them, available to its later areas, following every change of the user
  store while it runs, so that a later area reads a setting as it is now.
  The Tauri build MUST NOT change the
  operating system's login items in this feature, whatever the "open at
  login" setting says: the Electron build registers itself, and two builds
  registered would both start at login.

#### The other channels of main-foundation

- **FR-011**: The core MUST answer `app-paths` with every name the Electron
  build answers, each with the path the Electron build gives for it.
- **FR-012**: The core MUST answer `machine-values` with the values the
  Electron build gives: the platform, the debugging flag read from the same
  variable, the packaging flags, the home directory (the integration-testing
  one included), the kube directory, and the path of the bundled helm. The
  paths that name the application itself, such as its executable and its
  bundled helm, MAY differ from the Electron build's.
- **FR-013**: The core MUST answer `lens-local-storage:read` and
  `lens-local-storage:write` with the file the Electron build uses, for the
  main window and for each cluster of the catalog, and MUST refuse a cluster
  the catalog does not have. A missing file MUST read as an empty object.
- **FR-014**: The core MUST answer `validate-directory` and `path-exists` as the
  Electron build does, resolving `~` to the home directory where the Electron
  build resolves it (a path of `~` or `~/` alone, not `~/foo`), and MUST read
  only the kind of the path, never its contents.
- **FR-015**: The core MUST answer `initial-user-resource-templates` with the
  templates of the templates folder, and from the first request on MUST send
  `user-resource-templates-update` on every change of the folder, with the
  files and the grouping the Electron build uses.
- **FR-016**: The core MUST answer `download-json-channel` as the Electron build
  does: a GET of the URL through the proxy of the settings, checking the
  certificate against the authorities the Electron build trusts unless the
  settings allow untrusted ones, with the timeout the request names, answering with the
  parsed JSON or with the error the Electron build gives for the same
  failure. A JSON download MUST NOT carry a credential of a kubeconfig file.
- **FR-017**: The core MUST answer `sync-box-initial-value-channel` with an
  empty list, and MUST listen on `sync-box-channel`, which carries nothing
  today, as the Electron build does. `build-version` stays answered as spec
  002 made it.
- **FR-018**: Each channel of main-foundation MUST be answered by the core, and
  the channel list MUST say so, with any channel this feature adds, renames or
  stops sending, in the columns the list requires.

#### The log

- **FR-019**: The core MUST write its log in the Electron build's log
  directory, in a file of its own, with the levels and the rotation of the
  Electron build's log, so that a user who sends their logs sends those of
  both builds, and neither build writes into the other's file.

#### The Electron build and the tests

- **FR-020**: The Electron build MUST keep its behaviour, its files and its
  channels, except that it does not start while the Tauri build runs on the
  same data directory (FR-023). Its extension API MUST NOT change (Principle
  III of the constitution).
- **FR-021**: The Electron build MUST keep building, and MUST pass its unit and
  integration tests (Principle VII of the constitution). An existing test MUST
  NOT be removed or weakened to make it pass.
- **FR-022**: The behaviour that the existing tests of this area check MUST
  hold in the core, shown by tests of the core that check the same
  behaviour: the loading, defaults, normalization, writing, sync and corrupt
  files of the stores, and the answer of each channel of main-foundation.

### Key Entities

- **Data directory**: where both builds keep their files; the same for both.
- **Store**: one of the five files and its model; loaded at startup, written
  on every change, shared with every view.
- **Model**: the content of a store as the views see and send it; built from
  the file by the Electron build's rules.
- **Recorded version**: the version a store's file says its content has been
  migrated to; never lowered by the Tauri build.
- **Local storage file**: what one view keeps across runs, for the main window
  or for one cluster.
- **Template**: a file of the templates folder offered as a template for a new
  resource, grouped as the Electron build groups them.
- **Channel of main-foundation**: one row of the channel list owned by
  main-foundation, with the core's answer.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With a data directory written by the Electron build, the model of
  each of the five stores that the Tauri build gives a view equals, value for
  value, the one the Electron build's main side gives for the same files.
- **SC-002**: After a change of one value in each store from a view of the
  Tauri build, the Electron build started on the same data directory shows
  each changed value and loads every file without a reset or a backup; a
  comparison of the files before and after finds no other change.
- **SC-003**: A store's file that is not valid JSON is kept as a copy next to
  it and the Tauri build starts; a file with a newer recorded version keeps
  that version and its unknown content after the Tauri build writes it; a
  write stopped part way leaves a file that loads.
- **SC-004**: A review of the channels of main-foundation in the channel list
  finds, for each, a test of the core that shows its answer, and the same
  input gives the same answer in both builds, apart from the paths FR-012
  allows to differ.
- **SC-005**: Each behaviour the existing tests of this area check has a test of
  the core that checks the same behaviour, and the tests of the core pass.
- **SC-006**: With a data directory holding the five stores, the median of
  three startups of the Tauri build, measured as in `specs/baseline.md`, is
  at most 2.37 s.
- **SC-007**: The Electron build builds, and its unit and integration tests
  pass, with no existing test removed or weakened.
- **SC-008**: Starting either build while the other runs on the same data
  directory leaves the running one untouched, writes no file, and shows the
  user why within 5 seconds; after the running build quits, or is killed,
  the other starts.

## Assumptions

- The behaviour to match is that of the Electron build's main side on macOS:
  the stores of `features/persistent-storage`, `features/user-preferences`,
  `features/favorites` and `features/hotbar/storage`, the channel listeners
  the channel list names, and the logger. What the Electron build does only on
  Windows or Linux, such as the packaging flags of Snap and Flatpak, keeps the
  value it has on macOS.
- The renderer does not run in the Tauri build at the end of this feature
  (`specs/004-cluster-frames/spec.md`), so no user interface of the Tauri
  build shows the settings, hotbars or favorites yet. The stories are shown
  through the channels, from a view, and by the tests of the core; the
  renderer's own views use the same channels once they run in the Tauri build.
- The other building blocks R9 gives main-foundation, which no channel or
  store of this feature uses (starting processes, the command-line arguments,
  the system proxy lookup the extension API alone asks for, the hardware
  acceleration flag, random identifiers), have no behaviour a user or a view
  sees on their own. Each comes to the core with the first area that uses it,
  such as the command-line arguments with spec 006, or has no counterpart in
  the Tauri build (Clarifications).
- The Electron build records the same version, `0.1.0`, in each of the five
  stores, and declares no migration for them today; FR-008 covers the
  migrations a later Electron build adds.
- The settings are read and written by the Tauri build only as FR-003 to FR-005
  and FR-010 allow. No later area writes a store's file except through this
  feature.
- The startup of `specs/baseline.md` is measured from the creation of the
  process to the main window having loaded, median of three runs, on the
  development machine. A data directory with the five stores is the condition
  this feature adds; the baseline itself used an empty one.
- Depends on the channels and the sender of a request of
  `specs/002-messaging-for-tauri`, on the views of `specs/004-cluster-frames`,
  and on the catalog the core already reads, which tells it which clusters
  exist for FR-013 until main-catalog takes that over.
