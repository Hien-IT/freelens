# Implementation Plan: Experimental Shell Spike

**Branch**: `spec/tauri-port` | **Date**: 2026-11-22 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/001-tauri-shell-spike/spec.md`

## Summary

Build an experimental macOS build on Tauri 2, with a new Rust core (kube-rs,
tokio), and measure it against `specs/baseline.md` to decide whether the full
port goes ahead. The core reads one kubeconfig file, serves a small Node-free
UI and each cluster frame from a custom URI scheme with one host per cluster,
and lists a cluster's namespaces by making the API request itself, so that
credentials never reach a view.

The electron-vite renderer bundle cannot be reused unchanged: it requires
`electron` and Node builtins at load time (research R3). The spike therefore
has its own two-page UI, while the installer still carries the renderer bundle
and kubectl and helm, so that the installer measured is the one the full port
will ship (R8). freelens-k8s-proxy is dropped: the core holds the credentials
and talks to the API server itself.

## Technical Context

**Language/Version**: Rust 1.98.1 for the core (`rust-toolchain.toml`);
TypeScript 7.0.2 for the spike UI, bundled by Vite 8.3.8 (catalog versions)

**Primary Dependencies**: `tauri` 2.12.7, `tauri-build` 2.7.6,
`@tauri-apps/cli` 2.12.6, `kube` 5.1.0, `k8s-openapi` 0.29.0 (feature
`v1_37`), `tokio` 1.54.1, `serde`/`serde_json`, an MD5 crate for cluster ids
(R2)

**Storage**: none. The kubeconfig file is read-only, the webview's website
data store is non-persistent, and the core writes no files (R7).

**Testing**: `cargo test` (unit tests next to the code, integration tests in
`src-tauri/tests/` with fixture kubeconfigs holding fake credentials);
`pnpm type:check` covers the spike UI in the renderer program; the scenarios
and measurements of [quickstart.md](./quickstart.md) against the reference
kind cluster; the Electron build's own checks, unchanged.

**Target Platform**: macOS on Apple Silicon (arm64), WKWebView; development
and measurement machine as in `specs/baseline.md` (macOS 27.2.1)

**Project Type**: desktop application, an additional workspace package of the
monorepo

**Performance Goals**: the gates of the spec: dmg ≤ 85 MB (SC-001), idle RSS
of all processes ≤ 394 MB (SC-002), startup ≤ 2.37 s (SC-003)

**Constraints**: no Node runtime in the bundle; credentials stay in the core;
no Tauri IPC from the views; the Electron build keeps building and passing its
tests; ad-hoc signing (`signingIdentity: "-"`), no notarization

**Scale/Scope**: one kubeconfig file, the reference cluster of runbook section
0.4, two pages (catalog, namespace list)

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Principle                    | Answer for this plan                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Status               |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| VII. Tauri build             | Targets the Tauri build only, macOS arm64, ad-hoc signed. Outside `freelens-tauri/` it changes `pnpm-workspace.yaml` (package and catalog entry), `pnpm-lock.yaml`, `knip.jsonc`, the includes of `tsconfig.typecheck.json` and `tsconfig.renderer.json`, and `specs/profile-main.mjs`; none of them changes what the Electron build builds or runs. Its build, type check, unit and integration tests and `knip:check` are run after each phase.                                                                                                                                                                                                                 | Pass                 |
| VIII. Rust core              | `freelens-tauri/src-tauri/`, kube-rs and tokio, its own package; no Node binary in the bundle; `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, `cargo test`; `Cargo.lock` committed.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Pass                 |
| II. Environments             | Rust files run in the Rust core. The spike UI lives in `freelens-tauri/ui/src/renderer/` and is added to the renderer program (DOM, no Node), so `pnpm type:check` rejects Node there. Views reach the core only through requests on the custom scheme (R5); every value they show comes from the core.                                                                                                                                                                                                                                                                                                                                                           | Pass                 |
| I. Dependency injection      | No injectable is added or moved; `pnpm build:di` output is unchanged. The spike UI is TypeScript application code that is not wired through `@ogre-tools/injectable`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Deviation, see below |
| III. Extension API           | Not touched: the Tauri build has no extension system and nothing depends on `packages/extensions`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Not applicable       |
| IV. Styling                  | The spike UI has no stylesheet and uses none of the four systems.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Pass                 |
| V. Verified changes          | Rust: cargo checks and tests for launch options, catalog building, routes, origin rules and the absence of credentials in responses. TypeScript: `pnpm type:check`, `pnpm biome check`. TOML: `trunk check` (taplo). Running-application checks: missing file, empty file, unreachable cluster, missing permission, a namespace created while the view is open. Each running-application check of User Stories 2 and 3 is repeated on the current build as the control; where the two builds differ by design (the namespace list is loaded once in the experimental build and kept live in the current one), the report says so. The spike UI has no unit tests. | Deviation, see below |
| VI. Secrets and supply chain | kubectl and helm come from `freelens/binaries/client/darwin/arm64/`, filled and verified against `freelens/binaries.lock.json` by `build:binaries`; freelens-k8s-proxy is not shipped. Test kubeconfigs hold fake credentials in YAML; no `.pem` or `.key` file is added.                                                                                                                                                                                                                                                                                                                                                                                         | Pass                 |
| Conventions                  | New TypeScript files get the single-line header. Rust files carry the same text in a `/* … */` block, because `/** … */` is a doc comment in Rust. `tauri.conf.json` and the capability files are plain JSON without comments. Scratch output of measurements goes to `$TMPDIR`.                                                                                                                                                                                                                                                                                                                                                                                  | Pass                 |

Re-check after Phase 1 design: unchanged. The contracts add no injectable, no
Node use in the UI and no extension surface, and the two deviations are the
ones recorded below.

## Project Structure

### Documentation (this feature)

```text
specs/001-tauri-shell-spike/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── launch-options.md
│   ├── scheme-routes.md
│   ├── log-lines.md
│   └── measurement-report.md
├── checklists/
│   └── requirements.md
├── measure.sh           # measurement procedure (FR-011)
├── responsible-rss.py   # RSS of an app and of the processes it is responsible for
├── mark-interval.py     # time between two marks of the log
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
freelens-tauri/
├── package.json             # private @freelensapp/freelens-tauri; scripts tauri:ui, tauri:dev, tauri:build
├── vite.config.ts           # builds ui/ (two pages) into ui/dist
├── scripts/stage-payload.sh # stages kubectl, helm and the renderer payload for the bundle
├── .gitignore               # src-tauri/target, staged bundle payload
├── ui/
│   ├── index.html           # main window: catalog
│   ├── cluster.html         # cluster frame: namespace list
│   └── src/renderer/
│       ├── catalog.ts
│       └── cluster.ts
└── src-tauri/
    ├── Cargo.toml
    ├── Cargo.lock
    ├── rust-toolchain.toml
    ├── build.rs
    ├── tauri.conf.json      # identifier app.freelens.FreelensSpike, product "Freelens Spike",
    │                        # dmg target, signingIdentity "-", resources, no capabilities
    ├── icons/               # generated from freelens/build/icons/512x512.png
    ├── src/
    │   ├── main.rs
    │   ├── lib.rs           # builder: scheme registration, main window, page-load log
    │   ├── options.rs       # launch options (contracts/launch-options.md)
    │   ├── catalog.rs       # kubeconfig file → catalog entries and cluster ids
    │   ├── clusters.rs      # one kube client per opened cluster, GET passthrough
    │   └── scheme.rs        # routes, origin rules, static files (contracts/scheme-routes.md)
    └── tests/
        ├── fixtures/        # kubeconfig YAML with fake credentials
        └── scheme.rs

pnpm-workspace.yaml          # + freelens-tauri; catalog + @tauri-apps/cli
tsconfig.typecheck.json      # + freelens-tauri/ui/src/**/*
tsconfig.renderer.json       # + freelens-tauri/ui/src/renderer/**/*
knip.jsonc                   # + workspace freelens-tauri
specs/profile-main.mjs       # + scenario that opens the Namespaces view
```

**Structure Decision**: one new workspace package, `freelens-tauri/` (R1). The
Tauri crate embeds `ui/dist` as its frontend assets and serves them through
the custom scheme handler. A staging step before `tauri build` copies the
verified kubectl and helm and the renderer bundle without source maps into a
git-ignored directory, which `tauri.conf.json` lists as bundle resources.

### Implementation order

Risk first, so that a failure stops the spike before the rest is built:

1. Shell and frame proof: the package, the crate, the main window on
   `freelens-app://renderer.freelens.app/`, and an iframe on a second host of
   the scheme, with the isolation checks of SC-005.
2. Catalog and namespaces: launch options, the catalog from the kubeconfig
   file, `/api/clusters`, `/api-kube` passthrough, error messages, origin rules
   and the credential tests (SC-004, SC-009).
3. Installer and measurement: staging of kubectl, helm and the renderer
   payload, the dmg, `measure.sh`, and the three gates (SC-001 to SC-003).
4. Cluster-open figures and the report: the `namespaces-shown` mark, the
   Namespaces scenario of `profile-main.mjs`, the side-by-side check (SC-006),
   the Electron checks (SC-007), and the go/no-go record in
   `specs/baseline.md` (SC-008).

## Complexity Tracking

| Violation                                                               | Why Needed                                                                                                                                                                 | Simpler Alternative Rejected Because                                                                                                                                          |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Principle I: the spike UI is not wired through `@ogre-tools/injectable` | Two pages that each fetch one URL and render a list, with nothing to inject. They are replaced by the full renderer once spec 003 makes it run without Node.               | A DI container and generated registrations for two functions add code and a build step that change nothing the spike measures or proves.                                      |
| Principle V: the spike UI has no unit tests                             | Its behaviour is a fetch and a list. The quickstart scenarios of User Stories 2 and 3 check it in the running application, and the cargo tests cover every route it calls. | A DOM test setup for a new package (Vitest project, DOM environment, fixtures for the scheme) costs more than the UI it would test, and the UI is thrown away after spec 003. |
