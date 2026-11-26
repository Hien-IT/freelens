# Contract: The /api-kube/ Routes

FR-012 to FR-018; research R2, R9. These rows replace the `/api-kube/` row of
`specs/004-cluster-frames/contracts/routes.md`; the checks of that contract
(host, method, `Origin`, audience) still come first.

## Rows

| Method                              | Path                  | Audience   | Answer          |
| ----------------------------------- | --------------------- | ---------- | --------------- |
| GET, HEAD, POST, PUT, PATCH, DELETE | `/api-kube/` (prefix) | `Clusters` | the rules below |

The cluster is the one the frame's host names, never the path or the body.

## Rules, in order

| Situation                                                                                      | Answer                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| the path is not normalized (`/./`, `%2e`, `..`, a backslash, an absolute form)                 | `400`, `text/plain`, `Bad Request`, `Cache-Control: no-store`                                                                                                                        |
| the query makes it a watch (`watch` or `follow` present and not `false`, `f` or `0`, any case) | `400`, a `Status` whose message names `kube-watch:open`; watches go through [kube-watch.md](./kube-watch.md)                                                                         |
| the cluster is disconnected                                                                    | `503`, `application/json`, `{"kind":"Status","apiVersion":"v1","metadata":{},"status":"Failure","message":"Cluster <id> is not connected","reason":"ServiceUnavailable","code":503}` |
| the client cannot be built                                                                     | `503`, the same `Status` with `Failed to start the proxy of cluster <id>: <reason>`                                                                                                  |
| the API server's connection fails before the head                                              | `500`, `text/plain`, `Oops, something went wrong.\n<reason>`                                                                                                                         |
| no head within 30 s, or 30 s without a chunk of the body                                       | the request to the API server is dropped; `500` as above if no head was sent                                                                                                         |
| the API server's connection fails, or 30 s pass, after the head                                | the head and the body received so far, as the Electron build's client sees a response that ends early                                                                                |
| otherwise                                                                                      | the API server's status, headers and body, as below                                                                                                                                  |

Every answer carries `Cache-Control: no-store`.

## What the API server gets

- The method, the path after `/api-kube`, the query and the body.
- Every header of the frame's request except `Authorization`, `Cookie`,
  `Origin`, `Host`, `Connection`, `Keep-Alive`, `Proxy-Connection`, `TE`,
  `Transfer-Encoding`, `Upgrade`, `Expect`, `Accept-Encoding`, and every
  header a `Connection` header names.
- The credentials of the context, added by the core; `Host` of the API server.
- No retry, whatever the status.

## What the frame gets

- The status and headers of the API server, without `Transfer-Encoding`,
  `Connection` and `Keep-Alive`, with `Cache-Control: no-store`.
- A `3xx` with a `Location` inside the API server's base path: `Location`
  rewritten to `/api-kube<path below the base>` with its query and fragment;
  any other `Location` unchanged.
- The whole body, in one piece.
- Limits of the scheme (wry 0.57.3): a header repeated in the response keeps
  its last value only; a value with characters outside visible ASCII is
  dropped.

## Cancellation

The scheme does not tell the core that the page cancelled a request; such a
request runs to its answer or its 30 s limit, and so does one of a frame that
is forgotten or whose page reloads. The core drops every request in flight of
a cluster when it is disconnected or deleted.
