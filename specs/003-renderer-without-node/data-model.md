# Data Model: Renderer Without Node

Phase 1 of [plan.md](./plan.md). The feature stores nothing new: every file it
touches already exists and keeps its format. These are the values that cross
from main to the views, and the lists that track the work. All values are JSON
(FR-018). Field types are TypeScript; `ClusterId` and `ExtensionId` are the
existing string aliases.

## MachineValues

Answer of `machine-values`; read once per view before the frame starts and held
in a state injectable (research R4). Fixed for the life of the process.

| Field             | Type                             | From main's                                                          | Read in the renderer by                                                                         |
| ----------------- | -------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `platform`        | `"darwin" \| "linux" \| "win32"` | `platformInjectable`                                                 | `is-mac`, `is-linux`, `is-windows`, `normalized-platform`, `Common.App.is*`, the path port (R7) |
| `isDebugging`     | `boolean`                        | `isDebuggingInjectable`                                              | `api-base`, `create-kube-json-api-for-cluster`                                                  |
| `isSnap`          | `boolean`                        | `isSnapPackageInjectable`                                            | `Common.App.isSnap`                                                                             |
| `isFlatpak`       | `boolean`                        | `isFlatpakPackageInjectable`                                         | `Common.App.isFlatpak`                                                                          |
| `homeDirectory`   | `string`                         | `homeDirectoryPathInjectable`, with the integration-testing override | `resolve-tilde` placeholders                                                                    |
| `kubeDirectory`   | `string`                         | `kubeDirectoryPathInjectable`                                        | default `syncKubeconfigEntries`, kubeconfig-sync view, add-cluster dialog `defaultPath`         |
| `bundledHelmPath` | `string`                         | `bundledBinaryPath("helm")`                                          | `helm-path-to-binary.tsx` placeholder                                                           |

Rules:

- Reading a value before the state is set throws, as `app-paths-state` does.
- No field is a credential, and none is computed in the renderer.

## Store snapshot entry

Element of the answer of `persistent-storage-initial-values` (R5).

| Field   | Type        | Meaning                                                                                                                     |
| ------- | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `path`  | `string`    | main's `config.path`; the renderer uses it as the store's id and in `store-sync-main:<path>` / `store-sync-renderer:<path>` |
| `model` | JSON object | the store's current contents in main's memory                                                                               |

Rules:

- Main answers only with stores it has loaded.
- The renderer registers its `store-sync-renderer` listeners before it asks.
- A renderer store whose path is missing from the answer fails to load, with an
  error naming the store.

## Extension store snapshot entry

Element of the answer of `extension-store-initial-values` (R5).

| Field        | Type        | Meaning                                                       |
| ------------ | ----------- | ------------------------------------------------------------- |
| `configName` | `string`    | the store's file name without `.json`                         |
| `path`       | `string`    | the file, computed by main in the extension's store directory |
| `model`      | JSON object | main's loaded model of that store, else the parsed file       |

Rules:

- Main reads only the extension's own store directory.
- A file that is encrypted, or does not parse, is left out, and its store fails
  to load in the renderer, alone (FR-015).

## Local storage request

Values of `lens-local-storage:read` and `lens-local-storage:write`.

| Field       | Type                     | Meaning                                                               |
| ----------- | ------------------------ | --------------------------------------------------------------------- |
| `clusterId` | `ClusterId \| undefined` | the cluster frame's storage; `undefined` is the window's (`app.json`) |
| `state`     | JSON object              | the whole file, on write                                              |

Main builds `<userData>/lens-local-storage/<clusterId|app>.json`. A cluster id
that is not a registered cluster is refused.

## Staged extension

What `extension-install:stage-from-path` and `stage-from-url` answer
([contracts/channels.md](./contracts/channels.md)).

| Field       | Type                       | Meaning                                              |
| ----------- | -------------------------- | ---------------------------------------------------- |
| `kind`      | `"directory" \| "package"` | a development folder or a tarball                    |
| `stagingId` | `string`                   | opaque, main's; present for `"package"`              |
| `fileName`  | `string`                   | the package's file name, for the confirm dialog      |
| `manifest`  | `{ name, version, … }`     | the validated `package.json` fields the dialogs show |
| `verified`  | `boolean`                  | whether a checksum matched                           |

State, in main:

```text
staged ──commit──▶ installed (unpacked, activated) ──▶ forgotten
   │
   └──discard / app quit──▶ removed
```

A `stagingId` is valid for one commit or discard. Main removes staged files it
still holds when the app quits.

## Kubeconfig summary

Answer of `cluster-kubeconfig-contexts`.

| Field              | Type                  | Meaning                                        |
| ------------------ | --------------------- | ---------------------------------------------- |
| `contexts`         | `string[]`            | context names of the cluster's kubeconfig file |
| `currentContext`   | `string \| undefined` | its `current-context`                          |
| `defaultNamespace` | `string \| undefined` | the namespace of the cluster's context         |

It never carries a certificate, key, token or server credential (FR-012 of spec
002).

## Pasted kubeconfig check

Answer of `parse-kubeconfig-text`.

| Field      | Type                                 | Meaning                                                |
| ---------- | ------------------------------------ | ------------------------------------------------------ |
| `contexts` | `{ name: string; error?: string }[]` | each context found, with the reason it cannot be added |
| `error`    | `string \| undefined`                | why the text as a whole does not parse                 |

## Resource templates

`RawTemplates` of `renderer/components/dock/create-resource/create-resource-templates.injectable.ts`,
unchanged: `[groupTitle, { label, value }[]]`, with the file contents as
strings. Sent whole on request and on each change.

## View bridge

The object the preload puts on `window` ([contracts/preload-bridge.md](./contracts/preload-bridge.md)).
It has no state of its own.

## Renderer bundle list entry

An element of the `rendererBundle` list of
`scripts/type-check-environments/legacy.jsonc`
([contracts/bundle-gate.md](./contracts/bundle-gate.md)): the repository path of
a workspace module that brings a Node builtin or `electron` into the renderer
bundle, itself or through a package it imports.

State: listed → removed once it brings no Node in. The list may only shrink,
and it ends empty and gone.

## Legacy inventory entry

A row of [contracts/legacy-inventory.md](./contracts/legacy-inventory.md): a
file, its Node use, its disposition (S, I, C, M, D of research R1), the channel
or replacement, and the user story it belongs to. A file leaves the renderer
legacy list and the Biome exemption in one change.

## Channel list entry

A row added to `specs/002-messaging-for-tauri/contracts/channel-list.md`, with
the columns that list defines. Its owner is a core area of R9 of spec 001, or
"Not ported" for a channel that serves only the extension system.
