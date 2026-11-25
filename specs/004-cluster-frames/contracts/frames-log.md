# Contract: Log Lines of the Frames

The core prints these lines on standard output, in addition to those of
`specs/001-tauri-shell-spike/contracts/log-lines.md` and
`specs/002-messaging-for-tauri/contracts/check-log.md`. `<view>` is `main` or
`cluster <id>`.

## Always

| Line                                                                | When                                                                                                               |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `Frames: cluster <id> announced`                                    | the frame of `<id>` goes from Absent to Recorded                                                                   |
| `Frames: cluster <id> forgotten: <reason>`                          | `<reason>` is `its queue closed`, `the main window reloaded` or `removed`                                          |
| `Frames: visible cluster <id>` / `Frames: no visible cluster`       | the main window names a visible cluster, or none                                                                   |
| `Frames: refused cluster:set-frame-id from <view> for cluster <id>` | the sender is the main window, or another cluster's frame                                                          |
| `Frames: dropped current-visible-cluster from <view>`               | a cluster frame sent it                                                                                            |
| `Frames: refused a navigation of the main window to <scheme>`       | the main window's navigation handler refused a URL; `<scheme>` is the URL's scheme alone, so no address is printed |

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

| Line                                                                    | When                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Frames check: not run: the catalog has <n> clusters, three are needed` | the catalog has fewer than three clusters; the catalog page opens no frame, and the run prints nothing else of the check                                                                                           |
| `Frames check: <view> origin <origin>`                                  | a view reports `window.origin`                                                                                                                                                                                     |
| `Frames check: <view> blocked <attempt>`                                | an attempt of R9 failed, as it must                                                                                                                                                                                |
| `Frames check: <view> isolation failed: <attempt>`                      | an attempt of R9 succeeded                                                                                                                                                                                         |
| `Frames check: <view> marks <state> <storage>`                          | a view reports the page-state mark it holds in memory and its own mark in local storage; each is `kept` when it equals the one the same view reported before, `new` when it does not, `missing` when there is none |
| `Frames check: <view> received ping <token>`                            | a view received `frames-check:ping`                                                                                                                                                                                |
| `Frames check: send-to cluster <id> token <token>: <had frame>`         | the core answered `frames-check:send-to`; `<had frame>` is `true` or `false`                                                                                                                                       |
| `Frames check: cookie on a request from <view>: <value>`                | a request reached the core with a `Cookie` header; `<value>` is that of the check's cookie, which each view sets to its own name, `main` or its cluster id                                                         |
| `Frames check: done`                                                    | the catalog page has run every step                                                                                                                                                                                |

The attempts are named:

| Attempt                                                                    | From                                                                  |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `parent document`, `sibling document`                                      | each frame, read and change                                           |
| `frame document`                                                           | the catalog page, for each frame, read and change                     |
| `local storage`, `session storage`, `indexeddb`, `cache storage`, `cookie` | each frame and the catalog page: another view's mark found in its own |
| `main catalog`, `sibling kube`                                             | each frame                                                            |
| `set-frame-id for sibling`, `visible from frame`                           | each frame                                                            |
| `frame main page`, `frame sibling page`                                    | each frame                                                            |
| `open window`                                                              | each frame                                                            |
| `clipboard`, `outside address`                                             | each frame                                                            |
| `move sibling`, `move main to scheme`, `move main outside`                 | each frame, last                                                      |

A frame reports `blocked` for a `move` attempt once the attempt has thrown or
has left the target where it was after a second; a move that worked shows up
as `marks new …` from the sibling, or as a run that never prints `done`.
`outside address` counts as `blocked` only when the page receives a
`securitypolicyviolation` event for it, so that a failure of the network is
not taken for the policy. `clipboard` counts as `blocked` when writing to the
clipboard is refused.

FR-027 has no attempt: the check cannot observe that a page does not act on a
posted message. The review of T015 and T016 shows it: the pages add no
listener for messages posted to the window.

A view that cannot send its report calls `GET /api/mark?name=frames-check-failed`.

The run passes when it prints, in order:

1. four `origin` lines with four different origins (SC-001);
2. for each of the three frames, a `blocked` line for every attempt, and for
   the catalog page one `frame document` line per frame and one line per
   storage and cookie attempt; no `isolation failed` line; no `cookie`
   line whose value names another view than the one the request came from
   (SC-002). A `refused a navigation` line is not a failure: it shows the
   navigation handler stopping a move the sandbox let through, which the
   cargo tests of the handler cover on their own;
3. `received ping` for the token sent to the first cluster from that frame
   alone (SC-005);
4. after the second cluster's close, `marks kept kept` from the first and the
   third frames; `send-to` answers `true` for the first and the third
   clusters, with `received ping` for each of the two tokens from that frame
   alone; and the `send-to` answer `true` for the second cluster, whose queue
   is still open, with no `received ping` for its token (SC-003, SC-005);
5. after 65 seconds with both frames hidden, `Frames: cluster <second id>
   forgotten: its queue closed`, a `send-to` answer of `false` for the second
   cluster, `marks kept kept` again from the first and the third frames, and
   `send-to` answers `true` for the first and the third clusters with
   `received ping` for each token from that frame alone: both are still
   recorded and still reached by the core (SC-003, SC-005, FR-028);
6. after the reopen, an `origin` line for the second cluster equal to its
   first one, and `marks new kept` from it: a new page state, and the
   `localStorage` of its own origin, which outlives the frame within a run
   (SC-004, FR-013);
7. `done`, with no `frames-check-failed` mark.

The lines carry no path, cluster address or credential.
