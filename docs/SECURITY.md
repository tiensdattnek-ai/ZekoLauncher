# 🔒 Zeko Sentinel — Mô hình bảo mật & giới hạn thật sự

> Đọc kỹ tài liệu này. Nó nói rõ Zeko **làm được gì** và **không làm được gì**,
> để bạn không bao giờ hiểu nhầm mức độ bảo vệ mà mình đang có.

---

## 1. Sentinel là gì

Zeko Sentinel là **bộ kiểm tra an toàn tệp game**, gồm ba lớp chạy theo thứ tự từ rẻ đến đắt:

| Lớp | Tên | Làm gì | Chi phí |
|----|-----|--------|---------|
| 1 | **VERIFY** | So SHA-1 của `client.jar` và từng thư viện với manifest chính thức của Mojang (`version_json` → `downloads` + `libraries[].downloads.artifact.sha1`). Sai một byte là báo ngay. | Rất rẻ |
| 2 | **HEURISTIC** | Phân tích cấu trúc JAR/ZIP: entry thực thi, magic bytes `MZ`/`ELF`, entropy Shannon, JAR thiếu `fabric.mod.json`/`mods.toml`, JAR lồng nhau, class bị làm rối tên, URL ngoài hệ sinh thái Minecraft, chuỗi Base64 lớn. | Trung bình |
| 3 | **SIGNATURE** | Đối chiếu 15 chữ ký của các họ mã độc Minecraft đã được ghi nhận **công khai**: đọc `lastlogin`/`launcher_accounts.json`, đánh cắp token Discord (`leveldb`, webhook), PowerShell `-EncodedCommand`, `.bat/.ps1/.vbs/.exe` trong resource pack, autorun, ghi đè runtime Java… | Rẻ |

Kết quả là **điểm rủi ro 0–100** kèm danh sách lý do cụ thể (tên quy tắc, số điểm, đoạn bằng chứng),
không phải kết luận nhị phân "sạch/nhiễm".

Ngưỡng mặc định (sửa được trong `server/data/scanner-rules.json`):

```
0–24   clean     không có gì đáng nói
25–44  flag      đáng chú ý, thường là báo động giả
45–69  review    cần người dùng tự xem xét
70+    threat    rủi ro cao → tự động cách ly + chặn khởi động
```

---

## 2. Sentinel KHÔNG phải phần mềm diệt virus

Đây là điểm quan trọng nhất, xin đừng bỏ qua:

- Sentinel **chỉ quét thư mục game** (instance, mods, resourcepacks, shaderpacks, versions, libraries).
  Nó **không** quét toàn bộ ổ đĩa, **không** có real-time protection, **không** chặn tiến trình,
  **không** có driver kernel, **không** cập nhật chữ ký từ đám mây.
- Bộ chữ ký là **danh sách tĩnh** đi kèm mã nguồn (`server/data/scanner-rules.json`),
  dựa trên các họ mã độc Minecraft đã công bố công khai. Mã độc mới chưa có trong danh sách
  **sẽ không bị bắt bởi lớp SIGNATURE** — chỉ có thể bị bắt bởi lớp HEURISTIC nếu hành vi lộ liễu.
- Sentinel phân tích tệp **tĩnh**. Nó không chạy mã trong JAR, không mô phỏng, không sandbox.
  Một JAR được obfuscate kỹ và không có hành vi lộ liễu vẫn có thể lọt qua.
- Nó **không phát hiện** malware nhắm vào hệ điều hành nói chung (ransomware, keylogger ngoài game,
  trojan ngân hàng…). Hãy để **Windows Defender** (hoặc AV có uy tín) làm việc đó và đừng tắt nó.

**Cách dùng đúng:** Sentinel là lớp kiểm tra *chuyên biệt cho hệ sinh thái Minecraft* —
nơi mà AV tổng quát thường bỏ qua vì `.jar` mod trông giống phần mềm hợp lệ.
Nó bổ sung cho AV, không thay thế AV.

---

## 3. Sentinel không bao giờ xoá tệp của bạn

Nguyên tắc thiết kế cứng:

1. Tệp bị coi là `threat` được **di chuyển** vào `<ZekoRoot>/quarantine/<batch>/files/<đường-dẫn-gốc>`.
2. Mỗi lô có `report.json` ghi lại đường dẫn gốc, điểm rủi ro và lý do.
3. Giao diện có nút **Khôi phục 1-chạm** — đưa tệp về đúng vị trí cũ.
   Nếu vị trí cũ đã có tệp khác, Zeko bỏ qua và báo xung đột thay vì ghi đè.
4. Xoá vĩnh viễn là hành động **tách biệt, có xác nhận hai bước** (`purgeBatch`).

Điều này chấp nhận rủi ro "để sót mã độc" để đổi lấy rủi ro thấp hơn nhiều là
"xoá nhầm mod đắt giá / thế giới của người chơi".

---

## 4. Tải tệp: kiểm tra SHA-1 và huỷ nếu sai

`server/lib/downloads.js` băm SHA-1 **trong lúc ghi** (stream, không nạp cả tệp vào RAM).
Nếu kết quả khác chữ ký Mojang công bố, tệp `.part` bị xoá và lượt tải bị huỷ:

```js
if (opts.sha1 && actual !== opts.sha1) {
  await fs.rm(tmp, { force: true });
  throw new Error('SHA-1 không khớp — tệp có thể đã bị can thiệp, đã huỷ tải.');
}
```

Tệp chỉ được `rename` sang tên thật sau khi đã xác minh → không bao giờ có tệp hỏng
nằm trong thư viện dùng chung.

---

## 5. Kiểm tra toàn vẹn (integrity baseline)

Với mod và resource pack — thứ **không** có SHA-1 chính thức từ Mojang — Sentinel cung cấp cơ chế
"ảnh gốc":

```
POST /api/security/verify  { instanceId, mode: "build" }   → chụp SHA-1 toàn bộ instance
POST /api/security/verify  { instanceId, mode: "check" }   → so lại, liệt kê tệp đã đổi
```

Quy trình khuyến nghị:

1. Cài mod từ Modrinth/CurseForge.
2. Chơi thử, xác nhận mọi thứ ổn.
3. Bấm **Chụp ảnh gốc** — lúc này instance được coi là "đã biết sạch".
4. Về sau, mỗi lần **Kiểm tra lại**, Zeko chỉ ra chính xác tệp nào bị sửa/thêm/bớt.
   Một mod tự cập nhật nội dung của nó giữa các phiên chơi là dấu hiệu rất đáng ngờ.

---

## 6. Chặn khởi động

Khi `security.blockOnThreat = true` (mặc định), `launcher.js` quét instance **trước** khi `spawn`
tiến trình game. Nếu có `threat`, lệnh khởi động bị huỷ với mã lỗi `ZEKO_BLOCKED_BY_SENTINEL`
và giao diện hiện danh sách tệp cùng lý do. Người dùng có thể:

- Vào Sentinel → Khôi phục (nếu tin rằng đó là báo động giả), hoặc
- Tắt "Chặn khởi động" trong Cài đặt → Bảo mật (chỉ cảnh báo).

Chi phí: thêm khoảng **1–3 giây** cho instance cỡ vài trăm MB.

---

## 7. Báo động giả — cách xử lý

Sentinel thiên về *bắt nhiều* hơn là *bắt đúng tuyệt đối*. Những trường hợp dễ bị nhầm:

| Tình huống hợp lệ | Vì sao bị đánh dấu | Cách xử lý |
|---|---|---|
| Mod tự viết, chưa có `fabric.mod.json` | `ZEKO-HEUR-NOMETA` | Thêm metadata mod đúng chuẩn |
| Mod dùng `URLClassLoader` để tải tài nguyên | `ZEKO-SIG-0009` | Kiểm tra lại, rồi khôi phục từ vùng cách ly |
| Datapack có `/execute ... run ...` phức tạp | `ZEKO-SIG-0001` | Xem lại function file, khôi phục nếu bạn tự viết |
| JAR có kèm binary native (`liblwjgl`, `.so`, `.dll`) | `ZEKO-HEUR-ELF` | Bình thường với mod cần native — khôi phục |
| Config trỏ tới server riêng bằng IP | `ZEKO-SIG-0012` | Bình thường nếu đó là server của bạn |

Điểm số được cộng dồn có trọng số, nên **một** phát hiện nhỏ thường không vượt ngưỡng 70.
Chỉ khi nhiều dấu hiệu trùng nhau thì tệp mới bị cách ly.

---

## 8. Tự bảo vệ của chính launcher

- Đường dẫn API tệp tin luôn được chuẩn hoá và kiểm tra tiền tố
  (`if (!target.startsWith(dir)) throw`) → không có path traversal ra ngoài instance.
- API chỉ quét được tệp nằm trong `Paths.instances` hoặc `Paths.quarantine`.
- `spawn` game dùng **mảng tham số**, không bao giờ ghép chuỗi qua shell → không có command injection
  từ tên instance hay đường dẫn.
- Tên instance được slug hoá (bỏ dấu, chỉ giữ `[a-z0-9-]`) trước khi tạo thư mục.
- Ghi cấu hình theo kiểu atomic: ghi `.tmp` rồi `rename`.
- Không có telemetry mặc định (`security.telemetry = false`); không có lời gọi mạng nào
  ngoài Mojang/Modrinth khi người dùng chủ động bấm tải.

---

## 9. Tự kiểm thử Sentinel

Không cần chờ mã độc thật. Giao diện có nút **"Tạo tệp mẫu kiểm thử"**
(`POST /api/instances/:id/files/sample`) sinh ba tệp giả lập bằng `server/lib/zipwrite.js`:

| Mẫu | Nội dung | Kết quả mong đợi |
|---|---|---|
| `clean-pack` | Resource pack đúng chuẩn: `pack.mcmeta`, `pack.png`, file ngôn ngữ | `clean`, điểm ~0 |
| `trap-pack` | Pack có `install.bat` + chuỗi `powershell -enc` | `threat` (~95), bị cách ly |
| `sus-mod` | JAR không metadata, class tên rối, chứa `MZ`, chuỗi Discord webhook, IP trần | `threat` (~100), bị cách ly |

Chạy từ terminal:

```bash
node scripts/zeko-scan.js <thư-mục-instance>            # báo cáo người đọc
node scripts/zeko-scan.js <thư-mục-instance> --json     # cho script khác
node scripts/zeko-scan.js <thư-mục-instance> --quarantine
```

---

## 10. Mở rộng bộ chữ ký

Thêm quy tắc vào `server/data/scanner-rules.json`:

```json
{
  "id": "ZEKO-SIG-0016",
  "name": "Mô tả ngắn cho người dùng",
  "weight": 45,
  "severity": "high",
  "where": "binary",            // entry | text | binary | magic
  "pattern": "regex_không_phân_biệt_hoa_thường",
  "desc": "Giải thích vì sao đây là dấu hiệu xấu."
}
```

- `where: "entry"` → so với **tên** tệp/đường dẫn (rẻ nhất).
- `where: "text"` → so với nội dung tệp văn bản.
- `where: "binary"` → so với nội dung thô và nội dung các entry trong JAR.
- `where: "magic"` → so với bytes đầu tệp.

Sau khi sửa, gọi `GET /api/security/rules` để xác nhận quy tắc đã nạp.
Hãy gửi pull request nếu bạn tìm ra chữ ký mới — cộng đồng càng đông, Sentinel càng tốt.

---

## 11. Nếu bạn bị nhiễm thật

1. **Ngắt mạng** máy tính.
2. Đổi mật khẩu email + Microsoft/Mojang + Discord **từ một thiết bị khác**.
   Mã độc đánh cắp session Minecraft thường lấy cả token Discord và cookie trình duyệt.
3. Chạy quét đầy đủ bằng Windows Defender / Malwarebytes — Sentinel không đủ cho việc này.
4. Trong Zeko: Sentinel → Quét toàn bộ → xem vùng cách ly → **Xoá hẳn** lô đã xác nhận độc.
5. Dùng **Kiểm tra toàn vẹn** để chắc chắn `versions/` và `libraries/` không còn tệp bị sửa;
   nếu nghi ngờ, xoá thư mục đó và để Zeko tải lại (có kiểm tra SHA-1).
6. Chỉ cài mod từ Modrinth hoặc CurseForge, xem số lượt tải và ngày cập nhật trước khi bấm tải.
