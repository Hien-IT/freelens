# Contract: Watches over the View's Queue

FR-012, FR-014, FR-015; research R10. The scheme answers in one piece, so a
watch of `/api-kube` travels over the channels of spec 002 instead: a request
to open it, then messages on the frame's own queue. These four channels exist
in the Tauri build only.

## Channels

| Channel            | Kind | Dir | Values                                                 |
| ------------------ | ---- | --- | ------------------------------------------------------ |
| `kube-watch:open`  | req  | v→m | `{ id, path, headers }` → `{ status, headers, body? }` |
| `kube-watch:data`  | msg  | m→v | `{ id, text }`, sent to the opening frame only         |
| `kube-watch:end`   | msg  | m→v | `{ id, error? }`, sent to the opening frame only       |
| `kube-watch:close` | msg  | v→m | `{ id }`                                               |

- `id`: chosen by the frame, `[A-Za-z0-9-]{1,64}`, unique among its open
  watches; a second open with an id in use is refused.
- `path`: what follows `/api-kube` in the URL, with its query; normalized as
  [api-kube.md](./api-kube.md) requires.
- `headers`: `[[name, value], …]`, filtered as api-kube.md filters a request's.
- Only a cluster frame may open a watch, of its own cluster; the main window's
  request is refused.

## Open

The core sends the request and answers when the API server's head arrives:

| Head                                                            | Answer                                                                   | Then                  |
| --------------------------------------------------------------- | ------------------------------------------------------------------------ | --------------------- |
| 2xx                                                             | `{ status, headers }`, the headers as api-kube.md passes them            | data and end messages |
| any other status                                                | `{ status, headers, body }`, `body` the whole response as text           | nothing more          |
| the cluster is disconnected, or the request fails before a head | the `status`, `headers` and `body` api-kube.md answers in that situation | nothing more          |

## Data and end

- `kube-watch:data` carries the body decoded as UTF-8, a character split
  across chunks kept for the next message, as `TextDecoder` with `stream: true`
  decodes it.
- While a `data` message of a watch waits in the frame's queue, a later chunk
  of the same watch is appended to its `text` rather than queued apart. A
  watch thus holds at most one waiting message.
- `kube-watch:end` follows the last `data`: with no `error` when the API server
  ended the body; with `error` when the request failed, 4 h passed without a
  chunk, the cluster was disconnected, deleted or left the catalog.
- A `kube-watch:close` from the frame, its queue restarting or closing, or its
  frame being forgotten drops the request and sends nothing more.

## `kube-fetch.ts`

`kubeFetch(input, init?)` in `freelens-tauri/ui/src/renderer/kube-fetch.ts`
has the signature of `fetch`:

- for a URL under `/api-kube` whose query makes it a watch, it requests
  `kube-watch:open` and resolves with a `Response` of the answer's status and
  headers, whose body is a `ReadableStream` of the `data` texts encoded as
  UTF-8, closed by `end`, errored by an `end` with `error`; cancelling the
  stream or aborting `init.signal` sends `kube-watch:close`; a non-2xx answer
  resolves with its `body`;
- for any other URL, it calls `fetch`.
