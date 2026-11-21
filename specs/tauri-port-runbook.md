# Runbook: port Freelens sang Tauri bằng Spec Kit

File làm việc cho đợt port, không phải tài liệu của dự án. Nó hướng dẫn chạy
từng spec theo thứ tự, mỗi spec qua đủ vòng Spec Kit, và chỉ sang spec sau khi
spec trước qua "cổng".

- Các lệnh `/speckit-*` gõ trong Claude Code, ở thư mục gốc của repo. Chúng
  được cài ở chế độ chỉ chạy khi người dùng gõ: Claude không tự gọi chúng.
- Prompt viết bằng tiếng Anh để `spec.md`, `plan.md`, `tasks.md` sinh ra cùng
  ngôn ngữ với repo. Đổi sang tiếng Việt nếu muốn.
- Lệnh có ghi **(chưa chạy thử)** chưa được kiểm tra trên máy này.

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

## 1. Cập nhật constitution (một lần)

Principle II (tách main/renderer) và III (Extension API là contract) đụng thẳng
vào việc port, nên sửa constitution trước khi viết spec nào:

```text
/speckit-constitution Add principles for porting to Tauri 2:
(1) The Electron build stays the shipping build until the Tauri build reaches parity; both build and pass their tests side by side.
(2) Rust code lives in its own workspace package and passes cargo fmt --check, cargo clippy --all-targets -- -D warnings and cargo test; Cargo.lock is committed.
(3) Extension API v2 is unchanged; any breaking change becomes a new API version documented in docs/extensions/api.md with a migration path.
(4) Bundled binaries (freelens-k8s-proxy, kubectl, helm) stay verified against freelens/binaries.lock.json in the Tauri build too.
(5) Extend Principle II with a Rust core environment beside main and renderer, and the rule that the renderer runs without Node.
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

Phụ thuộc: mục 0 và 1.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/001-tauri-shell-spike Freelens needs an experimental desktop build that runs side by side with the shipping Electron build, to find out whether a different desktop shell reduces installer size and memory enough to justify a port. A user can launch it, see the catalog, and open one cluster in its own frame. Success: installer at least <X>% smaller than in specs/baseline.md, idle memory at least <Y>% lower, startup no slower, on macOS, Windows and Linux. Out of scope: extensions, terminal, auto-update, tray. The Electron build keeps building and passing its tests.
```

```text
/speckit-clarify measurement method, which cluster the frame test uses, what "opens a cluster" means
```

```text
/speckit-plan Tauri 2 on Rust stable, in a new workspace package (propose its path). Reuse the electron-vite renderer bundle unchanged where possible. research.md compares (A) rewriting the main process in Rust with kube-rs and tokio against (B) keeping the TypeScript main process in a Node sidecar behind an adapter for the electron APIs, and recommends one with evidence from this spike. Prove the per-cluster iframe on *.renderer.freelens.app and the freelens-extension:// scheme on WKWebView, WebView2 and WebKitGTK. Record every constitution deviation in Complexity Tracking.
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

**Cổng (đi tiếp hay dừng):** các số đo đạt tiêu chí; iframe và scheme chạy trên
cả ba webview; `research.md` đã chọn A hoặc B. Không đạt thì dừng port. Spec 003
vẫn đáng làm vì có ích cho cả bản Electron.

### 002 `messaging-for-tauri`: kênh main ↔ renderer

Phụ thuộc: 001 qua cổng. Code tính năng đã đi qua các package trong
`packages/technical-features/messaging`; bản Electron nằm ở `messaging-for-main`
và `messaging-for-renderer`.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/002-messaging-for-tauri Every request and message channel between the main side and the renderer works in the Tauri build exactly as in the Electron build, with no change to feature code or to what extensions see. Success: every channel the Electron build registers is served in the Tauri build; no feature code outside the messaging packages talks to Electron IPC directly; the unit and integration tests pass unchanged.
```

```text
/speckit-plan Add Tauri implementations beside messaging-for-main and messaging-for-renderer, using the same injection tokens; follow the shape of messaging-fake-bridge for tests. First list every file outside the messaging packages that uses ipcMain or ipcRenderer directly and move it onto the channels. Use the main-process architecture chosen in specs/001-tauri-shell-spike/research.md.
```

```text
/speckit-analyze channels registered in Electron but missing in Tauri
```

**Cổng:** grep `ipcMain|ipcRenderer` ở mục 0.3 chỉ còn trả về file trong các
package messaging; mọi channel chạy được trong bản Tauri.

### 003 `renderer-without-node`: renderer không cần Node

Phụ thuộc: không có, làm song song với 001 được. Hiện cửa sổ bật
`nodeIntegration` và `nodeIntegrationInSubFrames`
(`create-electron-window.injectable.ts`).

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/003-renderer-without-node The renderer works without Node.js: everything it needs from the file system, processes or the operating system comes from the main side over request channels. Success: the renderer list in scripts/type-check-environments/legacy.jsonc is empty; the app works with Node integration off in the window and in the cluster frames; the unit and integration tests pass.
```

```text
/speckit-plan Go file by file through the renderer legacy list; each Node use becomes a request channel answered in main (AGENTS.md, "Values computed in main"). Remove each file from the legacy list and from the noNodejsModules exemption in biome.jsonc together. Turning off nodeIntegration and nodeIntegrationInSubFrames is the last task. Extensions: follow "Node and Electron in the renderer" in docs/extensions/migrating-from-v1.md and do not change Extension API v2.
```

```text
/speckit-implement one legacy file per task group, smallest first
```

**Cổng:** danh sách renderer trong `legacy.jsonc` rỗng; `pnpm type:check` pass;
app chạy với `nodeIntegration: false`.

### 004 `cluster-frames-and-schemes`: frame của cluster và scheme extension

Phụ thuộc: 001 qua cổng.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/004-cluster-frames-and-schemes Each cluster view keeps running isolated in its own origin, and extension assets keep loading through the extension scheme, in the Tauri build on all three platforms. Success: two clusters open at the same time without sharing state; extension assets load; the Electron build is unchanged.
```

```text
/speckit-plan Map what setup-hostnames, register-scheme-as-privileged and handle-extension-scheme do in Electron to Tauri custom URI scheme protocols and webview settings. Document the differences between WKWebView, WebView2 and WebKitGTK in research.md, with a fallback for any webview that does not allow cross-origin frames on a custom scheme.
```

```text
/speckit-checklist cross-platform webview behaviour and origin isolation
```

**Cổng:** chạy được trên macOS, Windows và Linux; hai cluster mở cùng lúc không
dùng chung state.

### 005 `terminal-pty`: terminal

Phụ thuộc: 002.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/005-terminal-pty The terminal dock works in the Tauri build with the same shells, environment and behaviour as in the Electron build. Success: the shell starts with the environment the host gives kubectl and helm (contract C15 in docs/extensions/api.md); resize, copy and paste, and several tabs work on all three platforms.
```

```text
/speckit-plan Compare portable-pty in Rust against keeping node-pty in the Node sidecar, according to the choice in specs/001-tauri-shell-spike/research.md. xterm.js stays in the renderer; the data path uses the channels from specs/002-messaging-for-tauri.
```

**Cổng:** terminal chạy trên cả ba nền tảng, có kiểm tra môi trường shell.

### 006 `desktop-integration`: tray, menu, deep link, updater, cấu hình

Phụ thuộc: 002.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/006-desktop-integration Tray, application menu, freelens:// deep links, auto-update and persisted settings behave in the Tauri build as in the Electron build. Success: a user who switches from the Electron build keeps all settings and catalog entries; deep links open the right view; an update is offered and installed on each platform.
```

```text
/speckit-plan Use the Tauri plugins for tray, menu, deep links, updater and storage. Settings stay in the same files and format that conf writes today, so both builds read them. Handle updater signing keys under Principle VI.
```

```text
/speckit-checklist settings migration and update signing
```

**Cổng:** cấu hình của bản Electron được đọc nguyên vẹn; deep link và cập nhật
chạy trên cả ba nền tảng.

### 007 `extension-runtime`: extension

Phụ thuộc: 002, 003, 004.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/007-extension-runtime Extensions written for Extension API v2 keep working in the Tauri build, or the break becomes a new, documented API version with a migration path. Success: packages/fixture-extension and freelensapp/freelens-example-extension load and pass their checks; docs/extensions/api.md states which contracts hold in the Tauri build.
```

```text
/speckit-plan Main-side extensions need a JavaScript runtime: compare a Node sidecar against a new API version that runs extensions only in the renderer. The host stays the single instance of React, mobx and monaco, proven with identity assertions (AGENTS.md, "Extension API"). Run packages/core/src/extensions/__tests__/extension-api-declared-values.test.ts.
```

```text
/speckit-analyze contracts C1 to C15 in docs/extensions/api.md
```

**Cổng:** fixture extension và example extension chạy; `docs/extensions/api.md`
được cập nhật.

### 008 `packaging-ci`: đóng gói và CI

Phụ thuộc: 001 đến 007.

```text
/speckit-specify SPECIFY_FEATURE_DIRECTORY=specs/008-packaging-ci Signed installers of the Tauri build for macOS, Windows and Linux on x64 and arm64 are built in CI and bundle the same verified freelens-k8s-proxy, kubectl and helm as the Electron build.
```

```text
/speckit-plan Ship the three binaries as Tauri sidecars, verified against freelens/binaries.lock.json the way the Electron build does (AGENTS.md, "Bundled Binary Versions"). Commit Cargo.lock; add cargo fmt, clippy and test to CI; keep the Electron jobs until the switch.
```

**Cổng:** CI tạo được bản cài đã ký cho cả 6 tổ hợp; các số đo trong
`specs/baseline.md` vẫn đạt tiêu chí của spec 001.

## 4. Sự cố thường gặp

- **`/speckit-plan` hoặc `/speckit-tasks` báo không tìm thấy feature:** ghi lại
  `.specify/feature.json` như ở mục 2.
- **`/speckit-analyze` báo CRITICAL:** sửa spec hoặc plan, chạy lại
  `/speckit-tasks`, rồi analyze lại. Đừng implement khi còn CRITICAL.
- **`/speckit-implement` làm vượt phase:** xem `git diff`, bỏ phần thừa bằng
  `git restore <file>`, lần sau ghi rõ phase sau lệnh.
- **Muốn đổi template:** dùng `.specify/templates/overrides/`, không sửa
  `.specify/` hay `.claude/skills/speckit-*`.
