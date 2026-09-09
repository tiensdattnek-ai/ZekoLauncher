# 🧱 Kiến trúc Zeko Launcher

## 1. Vì sao kiến trúc này

PrismLauncher là launcher C++/Qt tuyệt vời, nhưng nó cần toolchain Qt + CMake để dựng,
và không thể "chạy thử ngay" trong môi trường xem trước. Zeko Launcher giữ nguyên
**mô hình khái niệm** của Prism (instance độc lập, thư viện dùng chung, tải có xác minh,
profile Java theo phiên bản) nhưng triển khai lõi bằng **Node.js + Web UI** để:

- chạy được ngay với `node server/index.js` (không cần build),
- có bản xem trước trực tiếp để thiết kế giao diện được kiểm chứng thật,
- giữ đường nâng cấp rõ ràng sang bản desktop đóng gói (mục 8).

Toàn bộ logic nghiệp vụ nằm ở tầng `server/lib/*` **không phụ thuộc HTTP** —
nghĩa là khi chuyển sang Tauri/Electron hoặc lõi C++/Qt, chỉ cần thay tầng giao tiếp,
còn scanner, downloader, launcher, presets giữ nguyên hành vi.

## 2. Sơ đồ

```
┌──────────────────────────────────────────────────────────────────────┐
│  TRÌNH DUYỆT / CỬA SỔ DESKTOP                                      │
│  client/index.html                                                   │
│    ├─ css/main.css        design system Aurora (tokens, 6 chủ đề)    │
│    └─ js/                                                            │
│         main.js           router + store + SSE + playbar + nền động   │
│         api.js            fetch wrapper, mọi lời gọi /api/*          │
│         ui.js             toast, modal, ring, FpsChart, định dạng    │
│         i18n.js           vi / en                                    │
│         views/            dashboard instances performance security   │
│                           console downloads settings about           │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ REST (JSON) + SSE (/api/stream)
┌───────────────────────────────▼──────────────────────────────────────┐
│  server/index.js  — Express, static, SSE hub, error handler          │
│  server/routes/api.js — ~40 endpoint                                 │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  server/lib/ (lõi nghiệp vụ, thuần Node, không biết gì về HTTP)       │
│                                                                      │
│   paths.js        thư mục dữ liệu theo win32/darwin/linux            │
│   settings.js     cấu hình toàn cục + recommendRam() theo máy thật   │
│   catalog.js      danh mục phiên bản — OFFLINE-FIRST                 │
│   instances.js    CRUD instance, slug hoá, thống kê dung lượng       │
│   downloads.js    hàng đợi tải, giới hạn đồng thời, SHA-1 khi ghi    │
│   zip.js          đọc ZIP/JAR (EOCD/ZIP64/central dir) + entropy     │
│   zipwrite.js     ghi ZIP tối giản — chỉ để tạo tệp mẫu kiểm thử     │
│   scanner.js      ★ Zeko Sentinel: 3 lớp phát hiện + manifest SHA-1  │
│   quarantine.js   cách ly / khôi phục / xoá hẳn, có index.json       │
│   performance.js  ★ Zeko Turbo: đọc preset, gợi ý theo phần cứng     │
│   java.js         dò JVM (PATH, Adoptium, jdk dirs, JAVA_HOME)       │
│   metrics.js      CPU/RAM/đĩa, quickBenchmark → ZPI, autoTuneAdvice  │
│   launcher.js     dựng JVM args + classpath, spawn, stream log       │
│                                                                      │
│  server/data/     versions.json  performance-presets.json            │
│                   scanner-rules.json                                 │
└───────────────────────────────┬──────────────────────────────────────┘
                                │
┌───────────────────────────────▼──────────────────────────────────────┐
│  <ZekoRoot>/   (AppData / Application Support / ~/.local/share)      │
│    instances/<slug>/{mods,resourcepacks,shaderpacks,config,saves,    │
│                      logs,screenshots,.zeko}                         │
│    libraries/  assets/  versions/<id>/  java/  cache/                │
│    quarantine/<batch>/{files/,report.json}  index.json               │
│    logs/  reports/  zeko.json  instances.json                        │
└──────────────────────────────────────────────────────────────────────┘
```

## 3. Những quyết định đáng chú ý

### 3.1 Offline-first cho danh mục phiên bản
`catalog.js` thử `piston-meta.mojang.com` với `AbortController` timeout 6 s.
Nếu thất bại: dùng cache 12 giờ → nếu không có cache: dùng `server/data/versions.json`
(28 phiên bản nhúng sẵn, kèm cờ `popular`, ghi chú và `java` yêu cầu).
UI luôn hiện **nguồn danh mục** (`live` / `cache` / `embedded`) để người dùng không bị lừa.

### 3.2 Instance độc lập + thư viện dùng chung
Giống Prism: mỗi instance có `gameDir` riêng nên mod/thế giới không lẫn nhau,
nhưng `libraries/`, `assets/`, `versions/` dùng chung → cài 5 instance 1.20.4 chỉ tốn
một lần dung lượng.

### 3.3 Đọc JAR mà không giải nén
`zip.js` tự phân tích EOCD (kể cả ZIP64), central directory và local header,
rồi `inflateRawSync` từng entry khi cần. Nhờ vậy Sentinel xem được nội dung
`*.class`, `*.mcfunction` bên trong JAR **mà không ghi gì ra đĩa** — quan trọng
vì giải nén mã độc ra đĩa là tự tạo rủi ro.

### 3.4 Spawn bằng mảng tham số
```js
spawn(cmd.javaPath, [...cmd.jvmArgs, ...cmd.argv], { cwd, env, stdio: ['ignore','pipe','pipe'] })
```
Không bao giờ đi qua shell → tên instance, đường dẫn có dấu cách hay ký tự lạ
đều không thể biến thành lệnh thực thi.

### 3.5 SSE thay vì WebSocket
Log game, tiến độ tải và số liệu hệ thống đều là luồng một chiều từ server.
`EventSource` đủ dùng, tự kết nối lại, và đi qua proxy xem trước mà không cần cấu hình thêm.

### 3.6 UI không framework
8 view là 8 ES module thuần, mỗi module export `render(host)` + `mount(host, ctx)`.
Không có bundler, không có runtime 200 KB — đúng tinh thần "tối ưu cho máy yếu".
Hiệu ứng nền là canvas 2D tự viết, tắt được bằng một cú nhấp, và tự tắt
khi `prefers-reduced-motion`.

## 4. Vòng đời một lượt chơi

```
Người dùng bấm CHƠI (hoặc phím Space)
  │
  ├─ POST /api/launch/:id
  │    ├─ đọc instance + settings + version json (cache ở versions/<id>/<id>.json)
  │    ├─ buildLaunchCommand()
  │    │    ├─ performance.getPreset(perfProfile)   → JVM args
  │    │    ├─ recommendRam() + clamp theo RAM vật lý → -Xms/-Xmx
  │    │    ├─ java.pickJava(version)               → đúng bản Java 8/17/21
  │    │    ├─ duyệt libraries[] theo rules (os/name) → classpath
  │    │    └─ thay ${classpath} ${natives_directory} ${game_directory} …
  │    │
  │    ├─ settings.security.autoScanOnLaunch?
  │    │    └─ scanDirectory(instanceDir)  → riskScore
  │    │         threats > 0 && blockOnThreat → throw ZEKO_BLOCKED_BY_SENTINEL
  │    │
  │    ├─ kiểm tra javaOk + clientJar tồn tại → throw ZEKO_NOT_READY (kèm lệnh đã dựng)
  │    ├─ ghi .zeko/last-launch-command.txt
  │    └─ spawn(java, args)
  │
  ├─ stdout/stderr → push vào session.log + SSE 'log'
  │    dòng nào có "FPS: n" → session.fpsHint (dashboard vẽ biểu đồ)
  │
  └─ exit → SSE 'exit' + cập nhật lastPlayed/playTimeSeconds/launches
            + ghi logs/<slug>-<ts>.log
```

Lưu ý: khi thiếu Java hoặc thiếu tệp game, Zeko **không im lặng thất bại** —
nó trả về đúng lệnh mà nó *sẽ* chạy để người dùng chẩn đoán, và UI hiện modal
giải thích từng vấn đề kèm nút sửa.

## 5. Mô hình dữ liệu

`<ZekoRoot>/instances.json` — mảng instance:

```jsonc
{
  "id": "uuid",
  "slug": "sinh-ton-2026",          // tên thư mục, đã slug hoá
  "name": "Sinh tồn 2026",
  "version": "1.20.4",
  "loader": "fabric",               // vanilla|fabric|quilt|forge|neoforge
  "icon": "🌲",
  "group": "Mặc định",
  "lastPlayed": "ISO-8601", "playTimeSeconds": 0, "launches": 0,
  "ram": { "minMb": null, "maxMb": null },   // null = kế thừa toàn cục
  "javaPath": null, "javaArgsExtra": [],
  "window": { "width": 1280, "height": 720, "fullscreen": false },
  "perfProfile": "lowend", "perfAuto": true,
  "security": { "autoScanOnLaunch": true, "blockOnThreat": true },
  "env": {}
}
```

Mỗi instance còn có bản sao tại `<instanceDir>/.zeko/instance.json` để thư mục
instance tự chứa đủ thông tin (copy sang máy khác vẫn dùng được), kèm
`last-scan.json`, `last-launch-command.txt`, `manifest.sha1.json`.

## 6. API (tóm tắt)

| Nhóm | Endpoint |
|---|---|
| Chung | `GET /api/health` `GET /api/meta` `GET /api/news` `GET /api/stream` (SSE) |
| Cài đặt | `GET/PATCH /api/settings` `POST /api/settings/reset` |
| Phiên bản | `GET /api/versions` `GET /api/versions/:id` |
| Instance | `GET/POST /api/instances` `GET/PATCH/DELETE /api/instances/:id` `POST /api/instances/:id/duplicate` `GET /api/instances/:id/files` `GET /api/instances/:id/logs` `POST /api/instances/:id/files/sample` |
| Turbo | `GET /api/performance/presets` `GET /api/performance/recommend` `GET /api/performance/mods` `POST /api/performance/apply/:instanceId` |
| Hệ thống | `GET /api/system` `POST /api/system/benchmark` `GET /api/system/java` |
| Sentinel | `GET /api/security/status` `GET /api/security/rules` `POST /api/security/scan` `GET /api/security/scan/:jobId` `POST /api/security/scan-file` `POST /api/security/verify` `GET /api/security/quarantine` `POST /api/security/quarantine/:batch/restore` `DELETE /api/security/quarantine/:batch` |
| Tải & chạy | `POST /api/download` `POST /api/launch/:instanceId` `POST /api/stop/:instanceId` `GET /api/sessions` `GET /api/console/:instanceId` |

Quét là tác vụ dài nên dùng mẫu **job**: `POST /security/scan` trả `jobId` ngay (202),
client thăm dò `GET /security/scan/:jobId` để lấy `%` và kết quả.

## 7. Chạy & phát triển

```bash
npm install
npm start              # http://localhost:4179
npm run dev            # node --watch, tự nạp lại khi sửa server
npm run scan -- <dir>  # quét từ terminal
npm test               # bộ kiểm thử lõi
```

Biến môi trường:

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ZEKO_PORT` | `4179` | Cổng HTTP |
| `ZEKO_HOST` | `0.0.0.0` | Interface lắng nghe (0.0.0.0 để xem trước qua proxy) |
| `ZEKO_ROOT` | theo OS | Thư mục dữ liệu |
| `ZEKO_DOWNLOAD_CONCURRENCY` | `4` | Số tệp tải song song — hạ xuống 2 cho mạng yếu |

## 8. Đường nâng cấp lên bản desktop "cao cấp nhất"

Các bước được xếp theo thứ tự giá trị/công sức:

1. **Đóng gói**: bọc nguyên trạng server + client bằng **Tauri 2** (Rust, ~10 MB)
   hoặc Electron. Lõi Node hiện tại chạy không đổi trong Tauri sidecar.
2. **Xác thực Microsoft**: device-code OAuth 2.0 + Xbox Live → Minecraft token,
   lưu trong keychain của OS (`keytar` / `secret-tool` / DPAPI), **không** lưu plaintext.
3. **Mod loader tự động**: `meta.fabricmc.net`, `files.minecraftforge.net`,
   `maven.neoforged.net` — tải profile JSON rồi ghép vào `buildLaunchCommand`.
4. **Tải mod trực tiếp**: Modrinth API v2 (`/search`, `/version`) + CurseForge Core API;
   luôn chạy Sentinel **ngay sau khi tải** trước khi ghi vào `mods/`.
5. **Modpack**: nhập `.mrpack` (Modrinth) và CurseForge zip; ghi đè `overrides/`.
6. **Lõi native (tuỳ chọn)**: viết lại `scanner.js` và `downloads.js` bằng C++/Qt
   để khớp họ PrismLauncher — interface đã cố tình giữ ở mức "hàm thuần" để port dễ.
7. **Delta update**: so manifest SHA-1 để chỉ tải tệp thay đổi khi Minecraft cập nhật.
8. **Chữ ký cộng đồng**: endpoint nhận đóng góp quy tắc đã được duyệt, ký bằng ed25519,
   client xác minh chữ ký trước khi nạp — tránh chính kênh cập nhật bị lợi dụng.

## 9. Ghi nhận

Mô hình instance, cách tổ chức `libraries/assets/versions`, cách dựng classpath
và chọn Java theo phiên bản trong tài liệu này theo **PrismLauncher** (GPL-3.0),
kế thừa từ MultiMC. Zeko Launcher cũng phát hành GPL-3.0-or-later.
Minecraft là thương hiệu của Mojang/Microsoft; dự án không được Mojang/Microsoft bảo trợ.
