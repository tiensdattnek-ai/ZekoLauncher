/**
 * Zeko Metrics — đo máy thật + điểm chuẩn nhanh.
 * Dùng cho bảng điều khiển, tự động hạ cấu hình (Auto-Tune) và
 * đề xuất preset hiệu năng phù hợp.
 */
import os from 'node:os';
import fs from 'node:fs/promises';

let prevIdle = null;
let prevTotal = null;

export function cpuUsage() {
  const cpus = os.cpus();
  let idle = 0;
  let total = 0;
  for (const c of cpus) {
    idle += c.times.idle;
    total += c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
  }
  let percent = null;
  if (prevIdle !== null) {
    const dIdle = idle - prevIdle;
    const dTotal = total - prevTotal;
    percent = dTotal > 0 ? Math.round((1 - dIdle / dTotal) * 1000) / 10 : 0;
  }
  prevIdle = idle;
  prevTotal = total;
  return percent;
}

export function memoryInfo() {
  const total = os.totalmem();
  const free = os.freemem();
  return {
    totalMb: Math.round(total / 1048576),
    freeMb: Math.round(free / 1048576),
    usedMb: Math.round((total - free) / 1048576),
    percent: Math.round(((total - free) / total) * 1000) / 10,
  };
}

export async function diskInfo(target = os.homedir()) {
  try {
    const st = await fs.statfs(target);
    return {
      totalGb: Math.round((st.blocks * st.bsize) / 1073741824 * 10) / 10,
      freeGb: Math.round((st.bavail * st.bsize) / 1073741824 * 10) / 10,
      percentUsed: Math.round((1 - st.bavail / Math.max(1, st.blocks)) * 100),
    };
  } catch {
    return null;
  }
}

export function systemSnapshot() {
  const mem = memoryInfo();
  return {
    at: new Date().toISOString(),
    platform: process.platform,
    release: os.release(),
    arch: process.arch,
    hostname: os.hostname(),
    cpuModel: os.cpus()[0]?.model?.replace(/\s+/g, ' ').trim() || 'Không rõ',
    cpuCores: os.cpus().length,
    loadAvg: os.loadavg().map((n) => Math.round(n * 100) / 100),
    uptimeSeconds: Math.round(os.uptime()),
    cpuPercent: cpuUsage(),
    memory: mem,
  };
}

/**
 * Điểm chuẩn nhanh (< 400 ms): đo tốc độ ghi đĩa, vòng lặp số nguyên
 * và cấp phát bộ nhớ. Cho ra "Zeko Performance Index" 0–1000.
 */
export async function quickBenchmark({ workDir = os.tmpdir() } = {}) {
  const out = {};

  // 1) Ghi đĩa 8 MB
  const t0 = process.hrtime.bigint();
  const file = `${workDir}/.zeko-bench-${process.pid}.bin`;
  const payload = Buffer.alloc(1024 * 1024, 0x5a);
  try {
    const fh = await fs.open(file, 'w');
    for (let i = 0; i < 8; i++) await fh.write(payload);
    await fh.close();
    const t1 = process.hrtime.bigint();
    out.diskMs = Number(t1 - t0) / 1e6;
    out.diskMbps = Math.round((8 / (out.diskMs / 1000)) * 10) / 10;
  } catch (err) {
    out.diskError = String(err?.message || err);
  } finally {
    await fs.rm(file, { force: true });
  }

  // 2) Số nguyên: sàng nguyên tố
  const t2 = process.hrtime.bigint();
  let count = 0;
  const N = 400_000;
  const sieve = new Uint8Array(N);
  for (let i = 2; i < N; i++) {
    if (!sieve[i]) {
      count++;
      for (let j = i * i; j < N; j += i) sieve[j] = 1;
    }
  }
  const t3 = process.hrtime.bigint();
  out.primeMs = Number(t3 - t2) / 1e6;
  out.primes = count;

  // 3) Cấp phát GC (mô phỏng tải Minecraft)
  const t4 = process.hrtime.bigint();
  let sink = 0;
  for (let i = 0; i < 60_000; i++) {
    const arr = new Array(32).fill(i);
    sink += arr[i & 31];
  }
  const t5 = process.hrtime.bigint();
  out.allocMs = Number(t5 - t4) / 1e6;
  out.sink = sink % 7;

  // 4) Chỉ số tổng hợp
  const mem = memoryInfo();
  const cores = os.cpus().length;
  // Chuẩn hoá: mốc tham chiếu là laptop phổ thông 2020 (sàng 400k ≈ 45 ms,
  // ghi đĩa ≈ 250 MB/s, cấp phát ≈ 35 ms). Máy mạnh vượt mốc, máy yếu hụt mốc.
  const cpuScore = clamp(Math.round(250 * (45 / Math.max(out.primeMs, 0.5)) + cores * 8), 0, 400);
  const diskScore = clamp(Math.round(250 * Math.min(1.6, (out.diskMbps || 1) / 250)), 0, 250);
  const memScore = clamp(Math.round(250 * (mem.totalMb / 16384)), 0, 250);
  const allocScore = clamp(Math.round(100 * (35 / Math.max(out.allocMs, 0.5))), 0, 100);
  out.index = clamp(cpuScore + diskScore + memScore + allocScore, 0, 1000);
  out.parts = { cpuScore, diskScore, memScore, allocScore };
  out.tier = tierFor(out.index);
  out.suggestedProfile = profileFor(out.index, mem.totalMb, cores);
  return out;
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function tierFor(index) {
  if (index >= 780) return { id: 'beast', label: 'Máy rất mạnh', color: '#22d3ee' };
  if (index >= 560) return { id: 'strong', label: 'Máy mạnh', color: '#34d399' };
  if (index >= 380) return { label: 'Máy trung bình', id: 'mid', color: '#fbbf24' };
  if (index >= 210) return { label: 'Máy yếu', id: 'low', color: '#fb923c' };
  return { label: 'Máy rất yếu', id: 'potato', color: '#f87171' };
}

export function profileFor(index, totalRamMb, cores) {
  // RAM vật lý là trần cứng — CPU nhanh không bù được việc thiếu RAM.
  if (totalRamMb <= 3072 || (totalRamMb <= 4096 && cores <= 2) || index < 200) return 'potato';
  if (totalRamMb <= 6144 || index < 430) return 'lowend';
  if (totalRamMb <= 12288 || index < 700) return 'balanced';
  return 'ultra';
}

/**
 * Auto-Tune: đề nghị hạ RAM / render distance khi máy đang quá tải.
 */
export function autoTuneAdvice() {
  const mem = memoryInfo();
  const cpu = cpuUsage();
  const load = os.loadavg()[0];
  const cores = os.cpus().length;
  const advice = [];
  if (mem.percent > 88) advice.push({ level: 'warn', code: 'ram-high', text: `RAM hệ thống đang dùng ${mem.percent}% — nên giảm RAM cấp cho game.` });
  if (cpu !== null && cpu > 90) advice.push({ level: 'warn', code: 'cpu-high', text: `CPU đang chạy ${cpu}% — tắt bớt ứng dụng nền trước khi vào game.` });
  if (load > cores * 1.5) advice.push({ level: 'info', code: 'load-high', text: `Tải trung bình ${load.toFixed(2)} trên ${cores} nhân — máy đang bận.` });
  return { memory: mem, cpu, load, advice, healthy: advice.length === 0 };
}
