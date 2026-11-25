# Research: Main Catalog

Findings are marked **Verified** when read in the sources named, or
**Unverified** when they rest on documentation or reasoning that this
research did not check. Paths of the Electron build are relative to
`packages/core/src/`; paths of the core to `freelens-tauri/src-tauri/`.

## R1. What the catalog holds, and in what order

**Finding** (Verified, source; the order within the general pages is an
Inference from ogre-tools keeping registrations in a `Set`):

- `main/catalog/entity-registry.ts` keeps an ordered map of sources and lists
  their entities in insertion order, keeping only those
  `hasCategoryForEntity` accepts. The three built-in categories accept the
  group `entity.k8slens.dev` with the kinds `General`, `KubernetesCluster` and
  `WebLink`; the filter of `common/catalog/category-registry.ts` ignores the
  version.
- The sources are added in this order: `weblinks` and `freelens:general` on
  `onLoadOfApplication`, `kubeconfig-sync` on `afterApplicationIsLoaded`.
  So the catalog lists the web links in the order of the store, then the
  general pages Catalog, Terminal, Welcome Page and Preferences, then the
  clusters, each id once, in the order first seen (R4).
- No migration and no default adds a web link (`features/weblinks/common/`).
- Extensions add sources of their own, which the Tauri build does not have.

**Decision**: `src/catalog/mod.rs` keeps the three sources in this order and
the same category filter.

## R2. The JSON of an entity

**Finding** (Verified, source, unless marked):

- `catalog:items` carries `toJS(registry.items)`. An entity's own keys are
  `metadata`, `status`, `spec`, `apiVersion` and `kind`
  (`common/catalog/catalog-entity.ts` and the three classes), in that order
  (Inference from MobX redefining the annotated keys before the subclass
  fields). `apiVersion` is `entity.k8slens.dev/v1alpha1` for all three kinds.
- A general page is `metadata: { uid, name, source: "app", labels: {} }`,
  `status: { phase: "active" }`, `spec: { path, icon: { material,
  background: "var(--primary)" } }`, with `welcome-page-entity`,
  `Welcome Page`, `/welcome`, `home`; `catalog-entity`, `Catalog`,
  `/catalog`, `view_list`; `preferences-entity`, `Preferences`,
  `/preferences`, `settings`; and `terminal-page-entity`, `Terminal`,
  `/terminal`, `terminal`.
- A web link is `metadata: { uid: <id>, name, source: "local", labels: {} }`,
  `spec: { url }`, `status: { phase: "available" | "unavailable", active:
  true }`.
- A cluster is built by `catalogEntityFromCluster` and then changed by the
  cluster manager (R6). Once it settles, without a connection, it is
  `metadata: { uid, name, source: "local", labels, distro, kubeVersion,
  version?, id?, distribution?, nodes?, lastSeen?, prometheus?, shortName? }`,
  `status: { phase: "disconnected", reason: "", message: "", active, enabled:
  true }`, `spec: { kubeconfigPath, kubeconfigContext, icon, metrics: {
  source: "local", prometheus: { type?, address? } } }`. `distro` and
  `kubeVersion` are the store entry's `metadata.distribution` and
  `metadata.version`, or `unknown`.
- A key whose value is `undefined` crosses Electron's structured clone as
  such; JSON has no `undefined`, and a view reads a missing key and an
  `undefined` one alike.
- Between two settled states the Electron build may send one where the
  cluster manager has not yet changed a new cluster (R7's coalescing sends
  the first state at once).

**Decision**: the core leaves out a key that has no value, and sends only
settled states, built from the context and the store entry in one step. The
contract is [contracts/catalog-entities.md](./contracts/catalog-entities.md);
the parity test compares the Electron build's catalog after a JSON round
trip, which drops the same keys.

## R3. Reading a synced file

**Finding** (Verified, source): `main/catalog-sources/kubeconfig-sync/`
reads a synced file whole after each event, in this order:

1. `diffChangedKubeconfig`: a file whose size is at least the limit is
   skipped with the warning `skipping <path>: size=<size> is larger than
   maxSize=<limit>`, and every cluster it gave is removed. The limit is 2 MiB
   for a file of a folder sync and 32 MiB for a file sync.
2. The encoding is chosen from the first chunk: `FF FE` is UTF-16 LE, `FE FF`
   UTF-16 BE, anything else UTF-8 (`getKubeconfigEncoding` of
   `common/kube-helpers/main/read-kubeconfig-file.injectable.ts`). The decoder
   is fatal and drops a leading byte order mark: text that is not valid in the
   encoding is skipped with `skipping <path>: <error>`, and its clusters are
   removed. A read error is logged and leaves the clusters as they were.
3. `computeKubeconfigDiff` calls `loadConfigFromString` of
   `common/kube-helpers/main/kube-helpers.ts`:
   - Empty or blank text is no document. Other text is parsed with js-yaml
     5.5.0's default schema; a parse error becomes
     `invalid YAML: <reason> at line <n>`, with no snippet of the text.
   - The document is validated with Joi 18.3.2 against
     `{ users: [{ name }], clusters: [{ name, cluster: { server } }],
     contexts: [{ name, context?: { cluster, user } }], "current-context" }`,
     every string at least one character, unknown keys allowed. The
     validation error is logged as a warning, with its values removed, and
     the entries of `users`, `clusters` and `contexts` that fail the schema
     are dropped from the arrays.
   - `@kubernetes/client-node` 2.0.2 builds the config from what is left,
     with its loaders set to throw: a context that has no `context` object,
     which the Joi schema lets through, throws `contexts[<i>].context is
     missing`.
   - Any throw is logged as `Failed to compute diff: <error>` and removes every
     cluster of the file.
4. `splitConfig` gives one entry per context; `validateKubeConfig` refuses a
   context whose context object, cluster or user cannot be found, with
   `No valid <context|cluster|user> object provided in kubeconfig for
   context '<name>'`, logged at debug level. Each valid context becomes
   `{ kubeConfigPath: <path>, contextName: <name> }`.
5. A context name that appears twice gives the same cluster id twice; the
   last one wins in the model map, and both carry the same values.

**Decision**: `src/catalog/kubeconfig.rs` reproduces this pipeline over a
generic value rather than over kube's typed `Kubeconfig`:

- the size limits, the byte order marks and a strict UTF-8 or UTF-16 decoder;
- YAML through `serde-saphyr` (in `Cargo.lock` through kube) into a
  `serde_json::Value`, with duplicate keys refused and merge keys expanded,
  as js-yaml does, strict booleans, so that `yes` stays a string as in YAML
  1.2, and no snippet in its errors: kubeconfig text holds credentials, so
  no error of the parser may quote it;
- the scalars that js-yaml's default schema resolves to something other than
  a string where `serde-saphyr` gives a string, timestamps above all, are
  marked as not strings, so that a name of `2024-01-01` fails the string
  rule as it does in the Electron build;
- the Joi rules of the schema above, with the messages Joi gives for them
  (`"<path>" is required`, `"<path>" is not allowed to be empty`,
  `"<path>" must be a string`, `"<path>" must be of type object`,
  `"<path>" must be an array`), the dropping of failed array entries, then
  client-node's throws, then the split and the validation.

The text of a YAML parse error is the core's own, after the Electron build's
prefix `invalid YAML: `, with the line; js-yaml's reasons cannot be
reproduced, and no view reads more than the whole string.

**Rationale**: the clusters a file gives must be the same in both builds
(SC-001), including the cases where one bad entry empties a file. kube's
`Kubeconfig` rejects whole files for reasons of its own types and accepts
some the Electron build refuses, so it is used only where credentials are
needed, by the cluster clients (R10).

**Alternatives considered**: kube's `Kubeconfig::from_yaml` (its own failure
modes); porting js-yaml's whole schema (only the resolution of plain scalars
changes what the catalog sees).

## R4. The syncs, the synced files and the cluster id

**Finding** (Verified, source):

- `kubeconfig-sync/manager.ts` syncs the keys of the `syncKubeconfigEntries`
  preference, plus `directoryForKubeConfigs`, `<userData>/kubeconfigs`, which
  `start-kubeconfig-sync.injectable.ts` creates before the first sync. It
  reconciles on every change of the key set: a removed key stops its sync,
  an added one starts. The preference's default is the kube directory for a
  packaged build and nothing for a development build
  (`features/user-preferences/common/preference-descriptors.injectable.ts`).
- `watch-file-changes.injectable.ts` stats the path: a missing one is
  skipped with a debug line and is not looked at again until the key set
  changes; another stat error is a warning. A folder is watched at depth 0,
  following symbolic links, with the ignore rules of
  `matchIgnoredKubeconfigFileName` (`.DS_Store`, `Thumbs.db`, `cache`,
  `desktop.ini`, `kubectx`, `kubens`, and names starting with `._`, `.#` or
  `~`, or ending in `.bak`, `.lock`, `.swn`, `.swo`, `.swp`, `#` or `~`).
  A subfolder gives no file. A file sync watches the file itself.
- The cluster id is the MD5 of `<path>:<context>`, where `<path>` is the path
  chokidar reports: the sync's path, normalized by chokidar's `normalizePath`
  (`runtime.js`), for a file sync, and that folder path joined with the
  file's name by `path.join` (`index.js`) for a folder sync. A symbolic link
  is reported under its own path.
- When `<path>` does not start with the string `directoryForKubeConfigs`, the
  entity gets the label `file`, `<path>` with the first occurrence of
  `os.homedir()` replaced by `~`. `os.homedir()` reads `HOME`.
- The kubeconfig sync's catalog source drops an entity whose id an earlier
  sync already gave: syncs in the order `[directoryForKubeConfigs,
  ...entries]`, the files of a sync in the order they were first added.

**Decision**: the same rules in `src/catalog/syncs.rs`, with chokidar's
normalization reproduced for the ids (backslashes turned into slashes, Node's
lexical `path.normalize`, which keeps a trailing slash, and repeated slashes
collapsed) and `path.join`'s for a folder's files, the string prefix test for the
label, and `HOME` for the label's home directory (the kube directory of the
defaults stays the user database's, as spec 007 reads it). A missing sync is
not looked at again until the setting changes, as in the Electron build;
FR-012 allows more but does not ask for it.

**Rationale**: the cluster id keys the cluster store, the hotbars and the
local storage files; one character of difference loses them.

## R5. Following the changes

**Finding** (Verified, source): the Electron build watches with chokidar 6.0.0
(`awaitWriteFinish: { pollInterval: 100, stabilityThreshold: 1000 }`,
`atomic: 150`). After startup's first scan, which reads each file at once, an
add or a change is held until the file's size has not changed for 1000 ms,
checked every 100 ms, and any further event restarts the wait; so a change
reaches the diff 1.0 to 1.1 seconds after the last write. An unlink is held
for 150 ms, and an add of the same path within that time turns into a
change. The broadcast after the diff is immediate (R7).

**Decision**: the core watches with FSEvents through the `notify` crate
(version 8, whose default features are FSEvents on macOS; Unverified until
added), and uses its events only to wake a scan of the sync they concern.
The scan, not the event, decides:

- a file is read once its size, modification time and inode have stayed the
  same for 500 ms after its last change, checked every 100 ms;
- a path found missing is removed only if it is still missing 100 ms later;
  one that comes back within that time is a change;
- startup's first scan reads every file at once, as the Electron build does;
- a symbolic link of a sync or of a folder gets a watch on its target too;
- an event that FSEvents marks as dropped or coalesced for a subtree scans
  every sync under it.

The events name canonical paths (`/private/var` for `/var`), so they are
matched against the canonical paths of the syncs, and the paths the catalog
uses stay the ones the settings name.

**Rationale**: SC-002 asks for no later than the Electron build. Half its
stability time keeps the protection against a file read in the middle of a
write (FR-010, SC-003) and gives a change about half a second of margin; the
removal window is shorter than the Electron build's 150 ms and still covers
an editor's unlink and create. Events cost nothing while nothing changes.

**Alternatives considered**: polling every 100 ms (ten wake-ups a second for
as long as the application runs, and removals would still lag); kqueue
through `libc` (one descriptor per watched file, against a default limit of
256 descriptors); FSEvents through hand-written bindings (the unsafe code
`notify` already carries); `notify-debouncer-full` (rules that are not the
Electron build's). A new crate was declined in spec 007 for one templates
folder; here the watcher is the area's core and its timing is a success
criterion.

## R6. What the cluster store gives the catalog (FR-006)

**Finding** (Verified, source):

- `compute-diff.injectable.ts` builds a context's cluster from the cluster
  store's entry when there is one (`getClusterById(id) ?? new Cluster(...)`),
  and the entity with `catalogEntityFromCluster` of `main/cluster/manager.ts`:
  the name is `preferences.clusterName` or the context name, the labels are
  the cluster's, `distro` and `kubeVersion` come from its metadata, and the
  phase is `disconnected` for a cluster that is not connected.
- `ClusterManager` of `main/cluster/manager.ts` then, for every cluster entity
  of the catalog: adds a store entry `{ id, kubeConfigPath, contextName,
  accessibleNamespaces: [] }` when there is none; otherwise sets the entity's
  status, metadata (`update-entity-metadata.injectable.ts`) and spec
  (`update-entity-spec.injectable.ts`) from the entry, again on every change
  of an entry's preferences or state. It marks the visible cluster's entity
  `status.active`.
- `update-entity-metadata` clears a short name set to `null`, and
  `update-entity-spec` an icon set to `null`, from both the entity and the
  store's entry, so the Electron build writes the entry back without them.
- The visible cluster of `status.active` is the one the views name on
  `cluster-visibility` (`main/cluster/visibility-handler.injectable.ts`), not
  the `current-visible-cluster` of spec 004; nothing else in main reads it.
  The channel list gives `cluster-visibility` to main-cluster-connection.
- What needs a connection: the phases `connecting` and `connected`, the
  `deleting` phase of the delete dialog, and the disconnect of a cluster whose
  context leaves its file.

**Decision**: `src/catalog/entities.rs` shapes a cluster entity from the
context and the store entry by the rules of these three injectables, with the
phase `disconnected` and `enabled: true`; adds the missing entries through
`Stores::update` of spec 007, one update per diff; clears the `null` icon and
short name in the entry the same way; rebuilds the entities on
`Stores::on_change` for the cluster store; and listens on
`cluster-visibility` for `status.active`, which moves that row of the channel
list to main-catalog (FR-018). The rest is main-cluster-connection's
(Clarifications of the spec).

## R7. Sending the catalog

**Finding** (Verified, source): `catalog-sync-to-renderer.injectable.ts`
answers `catalog:init` by broadcasting the whole catalog, and broadcasts it on
every change of `toJS(registry.items)`, once the root frame is ready. The
broadcaster is `debounce(…, 100, { leading: true, trailing: true })` of
`es-toolkit/compat` 1.53.2: a call when no timer runs is sent at once, every
call restarts a 100 ms timer, and when the timer ends without being
restarted, the last call since the one sent at once is sent. A steady stream
of changes less than 100 ms apart therefore sends nothing after the first
until it pauses. The registry keeps only the entities whose category main has
registered.

**Decision**: the same coalescing in `src/catalog/channels.rs`, sending the
whole catalog to every view on `catalog:items`. The core sends from startup;
a view that is not open has no queue, and every view sends `catalog:init`
when it starts. A log line `Catalog: sent <n> entities` marks each send for
the measurements of R12.

**Size**: an entity of R2 is a few hundred bytes of JSON, so the large
catalog's `catalog:items` is a few hundred kilobytes; at the rates of the
channel list's "Answer times" that is under 10 ms over the Tauri build's
channels (Unverified until SC-007 measures it).

## R8. The other channels of main-catalog

**Finding** (Verified, source):

- `get-all-clusters` and `get-cluster-by-id` map the cluster entities of the
  catalog to `ClusterInfo` with `mapClusterToClusterInfo` of
  `features/cluster/enumeration/common/cluster-mapping.ts`; an unknown or
  empty id answers `undefined`.
- `discover-kubeconfig-sync-kind` stats the path, following symbolic links:
  `{ kind: "file" }`, `{ kind: "dir" }`, `{ error: "unknown stat entry" }` for
  anything else, and `{ error: String(error) }` when the stat fails, which is
  Node's `Error: <CODE>: <message>, stat '<path>'`.
- `parse-kubeconfig-text` is `checkKubeconfigText` of
  `features/add-cluster/main/check.ts`: the text trimmed, `{}` when empty,
  loaded as in R3; a throw answers `{ contexts: [], error: String(error) }`;
  otherwise every context of the split with its validation error as text,
  and the Joi error as `ValidationError: <messages joined by ". ">`.
- `add-kubeconfig-text` writes the trimmed text to
  `<userData>/kubeconfigs/<uuid v4>`, UTF-8, mode `0600`, creating the
  directory first, and answers the names of every context
  `checkKubeconfigText` finds, valid or not.

**Decision**: the same answers. Node's stat errors are reproduced with the
codes and libuv's messages for the errors a stat can give (`ENOENT`,
`EACCES`, `ENOTDIR`, `ELOOP`, `ENAMETOOLONG`, `EIO`), and with the code
alone for any other. `ClusterInfo.isActive` is always `false`, as in the
Electron build's main side, which tracks no active cluster for the
enumeration (`main/cluster-enumeration/cluster-enumeration.injectable.ts`);
`status` maps `connected`, `connecting` and `disconnected` to themselves and
`deleting` to `disconnecting`.

## R9. The web links' checks

**Finding** (Verified, source): `features/weblinks/main/` turns each entry of
the web link store into a `WebLink` entity whose phase starts `available`,
and checks it at once and then 60 minutes plus a random 0 to 5 minutes after
each check ends. A check is `fetch(url)` with a 20-second limit through the
application's `fetch`, undici's, with no dispatcher, so no proxy of the
settings and Node's own trust store; a status from 200 to 499 is available,
anything else and any error unavailable. A link removed from the store stops
its check.

**Decision**: `src/catalog/weblinks.rs` makes the same checks with the
connection code of `src/foundation/download.rs` (spec 007), without the
proxy, following redirects as `fetch` does, reading no body, with the
system's authorities. A test passes its own authority, as the tests of the
download do.

**Limits**: the system's authorities where the Electron build uses Node's
list; a site whose authority is in one list and not in the other differs in
its phase (as R9 of spec 007 found for the download).

## R10. The rest of the core takes the catalog

**Finding** (Verified, source): the core of spec 001 reads one kubeconfig file
once (`src/catalog.rs`), and five areas ask it which clusters exist: the
scheme's view of a host (`src/messaging/routes.rs`, `src/routes.rs`), the
frame record (`src/frames.rs`), the local storage files
(`src/foundation/local_storage.rs`), the spike page's `/api/clusters`
(`src/scheme.rs`) and the cluster clients (`src/clusters.rs`), which build
every client from that one file.

**Decision**:

- `src/catalog.rs` becomes the module `src/catalog/`, whose `Catalog` handle
  is shared as `Frames` and `Stores` are
  ([contracts/catalog-api.md](./contracts/catalog-api.md)). The five areas
  ask it at the time of each request, so a cluster that leaves the catalog is
  refused from then on.
- The cluster clients read the kubeconfig file and context of a cluster on
  its first request, with kube's `Kubeconfig`, and drop the client when the
  cluster leaves the catalog or its file changes.
- `Frames` asks the catalog whether a cluster named visible exists. The spike
  page sends `cluster-visibility` beside `current-visible-cluster`, as the
  renderer does, so that the active flag can be seen in the Tauri build.
- `--kubeconfig=<path>` adds a file sync for the run, never written to the
  settings (FR-021); `--kubeconfig=none` and no option add nothing. The
  default of spec 001, `~/.kube/config` read once, is gone: the settings'
  default covers the kube directory.
- The spike page renders its list from `catalog:items`, opens the cluster of
  `--open-cluster` once it appears, and with `?catalog-marks` posts the mark
  `catalog-<n>` when it receives `n` entities.
- `specs/001-tauri-shell-spike/measure.sh` seeds the user store of each run
  with the syncs the mode needs: none for `spike`, so that no run reads the
  user's `~/.kube`, as the Electron baseline did.

## R11. The log

**Finding** (Verified, source): the kubeconfig sync logs with the prefix
`[KUBECONFIG-SYNC]:` the start and stop of each sync at info level, the
skipped files and the load errors as warnings, and the per-context steps at
debug level.

**Decision**: the same events in the core's log of spec 007, with the prefix
`Catalog:`, plus the line of each send (R7). No line carries the text of a
kubeconfig file or of a parser error built from it.

## R12. Measuring SC-002, SC-006 and SC-007

**Finding** (Verified, `specs/baseline.md` and `specs/profile-main.mjs`): the
Electron build is driven with its main inspector (`--inspect`) and the
renderer's CDP port; the Tauri build through its standard output and the
`/mark` route. Neither build has a figure for a change reaching the catalog.

**Decision**: `specs/008-main-catalog/measure-catalog.mjs` measures both
builds with the same steps on a temporary data directory and temporary
kubeconfig files:

- **SC-002**: for each change of a synced file in SC-002, five times, the
  time from the script's write returning to the catalog showing it: for the
  Electron build, the send of `catalog:items` from main, hooked through the
  inspector (its IPC to a view is under 1 ms at these sizes, by the channel
  list's "Answer times"); for the Tauri build, the spike page's mark, which
  includes the channel. The Tauri figure is thus the stricter one. A change
  of the sync setting is not timed: the input asks about the files, and
  neither build takes a setting from outside a view; the cargo tests cover it
  (FR-011).
- **The catalog sent**: the main hook writes each `catalog:items` payload of
  the Electron build to a file, and the core's launch option
  `--catalog-dump=<path>` writes each catalog it sends, so that the script
  compares them (SC-001) and searches them for credentials (SC-008). The
  option is for measurements and tests, like `--data-dir`.
- **SC-007**: the time from a view's `catalog:init` to the whole large
  catalog, three times, by the same two marks.
- **SC-006**: `measure.sh spike` with `MEASURE_DATA_DIR` holding the five
  stores, the large catalog's files, and a user store whose syncs name them
  under the placeholder `__RUN_DIR__`, which `measure.sh` replaces with the
  run's directory after copying the seed.

The script's modes are `dump` (SC-001), `changes` (SC-002, SC-003),
`weblinks`, `large-seed` and `large` (SC-007); each searches what the builds
sent for the placeholder credentials of its files (SC-008).

The figures go into `specs/baseline.md`.

## R13. Proving parity with the Electron build

**Decision**: shared fixtures, as R13 of spec 007:

- `freelens-tauri/src-tauri/tests/fixtures/catalog/<case>/` holds the synced
  files of a case, the stores it starts from, and `expected/`: the entities
  the catalog sends, the cluster store after the diff, and the answers of
  `parse-kubeconfig-text` for the case's texts.
- A Vitest test of the Electron build,
  `main/catalog-sources/tauri-parity.test.ts`, feeds each case's files through
  the Electron build's own `diffChangedKubeconfig` and cluster manager rules,
  with the paths the watcher would report, and asserts `expected/`; with
  `UPDATE_TAURI_PARITY=1` it writes them.
- Cargo tests feed the same cases through the core and assert the same files.
- Cases: valid and invalid contexts, a context without `context`, invalid
  YAML, empty text, duplicate keys, merge keys, `yes` and a timestamp as a
  name, duplicate context names, UTF-16 LE and BE, invalid UTF-8, a file at
  the size limit, store entries with a name, icon, short name, labels and
  metrics, `null` icon and short name, a context with no store entry, and
  the `file` label inside and outside the application's kubeconfig
  directory.

The watcher's own rules (ignore names, depth, symbolic links, the timing) are
covered by cargo tests on a temporary directory and by the comparison of
[quickstart.md](./quickstart.md) section 3, since the Vitest test does not
run chokidar.

## R14. The existing tests of the area

**Decision**: each `describe` of the existing tests maps to cargo tests that
check the same behaviour:

| Electron test                                                          | Behaviour                                                                                                                                                                                                                   | Core test                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `main/catalog-sources/__test__/kubeconfig-sync.test.ts`                | split and validation of contexts; diff adding, keeping and removing clusters; file and folder syncs of one file; missing paths; syncs started and stopped as the setting changes; the application's directory always synced | `src/catalog/kubeconfig.rs`, `src/catalog/syncs.rs`, `tests/catalog.rs` |
| `main/catalog-sources/kubeconfig-sync/diff-changed-kubeconfig.test.ts` | encodings, a character split across chunks, invalid UTF-8, size limits                                                                                                                                                      | `src/catalog/kubeconfig.rs`                                             |
| `main/catalog-sources/kubeconfig-sync/watch-file-changes.test.ts`      | the ignore rules (the WSL rule has no macOS counterpart)                                                                                                                                                                    | `src/catalog/syncs.rs`                                                  |
| `main/catalog/__tests__/catalog-entity-registry.test.ts`               | sources added and removed, entities without a category left out                                                                                                                                                             | `src/catalog/mod.rs`                                                    |
| `main/cluster-enumeration/__tests__/cluster-enumeration.test.ts`       | `ClusterInfo` fields, status mapping, lookup by id, only clusters enumerated                                                                                                                                                | `src/catalog/channels.rs`                                               |
| `features/cluster/enumeration/main/__tests__/handlers.test.ts`         | the two channels' answers                                                                                                                                                                                                   | `tests/catalog.rs`                                                      |
| `features/kubeconfig-sync-kind/kubeconfig-sync-kind.test.ts`           | file, folder and error                                                                                                                                                                                                      | `tests/catalog.rs`                                                      |
| `features/add-cluster/kubeconfig-text.test.ts`                         | parse answers, no credential, the written file and the names                                                                                                                                                                | `tests/catalog.rs`                                                      |
| `main/cluster/update-entity-metadata.test.ts`                          | the entity's metadata from the store entry                                                                                                                                                                                  | `src/catalog/entities.rs`, the fixtures of R13                          |

`features/weblinks` has no test of its own; R9 is covered by
`src/catalog/weblinks.rs` with a local server.

## R15. What this feature does not port

- The extension API's catalog sources and categories, and every entity an
  extension adds (Principle VII).
- The cluster manager's connection: the `connecting` and `connected`
  phases, the `deleting` phase, the disconnect of a removed context, the
  `network:online` and `network:offline` listeners (main-cluster-connection).
- Polling of a WSL share, which has no macOS counterpart.
