# Baseline của bản Electron

Số đo để spec `001-tauri-shell-spike` so sánh. Bản Tauri phải được đo cùng
điều kiện và cùng cách đo dưới đây.

## Kết quả

Đo ngày 2026-11-22.

| Chỉ số                                   | macOS arm64               | Windows x64 | Linux x64 |
| ---------------------------------------- | ------------------------- | ----------- | --------- |
| Bản cài `.dmg` (MB)                      | 211.8                     |             |           |
| Bản `.zip` (MB)                          | 203.9                     |             |           |
| `Freelens.app` sau khi giải nén (MB)     | 641.9                     |             |           |
| Khởi động, trung vị 3 lần (s)            | 2.37 (6.60 / 2.37 / 2.29) |             |           |
| RAM sau 60 s đứng yên, trung vị (MB RSS) | 788 (782 / 788 / 790)     |             |           |
| Số tiến trình lúc đứng yên               | 4                         |             |           |

MB ở đây là 10^6 byte.

`Freelens.app` trên macOS arm64 gồm những phần dưới đây. Cột "Bản Tauri" là
dự đoán, chưa đo.

| Thành phần                                                 | MB    | Bản Tauri                             |
| ---------------------------------------------------------- | ----- | ------------------------------------- |
| `Frameworks/Electron Framework.framework` (Chromium, Node) | 300.2 | không còn                             |
| `Resources/app.asar` (renderer, main, `node_modules`)      | 166.3 | còn renderer; phần main tuỳ kiến trúc |
| `Resources/arm64` (helm, kubectl, freelens-k8s-proxy)      | 150.8 | vẫn còn                               |
| `Resources/LICENSES.chromium.html`                         | 20.1  | không còn                             |
| Còn lại                                                    | 4.5   |                                       |

## Điều kiện

- **Bản build:** build lại từ working tree trên commit `a7f1eb25b` (gồm cả các
  thay đổi chưa commit) bằng `pnpm build && pnpm build:app`, phiên bản
  2.1.0-0. `static/build` chỉ chứa output của lần build đó.
- **Máy:** Apple M4, RAM 24 GB, macOS 27.2.1.
- **Trạng thái app:** mỗi lần chạy dùng một thư mục dữ liệu mới, không có
  cluster nào được kết nối. Tuỳ chọn `syncKubeconfigEntries` đặt sẵn là `[]`,
  nên app không đồng bộ kubeconfig, catalog rỗng, và app không đọc `~/.kube`.
- **Khởi động:** từ lúc tạo tiến trình đến khi log in dòng
  `Window "first-application-window" loaded`, kiểm tra mỗi 50 ms.
- **RAM:** tổng RSS của mọi tiến trình của lần chạy đó, 60 giây sau khi cửa sổ
  load xong. RSS tính trùng bộ nhớ dùng chung giữa các tiến trình, nên con số
  chỉ dùng để so sánh, không phải lượng RAM thật app chiếm.
- Lần chạy đầu chậm hơn hai lần sau. Có thể vì đây là lần đầu bundle vừa giải
  nén được mở (macOS kiểm tra chữ ký, Chromium tạo profile); nguyên nhân này
  chưa được kiểm chứng.

## Đo lại

```bash
specs/measure-baseline.sh freelens/dist/Freelens-<phiên bản>-arm64-mac.zip 3 60
```

Script giải nén bản zip vào một thư mục tạm, chạy app với thư mục dữ liệu riêng
nên không đụng bản Freelens đã cài, và in kích thước, thời gian khởi động, RSS
cho từng lần. Cột `kube_refs` phải bằng 0: nghĩa là app không đọc `~/.kube`.
Xoá thư mục tạm (dòng `workdir=`) sau khi đo xong, vì nó còn giữ log của app.

## Hiệu năng main

Số đo gốc cho mục tiêu "nhanh hơn với cluster lớn". Đo ngày 2026-11-22 trên
cùng máy với phần Kết quả.

### Kết quả

Mỗi lần chạy, script mở catalog, mở cluster, vào Config Maps, chọn All
Namespaces, vào Pods, rồi để app yên đến hết 60 s tính từ thao tác đầu tiên.
Ba lần ghi CPU profile của main, ba lần không ghi để đối chứng. Mỗi ô là trung
vị, trong ngoặc là ba lần đo.

| Chỉ số                                                    | Có profile                | Không profile             |
| --------------------------------------------------------- | ------------------------- | ------------------------- |
| Kết nối cluster: từ lúc bấm đến khi sidebar hiện (ms)     | 453 (434 / 453 / 458)     | 882 (882 / 946 / 446)     |
| Hàng ConfigMap đầu tiên, sau khi chọn All Namespaces (ms) | 106 (85 / 787 / 106)      | 84 (103 / 4 / 84)         |
| Hàng Pod đầu tiên, sau khi bấm Pods (ms)                  | 25 (25 / 25 / 25)         | 25 (26 / 6 / 25)          |
| CPU của main trong 60 s (s)                               | 1.98 (2.02 / 1.98 / 1.98) | 0.75 (0.75 / 0.75 / 0.64) |
| CPU của renderer (s)                                      | 1.96 (2.00 / 1.96 / 1.63) | 1.81 (1.81 / 1.99 / 1.65) |
| CPU của hai tiến trình `Freelens Helper` còn lại (s)      | 0.77 (0.77 / 0.78 / 0.69) | 0.76 (0.76 / 0.82 / 0.67) |
| CPU của freelens-k8s-proxy (s)                            | 0.06 (0.08 / 0.06 / 0.06) | 0.06 (0.10 / 0.06 / 0.06) |
| RSS của main lúc kết thúc (MB)                            | 271 (319 / 250 / 271)     | 246 (244 / 251 / 246)     |
| Tổng RSS lúc kết thúc, trừ freelens-k8s-proxy (MB)        | 715 (953 / 655 / 715)     | 715 (709 / 729 / 715)     |

CPU profile của main, ba lần có profile:

| Chỉ số                                              | Trung vị              |
| --------------------------------------------------- | --------------------- |
| JS của main bận trong 60 s (ms)                     | 185 (184 / 192 / 185) |
| Trong đó GC (ms)                                    | 39 (43 / 39 / 35)     |
| Bận từ lúc bấm cluster đến khi sidebar hiện (ms)    | 67 (65 / 78 / 67)     |
| Bận từ khi Pods hiện đến hết 60 s, khoảng 59 s (ms) | 73 (77 / 73 / 67)     |

Theo package, thời gian tự thân nằm ở V8 kể cả GC (71–90 ms), nội bộ Node
(43–64 ms), undici (13–24 ms), mã của `main.js` (6–14 ms) và mobx (7–9 ms).

Nhận xét:

- Với 3014 ConfigMap, JS của main bận khoảng 0,3% thời gian, và cả tiến trình
  main dùng 0,75 s CPU mỗi phút khi không có profiler. Renderer dùng nhiều CPU
  hơn main.
- Profiler đẩy CPU của main từ khoảng 0,75 s lên khoảng 2 s, nên so CPU với bản
  Tauri thì dùng cột "Không profile".
- Phần chênh giữa 0,75 s CPU của tiến trình main và khoảng 0,19 s JS có thể là
  việc native của tiến trình trình duyệt Electron; điều này chưa được kiểm
  chứng.

### Điều kiện

- **Bản build:** `freelens/dist/mac-arm64/Freelens.app`, phiên bản 2.1.0-0,
  cùng lần đóng gói với file zip trong `freelens/dist`.
- **Cluster:** kind v0.33.0, Kubernetes v1.37.0, một node arm64, 9 pod hệ
  thống, namespace `load` có 3000 ConfigMap (3014 tính cả các namespace khác).
- **Trạng thái app:** mỗi lần chạy dùng một thư mục dữ liệu mới, chỉ đồng bộ
  file kubeconfig của kind (`syncKubeconfigEntries`). Log không có `/.kube`,
  nghĩa là app không đọc `~/.kube`.
- **Điều khiển:** main chạy với `--inspect=5858`, app với
  `--remote-debugging-port=9223`, và Playwright điều khiển UI qua CDP trong cả
  sáu lần. Vì vậy CPU của main và renderer gồm cả phần việc của CDP.
- **Profile:** lấy mẫu mặc định của V8, khoảng 40 500 mẫu trong 60 s.
- **Thời gian:** mỗi mốc là lúc Playwright thấy phần tử, nên sai lệch tới vài
  chục ms; hai giá trị 787 ms và 4 ms của hàng ConfigMap là nhiễu kiểu này.
  Thời gian kết nối cluster chia hai nhóm, khoảng 450 ms và khoảng 900 ms,
  chưa rõ vì sao.
- **CPU:** `ps -o time` của main và các tiến trình con trực tiếp (các helper,
  freelens-k8s-proxy), lấy hiệu giữa thao tác đầu tiên và lúc kết thúc.
- **RSS:** cách tính như phần Kết quả, nhưng đo lúc cluster đang mở, và không
  tính freelens-k8s-proxy.

### Đo lại

Tạo cluster kind và 3000 ConfigMap như mục 0.4 của
`specs/tauri-port-runbook.md`, rồi chạy từ thư mục gốc của repo, với `<thư mục>`
là thư mục chứa file kubeconfig của kind:

```bash
node specs/profile-main.mjs <thư mục> <thư mục>/kind-freelens-profile.yaml "$PWD/freelens/dist/mac-arm64/Freelens.app" 60
```

```bash
node specs/analyze-profile.mjs <thư mục>/main.cpuprofile <thư mục>/marks.json
```

`NO_PROFILE=1` chạy không có profiler. Mỗi lần chạy ghi đè `main.cpuprofile`,
`marks.json` và `stdout.log` trong `<thư mục>`, nên đổi tên chúng trước lần
sau.
