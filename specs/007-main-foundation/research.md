# Research: Main Foundation

Each section states what the Electron build does, with the files it was read
from, and what the core does. Paths without a prefix are relative to
`packages/core/src/`; `conf:<line>` is
`node_modules/.pnpm/conf@16.0.0/node_modules/conf/dist/source/index.js`.
**Verified** means read in the source or seen on the development machine;
**Unverified** means inferred and checked by the step of
[quickstart.md](./quickstart.md) that names it.

## R1. The file format of a store

**Finding** (Verified, source): the stores are written by `conf` 16.0.0
(`pnpm-workspace.yaml` catalog).

- **Encoding**: `JSON.stringify(value, undefined, '\t')`, tab indentation, no
  trailing newline (conf:1198). A leading BOM is stripped on read (conf:1188).
- **Bookkeeping**: `__internal__.migrations.version`, written as a nested
  object. Freelens passes `projectVersion` `"0.1.0"`
  (`common/vars/store-migration-version.injectable.ts`) and an empty
  migrations object for each of the five stores, so conf runs its migration
  pass: a missing file is written at load as
  `{"__internal__":{"migrations":{"version":"0.1.0"}}}`, and an existing file
  gets the version only when it has none, a range, or a lower one
  (conf:597, 1419-1422, 2005-2036). A higher version is never rewritten.
  `store` hides `__internal__` from `fromStore` (conf:1095-1114).
- **Writing**: `persistStateToConfig`
  (`features/persistent-storage/main/persist-state-to-config.injectable.ts`)
  calls `config.set(key, value)` for each top-level key of the model, or
  `config.delete(key)` when the value is `undefined`, catching and logging
  each failure. Each call re-reads the file, changes one key and writes the
  whole file (conf:833-843). Top-level keys the model lacks stay. Only main
  writes; the renderer's `persistStateToConfig` does nothing.
- **Atomicity**: `atomically.writeFileSync` writes
  `<file>.tmp-<10 digits><6 hex>` in the same directory, fsyncs it, copies the
  mode and owner of an existing file (a new one gets `0o666` less the umask),
  and renames it over the file; the directory is created first (conf:1215,
  1258; `atomically@2.1.1`).
- **Reading**: a missing file reads as `{}`; an empty or invalid file throws a
  `SyntaxError`; valid JSON that is not an object reads as `{}` (conf:106,
  116, 1075-1083, 1195).
- **Key order**: kept from the file, new keys at the end; as everywhere in
  JavaScript, keys that are array indices (`"0"`, `"12"`) come first, in
  ascending order, whatever the file says.
- **Watching**: conf can watch the file; Freelens does not ask it to.

**Decision**: the core's store file module reproduces the final bytes of that
sequence, not its steps: one change of the model is one atomic write of the
whole file, with the content the per-key writes would have left.

- Parse with `serde_json` with its `preserve_order` feature (indexmap 2 is in
  `Cargo.lock` already) and its `float_roundtrip` feature, stripping a BOM.
  Without `float_roundtrip`, `serde_json` may read a large or long number
  one unit in the last place away from the double `JSON.parse` reads
  (`123456789012345680000` read back as `123456789012345670000`), which a
  write would then print differently.
- Write with a formatter that prints what `JSON.stringify(v, undefined, '\t')`
  prints: `serde_json`'s pretty printer with a tab indent, plus two things it
  does differently: objects put array-index keys first in ascending order, and
  numbers are printed as JavaScript prints them (`1e+21`, not `1e21`; an
  integer beyond 2^53 rounded as a JavaScript number is). Strings already escape the same way (control
  characters as `\uXXXX` lowercase, `\b \f \n \r \t` short, nothing else).
- Remove a key with `shift_remove`, which keeps the order of the others;
  `serde_json::Map::remove` with `preserve_order` swaps the last key into its
  place.
- Write `<file>.tmp-<10 digits><6 hex>`, fsync, copy the existing file's mode,
  rename. A failed write removes its temporary file and is logged.
- The version: write `0.1.0` when the file has none, a range, or a lower one;
  never lower it.

**Rationale**: the bytes are what the next start of the Electron build reads,
and what "byte for byte" in the plan's input asks for. The intermediate files
of the per-key writes are seen by nobody but a crash, and FR-006 asks that a
crash leave the file whole, which one write gives more simply than several.

**Alternatives considered**: one `config.set` per key, as conf does (several
writes per change, each a chance to crash between them); `serde_json`'s
default sorted maps (reorders every file on the first write); a hand-written
JSON writer (`serde_json`'s formatter hooks cover the two differences).

## R2. A file the core cannot use

**Finding** (Verified, source): on a `SyntaxError`, Freelens copies the file to
`<configName>.corrupt-<Date.now()>.json`
(`features/persistent-storage/main/backup-corrupt-file.injectable.ts`), logs
an error, and opens it again with `clearInvalidConfig: true`
(`features/persistent-storage/common/create.injectable.ts:128-146`); a copy
that fails is thrown, and the file is not cleared. The migration pass then
writes the file with only the `__internal__` version (conf:2021-2031,
1419-1422; the last step is inferred from the source, Unverified). Any other
error of the read is thrown, and the Electron build fails to start.

**Decision**: the same, with the copy named the same way, and the reset file
written as R1 writes. A read that fails for another reason, such as a
permission, is logged and the store is kept in memory from its defaults for
the run, without writing the file, rather than failing the start; it is the
one place the core is more lenient than the Electron build, as "or more
safely" of User Story 2 allows, because a store the core cannot read is one it
must not overwrite.

JavaScript reads one kind of file that `serde_json` rejects: a string with an
unpaired surrogate escape (`"\ud800"`). The core cannot tell such a file from
one the Electron build would reset, so it handles it as an unreadable file:
kept, not written, logged.

**Rationale**: FR-007 and the acceptance scenarios of User Story 2.

## R3. The model of each store

**Finding** (Verified, source): no store passes `defaults` to conf; each builds
its model in `fromStore` and writes it with `toJSON`. MobX starts the reaction
that saves after `fromStore`, without `fireImmediately`, so a default the
model gains on load (the first hotbar, a preference's default) reaches the
file only with the next change (Unverified for MobX itself, checked by the
fixtures of R13).

| Store                      | Model                                                | `fromStore`                                                                                                                                                                                                                                                    | `toJSON`                                                                                               |
| -------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `lens-user-store`          | `{ preferences }`                                    | `migrateLegacyThemePreferences`, then each descriptor of `features/user-preferences/common/preference-descriptors.injectable.ts` reads its key                                                                                                                 | each descriptor writes its key or leaves it out; unknown preference keys are dropped                   |
| `lens-hotbar-store`        | `{ hotbars: [{ id, items, name }], activeHotbarId }` | no hotbar gives a `Default` hotbar with a new uuid and the welcome and catalog items; each hotbar has exactly 12 cells (padded with `null`, trailing `null`s dropped first); duplicate ids collapse; a missing or unknown active id becomes the first hotbar's | `id`, `items`, `name` of each hotbar; an `undefined` active id is deleted                              |
| `freelens-favorites-store` | `{ items, useShortNames }`                           | `items ?? []`, `useShortNames ?? true`; items not validated                                                                                                                                                                                                    | shallow copies                                                                                         |
| `lens-cluster-store`       | `{ clusters }`                                       | each model checked against `common/cluster-types.ts`; an invalid model is kept as it is unless a valid one has its id                                                                                                                                          | `id, contextName, kubeConfigPath, preferences, metadata, accessibleNamespaces, labels` of each cluster |
| `lens-weblink-store`       | `{ weblinks }`                                       | keyed by id, duplicates collapse, not validated                                                                                                                                                                                                                | the values as they are                                                                                 |

The preference descriptors, each with its default when read and when it is
stored, are listed in [data-model.md](./data-model.md#preferences). Two read
the machine: `localeTimezone` (the current time zone) and
`syncKubeconfigEntries` (`[~/.kube]` in a production build, `[]` in a
development one).

**Decision**: each store is a Rust module with `from_store(file value) -> model`
and `to_json(model) -> value`, ported from the TypeScript above, and the
fixtures of R13 prove them against the Electron build's own code. Two
deliberate differences, both for files written by a newer build (FR-005):

- unknown keys inside `preferences`, and unknown keys of a cluster model, are
  kept in the file when the core writes it, at the end of their object and of
  their cluster (matched by id), though the model the views get does not have
  them, as in the Electron build;
- the core never lowers the recorded version (R1, which is what conf does
  already).

With no unknown key, the bytes are those the Electron build writes.

**Spec alignment**: FR-003 said the cluster and web link stores are kept "as
the file has it". The Electron build's model of the cluster store is the
projection above, and SC-001 compares models, so the core builds that
projection too; what main does with the clusters (connecting them, syncing
kubeconfig files) stays with main-cluster-connection and main-catalog. FR-003
of the spec is reworded accordingly.

**Alternatives considered**: relaying the file's JSON as the model (fails
SC-001 on every normalized value); dropping unknown keys as the Electron build
does (a newer Electron build loses its new settings each time the user opens
the Tauri build).

## R4. Keeping the views in sync

**Finding** (Verified, source):

- `persistent-storage-initial-values` answers `{ configName, path, model }[]`,
  one per store main has loaded (`features/persistent-storage/main/initial-values-listener.injectable.ts`).
- A view sends its model on `store-sync-main:<path>`; main runs `fromStore`
  when it differs from its own `toJSON()`, its reaction saves and sends the new
  `toJSON()` on `store-sync-renderer:<path>` to every view, the sender
  included (main does not disable its reaction in the listener:
  `features/persistent-storage/main/disable-sync-in-ipc-listener.injectable.ts`
  is `false`). A view ignores a model equal to its own.

**Decision**: the core does the same: on `store-sync-main:<path>`, normalize the
model with `from_store` then `to_json`, and when it differs from the current
one, replace it, write the file (R1) and send it on
`store-sync-renderer:<path>` to every view. A model that is not an object, or
a path the core does not keep, is logged and dropped. A change made by a core
area goes the same way. The channel ids are built at startup from the five
paths and leaked once into `&'static str`, which `MessageChannel::new`
requires; five strings for the life of the process.

**Rationale**: sending to the sender too is what the Electron build does, and
the views already ignore an equal model.

## R5. One build per data directory (FR-023)

**Finding** (Verified, source and machine):

- The Electron build calls `app.requestSingleInstanceLock()` in
  `main/electron-app/runnables/enforce-single-application-instance.injectable.ts`
  and exits with `app.exit(0)`, silently, when it does not get it; the running
  instance shows its window (`second-instance`).
- Chromium keeps that lock as the symbolic link `SingletonLock` in the data
  directory, pointing to `<hostname>-<pid>`, with `SingletonSocket` and
  `SingletonCookie` beside it. Seen in both `Freelens` and `FreelensDev` on
  the development machine.
- Freelens writes no lock of its own there.

**Decision**:

- The Tauri build, before it reads or writes any file of the data directory,
  creates the symbolic link `FreelensTauriLock` there, pointing to
  `<hostname>-<pid>` in Chromium's format. The link is created in one call,
  which fails if it exists. If it exists and names a process on this host that
  is alive, or if `SingletonLock` does, the Tauri build shows a native alert
  naming the build that runs and the data directory, and exits without
  writing. A link naming a process that is gone is stale: the Tauri build
  replaces it. Its own link is removed when it quits. When the link cannot be
  written for another reason, such as a read-only volume, the Tauri build
  logs it and still checks `SingletonLock`, then runs without a link: nothing
  it would write there can succeed anyway.
- The Electron build, right after it gets its own lock, reads
  `FreelensTauriLock` the same way, and when it names a live process, shows
  `dialog.showErrorBox` (callable before `ready`) and exits. One injectable,
  `is-tauri-build-running`, called from the existing runnable; nothing else
  of the Electron build changes. Two Electron instances behave as before,
  because the new check runs only after Electron's own lock is taken.
- Reading the other build's link is enough for both directions: a released
  Electron build, which does not know `FreelensTauriLock`, is still kept out
  of the Tauri build's way by `SingletonLock`, and only the Electron build
  started while the Tauri build runs needs the new check.
- Liveness is `kill(pid, 0)` (`libc`, in `Cargo.lock` already; `process.kill(pid, 0)`
  in Node), and a process of another host counts as alive, as in Chromium.
- The alert is `osascript`'s `display alert`, with the two texts passed as
  arguments to the script rather than written into it. `NSAlert` was tried
  first, as the plan had it: run on the main thread before Tauri sets the
  application up, `runModal` returns at once without showing, even with the
  activation policy set and `finishLaunching` called, so the process exited
  before the user could read anything. `osascript` shows the alert and waits
  for it to be closed (checked on the development machine).

**Rationale**: the only lock every Electron build already writes is Chromium's;
a link in its format lets both builds use one reader. Creating a symbolic link
is atomic on APFS, and a dead pid frees the lock without a cleanup step.

**Alternatives considered**: an `flock` on a file (released by the kernel on
exit, but Node has no `flock`, so the Electron build could not test it); a
Unix socket (paths in a temporary data directory can exceed the 104-byte
limit of macOS); a page in the main window instead of an alert (the Tauri
build would start its window, which FR-023 rules out); checking only one
direction (the input of the clarification asks for both).

**Limits**: a stale link whose pid is reused by another process keeps the
other build out until that process ends; the alert says which link to delete,
as Chromium's own message does. Two builds started in the same instant may
both refuse, which writes nothing.

## R6. The data directory and the paths

**Finding** (Verified, source, and the macOS values of `getPath` by the
Electron probe of quickstart.md step 1, run with Electron 44.10.1 on the
development machine):

- `appName` is `Freelens`, plus `Dev` when the build was made with
  `NODE_ENV=development` (`common/vars/app-name.injectable.ts`,
  `freelens/electron.vite.config.ts`).
- `setup-app-paths` sets `appData` to `FREELENS_INTEGRATION_TESTING_DIR` when it
  is set, then `userData` and `sessionData` to `<appData>/<appName>`, reads
  each of the 17 names of `common/app-paths/app-path-names.ts` with
  `app.getPath` (`currentApp` with `app.getAppPath()`), and stores `""` for a
  name whose call throws (`main/app-paths/get-electron-app-path/`).
- The stores use `directoryForUserData`, which takes
  `<FREELENS_INTEGRATION_TESTING_DIR>/<appName>` when the variable starts with
  the temporary directory, and `userData` otherwise; since `userData` is
  `<FREELENS_INTEGRATION_TESTING_DIR>/<appName>` too whenever the variable is
  set, the stores are there whenever it is set, wherever it points.
- The values of `getPath` on macOS: `recent` throws
  `Failed to get 'recent' path`, so the Electron build answers `""`; `logs` is
  `~/Library/Logs/Freelens`, because the name is the product name when the
  paths are read and `setName` adds `Dev` only later; `crashDumps` is
  `<userData>/Crashpad` and follows a changed `userData`; `temp` keeps the
  trailing `/` of `TMPDIR`; `module` is Electron's framework binary. The
  probe sets `appData` to a temporary directory first, as an
  integration-testing run does, because Chromium creates `Crashpad` under
  `userData` as soon as the path is read.

**Decision**:

- The data directory: `--data-dir=<path>` when given; else
  `<FREELENS_INTEGRATION_TESTING_DIR>/<appName>` when the variable is set and
  not empty; else `~/Library/Application Support/<appName>`,
  with `appName` `Freelens` for a release build and `FreelensDev` for a debug
  build of the core.
- `app-paths` answers the 17 names with the values the Electron build gives on
  macOS, computed from the home directory, `TMPDIR`, the data directory and
  the application bundle. The table in
  [contracts/foundation-channels.md](./contracts/foundation-channels.md#app-paths)
  holds the values of the Electron probe (quickstart step "Electron probe").
  `exe`, `module` and `currentApp` name the Tauri build's own files (FR-012).

**Rationale**: FR-001 and FR-011; the probe turns the Unverified values into
fixed ones before the core encodes them.

## R7. The channels that read the machine

**Finding** (Verified, source): see the per-channel entries of
[contracts/foundation-channels.md](./contracts/foundation-channels.md), which
quote the Electron build's answers and error strings:

- `machine-values`: `platform`, `isDebugging` from `DEBUG`, `isSnap` from
  `SNAP`, `isFlatpak` from `FLATPAK_SANDBOX_DIR`, the home directory of the
  user database (`os.userInfo()`, not `$HOME`) or the integration-testing one,
  `~/.kube`, and the bundled helm.
- `validate-directory` and `path-exists`: `~` is resolved only as the whole
  path or as `~/` exactly (`common/path/resolve-tilde.injectable.ts`); six
  error strings, and for an errno the Electron build does not name
  `{ ok: false, error: undefined }`, which reaches a view as `{ ok: false }`.
- `lens-local-storage:*`: `<data dir>/lens-local-storage/<clusterId|app>.json`,
  read as `{}` when missing or invalid, written with two spaces and a trailing
  newline, mode `0600` in a `0700` directory, not atomically; a cluster the
  catalog does not have is refused with
  `Cannot use the local storage of cluster "<id>", which is not registered`.
- `sync-box-*`: no sync box exists; the answer is `[]` and the messages are
  heard and dropped.

**Decision**: the same answers and the same strings, the missing `error`
included, since a view may compare them. The local storage files are written
with the same bytes and modes, atomically as R1 writes, which the Electron
build does not do and which changes nothing it reads. Which clusters exist is
the core's catalog until main-catalog takes over (Assumptions of the spec).

## R8. The templates folder

**Finding** (Verified, source): `features/user-resource-templates/main/`
watches `<home>/.freelens/templates` with chokidar (`awaitWriteFinish` with a
1-second stability, no depth limit, FSEvents), from the first
`initial-user-resource-templates` request on. A file counts when its full path
ends in `.yaml`, `.yml` or `.json` (case-sensitive); its group is the
directory relative to the folder, or `ungrouped`; its option is
`{ label: <name without extension>, value: <contents> }`. Groups and options
keep the order chokidar reported them in, which is not sorted. A missing
folder is waited for. Every change sends the whole list on
`user-resource-templates-update`; identical content sends nothing.

**Decision**: the core polls the folder once a second from the first request
on: a recursive walk that follows symbolic links once each, reads a file once
its size and modification time have stayed the same for one poll, and sends
the whole list when it differs from the last one sent. Groups and options are
sorted by path, which the Electron build leaves to the order of the file
system. The first answer is the list of that first walk.

**Rationale**: the folder is small and rarely changes, and chokidar's own
stability delay is a second, so a poll a second gives the same latency
without a file-watching crate. A sorted list is one order the Electron build
can also produce.

**Alternatives considered**: the `notify` crate (not in `Cargo.lock`; a new
dependency for one folder); FSEvents through `objc2` (much more code).

## R9. `download-json-channel`

**Finding** (Verified, source): `main/fetch/download-json.injectable.ts` GETs the
URL with undici through the dispatcher of `main/fetch/https-agent.injectable.ts`:
the user's `httpsProxy` (`http:`, `https:`, `socks:`, `socks5:`, `socks5h:`;
another scheme answers
`Unsupported proxy URL scheme "<scheme>" in the HTTP Proxy preference: use http:, https: or socks5:`),
Node's bundled authorities plus the system's, and no certificate check when
`allowUntrustedCAs` is on. The answer is `{ callWasSuccessful: true, response }`
or `{ callWasSuccessful: false, error }`, with the errors
`<status>: <statusText>`, `Operation timed out: timeout <duration>`,
`fetch failed: <cause>`, and the message of the JSON parser.

**Decision**: the core opens the connection itself, a TCP connection, a
`CONNECT` tunnel through an `http:` or `https:` proxy or a SOCKS5 handshake,
then TLS with `tokio-rustls`, and sends the request with `hyper`'s HTTP/1
connection, following redirects as `fetch` does (up to 20). The system's
authorities come through `rustls-platform-verifier`. Everything is in
`Cargo.lock` already through kube and Tauri. `hyper-util`'s legacy client
with its `Tunnel` and SOCKS connectors was the first choice: its `Tunnel`
takes port 443 for any target without a port, an `http:` one included, and
layering its generic connectors under `hyper-rustls` cost more code than the
connection itself. The proxy schemes, the timeout string and the status
string are the Electron build's; the unsupported scheme is named with its
colon, as `URL.protocol` gives it (`"ftp:"`), and a proxy setting that is not
a URL answers `Invalid URL`.
The texts that come from the network stack or the JSON parser are the core's
own, after the same prefix (`fetch failed: `), because undici's and Node's
texts cannot be reproduced; no view reads more than the whole string.

**Limits**: the system's authorities only, where the Electron build adds Node's
bundled list; a server whose authority is in Mozilla's list and not in
macOS's would fail. On macOS the two lists differ by little (Unverified). The
trusted authorities are a parameter of the client, the system's in the
application and a test's own in the tests (R14).

**Alternatives considered**: `reqwest` (not in the graph of the macOS build; a
new dependency tree); kube's own client (built for one API server and its
kubeconfig credentials, which FR-016 keeps out of a download).

## R10. The log

**Finding** (Verified, source): the Electron build's file log is
`<logs>/lens.log`, level `debug`, rotated at 1 MiB into 16 files with
`tailable` naming (`lens.log`, `lens1.log` … `lens15.log`), one line per entry
as `<level>: <message>` plus ` <JSON>` of the metadata, without a timestamp,
because `simple()` runs before `timestamp()`
(`main/logger/file-transport.injectable.ts`,
`packages/logger/src/main/winston-logger.injectable.ts`).

**Decision**: the core writes `<logs>/freelens-tauri.log` with the same
rotation and naming, and the line format `<level>: <message>`. Every line the
core prints today goes there too as `info`, and to standard output as before,
which the checks of specs 002 and 004 read. An area that logs an error or a
warning prefixes its line with `error: ` or `warn: `, written as it is.

**Rationale**: FR-019; a file of its own because two builds appending to one
rotating file would rotate each other's lines away.

## R11. The settings for the later areas (FR-010)

**Decision**: `Stores` holds the five models and lets a core area read the
preferences as they are now and subscribe to their changes, the way `Frames`
lets an area follow the frame record
([contracts/stores-api.md](./contracts/stores-api.md)). The core does not act
on `openAtLogin`.

## R12. Startup

**Finding** (Verified, `specs/baseline.md`): startup is measured from the
creation of the process to the log line of the main window having loaded,
median of three runs; the gate is 2.37 s, and the Tauri build of spec 001
measured 0.39 s through `open` with an empty data directory. The largest
store on the development machine is a cluster store of 150 KB.

**Decision**: the lock (R5), then the five stores are read synchronously before
the window is created; nothing else of this feature runs before the window.
The templates folder is not read until a view asks. The measurement copies a
data directory with the five stores into a temporary directory and passes it
with `--data-dir`, so the user's own files are never used for it.

## R13. Proving parity with the Electron build

**Decision**: shared fixtures, checked from both sides.

- `freelens-tauri/src-tauri/tests/fixtures/data-dir/<case>/` holds input store
  files, and `expected/` the models and the written bytes after a scripted
  change. Cases: empty directory, every preference set away from its default,
  legacy theme keys, invalid JSON, a newer recorded version with unknown keys,
  array-index keys in `labels`, hotbars to pad and to cut, duplicate ids,
  invalid cluster models.
- A Vitest test in `packages/core`
  (`features/persistent-storage/main/tauri-parity.test.ts`) loads each case
  with the Electron build's own store code and real `conf`, makes the scripted
  change through `persistStateToConfig`, and asserts that models and bytes
  equal `expected/`; it is how the fixtures are shown to be the Electron
  build's behaviour.
- Cargo tests load the same cases with the core and assert the same
  `expected/`.
- Values that depend on the machine are fixed for both: `TZ=UTC`, a production
  build, a fixed home directory. The `Default` hotbar's random id is compared
  by shape. The deliberate differences of R3 have cases of their own, whose
  `expected/` holds the core's bytes and which the Vitest test skips.

The `expected/` files are written by the Vitest test itself, run once with
`UPDATE_TAURI_PARITY=1`, from the Electron build's own code, and reviewed
against data-model.md before they are committed; without the variable the test
only compares. Biome and Trunk leave the directory alone (`biome.jsonc`,
`.trunk/trunk.yaml`), since the files are the bytes `conf` writes.

**Rationale**: SC-001, SC-002 and SC-005 in CI rather than by hand, with one
set of expected files that neither side can drift from.

**Alternatives considered**: capturing models from a running Electron build
over CDP (by hand, not repeatable in CI); porting the expected values into
Rust literals (the Electron side would never check them).

## R14. The existing tests of the area

**Finding** (Verified, source), and where each is ported:

| Electron test                                                                                        | Cargo test                                                            |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `features/persistent-storage/common/create.test.ts` (corrupt file)                                   | `tests/stores.rs`, R2 cases                                           |
| `features/persistent-storage/main/persist-state-to-config.test.ts` (key by key, absent keys removed) | `tests/stores.rs`, writing                                            |
| `features/persistent-storage/initial-values.test.ts` (main's side)                                   | `tests/stores.rs`, initial values and sync                            |
| `features/user-preferences/common/migrate-legacy-theme-preferences.test.ts`                          | `src/stores/user.rs` unit tests                                       |
| `features/user-preferences/sync-kubeconfig-entries-default.test.ts`                                  | `src/stores/user.rs` unit tests                                       |
| `features/favorites/storage-technical.test.ts` (load and defaults)                                   | `src/stores/favorites.rs` unit tests                                  |
| `features/hotbar/storage/storage-technical.test.ts` (load and normalization)                         | `src/stores/hotbar.rs` unit tests                                     |
| `features/local-storage/local-storage.test.ts`                                                       | `tests/foundation.rs`                                                 |
| `features/machine-values/machine-values.test.ts` (main's answer)                                     | `src/foundation/paths.rs` unit tests                                  |
| `features/validate-directory/validate-directory.test.ts`                                             | `tests/foundation.rs`                                                 |
| `features/user-resource-templates/user-resource-templates.test.ts`                                   | `tests/foundation.rs`, with a temporary folder                        |
| `common/app-paths/app-paths.test.ts`, `main/app-paths/get-electron-app-path/*.test.ts`               | `src/foundation/paths.rs` unit tests                                  |
| `common/utils/sync-box/sync-box.test.ts` (main's side)                                               | `tests/foundation.rs`                                                 |
| `main/fetch/https-agent.test.ts`, `main/fetch/https-proxy-agent.test.ts`                             | `tests/foundation.rs`, download, with a certificate made at test time |

What is not ported, and why:

- The parts of these tests that check the renderer (a renderer store filled
  from main, refused double fills, `common/app-paths/directory-for-user-data/renderer/directory-for-user-data.test.ts`)
  stay in the Electron build: the renderer is not ported.
- Adding, removing, moving and ordering items in
  `features/favorites/storage-technical.test.ts` and
  `features/hotbar/storage/storage-technical.test.ts` is the stores' common
  code, which runs in the renderer; its result reaches the core as a model on
  `store-sync-main`, which `tests/stores.rs` covers.
- The case of `persist-state-to-config.test.ts` where one key fails and the
  others are still saved has no counterpart: a model that arrives as JSON
  cannot hold a value `conf` refuses, and the core writes the file whole.
- `main/logger/ignore-broken-pipe-errors.test.ts`: the core writes to
  standard output with `println!`, and a closed pipe there is the check
  runner's concern.
- `main/fetch/host-header-dispatcher.test.ts`: `download-json` sends no `Host`
  header of its own, so the dispatcher never applies to it.
- `main/fetch/download-binary.test.ts` (extensions only),
  `main/fetch/freelens-proxy-agent.test.ts` (main-cluster-connection) and
  `main/utils/resolve-system-proxy/resolve-system-proxy-from-electron.test.ts`
  (extension API only) belong to other areas.

`download-json` itself has no Electron test; the core's tests of R9 use a local
server, and port the cases of the two agent tests above: a server reached
through an `http:`, an `https:` and a SOCKS5 proxy, trusted by the given
authorities, refused when its authority is not trusted, and reached when
untrusted authorities are allowed. The certificate is made when the test runs,
with `openssl req -x509 -newkey ec` as `test-utils/test-certificate.ts` was;
no certificate or key file is added to the repository, and the client takes
the trusted authorities as a parameter so that a test can name its own.

## R15. What this feature does not port

From R9 of `specs/001-tauri-shell-spike/research.md`, by the clarification of
the spec: `crypto`, `child-process`, the command-line arguments (with spec
006), `resolve-system-proxy` (extension API only), the hardware acceleration
flag (Electron only), `get-port-from-stream` and `clear-kube-env-vars` (with
the areas that start processes). `extension-credentials`, the extension stores
and `lens-filesystem-provisioner-store` are left out, as the Tauri build has
no extensions.
