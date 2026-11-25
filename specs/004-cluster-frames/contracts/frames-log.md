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
first three clusters of the catalog with the query
`?frames-check&siblings=<id>,<id>`, which names the other two clusters to
each frame: a frame learns its own id from its host and has no other way to
learn theirs, since the catalog is a route of the main window only. When it
opens a cluster again, the catalog page adds `&reopened` to the query: a frame
with `reopened` makes no attempt, reports its origin and its marks, then
broadcasts `frames-check:step-done` with `marks`. The pages then run the
steps of research R9.

| Channel                        | Kind | Dir   | Values                                                                                                                              |
| ------------------------------ | ---- | ----- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `frames-check:report`          | msg  | v→m   | one report, below                                                                                                                   |
| `frames-check:send-to`         | req  | v→m   | `{ cluster, token }` → `boolean`, whether `cluster` had a frame                                                                     |
| `frames-check:send-to-visible` | req  | v→m   | `{ token }` → `boolean`, whether there was a visible frame; the core sends `frames-check:ping` through `Frames::send_to_visible`    |
| `frames-check:ping`            | msg  | m→v   | `token`, sent by `send-to` through `Frames::send_to`, or by `send-to-visible` through `Frames::send_to_visible`                     |
| `frames-check:report-marks`    | msg  | relay | none; each frame reports its marks                                                                                                  |
| `frames-check:step-done`       | msg  | relay | `{ cluster, step }`, `step` being `attempts` or `marks`; a frame broadcasts it once it has made its attempts, or reported its marks |

The core prints each report:

| Line                                                                    | When                                                                                                                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Frames check: not run: the catalog has <n> clusters, three are needed` | the catalog has fewer than three clusters; the catalog page opens no frame, and the run prints nothing else of the check                                                                                           |
| `Frames check: <view> origin <origin>`                                  | a view reports `window.origin`                                                                                                                                                                                     |
| `Frames check: <view> blocked <attempt>`                                | an attempt of R9 failed, as it must                                                                                                                                                                                |
| `Frames check: <view> isolation failed: <attempt>`                      | an attempt of R9 succeeded                                                                                                                                                                                         |
| `Frames check: <view> sent <attempt>`                                   | an attempt whose effect only the core can see was made; the core's own lines decide whether it was refused                                                                                                         |
| `Frames check: <view> marks <state> <storage>`                          | a view reports the page-state mark it holds in memory and its own mark in local storage; each is `kept` when it equals the one the same view reported before, `new` when it does not, `missing` when there is none |
| `Frames check: <view> received ping <token>`                            | a view received `frames-check:ping`                                                                                                                                                                                |
| `Frames check: send-to cluster <id> token <token>: <had frame>`         | the core answered `frames-check:send-to`; `<had frame>` is `true` or `false`                                                                                                                                       |
| `Frames check: send-to-visible token <token>: <had frame>`              | the core answered `frames-check:send-to-visible`; `<had frame>` is `true` or `false`                                                                                                                               |
| `Frames check: cookie on a request from <view>: <value>`                | a request reached the core with a `Cookie` header; `<value>` is that of the check's cookie, which each view sets to its own name, `main` or its cluster id                                                         |
| `Frames check: done`                                                    | the catalog page has run every step                                                                                                                                                                                |

The attempts are named:

| Attempt                                                                                              | From                                                                  |
| ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `parent document read`, `parent document change`, `sibling document read`, `sibling document change` | each frame                                                            |
| `frame document read`, `frame document change`                                                       | the catalog page, for each frame                                      |
| `frame permissions`                                                                                  | the catalog page, for each frame                                      |
| `local storage`, `session storage`, `indexeddb`, `cache storage`, `cookie`                           | each frame and the catalog page: another view's mark found in its own |
| `main catalog`, `sibling kube`                                                                       | each frame                                                            |
| `set-frame-id for sibling`, `visible from frame`                                                     | each frame                                                            |
| `frame main page`, `frame sibling page`                                                              | each frame                                                            |
| `open window`                                                                                        | each frame                                                            |
| `outside address`                                                                                    | each frame                                                            |
| `move sibling`, `move main to scheme`, `move main outside`                                           | each frame, last                                                      |

A frame reports `blocked` for a `move` attempt once the attempt has thrown or
has left the target where it was after a second; a move that worked shows up
as `marks new …` from the sibling, or as a run that never prints `done`.
`outside address` counts as `blocked` only when the page receives a
`securitypolicyviolation` event for it, so that a failure of the network is
not taken for the policy. `frame permissions` counts as `blocked` when the
frame carries exactly the `sandbox` of research R12 and no `allow` attribute:
what FR-026 asks is that the page grants none. A refused clipboard write is
no evidence, because WebKit may refuse it for want of a user gesture alone
(unverified). This checks what the page sets up, not what WebKit enforces;
the engine's side of FR-024 is shown by the `open window` and `move`
attempts.

An attempt named `sibling …` runs against each of the two other frames and
reports one line per sibling, with the sibling's cluster id after the
attempt's name: `Frames check: <view> blocked sibling kube <id>`.

A view sets a mark in a kind of browser storage, and its cookie, only when it
finds none of its own there, so that a later page of the same origin reports
the earlier one as `kept`. Its page-state mark is always new.

`visible from frame` is reported as `sent`, not `blocked`: each frame sends
`current-visible-cluster` naming its own cluster, a message the core answers
with nothing. The first two frames are not the shown one, so a core that took
their message would make `send-to-visible` ping one of them, and step 2
fails. The core's `Frames: dropped …` lines and `send-to-visible` decide it.

The catalog page moves from one step to the next only on what it can
observe: it calls `send-to-visible` and starts step 3 once it has received
`frames-check:step-done` with `attempts` from all three frames; after a
`report-marks`, it goes on once it has `marks` from each frame still open;
after it reopens a cluster, it prints `done` once it has `marks` from the
reopened frame; after a request, once its answer has arrived. If a `step-done` it waits for
is missing 30 seconds later, it reports `isolation failed: step not
finished` and goes on, so that the run fails visibly rather than waiting
forever. A `received ping` line may come after the first lines of the next
step; it counts in the step that sent its token.

FR-027 has no attempt: the check cannot observe that a page does not act on a
posted message. The review of T015 and T016 shows it: the pages add no
listener for messages posted to the window.

A view that cannot send its report calls `GET /api/mark?name=frames-check-failed`.

The run passes when it prints, in order:

1. four `origin` lines with four different origins (SC-001); three
   `Frames: cluster <id> announced` lines, one per frame; and
   `Frames: visible cluster <id>` lines in the order the catalog page shows
   the clusters (FR-014, FR-016, FR-017);
2. for each of the three frames, a `blocked` line for every attempt but
   `visible from frame`, two for each `sibling …` attempt, one per sibling, and for the catalog page one line for each
   `frame document` attempt and one `frame permissions` line per frame, and
   one line per storage and cookie attempt; for `visible from frame`, a `sent` line from each frame and one
   `Frames: dropped current-visible-cluster from cluster <id>` line for each
   of the three, then a `send-to-visible` answer `true` with `received ping`
   for its token from the frame the catalog page shows, alone (FR-017,
   FR-018); no `isolation failed` line; no `cookie` line whose value names
   another view than the one the request came from (SC-002). A
   `refused a navigation` line is not a failure: it shows the navigation
   handler stopping a move the sandbox let through, which the cargo tests of
   the handler cover on their own;
3. `received ping` for the token sent to the first cluster from that frame
   alone (SC-005);
4. after the second cluster's close, `marks kept kept` from the first and the
   third frames; `send-to` answers `true` for the first and the third
   clusters, with `received ping` for each of the two tokens from that frame
   alone; the `send-to` answer `true` for the second cluster, whose queue is
   still open, with no `received ping` for its token; and
   `Frames: no visible cluster` after the close of the shown second cluster
   (SC-003, SC-005, FR-017);
5. after 65 seconds with both frames hidden, `Frames: cluster <second id>
   forgotten: its queue closed`, a `send-to` answer of `false` for the second
   cluster, `marks kept kept` again from the first and the third frames, and
   `send-to` answers `true` for the first and the third clusters with
   `received ping` for each token from that frame alone: both are still
   recorded and still reached by the core (SC-003, SC-005, FR-028);
6. after the reopen, `Frames: cluster <second id> announced`, an `origin`
   line for the second cluster equal to its first one, and `marks new kept`
   from it: a new page state, and the
   `localStorage` of its own origin, which outlives the frame within a run
   (SC-004, FR-013); and no `blocked` or `isolation failed` line from the
   reopened frame, which makes no attempt;
7. `done`, with no `frames-check-failed` mark.

The lines carry no path, cluster address or credential.
