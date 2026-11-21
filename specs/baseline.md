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
