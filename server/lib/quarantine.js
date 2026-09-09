/**
 * Zeko Sentinel — vùng cách ly (quarantine)
 * -------------------------------------------------------------
 * Tệp nghi ngờ được DI CHUYỂN (không xoá) vào <root>/quarantine/<batch>/,
 * giữ nguyên cây thư mục gốc và ghi kèm report.json để khôi phục 1-chạm.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Paths } from './paths.js';

const INDEX = path.join(Paths.quarantine, 'index.json');

async function readIndex() {
  try {
    return JSON.parse(await fs.readFile(INDEX, 'utf8'));
  } catch {
    return [];
  }
}

async function writeIndex(list) {
  await fs.mkdir(Paths.quarantine, { recursive: true });
  await fs.writeFile(INDEX, JSON.stringify(list, null, 2));
}

export async function quarantineFiles(sourceRoot, files, { report, reason = 'Zeko Sentinel' } = {}) {
  const batch = `${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}-${crypto.randomBytes(2).toString('hex')}`;
  const batchDir = path.join(Paths.quarantine, batch);
  await fs.mkdir(batchDir, { recursive: true });

  const moved = [];
  const failed = [];
  for (const rel of files) {
    const src = path.resolve(sourceRoot, rel);
    if (!src.startsWith(path.resolve(sourceRoot))) {
      failed.push({ rel, error: 'Đường dẫn ngoài phạm vi instance' });
      continue;
    }
    const dest = path.join(batchDir, 'files', rel);
    try {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(src, dest).catch(async () => {
        await fs.copyFile(src, dest);
        await fs.rm(src, { force: true });
      });
      moved.push({ rel, dest });
    } catch (err) {
      failed.push({ rel, error: String(err?.message || err) });
    }
  }

  const record = {
    batch,
    batchDir,
    sourceRoot,
    createdAt: new Date().toISOString(),
    reason,
    riskScore: report?.riskScore ?? null,
    counts: { moved: moved.length, failed: failed.length },
    items: moved.map((m) => {
      const finding = report?.all?.find((r) => r.file === m.rel);
      return {
        rel: m.rel,
        stored: path.relative(batchDir, m.dest),
        score: finding?.score ?? null,
        verdict: finding?.verdict ?? null,
        reasons: (finding?.reasons || []).slice(0, 6),
      };
    }),
    failed,
    restored: false,
  };

  await fs.writeFile(path.join(batchDir, 'report.json'), JSON.stringify(record, null, 2));
  const index = await readIndex();
  index.unshift({ batch, sourceRoot, createdAt: record.createdAt, moved: moved.length, failed: failed.length, restored: false, riskScore: record.riskScore });
  await writeIndex(index.slice(0, 200));

  return record;
}

export async function listQuarantine() {
  return readIndex();
}

export async function getBatch(batch) {
  const dir = path.join(Paths.quarantine, batch);
  try {
    return JSON.parse(await fs.readFile(path.join(dir, 'report.json'), 'utf8'));
  } catch {
    return null;
  }
}

/** Khôi phục về vị trí cũ (nếu chỗ đó còn trống). */
export async function restoreBatch(batch) {
  const rec = await getBatch(batch);
  if (!rec) throw new Error('Không tìm thấy lô cách ly');
  const restored = [];
  const conflicts = [];
  for (const item of rec.items) {
    const stored = path.join(rec.batchDir, item.stored);
    const dest = path.join(rec.sourceRoot, item.rel);
    try {
      const exists = await fs.stat(dest).then(() => true).catch(() => false);
      if (exists) {
        conflicts.push(item.rel);
        continue;
      }
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.rename(stored, dest).catch(async () => {
        await fs.copyFile(stored, dest);
        await fs.rm(stored, { force: true });
      });
      restored.push(item.rel);
    } catch (err) {
      conflicts.push(`${item.rel} (${err?.message || err})`);
    }
  }
  rec.restored = true;
  rec.restoredAt = new Date().toISOString();
  await fs.writeFile(path.join(rec.batchDir, 'report.json'), JSON.stringify(rec, null, 2));
  const index = await readIndex();
  const row = index.find((i) => i.batch === batch);
  if (row) row.restored = true;
  await writeIndex(index);
  return { restored, conflicts };
}

export async function purgeBatch(batch) {
  const dir = path.join(Paths.quarantine, batch);
  await fs.rm(dir, { recursive: true, force: true });
  const index = (await readIndex()).filter((i) => i.batch !== batch);
  await writeIndex(index);
  return { purged: batch };
}

export async function quarantineStats() {
  const index = await readIndex();
  let items = 0;
  let bytes = 0;
  for (const row of index) {
    try {
      const rec = await getBatch(row.batch);
      items += rec?.items?.length || 0;
      for (const it of rec?.items || []) {
        const st = await fs.stat(path.join(rec.batchDir, it.stored)).catch(() => null);
        bytes += st?.size || 0;
      }
    } catch {
      /* bỏ qua */
    }
  }
  return { batches: index.length, items, bytes, activeBatches: index.filter((i) => !i.restored).length };
}
