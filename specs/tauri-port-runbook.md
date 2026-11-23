# Runbook: port Freelens sang Tauri bằng Spec Kit

File làm việc cho đợt port, không phải tài liệu của dự án. Nó hướng dẫn chạy
từng spec theo thứ tự, mỗi spec qua đủ vòng Spec Kit, và chỉ sang spec sau khi
spec trước qua "cổng".

- Các lệnh `/speckit-*` gõ trong Claude Code, ở thư mục gốc của repo. Chúng
  được cài ở chế độ chỉ chạy khi người dùng gõ: Claude không tự gọi chúng.
- Prompt viết bằng tiếng Anh để `spec.md`, `plan.md`, `tasks.md` sinh ra cùng
  ngôn ngữ với repo. Đổi sang tiếng Việt nếu muốn.
- Lệnh có ghi **(chưa chạy thử)** chưa được kiểm tra trên máy này.

## Quyết định đã chốt

| Câu hỏi                             | Quyết định                                                                                                           |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Mục tiêu                            | Bản cài nhỏ hơn, ít RAM hơn, nhanh hơn với cluster lớn, bảo mật và không phụ thuộc Electron                          |
| Quan hệ với upstream                | Fork nội bộ, ngừng merge `upstream/main` của freelensapp/freelens                                                    |
| Extension                           | Bản Tauri không có hệ extension                                                                                      |
| Nền tảng                            | Chỉ macOS (WKWebView)                                                                                                |
| Main process                        | Viết lại bằng Rust (kube-rs, tokio), port dần theo từng mảng tính năng; không dùng Node sidecar                      |
| Nhân lực                            | Một người cùng Claude: spec nhỏ, mỗi lần implement một phase, review từng diff                                       |
| Cổng của spike 001                  | `.dmg` ≤ 85 MB (−60%), RSS lúc đứng yên ≤ 394 MB (−50%), khởi động ≤ 2.37 s, so với `specs/baseline.md`              |
| Đo hiệu năng                        | Profile main process với một cluster kind local trước khi viết spec 001 (mục 0.4)                                    |
| Phạm vi trước khi thay bản Electron | Đủ tính năng: phần cơ bản cùng terminal và exec vào pod, Helm, metrics (Prometheus), port-forward                    |
| Chip                                | Chỉ Apple Silicon (arm64)                                                                                            |
| Ký và phân phối                     | Chưa có Apple Developer ID: ký ad-hoc, không notarize, phân phối nội bộ; người dùng tự cho phép app trong Gatekeeper |
| Bản Electron                        | Giữ build song song một thời gian sau khi bản Tauri đạt đủ tính năng, rồi mới xoá                                    |

Hệ quả cho các spec bên dưới: không còn spec extension, chỉ kiểm tra trên
WKWebView với arm64, và phần lớn khối lượng là các spec port từng mảng của main
sang Rust, kể cả terminal, Helm, metrics và port-forward. Auto-update chưa nằm
trong phạm vi cho đến khi có Developer ID hoặc chốt cách cập nhật khác.

## 0. Chuẩn bị (một lần)

### 0.1 Nhánh làm việc

Commit hoặc stash các thay đổi đang dở trước, rồi:

```bash
git status
```

```bash
git switch -c spec/tauri-port
```

Spec Kit ở repo này không có extension git, nên `/speckit-specify` không tự tạo
hay đổi nhánh.

### 0.2 Đo baseline của bản Electron

Tiêu chí thành công của spec 001 so với các số này. Kết quả của macOS arm64,
cách đo và điều kiện đo nằm trong `specs/baseline.md`. Đo lại (hoặc đo trên máy
khác) bằng script đi kèm, sau khi `pnpm build && pnpm build:app` tạo bản zip:

```bash
specs/measure-baseline.sh freelens/dist/Freelens-<phiên bản>-arm64-mac.zip 3 60
```

Script chạy app với thư mục dữ liệu riêng, nên không cần thoát bản Freelens đã
cài, và tắt đồng bộ kubeconfig, nên app không đọc `~/.kube`. Bản Tauri phải
được đo theo cùng điều kiện.

### 0.3 Kiểm kê phần gắn với Electron

Chạy lại khi cần số mới; đừng chép số vào spec, vì chúng đổi theo code.

```bash
grep -rlE 'from "electron"|require\("electron"\)' packages/*/src packages/technical-features/*/*/src freelens/src --include='*.ts' --include='*.tsx' | grep -v test | wc -l
```

```bash
grep -rlE 'ipcMain|ipcRenderer' packages/*/src freelens/src --include='*.ts' --include='*.tsx' | grep -v test
```

```bash
grep -rl 'node-pty' packages/*/src --include='*.ts' | grep -v test
```

File renderer và common còn cần Node nằm trong danh sách renderer của
`scripts/type-check-environments/legacy.jsonc`.

Danh sách mảng tính năng của main, để chia các spec port sang Rust:

```bash
ls -d packages/core/src/main/*/ && find packages/core/src/features -type d -name main | sort
```

### 0.4 Profile main process với cluster kind

Mục tiêu "nhanh hơn với cluster lớn" cần một số đo gốc trước spec 001. Kết quả
nằm ở mục "Hiệu năng main" của `specs/baseline.md`.

Nếu môi trường đặt `DOCKER_DEFAULT_PLATFORM=linux/amd64`, kind kéo node image
amd64 và `kind create cluster` lỗi ở bước kubeadm. Đặt biến này thành
`linux/arm64` cho các lệnh kind:

```bash
export DOCKER_DEFAULT_PLATFORM=linux/arm64
```

Cài kind và tạo cluster, ghi kubeconfig ra file riêng để không đổi
`~/.kube/config` và context hiện tại của bạn:

```bash
brew install kind
```

```bash
kind create cluster --name freelens-profile --kubeconfig "${TMPDIR%/}/kind-freelens-profile.yaml"
```

Tạo tải để danh sách đủ lớn, ví dụ 3000 ConfigMap:

```bash
export KUBECONFIG="${TMPDIR%/}/kind-freelens-profile.yaml" && kubectl create namespace load && for i in $(seq 1 3000); do printf 'apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: cm-%s\n  namespace: load\ndata:\n  k: v\n---\n' "$i"; done | kubectl apply -f -
```

Sau đó `specs/profile-main.mjs` chạy app với inspector của main ở cổng 5858,
trong một thư mục dữ liệu riêng chỉ đồng bộ đúng file kubeconfig trên. Script
mở cluster, chọn All Namespaces (danh sách mặc định chỉ lọc namespace
`default`), xem danh sách ConfigMap và Pod, và ghi CPU profile của main trong
60 giây qua CDP. Cách chạy nằm ở mục "Hiệu năng main" của `specs/baseline.md`.
Xoá cluster khi xong:

```bash
kind delete cluster --name freelens-profile --kubeconfig "${TMPDIR%/}/kind-freelens-profile.yaml"
```

## 1. Cập nhật constitution (một lần)

Principle II (tách main/renderer) và III (Extension API là contract) đụng thẳng
vào việc port, nên sửa constitution trước khi viết spec nào:

```text
/speckit-constitution Add principles for porting to Tauri 2. This repository is now an internal fork that no longer follows upstream freelensapp/freelens.
(1) The Tauri build targets macOS on Apple Silicon only, ad-hoc signed for internal distribution. The Electron build stays the working build until the Tauri build reaches parity, including terminal, Helm, metrics and port-forward, and keeps building and passing its tests for a while after that.
(2) The Tauri build has no extension system. Principle III applies to the Electron build only, and no Tauri work depends on packages/extensions.
(3) The main process of the Tauri build is written in Rust (kube-rs, tokio) in its own workspace package, ported area by area; no Node runtime ships with it. Rust code passes cargo fmt --check, cargo clippy --all-targets -- -D warnings and cargo test; Cargo.lock is committed.
(4) Extend Principle II with the Rust core as an environment beside main and renderer, and the rule that the renderer runs without Node.
(5) Bundled or downloaded binaries (freelens-k8s-proxy, kubectl, helm) stay verified against freelens/binaries.lock.json and packages/kubectl-versions/build/checksums.json.
```

Sau đó đọc diff của `.specify/memory/constitution.md`, kiểm tra số phiên bản
đã tăng, rồi commit riêng file đó.

## 2. Vòng lặp cho mỗi spec

| Bước | Lệnh                                                                    | Sau khi chạy                                                                                                                          |
| ---- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | `/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/<nnn>-<tên> <prompt>` | Đọc `spec.md` và `checklists/requirements.md`. Spec không được có tên công nghệ; mỗi tiêu chí thành công phải có số đo.               |
| 2    | `/speckit-clarify <chủ đề>`                                             | Trả lời tối đa 5 câu hỏi; câu trả lời được ghi vào spec.                                                                              |
| 3    | `/speckit-plan <hướng dẫn>`                                             | Đọc `plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`. Kiểm tra mục Constitution Check và Complexity Tracking. |
| 4    | `/speckit-checklist <lĩnh vực>` (tuỳ chọn)                              | Checklist cho bảo mật, hiệu năng hoặc đa nền tảng.                                                                                    |
| 5    | `/speckit-tasks <ràng buộc>`                                            | Đọc `tasks.md`: thứ tự, phụ thuộc, task nào đụng code hiện có.                                                                        |
| 6    | `/speckit-analyze <trọng tâm>`                                          | Sửa mọi lỗi CRITICAL và HIGH trong spec hoặc plan, chạy lại bước 5, rồi mới code.                                                     |
| 7    | `/speckit-implement <phase>`                                            | Mỗi lần một phase. Chạy các kiểm tra ở dưới, xem diff, commit.                                                                        |
| 8    | `/speckit-converge`                                                     | Thêm vào `tasks.md` những việc còn thiếu so với spec; quay lại bước 7 cho đến khi không còn task.                                     |
| 9    | Cổng                                                                    | Kiểm tra tiêu chí cổng của spec ở mục 3. Chưa qua thì không mở spec sau.                                                              |

Đặt `SPECIFY_FEATURE_DIRECTORY` ở đầu prompt để thư mục spec có đúng tên trong
runbook này.

### Kiểm tra sau mỗi phase

```bash
pnpm build && pnpm type:check && pnpm test:unit
```

```bash
pnpm biome check && pnpm trunk check
```

Từ khi spec 001 tạo crate Rust (thay `<crate>` bằng đường dẫn plan chọn):

```bash
cargo fmt --check --manifest-path <crate>/Cargo.toml && cargo clippy --all-targets --manifest-path <crate>/Cargo.toml -- -D warnings && cargo test --manifest-path <crate>/Cargo.toml
```

Khi spec đụng tới cluster, chạy thêm integration test (cần kind):

```bash
pnpm test:integration
```

### Commit

Chỉ thêm đúng file của bước vừa làm, không `git add -A`:

```bash
git status
```

```bash
git add specs/<nnn>-<tên> && git commit -m "Specify <tên>"
```

### Chuyển sang spec khác

Spec đang làm được lưu trong `.specify/feature.json` (file local, git bỏ qua).
Quay lại một spec cũ:

```bash
printf '{"feature_directory":"specs/002-messaging-for-tauri"}\n' > .specify/feature.json
```

## 3. Từng spec

### 001 `tauri-shell-spike`: thử nghiệm và quyết định đi tiếp hay dừng

Phụ thuộc: mục 0 (kể cả profile ở 0.4) và mục 1.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/001-tauri-shell-spike Freelens needs an experimental macOS build on a different desktop shell, with its core written from scratch, that runs side by side with the current Electron build, to prove that the port meets its size and memory goals before the full port starts. A user can launch it, see the catalog of clusters from a kubeconfig file, and open one cluster in its own frame showing its namespaces. Success, measured as in specs/baseline.md: installer at most 85 MB, idle memory at most 394 MB RSS, startup no slower than 2.37 s. Out of scope: terminal, auto-update, tray, extensions, Windows and Linux. The Electron build keeps building and passing its tests.
```

```text
/speckit-clarify measurement method, which kubeconfig and cluster the frame test uses, what "opens a cluster" means
```

```text
/speckit-plan Tauri 2 on Rust stable with kube-rs and tokio, in a new workspace package (propose its path). Reuse the electron-vite renderer bundle unchanged where possible. Prove the per-cluster frame on *.renderer.freelens.app with a custom URI scheme on WKWebView. research.md also: (1) inventories the main-process areas under packages/core/src/main and packages/core/src/features/*/main and proposes one spec per area, ordered by dependency; (2) measures how much of the installer the bundled helm, kubectl and freelens-k8s-proxy take, and evaluates downloading kubectl and helm on first use with pinned checksums (packages/kubectl-versions already does this for kubectl) to reach 85 MB. Record every constitution deviation in Complexity Tracking.
```

```text
/speckit-tasks no behaviour change in packages/core; every task that touches existing code says why
```

```text
/speckit-analyze measurability of the success criteria, Principles II and VI
```

```text
/speckit-implement Phase 1 and Phase 2 only
```

**Cổng (đi tiếp hay dừng):** `.dmg` ≤ 85 MB, RSS ≤ 394 MB, khởi động ≤ 2.37 s;
frame cluster và custom scheme chạy trên WKWebView; `research.md` có danh sách
mảng của main và đề xuất spec cho từng mảng. Không đạt thì dừng port. Spec 003
vẫn đáng làm vì có ích cho cả bản Electron.

### 002 `messaging-for-tauri`: kênh main ↔ renderer

Phụ thuộc: 001 qua cổng. Code tính năng phía renderer đã đi qua các package
trong `packages/technical-features/messaging`; bản Electron nằm ở
`messaging-for-renderer`. Phía main giờ là Rust, nên mỗi channel thành một
command hoặc event của Tauri.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/002-messaging-for-tauri The renderer talks to the new core through the same request and message channels it uses today, with no change to feature code in the renderer. Success: the renderer side has an implementation of the channels for the new shell; there is a list of every channel the Electron build registers with the core area that will answer it; no feature code outside the messaging packages talks to Electron IPC directly; the unit tests pass unchanged.
```

```text
/speckit-plan Add a Tauri implementation beside messaging-for-renderer, using the same injection tokens; follow the shape of messaging-fake-bridge for tests. On the Rust side, a typed command and event layer that the core areas register their channels with. First list every file outside the messaging packages that uses ipcMain or ipcRenderer directly and move it onto the channels.
```

```text
/speckit-analyze channels registered in Electron without an owner in the Rust core
```

**Cổng:** grep `ipcMain|ipcRenderer` ở mục 0.3, bỏ qua
`packages/core/src/extensions/` (hệ extension chỉ có ở bản Electron, được miễn
theo clarification của spec 002), chỉ còn trả về file trong các package
messaging; mỗi channel có một mảng của core nhận trách nhiệm, hoặc ghi lý do
không port.

### 003 `renderer-without-node`: renderer không cần Node

Phụ thuộc: không có, làm song song với 001 được. Hiện cửa sổ bật
`nodeIntegration` và `nodeIntegrationInSubFrames`
(`create-electron-window.injectable.ts`).

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/003-renderer-without-node The renderer works without Node.js: everything it needs from the file system, processes or the operating system comes from the main side over request channels. Success: the renderer list in scripts/type-check-environments/legacy.jsonc is empty; the app works with Node integration off in the window and in the cluster frames; the unit and integration tests pass.
```

```text
/speckit-plan Go file by file through the renderer legacy list; each Node use becomes a request channel answered in main (AGENTS.md, "Values computed in main"). Remove each file from the legacy list and from the noNodejsModules exemption in biome.jsonc together. Turning off nodeIntegration and nodeIntegrationInSubFrames is the last task. Do not change Extension API v2, which the Electron build still has.
```

Khi lập plan, spec 003 quyết định giữ `nodeIntegrationInSubFrames` bật,
khác với prompt trên. Electron chỉ nạp preload vào iframe khi cờ này bật, và
preload là đường duy nhất để cluster frame tới main. Trang vẫn không có Node vì
sandbox bật (Clarifications của spec 003, FR-012). Một spike chứng minh điều đó
trước mọi việc khác.

```text
/speckit-implement one legacy file per task group, smallest first
```

**Cổng:** danh sách renderer trong `legacy.jsonc` rỗng; `pnpm type:check` pass;
bundle renderer không còn import module Node hay `electron` nào; app chạy với
`nodeIntegration: false` và sandbox bật, và trong cửa sổ lẫn cluster frame,
`require`, `process` và `Buffer` đều không tồn tại.

### 004 `cluster-frames`: frame riêng cho từng cluster

Phụ thuộc: 001 qua cổng.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/004-cluster-frames Each open cluster runs isolated in its own origin in the macOS build, as it does in the Electron build. Success: three clusters open at the same time without sharing state, cookies or storage; closing one does not affect the others; the Electron build is unchanged; every channel that specs/002-messaging-for-tauri/contracts/channel-list.md gives to cluster-frames is answered by the new core, or the views stop sending it.
```

```text
/speckit-plan Map what setup-hostnames does in Electron (the *.renderer.freelens.app host mapping and the local proxy) to Tauri custom URI scheme protocols and WKWebView settings, building on the frame proven in specs/001-tauri-shell-spike. The freelens-extension:// scheme is not needed: the Tauri build has no extensions.
```

```text
/speckit-checklist origin isolation on WKWebView
```

**Cổng:** ba cluster mở cùng lúc trên macOS, không dùng chung state.

### 005 `terminal-pty`: terminal

Phụ thuộc: 002.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/005-terminal-pty The terminal dock works in the macOS build with the same shells, environment and behaviour as in the Electron build. Success: the shell starts with the environment the host gives kubectl and helm (contract C15 in docs/extensions/api.md describes it); resize, copy and paste, and several tabs work; every channel that specs/002-messaging-for-tauri/contracts/channel-list.md gives to terminal-pty is answered by the new core.
```

```text
/speckit-plan portable-pty in the Rust core; xterm.js stays in the renderer; the data path uses the channels from specs/002-messaging-for-tauri. The login-shell environment is computed in the core, as the Electron main does today.
```

**Cổng:** terminal chạy trên macOS, có test kiểm tra môi trường shell.

### 006 `desktop-integration`: menu bar, menu, deep link, cấu hình

Phụ thuộc: 002.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/006-desktop-integration The menu bar item, application menu, window controls and history, freelens:// deep links and persisted settings behave in the macOS build as in the Electron build. Success: a user who switches from the Electron build keeps all settings and catalog entries; deep links open the right view; every channel that specs/002-messaging-for-tauri/contracts/channel-list.md gives to desktop-integration is answered by the new core. Out of scope: auto-update, because the build is not signed with an Apple Developer ID.
```

```text
/speckit-plan Use the Tauri plugins for tray, menu, deep links and storage. Settings stay in the same files and format that conf writes today, so both builds read them while they run side by side.
```

```text
/speckit-checklist settings migration between the Electron and Tauri builds
```

**Cổng:** cấu hình của bản Electron được đọc nguyên vẹn; deep link chạy trên
macOS.

### 007 trở đi `main-<mảng>`: port từng mảng của main sang Rust

Phụ thuộc: 002, và danh sách mảng trong `specs/001-tauri-shell-spike/research.md`.
Mỗi mảng một spec, làm theo thứ tự phụ thuộc mà research đề xuất (ví dụ:
kubeconfig sync và catalog, kết nối cluster và proxy, helm, port-forward,
metrics). Terminal, Helm, metrics và port-forward đều phải xong trước khi bản
Tauri thay bản Electron. Mẫu cho một mảng, thay `<nnn>`, `<mảng>` và phần mô tả:

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/<nnn>-main-<mảng> In the macOS build, <what the user can do in this area> works as in the Electron build. Success: every channel of this area in the list from specs/002-messaging-for-tauri is answered by the new core; the behaviour checked by the existing tests of this area holds; <a measurable target, such as list latency or CPU on the kind cluster of specs/baseline.md>.
```

```text
/speckit-plan Port the injectables of this area to the Rust core: those in the directories R9 of specs/001-tauri-shell-spike/research.md gives it, nested main directories under packages/core/src/features included, and those the Electron column of specs/002-messaging-for-tauri/contracts/channel-list.md names for its channels. Keep the on-disk formats the Electron build writes. Port or rewrite the unit tests of the area as cargo tests.
```

```text
/speckit-analyze channels of this area without a Rust handler, and behaviour of the existing tests not covered
```

**Cổng của mỗi mảng:** mọi channel của mảng có handler trong Rust, cargo test
pass, và chỉ tiêu đo của mảng đạt.

### `<nnn>-packaging-ci`: đóng gói và CI (spec cuối)

Phụ thuộc: mọi spec trước.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/<nnn>-packaging-ci An ad-hoc signed installer of the Tauri build for macOS on Apple Silicon is built in CI for internal distribution, with freelens-k8s-proxy, kubectl and helm verified as in the Electron build or downloaded on first use with pinned checksums, and with instructions for allowing the app in Gatekeeper.
```

```text
/speckit-clarify which binaries are bundled and which are downloaded; where the internal download lives
```

```text
/speckit-plan Build for aarch64-apple-darwin only, ad-hoc signed, without notarization. Verify bundled binaries against freelens/binaries.lock.json the way the Electron build does (AGENTS.md, "Bundled Binary Versions"). Add cargo fmt, clippy and test to CI. Keep the Electron jobs while both builds run side by side.
```

**Cổng:** CI tạo được bản cài arm64 ký ad-hoc, cài và chạy được trên một máy
khác sau khi cho phép trong Gatekeeper; các số đo trong `specs/baseline.md` vẫn
đạt tiêu chí của spec 001.

## 4. Sự cố thường gặp

- **`/speckit-plan` hoặc `/speckit-tasks` báo không tìm thấy feature:** ghi lại
  `.specify/feature.json` như ở mục 2.
- **`/speckit-analyze` báo CRITICAL:** sửa spec hoặc plan, chạy lại
  `/speckit-tasks`, rồi analyze lại. Đừng implement khi còn CRITICAL.
- **`/speckit-implement` làm vượt phase:** xem `git diff`, bỏ phần thừa bằng
  `git restore <file>`, lần sau ghi rõ phase sau lệnh.
- **Muốn đổi template:** dùng `.specify/templates/overrides/`, không sửa
  `.specify/` hay `.claude/skills/speckit-*`.
