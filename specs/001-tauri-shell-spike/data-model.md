# Data Model: Experimental Shell Spike

The spike keeps no persistent data. Everything below lives in the memory of
the core for one launch, or in the measurement output.

## Launch options

Parsed once from the process arguments ([contracts/launch-options.md](./contracts/launch-options.md)).

| Field         | Type                                | Rule                                                                                                              |
| ------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `kubeconfig`  | `Default` \| `File(path)` \| `None` | `Default` when the option is absent; `None` for `--kubeconfig=none`                                               |
| `openCluster` | context name, or none               | set by `--open-cluster`; for measurement runs only; a name that is not a context of the file in effect is ignored |

The `Default` file is `$HOME/.kube/config`. The `KUBECONFIG` variable is not
read, and only one file is ever read (FR-003, FR-004).

## Kubeconfig source

The file in effect, read once at launch.

| Field   | Type                                                     | Rule                                                       |
| ------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| `path`  | absolute path, or none                                   | the resolved path of the `Default` or chosen file          |
| `state` | `Read` \| `Missing` \| `Invalid(message)` \| `NotChosen` | `Missing` for an absent file; `Invalid` when parsing fails |

States and what the catalog shows (FR-008, edge cases):

| State                   | Catalog | Message                            |
| ----------------------- | ------- | ---------------------------------- |
| `Read`, with contexts   | entries | none                               |
| `Read`, no contexts     | empty   | none                               |
| `Missing`, chosen file  | empty   | names the missing file             |
| `Missing`, default file | empty   | none                               |
| `Invalid`               | empty   | names the file and the parse error |
| `NotChosen`             | empty   | none                               |

## Catalog entry (cluster)

One per context of the kubeconfig source (FR-005).

| Field    | Type             | Rule                                                                                                            |
| -------- | ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `id`     | 32 lowercase hex | MD5 of `<path>:<context name>`, as the current build computes it; unique within the catalog, a valid host label |
| `name`   | string           | the context name                                                                                                |
| `source` | absolute path    | the kubeconfig file                                                                                             |

The entry carries no user, cluster address or credential. The credentials stay
in the parsed kubeconfig inside the core and are used only to build the
client of the cluster (FR-015).

## Cluster view

The frame of one opened cluster, at `freelens-app://<id>.renderer.freelens.app/`.

| Field       | Type                                                                                  | Rule                                           |
| ----------- | ------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `clusterId` | catalog entry `id`                                                                    | taken from the first label of the frame's host |
| `state`     | `Loading` \| `Ready(namespaces)` \| `Unreachable` \| `Forbidden` \| `Failed(message)` | see transitions                                |

Transitions:

- opening the cluster creates the frame in `Loading`, or shows the existing
  frame if one exists (User Story 3, scenario 4);
- the namespace list request answers `200` → `Ready`; a connection failure or
  timeout → `Unreachable`; `403` → `Forbidden`; anything else → `Failed`;
- closing the frame discards it; opening the cluster again starts from
  `Loading` and requests the list again (FR-006). The list is not updated while
  the frame stays open.

The core keeps one `kube::Client` per cluster id, created on the first request
of its frame and dropped when the application quits.

## Namespace

| Field  | Type   | Rule                                     |
| ------ | ------ | ---------------------------------------- |
| `name` | string | `metadata.name` of each item of the list |

The frame shows names only, in the order the API server returns them.

## Measurement run

One launch of a build under the conditions of `specs/baseline.md`
([contracts/measurement-report.md](./contracts/measurement-report.md)).

| Field              | Type                     | Applies to                                     |
| ------------------ | ------------------------ | ---------------------------------------------- |
| `build`            | `electron` \| `spike`    | both                                           |
| `run`              | integer from 1           | both                                           |
| `startupS`         | seconds, 2 decimals      | idle runs                                      |
| `idleRssMb`        | MB, KiB of `ps` / 1024   | idle runs                                      |
| `processes`        | list of `pid name rssMb` | every run                                      |
| `namespacesShownS` | seconds                  | cluster-open runs                              |
| `clusterRssMb`     | MB, KiB of `ps` / 1024   | cluster-open runs, 60 s after the list appears |

Medians of three runs per figure go into the report.
