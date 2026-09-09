/**
 * Zeko Sentinel — bộ quét an toàn tệp game
 * =====================================================================
 * Ba lớp bảo vệ:
 *   1. VERIFY  : so SHA-1/SHA-256 của tệp vanilla với manifest chính thức
 *                của Mojang → phát hiện client.jar bị sửa/chèn mã.
 *   2. HEURISTIC: phân tích cấu trúc JAR/ZIP (entry thực thi, magic bytes,
 *                entropy, thiếu metadata mod, URL lạ, obfuscation).
 *   3. SIGNATURE: đối chiếu chuỗi đặc trưng của các họ mã độc Minecraft
 *                đã được ghi nhận công khai (rat, stealer, trap pack…).
 *
 * Kết quả là ĐIỂM rủi ro 0–100 + lý do cụ thể, không phải kết luận tuyệt đối.
 * Zeko KHÔNG XOÁ gì cả: tệp nghi ngờ được chuyển sang vùng cách ly và
 * người dùng luôn có thể khôi phục.
 *
 * ⚠ Đây không phải phần mềm diệt virus hệ thống. Xem docs/SECURITY.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { ZipReader, entropy } from './zip.js';
import { DataDir } from './paths.js';

let rulesCache = null;
async function rules() {
  if (rulesCache) return rulesCache;
  rulesCache = JSON.parse(await fs.readFile(path.join(DataDir, 'scanner-rules.json'), 'utf8'));
  rulesCache._compiled = rulesCache.signatures.map((s) => ({ ...s, re: new RegExp(s.pattern, 'i') }));
  return rulesCache;
}

const SEVERITY_WEIGHT = { low: 1, medium: 2, high: 3, critical: 4 };

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

/**
 * @typedef {object} Finding
 * @property {string} file  Đường dẫn tương đối trong phạm vi quét
 * @property {number} score 0..100
 * @property {'clean'|'flag'|'review'|'threat'} verdict
 * @property {{id:string,name:string,severity:string,points:number,detail:string}[]} reasons
 */

export async function sha1(file) {
  const h = crypto.createHash('sha1');
  const stream = (await fs.open(file, 'r')).createReadStream();
  for await (const chunk of stream) h.update(chunk);
  return h.digest('hex');
}

async function hashOf(file, algo = 'sha1') {
  const h = crypto.createHash(algo);
  const fh = await fs.open(file, 'r');
  try {
    for await (const chunk of fh.createReadStream()) h.update(chunk);
  } finally {
    await fh.close();
  }
  return h.digest('hex');
}

function classify(score, thresholds) {
  if (score >= thresholds.quarantine) return 'threat';
  if (score >= thresholds.review) return 'review';
  if (score >= thresholds.flag) return 'flag';
  return 'clean';
}

const TEXT_EXT = new Set(['.json', '.txt', '.yml', '.yaml', '.toml', '.cfg', '.conf', '.ini', '.js', '.lua', '.sh', '.bat', '.cmd', '.ps1', '.vbs', '.mcfunction', '.mcmeta', '.properties', '.xml', '.md']);

function safeName(p) {
  return p.split(/[\\/]/).pop();
}

/** Quét một tệp đơn lẻ, trả về Finding. */
export async function scanFile(absPath, { rel = null, rules: r = null } = {}) {
  const R = r || (await rules());
  const relPath = rel ?? absPath;
  const reasons = [];
  let score = 0;
  const add = (sigId, name, severity, points, detail) => {
    reasons.push({ id: sigId, name, severity, points, detail });
    score += points;
  };

  let st;
  try {
    st = await fs.stat(absPath);
  } catch {
    return { file: relPath, score: 0, verdict: 'clean', reasons: [], size: 0, skipped: 'missing' };
  }

  if (st.size > R.maxFileBytes) {
    return { file: relPath, score: 0, verdict: 'clean', reasons: [], size: st.size, skipped: 'too-large' };
  }
  if (st.size === 0) {
    return { file: relPath, score: 0, verdict: 'clean', reasons: [], size: 0, skipped: 'empty' };
  }

  const ext = path.extname(absPath).toLowerCase();
  const base = safeName(absPath).toLowerCase();

  // ── Lớp 0: tên tệp đáng ngờ (rất rẻ, chạy trước) ──────────────────
  const sigs = R._compiled;
  for (const s of sigs) {
    if (s.where === 'entry' && s.re.test(absPath.replace(/\\/g, '/'))) {
      add(s.id, s.name, s.severity, s.weight, `Tên tệp khớp chữ ký: ${base}`);
    }
  }

  // ── Lớp 1: tệp văn bản / script ───────────────────────────────────
  if (TEXT_EXT.has(ext) || ext === '.mcfunction') {
    const buf = await fs.readFile(absPath).catch(() => null);
    if (buf) {
      const head = buf.subarray(0, Math.min(buf.length, R.maxTextPreviewBytes)).toString('utf8');
      for (const s of sigs) {
        if ((s.where === 'text' || s.where === 'binary') && s.re.test(head)) {
          add(s.id, s.name, s.severity, s.weight, `Khớp mẫu trong nội dung: ${matchSnippet(head, s.re)}`);
        }
      }
      // base64 payload dài
      const b64 = head.match(/[A-Za-z0-9+/]{400,}={0,2}/);
      if (b64 && ext !== '.png') {
        add('ZEKO-HEUR-B64', 'Chuỗi Base64 lớn bất thường', 'medium', 18, 'Có thể là payload được mã hoá để né phát hiện.');
      }
      // URL không thuộc hệ sinh thái Minecraft
      const urls = [...head.matchAll(/https?:\/\/[^\s"'<>()]+/gi)].map((m) => m[0]);
      const trusted = /(minecraft\.net|mojang\.com|microsoft\.com|modrinth\.com|curseforge\.com|fabricmc\.net|neoforged\.net|forgecdn\.net|githubusercontent\.com|github\.com|optifine\.net|iris\.shaders|jitpack\.io|maven\.)/i;
      const unknown = urls.filter((u) => !trusted.test(u));
      if (unknown.length) {
        const sev = unknown.length > 3 ? 'high' : 'medium';
        add('ZEKO-HEUR-URL', 'URL ngoài hệ sinh thái Minecraft', sev, clamp(unknown.length * 6, 6, 30), `Ví dụ: ${unknown.slice(0, 3).join(', ')}`);
      }
    }
  }

  // ── Lớp 2: magic bytes cho tệp nhị phân không phải zip ────────────
  const fd = await fs.open(absPath, 'r').catch(() => null);
  if (!fd) {
    return { file: relPath, score: clamp(score, 0, 100), verdict: classify(clamp(score, 0, 100), R.thresholds), reasons, size: st.size };
  }

  try {
    const head = Buffer.alloc(8);
    await fd.read(head, 0, 8, 0);
    const isZip = head[0] === 0x50 && head[1] === 0x4b;
    if (!isZip && (ext === '.jar' || ext === '.zip' || ext === '.mrpack')) {
      add('ZEKO-HEUR-MAGIC', 'JAR/ZIP không có chữ ký PK', 'critical', 55, `Magic bytes: ${head.subarray(0, 4).toString('hex')} — tệp bị nguỵ trang phần mở rộng.`);
    }
    if (!isZip) {
      const asText = head.toString('latin1');
      if (asText.startsWith('MZ')) add('ZEKO-HEUR-PE', 'Tệp thực thi Windows (PE)', 'critical', 70, 'Có header MZ — không phải nội dung game hợp lệ trong thư mục Minecraft.');
      if (head[0] === 0x7f && asText.slice(1, 4) === 'ELF') add('ZEKO-HEUR-ELF', 'Tệp thực thi Linux (ELF)', 'critical', 65, 'Binary ELF xuất hiện trong thư mục game.');
      // quét chuỗi nhị phân
      const sample = Buffer.alloc(Math.min(st.size, 2 * 1024 * 1024));
      await fd.read(sample, 0, sample.length, 0);
      const text = sample.toString('latin1');
      for (const s of sigs) {
        if (s.where === 'binary' && s.re.test(text)) add(s.id, s.name, s.severity, s.weight, `Tìm thấy mẫu nhị phân: ${matchSnippet(text, s.re, 48)}`);
      }
      const ent = entropy(sample.subarray(0, 262_144));
      if (ent > 7.85 && st.size > 50_000) {
        add('ZEKO-HEUR-ENTROPY', 'Entropy rất cao', 'medium', 14, `Entropy ${ent.toFixed(2)} bits/byte — dữ liệu bị nén/mã hoá dày đặc.`);
      }
    }

    // ── Lớp 3: phân tích sâu ZIP/JAR ────────────────────────────────
    if (isZip && (ext === '.jar' || ext === '.zip' || ext === '.mrpack')) {
      await fd.close();
      const findings = await inspectArchive(absPath, R);
      for (const f of findings) add(f.id, f.name, f.severity, f.points, f.detail);
      return finalise(relPath, score, reasons, st.size, R);
    }
  } finally {
    try {
      await fd.close();
    } catch {
      /* đã đóng */
    }
  }

  return finalise(relPath, score, reasons, st.size, R);
}

function finalise(relPath, score, reasons, size, R) {
  const s = clamp(Math.round(score), 0, 100);
  return {
    file: relPath,
    score: s,
    verdict: classify(s, R.thresholds),
    severityRank: reasons.length ? Math.max(...reasons.map((r) => SEVERITY_WEIGHT[r.severity] || 0)) : 0,
    reasons: reasons.sort((a, b) => b.points - a.points),
    size,
  };
}

function matchSnippet(text, re, len = 64) {
  const m = text.match(re);
  if (!m) return '';
  const start = Math.max(0, (m.index || 0) - 8);
  return text.slice(start, start + len).replace(/[^\x20-\x7e]/g, '·').trim();
}

/** Phân tích cấu trúc bên trong một JAR/ZIP. */
async function inspectArchive(file, R) {
  const out = [];
  const add = (id, name, severity, points, detail) => out.push({ id, name, severity, points, detail });
  let zip;
  try {
    zip = await ZipReader.open(file);
  } catch (err) {
    add('ZEKO-ZIP-BAD', 'JAR/ZIP hỏng hoặc bị cố ý làm sai cấu trúc', 'medium', 12, String(err?.message || err).slice(0, 160));
    return out;
  }
  try {
    const names = zip.entries.map((e) => e.name);
    const joined = names.join('\n');
    const ext = path.extname(file).toLowerCase();

    // 1) entry thực thi / script — so chữ ký "theo tên" với TỪNG entry bên trong
    const execExt = /\.(bat|cmd|ps1|vbs|vbe|js|jse|wsf|scr|exe|dll|msi|com|pif)$/i;
    for (const s of R._compiled) {
      if (s.where !== 'entry') continue;
      const hits = names.filter((n) => s.re.test(n));
      if (!hits.length) continue;
      // tệp thực thi nằm ngay GỐC của pack/jar là điều không bao giờ hợp lệ → chấm nặng hơn
      const atRoot = hits.filter((n) => !n.includes('/'));
      const boost = atRoot.length ? 12 : 0;
      add(s.id, s.name, s.severity, clamp(s.weight + hits.length * 3 + boost, s.weight, 95),
        `Bên trong có: ${hits.slice(0, 4).join(', ')}${hits.length > 4 ? ` (+${hits.length - 4} nữa)` : ''}${atRoot.length ? ` — ${atRoot.length} tệp nằm ngay gốc gói` : ''}`);
    }
    // cảnh báo bổ sung nếu gói có tệp thực thi nhưng không phải bản phân phối Java
    const execHits = names.filter((n) => execExt.test(n) && !/^(META-INF|bin|natives)\//.test(n));
    if (execHits.length && ext !== '.jar') {
      add('ZEKO-HEUR-EXEC-IN-PACK', 'Gói tài nguyên chứa tệp thực thi', 'critical', 22,
        `Resource pack / shader pack không bao giờ cần tệp chạy được. Thấy: ${execHits.slice(0, 3).join(', ')}`);
    }

    // 2) thiếu metadata mod (chỉ với .jar trong thư mục mods — người gọi đánh dấu)
    const hasMeta = R.modMetadataFiles.some((m) => names.some((n) => n === m || n.endsWith('/' + m)));
    const classCount = names.filter((n) => n.endsWith('.class')).length;
    if (ext === '.jar' && !hasMeta && classCount > 3 && !/^(optifine|OptiFine)/.test(path.basename(file))) {
      add('ZEKO-HEUR-NOMETA', 'JAR không có khai báo mod hợp lệ', 'high', 28, `Có ${classCount} class nhưng thiếu fabric.mod.json / mods.toml / mcmod.info. Mod thật luôn khai báo metadata.`);
    }

    // 3) nhúng một JAR khác (jar-in-jar là bình thường với Fabric, nhưng nhiều lớp thì đáng ngờ)
    const nested = names.filter((n) => n.endsWith('.jar') && !n.startsWith('META-INF/jars/'));
    if (nested.length > 6) add('ZEKO-HEUR-NESTED', 'Quá nhiều JAR lồng nhau', 'medium', 16, `${nested.length} tệp .jar bên trong, ví dụ ${nested.slice(0, 3).join(', ')}`);

    // 4) obfuscation: tên class ngẫu nhiên cực ngắn + số lượng lớn
    const shortClasses = names.filter((n) => /[a-z]{1,2}\/[A-Za-z0-9]{1,3}\.class$/.test(n));
    if (shortClasses.length > 40 && !hasMeta) {
      add('ZEKO-HEUR-OBFUSC', 'Tên class bị làm rối', 'high', 24, `${shortClasses.length} class có tên 1–3 ký tự ngẫu nhiên (vd: ${shortClasses.slice(0, 3).join(', ')}).`);
    }

    // 5) nội dung đáng ngờ trong class / script bên trong
    const suspects = zip.entries.filter(
      (e) => !e.dir && (e.name.endsWith('.class') || e.name.endsWith('.json') || e.name.endsWith('.mcfunction') || e.name.endsWith('.js') || e.name.endsWith('.sh') || e.name.endsWith('.bat') || e.name.endsWith('.ps1') || e.name.endsWith('.txt') || e.name.endsWith('.yml')) && e.uncompSize > 32 && e.uncompSize < 4 * 1024 * 1024
    );
    // giới hạn để quét nhanh trên máy yếu
    const budget = suspects.slice(0, 400);
    let hitCap = 0;
    for (const e of budget) {
      const content = await zip.readEntry(e, 1024 * 1024);
      if (!content) continue;
      const text = content.toString('latin1');
      for (const s of R._compiled) {
        if ((s.where === 'binary' || s.where === 'text') && s.re.test(text)) {
          add(s.id, s.name, s.severity, Math.round(s.weight * 0.8), `Trong ${e.name}: ${matchSnippet(text, s.re, 56)}`);
          hitCap++;
          break;
        }
      }
      if (hitCap > 12) break; // đủ bằng chứng rồi, dừng để tiết kiệm thời gian
    }

    // 6) entropy trung bình của các entry lớn
    const bigEntries = zip.entries.filter((e) => !e.dir && e.compSize > 100_000).slice(0, 8);
    for (const e of bigEntries) {
      const sample = await zip.sampleEntry(e, 131_072);
      const ent = entropy(sample);
      if (ent > 7.95 && e.method === 0) {
        add('ZEKO-HEUR-ENTROPY', 'Entry nén sẵn có entropy cực cao', 'medium', 12, `${e.name}: ${ent.toFixed(2)} bits/byte (method=store) — thường là payload đã được đóng gói.`);
      }
    }
  } finally {
    await zip.close();
  }
  return out;
}

/**
 * Quét đệ quy một thư mục.
 * @param {string} root
 * @param {{ignore?: string[], maxFiles?: number, onProgress?: Function, filterExt?: boolean}} opts
 */
export async function scanDirectory(root, opts = {}) {
  const R = await rules();
  const started = Date.now();
  const ignore = opts.ignore || R.ignorePaths || [];
  const maxFiles = opts.maxFiles ?? 4000;
  const results = [];
  let scanned = 0;
  let skipped = 0;
  let bytes = 0;

  const stack = [root];
  while (stack.length && scanned < maxFiles) {
    const dir = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (scanned >= maxFiles) break;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (!ignore.some((ig) => rel.startsWith(ig.replace(/\/$/, '')) || `${rel}/`.startsWith(ig))) stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (opts.filterExt !== false && !(R.scanExtensions || []).includes(ext)) {
        skipped++;
        continue;
      }
      const f = await scanFile(abs, { rel, rules: R });
      if (f.skipped) {
        skipped++;
        if (f.skipped !== 'empty') results.push(f);
        continue;
      }
      scanned++;
      bytes += f.size || 0;
      results.push(f);
      if (opts.onProgress) opts.onProgress({ scanned, current: rel });
    }
  }

  const threats = results.filter((r) => r.verdict === 'threat');
  const reviews = results.filter((r) => r.verdict === 'review');
  const flags = results.filter((r) => r.verdict === 'flag');

  return {
    root,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    counts: { scanned, skipped, total: results.length, threats: threats.length, reviews: reviews.length, flags: flags.length, clean: scanned - threats.length - reviews.length - flags.length },
    bytes,
    riskScore: computeOverall(results),
    results: results.filter((r) => r.verdict !== 'clean').sort((a, b) => b.score - a.score),
    all: results,
  };
}

function computeOverall(results) {
  if (!results.length) return 0;
  const worst = Math.max(...results.map((r) => r.score));
  const avg = results.reduce((s, r) => s + r.score, 0) / results.length;
  return clamp(Math.round(worst * 0.7 + avg * 0.3), 0, 100);
}

/**
 * VERIFY — đối chiếu SHA-1 với manifest chính thức của Mojang.
 * @param {string} dir  Thư mục chứa versions/libraries/assets
 * @param {{sha1?: string}[]} manifest  Danh sách {path, sha1} đã tải về
 */
export async function verifyAgainstManifest(dir, manifest) {
  const bad = [];
  const missing = [];
  const ok = [];
  for (const item of manifest || []) {
    if (!item?.path || !item?.sha1) continue;
    const abs = path.join(dir, item.path);
    try {
      const actual = await hashOf(abs, 'sha1');
      if (actual.toLowerCase() === String(item.sha1).toLowerCase()) ok.push(item.path);
      else bad.push({ path: item.path, expected: item.sha1, actual });
    } catch {
      missing.push(item.path);
    }
  }
  return { ok: ok.length, bad, missing, tampered: bad.length > 0 };
}

/** Tạo manifest SHA-1 cho toàn bộ thư mục (dùng làm "ảnh gốc" để so về sau). */
export async function buildManifest(dir, { ignore = ['.zeko/', 'logs/', 'crash-reports/'] } = {}) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = await fs.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const abs = path.join(cur, e.name);
      const rel = path.relative(dir, abs).split(path.sep).join('/');
      if (e.isDirectory()) {
        if (!ignore.some((ig) => `${rel}/`.startsWith(ig))) stack.push(abs);
        continue;
      }
      if (!e.isFile()) continue;
      out.push({ path: rel, sha1: await hashOf(abs, 'sha1') });
    }
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
