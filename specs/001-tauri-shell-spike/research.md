# Research: Experimental Shell Spike

Findings and decisions behind [plan.md](./plan.md). Sizes are in MB of 10^6
bytes. Facts about the current build come from reading its code; facts about
Tauri and WebKit come from their documentation and sources, and each one is
marked **Verified** when a source states it or **Unverified** when it is an
inference the spike has to confirm.

## R1. Workspace package and layout

**Decision**: a new workspace package `freelens-tauri/` at the repository root,
next to `freelens/` (the Electron application package). It holds the Rust core
as a Tauri crate in `freelens-tauri/src-tauri/` and the spike UI in
`freelens-tauri/ui/`. `pnpm-workspace.yaml` lists it beside `freelens`.

**Rationale**: it is an application, like `freelens/`, not a library; under
`packages/` it would sit among the libraries. Being a pnpm package lets it pin
`@tauri-apps/cli` and `vite` through the catalog. Its scripts are named
`tauri:*`, so `turbo run build`, `dev` and `test:unit` of the root never run
them, and the Electron build and CI stay as they are (Principle VII).

**Alternatives considered**: `packages/freelens-tauri` (would be picked up by
the `packages/**` glob, but mixes an application in with libraries); a Cargo
workspace at the repository root (a root `Cargo.toml` for one crate adds
nothing); `cargo tauri` installed globally instead of `@tauri-apps/cli` (not
pinned by any lockfile).

## R2. Toolchain and versions

**Decision**: Rust 1.98.1, pinned by `freelens-tauri/src-tauri/rust-toolchain.toml`
with `rustfmt` and `clippy`. Crates: `tauri` 2.12.7, `tauri-build` 2.7.6,
`kube` 5.1.0, `k8s-openapi` 0.29.0 with feature `v1_37`, `tokio` 1.54.1. npm:
`@tauri-apps/cli` 2.12.6 and the catalog's `vite` 8.3.8. No `@tauri-apps/api`:
the spike UI does not use Tauri IPC (R5). Release profile: `lto = true`,
`opt-level = "s"`, `codegen-units = 1`, `panic = "abort"`, `strip = true`, the
size profile the Tauri documentation recommends.

**Rationale**: these are the current stable releases (crates.io and npm,
**Verified**). The highest MSRV among them is kube's 1.95 (**Verified**), and
1.98.1 is the toolchain installed on the development machine. Feature `v1_37`
matches the reference cluster (Kubernetes v1.37.0). `rust-toolchain.toml` is
read by rustup without any change to `mise.toml`.

**Alternatives considered**: `tauri` 3.0 alpha (not stable); declaring Rust in
`mise.toml` (needs `mise lock` for every platform, for a tool only this package
uses); `k8s-openapi` feature `latest` (moves with the crate version, less
explicit).

## R3. Reusing the renderer bundle

**Finding**: the electron-vite renderer bundle cannot run unchanged in
WKWebView.

- The renderer is built from `freelens/src/renderer/index.html` into
  `freelens/static/build`. `runtimeRequireExternalsPlugin`
  (`freelens/electron.vite.config.ts`) turns every import of `electron` and of
  a Node builtin into `globalThis["require"](…)`, and the built bundle calls
  `require("electron")` at top level, outside any function.
- Windows are created with `nodeIntegration: true`,
  `nodeIntegrationInSubFrames: true` and `contextIsolation: false`, with no
  preload (`create-electron-window.injectable.ts`). Renderer code imports
  `ipcRenderer` straight from `electron`.
- The renderer reads the persistent stores (preferences, clusters, hotbars)
  from disk itself with `conf`, synchronously, and the startup path of both
  frames goes through files on the renderer legacy list of
  `scripts/type-check-environments/legacy.jsonc`.

**Decision**: the spike UI is new, Node-free code: two pages in plain
TypeScript, built by Vite, with no framework and no stylesheet. The full
renderer runs in the Tauri build after spec 003 (`renderer-without-node`) and
spec 002 (`messaging-for-tauri`).

To keep SC-001 honest, the installer still carries the renderer bundle of
`freelens/static/build` without its source maps, as files the spike never
loads, so that the installer measured is the size the full port will ship
(R8).

**Rationale**: a shim for `require` would have to serve synchronous file reads
and synchronous IPC in a page whose only channels to the core are
asynchronous; that is spec 003, not a spike.

**Consequence for SC-002**: the idle memory the spike measures holds a page of
a few kilobytes, not the full renderer. The go/no-go report therefore also
gives the JavaScript heap of the current build's root frame at idle, read over
CDP, as the approximate amount the full UI adds, and SC-008 compares its sum
with the idle RSS against 394 MB. **Unverified**: JavaScriptCore
and V8 do not use the same amount of memory for the same code, so this is an
estimate, not a measurement.

**Alternatives considered**: a `require` shim over Tauri IPC (rejected above);
running the renderer bundle for measurement only, with inert stubs (it throws
at the first real call, and its memory then means nothing); a React page that
reuses `@freelensapp/ui-components` (React and those components assume the
renderer's DI container and stylesheets, which is more to bring in than two
lists need).

## R4. Origins and the per-cluster frame

**Finding**: the current build serves the UI from a local HTTP/2 TLS server on
`127.0.0.1` (`main/freelens-proxy/freelens-proxy.ts`). Chromium's
`host-resolver-rules` maps `renderer.freelens.app` and `*.renderer.freelens.app`
to it (`setup-hostnames.injectable.ts`), a self-signed certificate is accepted
by `setCertificateVerifyProc`, and the cluster id is the first label of the
host (`cluster-id-url-parsing.ts`). The cluster frame is an iframe whose `src`
is `//<clusterId>.<location.host>` (`cluster-frame-handler.ts`).

WKWebView refuses a URL scheme handler for a scheme it handles itself, such as
`https` (**Verified**, Apple documentation of
`setURLSchemeHandler(_:forURLScheme:)`), and offers no host resolver rules.

**Decision**: a custom scheme `freelens-app`, registered with
`register_asynchronous_uri_scheme_protocol`, keeps the host names:

- main window: `freelens-app://renderer.freelens.app/`
- cluster frame: `freelens-app://<clusterId>.renderer.freelens.app/`

The cluster id is computed as the current build computes it: the MD5 of
`<kubeconfig path>:<context name>`, in hex, a valid host label.

**What the sources say, and what the spike proves**:

- The handler receives the whole URL, host included (**Verified**, wry source).
  Tauri loads any URL of a registered scheme (`WebviewUrl::CustomProtocol`),
  but its documentation only shows `localhost` as the host (**Unverified**
  for other hosts).
- A scheme served by a handler gets a tuple origin, not an opaque one, and is
  potentially trustworthy, so its pages are secure contexts (**Verified**,
  WebKit source, bug 223423). That `freelens-app://a.renderer.freelens.app` and
  `freelens-app://b.renderer.freelens.app` are distinct origins follows from
  the tuple (**Unverified**).
- WebKit registers handler schemes as CORS-enabled (**Verified**). An iframe
  loading a custom scheme works on macOS (**Verified**, user report); an iframe
  of another host of the same scheme is **Unverified**.
- A custom scheme cannot carry WebSocket upgrades (**Verified**, WebSocket
  standard), and wry delivers each response in one piece, so the handler cannot
  stream a Kubernetes watch (**Verified**, wry source and open issues). The
  spike needs neither: the namespace list is loaded once (clarification of
  2026-11-22). Watches are for `main-cluster-connection` (FR-013 of spec 002).
- Cookies cannot be set on custom schemes in WKWebView (**Verified**, Tauri
  maintainer statement), so the current build's proxy-token cookie has no
  equivalent; R5 uses the `Origin` header instead.

The gate of spec 001 requires the cluster frame on the custom scheme to work;
the first implementation phase builds exactly that, so that a failure stops
the spike early.

**Proof (T015), passed**, on macOS 27.2.1 with Safari 27.2, with the debug
build and `tests/fixtures/three-contexts.yaml`. Instead of Safari's Web
Inspector, a temporary page, built into the git-ignored `ui/dist` and never
committed, ran each attempt and reported it as a mark:

- the iframe on `freelens-app://<id>.renderer.freelens.app/` loads, and the
  main window gets its `load` event;
- its `window.origin` is `freelens-app://<id>.renderer.freelens.app`, a tuple
  origin, so different hosts are different origins;
- `isSecureContext` is true and `crypto.subtle` exists;
- reading `window.parent.document` and `window.top.location.href` throws;
- fetching `/api/clusters` of the main host and `/api-kube/api/v1/namespaces`
  of another cluster's host fails, and a temporary log of every request showed
  that neither request reached the core: WebKit refuses a cross-origin request
  on the scheme before the handler sees it, and the same-origin request of the
  main window carried no `Origin` header. The core's `Origin` rule is
  therefore a second line of defence that these attempts never reach;
- the frame's `localStorage` does not see the key the main window set.

**Two cluster frames (T041), passed**, on macOS 27.2.1 with the debug build and
`tests/fixtures/three-contexts.yaml`, two cluster frames open at once and a
temporary page in `ui/dist` reporting marks: the second frame does not see the
`localStorage` key the first one set, reading the first frame's document or
`localStorage` through `window.parent.frames` throws, and fetching
`/api-kube/api/v1/namespaces` on the first frame's host fails.

**Alternatives considered**: a loopback HTTP server in the core with
`<clusterId>.localhost` hosts (needs a port, a server and, for TLS, a
certificate that WKWebView trusts, which wry does not let the core accept);
the scheme name `freelens` (already the deep-link scheme of the
protocol-handler area, which spec 006 registers with macOS).

## R5. Requests from the views to the core

**Finding**: Tauri IPC does not work reliably from iframes on macOS. wry
defines `window.ipc` and the initialization scripts in the main frame only,
responses and events are delivered with `evaluateJavaScript`, which targets the
main frame (open issue tauri-apps/tauri#6204), and every URL of a registered
scheme counts as local, so a cluster frame would get the main window's
capabilities (all **Verified**, Tauri and wry sources).

**Decision**: the spike UI uses no Tauri IPC. Every request is an HTTP-style
request on the custom scheme, answered by the core
([contracts/scheme-routes.md](./contracts/scheme-routes.md)):

- the main window fetches `/api/clusters` on its own host;
- the cluster frame fetches `/api-kube/api/v1/namespaces` on its own host, and
  the core performs the request with its `kube::Client`, which holds the
  credentials (FR-015);
- the core refuses a request whose `Origin` header names another origin, never
  sends CORS headers, refuses `/api/*` on cluster hosts and `/api-kube/*` on
  the main host, and refuses every method other than `GET` on `/api-kube/*`.

The Tauri configuration grants no capability and the core registers no
command, so IPC reached from any frame can do nothing.

**Rationale**: it mirrors the current build, where the cluster frame reaches
the cluster through `/api-kube` on its own host, and it keeps the spike clear
of the IPC design that spec 002 makes. Credentials never leave the core, since
the views only see the responses of the API server.

**Alternatives considered**: Tauri commands from the main window plus
`postMessage` relays from the frames (depends on the iframe IPC limits above,
and is spec 002's question); a token in the URL instead of the `Origin` check
(visible to every script in the frame, and it adds nothing for a GET-only
spike).

## R6. Kubeconfig and launch options

**Decision**: launch option `--kubeconfig=<path>` chooses a file and
`--kubeconfig=none` chooses none; without the option the core reads
`$HOME/.kube/config` (clarification of 2026-11-22). It does not read the
`KUBECONFIG` variable. The core parses the file with `kube::config::Kubeconfig`
at launch, makes one catalog entry per context, and creates the client of a
cluster when its frame first asks for data, with
`Config::from_custom_kubeconfig` and the context's name.

Launch options reach the core as `std::env::args`: from a shell when the
binary is started directly, and through `open -n -a "Freelens Spike" --args …`
(**Verified** for `open`, `man open`; that `std::env::args` sees them is
**Unverified**).

**Rationale**: kube-rs reads kubeconfig files and builds clients per context
without a helper process, which is what lets the Tauri build drop
freelens-k8s-proxy (R8).

**Alternatives considered**: the `KUBECONFIG` variable (applications started
from the Finder do not inherit the shell's environment, so it would rarely be
set; **Unverified**); the Tauri CLI plugin (more than one option needs).

## R7. Measuring startup and memory

**Finding**: the baseline sums the RSS of the processes whose arguments
contain the run's data directory (`specs/measure-baseline.sh`), which finds
Electron's helpers. WKWebView's helpers, `com.apple.WebKit.WebContent`,
`.Networking` and `.GPU`, are XPC services started by launchd (parent pid 1),
with no such argument. They are per host application, not shared
(**Verified**, WebKit service plists and `man xpcservice.plist`).
`responsibility_get_pid_responsible_for_pid`, exported by
`/usr/lib/system/libquarantine.dylib` but not declared in the SDK, returns the
host application's pid for each of them (**Verified** by a local test on the
development machine). `launchctl procinfo` needs root.

**Decision**:

- **Startup**: the core prints `Window "main" loaded` when the main webview's
  page load finishes; the measurement script times from starting the process
  to that line, as the baseline does with `"first-application-window" loaded`.
- **Memory**: the script sums the RSS of the main process and every process
  whose responsible pid is the main process, found with a short `python3`
  `ctypes` call of that function, and records the process count and kinds. It
  applies the same method to the current build once, to confirm that it finds
  the same processes as the baseline's method.
- **Fresh state per run**: the main webview is created incognito, with a
  non-persistent website data store, so no run leaves data behind and the core
  writes no files of its own. That also keeps the current build's data
  untouched (FR-002).
- **Cluster open** (FR-011): the cluster frame requests `/api/mark?name=namespaces-shown`
  on its own host once the list is rendered, and the core prints
  `Mark "namespaces-shown"`; the script measures from the open to that line,
  then the RSS 60 seconds later. The current build is measured with
  `specs/profile-main.mjs`, extended with a scenario that opens the cluster's
  Namespaces view.

**Found while writing `measure.sh` (T019)**: started from a shell, the app's
responsible process is the application that runs the shell (the terminal or
the editor), and the WebKit helpers are attributed to that application too, so
the method finds the app's own process only. `measure.sh` therefore starts
both builds with `open -n`, which has LaunchServices start the app as its own
responsible process, and takes the app's output through `--stdout` and
`--stderr`. Started that way, the method also counts the system services that
run for the app, such as `MTLCompilerService` and `SetStoreUpdateService`, for
both builds alike. RSS is summed in the unit of `specs/measure-baseline.sh`,
the KiB of `ps` divided by 1024, so that the figures compare with the
baseline's 788.

**Alternatives considered**: `footprint` of the main pid alone (misses the XPC
services); Activity Monitor (not scriptable); a per-run website data store
identifier (macOS 14 and later, and it still writes under the bundle's WebKit
directory).

## R8. Installer size and helper programs

Measured by putting each binary of `freelens/dist/mac-arm64/Freelens.app`
(version 2.1.0-0) alone into a dmg with `hdiutil create -srcfolder`. The
current build's dmg is UDZO (zlib), as `hdiutil imageinfo` reports.

| Content                                      | Uncompressed | UDZO (zlib) | ULFO (lzfse) | ULMO (lzma) |
| -------------------------------------------- | ------------ | ----------- | ------------ | ----------- |
| kubectl 1.37.2                               | 59.6         | 20.9        | 18.4         | 13.4        |
| helm                                         | 63.4         | 22.8        | 20.2         | 14.9        |
| freelens-k8s-proxy                           | 27.8         | 10.1        | 8.8          | 6.3         |
| All three                                    | 150.8        | 51.8        | 45.5         | 32.6        |
| Renderer bundle, `static/build` without maps | 62.4         | 22.7        |              | 16.7        |

**Decision for FR-013**:

- **freelens-k8s-proxy is not shipped.** It exists to hold credentials and
  proxy `/api-kube`; in the Tauri build the core does both (R5, R6).
- **kubectl and helm are bundled**, from `freelens/binaries/client/darwin/arm64/`,
  which `pnpm --filter freelens build:binaries` fills and verifies against
  `freelens/binaries.lock.json` (Principle VI). The spike does not run them,
  but they are in the installer so that SC-001 measures what the full port
  ships.
- **The renderer bundle is carried** as well (R3).

Projection in UDZO: renderer 22.7 + kubectl 20.9 + helm 22.8 = 66.4, so the
shell, the core and the spike UI may take up to 18.6 compressed for the
installer to stay within 85. **Unverified**: Tauri states that a minimal app
can be under 600 KB, but gives no figure for an arm64 dmg with kube-rs.

**If the measured installer exceeds 85**, the levers in order are:

1. A stronger dmg compression, ULFO or ULMO; ULMO saves about 21 on this
   content, if Tauri's bundler or a post-step can produce it.
2. Downloading helm on first use (−22.8). This needs helm pins per version
   in the manner of `packages/kubectl-versions`; today
   `freelens/binaries.lock.json` pins only the bundled helm.
3. Downloading kubectl on first use (−20.9). `Kubectl.downloadKubectl()`
   already does this for version-matched kubectl, verified against
   `packages/kubectl-versions/build/checksums.json`; the bundled kubectl is
   its fallback today, and port-forward always uses it.

**Rationale**: the projection fits without making terminal or Helm depend on
the network on first use, which is the cost of options 2 and 3.

**Alternatives considered**: downloading both from the start (rejected for
the network dependency while the projection fits); shipping the installer
without the renderer bundle (would measure an installer the full port never
ships).

## R9. Main-process areas and the specs that port them

The areas of `packages/core/src/main` and of every `main` directory under
`packages/core/src/features`, the nested ones such as
`features/cluster/activation/main` included, group into the specs below, in
dependency order. Spec numbers 002 to 006
are those of `specs/tauri-port-runbook.md`; the `main-*` specs follow from 007
in this order.

| Order | Spec                              | Areas                                                                                                                                                                                                                                                                                                                       | Depends on               |
| ----- | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1     | 002 `messaging-for-tauri`         | the channels that replace `ipcMain`/`ipcRenderer` (`main/utils` ipc, `catalog-sync-to-renderer` transport, `store-sync`)                                                                                                                                                                                                    | 001                      |
| 2     | 003 `renderer-without-node`       | moves the renderer's file reads (`persistent-storage`, `conf`, `app-paths`) behind channels                                                                                                                                                                                                                                 | 002                      |
| 3     | 004 `cluster-frames`              | `freelens-proxy` and `router`: static files, per-cluster origins on the custom scheme, the route table the later specs add routes to                                                                                                                                                                                        | 001, 002                 |
| 4     | `main-foundation`                 | `logger`, `app-paths`, `vars`, `crypto`, `child-process`, `utils` (CLI arguments, system proxy), `fetch`, `persistent-storage`, `user-preferences`, `favorites`, `hotbar/storage`                                                                                                                                           | 002                      |
| 5     | `main-catalog`                    | `catalog`, `catalog-sync-to-renderer`, `cluster-enumeration` and `features/cluster/enumeration`, `weblinks`, `catalog-sources` (kubeconfig sync and file watching)                                                                                                                                                          | foundation               |
| 6     | `main-cluster-connection`         | `cluster`, `features/cluster/*` (activation, connections, delete-dialog, execute, state-sync, storage), `cluster-detectors`, `kubeconfig-manager`, `create-cluster`, `k8s`, `k8s-request`, the `/api-kube` proxy including watches, and the stream from the core to a view that watches need; replaces `freelens-k8s-proxy` | catalog, 002             |
| 7     | `main-kube-tools`                 | `kubectl` (download and verification), `kube-tools`, `resource-applier`, `routes` apply and patch                                                                                                                                                                                                                           | cluster-connection       |
| 8     | `main-shell-env`                  | `shell-sync`, `terminal-shell-lookup`                                                                                                                                                                                                                                                                                       | foundation               |
| 9     | 005 `terminal-pty`                | `shell-session` (local, node and standalone shells), and the shell tokens of `freelens-proxy` (`shell-request-authenticator`)                                                                                                                                                                                               | kube-tools, shell-env    |
| 10    | `main-port-forward`               | `routes` port-forward                                                                                                                                                                                                                                                                                                       | kube-tools               |
| 11    | `main-metrics`                    | `prometheus`, `routes` metrics                                                                                                                                                                                                                                                                                              | cluster-connection       |
| 12    | `main-helm`                       | `helm`, `helm-releases`, `routes` helm                                                                                                                                                                                                                                                                                      | kube-tools               |
| 13    | `main-pod-files-and-certificates` | `pod-files`, `secret-certificates`                                                                                                                                                                                                                                                                                          | kube-tools               |
| 14    | `main-traffic-map`                | `traffic-map`                                                                                                                                                                                                                                                                                                               | cluster-connection, helm |
| 15    | 006 `desktop-integration`         | `electron-app` (single instance, dock, theme, power), window controls and history, `theme`, `tray`, `application-menu`, `protocol-handler`, `versions`, `navigate-*`, `zoom`, `path-picking-dialog`, `licenses`, `population-of-logs-to-a-file`                                                                             | foundation               |

`start-main-application`, `ipc` and the window parts of `electron-app` are the
shell itself. Spec 001 starts them and spec 002 carries their channels. The
channels they answer belong to spec 004 when they concern a cluster frame
(`cluster:set-frame-id`, `current-visible-cluster`), and to spec 006 otherwise
(window actions, history, the menu as a context menu, `root-frame-rendered`,
`reload-page-channel`).
`freelens/src/main` only bootstraps the DI container and has no Rust
counterpart.

Left out, because the Tauri build has neither extensions nor auto-update:
`extension-loader`, `features/extensions/*`, `extension-credentials`,
`file-system-provisioner`, `kube-tools-for-extensions`, `shell-session/shell-env-modifier`, the
extension runnables of `start-main-application`, `navigate-for-extension`,
`about-bundled-extensions`, and the unused `is-auto-updating` flag.

Not inventoried: the inside of the `@freelensapp/application`,
`messaging-for-main` and `prometheus` packages that main also registers.

## R10. Risks the spike carries

- **Cross-host iframes on the custom scheme** may not load or may not be
  isolated (R4). Proven first; a failure ends the spike.
- **Ad-hoc signing on recent macOS**: an open, unconfirmed report says that
  macOS 26.5 and later kill large ad-hoc-signed binaries signed with 16 KB
  pages, with re-signing at `--pagesize=4096` as the workaround
  (tauri-apps/tauri#15801). The development machine runs macOS 27.2.1.
- **Site isolation** may give each cluster origin its own WebContent process
  (**Unverified**); the cluster-open measurement counts the processes.
- **First launch of an unnotarized app**: macOS asks the user to allow it in
  System Settings, Privacy & Security (**Verified**, Tauri and Apple
  documentation). Measurement runs start the binary directly from a locally
  built bundle.
