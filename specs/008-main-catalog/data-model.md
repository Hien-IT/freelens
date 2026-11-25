# Data Model: Main Catalog

## Sync

One per entry of the kubeconfig sync setting, one for the application's
kubeconfig directory, and one for a `--kubeconfig=<path>` given at launch.

| Field     | Meaning                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `path`    | as the setting names it, normalized as chokidar normalizes it (contracts/synced-files.md)                                    |
| `origin`  | `app_dir` (`<data dir>/kubeconfigs`, always, first), `setting` (in the setting's order), `launch` (last, never written back) |
| `kind`    | `file` or `folder`, from a stat that follows symbolic links when the sync starts; `missing` when the stat finds nothing      |
| `files`   | its synced files, in the order first seen                                                                                    |
| `watches` | the canonical path of `path`, and of each symbolic link's target                                                             |

State transitions:

```text
(setting gains path) ──start──▶ stat: folder | file | missing (debug line, nothing watched)
folder | file ──scan──▶ files added, changed, removed (see Synced file)
(setting loses path) ──stop──▶ watches dropped, every cluster only this sync gave leaves the catalog
missing ──(setting changes again, or restart)──▶ start
```

The application's kubeconfig directory is created at startup when missing,
and never stops.

## Synced file

| Field        | Meaning                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| `path`       | the sync's path for a file sync; `path.join(<folder>, <name>)` for a folder sync; a symbolic link's own path |
| `limit`      | 32 MiB for a file sync, 2 MiB for a folder's file                                                            |
| `identity`   | size, modification time and inode at the last scan                                                           |
| `stable_at`  | when `identity` last changed; the file is read 500 ms after it                                               |
| `missing_at` | when a scan first found it missing; it is removed 100 ms after it                                            |
| `contexts`   | the valid contexts of the last read, in file order, each `{ context_name }`                                  |

A folder's file is left out when its name matches an ignore rule, and a
subfolder is no synced file (contracts/synced-files.md).

State transitions:

```text
first scan ──▶ read at once
event ──scan──▶ identity changed: stable_at = now
stable for 500 ms ──read──▶ too large | bad encoding | load error ─▶ contexts = [] (warning)
                          └▶ loaded ─▶ contexts = the valid ones (invalid ones: debug line)
missing ──100 ms──▶ still missing: removed, contexts = []
missing ──back within 100 ms──▶ a change
read error ──▶ contexts kept as they were (warning)
```

## Context

| Field          | Meaning                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------- |
| `id`           | MD5 hex of `<synced file path>:<context name>`                                              |
| `context_name` | the context's name; a name that appears twice in a file gives one context                   |
| `file`         | the synced file's path, as `kubeconfigPath` of the entity and `kubeConfigPath` of the store |

The first sync and file that give an id keep it; a later one is left out of
the catalog (contracts/synced-files.md, "Order").

## Cluster store entry

The model of one cluster of `lens-cluster-store`, as spec 007 keeps it
(`specs/007-main-foundation/data-model.md`, "Cluster store").

| Used by the catalog                                             | Effect on the entity                                                                                                                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preferences.clusterName`                                       | `metadata.name` when set                                                                                                                                                     |
| `preferences.iconShortName`                                     | `metadata.shortName` when set; `null` clears it, and the key is removed from the entry                                                                                       |
| `preferences.icon`                                              | `spec.icon.src` for a `data:` URL, `spec.icon.background` otherwise; `null` clears the icon and the key                                                                      |
| `preferences.prometheus`, `preferences.prometheusProvider.type` | `spec.metrics.prometheus.address`, `.type`                                                                                                                                   |
| `labels`                                                        | merged over the entity's labels, after the `file` label                                                                                                                      |
| `metadata`                                                      | `distro` (`distribution`, else `unknown`), `kubeVersion` (`version`, else `unknown`), and the keys `version`, `id`, `distribution`, `nodes`, `lastSeen`, `prometheus` copied |

A context with no entry gets
`{ id, contextName, kubeConfigPath, preferences: {}, metadata: {},
accessibleNamespaces: [], labels: {} }` through `Stores::update`, one update
per diff. An entry stays when its context leaves.

## Entity

Three kinds, all `apiVersion: entity.k8slens.dev/v1alpha1`; the JSON of each
is [contracts/catalog-entities.md](./contracts/catalog-entities.md).

| Kind                | One per                                            | Changes when                                                           |
| ------------------- | -------------------------------------------------- | ---------------------------------------------------------------------- |
| `WebLink`           | entry of `lens-weblink-store`, store order         | the store changes; its check ends                                      |
| `General`           | page: Catalog, Terminal, Welcome Page, Preferences | never                                                                  |
| `KubernetesCluster` | context of the catalog                             | its file is read; its store entry changes; the visible cluster changes |

## Catalog

| Field      | Meaning                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------ |
| `entities` | web links, then general pages, then clusters; each id once                                 |
| `visible`  | the cluster id last named on `cluster-visibility`, or none; its entity has `status.active` |
| `version`  | raised on every change; a send carries the entities of the latest version                  |

Sending: a change while no timer runs is sent at once; every change restarts
a 100 ms timer; when the timer ends, the latest entities are sent if anything
changed after the send made at once. A `catalog:init` goes through the same
coalescing.

## Web link check

| Field     | Meaning                                                                  |
| --------- | ------------------------------------------------------------------------ |
| `link`    | the web link's id                                                        |
| `phase`   | `available` until the first check ends, then the result of the last one  |
| `next_at` | when the last check ended, plus 60 minutes, plus a random 0 to 5 minutes |

A check: `GET <url>`, no proxy, redirects followed, 20-second limit; a final
status from 200 to 499 is `available`, anything else and any failure
`unavailable`. Removing the link cancels its check.

## Large catalog (measurement)

500 generated contexts, each with its own made-up server and a placeholder
token: one file of 250 contexts as a file sync, and a folder of 25 files of 10
contexts each as a folder sync. It lives in the run's temporary directory,
never in the user's `~/.kube`.
