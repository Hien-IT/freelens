# Contract: Log Lines of the Frames

The core prints these lines on standard output, in addition to those of
`specs/001-tauri-shell-spike/contracts/log-lines.md` and
`specs/002-messaging-for-tauri/contracts/check-log.md`. `<view>` is `main` or
`cluster <id>`.

## Always

| Line                                                                | When                                                                      |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `Frames: cluster <id> announced`                                    | the frame of `<id>` goes from Absent to Recorded                          |
| `Frames: cluster <id> forgotten: <reason>`                          | `<reason>` is `its queue closed`, `the main window reloaded` or `removed` |
| `Frames: visible cluster <id>` / `Frames: no visible cluster`       | the main window names a visible cluster, or none                          |
| `Frames: refused cluster:set-frame-id from <view> for cluster <id>` | the sender is the main window, or another cluster's frame                 |
| `Frames: dropped current-visible-cluster from <view>`               | a cluster frame sent it                                                   |

On standard error, at startup: `Route <method> <path> is added twice`,
followed by exit status 1.

## With `--frames-check`

The launch option `--frames-check` registers the check-only channels below
and opens the main window at `/?frames-check`. The catalog page opens the
first three clusters of the catalog with the same query, and the pages run
the steps of research R9.

| Channel                     | Kind | Dir   | Values                                                          |
| --------------------------- | ---- | ----- | --------------------------------------------------------------- |
| `frames-check:report`       | msg  | v→m   | one report, below                                               |
| `frames-check:send-to`      | req  | v→m   | `{ cluster, token }` → `boolean`, whether `cluster` had a frame |
| `frames-check:ping`         | msg  | m→v   | `token`, sent by `send-to` through `Frames::send_to`            |
| `frames-check:report-marks` | msg  | relay | none; each frame reports its marks                              |

The core prints each report:

| Line                                                            | When                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Frames check: <view> origin <origin>`                          | a view reports `window.origin`                                                                                                                                                                                           |
| `Frames check: <view> blocked <attempt>`                        | an attempt of R9 failed, as it must                                                                                                                                                                                      |
| `Frames check: <view> isolation failed: <attempt>`              | an attempt of R9 succeeded                                                                                                                                                                                               |
| `Frames check: <view> marks <state> <storage>`                  | a view reports the page-state mark it holds in memory and the mark it finds in `localStorage`; each is `kept` when it equals the one the same view reported before, `new` when it does not, `missing` when there is none |
| `Frames check: <view> received ping <token>`                    | a view received `frames-check:ping`                                                                                                                                                                                      |
| `Frames check: send-to cluster <id> token <token>: <had frame>` | the core answered `frames-check:send-to`; `<had frame>` is `true` or `false`                                                                                                                                             |
| `Frames check: cookie on a request from <view>: <value>`        | a request reached the core with a `Cookie` header; `<value>` is that of the check's cookie, which each frame sets to its own cluster id                                                                                  |
| `Frames check: done`                                            | the catalog page has run every step                                                                                                                                                                                      |

The attempts are named `parent document`, `sibling document`,
`parent storage`, `sibling storage`, `sibling cookie`, `main catalog`,
`sibling kube`, `set-frame-id for sibling`, `visible from frame`.

A view that cannot send its report calls `GET /api/mark?name=frames-check-failed`.

The run passes when it prints, in order:

1. four `origin` lines with four different origins (SC-001);
2. for each of the three frames, a `blocked` line for every attempt, no
   `isolation failed` line, and no `cookie` line whose value names another
   view than the one the request came from (SC-002);
3. `received ping` for the token sent to the first cluster from that frame
   alone (SC-005);
4. after the second cluster's close, `marks kept kept` from the first and the
   third frames, and the `send-to` answer `true` for the second cluster, whose
   queue is still open, with no `received ping` for its token (SC-003,
   SC-005);
5. after 65 seconds with both frames hidden, `Frames: cluster <second id>
   forgotten: its queue closed`, a `send-to` answer of `false` for the second
   cluster, and `marks kept kept` again from the first and the third frames
   (SC-003, SC-005);
6. after the reopen, an `origin` line for the second cluster equal to its
   first one, and `marks new kept` from it: a new page state, and the
   `localStorage` of its own origin, which outlives the frame within a run
   (SC-004, FR-013);
7. `done`, with no `frames-check-failed` mark.

The lines carry no path, cluster address or credential.
