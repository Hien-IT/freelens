# Data Model: Main Cluster Connection

The entities the core keeps for this feature. Nothing here is a new file on
disk: what persists is the cluster store entry of spec 007 and the user's
kubeconfig files, in the formats the Electron build writes.

## Connection

One per cluster of the catalog, created on its first `activate-cluster`, kept
in `Clusters` (research R5).

| Field                       | Type                  | Rule                                                                                                 |
| --------------------------- | --------------------- | ---------------------------------------------------------------------------------------------------- |
| `cluster_id`                | string                | a cluster id of the catalog (spec 008)                                                               |
| `state`                     | ClusterState          | below                                                                                                |
| `activated`                 | bool                  | true at the end of an activation, whatever its status; false after a disconnect                      |
| `activation`                | shared future or none | the activation in flight, which a second non-forced request joins                                    |
| `generation`                | integer               | raised by a disconnect; an activation of an older generation applies nothing more                    |
| `consecutive_auth_failures` | integer               | counted failures of R5's table; reset by a success, a reconnect, a disconnect                        |
| `next_refresh_allowed_at`   | instant               | now + 60 s after the first counted failure, + 300 s after later ones                                 |
| `refreshing`                | bool                  | a status check in progress; a second one is skipped                                                  |
| `timers`                    | task or none          | the 30 s status and 15 min accessibility timers, bound once, stopped by a disconnect                 |
| `client`                    | Client or none        | R2; dropped by a disconnect, a change of the file, the cluster leaving the catalog, a new credential |

**Transitions** (FR-001, FR-019, FR-020):

```text
                activate (not activated)                 status check
 disconnected ─────────────────────────────► connecting ─────────────► connected
      ▲          "Starting connection ..."                  │   access granted, R6 done
      │                                                     │
      │                                                     ├─► offline (no answer)      ┐ activated = true;
      │                                                     └─► access denied (refused)   ┘ the 30 s timer retries
      │
      └── deactivate · delete · context leaves the file · quit
```

## ClusterState

What a view gets on `cluster-state-sync`, in this field order (R8).

| Field                  | Type     | Start | Set by                                                          |
| ---------------------- | -------- | ----- | --------------------------------------------------------------- |
| `online`               | bool     | false | status: not offline; network offline clears it                  |
| `ready`                | bool     | false | R6: any known resource; a disconnect clears it                  |
| `disconnected`         | bool     | true  | reconnect clears it; a disconnect sets it                       |
| `accessible`           | bool     | false | status: access granted; network offline and disconnect clear it |
| `isAdmin`              | bool     | false | R6 step 1; a disconnect keeps it                                |
| `allowedNamespaces`    | string[] | []    | R6 step 3; a disconnect clears it                               |
| `resourcesToShow`      | string[] | []    | R6 step 5, `<group>/<apiName>` or `<apiName>`                   |
| `knownResources`       | object[] | []    | R6 step 4, `{apiName, kind, group, version, namespaced}`        |
| `isGlobalWatchEnabled` | bool     | false | R6 step 2                                                       |

## Phase of a cluster entity

The `status.phase` and `status.enabled` of the cluster's entity on
`catalog:items` (R8): `deleting`, `enabled: false` while the cluster is in the
deleting set; else `connected` if accessible, `connecting` if not
disconnected, `disconnected` otherwise, `enabled: true`.

## Connection update

`{ message: string, level: "info" | "warning" | "error" }` on
`cluster:<clusterId>:connection-update`, to every view. The texts are in
[contracts/connection.md](./contracts/connection.md).

## Cluster metadata

The `metadata` of the cluster store entry: `version`, `lastSeen`, `id`,
`nodes`, `distribution`, and `prometheus`, which main-metrics writes and the
detection drops when it replaces the object (R7). `version` and `lastSeen` are
also written by each successful status check.

## Credential

What a credential plugin returned for one cluster (R3); in memory only.

| Field        | Type                         | Rule                                                                      |
| ------------ | ---------------------------- | ------------------------------------------------------------------------- |
| `token`      | string or none               | a bearer token                                                            |
| `client_tls` | certificate and key, or none | PEM; wins over a token, as kube and client-go take it                     |
| `expires_at` | time or none                 | renewed 60 s before it; none: renewed after a `401`                       |
| `run`        | process group or none        | the run in flight, which requests wait for; killed on disconnect and quit |

## Shell environment

The merged environment of R4: the core's own variables, the login shell's
added, its `PATH` first, `LANG` fixed; in memory only, never logged. It is
`pending` until the shell sync ends or gives up after 30 s, then `ready`; a
failure keeps the core's own environment and the error, sent once on
`shell-sync-failed-channel`.

## Watch

One per `kube-watch:open` (R10).

| Field           | Type        | Rule                                                             |
| --------------- | ----------- | ---------------------------------------------------------------- |
| `id`            | string      | chosen by the view, unique among its open watches                |
| `view`          | View        | the cluster frame that opened it; its cluster is the one watched |
| `request`       | in flight   | the API server's request, dropped to stop it                     |
| `decoder`       | UTF-8 state | the bytes of a character split across chunks                     |
| `last_activity` | instant     | ends the watch after 4 h without a chunk                         |

It ends on the API server's end, `kube-watch:close`, the view's queue
restarting or closing, the frame being forgotten, and the cluster being
disconnected, deleted or leaving the catalog.

## Kubeconfig lock

The directory `<real path of the kubeconfig>.lock` (R12): made with `mkdir`,
its modification time touched every 5 s while held, stale and taken over when
older than 10 s, removed on release. Held and not stale: `Lock file is already
being held`.
