# Contract: Routes of the Scheme

The core answers every request on the scheme `freelens-app` through one table
of routes. This contract replaces the "Hosts", "Routes" and "Origin rules"
sections of `specs/001-tauri-shell-spike/contracts/scheme-routes.md`, whose
response bodies stay as they are, and keeps the `/ipc/` routes of
`specs/002-messaging-for-tauri/contracts/ipc-routes.md` unchanged inside the
table.

## Order of the checks

For each request, in this order; the first that fails answers:

1. The host names a view: `renderer.freelens.app`, or
   `<id>.renderer.freelens.app` with `<id>` in the catalog. Otherwise `404`,
   empty, whatever the path (FR-005).
2. A route matches the path. Otherwise `404`, empty.
3. A route matches the path and the method. Otherwise `405`, empty.
4. If the request carries an `Origin` header, it equals
   `freelens-app://<the request's host>`. Otherwise `403`, empty (FR-006).
5. The view is in the route's audience. Otherwise `404`, empty, as if the
   route did not exist (FR-007).
6. The route's handler answers, with the view of step 1 (FR-008).

The method comes before the `Origin` so that every answer the tests of specs
001 and 002 expect stays the same: `/ipc/` answers a preflight from another
origin with `405` (`tests/messaging.rs`), and every `403` they expect is for a
route and method that exist. An unknown path with a foreign `Origin` now
answers `404` where `src/scheme.rs` answered `403`; no test covers that case,
and neither answer serves the page anything.

No response carries an `Access-Control-Allow-*` header, so WebKit refuses a
page the response of another origin even where a request reaches the core.

## The table when this feature ends

| Method | Path                  | Audience   | Answer                                                                                            |
| ------ | --------------------- | ---------- | ------------------------------------------------------------------------------------------------- |
| GET    | `/`                   | `Main`     | `index.html`, the catalog page, with the main window's content security policy                    |
| GET    | `/`                   | `Clusters` | `cluster.html`, the frame page, with a policy whose `frame-ancestors` is the main window's origin |
| GET    | `/assets/` (prefix)   | `Both`     | the built file; `404` for a path with `..` or an unknown file                                     |
| GET    | `/api/clusters`       | `Main`     | the catalog, as in spec 001                                                                       |
| GET    | `/api/mark`           | `Both`     | `204`, and the core prints the mark                                                               |
| GET    | `/api-kube/` (prefix) | `Clusters` | the cluster of the host, as in spec 001; `400` for a watch                                        |
| POST   | `/ipc/` (prefix)      | `Both`     | the routes of `ipc-routes.md` of spec 002                                                         |

`/` is the one path with two routes of the same method: one per audience. The
table allows that, and only that: two routes with the same method, path and
an overlapping audience stop the core at startup.

## Adding a route

A later area adds its routes at startup, as it registers its channels:

```rust
routes.add(Method::GET, "/api/metrics", Audience::Clusters, handler)?;
```

- The handler receives the request and the `View`; for a `Clusters` route the
  view is always `View::Cluster(id)`, with `id` in the catalog.
- A route reads the cluster from the view, never from the path or the body,
  so a route of one cluster's frame cannot act for another cluster (FR-006).
- `add` fails with the method and path when it overlaps a route already
  added; the core prints the error on standard error and exits with status 1.

## With `--frames-check`

Every request that reaches the core with a `Cookie` header prints a line of
[frames-log.md](./frames-log.md), whatever its route; the request is answered
as usual.
