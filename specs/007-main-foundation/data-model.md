# Data Model: Main Foundation

## Data directory

| Field      | Value                                                                                                                                                                                 |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `path`     | `--data-dir`; else `<FREELENS_INTEGRATION_TESTING_DIR>/<appName>` when the variable starts with the temporary directory; else `~/Library/Application Support/<appName>` (research R6) |
| `app_name` | `Freelens` for a release build of the core, `FreelensDev` for a debug build                                                                                                           |
| `lock`     | held from before the first read to the exit (contracts/instance-lock.md)                                                                                                              |

The data directory is created when missing, as conf creates it.

## Store

One per file. Loaded once at startup, before the window; written on every
change of its model.

| Field         | Meaning                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------- |
| `config_name` | `lens-user-store`, `lens-hotbar-store`, `freelens-favorites-store`, `lens-cluster-store`, `lens-weblink-store` |
| `path`        | `<data dir>/<config_name>.json`; also the suffix of its two sync channels                                      |
| `file`        | the last JSON value read or written, `__internal__` and unknown keys included                                  |
| `model`       | what the views see: `to_json(from_store(file without __internal__))`                                           |
| `writable`    | false when the file could not be read (research R2); the model then lives in memory only                       |

State transitions:

```text
missing file ──load──▶ file = { __internal__ } written, model = defaults
valid file  ──load──▶ version raised to 0.1.0 if lower or absent, model built
invalid JSON ─load──▶ copied to <name>.corrupt-<ms>.json, file reset, model = defaults
unreadable  ──load──▶ writable = false, model = defaults, nothing written
model ──change (view or core area)──▶ normalized; if different: file merged and written, sent to every view
```

Merging a model into the file, as `persistStateToConfig` does: each top-level
key of the model replaces the file's key in place, or is appended; a key whose
value is absent is removed with the order of the others kept; every other key
of the file stays. Inside `preferences` and inside each cluster (matched by
`id`), keys the model does not know are kept after the known ones (research
R3).

## Models

### User store

`{ preferences }`. On load, `migrateLegacyThemePreferences` runs first: it
drops `colorTheme`, sets `theme: "freelens"` with the variant when there is
no theme, and turns a `terminalTheme` of `Dark` or `Light` into `freelens`
with the matching `terminalThemeVariant`
(`features/user-preferences/common/migrate-legacy-theme-preferences.ts`).

#### Preferences

Each key is read with its default when absent, and written only in the case
of the last column; the order of the keys written is that of `toJSON` in
`features/user-preferences/common/storage.injectable.ts`.

| Key                                                                                                                             | Default when read                                                                                                                                                                               | Written when                                                |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `httpsProxy`, `shell`, `accentColorDark`, `accentColorLight`, `downloadBinariesPath`, `kubectlBinariesPath`, `helmBinariesPath` | absent                                                                                                                                                                                          | truthy                                                      |
| `theme`                                                                                                                         | `freelens`                                                                                                                                                                                      | not `freelens`                                              |
| `themeVariant`                                                                                                                  | `system`; only `dark` and `light` are kept                                                                                                                                                      | `dark` or `light`                                           |
| `zoom`                                                                                                                          | 100; valid steps 67, 75, 80, 90, 100, 110, 125, 150, 175, 200                                                                                                                                   | a valid step other than 100                                 |
| `terminalTheme`                                                                                                                 | `""`                                                                                                                                                                                            | truthy                                                      |
| `terminalThemeVariant`                                                                                                          | `dark`, unless `light`                                                                                                                                                                          | `light`                                                     |
| `localeTimezone`                                                                                                                | the current time zone                                                                                                                                                                           | it differs from the current time zone                       |
| `allowUntrustedCAs`, `openAtLogin`, `hotbarAutoHide`, `persistentSearch`, `terminalCopyOnSelect`                                | false                                                                                                                                                                                           | true                                                        |
| `allowErrorReporting`, `downloadKubectlBinaries`, `helmServerSide`, `showTrayIcon`                                              | true                                                                                                                                                                                            | false                                                       |
| `downloadMirror`                                                                                                                | `default`; unknown values become `default` (allowed: `default`, `custom`)                                                                                                                       | not `default`                                               |
| `downloadCustomMirror`                                                                                                          | `""`                                                                                                                                                                                            | truthy                                                      |
| `logViewerPreferences`                                                                                                          | `{ showTimestamps: false, showWordWrap: true, maxCombinedLogsPods: 20 }` merged with the stored value; `maxCombinedLogsPods` not a finite number becomes 20, else rounded and clamped to 1..100 | only the keys that differ from the default; absent if none  |
| `hiddenTableColumns`                                                                                                            | `[[tableId, [columns]]]` read as a map of sets                                                                                                                                                  | non-empty sets only; absent if none                         |
| `syncKubeconfigEntries`                                                                                                         | `[{ filePath: "~/.kube" }]` in a production build, `[]` in a development one, when absent                                                                                                       | it differs from that default; `[]` is written in production |
| `editorConfiguration`                                                                                                           | `{ tabSize: 2, lineNumbers: "on", fontSize: 12, fontFamily: "RobotoMono", minimap: { enabled: true, side: "right" } }` deep-merged with the stored value                                        | always, whole                                               |
| `terminalConfig`                                                                                                                | `{ fontSize: 12, fontFamily: "RobotoMono" }` deep-merged with the stored value                                                                                                                  | always, whole                                               |
| `extensionRegistryUrl`                                                                                                          | `{ location: "default" }` when absent or `location: "npmrc"`                                                                                                                                    | location not `default`                                      |
| `clusterPageMenuOrder`                                                                                                          | as stored                                                                                                                                                                                       | as stored                                                   |

The Electron build's deep merge changes its shared default objects in place
(`es-toolkit/compat` `merge`), so a second read in the same process starts
from the first read's result. A store is read once per process in both
builds, so the core uses fresh defaults for each read.

### Hotbar store

`{ hotbars: [{ id, items, name }], activeHotbarId }`.

- No hotbar: one hotbar named `Default` with a new v4 uuid, the welcome
  entity in cell 0 and the catalog entity in cell 1, each
  `{ entity: { uid, name, source } }` as
  `features/hotbar/storage/common/storage.injectable.ts` builds them.
- Every hotbar has 12 cells: shorter ones are padded with `null`; longer ones
  lose trailing `null`s first, then are cut.
- Hotbars with the same `id` collapse into one.
- A missing or unknown `activeHotbarId` becomes the first hotbar's; written
  absent when undefined.

### Favorites store

`{ items, useShortNames }`: `items` defaults to `[]` and is not validated;
`useShortNames` defaults to `true`.

### Cluster store

`{ clusters: [...] }`. A cluster model is valid when `id`, `kubeConfigPath` and
`contextName` are non-empty strings, `preferences` and `metadata` are objects
when present, `accessibleNamespaces` is an array of strings when present, and
`labels` maps strings to strings when present (`common/cluster-types.ts`). A
valid model is written as `{ id, contextName, kubeConfigPath, preferences,
metadata, accessibleNamespaces, labels }`; an invalid one is kept as it is,
unless a valid model has its `id`. Nothing else of a cluster is done here.

### Web link store

`{ weblinks: [...] }`, keyed by `id` on read (a later duplicate replaces the
earlier one in place), written as the values are.

## Local storage file

`<data dir>/lens-local-storage/<clusterId or app>.json`, one JSON object, as a
view stored it. Read as `{}` when missing, unreadable, invalid or not an
object (an array passes through, as in the Electron build). Written whole,
two-space indentation and a trailing newline, mode `0600`, in a directory of
mode `0700`.

## Template

| Field   | Value                                                                         |
| ------- | ----------------------------------------------------------------------------- |
| `group` | the directory of the file relative to `~/.freelens/templates`, or `ungrouped` |
| `label` | the file name without its extension                                           |
| `value` | the file's contents, UTF-8                                                    |

Files count when their path ends in `.yaml`, `.yml` or `.json`. Groups and
options are sorted by path (research R8).

## Instance lock

| Field    | Value                                                                     |
| -------- | ------------------------------------------------------------------------- |
| `path`   | `<data dir>/FreelensTauriLock`, a symbolic link                           |
| `target` | `<hostname>-<pid>`, the format of Chromium's `SingletonLock`              |
| `live`   | the host is another one, or `kill(pid, 0)` succeeds or fails with `EPERM` |

## Log file

`<logs>/freelens-tauri.log`, then `freelens-tauri1.log` to
`freelens-tauri15.log` as it rotates at 1 MiB; one line per entry,
`<level>: <message>`.
