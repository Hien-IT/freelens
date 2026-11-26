# Contract: The Channels of main-cluster-connection

FR-009 to FR-011, FR-019 to FR-027, FR-034; research R11 to R14. Each row of
the channel list's section "main-cluster-connection", with the core's answer.
The payloads are those of the list; `<id>` is a cluster id.

**Frame rule** (FR-026): a request below that names a cluster, sent by a
cluster frame for a cluster other than its own, is refused with the error
`<channel> is answered only for the sending frame's own cluster`, changes
nothing, and is logged. The main window may name any cluster.

| Channel                                  | Answer of the core                                                                                                                                                                                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `activate-cluster`                       | [connection.md](./connection.md), "Activation"; no value                                                                                                                                                                                                                      |
| `deactivate-cluster`                     | unknown id: nothing; else disconnect (below) and forget the frame of spec 004; no value                                                                                                                                                                                       |
| `set-cluster-as-deleting`                | adds the id to the deleting set, any id; the entity's phase becomes `deleting`, `enabled: false`; no value                                                                                                                                                                    |
| `clear-cluster-as-deleting`              | removes the id; the phase is computed again at once; no value                                                                                                                                                                                                                 |
| `delete-cluster`                         | unknown id: nothing; else disconnect, forget the frame, remove the cluster store entry through `Stores::update`, remove `<data dir>/lens-local-storage/<id>.json` ignoring an error; no value                                                                                 |
| `execute-on-cluster`                     | the handler of research R13: `503` `ClusterNotAccessible` for an unknown or inaccessible cluster, `500` `ConfigurationError` for a context without a server, `400` `BadRequest` for an unknown operation, else the operation's `{success, data}` or `{success: false, error}` |
| `cluster-state-sync`                     | sent by the core, [connection.md](./connection.md), "State and phase"                                                                                                                                                                                                         |
| `initial-cluster-state-sync`             | `[{clusterId, state}]` for every cluster of the catalog                                                                                                                                                                                                                       |
| `cluster:refresh-accessibility`          | unknown id: `true` at once; else the accessibility and the metadata, then `true`; a failure is the request's error                                                                                                                                                            |
| `cluster:list-namespace-forbidden`       | sent by the core with the id, [connection.md](./connection.md), "Accessibility" step 3                                                                                                                                                                                        |
| `cluster:<id>:connection-update`         | sent by the core, one name per cluster, `{message, level}`                                                                                                                                                                                                                    |
| `network:offline`                        | every cluster not disconnected: `online` and `accessible` cleared, then a status check, without regard to the backoff                                                                                                                                                         |
| `network:online`                         | every cluster not disconnected: a status check, without regard to the backoff                                                                                                                                                                                                 |
| `cluster-kubeconfig-contexts`            | unknown id: error `Cluster "<id>" is not registered`; a file with an entry that fails validation: that error; else `{contexts, currentContext?, defaultNamespace?}`, the namespace of the cluster's own context, never a credential                                           |
| `remove-cluster-context-from-kubeconfig` | unknown id: the same error; else under the lock of data-model.md, the cluster's context removed and `current-context` set to `newCurrentContext` when given; the file otherwise kept; held lock: error `Lock file is already being held`; no value                            |
| `shell-sync-failed-channel`              | sent by the core to the main window, once, when its page first loads after the shell sync failed ([shell-sync.md](./shell-sync.md))                                                                                                                                           |

**Disconnect** (FR-019): already disconnected: drops the client and kills a
credential plugin run, nothing else. Otherwise: the backoff reset, the timers
stopped, the client dropped, every watch and request in flight of the cluster
dropped, a plugin run killed, `disconnected` set, `online`, `accessible`,
`ready` and `allowedNamespaces` cleared, the rest of the state kept,
`activated` false; logged `[CLUSTER]: disconnecting` and `[CLUSTER]:
disconnected`.

**A cluster leaving the catalog** (FR-020): if it has a cluster store entry, it
is disconnected and logged `[CLUSTER]: cluster left the catalog,
disconnecting`.

**Quitting** (FR-024): every cluster disconnected; the shell sync's shell
killed if it still runs.

## Rows of the channel list

`activate-cluster` to `remove-cluster-context-from-kubeconfig` stay in the
section "main-cluster-connection" with the note that the core answers them
in 009 (`src/cluster/channels.rs`). `shell-sync-failed-channel` moves there
from "main-shell-env". The four channels of [kube-watch.md](./kube-watch.md)
are added as rows of the Tauri build only, with the reason (research R10).
