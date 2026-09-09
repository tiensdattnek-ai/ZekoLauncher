/**
 * Zeko Launch — dựng lệnh khởi động Minecraft và chạy tiến trình game.
 * ---------------------------------------------------------------------
 * - Ghép JVM args từ preset hiệu năng (Zeko Turbo)
 * - Ghép classpath / natives / assets từ version json của Mojang
 * - Thay thế token ${...} đúng chuẩn launchermeta
 * - Stream log về trình xem console trong giao diện (qua SSE)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { Paths } from './paths.js';
import { load as loadSettings, recommendRam } from './settings.js';
import { pickJava } from './java.js';
import { getPresets } from './performance.js';
import { scanDirectory } from './scanner.js';

export const events = new EventEmitter();
events.setMaxListeners(50);

/** Tiến trình game đang chạy, key = instanceId */
const sessions = new Map();

export function activeSessions() {
  return [...sessions.values()].map((s) => ({
    instanceId: s.instanceId,
    instanceName: s.instanceName,
    pid: s.proc?.pid ?? null,
    state: s.state,
    startedAt: s.startedAt,
    uptimeMs: Date.now() - s.startedTime,
    fpsHint: s.fpsHint,
  }));
}

export function getSession(instanceId) {
  return sessions.get(instanceId) || null;
}

function ruleApplies(rule) {
  if (!rule) return true;
  let allow = true;
  if (rule.action === 'disallow') allow = false;
  const os_ = rule.os;
  if (os_) {
    const name = os_.name === 'windows' ? 'win32' : os_.name === 'osx' ? 'darwin' : os_.name === 'linux' ? 'linux' : os_.name;
    if (name && process.platform !== name) return !allow;
    if (name && process.platform === name) return allow;
  }
  if (rule.features) return false; // is_demo_mode / has_custom_resolution xử lý riêng
  return allow;
}

/**
 * Dựng lệnh khởi động hoàn chỉnh.
 * @param {object} args
 * @param {object} args.instance      metadata instance
 * @param {object} args.versionJson   version json của Mojang (có thể null khi offline)
 * @param {object} args.settings      cài đặt toàn cục
 */
export async function buildLaunchCommand({ instance, versionJson, settings, profileId }) {
  const presets = await getPresets();
  const perfId = profileId || instance.perfProfile || settings.perfProfile || 'lowend';
  const preset = presets.presets.find((p) => p.id === perfId) || presets.presets[1];
  const rec = recommendRam();

  const maxMb = clampRam(instance.ram?.maxMb ?? settings.ram?.maxMb ?? rec.maxMb, preset.minRamMb, settings.system?.totalRamMb || rec.totalMb);
  const minMb = clampRam(instance.ram?.minMb ?? settings.ram?.minMb ?? Math.floor(maxMb / 2), 512, maxMb);

  const java = await pickJava(versionJson?.id || instance.version, instance.javaPath || settings.java?.path);
  const gameDir = path.join(Paths.instances, instance.slug);
  const versionDir = path.join(Paths.versions, instance.version);
  const clientJar = path.join(versionDir, `${instance.version}.jar`);

  const nativesDir = path.join(versionDir, 'natives');
  const assetsRoot = Paths.assets;
  const assetIndexName = versionJson?.assetIndex?.id || instance.version;

  // ── classpath ──────────────────────────────────────────────────────
  const cp = [];
  if (versionJson?.libraries?.length) {
    for (const lib of versionJson.libraries) {
      if (!ruleApplies(lib.rules)) continue;
      const art = lib.downloads?.artifact;
      if (art?.path) cp.push(path.join(Paths.libraries, art.path));
      for (const [cls, nat] of Object.entries(lib.downloads?.classifiers || {})) {
        if (cls === lib.natives?.[process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'osx' : 'linux']) {
          cp.push(path.join(Paths.libraries, nat.path));
        }
      }
    }
  }
  cp.push(clientJar);

  const mainClass = versionJson?.mainClass || 'net.minecraft.client.main.Main';
  const jvmArgPattern = versionJson?.arguments?.jvm
    ? versionJson.arguments.jvm.filter((a) => typeof a === 'string')
    : [
        `-Djava.library.path=${nativesDir}`,
        `-Dminecraft.launcher.brand=${'Zeko Launcher'}`,
        `-Dminecraft.launcher.version=${'1.0.0'}`,
        '-cp',
        '${classpath}',
      ];

  const acct = settings.account || {};
  const username = acct.username || 'ZekoPlayer';
  const uuid = acct.uuid || offlineUuid(username);
  const token = acct.accessToken || '0';

  const gameArgs = [
    '--username', username,
    '--version', instance.version,
    '--gameDir', gameDir,
    '--assetsDir', assetsRoot,
    '--assetIndex', assetIndexName,
    '--uuid', uuid,
    '--accessToken', token,
    '--userType', acct.userType || 'legacy',
    '--versionType', `Zeko-${instance.version}`,
  ];
  if (instance.window?.width && instance.window?.height) {
    gameArgs.push('--width', String(instance.window.width), '--height', String(instance.window.height));
  }
  if (instance.window?.fullscreen) gameArgs.push('--fullscreen');

  const jvmArgs = [`-Xms${minMb}M`, `-Xmx${maxMb}M`, ...preset.jvmArgs, ...(settings.java?.args || []), ...(instance.javaArgsExtra || [])];
  for (const raw of jvmArgPattern) {
    jvmArgs.push(
      raw
        .replace('${classpath}', cp.join(path.delimiter))
        .replace('${natives_directory}', nativesDir)
        .replace('${launcher_name}', 'Zeko Launcher')
        .replace('${launcher_version}', '1.0.0')
        .replace('${version_name}', instance.version)
        .replace('${game_directory}', gameDir)
    );
  }

  return {
    instanceId: instance.id,
    instanceName: instance.name,
    version: instance.version,
    javaPath: java.path,
    javaMajor: java.major,
    javaRequired: java.need,
    javaOk: Boolean(java.matches && java.path),
    mainClass,
    jvmArgs,
    gameArgs,
    argv: [mainClass, ...gameArgs],
    cwd: gameDir,
    preset,
    ram: { minMb, maxMb },
    clientJar,
    classpathEntries: cp.length,
    command: [java.path || 'java', ...jvmArgs, mainClass, ...gameArgs].map(quoteArg).join(' '),
    missingFiles: (await Promise.all([exists(clientJar)])).every(Boolean) ? [] : [clientJar],
  };
}

function quoteArg(a) {
  return /[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a;
}

function clampRam(v, min, max) {
  return Math.max(min || 512, Math.min(v, max || v));
}

export function offlineUuid(username) {
  // UUID kiểu offline: "OfflinePlayer:<tên>" → MD5 → UUID v3
  const md5 = crypto.createHash('md5').update(`OfflinePlayer:${username}`).digest();
  md5[6] = (md5[6] & 0x0f) | 0x30;
  md5[8] = (md5[8] & 0x3f) | 0x80;
  const hex = md5.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Khởi động game. Tự quét an toàn trước khi chạy nếu bật.
 */
export async function launch({ instance, settings, versionJson, profileId, skipScan = false }) {
  const cmd = await buildLaunchCommand({ instance, versionJson, settings, profileId });

  // ── Zeko Sentinel: quét trước khi khởi động ───────────────────────
  let scan = null;
  if (!skipScan && settings.security?.autoScanOnLaunch) {
    scan = await scanDirectory(path.join(Paths.instances, instance.slug), { maxFiles: 1200 });
    events.emit('log', { instanceId: instance.id, type: 'zeko', line: `🛡 Sentinel đã quét ${scan.counts.scanned} tệp trong ${(scan.durationMs / 1000).toFixed(1)}s — rủi ro ${scan.riskScore}/100` });
    if (scan.counts.threats > 0 && settings.security?.blockOnThreat) {
      const err = new Error(`Chặn khởi động: tìm thấy ${scan.counts.threats} tệp rủi ro cao trong "${instance.name}". Mở Zeko Sentinel để xem chi tiết.`);
      err.code = 'ZEKO_BLOCKED_BY_SENTINEL';
      err.scan = { riskScore: scan.riskScore, threats: scan.results.filter((r) => r.verdict === 'threat').slice(0, 10) };
      throw err;
    }
  }

  // ── Kiểm tra điều kiện chạy ───────────────────────────────────────
  const problems = [];
  if (!cmd.javaOk) problems.push(`Thiếu Java ${cmd.javaRequired} (đã tìm thấy: ${cmd.javaMajor ?? 'không có'}).`);
  if (cmd.missingFiles.length) problems.push(`Chưa tải tệp game: ${cmd.missingFiles.map((f) => path.basename(f)).join(', ')}.`);
  if (problems.length) {
    const err = new Error(problems.join(' '));
    err.code = 'ZEKO_NOT_READY';
    err.details = { problems, command: cmd.command, scan };
    throw err;
  }

  await fs.mkdir(path.join(Paths.instances, instance.slug, '.zeko'), { recursive: true });
  await fs.writeFile(path.join(Paths.instances, instance.slug, '.zeko', 'last-launch-command.txt'), cmd.command);

  const proc = spawn(cmd.javaPath, [...cmd.jvmArgs, ...cmd.argv], {
    cwd: cmd.cwd,
    env: {
      ...process.env,
      JAVA_HOME: path.dirname(path.dirname(cmd.javaPath)),
      ZEKO_LAUNCHER: '1',
      ZEKO_INSTANCE: instance.slug,
      ZEKO_PERF_PROFILE: cmd.preset.id,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: false,
  });

  const session = {
    instanceId: instance.id,
    instanceName: instance.name,
    slug: instance.slug,
    proc,
    state: 'starting',
    startedAt: new Date().toISOString(),
    startedTime: Date.now(),
    cmd,
    scan,
    log: [],
    fpsHint: null,
  };
  sessions.set(instance.id, session);

  const push = (type, line) => {
    const entry = { t: Date.now(), type, line };
    session.log.push(entry);
    if (session.log.length > 4000) session.log.splice(0, 1000);
    events.emit('log', { instanceId: instance.id, ...entry });
    if (/FPS:|fps:/.test(line)) {
      const m = line.match(/FPS:\s*(\d+)/);
      if (m) session.fpsHint = Number(m[1]);
    }
    if (/Setting user|LWJGL Version|Backend library/.test(line)) session.state = 'running';
  };

  proc.stdout.setEncoding('utf8');
  proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', (d) => d.split(/\r?\n/).filter(Boolean).forEach((l) => push('out', l)));
  proc.stderr.on('data', (d) => d.split(/\r?\n/).filter(Boolean).forEach((l) => push('err', l)));

  proc.on('error', (err) => {
    session.state = 'error';
    push('zeko', `Không chạy được Java: ${err.message}`);
    events.emit('exit', { instanceId: instance.id, code: -1, reason: err.message });
    sessions.delete(instance.id);
  });

  proc.on('exit', async (code, signal) => {
    session.state = 'exited';
    const uptime = Math.round((Date.now() - session.startedTime) / 1000);
    push('zeko', `Game đã đóng (mã ${code ?? signal}) sau ${uptime}s`);
    events.emit('exit', { instanceId: instance.id, code, signal, uptimeSeconds: uptime });
    // cập nhật thống kê chơi
    try {
      const { updateInstance } = await import('./instances.js');
      await updateInstance(instance.id, {
        lastPlayed: new Date().toISOString(),
        playTimeSeconds: (instance.playTimeSeconds || 0) + uptime,
        launches: (instance.launches || 0) + 1,
      });
    } catch {
      /* bỏ qua */
    }
    // lưu log ra đĩa
    await fs.mkdir(Paths.logs, { recursive: true });
    await fs.writeFile(path.join(Paths.logs, `${instance.slug}-${Date.now()}.log`), session.log.map((l) => l.line).join('\n')).catch(() => {});
    setTimeout(() => sessions.delete(instance.id), 30_000);
  });

  return {
    ok: true,
    pid: proc.pid,
    command: cmd.command,
    preset: cmd.preset.id,
    ram: cmd.ram,
    scanSummary: scan ? { riskScore: scan.riskScore, threats: scan.counts.threats, scanned: scan.counts.scanned } : null,
  };
}

export function stopGame(instanceId) {
  const s = sessions.get(instanceId);
  if (!s || !s.proc) return false;
  s.proc.kill('SIGTERM');
  setTimeout(() => {
    try {
      s.proc.kill('SIGKILL');
    } catch {
      /* đã thoát */
    }
  }, 4000);
  return true;
}

/**
 * Ghi đè options.txt trong instance theo preset — tăng FPS mà người chơi
 * không phải mò từng mục trong menu.
 */
export async function applyGameSettings(instance, settingsOverride) {
  const dir = path.join(Paths.instances, instance.slug);
  const file = path.join(dir, 'options.txt');
  const map = {
    renderDistance: 'renderDistance',
    simulationDistance: 'simulationDistance',
    maxFps: 'maxFps',
    vsync: 'enableVsync',
    particles: 'particles',
    clouds: 'renderClouds',
    entityShadows: 'entityShadows',
    mipmapLevels: 'mipmapLevels',
    biomeBlendRadius: 'biomeBlendRadius',
    entityDistanceScaling: 'entityDistanceScaling',
    guiScale: 'guiScale',
    bobView: 'bobView',
    ao: 'ao',
    graphics: 'graphicsMode',
  };
  let lines = [];
  try {
    lines = (await fs.readFile(file, 'utf8')).split(/\r?\n/);
  } catch {
    lines = [];
  }
  const store = new Map(lines.filter(Boolean).map((l) => [l.split(':')[0], l]));
  let changed = 0;
  for (const [k, v] of Object.entries(settingsOverride || {})) {
    const key = map[k] || k;
    let value = v;
    if (key === 'graphicsMode') value = v === 'fast' ? '0' : v === 'fancy' ? '1' : '2';
    if (key === 'particles') value = v === 'all' ? '0' : v === 'decreased' ? '1' : '2';
    if (key === 'renderClouds') value = v === 'fancy' ? 'true' : v === 'fast' ? 'fast' : 'false';
    const next = `${key}:${value}`;
    if (store.get(key) !== next) changed++;
    store.set(key, next);
  }
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(file, [...store.values()].join('\n') + '\n');
  return { file, changed, applied: store.size };
}
