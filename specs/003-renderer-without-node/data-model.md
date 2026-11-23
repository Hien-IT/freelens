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

| Field        | Type        | Meaning                                                                                                                     |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------------------- |
| `configName` | `string`    | the store's `configName`, the key a renderer store finds its entry by                                                       |
| `path`       | `string`    | main's `config.path`; the renderer uses it as the store's id and in `store-sync-main:<path>` / `store-sync-renderer:<path>` |
| `model`      | JSON object | the store's current contents in main's memory                                                                               |

Rules:

- Main answers only with stores it has loaded.
- The renderer registers its `store-sync-renderer:<path>` listeners as soon as
  the answer arrives (research R5).
- A renderer store whose path is missing from the answer fails to load, with an
  error naming the store.

## Extension store read

Request and answer of `extension-store:read`, the synchronous IPC of the
extension system (R5).

| Field           | Type                  | Meaning                                                                        |
| --------------- | --------------------- | ------------------------------------------------------------------------------ |
| `extensionId`   | `ExtensionId`         | the extension whose store directory main reads                                 |
| `configName`    | `string`              | the store's file name without its extension                                    |
| `fileExtension` | `string \| undefined` | `conf`'s `fileExtension`; `json` when undefined                                |
| `encryptionKey` | `string \| undefined` | `conf`'s `encryptionKey`, when the store has one                               |
| `cwd`           | `string \| undefined` | the `cwd` the extension gave the store, read as given (FR-007)                 |
| `path`          | `string`              | answer: the file, computed by main as `conf` computes it in the store's folder |
| `contents`      | `string \| null`      | answer: the file's text, decrypted when keyed; `null` when there is no file    |

Rules:

- The store's folder is `cwd` when the extension gave one, else
  `<userData>/extension-store/<storeName>/` of that extension, which main
  computes.
- A `configName` or `fileExtension` with a path separator or `..` is refused.
- A file that does not decrypt fails as `conf` fails on the same file, with an
  error naming the store; the store fails to load, alone (FR-015).

## Extension store write

Request of `extension-store:write` (R5).

| Field           | Type                  | Meaning                                                                                                        |
| --------------- | --------------------- | -------------------------------------------------------------------------------------------------------------- |
| `extensionId`   | `ExtensionId`         | as in Extension store read                                                                                     |
| `configName`    | `string`              | as in Extension store read                                                                                     |
| `fileExtension` | `string \| undefined` | as in Extension store read                                                                                     |
| `encryptionKey` | `string \| undefined` | as in Extension store read; main encrypts `contents` with it                                                   |
| `cwd`           | `string \| undefined` | as in Extension store read                                                                                     |
| `contents`      | `string`              | the serialized store, as the store's `serialize` made it; main encrypts it when keyed and writes it atomically |

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

A union on `kind`:

```ts
// The shape only.
type StagedExtension =
  | { kind: "directory"; manifest: Manifest }
  | { kind: "package"; stagingId: string; fileName: string; manifest: Manifest; verified: boolean };
```

| Field       | Type                                                      | Meaning                                                                                                                                 |
| ----------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `kind`      | `"directory" \| "package"`                                | a development folder, which goes on with `extension-install:register-directory`, or a tarball, which goes on with `commit` or `discard` |
| `stagingId` | `string`, `"package"` only                                | opaque, main's                                                                                                                          |
| `fileName`  | `string`, `"package"` only                                | the package's file name, for the confirm dialog                                                                                         |
| `manifest`  | `{ name: string; version: string; description?: string }` | the validated `package.json` fields the dialogs show                                                                                    |
| `verified`  | `boolean`, `"package"` only                               | whether a checksum matched                                                                                                              |

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
unchanged: `{ label, options: { label, value }[] }[]`. Sent whole on request
and on each change.

| Field             | Type     | Meaning                                                                                |
| ----------------- | -------- | -------------------------------------------------------------------------------------- |
| `label`           | `string` | the group: the template's folder relative to `~/.freelens/templates`, or `"ungrouped"` |
| `options[].label` | `string` | the template's file name without its extension                                         |
| `options[].value` | `string` | the file's contents                                                                    |

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
