# Quickstart: Cluster Frames

How to check every success criterion of [spec.md](./spec.md). The commands
become runnable as the tasks land: `--frames-check` does not exist before
that. Run every command from the repository root.

## Prerequisites

The prerequisites of `specs/002-messaging-for-tauri/quickstart.md`: mise,
pnpm, rustup and the Xcode Command Line Tools, then `mise install` and
`pnpm install`. For the Electron build's integration tests and its manual
check: Docker and the reference kind cluster of section 0.4 of
`specs/tauri-port-runbook.md`. Pass `--kubeconfig` to every `kind` and
`kubectl` command, so that nothing reaches a real cluster.

## The core

Route table, frame record, queue events and the two channels, refusals
included (FR-023):

```bash
cd freelens-tauri/src-tauri && cargo fmt --check && cargo clippy --all-targets -- -D warnings && cargo test
```

Expected: the tests of `tests/scheme.rs` that existed before this feature
pass unchanged, and the new ones cover each rule of
[contracts/routes.md](./contracts/routes.md) and
[contracts/frames-api.md](./contracts/frames-api.md):

- an unknown host, an unknown cluster id, a foreign `Origin`, a route of the
  other audience, an unknown path and a wrong method;
- a host in upper case (served), and a host with a trailing dot, a port or a
  user name (no view);
- the policies of the two pages, `frame-ancestors` included;
- the navigation rule of the main window: a URL of the scheme whose host
  names a view, `about:blank` and `about:srcdoc` are allowed; `https:`,
  `file:`, `data:`, any other `about:` URL, and a scheme URL whose host names
  no view are refused;
- a duplicate route at startup;
- `cluster:set-frame-id` from the frame of its own cluster, from another
  cluster's frame and from the main window; `current-visible-cluster` from the
  main window, with `null`, with an unknown id, and from a cluster frame;
- `Announced` once for two announcements, `Forgotten` on a closed queue, on a
  reload of the main window and on `forget`, none on a frame's own reload;
- a frame closed while its poll waits is forgotten by 60 seconds after the
  close, with tokio's paused clock;
- `send_to` reaching one view of three, and nothing for a cluster without a
  frame or a queue restarted by a later frame of the same cluster.

## User Stories 1 to 3 in the Tauri build: the check run

On the fixture kubeconfig of spec 001, whose three fake contexts open frames
without reaching any cluster:

```bash
pnpm --filter @freelensapp/freelens-tauri tauri:ui && cd freelens-tauri/src-tauri && cargo run -- --kubeconfig="$PWD/tests/fixtures/three-contexts.yaml" --frames-check 2>&1 | tee "$TMPDIR/frames-check.log"
```

The run takes a little over a minute, most of it the wait of step 5. Expected:
the pass condition of [contracts/frames-log.md](./contracts/frames-log.md),
steps 1 to 7. Then:

```bash
grep -E 'isolation failed|frames-check-failed|Refused' "$TMPDIR/frames-check.log"
```

Expected: nothing. The spike's own `A cluster request failed` lines, for the
fixture's unreachable clusters, are expected.

```bash
grep -E '^Frames check: .* origin ' "$TMPDIR/frames-check.log" | sort | uniq -c
```

Expected: four distinct origins, the second cluster's listed twice (SC-001,
SC-004).

## By hand in the Tauri build

On the same fixture, without the check:

```bash
cd freelens-tauri/src-tauri && cargo run -- --kubeconfig="$PWD/tests/fixtures/three-contexts.yaml" 2>&1 | tee "$TMPDIR/frames.log"
```

1. Open the three clusters, then switch between them twice. Expected: one
   `Frames: cluster <id> announced` per cluster, a `Frames: visible cluster`
   line on each switch, and no frame reloads (each lists its namespaces
   attempt once).
2. Open a cluster that is already open. Expected: no new frame and no second
   `announced` line.
3. Close the shown cluster. Expected: `Frames: no visible cluster`, and within
   60 seconds `Frames: cluster <id> forgotten: its queue closed`.
4. Reload the main window from Safari's Web Inspector, with two clusters
   open. Expected: a `forgotten: the main window reloaded` line for each, at
   once.

## Surroundings and the control

With an empty catalog, and with a kubeconfig that does not parse:

```bash
cd freelens-tauri/src-tauri && cargo run -- --kubeconfig="$PWD/tests/fixtures/no-contexts.yaml" --frames-check
```

```bash
cd freelens-tauri/src-tauri && cargo run -- --kubeconfig="$PWD/tests/fixtures/invalid.yaml" --frames-check
```

Expected for each: `Frames check: not run: the catalog has 0 clusters, three
are needed`, no frame opened, the catalog page showing its message, and no
`isolation failed` line.

The missing field, a host whose cluster id is not in the catalog, is a cargo
test of `core/tests/scheme.rs` (T010).

On `main` as the control, with the spike's pages and `three-contexts.yaml`:
open the three clusters, switch between them, close one and open it again.
Expected: the frames show, hide and go away as on the branch; `main` prints no
`Frames:` line, which only the branch has.

A change in the cluster while a frame is open does not apply: the frame page
reads its cluster once and holds nothing a watch updates.

## The Electron build

After the deletions of research R8:

```bash
pnpm build:di && pnpm type:check && pnpm test:unit
```

```bash
pnpm build && pnpm knip:check
```

```bash
pnpm test:integration
```

Expected: all pass, with no existing test removed or weakened (SC-007).

```bash
grep -rn 'request-freelens-proxy-certificate\|freelensProxyCertificateChannel\|requestFreelensProxyCertificate' packages freelens/src --include='*.ts' --include='*.tsx' | grep -v node_modules
```

Expected: nothing (FR-019, SC-006).

Manual check, on the branch and on `main` as the control, with the kind
cluster and two more contexts of it: open three clusters, switch between
them, close one, open it again. Expected: the same result on both, and the
first screen of each frame shows its cluster (SC-007).

## The channel list

Expected: the section "cluster-frames (004)" of
`specs/002-messaging-for-tauri/contracts/channel-list.md` lists
`cluster:set-frame-id` and `current-visible-cluster` as answered by the core,
and `request-freelens-proxy-certificate` is in "Removed by this feature", with
FR-019 as the reason (FR-015, FR-020, SC-006).
