# Contract: The Channels of main-foundation

What the core answers on each channel the channel list gives to
main-foundation (FR-011 to FR-018). The Electron column is the file that
answers in the Electron build, relative to `packages/core/src/`. Every channel
is open to every view, as spec 003 decided. A refusal is an error of the
request, whose message reaches the view (spec 002).

## Stores

| Channel                             | Kind | Request → answer                       | Core                                                                                                                               |
| ----------------------------------- | ---- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `persistent-storage-initial-values` | req  | none → `{ configName, path, model }[]` | the five stores, user first, then cluster, favorites, hotbar and weblink                                                           |
| `store-sync-main:<path>`            | msg  | the model, view → core                 | research R4: normalized, compared, written, sent on `store-sync-renderer:<path>` to every view; a non-object is logged and dropped |
| `store-sync-renderer:<path>`        | msg  | the model, core → every view           | sent after every change                                                                                                            |

`<path>` is the absolute path of the store's file; views build the channel id
from the `path` of the initial values.

The Electron build answers in the order its runnables loaded the stores
(`beforeApplicationIsLoading` for the user, cluster and favorites stores,
`onLoadOfApplication` for the hotbar and weblink stores), which only partly
fixes it; a view finds its entry by `configName`, so no view relies on the
order.

## app-paths

`app-paths`: none → `Record<PathName, string>`, the 17 names of
`common/app-paths/app-path-names.ts`. The values on macOS are those the
Electron probe of [quickstart.md](../quickstart.md) printed with Electron
44.10.1, a name whose call throws answered `""` as the Electron build
answers it; `~` is the home directory of the user database:

| Name                                                     | Value                                                                                                                         |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `currentApp`                                             | the Tauri build's `Resources` directory (FR-012)                                                                              |
| `home`                                                   | the home directory of the user database                                                                                       |
| `appData`                                                | `FREELENS_INTEGRATION_TESTING_DIR` when set, else `~/Library/Application Support`                                             |
| `userData`                                               | `<appData>/<appName>`                                                                                                         |
| `sessionData`                                            | `userData`                                                                                                                    |
| `temp`                                                   | `TMPDIR` as it is, with its trailing `/`                                                                                      |
| `exe`                                                    | the Tauri build's executable (FR-012)                                                                                         |
| `module`                                                 | the Tauri build's executable (FR-012); Electron's own framework binary in the Electron build                                  |
| `desktop`, `documents`, `downloads`, `music`, `pictures` | `~/Desktop`, `~/Documents`, `~/Downloads`, `~/Music`, `~/Pictures`                                                            |
| `videos`                                                 | `~/Movies`                                                                                                                    |
| `logs`                                                   | `~/Library/Logs/Freelens`, in a development build too: the name is the product name when the paths are read, before `setName` |
| `crashDumps`                                             | `<userData>/Crashpad`                                                                                                         |
| `recent`                                                 | `""`: Electron throws `Failed to get 'recent' path` on macOS                                                                  |

## machine-values

`machine-values`: none → `MachineValues` of spec 003
(`features/machine-values/main/machine-values.injectable.ts`).

| Field             | Core                                                                                                                                                    |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `platform`        | `"darwin"`                                                                                                                                              |
| `isDebugging`     | `DEBUG`, lower-cased, is one of `true`, `1`, `yes`, `y`, `on`                                                                                           |
| `isSnap`          | `SNAP` is set and not empty                                                                                                                             |
| `isFlatpak`       | `FLATPAK_SANDBOX_DIR` is set and not empty                                                                                                              |
| `homeDirectory`   | `<FREELENS_INTEGRATION_TESTING_DIR>/<appName>/home` when the variable starts with the temporary directory, else the home directory of the user database |
| `kubeDirectory`   | `<home of the user database>/.kube`                                                                                                                     |
| `bundledHelmPath` | the helm the Tauri build bundles (FR-012)                                                                                                               |

## Local storage

| Channel                    | Request → answer               | Core                                                                               |
| -------------------------- | ------------------------------ | ---------------------------------------------------------------------------------- |
| `lens-local-storage:read`  | `{ clusterId? }` → JSON object | the file of data-model.md; `{}` when missing, unreadable, invalid or not an object |
| `lens-local-storage:write` | `{ clusterId?, state }` → none | writes the file (contracts/store-format.md)                                        |

A `clusterId` that is present and is not a cluster of the core's catalog, the
empty string included, is refused with
`Cannot use the local storage of cluster "<clusterId>", which is not registered`,
on both channels. A write that fails is refused with the reason.

## Directories

`~` is resolved only when the path is exactly `~` (to `homeDirectory` above)
or exactly `~/` (to that directory and a `/`), as
`common/path/resolve-tilde.injectable.ts` does; `~/foo` is taken as it is.

`validate-directory`: `string` → `{ ok: true }` or `{ ok: false, error }`,
following symbolic links:

| Case                                                   | `error`                                                                                                                                    |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| a file, pipe, socket, block or character device, other | `the provided path is <a file \| a pipe \| a socket \| a block device \| a character device \| an unknown file type> and not a directory.` |
| `ENOENT`                                               | `the provided path does not exist.`                                                                                                        |
| `EACCES`                                               | `search permissions is denied for one of the directories in the prefix of the provided path.`                                              |
| `ELOOP`                                                | `the provided path is a sym-link which points to a chain of sym-links that is too long to resolve. Perhaps it is cyclic.`                  |
| `ENAMETOOLONG`                                         | `the pathname is too long to be used.`                                                                                                     |
| `ENOTDIR`                                              | `a prefix of the provided path is not a directory.`                                                                                        |
| any other errno                                        | `error: undefined`                                                                                                                         |

`path-exists`: `string` → `boolean`, true when the path, its symbolic links
followed, exists; never refused.

## Templates

| Channel                           | Kind | Core                                                                                                                           |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------ |
| `initial-user-resource-templates` | req  | none → `{ label, options: { label, value }[] }[]`; the first request starts the poll of research R8 and answers the first walk |
| `user-resource-templates-update`  | msg  | the same list, to every view, after each poll that finds a different one                                                       |

## download-json-channel

`{ url, opts?: { timeout? } }` → `{ callWasSuccessful: true, response }` or
`{ callWasSuccessful: false, error }`; never refused.

- A GET with no header of its own, no cookie and no credential, through the
  `httpsProxy` preference and `allowUntrustedCAs` as research R9 says.
- `error` strings:

| Case                             | `error`                                                                                                    |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| status outside 200 to 299        | `<status>: <reason>`, the reason as the status's standard phrase                                           |
| `timeout` given and passed       | `Operation timed out: timeout <duration>`, the duration as `common/fetch/timeout-controller.ts` formats it |
| proxy scheme not supported       | `Unsupported proxy URL scheme "<scheme>" in the HTTP Proxy preference: use http:, https: or socks5:`       |
| connection, proxy or TLS failure | `fetch failed: <the core's reason>`                                                                        |
| body not JSON                    | the core's parser message                                                                                  |

## Sync box

| Channel                          | Core                       |
| -------------------------------- | -------------------------- |
| `sync-box-initial-value-channel` | none → `[]`                |
| `sync-box-channel`               | heard, dropped; never sent |

## build-version

Answered since spec 002 (`src/version.rs`); unchanged.
