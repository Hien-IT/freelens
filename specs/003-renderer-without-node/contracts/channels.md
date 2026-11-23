# Contract: Channels Added by This Feature

Every channel the renderer needs once it has no Node (research R4 to R6). Each
row is added to `specs/002-messaging-for-tauri/contracts/channel-list.md` in the
change that adds the channel (FR-017). Requests and answers are written inline;
the larger shapes (`MachineValues`, the staged extension, the kubeconfig
answers, the extension store values, `RawTemplates`) are in
[data-model.md](../data-model.md).

- **Kind**: `req`, one answer; `msg`, one-way; `sync`, one answer that the
  view waits for, used only by the extension system (`extension-store:read`).
- **Dir**: `v→m`, view to main; `m→v`, main to every view.
- **Electron**: where main answers, relative to `packages/core/src/`. Each
  channel is defined once in the `common/` directory beside it, as
  `getRequestChannel` / `getMessageChannel` of `@freelensapp/messaging`; the
  extension stores' channels are the extension system's own IPC.
- **Owner**: the core area of R9 of spec 001 that answers it in the Tauri build,
  or "Not ported" for the extension system.

## Startup values

| Channel                             | Kind | Dir | Request → answer                                              | Electron                            | Owner           |
| ----------------------------------- | ---- | --- | ------------------------------------------------------------- | ----------------------------------- | --------------- |
| `machine-values`                    | req  | v→m | none → `MachineValues`                                        | `features/machine-values/main/`     | main-foundation |
| `persistent-storage-initial-values` | req  | v→m | none → `{ configName, path, model }[]`                        | `features/persistent-storage/main/` | main-foundation |
| `lens-local-storage:read`           | req  | v→m | `{ clusterId? }` → JSON object, `{}` when the file is missing | `features/local-storage/main/`      | main-foundation |
| `lens-local-storage:write`          | req  | v→m | `{ clusterId?, state }` → none                                | the same                            | main-foundation |

## Files and settings

| Channel                           | Kind | Dir | Request → answer                                                                     | Electron                                 | Owner             |
| --------------------------------- | ---- | --- | ------------------------------------------------------------------------------------ | ---------------------------------------- | ----------------- |
| `initial-user-resource-templates` | req  | v→m | none → `RawTemplates[]`                                                              | `features/user-resource-templates/main/` | main-foundation   |
| `user-resource-templates-update`  | msg  | m→v | `RawTemplates[]`                                                                     | the same                                 | main-foundation   |
| `validate-directory`              | req  | v→m | `string`, a path the user typed → `{ ok: true } \| { ok: false, error }`             | `features/validate-directory/main/`      | main-foundation   |
| `path-exists`                     | req  | v→m | `string`, a path the user typed → `boolean`                                          | the same                                 | main-foundation   |
| `discover-kubeconfig-sync-kind`   | req  | v→m | `string`, a path the user typed or picked → `{ kind: "file" \| "dir" } \| { error }` | `features/kubeconfig-sync-kind/main/`    | main-catalog      |
| `wait-until-port-free`            | req  | v→m | `{ port: number }` → none                                                            | `features/port-forward/main/`            | main-port-forward |

## Kubeconfig

| Channel                                  | Kind | Dir | Request → answer                                                            | Electron                                   | Owner                     |
| ---------------------------------------- | ---- | --- | --------------------------------------------------------------------------- | ------------------------------------------ | ------------------------- |
| `parse-kubeconfig-text`                  | req  | v→m | `string`, text the user pasted → `{ contexts: { name, error? }[], error? }` | `features/add-cluster/main/`               | main-catalog              |
| `add-kubeconfig-text`                    | req  | v→m | `string`, text the user pasted → `{ added: string[] }`                      | the same                                   | main-catalog              |
| `cluster-kubeconfig-contexts`            | req  | v→m | `ClusterId` → `{ contexts, currentContext?, defaultNamespace? }`            | `features/cluster/delete-dialog/main/`     | main-cluster-connection   |
| `remove-cluster-context-from-kubeconfig` | req  | v→m | `{ clusterId, newCurrentContext? }` → none                                  | the same                                   | main-cluster-connection   |
| `reveal-cluster-kubeconfig`              | req  | v→m | `ClusterId` → none                                                          | `features/cluster/reveal-kubeconfig/main/` | desktop-integration (006) |

## Links

| Channel                | Kind | Dir | Request → answer       | Electron                              | Owner                     |
| ---------------------- | ---- | --- | ---------------------- | ------------------------------------- | ------------------------- |
| `open-link-in-browser` | req  | v→m | `string`, a URL → none | `features/open-link-in-browser/main/` | desktop-integration (006) |

## Extension system (Not ported: the Tauri build has no extension system)

| Channel                                | Kind | Dir | Request → answer                                                                           | Electron                                   |
| -------------------------------------- | ---- | --- | ------------------------------------------------------------------------------------------ | ------------------------------------------ |
| `extension-install:stage-from-path`    | req  | v→m | `{ path }`, a package or folder path → staged extension                                    | `features/extensions/installer/main/`      |
| `extension-install:stage-from-url`     | req  | v→m | `{ url, checksum?, source }` → staged extension                                            | the same                                   |
| `extension-install:commit`             | req  | v→m | `{ stagingId }` → `{ id, version, verified }`                                              | the same                                   |
| `extension-install:discard`            | req  | v→m | `{ stagingId }` → none                                                                     | the same                                   |
| `extension-install:register-directory` | req  | v→m | `{ path }`, a folder path → none                                                           | the same                                   |
| `extension-install:open-folder`        | req  | v→m | `{ name }` → none                                                                          | the same                                   |
| `extension:uninstall`                  | req  | v→m | `ExtensionId` → none                                                                       | the same                                   |
| `extension-file-folder`                | req  | v→m | `ExtensionId` → `string`                                                                   | `features/extensions/file-folder/main/`    |
| `extension-files:write-picked`         | req  | v→m | `{ uploadDir, files: { name, base64 }[] }` → `string[]`, the paths written                 | `features/extensions/file-picker/main/`    |
| `extension-resource-stack:read-folder` | req  | v→m | `{ folderPath }` → `{ name, contents }[]`                                                  | `features/extensions/resource-stack/main/` |
| `extension-store:read`                 | sync | v→m | `{ extensionId, configName, fileExtension?, encryptionKey?, cwd? }` → `{ path, contents }` | `extensions/stores/main/`                  |
| `extension-store:write`                | req  | v→m | `{ extensionId, configName, fileExtension?, encryptionKey?, cwd?, contents }` → none       | the same                                   |

`extension-store:read` is the one synchronous channel.
`ExtensionStore.loadExtension` is synchronous and public, so it uses the
extension system's own Electron IPC (`ipcRenderer.sendSync` through the bridge,
`event.returnValue` in main). It lives under `packages/core/src/extensions/`,
whose IPC spec 002 and FR-013 exempt (research R5).

## Rules for every channel

1. **One task.** No channel takes a program or a command line, and none reads
   or writes the contents of a file at a path a view sends, except:
   - a path the user chose in that view (`stage-from-path`,
     `register-directory`, `validate-directory`, `path-exists`,
     `discover-kubeconfig-sync-kind`);
   - a folder an extension passes to the extension API, read or written as
     today (`write-picked`, `read-folder`, the `cwd` of `extension-store:read`
     and `:write`; FR-007).

   `validate-directory`, `path-exists` and `discover-kubeconfig-sync-kind` read
   no contents, only whether the path exists and its kind.
2. **The rules bound what a channel does, not who calls it.** Main cannot tell
   whether a path came from the user, and with context isolation off any script
   in a page can call any channel, as it can use Node today (FR-007).
3. **Main computes every other path** from what it knows: the user data
   directory, a cluster's `kubeConfigPath`, an extension's directories.
4. **Names.** A file name, `configName` or `fileExtension` with a path
   separator or `..` is refused, with an error naming it.
5. **No credentials to a view.** No answer carries a certificate, key, token or
   password from a kubeconfig file. The kubeconfig channels answer with names,
   namespaces and errors (FR-012 of spec 002).
6. **Failures.** A failure is thrown by main's listener, and the renderer's
   request rejects with its message. The renderer shows it as it shows that
   failure today: same notification, same text (FR-005).
7. **Links.** `open-link-in-browser` accepts `http:` and `https:` URLs only and
   refuses any other with an error, in main, whatever the renderer checked.
8. **Values.** Every request and answer is JSON. File contents are strings, or
   base64 strings for bytes, as `pod-files` does. No entry in the channel list
   is marked `non-JSON` (FR-018).
9. **Tests.** Each channel has a unit test of the renderer's side against
   `messaging-fake-bridge` (or, for `extension-store:read`, a fake `sendSync`)
   and a unit test of main's listener, including its refusals (FR-020).
