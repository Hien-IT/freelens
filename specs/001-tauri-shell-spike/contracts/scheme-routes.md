# Contract: Custom Scheme Routes

The core registers the URI scheme `freelens-app` with WKWebView and answers
every request on it. There is no other channel between the views and the core:
the core registers no Tauri command and grants no capability.

## Hosts

| Host                                | Serves                    |
| ----------------------------------- | ------------------------- |
| `renderer.freelens.app`             | the main window (catalog) |
| `<clusterId>.renderer.freelens.app` | the frame of one cluster  |

`<clusterId>` is the `id` of a catalog entry ([data-model.md](../data-model.md)).
A host that matches neither form, or a cluster id that is not in the catalog,
gets `404` for every path.

## Routes

| Method | Path                    | Main host | Cluster host | Response                                                         |
| ------ | ----------------------- | --------- | ------------ | ---------------------------------------------------------------- |
| GET    | `/`                     | yes       | yes          | `index.html` on the main host, `cluster.html` on a cluster host  |
| GET    | `/assets/<file>`        | yes       | yes          | the built UI asset, with its content type                        |
| GET    | `/api/clusters`         | yes       | `404`        | the catalog, below                                               |
| GET    | `/api-kube/<api path>`  | `404`     | yes          | the API server's response for `<api path>`, below                |
| GET    | `/api/mark?name=<name>` | yes       | yes          | `204`; the core prints the mark ([log-lines.md](./log-lines.md)) |
| other  | any                     | `405`     | `405`        | empty                                                            |

### `GET /api/clusters`

```json
{
  "source": "/Users/me/.kube/config",
  "message": null,
  "clusters": [{ "id": "0123456789abcdef0123456789abcdef", "name": "kind-freelens-profile" }],
  "openOnLoad": null
}
```

- `source` is the path of the kubeconfig file in effect, or `null` when none
  is chosen.
- `openOnLoad` is the id of the cluster that `--open-cluster` names, or
  `null`; the main window opens that cluster once the catalog is shown.
- `message` is `null`, or the text to show for a missing chosen file or a file
  that cannot be parsed.
- No field holds a server address, user name, certificate, key or token.

### `GET /api-kube/<api path>`

- `<api path>` must start with `api/` or `apis/`; anything else gets `404`.
- The core sends `GET /<api path>` with the query string unchanged to the
  cluster of the host, through the `kube::Client` of that cluster, and returns
  the status and the JSON body of the API server.
- If the cluster cannot be reached, the core answers `502` with
  `{"error": "unreachable", "message": "<text>"}`.
- A `watch` query parameter gets `400`: the scheme cannot stream (research R4).
- Response headers never include credentials, and request headers from the
  view are not forwarded.

## Origin rules

- A request with an `Origin` header that is not `freelens-app://<the request's
  host>` gets `403` with an empty body, whatever the path.
- No response carries `Access-Control-Allow-*` headers, so the browser blocks
  cross-origin reads even where a request reaches the core.
- `OPTIONS` requests get `405`.

## Isolation expected in the browser (SC-005)

From a cluster frame, each of these fails:

- reading `window.parent.document` or `window.top.location.href`;
- `fetch("freelens-app://renderer.freelens.app/api/clusters")`;
- `fetch("freelens-app://<another clusterId>.renderer.freelens.app/api-kube/api/v1/namespaces")`;
- reading `localStorage` keys set by the main window or by another cluster
  frame.
