/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║  ZEK0 LAUNCHER — Aurora 1.0                                   ║
 * ║  Launcher Minecraft: giao diện đẹp · Turbo FPS · Sentinel     ║
 * ╚═══════════════════════════════════════════════════════════════╝
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import { ClientDir, RepoRoot, Paths, HOST, PORT, APP_NAME, APP_VERSION, APP_CODENAME, ensureDirs } from './lib/paths.js';
import { events as launchEvents } from './lib/launcher.js';
import { events as downloadEvents } from './lib/downloads.js';
import { systemSnapshot } from './lib/metrics.js';
import { getCatalog } from './lib/catalog.js';
import apiRouter from './routes/api.js';

ensureDirs();

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Cho phép xem trước qua proxy sandbox / host tuỳ ý
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
app.use(express.static(ClientDir, { index: 'index.html', maxAge: '0' }));

// ── Server-Sent Events: log game, tiến độ tải, số liệu máy ───────────
const clients = new Set();
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: ${JSON.stringify({ app: APP_NAME, version: APP_VERSION, at: Date.now() })}\n\n`);
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
}, 2000);

app.get('/api/health', async (req, res) => {
  res.json({
    ok: true,
    app: APP_NAME,
    version: APP_VERSION,
    codename: APP_CODENAME,
    root: Paths.root,
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
  // Lỗi nghiệp vụ (thiếu Java, Sentinel chặn…) là luồng bình thường → ghi một dòng ngắn.
  if (err.code === 'ZEKO_BLOCKED_BY_SENTINEL' || err.code === 'ZEKO_NOT_READY') {
    console.warn(`[zeko] ${err.code}: ${err.message}`);
    return res.status(409).json({ ok: false, error: err.message, code: err.code, details: err.details || null, scan: err.scan || null });
  }
  if (status >= 500) console.error('[zeko]', err);
  else console.warn(`[zeko] ${status} ${err.message}`);
  res.status(status).json({ ok: false, error: err.message || 'Lỗi máy chủ', code: err.code || null, details: err.details || null, scan: err.scan || null });
});

// Khởi động catalog ở nền để lần mở UI đầu tiên nhanh
getCatalog().catch(() => {});

function banner() {
  const W = 62;
  const row = (txt) => `║ ${txt}`.padEnd(W, ' ') + '║';
  const top = '╔' + '═'.repeat(W) + '╗';
  const bot = '╚' + '═'.repeat(W) + '╝';
  const ui = `http://localhost:${PORT}`;
  const lines = [
    top,
    row(`  ⚡ ${APP_NAME} v${APP_VERSION} — "${APP_CODENAME}"`),
    row(''),
    row(`  ➜ Giao diện : ${ui}`),
    row(`  ➜ API       : ${ui}/api/health`),
    row(`  ➜ Dữ liệu   : ${Paths.root}`),
    bot,
  ];
  return lines.join('\n');
}

app.listen(PORT, HOST, () => {
  console.log(banner());
});
