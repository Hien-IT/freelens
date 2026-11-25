# Contract: The Channels of Main-Catalog

FR-013 to FR-018; research R6 to R8. The channel names are those of the
Electron build (`specs/002-messaging-for-tauri/contracts/channel-list.md`).
No answer or message carries a credential or the text of a kubeconfig file
(FR-014).

| Channel                         | Kind | Dir | Request             | Answer or message                                                                                      |
| ------------------------------- | ---- | --- | ------------------- | ------------------------------------------------------------------------------------------------------ |
| `catalog:init`                  | msg  | v→m | none                | sends `catalog:items` to every view, coalesced                                                         |
| `catalog:items`                 | msg  | m→v | —                   | the entities of contracts/catalog-entities.md                                                          |
| `cluster-visibility`            | msg  | v→m | `ClusterId \| null` | sets the visible cluster of `status.active`; an unknown id is kept, and marks nothing until it appears |
| `get-all-clusters`              | req  | v→m | none                | `ClusterInfo[]`, the clusters in catalog order                                                         |
| `get-cluster-by-id`             | req  | v→m | `ClusterId`         | `ClusterInfo`, or no value for an unknown or empty id                                                  |
| `discover-kubeconfig-sync-kind` | req  | v→m | a path              | `{ kind: "file" }`, `{ kind: "dir" }` or `{ error }`                                                   |
| `parse-kubeconfig-text`         | req  | v→m | pasted text         | `{ contexts: { name, error? }[], error? }`                                                             |
| `add-kubeconfig-text`           | req  | v→m | pasted text         | `{ added: string[] }`                                                                                  |

## `catalog:items`

The whole catalog, never a part, coalesced as the Electron build's
broadcaster coalesces it: a change while no timer runs is sent at once, every
change restarts a 100 ms timer, and when the timer ends the entities as they
are then are sent, if anything changed after the send made at once. It is
also sent, through the same coalescing, when a cluster frame records its
frame id, as `main/cluster/set-frame-id-listener.injectable.ts` of the
Electron build sends it. Each send logs `Catalog: sent <n> entities`.

## `ClusterInfo`

```json
{
  "id": "<uid>",
  "name": "<metadata.name>",
  "kubeConfigPath": "<spec.kubeconfigPath>",
  "contextName": "<spec.kubeconfigContext>",
  "status": "disconnected",
  "labels": { "<label>": "<value>" },
  "isActive": false,
  "metadata": { "distribution": "<metadata.distro>", "kubernetesVersion": "<metadata.kubeVersion>" }
}
```

`status` maps the entity's phase: `connected`, `connecting` and
`disconnected` to themselves, `deleting` to `disconnecting`, anything else to
`disconnected`. `labels` leaves out a label with no value. `isActive` is
always `false`, as in the Electron build's main side.

## `discover-kubeconfig-sync-kind`

A stat that follows symbolic links; nothing of the contents is read.

| Path                        | Answer                                                                  |
| --------------------------- | ----------------------------------------------------------------------- |
| a file                      | `{ "kind": "file" }`                                                    |
| a directory                 | `{ "kind": "dir" }`                                                     |
| anything else (a socket, …) | `{ "error": "unknown stat entry" }`, and a warning                      |
| a failed stat               | `{ "error": "Error: <CODE>: <message>, stat '<path>'" }`, and a warning |

`<CODE>` and `<message>` are Node's for `ENOENT` (`no such file or
directory`), `EACCES` (`permission denied`), `ENOTDIR` (`not a directory`),
`ELOOP` (`too many symbolic links encountered`), `ENAMETOOLONG` (`name too
long`) and `EIO` (`i/o error`); another error gives its code alone.

## `parse-kubeconfig-text`

The text is trimmed, and `{}` stands for empty text. It is loaded by the rules
of contracts/synced-files.md, "Loading".

| Outcome                   | Answer                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------ |
| the loader throws         | `{ "contexts": [], "error": "Error: <message>" }` (`invalid YAML: …`, `contexts[<i>].context is missing`, …) |
| loaded                    | `contexts`: every context of the split, in file order, with `error` when its validation fails                |
| loaded with schema errors | the same, and `error`: `ValidationError: <the Joi messages joined by ". ">`                                  |

A context's error is `Error: No valid <context|cluster|user> object provided
in kubeconfig for context '<name>'`.

## `add-kubeconfig-text`

Writes the trimmed text, UTF-8, to `<data dir>/kubeconfigs/<random uuid v4>`
with mode `0600`, creating the directory first; answers the names of every
context `parse-kubeconfig-text` finds in the text, valid or not. The file then
reaches the catalog through the sync of that directory, like any other.
