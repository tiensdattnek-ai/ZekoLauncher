/**
 * Zeko Turbo — hồ sơ hiệu năng.
 * Đọc từ server/data/performance-presets.json, kèm gợi ý theo máy thật.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { DataDir } from './paths.js';
import { recommendRam } from './settings.js';

let cache = null;

export async function getPresets() {
  if (cache) return cache;
  cache = JSON.parse(await fs.readFile(path.join(DataDir, 'performance-presets.json'), 'utf8'));
  return cache;
}

export async function getPreset(id) {
  const p = await getPresets();
  return p.presets.find((x) => x.id === id) || p.presets[1];
}

const PROFILE_ORDER = ['potato', 'lowend', 'balanced', 'ultra'];

export async function recommend() {
  const p = await getPresets();
  const rec = recommendRam();
  const preset = p.presets.find((x) => x.id === rec.profile) || p.presets[1];
  const ramGb = Math.round((rec.totalMb / 1024) * 10) / 10;

  // Hồ sơ mà CPU/đĩa "muốn" so với hồ sơ mà RAM "cho phép" — lấy cái thấp hơn.
  const { profileFor } = await import('./metrics.js');
  const bench = await quickIndex();
  const wanted = profileFor(bench, rec.totalMb, rec.cpus);
  const ramOnly = ramProfile(rec.totalMb, rec.cpus);
  const ramBound = PROFILE_ORDER.indexOf(wanted) > PROFILE_ORDER.indexOf(ramOnly);

  return {
    ...rec,
    preset,
    ramBound,
    index: bench,
    reason: ramBound
      ? `CPU và đĩa của máy đủ cho hồ sơ cao hơn, nhưng chỉ có ${ramGb} GB RAM — RAM là trần cứng. Zeko giới hạn ở "${preset.name}" vì để hệ điều hành rơi vào swap còn gây giật nặng hơn là giảm FPS.`
      : `Máy bạn có ${rec.cpus} nhân CPU và ${ramGb} GB RAM → hồ sơ "${preset.name}" là phù hợp nhất.`,
  };
}

function ramProfile(totalMb, cores) {
  if (totalMb <= 3072 || (totalMb <= 4096 && cores <= 2)) return 'potato';
  if (totalMb <= 6144 || cores <= 2) return 'lowend';
  if (totalMb <= 12288) return 'balanced';
  if (totalMb >= 24576 && cores >= 12) return 'ultra';
  return 'balanced';
}

/**
 * Chỉ số máy nhanh, có cache 2 phút.
 * KHÔNG chạy benchmark mỗi lần mở trang — đó là tối ưu cho máy yếu.
 */
let indexCache = { at: 0, index: null };
async function quickIndex() {
  if (indexCache.index !== null && Date.now() - indexCache.at < 120_000) return indexCache.index;
  try {
    const { quickBenchmark } = await import('./metrics.js');
    const os = await import('node:os');
    const b = await quickBenchmark({ workDir: os.tmpdir() });
    indexCache = { at: Date.now(), index: b.index };
    return b.index;
  } catch {
    return 400;
  }
}

/** Danh sách mod tối ưu nên cài cho một preset, kèm mô tả. */
export async function modsForProfile(id) {
  const p = await getPresets();
  const preset = p.presets.find((x) => x.id === id) || p.presets[1];
  return (preset.mods || []).map((key) => ({ key, ...(p.modCatalog[key] || { name: key }) }));
}

export function reload() {
  cache = null;
}
