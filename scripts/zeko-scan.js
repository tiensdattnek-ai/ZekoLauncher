#!/usr/bin/env node
/**
 * zeko-scan — quét an toàn thư mục game từ terminal (không cần mở giao diện).
 *
 *   node scripts/zeko-scan.js <thư-mục> [--json] [--quarantine]
 *
 * Ví dụ:
 *   node scripts/zeko-scan.js ~/.local/share/zekolauncher/instances/survival
 *   node scripts/zeko-scan.js "C:\\Users\\me\\AppData\\Roaming\\.minecraft\\mods" --quarantine
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { scanDirectory } from '../server/lib/scanner.js';
import * as Quarantine from '../server/lib/quarantine.js';

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const target = args.find((a) => !a.startsWith('--'));

if (!target) {
  console.error('Cách dùng: node scripts/zeko-scan.js <thư-mục> [--json] [--quarantine]');
  process.exit(2);
}

const root = path.resolve(target);
try {
  await fs.access(root);
} catch {
  console.error(`Không tìm thấy: ${root}`);
  process.exit(2);
}

const t0 = Date.now();
const bar = (n) => '█'.repeat(Math.round(n / 5)) + '░'.repeat(20 - Math.round(n / 5));

if (!flags.has('--json')) process.stdout.write(`\n  🛡 ZEK0 SENTINEL — quét ${root}\n  ${bar(0)} 0%\r`);

const report = await scanDirectory(root, {
  maxFiles: 20000,
  onProgress: ({ scanned }) => {
    if (flags.has('--json')) return;
    process.stdout.write(`  ${bar(Math.min(20, scanned / 20))} ${Math.min(99, scanned)} tệp\r`);
  },
});

if (flags.has('--json')) {
  console.log(JSON.stringify({ ...report, all: undefined }, null, 2));
  process.exit(report.counts.threats ? 1 : 0);
}

console.log(' '.repeat(70));
console.log(`  Đã quét : ${report.counts.scanned} tệp (${(report.bytes / 1048576).toFixed(1)} MB) trong ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(`  Bỏ qua  : ${report.counts.skipped} (ngoài phạm vi / quá lớn)`);
console.log(`  Điểm rủi ro tổng: ${report.riskScore}/100`);
console.log('');

const groups = [
  ['⛔ RỦI RO CAO', report.results.filter((r) => r.verdict === 'threat')],
  ['⚠️  CẦN XEM XÉT', report.results.filter((r) => r.verdict === 'review')],
  ['💡 ĐÁNG CHÚ Ý', report.results.filter((r) => r.verdict === 'flag')],
];

let any = false;
for (const [label, items] of groups) {
  if (!items.length) continue;
  any = true;
  console.log(`  ${label} (${items.length})`);
  for (const it of items.slice(0, 25)) {
    console.log(`   • [${String(it.score).padStart(3)}/100] ${it.file}`);
    for (const r of (it.reasons || []).slice(0, 4)) {
      console.log(`       └ ${r.name} (+${r.points}) ${r.detail ? '— ' + r.detail.slice(0, 110) : ''}`);
    }
  }
  if (items.length > 25) console.log(`   … và ${items.length - 25} tệp nữa`);
  console.log('');
}
if (!any) console.log('  ✅ Không phát hiện tệp đáng ngờ nào.\n');

if (flags.has('--quarantine')) {
  const threats = report.results.filter((r) => r.verdict === 'threat').map((r) => r.file);
  if (!threats.length) {
    console.log('  Không có gì để cách ly.');
  } else {
    const rec = await Quarantine.quarantineFiles(root, threats, { report, reason: 'zeko-scan CLI' });
    console.log(`  📦 Đã chuyển ${rec.counts.moved} tệp vào vùng cách ly: ${rec.batchDir}`);
    console.log('     Khôi phục bằng: Zeko Launcher → Sentinel → Vùng cách ly → Khôi phục');
  }
}

console.log('  ⚠ Sentinel kiểm tra TỆP GAME, không thay thế phần mềm diệt virus hệ thống.\n');
process.exit(report.counts.threats ? 1 : 0);
