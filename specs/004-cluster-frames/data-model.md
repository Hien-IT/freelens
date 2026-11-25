# Data Model: Cluster Frames

Everything here lives in the memory of the core while it runs; nothing is
written to disk. `View` and `Queue` are those of
`specs/002-messaging-for-tauri/data-model.md`; this feature adds the events of
a queue.

## View (existing)

The main window, or the frame of one cluster, taken from the host of a
request, never from its body.

| Variant       | Host                         | Origin                                      |
| ------------- | ---------------------------- | ------------------------------------------- |
| `Main`        | `renderer.freelens.app`      | `freelens-app://renderer.freelens.app`      |
| `Cluster(id)` | `<id>.renderer.freelens.app` | `freelens-app://<id>.renderer.freelens.app` |

- `id` is the `id` of a catalog entry: the MD5 of `<kubeconfig path>:<context
  name>` in hex (`specs/001-tauri-shell-spike/data-model.md`), so the same
  cluster has the same origin in every run (FR-001), and two contexts of the
  same name in different files have different ones.
- A host that is neither form, or an `id` not in the catalog, names no view
  (FR-005).

## Audience

Which views may use a route (FR-007).

| Value      | Views                    |
| ---------- | ------------------------ |
| `Main`     | `View::Main`             |
| `Clusters` | every `View::Cluster(_)` |
| `Both`     | every view               |

## Route

One thing the core serves on the scheme.

| Field      | Type                                        | Rule                                                                     |
| ---------- | ------------------------------------------- | ------------------------------------------------------------------------ |
| `method`   | HTTP method                                 | one per route; a known path with another method answers `405`            |
| `path`     | exact path, or a prefix that ends in `/`    | a prefix matches every path under it; the longest match wins             |
| `audience` | `Audience`                                  | a request from a view outside it answers `404`                           |
| `handler`  | request and `View` → response, asynchronous | gets the view the host names; never reads a view from the request's body |

- A second route with the same `method` and `path` stops the core at startup
  with an error naming both.
- The rows that exist when this feature ends are in
  [contracts/routes.md](./contracts/routes.md).

## Frame record

What the core knows about the cluster frames (FR-016 to FR-018).

| Field     | Type               | Rule                                                                        |
| --------- | ------------------ | --------------------------------------------------------------------------- |
| `frames`  | set of cluster ids | ids of clusters whose frame has announced itself and has not been forgotten |
| `visible` | cluster id or none | the id the main window last named, if it is in the catalog; none otherwise  |

`visible` may name a cluster that has no frame yet: the main window names the
cluster it shows before its frame has loaded, as in the Electron build.

### States of one cluster's frame

```text
           announce(id) from View::Cluster(id)
  Absent ───────────────────────────────────────▶ Recorded
    ▲                                                │
    │   Closed(Cluster(id)) of its queue             │
    │   Restarted(Main), the main window reloads     │
    │   forget(id), by an area                       │
    └────────────────────────────────────────────────┘
```

- `announce` of a recorded id changes nothing and emits nothing: a reloaded
  frame is not recorded twice.
- `Restarted(Cluster(id))`, the frame of `id` reloading, leaves the record as
  it is; the reloaded frame announces itself again.
- Forgetting an absent id changes nothing and emits nothing.
- Forgetting the visible cluster's frame leaves `visible` as it is: the main
  window names the next one (Edge Cases of the spec).

### Events

| Event           | When                              |
| --------------- | --------------------------------- |
| `Announced(id)` | `id` goes from Absent to Recorded |
| `Forgotten(id)` | `id` goes from Recorded to Absent |

Subscribers get the events in the order the changes happen, after the change
and outside the lock, so a subscriber may read the record or send.

## Queue events (added to the Queue of spec 002)

| Event             | When                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| `Closed(view)`    | the queue closes: no poll and none waiting for 60 seconds, or over 10 000 messages |
| `Restarted(view)` | a poll names a new `session` for an open queue, which starts afresh                |

The idle check runs on every poll, every send, every read of the frame
record, and once a second in the background (research R5).

## Targeted message

A message the core sends to the queue of one view only (FR-018).

| Field     | Type                           | Rule                                                                |
| --------- | ------------------------------ | ------------------------------------------------------------------- |
| `cluster` | cluster id, or the visible one | a cluster without a recorded frame drops the message, without error |
| `channel` | message channel                | the same typed channels as a broadcast                              |
| `payload` | the channel's message type     | JSON, as every channel's value (spec 002, FR-008)                   |

It takes the next sequence number of that queue only, so the order of messages
a view receives stays the order the core sent them in.
