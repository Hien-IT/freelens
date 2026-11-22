# Contract: Log Lines of Messaging

The core prints these lines on standard output, in addition to those of
`specs/001-tauri-shell-spike/contracts/log-lines.md`. `<view>` is `main` or
`cluster <id>`.

## Always

| Line                                              | When                                                                      |
| ------------------------------------------------- | ------------------------------------------------------------------------- |
| `Messaging: <view> announced`                     | the core receives `frame-communication-admin-channel` from that view      |
| `Messaging: closed the queue of <view>: <reason>` | a queue closes; `<reason>` is `no poll for 60 s` or `over 10000 messages` |
| `Messaging: dropped a message on "<id>": <error>` | a message's payload does not parse as its channel's type                  |

On standard error, at startup: `Channel "<id>" is answered twice`, followed by
exit status 1 (FR-010).

## With `--messaging-check`

The launch option `--messaging-check` registers the check-only channels of
research R9 and opens the main window at `/?messaging-check`; the main window
adds the same query to the frame of the cluster `--open-cluster` opens. Each
view then runs the check and reports every result on the check-only message
channel `messaging-check:report`, which the core prints:

| Line                                                                                | When                                                                                                         |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `Messaging check: <view> build version <version>`                                   | the first answer of `build-version` the view received                                                        |
| `Messaging check: <view> round <n> passed`                                          | all three steps of round `<n>` (1 to 20) passed                                                              |
| `Messaging check: <view> round <n> failed at <step>: <message>`                     | `<step>` is `request`, `message to core` or `message to view`                                                |
| `Messaging check: <view> answer of <bytes> bytes in <ms> ms`                        | one timed request of research R9, for each of the three sizes                                                |
| `Messaging check: <view> done, <k> of 20 rounds passed`                             | the view has run rounds 1 to 20 and the timed requests                                                       |
| `Messaging check: <view> isolation: its post to the main window's host was blocked` | a cluster frame tried to post a message to the main window's host and failed (FR-006)                        |
| `Messaging check: <view> isolation failed: …`                                       | that post went through, or the main window received it                                                       |
| `Messaging check: <view> round 21 passed`                                           | a late round, 130 seconds after `done`, with the application left in the background meanwhile (research R14) |

A view that cannot send its report also calls `GET /api/mark?name=messaging-check-failed`,
which prints `Mark "messaging-check-failed"` through a path that does not use
messaging.

The run passes SC-003 when it prints `done, 20 of 20 rounds passed` for `main`
and for the cluster, `round 21 passed` for both, the cluster's `isolation`
line, and no `Messaging check: … failed` line or `messaging-check-failed`
mark. The core also prints on standard error each `/ipc/` request it refuses
(`Refused an IPC request …`); a passing run has none. The
lines carry no path, cluster address or credential.
