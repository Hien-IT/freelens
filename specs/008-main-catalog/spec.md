# Feature Specification: Main Catalog

**Feature Branch**: `spec/tauri-port`

**Created**: 2026-11-25

**Status**: Draft

**Input**: User description: "In the macOS build, the catalog of clusters and web links, filled from the kubeconfig files the user syncs and kept current when those files change, works as in the Electron build. Success: every channel of this area in the list from specs/002-messaging-for-tauri is answered by the new core; the behaviour checked by the existing tests of this area holds; a change to a synced kubeconfig file reaches the catalog no later than in the Electron build, and startup is no slower than the 2.37 s of specs/baseline.md."

In this specification:

- **The Electron build**, **the Tauri build**, **the core**, **a view** and
  **the data directory** are as in `specs/007-main-foundation/spec.md`. "The
  macOS build" of the input is the Tauri build.
- **The settings** and **the stores** are those of spec 007; the catalog reads
  the settings and the stores the core keeps since that feature, and writes a
  store only through them.
- **The catalog** is the list of entities the Electron build's main side keeps
  and sends to every view on `catalog:items`: a cluster for each context of the
  synced kubeconfig files, a web link for each entry of the web link store
  (`lens-weblink-store`), and the general entities, the Welcome, Catalog,
  Preferences and Terminal pages.
- **A sync** is a file or a folder whose kubeconfig contexts the catalog shows:
  each entry of the kubeconfig sync setting of the user store
  (`syncKubeconfigEntries`), and always **the application's kubeconfig
  directory**, `kubeconfigs` in the data directory, where the Electron build
  writes the kubeconfig text a user pastes. **A synced file** is the file of a
  file sync, or a file directly in the folder of a folder sync.
- **The cluster id** is the id the Electron build gives the cluster of a
  context: the MD5 of `<synced file path>:<context name>`. The stores, the
  hotbars, the local storage files and the cluster frames all name a cluster by
  it.
- **The large catalog** is 500 generated contexts in two syncs: a file sync of
  one file with 250 contexts, and a folder sync of a folder with 25 files of
  10 contexts each. It stands for a large catalog in Story 5, SC-006 and
  SC-007.
- **The channel list** is
  `specs/002-messaging-for-tauri/contracts/channel-list.md`. **The channels of
  main-catalog** are the rows of its section "main-catalog": `catalog:init`,
  `catalog:items`, `get-all-clusters`, `get-cluster-by-id`,
  `discover-kubeconfig-sync-kind`, `parse-kubeconfig-text` and
  `add-kubeconfig-text`; and `cluster-visibility`, which the list gives to
  main-cluster-connection but which the Electron build's main side reads only
  for the active flag of FR-005, so this feature moves its row to
  main-catalog.
- **The existing tests of this area** are the unit tests of the Electron build
  under the directories R9 of `specs/001-tauri-shell-spike/research.md` gives
  main-catalog (`main/catalog`, `main/catalog-sources`,
  `main/catalog-sync-to-renderer`, `main/cluster-enumeration`,
  `features/cluster/enumeration` and `features/weblinks`, under
  `packages/core/src`), those of the injectables the channel list names for
  its channels (`features/kubeconfig-sync-kind` and the main side of
  `features/add-cluster`), and those of what FR-006 takes over from the cluster
  manager (`main/cluster/update-entity-metadata.test.ts`).

## Clarifications

### Session 2026-11-25

- Q: Does the catalog take from the Electron build's cluster manager the parts that need no connection: the icon, short name, metrics settings and recorded distribution and version of the cluster store, a cluster store entry for a new context, and the active flag of the visible cluster? → A: Yes, all of them (FR-006, FR-005). The connection status, disconnecting a cluster whose context leaves a file, and the deleting state stay with main-cluster-connection.
- Q: How many contexts make the large catalog of SC-006 and SC-007, and how are they split into files? → A: 500 generated contexts: a file sync of one file with 250, and a folder sync of 25 files with 10 each ("the large catalog").

## User Scenarios & Testing _(mandatory)_

The people served by this feature are the users who move between the Electron
build and the Tauri build, who must find the same clusters and web links in
both, under the same ids, so that their hotbars, favorites and cluster settings
still point at them; and the maintainers of the port, whose later areas, the
cluster connection first, start from the clusters of the catalog. Users of the
Electron build see no change.

### User Story 1 - The same catalog in both builds (Priority: P1)

A user of the Electron build syncs their `~/.kube` folder, a kubeconfig file
elsewhere, and has pasted a kubeconfig once. They start the Tauri build on the
same data directory. The catalog lists the same clusters, under the same ids,
names, labels and files, the same web links and the same general entities as
the Electron build, and leaves out what the Electron build leaves out.

**Why this priority**: The input names it. Every later area of the port
starts from the clusters of the catalog, and a cluster that gets another id
in the Tauri build loses its settings, its hotbar item and its local storage.

**Independent Test**: Take a data directory written by the Electron build with
syncs of a file and of a folder that holds several kubeconfig files (with
valid and invalid contexts, a file of an ignored name, a file too large, a
UTF-16 file, a symbolic link and a subfolder), a pasted kubeconfig, renamed
clusters and several web links. With no cluster connected, compare the
catalog each build sends a view on `catalog:items`.

**Acceptance Scenarios**:

1. **Given** a data directory and syncs written by the Electron build, **When**
   the Tauri build starts and a view asks for the catalog, **Then** the view
   gets the entities the Electron build sends for the same files, entity for
   entity and value for value.
2. **Given** a synced file with a context that fails validation, or a file that
   is not a kubeconfig, **When** the catalog is filled, **Then** the context or
   the file gives no entity, the reason is logged, and every valid context
   of every other file is listed.
3. **Given** a folder sync whose folder holds files of the names the Electron
   build ignores, a subfolder, a file larger than the Electron build reads and
   a file whose text is not valid in its encoding, **When** the catalog is
   filled, **Then** none of them gives an entity, as in the Electron build.
4. **Given** a cluster the user renamed, gave an icon or labels in the Electron
   build, **When** the Tauri build lists it, **Then** it shows the name, the
   icon and the labels the Electron build shows.
5. **Given** a file reached by two syncs, as by a file sync and the sync of its
   folder, **When** the catalog is filled, **Then** each of its contexts is
   listed once.

---

### User Story 2 - A change to a synced file reaches the catalog (Priority: P2)

While the Tauri build runs, the user, `kubectl` or another tool changes a
synced kubeconfig file: adds a context, removes one, adds a file to a synced
folder or removes one. The user adds or removes a sync in the settings. The
catalog follows each change, no later than the Electron build would, and a
cluster that stays in the file does not disappear from the catalog while the
file is being written.

**Why this priority**: The input names it, with the measure that it be no
later than in the Electron build. It depends on Story 1.

**Independent Test**: With the Tauri build running and a view open, make each
change of the story five times and measure the time from the end of the write
to the view's catalog showing it; repeat the same steps on the Electron build.
Rewrite a synced file many times, in place and by replacing it, and check that
no cluster present before and after a write leaves the catalog in between.

**Acceptance Scenarios**:

1. **Given** a running Tauri build, **When** a context is added to a synced
   file or removed from it, **Then** the catalog of every view gains or loses
   its cluster, no later than in the Electron build; a context whose name
   stays and whose content changes keeps its cluster.
2. **Given** a synced folder, **When** a file is added to it or removed from it,
   **Then** the catalog gains or loses the clusters of that file, no later than
   in the Electron build.
3. **Given** a synced file being rewritten, in place or by replacing it,
   **When** the write is in progress, **Then** no cluster that the file holds
   before and after the write leaves the catalog.
4. **Given** a running Tauri build, **When** the user adds a sync or removes
   one in the settings, **Then** the catalog gains the clusters of the new
   sync, or loses those only the removed sync gave, without a restart. The
   application's kubeconfig directory stays synced whatever the settings say.

---

### User Story 3 - The core answers every channel of main-catalog (Priority: P3)

A view asks for the catalog when it starts, asks what kind of path the user
picked for a sync, checks kubeconfig text the user pasted and adds it, and
asks for the clusters as a list or by id. The core answers each of these as
the Electron build's main side does.

**Why this priority**: The renderer's catalog, its add-cluster dialog and its
kubeconfig sync settings use these channels, and the channel list is complete
only when each has an answer. It depends on Story 1.

**Independent Test**: From a view, send each channel of main-catalog with the
same input to both builds and compare the answers; after
`add-kubeconfig-text`, check that the pasted contexts reach the catalog.

**Acceptance Scenarios**:

1. **Given** a view, **When** it sends `catalog:init`, **Then** every view gets
   the whole catalog on `catalog:items`.
2. **Given** kubeconfig text the user pasted, **When** a view asks to check it,
   **Then** the core answers the names of its contexts and what is wrong with
   each, and no credential of the text.
3. **Given** the same text, **When** a view asks to add it, **Then** the core
   writes it into the application's kubeconfig directory as a new file only
   the user can read, answers the names of the contexts it added, and their
   clusters reach the catalog.
4. **Given** a path the user typed or picked for a sync, **When** a view asks
   what it is, **Then** the core answers file, folder or the error, following
   symbolic links, and reads nothing of its contents.
5. **Given** a catalog, **When** a view asks for all clusters or for one by its
   id, **Then** the core answers the clusters the Electron build answers, with
   the same fields, and nothing for an id it does not have.

---

### User Story 4 - Web links show whether they can be reached (Priority: P4)

The web links of the catalog show whether their address answers, as in the
Electron build: checked once at start and again about every hour, and
stopped for a link the user removes.

**Why this priority**: It completes the parity of the catalog's web links,
whose listing Story 1 already gives. Nothing else depends on it.

**Independent Test**: Add a web link whose address answers and one whose
address does not, and check the status the catalog gives each. Remove one and
check that it is no longer checked.

**Acceptance Scenarios**:

1. **Given** a web link whose address answers within the time the Electron
   build waits, **When** it is checked, **Then** the catalog shows it as
   available; otherwise as unavailable.
2. **Given** a web link removed by the user, **When** its next check would come,
   **Then** no check is made, and the link is no longer in the catalog.

---

### User Story 5 - Startup and a large catalog are as fast as in the Electron build (Priority: P5)

Filling the catalog does not make the Tauri build slower to start than the
Electron build of `specs/baseline.md`, and a large catalog reaches the views
no later than in the Electron build.

**Why this priority**: The input names the startup measure, and the channel
list asks the spec that ports `catalog:items` to measure it with a large
catalog, because large values cross the Tauri build's channels more slowly.
It is measured once the other stories work.

**Independent Test**: Measure the startup of the Tauri build as
`specs/baseline.md` measures it, three times, with the five stores of spec 007
and the syncs of the large catalog; measure the time until a view has the
whole catalog in both builds with the same syncs.

**Acceptance Scenarios**:

1. **Given** the five stores and the syncs of the large catalog, **When** the
   Tauri build is started three times, **Then** the median startup time is at
   most 2.37 s.
2. **Given** the same syncs, **When** a view asks for the catalog, **Then** it
   has the whole catalog no later than a view of the Electron build with the
   same syncs.

---

### Edge Cases

- A sync names a path that does not exist: it is skipped without a warning, as
  in the Electron build. The Electron build does not pick it up until its next
  start or the next change of the sync setting; the Tauri build may pick it up
  once it appears.
- A synced file or folder is removed while the Tauri build runs: its clusters
  leave the catalog.
- A synced file is replaced by a rename, as editors and `kubectl` do: its
  clusters that stay in it do not leave the catalog in between (FR-010).
- A synced file cannot be read, for a permission or an I/O error: it is
  logged, and the catalog shows no cluster of it, as in the Electron build.
- A synced file is larger than the Electron build reads (FR-004): it is
  skipped and logged, and the clusters it gave before leave the catalog.
- A synced file starts with a UTF-16 byte order mark: it is read as UTF-16; a
  file whose text is not valid in its encoding is skipped and logged.
- Two files hold a context of the same name: each gives a cluster of its own,
  under a different cluster id.
- A context leaves a synced file while its cluster is open in a frame: it
  leaves the catalog, and from then on the core treats it as a cluster it does
  not have (FR-020); disconnecting it comes with main-cluster-connection.
- A context returns to a file after it left: its cluster gets the same cluster
  id, and with it its settings, hotbar item and local storage.
- A development build syncs nothing but the application's kubeconfig
  directory unless the user adds a sync, as in the Electron build, so a
  development session does not read the developer's own `~/.kube`.
- A web link whose address does not answer within the time the Electron build
  waits, or with no network: it shows as unavailable until a later check
  succeeds.
- The settings name a sync twice, or a file and its folder: each context is
  listed once (FR-006).
- Kubeconfig text pasted with surrounding blank lines or with no valid
  context: it is written trimmed, and the answer names only the contexts it
  holds, as in the Electron build.

## Requirements _(mandatory)_

### Functional Requirements

#### The content of the catalog

- **FR-001**: The core MUST keep the catalog: the clusters of the synced
  files, the web links of the web link store and the general entities, and no
  entity of a kind the Electron build's main side does not list. It MUST NOT
  list the entities of the extension system, which the Tauri build does not
  have (Principle VII of the constitution).
- **FR-002**: The syncs MUST be those of the kubeconfig sync setting the core
  reads from the user store, with the defaults the Electron build gives when
  the setting is unset (the user's kube folder for a packaged build, nothing
  for a development build), and always the application's kubeconfig
  directory, which the core MUST create at startup if it is missing, as the
  Electron build does.
- **FR-003**: The synced files of a folder sync MUST be the files directly in
  the folder, following symbolic links, without its subfolders, and without
  the files whose names match the ignore rules of the Electron build (system
  files, editor swap, backup and lock files, and the caches of `kubectx` and
  `kubens`).
- **FR-004**: The core MUST read a synced file as the Electron build does: up
  to the size the Electron build reads, 32 MiB for a file sync and 2 MiB for a
  file of a folder sync, skipping a file of that size or larger; as UTF-8, or as UTF-16 when the file
  starts with the matching byte order mark, skipping a file whose text is not
  valid; and each context that passes the Electron build's validation gives a
  cluster, while one that fails it gives none and is logged. A file that
  cannot be loaded at all gives no cluster.
- **FR-005**: Each cluster MUST have the cluster id, and the entity the Electron
  build gives it: the context name as its name, the kubeconfig file and the
  context, the `local` source, and a `file` label naming the synced file with
  the home directory written as `~` for a file outside the application's
  kubeconfig directory. Its connection status MUST be disconnected until
  main-cluster-connection connects clusters, and the cluster shown in a frame
  MUST be marked active, as the Electron build's main side marks it.
- **FR-006**: What the cluster store holds about a cluster MUST shape its entity
  as in the Electron build, both where the kubeconfig sync builds the entity
  and where the cluster manager updates it: a name, a short name, an icon or
  labels the user set, the metrics settings, and the distribution and version
  the Electron build recorded. A context with no entry in the cluster store
  MUST get one, through the stores of spec 007, with the fields the Electron
  build writes for it; an entry MUST NOT be removed when its context leaves a
  file, as in the Electron build. Of the cluster manager, this feature takes
  only these and the active flag of FR-005; its connection status, the
  disconnecting of a cluster whose context leaves a file and the deleting
  state come with main-cluster-connection.
- **FR-007**: A cluster id reached through two syncs MUST be listed once.
- **FR-008**: The web links MUST be those of the web link store, one entity
  each with the fields the Electron build gives it, following every change of
  the store while the Tauri build runs.

#### Keeping the catalog current

- **FR-009**: The core MUST follow every change of a synced file or folder
  while it runs: a file added, changed or removed, and with it a context
  added, changed or removed. A change that adds or removes a cluster MUST
  reach the catalog of every view no later than in the Electron build
  (SC-002); a context that changes keeps its cluster and its cluster id, and
  the core reads its new content.
- **FR-010**: The catalog MUST NOT reflect a synced file in the middle of a
  write: a cluster that the file holds before and after a write, in place or
  by replacing the file, MUST NOT leave the catalog in between.
- **FR-011**: A change of the kubeconfig sync setting while the Tauri build runs
  MUST start the syncs it adds and stop those it removes, removing the clusters
  only those syncs gave, without a restart. The application's kubeconfig
  directory MUST stay synced.
- **FR-012**: A sync whose path does not exist MUST be skipped without a
  warning. The core MAY start it once the path appears.

#### The channels of main-catalog

- **FR-013**: The core MUST send the whole catalog to every view on
  `catalog:items` when a view sends `catalog:init`, and on every change of the
  catalog, each entity in the shape and with the values the Electron build
  sends. Changes that come close together MUST be sent as the Electron build
  sends them: the first at once, and the later ones once, with the latest
  state, when 100 ms have passed without a change.
- **FR-014**: No message or answer of the channels of main-catalog MUST carry a
  credential or the contents of a kubeconfig file: an entity names its file
  and its context, and nothing more of them.
- **FR-015**: The core MUST answer `get-all-clusters` and `get-cluster-by-id` as
  the Electron build does: each cluster of the catalog with the fields, the
  status mapping and the active flag the Electron build's main side gives,
  and nothing for an id the catalog does not have or for an empty id.
- **FR-016**: The core MUST answer `discover-kubeconfig-sync-kind` as the
  Electron build does: file, folder or the error for anything else, following
  symbolic links, and MUST read only the kind of the path, never its contents.
- **FR-017**: The core MUST answer `parse-kubeconfig-text` with the names of the
  contexts of the text, what is wrong with each and with the text as a whole,
  as the Electron build does. It MUST answer `add-kubeconfig-text` by writing
  the trimmed text into the application's kubeconfig directory, under a new
  random name, readable and writable by the user alone, and answering the
  names of the contexts it holds; their clusters MUST then reach the catalog
  through the sync of that directory.
- **FR-018**: Each channel of main-catalog MUST be answered by the core, and the
  channel list MUST say so, with any channel this feature adds, renames or
  stops sending, in the columns the list requires.

#### The web links' checks

- **FR-019**: The core MUST check each web link as the Electron build does: at
  start, and then again 60 to 65 minutes after each check, at a random point
  of that span; with a GET of its address that gives up after 20 seconds; and
  counting an answer with a status from 200 to 499 as available and anything
  else, a failure included, as unavailable. A link is available until its
  first check ends. A link removed from the store MUST no longer be checked.

#### The rest of the core

- **FR-020**: Every part of the core that asks which clusters exist, or which
  kubeconfig file and context a cluster has, MUST ask this catalog: the local
  storage of a cluster (spec 007), the cluster frames (spec 004) and the
  cluster clients of spec 001. The catalog of spec 001, which reads one file
  once, MUST give way to it.
- **FR-021**: A kubeconfig file the Tauri build accepts at launch, for
  measurements and tests, MUST be synced for that run as a file sync, beside
  the syncs of the settings, and MUST NOT be written to the settings.
- **FR-022**: The core MUST log the syncs as the Electron build does: each sync
  started and stopped, and each file or context skipped with its reason, in
  the core's log of spec 007, never with a credential.

#### The Electron build and the tests

- **FR-023**: The Electron build MUST keep its behaviour, its files and its
  channels. Its extension API MUST NOT change (Principle III of the
  constitution).
- **FR-024**: The Electron build MUST keep building, and MUST pass its unit and
  integration tests (Principle VII of the constitution). An existing test MUST
  NOT be removed or weakened to make it pass.
- **FR-025**: The behaviour that the existing tests of this area check MUST
  hold in the core, shown by tests of the core that check the same
  behaviour: the reading, validation and ignore rules of the synced files,
  the diff of a changed file, the start and stop of syncs as the setting
  changes, the sources and categories of the catalog, the entity from the
  cluster store, the enumeration of the clusters, and the answer of each
  channel of main-catalog.

### Key Entities

- **Catalog**: the entities the views list; kept by the core, sent whole to
  every view.
- **Entity**: a cluster, a web link or a general page, in the shape the
  Electron build sends.
- **Sync**: a file or a folder the user chose, or the application's kubeconfig
  directory; started and stopped as the setting changes.
- **Synced file**: one kubeconfig file of a sync, read whole after each change.
- **Cluster id**: the MD5 of a synced file's path and a context's name; the
  same in both builds, and the key of everything stored about a cluster.
- **Cluster store entry**: what the user set for a cluster in the cluster store
  of spec 007; it shapes the cluster's entity.
- **Web link check**: the periodic request that sets whether a web link is
  available.
- **Channel of main-catalog**: one row of the channel list's section
  "main-catalog", with the core's answer.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: With the same data directory and syncs and no cluster connected,
  the catalog the Tauri build sends a view equals, entity for entity and value
  for value, the one the Electron build sends.
- **SC-002**: For each change of Story 2 (a context added to a synced file or
  removed from it, a file added to a synced folder or removed from it, a sync
  added in the settings), the median of five times from the end of the write,
  or from a view's change of the setting, to the change in a view's catalog
  is no longer in the Tauri build than in the Electron build, measured with
  the same steps on the same machine and recorded in `specs/baseline.md`.
- **SC-003**: Over 100 rewrites of a synced file, half in place and half by
  replacing it, no cluster that the file holds before and after a rewrite is
  missing from any catalog a view receives.
- **SC-004**: A review of the channels of main-catalog in the channel list
  finds, for each, a test of the core that shows its answer, and the same input
  gives the same answer in both builds.
- **SC-005**: Each behaviour the existing tests of this area check has a test of
  the core that checks the same behaviour, and the tests of the core pass.
- **SC-006**: With the five stores of spec 007 and the syncs of the large
  catalog, the median of three startups of the Tauri build, measured as in
  `specs/baseline.md`, is at most 2.37 s.
- **SC-007**: With the same syncs, the median of three times from a view's
  request to its having the whole catalog is no longer in the Tauri build than
  in the Electron build, recorded in `specs/baseline.md`.
- **SC-008**: With synced kubeconfig files that hold tokens, client
  certificates and keys, none of the messages and answers of the channels of
  main-catalog that a view receives contains any of them.
- **SC-009**: The Electron build builds, and its unit and integration tests
  pass, with no existing test removed or weakened.

## Assumptions

- The behaviour to match is that of the Electron build's main side on macOS:
  the kubeconfig sync of `main/catalog-sources`, the entity registry of
  `main/catalog`, the sending of `main/catalog-sync-to-renderer`, the web links
  of `features/weblinks`, the cluster enumeration, and the channel listeners
  the channel list names. What the Electron build does only on Windows, such as
  polling a kubeconfig on a WSL share, has no counterpart on macOS.
- The renderer does not run in the Tauri build at the end of this feature, as at
  the end of spec 007, so no user interface of the Tauri build shows the
  catalog yet. The stories are shown through the channels, from a view, and by
  the tests of the core.
- Connecting a cluster, its connection status, disconnecting it when its
  context leaves a file, the deleting state and the detection of its
  distribution and version come with main-cluster-connection. Until then each
  cluster of the Tauri build is disconnected, as each is in the Electron build
  before the user connects it, which is the state SC-001 compares.
- FR-006 takes from the Electron build's cluster manager, which R9 gives to
  main-cluster-connection, only what shapes the catalog without a connection
  (Clarifications). Without it, the icons and metrics settings of the catalog
  and the cluster store file would differ between the builds; the name and
  labels a user set reach the entity through the kubeconfig sync either way.
- The Electron build checks a web link with a request straight to its address:
  its main side sets no proxy for that request. The Tauri build does the same
  (FR-019).
- Tests and measurements set the syncs in the settings of their own data
  directory, so neither build reads the user's own `~/.kube`: changing `HOME`
  does not keep the Electron build away from it, as the spike's run of the
  integration tests found (`specs/baseline.md`).
- The large catalog is generated, so no measurement reads the user's own
  kubeconfig files or the data of the measuring machine; no figure of the size
  of users' catalogs exists. It holds no credential that reaches a cluster.
- `specs/baseline.md` has no figure yet for a change reaching the catalog or for
  a large catalog in the Electron build; this feature measures both builds
  with the same steps and records them there.
- The startup of `specs/baseline.md` is measured from the creation of the
  process to the main window having loaded, median of three runs, on the
  development machine. The syncs of the large catalog are the condition this
  feature adds to the five stores of spec 007.
- Depends on the channels of `specs/002-messaging-for-tauri`, the cluster frames
  of `specs/004-cluster-frames`, and the settings, stores, log and data
  directory lock of `specs/007-main-foundation`.
