# Data Model: Messaging for the Tauri Build

Messaging keeps no persistent data. Everything below lives in memory, in a
view or in the core, for one page load or one launch; the channel list is a
document.

## Channel

Defined once in TypeScript with `getRequestChannel<Request, Response>(id)` or
`getMessageChannel<Message>(id)`, unchanged by this feature. In the core, the
area that owns it writes the same id as a Rust constant with the Rust types of
its values ([contracts/core-channels.md](./contracts/core-channels.md)).

| Field  | Rule                                                                                       |
| ------ | ------------------------------------------------------------------------------------------ |
| `id`   | unique among channels of its kind; the same string in both builds and in the core          |
| kind   | request (one answer) or message (one-way)                                                  |
| values | JSON-representable in the Tauri build (research R4); others fail with an error naming `id` |

A legacy channel of the Electron build, moved onto messaging by User Story 2,
keeps its name as its `id`. One that carried several arguments carries the
list of them as its message.

## View

| Field  | Rule                                                                                |
| ------ | ----------------------------------------------------------------------------------- |
| host   | `renderer.freelens.app`, or `<clusterId>.renderer.freelens.app` for a cluster frame |
| `View` | `Main` or `Cluster(id)` in the core, derived from the host and never from the body  |

## Envelope

| Form                  | Meaning                                             |
| --------------------- | --------------------------------------------------- |
| `{}`                  | no value: `undefined` in the view, `()` in the core |
| `{"payload": <JSON>}` | the value, `null` included                          |

## Message batch (view side)

The messages a view sent while the previous batch was in flight, in sending
order. States: `collecting` → `in flight` → `accepted` (`204`) or `failed`
(logged, dropped). At most one batch is in flight per view; a request waits for
it (research R5).

## Queue (core side)

One per open view.

| Field        | Rule                                                               |
| ------------ | ------------------------------------------------------------------ |
| host         | the view's host                                                    |
| `session`    | the page load that owns it; a different one restarts the queue     |
| next `seq`   | starts at 1, grows by 1 per message                                |
| messages     | `(seq, channel id, envelope)` not yet acknowledged, at most 10 000 |
| pending poll | at most one; a new poll answers the old one empty                  |
| last poll    | time of the last poll; 60 seconds without one closes the queue     |

States:

```text
absent ──first poll──▶ open ──60 s without a poll, or 10 000 messages──▶ absent (logged)
                        │ ▲
                        └─┘ poll with a new session: emptied, seq back to 1
```

`Messaging::send` appends to every queue in the `open` state; an `absent` view
receives nothing, as a frame that has not announced itself receives nothing in
the Electron build.

## Channel list entry

One row of [contracts/channel-list.md](./contracts/channel-list.md).

| Field             | Rule                                                                                    |
| ----------------- | --------------------------------------------------------------------------------------- |
| name or pattern   | the `id`, or a pattern with `<placeholders>` covering every name built at run time      |
| kind              | request or message                                                                      |
| direction         | view → main, main → view, or both                                                       |
| Electron answerer | the file that answers or listens in the Electron build                                  |
| values            | the TypeScript types, flagged `non-JSON` when they can hold a value research R4 rejects |
| owner             | a core area of R9 of spec 001, or `not ported` with the reason                          |

## Check round

One round of the `--messaging-check` run (research R9), per view.

| Step            | Channel                                           | Passes when                                                                                          |
| --------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| request         | `build-version`                                   | the answer is a non-empty string                                                                     |
| message to core | `frame-communication-admin-channel`               | the core's count of this view's announcements has grown when the round's report arrives              |
| message to view | `ipc:broadcast-main` carrying `renderer:navigate` | the core answers, and the view's listener receives `/messaging-check/<view>/<round>` once within 5 s |

Twenty rounds per view; the run passes when all forty pass (SC-003).
