# Quickstart: Experimental Shell Spike

How to build the experimental build and check every success criterion of
[spec.md](./spec.md). The commands become runnable as the tasks land; the
package, its scripts and `measure.sh` do not exist before that. Run every
command from the repository root.

## Prerequisites

- Xcode Command Line Tools, for `hdiutil`, `codesign` and `python3`.
- rustup. The toolchain of `freelens-tauri/src-tauri/rust-toolchain.toml`
  installs itself on the first `cargo` command.
- The project's Node and pnpm, then the dependencies:

```bash
mise install
```

```bash
pnpm install
```

- For User Story 3 and the cluster-open figures: Docker and the reference kind
  cluster of section 0.4 of `specs/tauri-port-runbook.md`, with its kubeconfig
  written to a file of its own (below, `$KIND_KUBECONFIG`).

## Build

The renderer payload and the verified kubectl and helm come from the Electron
build's outputs:

```bash
pnpm build
```

```bash
pnpm --filter @freelensapp/freelens-tauri tauri:build
```

Expected: `freelens-tauri/src-tauri/target/release/bundle/dmg/` holds one
`.dmg`. Tauri removes the intermediate `.app` of `bundle/macos/` when the dmg
is the only target, so check the app inside the dmg: `codesign -dv` reports an
ad-hoc signature, and the bundle has `Resources/arm64/kubectl` and
`Resources/arm64/helm`, no `freelens-k8s-proxy`, no `.map` file and no Node
binary.

```bash
M=$(mktemp -d) && hdiutil attach -nobrowse -readonly -mountpoint "$M" "$PWD/freelens-tauri/src-tauri/target/release/bundle/dmg/Freelens Spike_0.1.0_aarch64.dmg" && codesign -dv "$M/Freelens Spike.app"; find "$M/Freelens Spike.app" -name '*.map' -o -name freelens-k8s-proxy -o -name node; hdiutil detach "$M"
```

## User Story 1: measurement

Idle runs, three of them, with `--kubeconfig=none` and a new website data
store per run:

```bash
specs/001-tauri-shell-spike/measure.sh spike "$PWD/freelens-tauri/src-tauri/target/release/bundle/dmg/Freelens Spike_0.1.0_aarch64.dmg" 3 60
```

The same method on the current build, as the control of research R7:

```bash
specs/001-tauri-shell-spike/measure.sh electron "$PWD/freelens/dist/mac-arm64/Freelens.app" 3 60
```

Expected:

- `dmg_bytes` ≤ 85,000,000 (SC-001).
- The median of `startup_s` ≤ 2.37 (SC-003).
- The median of `rss_mb` ≤ 394, with `proc=` lines that include the WebKit
  `WebContent`, `Networking` and `GPU` processes (SC-002).
- `kube_refs=0` on every idle run.
- The electron runs find the same four process kinds as the baseline.

Side by side (SC-006): with the current build running, take a listing of its
data, run, quit and delete the experimental build, and compare.

```bash
find "$HOME/Library/Application Support/Freelens" -type f -exec shasum {} + | sort > "$TMPDIR/freelens-before.txt"
```

```bash
find "$HOME/Library/Application Support/Freelens" -type f -exec shasum {} + | sort > "$TMPDIR/freelens-after.txt" && diff "$TMPDIR/freelens-before.txt" "$TMPDIR/freelens-after.txt"
```

Expected: no difference, apart from files the running current build itself
writes in the meantime, which the same steps without the experimental build
show as well.

## User Story 2: catalog

| Launch                                                                     | Expected                                                                                     |
| -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `--kubeconfig=freelens-tauri/src-tauri/tests/fixtures/three-contexts.yaml` | three entries, named after the contexts                                                      |
| no option, from the Finder                                                 | the contexts of `~/.kube/config`, or an empty catalog without a message if it does not exist |
| `--kubeconfig=none`                                                        | empty catalog, no message                                                                    |
| `--kubeconfig=/no/such/file`                                               | empty catalog, a message naming `/no/such/file`                                              |
| `--kubeconfig=freelens-tauri/src-tauri/tests/fixtures/invalid.yaml`        | empty catalog, a message naming the file and the error                                       |
| `--kubeconfig=freelens-tauri/src-tauri/tests/fixtures/no-contexts.yaml`    | empty catalog, no message                                                                    |

## User Story 3: cluster view

Launch with the kind kubeconfig and open `kind-freelens-profile`:

```bash
open -n "/Applications/Freelens Spike.app" --args --kubeconfig="$KIND_KUBECONFIG"
```

```bash
kubectl --kubeconfig "$KIND_KUBECONFIG" get namespaces -o name
```

Expected:

- The frame lists exactly the namespaces `kubectl` prints, in three attempts
  (SC-004).
- Opening the same cluster again shows the existing frame.
- After `kubectl create namespace spike-check`, the open frame does not change;
  closing and opening it shows `spike-check`. Delete the namespace afterwards.
- With the kind container stopped (`docker stop freelens-profile-control-plane`),
  opening the cluster shows that it cannot be reached, and the catalog still
  works.
- With a kubeconfig user that may not list namespaces, the frame says the
  permission is missing.

Isolation (SC-005), in a debug build (`tauri dev`), with Safari's Web
Inspector attached to the cluster frame: each attempt listed under "Isolation
expected in the browser" in [contracts/scheme-routes.md](./contracts/scheme-routes.md)
fails, with a security error or a blocked response.

Credentials (SC-009): `cargo test` runs the credential test of the routes, and
in the Web Inspector's network tab, no response of the main window or the
cluster frame contains the token or the certificate data of the kind
kubeconfig.

## Cluster-open figures

```bash
specs/001-tauri-shell-spike/measure.sh spike-cluster "$PWD/freelens-tauri/src-tauri/target/release/bundle/dmg/Freelens Spike_0.1.0_aarch64.dmg" 3 60 "$KIND_KUBECONFIG"
```

The current build, with the Namespaces scenario of `specs/profile-main.mjs`
(see the "Đo lại" part of "Hiệu năng main" in `specs/baseline.md` for its
arguments).

## Checks after each phase

The Electron build (SC-007):

```bash
pnpm build && pnpm type:check && pnpm test:unit
```

```bash
pnpm biome check && pnpm trunk check
```

```bash
pnpm knip:check
```

```bash
pnpm test:integration
```

The Rust core (Principle VIII):

```bash
cargo fmt --check --manifest-path freelens-tauri/src-tauri/Cargo.toml && cargo clippy --all-targets --manifest-path freelens-tauri/src-tauri/Cargo.toml -- -D warnings && cargo test --manifest-path freelens-tauri/src-tauri/Cargo.toml
```

## Record

Write the figures and the decision into `specs/baseline.md` as
[contracts/measurement-report.md](./contracts/measurement-report.md) lays out
(SC-008).
