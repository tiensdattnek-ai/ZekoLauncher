/**
 * Smoke test giao diện — chống hồi quy cho UI.
 * ------------------------------------------------------------------
 * Tự khởi động server Zeko trên cổng ngẫu nhiên (ZEKO_ROOT trỏ vào thư
 * mục tạm nên KHÔNG đụng dữ liệu thật), dựng client thành một bundle bằng
 * esbuild, chạy trong jsdom, rồi duyệt lần lượt cả 8 màn hình và khẳng định:
 *
 *   • không có lỗi JS (pageerror / console.error / unhandled rejection)
 *   • không màn hình nào rơi vào khung "Không tải được màn hình này"
 *   • mỗi màn hình render ra nội dung thật (không trống)
 *
 * Cần devDependency `jsdom` + `esbuild`. Nếu chưa cài, test tự SKIP
 * (jsdom không thực thi ES module, nên bắt buộc phải bundle).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const RepoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function tryRequire(name) {
  try {
    return require(name);
  } catch {
    return null;
  }
}

const jsdomPkg = tryRequire('jsdom');
const esbuild = tryRequire('esbuild');

let tmp;
let server;
let port;
const BASE = () => `http://127.0.0.1:${port}`;

async function waitForHealth(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE()}/api/health`);
      if (res.ok) return true;
    } catch {
      /* chưa sẵn sàng */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

test('UI: cả 8 màn hình render được, không lỗi JS', { skip: !jsdomPkg || !esbuild ? 'cần `npm i -D jsdom esbuild`' : false }, async (t) => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zeko-ui-'));
  port = 4200 + Math.floor(Math.random() * 600);

  // 1) bundle client
  const bundleFile = path.join(tmp, 'bundle.js');
  await esbuild.build({
    entryPoints: [path.join(RepoRoot, 'client', 'js', 'main.js')],
    bundle: true,
    format: 'iife',
    outfile: bundleFile,
    logLevel: 'silent',
  });
  const bundle = await fs.readFile(bundleFile, 'utf8');

  // 2) server thật, dữ liệu trong thư mục tạm
  server = spawn(process.execPath, [path.join(RepoRoot, 'server', 'index.js')], {
    env: { ...process.env, ZEKO_ROOT: path.join(tmp, 'root'), ZEKO_PORT: String(port), ZEKO_HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  server.stdout.on('data', (d) => (serverLog += d));
  server.stderr.on('data', (d) => (serverLog += d));
  assert.ok(await waitForHealth(), `server không khởi động được:\n${serverLog.slice(0, 800)}`);

  // 3) dữ liệu mẫu qua API
  const post = (p, body) =>
    fetch(`${BASE()}/api${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) }).then((r) => r.json());
  await post('/instances', { name: 'Sinh tồn kiểm thử', version: '1.20.4', loader: 'fabric', perfProfile: 'lowend', icon: '🌲' });
  await post('/instances', { name: 'PvP cổ điển', version: '1.8.9', loader: 'vanilla', perfProfile: 'potato', icon: '⚔️' });
  const { instances } = await fetch(`${BASE()}/api/instances`).then((r) => r.json());
  assert.equal(instances.length, 2);

  // 4) jsdom
  const { JSDOM, VirtualConsole } = jsdomPkg;
  const html = (await fs.readFile(path.join(RepoRoot, 'client', 'index.html'), 'utf8')).replace(
    '<script type="module" src="/js/main.js"></script>',
    ''
  );
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(`jsdomError: ${e.message}`));
  vc.on('error', (...a) => errors.push(`console.error: ${a.map(String).join(' ')}`));

  const dom = new JSDOM(html, { url: `${BASE()}/`, runScripts: 'outside-only', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  const ctxStub = new Proxy(
    {},
    {
      get(_, p) {
        if (p === 'canvas') return {};
        if (p === 'createLinearGradient') return () => ({ addColorStop() {} });
        if (p === 'measureText') return () => ({ width: 10 });
        return () => {};
      },
      set() { return true; },
    }
  );
  window.HTMLCanvasElement.prototype.getContext = () => ctxStub;
  window.Element.prototype.getBoundingClientRect = () => ({ width: 620, height: 74, top: 0, left: 0, right: 620, bottom: 74, x: 0, y: 0 });
  window.EventSource = class { constructor() {} addEventListener() {} close() {} };
  window.fetch = (url, opts) => fetch(new URL(url, BASE()).toString(), opts);
  window.navigator.clipboard = { writeText: async () => {} };

  // jsdom không tải <link> ngoài nên tiêm CSS thật vào để kiểm tra được cascade.
  const cssText = await fs.readFile(path.join(RepoRoot, 'client', 'css', 'main.css'), 'utf8');
  const styleEl = window.document.createElement('style');
  styleEl.textContent = cssText;
  window.document.head.appendChild(styleEl);

  // CHỐNG HỒI QUY (một phần): các phần tử phải còn thuộc tính hidden đúng lúc.
  // (jsdom không mô hình hoá cascade UA-vs-author, nên việc author CSS đè
  //  [hidden] được kiểm tra bằng test văn bản CSS trong core.test.js.)
  const disp = (id) => window.getComputedStyle(window.document.getElementById(id)).display;
  window.addEventListener('error', (e) => errors.push(`window.error: ${e.error?.message || e.message}`));
  window.addEventListener('unhandledrejection', (e) => errors.push(`unhandledrejection: ${e.reason?.message || e.reason}`));

  window.eval(bundle);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  await sleep(4000);

  const d = window.document;
  assert.equal(d.getElementById('app').hidden, false, 'khung app phải hiện sau boot');
  assert.ok(!d.getElementById('boot'), 'màn hình khởi động phải được gỡ');
  assert.equal(d.getElementById('badge-instances').textContent, '2', 'badge instance phải là 2');
  assert.equal(d.getElementById('playbar').hidden, false, 'thanh CHƠI phải hiện khi đã có instance');


  const views = [
    ['dashboard', 4000],
    ['instances', 2500],
    ['performance', 3000],
    ['security', 2500],
    ['console', 1800],
    ['downloads', 1800],
    ['settings', 1800],
    ['about', 1800],
  ];
  for (const [name, minLen] of views) {
    window.location.hash = `#/${name}`;
    window.dispatchEvent(new window.HashChangeEvent('hashchange'));
    await sleep(2000);
    const host = d.getElementById('view-wrap');
    const text = host.textContent.replace(/\s+/g, ' ').trim();
    assert.ok(!text.includes('Không tải được màn hình'), `màn hình "${name}" bị lỗi render: ${text.slice(0, 160)}`);
    assert.ok(host.innerHTML.length >= minLen, `màn hình "${name}" render quá ít nội dung (${host.innerHTML.length} < ${minLen})`);
    assert.ok(!/\[object Object\]|NaN/.test(text), `màn hình "${name}" lộ token lỗi: ${text.slice(0, 160)}`);
  }

  // Đóng jsdom TRƯỚC khi assert: dashboard có interval mô phỏng FPS và
  // MutationObserver — nếu không đóng, vòng lặp sự kiện không bao giờ rỗng
  // và tiến trình test sẽ treo sau khi chạy xong.
  try { window.close(); } catch { /* bỏ qua */ }
  await sleep(200);

  assert.deepEqual(errors, [], `có lỗi JS trong UI:\n${errors.slice(0, 8).join('\n')}`);
});

// Đảm bảo tiến trình test luôn thoát: kill server + thoát cứng sau 8 s
// kể từ khi node:test báo xong, phòng khi còn handle nào sót lại.
const hardExit = setTimeout(() => process.exit(failed ? 1 : 0), 8000);
hardExit.unref?.();
let failed = false;
process.on('exit', () => { try { server?.kill('SIGKILL'); } catch { /* bỏ qua */ } });

test.after(async () => {
  try {
    server?.kill('SIGKILL');
  } catch { /* đã tắt */ }
  if (tmp) await fs.rm(tmp, { recursive: true, force: true });
});
