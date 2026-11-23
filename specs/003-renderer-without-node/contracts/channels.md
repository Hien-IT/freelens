# Contract: Channels Added by This Feature

Every channel the renderer needs once it has no Node (research R4 to R6). Each
row is added to `specs/002-messaging-for-tauri/contracts/channel-list.md` in the
change that adds the channel (FR-017). Shapes are in
[data-model.md](../data-model.md).

- **Kind**: `req`, one answer; `msg`, one-way.
- **Electron**: where main answers, relative to `packages/core/src/`. Each
  channel is defined once in the `common/` directory beside it, as
  `getRequestChannel` / `getMessageChannel` of `@freelensapp/messaging`.
- **Owner**: the core area of R9 of spec 001 that answers it in the Tauri build,
  or "Not ported" for the extension system.

## Startup values

| Channel                             | Kind | Request → answer                                              | Electron                            | Owner           |
| ----------------------------------- | ---- | ------------------------------------------------------------- | ----------------------------------- | --------------- |
| `machine-values`                    | req  | none → `MachineValues`                                        | `features/machine-values/main/`     | main-foundation |
| `persistent-storage-initial-values` | req  | none → `{ path, model }[]`                                    | `features/persistent-storage/main/` | main-foundation |
| `lens-local-storage:read`           | req  | `{ clusterId? }` → JSON object, `{}` when the file is missing | `features/local-storage/main/`      | main-foundation |
| `lens-local-storage:write`          | req  | `{ clusterId?, state }` → none                                | the same                            | main-foundation |

## Files and settings

| Channel                           | Kind | Request → answer                                                                     | Electron                                 | Owner             |
| --------------------------------- | ---- | ------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------- |
| `initial-user-resource-templates` | req  | none → `RawTemplates[]`                                                              | `features/user-resource-templates/main/` | main-foundation   |
| `user-resource-templates-update`  | msg  | m→v `RawTemplates[]`                                                                 | the same                                 | main-foundation   |
| `validate-directory`              | req  | `string`, a path the user typed → `{ ok: true } \| { ok: false, error }`             | `features/validate-directory/main/`      | main-foundation   |
| `path-exists`                     | req  | `string`, a path the user typed → `boolean`                                          | `features/validate-directory/main/`      | main-foundation   |
| `discover-kubeconfig-sync-kind`   | req  | `string`, a path the user typed or picked → `{ kind: "file" \| "dir" } \| { error }` | `features/kubeconfig-sync-kind/main/`    | main-catalog      |
| `wait-until-port-free`            | req  | `{ port: number }` → none                                                            | `features/port-forward/main/`            | main-port-forward |

## Kubeconfig

| Channel                                  | Kind | Request → answer                                                            | Electron                                   | Owner                     |
| ---------------------------------------- | ---- | --------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| `parse-kubeconfig-text`                  | req  | `string`, text the user pasted → `{ contexts: { name, error? }[], error? }` | `features/add-cluster/main/`               | main-catalog              |
| `add-kubeconfig-text`                    | req  | `string`, text the user pasted → `{ added: string[] }`                      | the same                                   | main-catalog              |
| `cluster-kubeconfig-contexts`            | req  | `ClusterId` → `{ contexts, currentContext?, defaultNamespace? }`            | `features/cluster/delete-dialog/main/`     | main-cluster-connection   |
| `remove-cluster-context-from-kubeconfig` | req  | `{ clusterId, newCurrentContext? }` → none                                  | the same                                   | main-cluster-connection   |
| `reveal-cluster-kubeconfig`              | req  | `ClusterId` → none                                                          | `features/cluster/reveal-kubeconfig/main/` | desktop-integration (006) |

## Links

| Channel                | Kind | Request → answer       | Electron                              | Owner                     |
| ---------------------- | ---- | ---------------------- | ------------------------------------- | ------------------------- |
| `open-link-in-browser` | req  | `string`, a URL → none | `features/open-link-in-browser/main/` | desktop-integration (006) |

## Extension system (Not ported: the Tauri build has no extension system)

| Channel                                | Kind | Request → answer                                                           | Electron                                   |
| -------------------------------------- | ---- | -------------------------------------------------------------------------- | ------------------------------------------ |
| `extension-install:stage-from-path`    | req  | `{ path }`, a path the user picked, dropped or typed → staged extension    | `features/extensions/installer/main/`      |
| `extension-install:stage-from-url`     | req  | `{ url, checksum?, source }` → staged extension                            | the same                                   |
| `extension-install:commit`             | req  | `{ stagingId }` → `{ id, version, verified }`                              | the same                                   |
| `extension-install:discard`            | req  | `{ stagingId }` → none                                                     | the same                                   |
| `extension-install:register-directory` | req  | `{ path }`, a folder the user picked or typed → none                       | the same                                   |
| `extension-install:open-folder`        | req  | `{ name }` → none                                                          | the same                                   |
| `extension:uninstall`                  | req  | `ExtensionId` → none                                                       | the same                                   |
| `extension-file-folder`                | req  | `ExtensionId` → `string`                                                   | `features/extensions/file-folder/main/`    |
| `extension-store-initial-values`       | req  | `ExtensionId` → `{ configName, path, model }[]`                            | `features/extensions/stores/main/`         |
| `extension-files:write-picked`         | req  | `{ uploadDir, files: { name, base64 }[] }` → `string[]`, the paths written | `features/extensions/file-picker/main/`    |
| `extension-resource-stack:read-folder` | req  | `{ folderPath }` → `{ name, contents }[]`                                  | `features/extensions/resource-stack/main/` |

## Rules for every channel

1. **One task.** No channel takes a program or a command line, and none reads
   or writes the contents of a file at a path a view sends, except:
   - a path the user chose in that view (`stage-from-path`,
     `register-directory`, `validate-directory`, `path-exists`,
     `discover-kubeconfig-sync-kind`);
   - a folder inside the install or data directory of an installed extension,
     which main computes (`write-picked`, `read-folder`; FR-007).

   `validate-directory`, `path-exists` and `discover-kubeconfig-sync-kind` read
   no contents, only whether the path exists and its kind.
2. **Main computes every other path** from what it knows: the user data
   directory, a cluster's `kubeConfigPath`, an extension's directories.
3. **The folder rule** (`write-picked`, `read-folder`):
   - Main resolves the folder, follows symlinks, and accepts it only when the
     result is inside `<extensionsRoot>/<name>/` or the extension's data
     directory (`directory-for-extension-data`) of an installed extension.
   - A file name with a path separator, or `..`, is refused.
   - A refusal is an error whose message names the folder and the rule.
4. **No credentials to a view.** No answer carries a certificate, key, token or
   password from a kubeconfig file. The kubeconfig channels answer with names,
   namespaces and errors (FR-012 of spec 002).
5. **Failures.** A failure is thrown by main's listener, and the renderer's
   request rejects with its message. The renderer shows it as it shows that
   failure today: same notification, same text (FR-005).
6. **Links.** `open-link-in-browser` accepts `http:` and `https:` URLs only and
   refuses any other with an error, in main, whatever the renderer checked.
7. **Values.** Every request and answer is JSON. File contents are strings, or
   base64 strings for bytes, as `pod-files` does. No entry in the channel list
   is marked `non-JSON` (FR-018).
8. **Tests.** Each channel has a unit test of the renderer's request against
   `messaging-fake-bridge` and a unit test of main's listener, including its
   refusals (FR-020).
