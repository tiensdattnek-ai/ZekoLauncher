/**
 * Vercel serverless entry — bọc nguyên lõi Express của Zeko Launcher.
 * ------------------------------------------------------------------
 * Toàn bộ logic nằm ở `server/app.js`; file này chỉ export app để
 * @vercel/node biến nó thành function. Nhờ vậy chế độ serverless và
 * chế độ chạy máy cá nhân (`node server/index.js`) dùng chung một lõi.
 *
 * Khác biệt khi lên Vercel (xem README → "Deploy"):
 *   - Dữ liệu (instance, vùng cách ly) nằm ở /tmp → KHÔNG bền vững giữa
 *     các lần cold-start. Bản Vercel là bản demo/trưng bày.
 *   - Không có Java nên không chạy được game thật; Sentinel, Turbo,
 *     điểm chuẩn máy, catalog trực tuyến hoạt động bình thường.
 *   - Kết nối SSE sống tối đa bằng maxDuration (60 s Hobby), trình
 *     duyệt tự nối lại nên kênh số liệu vẫn mượt.
 */
import app from '../server/app.js';

export default app;
