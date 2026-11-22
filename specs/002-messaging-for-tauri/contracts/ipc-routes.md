# Contract: IPC Routes on the Scheme

The view-side implementation of `messaging-for-tauri` and the core speak over
three routes of the `freelens-app` scheme (research R2, R3). They exist on
every host the scheme serves: `renderer.freelens.app` for the main window and
`<clusterId>.renderer.freelens.app` for each cluster frame of the catalog. A
view always calls its own host, with a relative URL.

## Rules for every route under `/ipc/`

| Check, in this order                                                  | Answer when it fails |
| --------------------------------------------------------------------- | -------------------- |
| the host is the main host or a cluster host of the catalog            | `404`                |
| the method is `POST`                                                  | `405`                |
| `Origin` is present and equals `freelens-app://<host of the request>` | `403`                |
| `Content-Type` is `application/json`                                  | `415`                |
| the body is at most 64 MiB                                            | `413`                |
| the body is JSON of the shape the route expects                       | `400`                |

The sender of the request is the view its host names (research R7): the main
window, or the frame of the cluster whose id is in the host. Nothing in the
body names the sender. No response carries CORS headers.

A **channel id** is the `id` of the TypeScript channel, carried in the body as
`channel`, so that no path needs decoding. An **envelope** is a JSON object
that carries a value in `payload`, or no `payload` for "no value" (`undefined`
in the view, `()` in the core); `null` is a value.

## `POST /ipc/request`

Body: `{"channel":"<id>", …envelope}` with the request.

| Status | Body                                                       | The view's promise                                                                      |
| ------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `200`  | an envelope with the answer                                | resolves with the answer, or `undefined` for no `payload`                               |
| `404`  | `{"error":{"message":"No handler registered for '<id>'"}}` | rejects: `Error invoking remote method '<id>': Error: No handler registered for '<id>'` |
| `400`  | `{"error":{"message":"<why the request does not parse>"}}` | rejects: `Error invoking remote method '<id>': Error: <message>`                        |
| `500`  | `{"error":{"message":"<message of the handler's error>"}}` | rejects: `Error invoking remote method '<id>': Error: <message>`                        |
| other  | any                                                        | rejects: `Error invoking remote method '<id>': <status and status text>`                |

A failure of `fetch` itself rejects with
`Error invoking remote method '<id>': <message of the failure>`. The view sends
the request only after the message batch in flight, if any, is accepted
(research R5).

## `POST /ipc/messages`

Body: `{"messages":[{"channel":"<id>", …envelope}, …]}`, at least one message,
in the order the view sent them.

Answer: `204`. The core hands each message, in order, to every listener of its
channel, with the sender. A message on a channel nobody listens to is dropped;
one whose payload does not parse as the channel's type is dropped and logged
with the channel id. Neither reaches the sender as an error (FR-007).

The view keeps at most one batch in flight. A batch that fails is logged in
the view with its channel ids and not sent again.

## `POST /ipc/poll`

Body: `{"session":"<page load id>","after":<number>}`. `session` matches
`[A-Za-z0-9-]{1,64}` and is drawn at random once per page load; `after` is the
sequence number of the last message the view has handled, `0` at first.

Answer: `200` with `{"messages":[{"seq":<number>,"channel":"<id>", …envelope}, …]}`,
in sequence order, as soon as the view's queue holds a message with a sequence
number above `after`, or with an empty list after 25 seconds.

| Situation                                            | What the core does                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------- |
| first poll of a host                                 | opens the queue of that view; sequence numbers start at 1            |
| `session` differs from the queue's                   | starts the queue afresh for the new page load, then answers as above |
| messages up to `after` are in the queue              | drops them; they are handled                                         |
| another poll of the same host is pending             | answers the pending one with an empty list, then serves the new one  |
| no poll for 60 seconds, or more than 10 000 messages | closes the queue and logs it; the next poll opens a new one          |

The view hands each message to its listeners in sequence order, ignores a
sequence number it has already handled, and polls again at once. After a
failed poll it waits 100 ms, doubling to at most 2 s, and polls again with the
same `session` and `after`.
