/**
 * Zeko Launcher — chế độ server dài hạn (máy cá nhân / LAN / VPS).
 * Bản serverless dùng `api/index.js` (Vercel) với cùng lõi `server/app.js`.
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HOST, PORT, APP_NAME, APP_VERSION, APP_CODENAME, Paths } from './lib/paths.js';
import app from './app.js';

function banner() {
  const W = 62;
  const row = (txt) => `║ ${txt}`.padEnd(W, ' ') + '║';
  const top = '╔' + '═'.repeat(W) + '╗';
  const bot = '╚' + '═'.repeat(W) + '╝';
  const ui = `http://localhost:${PORT}`;
  return [
    top,
    row(`  ⚡ ${APP_NAME} v${APP_VERSION} — "${APP_CODENAME}"`),
    row(''),
    row(`  ➜ Giao diện : ${ui}`),
    row(`  ➜ API       : ${ui}/api/health`),
    row(`  ➜ Dữ liệu   : ${Paths.root}`),
    bot,
  ].join('\n');
}

// Chỉ lắng nghe khi được chạy trực tiếp (không khi bị import bởi Vercel)
const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  app.listen(PORT, HOST, () => {
    console.log(banner());
  });
}

export default app;
