/**
 * Zeko Settings — cấu hình toàn cục của launcher.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import { Paths } from './paths.js';

export const DEFAULT_SETTINGS = {
  language: 'vi',
  theme: 'violet',
  effects: 'balanced', // off | balanced | full — ảnh hưởng nền động, blur, hạt sáng
  compactMode: false,
  account: { username: 'ZekoPlayer', uuid: null, accessToken: '0', userType: 'legacy', offline: true },
  java: { path: null, args: [] },
  ram: { minMb: 2048, maxMb: 4096 },
  perfProfile: 'lowend',
  perfAutoTune: true, // tự hạ cấu hình khi máy đang nóng/ngốn RAM
  window: { width: 1280, height: 720, fullscreen: false },
  gameDir: null,
  launch: { closeLauncher: false, showConsole: true, showSnapshots: false },
  security: {
    autoScanOnLaunch: true,
    blockOnThreat: true,
    scanOnDownload: true,
    deepScan: true,
    telemetry: false,
  },
  downloads: { concurrency: 4, verifySha1: true },
  updates: { channel: 'stable', autoCheck: true },
  onboardingDone: false,
};

let memory = null;

export async function load() {
  if (memory) return memory;
  try {
    const raw = JSON.parse(await fs.readFile(Paths.settingsFile, 'utf8'));
    memory = deepMerge(structuredClone(DEFAULT_SETTINGS), raw);
  } catch {
    memory = structuredClone(DEFAULT_SETTINGS);
  }
  // RAM tối đa không vượt quá 75% RAM vật lý
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  memory.system = {
    platform: process.platform,
    arch: process.arch,
    cpus: os.cpus().length,
    cpuModel: os.cpus()[0]?.model?.trim() || 'Không rõ',
    totalRamMb: totalMb,
    recommendedMaxRamMb: Math.max(1024, Math.min(Math.floor(totalMb * 0.5), 8192)),
  };
  return memory;
}

export async function save(patch) {
  const cur = await load();
  memory = deepMerge(structuredClone(cur), patch || {});
  await fs.mkdir(Paths.root, { recursive: true });
  const tmp = `${Paths.settingsFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(memory, null, 2));
  await fs.rename(tmp, Paths.settingsFile);
  return memory;
}

export async function reset() {
  memory = structuredClone(DEFAULT_SETTINGS);
  await fs.rm(Paths.settingsFile, { force: true });
  return load();
}

function deepMerge(base, patch) {
  for (const [k, v] of Object.entries(patch || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      base[k] = deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

/** Gợi ý RAM theo máy thật — trái tim của "tối ưu cho máy yếu". */
export function recommendRam() {
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024);
  const cpus = os.cpus().length;
  let max;
  if (totalMb <= 4096) max = 1536;
  else if (totalMb <= 8192) max = 3072;
  else if (totalMb <= 16384) max = 6144;
  else max = 8192;
  const min = Math.max(1024, Math.floor(max / 2));
  // RAM vật lý là trần cứng: CPU nhanh đến đâu cũng không cấp heap lớn hơn RAM có thật.
  let profile = 'balanced';
  if (totalMb <= 3072 || (totalMb <= 4096 && cpus <= 2)) profile = 'potato';
  else if (totalMb <= 6144 || cpus <= 2) profile = 'lowend';
  else if (totalMb <= 12288) profile = totalMb >= 12288 ? 'balanced' : 'balanced';
  else if (totalMb >= 24576 && cpus >= 12) profile = 'ultra';
  return { totalMb, cpus, minMb: min, maxMb: max, profile, ramBoundMb: totalMb };
}
