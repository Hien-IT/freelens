# Quickstart: Main Cluster Connection

How to check that the feature works. Every run uses a temporary data directory
that syncs only the kubeconfig of the kind cluster or files made for the run;
nothing here reads the user's own `~/.kube` or data directory, and `KUBECONFIG`
is always given explicitly. Run from the repository root.

## Prerequisites

- The kind cluster of `specs/baseline.md`, "Hiệu năng main", made as section
  0.4 of `specs/tauri-port-runbook.md` describes, its kubeconfig at
  `${TMPDIR%/}/kind-freelens-profile.yaml`, with the 3000 ConfigMaps of the
  namespace `load`.
- The Electron build packaged from the branch, `freelens/dist/mac-arm64/Freelens.app`
  (`pnpm build && pnpm build:app:dir`), and the Electron build of `main`
  packaged the same way for the controls.
- The Tauri build: `pnpm --filter @freelensapp/freelens-tauri tauri:build`.
- `specs/009-main-cluster-connection/measure-connection.mjs`, written in
  implementation (research R17). It creates its own temporary directory,
  prints its path as `workdir=`, and leaves it for inspection; remove it
  afterwards.

## 1. Tests

```bash
cd freelens-tauri/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

```bash
TZ=UTC pnpm exec vitest run -c vitest.config.ts packages/core/src/main/cluster/tauri-parity.test.ts
```

Expected: every test passes. The Vitest test and `tests/cluster.rs` assert the
same `expected/` files of `freelens-tauri/src-tauri/tests/fixtures/cluster/`
(research R18). After a reviewed change of a case, write them again from the
Electron build's code with `UPDATE_TAURI_PARITY=1` before the same command.

The cargo tests cover what needs no real cluster: every row of
[contracts/connection.md](./contracts/connection.md), [contracts/api-kube.md](./contracts/api-kube.md),
[contracts/kube-watch.md](./contracts/kube-watch.md), [contracts/cluster-channels.md](./contracts/cluster-channels.md)
and [contracts/shell-sync.md](./contracts/shell-sync.md), against a fake API
server, a fake plugin and a test shell.

## 2. Connecting (SC-001, SC-009, SC-013, Story 1)

```bash
node specs/009-main-cluster-connection/measure-connection.mjs messages "${TMPDIR%/}/kind-freelens-profile.yaml"
```

Expected, for each build and each context (the kind cluster, a refused port, a
refused token, a failing plugin, a plugin on the test shell's `PATH` only):
the same connection updates in the same order and at the same levels, and the
same states; the refused port's message names the same cause in its own words
(FR-002); the plugin on the test shell's `PATH` connects in both builds,
started with `open -n`; no placeholder credential in anything either build
sent. The script prints the differences, none expected.

By hand, on the Tauri build started with a data directory that syncs the kind
kubeconfig: click the cluster; the catalog page shows the updates, then the
frame its sidebar with Pods and Config Maps. Stop the kind container
(`docker stop freelens-profile-control-plane`) and wait 30 s: `Connection
timed out` or the refused connection shows, and Reconnect works once the
container is started again. Repeat on the Electron build of `main`.

## 3. Browsing and watching (SC-003, SC-005, SC-006, Story 2)

```bash
node specs/009-main-cluster-connection/measure-connection.mjs watch "${TMPDIR%/}/kind-freelens-profile.yaml"
```

Expected: for a pod created and deleted with `kubectl`, the median of five
times to the row appearing and leaving is no longer in the Tauri build.

By hand: open Config Maps, choose All Namespaces: 3014 rows. In a terminal,
`kubectl --kubeconfig "${TMPDIR%/}/kind-freelens-profile.yaml" -n load create configmap extra --from-literal=k=v`:
the row appears; delete it: the row leaves. Leave the list open 11 minutes:
it stays current after the API server ends the watch at 600 s and the page
opens it again. Repeat on the Electron build of `main`.

## 4. Proxies and credentials (FR-006, Story 1 edge cases)

By hand, with made-up contexts in the run's kubeconfig:

- an `httpsProxy` in the cluster's settings that points at a local CONNECT
  proxy (any test proxy on `127.0.0.1`): the proxy logs the tunnel to the kind
  API server in both builds;
- `proxy-url` in the kubeconfig and an `httpsProxy` setting together: both
  builds use the kubeconfig's;
- an `HTTPS_PROXY` in the environment of `open -n --env`: both builds use it
  when neither of the above is set; `NO_PROXY=127.0.0.1` makes both go direct.

Record any difference in the pull request; research R2 marks the client-go
order Unverified.

## 5. Disconnecting and deleting (SC-011, Story 3)

```bash
node specs/009-main-cluster-connection/measure-connection.mjs ports "${TMPDIR%/}/kind-freelens-profile.yaml"
```

Expected: the Tauri build listens on no port and starts no
freelens-k8s-proxy; after a disconnect the API server's open `WATCH` requests
fall back to what they were before the cluster was opened; after quitting no
process the core started remains.

By hand, with a copy of the kind kubeconfig that has a second, made-up
context: Delete the kind cluster from the catalog page, choosing the second
context as the new current one. Expected: the file keeps its other entries,
`current-context` is the second context, the cluster leaves the catalog, the
cluster store and `lens-local-storage/<id>.json`; while the delete runs, the
entity shows `deleting`. Hold the lock by hand (`mkdir <file>.lock`) and
delete again: `Lock file is already being held` shows, and after 10 s the
stale lock is taken over. Repeat on the Electron build of `main`.

## 6. The channels (SC-007, Story 4)

From the frame page's console of each build (the Web Inspector of the Tauri
build, the DevTools of the Electron build), send each channel of
[contracts/cluster-channels.md](./contracts/cluster-channels.md) with the same
input, an unknown id included, and compare the answers; from a cluster frame,
name another cluster: the Tauri build refuses it (FR-026).

## 7. Speed and CPU (SC-002, SC-003, SC-004, SC-006, Story 5)

```bash
node specs/009-main-cluster-connection/measure-connection.mjs lists "${TMPDIR%/}/kind-freelens-profile.yaml"
```

Three runs of the scenario per build. Expected: the medians of the time to
the sidebar and to the first Pod row are no longer in the Tauri build, and
the median CPU of its main process over the 60 s is no higher than the
Electron build's main process; the time to the first row of 3000 ConfigMaps
is recorded for both. Copy the table the script prints into
`specs/baseline.md`.

## 8. The shell sync (FR-033 to FR-035)

By hand: set the `shell` setting of the run's user store to a script that
exits 1, start the Tauri build: the catalog page shows `Failed to sync shell
environment: Shell did not exit successfully: …` once, and a reload does not
show it again. Set it to a script that sleeps 40 s: the window opens at once,
and the message about the 30 s shows after it. Repeat on the Electron build
of `main`, whose window waits for the shell (research R4).

## 9. Channel list and routes

Check that every row of the section "main-cluster-connection" of
`specs/002-messaging-for-tauri/contracts/channel-list.md`, with
`shell-sync-failed-channel` and the four watch channels, says the core answers
it in 009, and that `specs/004-cluster-frames/contracts/routes.md` has the
rows of [contracts/api-kube.md](./contracts/api-kube.md).
