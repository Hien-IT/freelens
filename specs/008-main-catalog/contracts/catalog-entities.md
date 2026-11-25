# Contract: The Entities on `catalog:items`

FR-001, FR-005, FR-006, FR-008, FR-013; research R1, R2, R6. The message is
an array of entities: the web links in the order of the store, then the four
general pages, then the clusters (research R1). A key with no value is left
out; the views read it as `undefined`, as they read the Electron build's
`undefined`.

Every entity has the keys `metadata`, `status`, `spec`, `apiVersion` and
`kind`, in that order, and `apiVersion` is `entity.k8slens.dev/v1alpha1`.

## General

Fixed; in this order.

| `metadata.uid`         | `metadata.name` | `spec.path`    | `spec.icon.material` |
| ---------------------- | --------------- | -------------- | -------------------- |
| `catalog-entity`       | `Catalog`       | `/catalog`     | `view_list`          |
| `terminal-page-entity` | `Terminal`      | `/terminal`    | `terminal`           |
| `welcome-page-entity`  | `Welcome Page`  | `/welcome`     | `home`               |
| `preferences-entity`   | `Preferences`   | `/preferences` | `settings`           |

```json
{
  "metadata": { "uid": "catalog-entity", "name": "Catalog", "source": "app", "labels": {} },
  "status": { "phase": "active" },
  "spec": { "path": "/catalog", "icon": { "material": "view_list", "background": "var(--primary)" } },
  "apiVersion": "entity.k8slens.dev/v1alpha1",
  "kind": "General"
}
```

## WebLink

One per entry `{ id, name, url }` of `lens-weblink-store`.

```json
{
  "metadata": { "uid": "<id>", "name": "<name>", "source": "local", "labels": {} },
  "status": { "phase": "available", "active": true },
  "spec": { "url": "<url>" },
  "apiVersion": "entity.k8slens.dev/v1alpha1",
  "kind": "WebLink"
}
```

`status.phase` is `available` until the link's first check ends, then
`available` or `unavailable` (data-model.md, "Web link check").

## KubernetesCluster

One per context of the catalog, from the context and its cluster store entry
(data-model.md, "Cluster store entry").

```json
{
  "metadata": {
    "uid": "<cluster id>",
    "name": "<preferences.clusterName, or the context name>",
    "source": "local",
    "labels": { "file": "~/work/dev.yaml", "<label>": "<value>" },
    "distro": "<metadata.distribution, or unknown>",
    "kubeVersion": "<metadata.version, or unknown>",
    "version": "<metadata.version, when set>",
    "id": "<metadata.id, when set>",
    "distribution": "<metadata.distribution, when set>",
    "nodes": 3,
    "lastSeen": "<metadata.lastSeen, when set>",
    "prometheus": {},
    "shortName": "<preferences.iconShortName, when set>"
  },
  "status": { "phase": "disconnected", "reason": "", "message": "", "active": false, "enabled": true },
  "spec": {
    "kubeconfigPath": "<synced file path>",
    "kubeconfigContext": "<context name>",
    "icon": { "background": "<preferences.icon>" },
    "metrics": { "source": "local", "prometheus": { "type": "<provider type>", "address": "<address>" } }
  },
  "apiVersion": "entity.k8slens.dev/v1alpha1",
  "kind": "KubernetesCluster"
}
```

Rules:

- `labels`: the `file` label first, when the synced file's path does not start
  with the string `<data dir>/kubeconfigs`, as the path with the first
  occurrence of `$HOME` replaced by `~`; then the entry's `labels`, which win
  on the same key.
- `metadata.version` to `metadata.prometheus`: each copied from the entry's
  `metadata` when present, left out otherwise. `metadata.nodes` and
  `metadata.prometheus` keep the type the entry gives them.
- `spec.icon`: `{}` without an icon; `{ "src": <icon> }` for a value starting
  with `data:`, `{ "background": <icon> }` otherwise; left out when the entry's
  icon is `null`, which also removes it from the entry.
- `spec.metrics.prometheus`: `{}` when the entry names neither.
- `status.active`: `true` for the cluster last named on `cluster-visibility`,
  `false` otherwise.
- `status.phase` stays `disconnected` in this feature; the other phases come
  with main-cluster-connection.

No key of an entity carries anything of the kubeconfig file but its path and
the context's name (FR-014).
