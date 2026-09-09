# ⚡ Zeko Turbo — tối ưu FPS cho máy yếu

Tài liệu này giải thích **tại sao** từng tham số tồn tại, để bạn có thể tự tinh chỉnh
thay vì chỉ bấm "Áp dụng".

---

## 1. Triết lý

Máy yếu không tụt FPS vì một nguyên nhân, mà vì **bốn nút thắt cổ chai** chồng nhau:

| Nút thắt | Biểu hiện | Zeko xử lý bằng |
|---|---|---|
| **GC / heap** | Khựng 0,5–2 s mỗi vài chục giây | Bộ tham số G1/ZGC + `-Xms=-Xmx` hợp lý |
| **Kết xuất (render)** | FPS thấp đều, tệ hơn khi quay camera | Giảm render distance, tắt mây/bóng, mod Sodium |
| **Logic tick** | Đứng hình khi nhiều mob, farm, redstone | Giảm simulation distance, mod Lithium/C2ME |
| **RAM vật lý & đĩa** | Tràn bộ nhớ, load chunk lâu | FerriteCore, RAM không vượt 50% RAM máy, đo tốc độ đĩa |

Vì vậy Zeko Turbo không chỉ chỉnh một chỗ: mỗi hồ sơ là **bộ ba** gồm
(1) JVM args, (2) `options.txt` ghi sẵn, (3) danh sách mod đề xuất — kèm
(4) tinh chỉnh ở tầng hệ điều hành.

---

## 2. Bốn hồ sơ

| | 🥔 Máy cực yếu | ⚡ Máy yếu | 🎯 Cân bằng | 🚀 Zeko Ultra |
|---|---|---|---|---|
| RAM máy | 2–4 GB | 4–8 GB | 8–16 GB | 16 GB+ |
| RAM game | 1024–2048 MB | 2048–4096 MB | 4096–8192 MB | 6144–16384 MB |
| GC | `SerialGC` | `G1GC` | `G1GC` | `ZGC` generational |
| Render distance | 4 | 8 | 12 | 20 |
| Simulation distance | 4 | 6 | 10 | 16 |
| Đồ hoạ | Fast | Fast | Fancy | Fancy |
| Particles | Minimal | Decreased | All | All |
| Smooth lighting | Tắt | Mức 1 | Mức 2 | Mức 3 |
| Mipmap | 0 | 2 | 4 | 4 |
| Biome blend | 0 | 3 | 5 | 7 |
| Max FPS | 60 | 120 | 144 | 260 |
| VSync | tắt | tắt | tắt | tắt |
| Mục tiêu | vào được game, FPS ổn | FPS cao mà vẫn đẹp vừa | mặc định đa số máy | FPS tối đa + shader |

### Vì sao hồ sơ yếu nhất lại dùng SerialGC?
`UseSerialGC` nghe có vẻ "cổ", nhưng với heap ≤ 2 GB trên CPU 2 nhân, GC đơn luồng
**không tranh giành nhân CPU** với luồng render của game. G1 cần nhiều luồng nền và
metaspace lớn hơn; trên máy cực yếu chi phí đó đắt hơn lợi ích. Đây là đánh đổi có chủ đích.

### Vì sao Ultra dùng ZGC?
Từ Java 21, ZGC generational có pause **dưới 1 ms** bất kể heap lớn.
Với 8–16 GB heap, G1 sẽ có lúc pause hàng chục ms → khựng hình.
ZGC đổi lại bằng throughput thấp hơn một chút, nhưng máy ở phân khúc này dư CPU.

### Vì sao tắt VSync ở mọi hồ sơ?
VSync của Minecraft khoá FPS vào chu kỳ quét dọc và **thêm một hàng đợi khung hình**,
làm tăng độ trễ đầu vào và gây tụt FPS nặng khi một khung vượt quá budget.
Tốt hơn: để FPS cap cao hơn refresh rate ~10%, hoặc bật G-Sync/FreeSync ở tầng driver.

---

## 3. Giải thích từng tham số JVM

Nhóm **kích thước heap**:

```
-Xms<N>M                  heap ban đầu = heap tối đa → JVM không phải co giãn heap
                          giữa chừng (mỗi lần co giãn là một lần khựng)
-Xmx<N>M                  trần heap. QUÁ LỚN LÀ HẠI: GC phải quét nhiều hơn và
                          lấy mất RAM của hệ điều hành → swap → giật còn nặng hơn
-XX:+AlwaysPreTouch       chạm vào mọi trang heap lúc khởi động, đổi 1–2 s khởi động
                          lấy việc không bị page-fault giữa trận
```

Nhóm **G1** (hồ sơ Máy yếu / Cân bằng — chính là bộ Aikar's flags đã được cộng đồng kiểm chứng):

```
-XX:MaxGCPauseMillis=130  mục tiêu pause; đặt quá thấp sẽ khiến GC chạy liên tục
-XX:G1NewSizePercent=30   vùng young lớn hơn mặc định → ít lần minor GC hơn
-XX:G1MaxNewSizePercent=40
-XX:G1HeapRegionSize=8M   kích thước region; 8M hợp heap 2–4 GB
-XX:G1ReservePercent=20   dành 20% heap dự phòng cho đối tượng sống sót đột biến
                          (rất hay xảy ra khi load chunk) → tránh "to-space exhausted"
-XX:G1HeapWastePercent=5  cho phép bỏ qua vùng rác ít, giảm thời gian mixed GC
-XX:G1MixedGCCountTarget=4
-XX:InitiatingHeapOccupancyPercent=15   bắt đầu concurrent mark sớm (15% thay vì 45%)
-XX:MaxTenuringThreshold=1              đối tượng trẻ lên thẳng old gen nhanh hơn,
                                        giảm công việc copy giữa các survivor space
-XX:SurvivorRatio=32
```

Nhóm **đồ hoạ / nền tảng**:

```
-Dsun.java2d.d3d=false    tắt pipeline Direct3D của Java2D (Windows) — giảm xung đột driver
-Dsun.java2d.opengl=false tương tự cho macOS/Linux
-Dsun.java2d.noddraw=true tắt DirectDraw, tránh hiện tượng tearing/xám màn hình
-XX:+DisableExplicitGC    vô hiệu System.gc() — thủ phạm gây khựng 1–2 giây kinh điển
                          (thường do driver LWJGL hoặc mod gọi)
-XX:-UseAdaptiveSizePolicy  không cho JVM tự đổi kích thước young gen theo thống kê,
                            giữ hành vi ổn định và dự đoán được
-XX:+PerfDisableSharedMem  tắt hsperfdata → tránh ghi đĩa mỗi lần JVM chạy
                           (lưu ý: jps/jstat sẽ không thấy tiến trình này)
```

Nhóm **Ultra**:

```
-XX:+UseZGC -XX:+ZGenerational
-XX:+UseLargePages -XX:LargePageSizeInBytes=2m -XX:+UseTransparentHugePages
                          giảm TLB miss đáng kể với heap lớn
```

---

## 4. `options.txt` — thứ tăng FPS nhiều nhất mà ít ai chỉnh

Khi bạn áp dụng một hồ sơ, `launcher.js#applyGameSettings()` **ghi thẳng** vào
`<instance>/options.txt` nên không cần mò từng mục trong menu:

| Key | Giá trị ở hồ sơ yếu | Vì sao |
|---|---|---|
| `renderDistance` | 4–8 | Mỗi +1 chunk là ~+7% khối lượng kết xuất. Đây là **nút vặn số 1**. |
| `simulationDistance` | 4–6 | Tách khỏi render: chunk xa vẫn *vẽ* nhưng không *tick* → giảm tải CPU |
| `graphicsMode` | 0 (Fast) | Tắt trong suốt lá cây, tắt hiệu ứng nước đẹp |
| `particles` | 2 (Minimal) | Hàng nghìn particle mỗi giây khi đánh nhau/farm |
| `renderClouds` | false | Mây là một lớp kết xuất riêng, gần như vô dụng về gameplay |
| `entityShadows` | false | Mỗi entity thêm một quad bóng đổ |
| `ao` / smooth lighting | 0 | Ánh sáng mượt buộc tính lại lightmap per-vertex |
| `mipmapLevels` | 0–2 | Mipmap tốn VRAM; máy yếu thường thiếu VRAM |
| `biomeBlendRadius` | 0–3 | Trộn màu sinh thái giữa chunk — rất đắt khi bay nhanh |
| `entityDistanceScaling` | 0.5–0.75 | Không *kết xuất* entity ở xa → giảm cả draw call lẫn logic |
| `enableVsync` | false | Xem mục 2 |
| `maxFps` | 60–260 | Cap FPS để GPU không đốt 100% cho khung hình vô ích |
| `bobView` | false (tuỳ chọn) | Tắt rung camera giúp giảm cảm giác giật |

`maxEntityCramming` (hồ sơ Máy cực yếu) đặt ở mức 12: giới hạn số entity chen chúc
trong một khối — nguồn tụt FPS kinh điển ở mob farm và village.

---

## 5. Mod: thứ tự cài theo mức tăng FPS

Cài **theo thứ tự này** và kiểm tra FPS sau mỗi bước, để biết mod nào thực sự giúp máy bạn:

1. **Sodium** — viết lại engine kết xuất. Thường **2–4 lần** FPS. Bắt buộc.
2. **FerriteCore** — giảm 30–40% RAM tiêu thụ. Bắt buộc cho máy yếu.
3. **Lithium** — tối ưu logic (AI mob, tick chunk, redstone), không đổi gameplay.
4. **Krypton** — tối ưu Netty; rõ nhất khi chơi server đông người.
5. **Memory Leak Fix** — vá rò rỉ bộ nhớ khiến RAM phình theo thời gian chơi.
6. **ModernFix** — giảm thời gian khởi động và tối ưu metaspace/registry.
7. **Starlight** — viết lại engine ánh sáng (hết khựng khi khám phá hang).
   *Lưu ý: từ 1.20 trở đi vanilla đã cải thiện nhiều, lợi ích giảm.*
8. **C2ME** — sinh chunk đa luồng. Cần nếu bạn bay nhanh / render distance cao.
9. **Dynamic FPS** — tự giảm FPS khi game chạy nền (vừa chơi vừa xem video).
10. **Entity Collision FPS Fix** — cứu bạn ở mob farm / village hàng trăm con.
11. **Indium + Iris** — chỉ khi bạn muốn shader. Iris chạy trên Sodium;
    chọn profile shader **Low/Potato** (xem bảng shader trong tab Turbo).
12. **spark** — không tăng FPS, nhưng `/spark profiler` cho biết **chính xác**
    thứ gì đang ngốn. Cài nó khi mọi cách khác không đủ.

Mod cần tránh trên máy yếu: minimap hiển thị entity xa, shader nặng,
mod thêm nhiều particle, "FPS booster" không rõ nguồn (đây chính là thứ Sentinel cảnh báo).

---

## 6. Điểm chuẩn ZPI (Zeko Performance Index)

`POST /api/system/benchmark` chạy bốn phép đo trong **dưới 400 ms**:

| Phép đo | Mô phỏng điều gì | Trọng số tối đa |
|---|---|---|
| Sàng nguyên tố tới 400 000 | Sức mạnh đơn nhân + cache CPU (Minecraft chủ yếu đơn luồng) | 400 |
| Ghi 8 MB ra đĩa | Tốc độ load chunk/asset, phát hiện HDD so với SSD | 250 |
| RAM vật lý | Trần heap có thể cấp mà không gây swap | 250 |
| Vòng cấp phát 60 000 mảng | Áp lực GC — thứ Minecraft tạo ra liên tục | 100 |

Tổng 0–1000, chia thành 5 hạng và **tự đề xuất hồ sơ**:

```
<250  hoặc RAM ≤4GB  hoặc ≤2 nhân   → potato
<430  hoặc RAM ≤8GB                 → lowend
<700                                → balanced
còn lại                             → ultra
```

Đây là lý do tab Turbo *biết* máy bạn thuộc loại nào thay vì để bạn tự đoán.

---

## 7. Auto-Tune

`metrics.js#autoTuneAdvice()` chạy mỗi 2 giây qua SSE và cảnh báo khi:

- RAM hệ thống > 88% → nên giảm RAM cấp cho game
- CPU > 90% → tắt ứng dụng nền trước khi vào game
- load trung bình > 1,5 × số nhân → máy đang bận

UI hiện các cảnh báo này trong tab Turbo → "Xem lời khuyên".

---

## 8. Tinh chỉnh ngoài game — thường tăng nhiều FPS hơn mọi mod

**Windows**
1. Settings → Gaming → **Game Mode**: BẬT.
2. Power plan → **High Performance** (hoặc Ultimate Performance).
3. Settings → Accessibility → Visual effects → tắt **Transparency** và **Animations**.
4. Graphics settings → thêm `javaw.exe` → chọn **High performance** (ép dùng GPU rời
   thay vì iGPU — lỗi rất phổ biến trên laptop).
5. Cập nhật driver GPU. Đây là bước tăng FPS nhiều nhất trên máy cũ.
6. Task Manager → Startup: tắt những gì không cần.
7. Ổ C: còn trống **tối thiểu 10 GB** — Windows bắt đầu dùng đĩa làm RAM khi gần đầy.
8. Tắt Discord/Steam overlay nếu không dùng.

**Linux**
1. `gamemode` (Feral Interactive): `gamemoderun java -jar …` — Zeko có thể thêm
   prefix này vào lệnh khởi động.
2. Kiểm tra đang chạy Wayland hay X11; Minecraft + Wayland cần LWJGL 3.3.3+.
3. `sudo cpupower frequency-set -g performance`.
4. Nếu dùng NVIDIA: đảm bảo `__GL_SYNC_TO_VBLANK=0`.

**macOS**
1. Minecraft trên Apple Silicon nên chạy **native ARM** JDK (Temurin aarch64),
   không chạy qua Rosetta — chênh lệch 30–50% FPS.
2. Đóng các app Electron khác; macOS rất nhạy với áp lực RAM.

**Phần cứng 0 đồng**
- Lau bụi quạt + tra keo tản nhiệt: laptop cũ thường mất 30–50% hiệu năng vì throttling.
- Kiểm tra throttling bằng HWiNFO: nếu nhiệt CPU chạm 95–100 °C thì **nhiệt** là thủ phạm,
  không phải mod.
- Chơi ở độ phân giải thấp hơn (1280×720) là cách tăng FPS mạnh nhất trên iGPU.

---

## 9. Tự đo, đừng đoán

```
F3                → HUD debug: FPS, chunk updates, thời gian render/tick
F3 + C (giữ)      → buộc crash để lấy report (khi nghi ngờ mod gây lỗi)
/spark profiler start   → đo 30 s
/spark profiler stop    → cho ra link báo cáo: hàm nào ngốn nhiều nhất
```

Quy trình Zeko khuyến nghị:
**điểm chuẩn ZPI → áp hồ sơ đề xuất → cài Sodium + FerriteCore → đo F3 →
thêm mod theo thứ tự mục 5 → nếu vẫn giật thì chạy spark profiler.**
