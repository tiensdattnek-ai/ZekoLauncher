/**
 * Zeko Launcher — Express app (tách khỏi việc lắng nghe cổng).
 * ------------------------------------------------------------------
 * Tách này cho phép chạy ở HAI chế độ từ cùng một lõi:
 *   1. Server dài hạn : `node server/index.js` (máy cá nhân, LAN, VPS)
 *   2. Serverless     : `api/index.js` export app cho Vercel
 * Mọi state dùng chung (SSE clients, scan jobs, phiên game) nằm ở đây
 * nên cả hai chế độ hành xử giống hệt nhau.
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ClientDir, RepoRoot, Paths, APP_NAME, APP_VERSION, APP_CODENAME, ensureDirs, IS_SERVERLESS } from './lib/paths.js';
import { events as launchEvents } from './lib/launcher.js';
import { events as downloadEvents } from './lib/downloads.js';
import { systemSnapshot } from './lib/metrics.js';
import { getCatalog } from './lib/catalog.js';
import apiRouter from './routes/api.js';

ensureDirs();

export const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Cho phép nhúng / gọi từ preview host, proxy, hoặc domain Vercel tuỳ ý
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use('/api', apiRouter);
app.use('/docs', express.static(path.join(RepoRoot, 'docs'), { maxAge: '0' }));
app.get('/README.md', (req, res) => res.sendFile(path.join(RepoRoot, 'README.md')));
app.use(express.static(ClientDir, { index: 'index.html', maxAge: IS_SERVERLESS ? '1h' : '0' }));

/* ── Server-Sent Events: log game, tiến độ tải, số liệu máy ─────────
 * Trên Vercel, kết nối SSE sống tối đa bằng maxDuration của function
 * (60 s ở gói Hobby) — EventSource của trình duyệt tự nối lại, nên
 * kênh số liệu vẫn mượt; chỉ mất vài giây khi function recycle.   */
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ app: APP_NAME, version: APP_VERSION, at: Date.now(), serverless: IS_SERVERLESS })}\n\n`);
  clients.add(res);
  req.on('close', () => clients.delete(res));
});

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

launchEvents.on('log', (d) => broadcast('log', d));
launchEvents.on('exit', (d) => broadcast('exit', d));
downloadEvents.on('progress', (d) => broadcast('download', d));
downloadEvents.on('done', (d) => broadcast('download-done', d));
downloadEvents.on('error', (d) => broadcast('download-error', d));

setInterval(() => {
  if (!clients.size) return;
  broadcast('metrics', systemSnapshot());
}, 2000).unref?.();

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    codename: APP_CODENAME,
    root: Paths.root,
    serverless: IS_SERVERLESS,
    node: process.version,
    platform: process.platform,
    uptimeSeconds: Math.round(process.uptime()),
    streamClients: clients.size,
  });
});

// SPA fallback
app.get(/^\/(?!api\/).*/, async (req, res, next) => {
  try {
    const file = path.join(ClientDir, 'index.html');
    await fs.access(file);
    res.sendFile(file);
  } catch {
    next();
  }
});

app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (err.code === 'ZEKO_BLOCKED_BY_SENTINEL' || err.code === 'ZEKO_NOT_READY') {
    console.warn(`[zeko] ${err.code}: ${err.message}`);
    return res.status(409).json({ ok: false, error: err.message, code: err.code, details: err.details || null, scan: err.scan || null });
  }
  if (status >= 500) console.error('[zeko]', err);
  else console.warn(`[zeko] ${status} ${err.message}`);
  res.status(status).json({ ok: false, error: err.message || 'Lỗi máy chủ', code: err.code || null, details: err.details || null, scan: err.scan || null });
});

// Làm ấm danh mục phiên bản ngay khi cold-start để lần mở UI đầu nhanh
getCatalog().catch(() => {});

export default app;
