/**
 * Zeko Java — tìm JVM trên máy và chọn bản phù hợp với phiên bản game.
 * Minecraft 1.20.5+ cần Java 21, 1.17–1.20.4 cần Java 17, cũ hơn dùng Java 8.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { Paths } from './paths.js';

function run(cmd, args, timeout = 4000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const CANDIDATE_DIRS = {
  win32: [
    'C:/Program Files/Java',
    'C:/Program Files/Eclipse Adoptium',
    'C:/Program Files/Microsoft/jdk',
    'C:/Program Files/Zulu',
    'C:/Program Files/BellSoft/Liberica',
    'C:/Program Files (x86)/Java',
    `${process.env.LOCALAPPDATA || ''}/Programs/Eclipse Adoptium`,
  ],
  darwin: ['/Library/Java/JavaVirtualMachines', `${os.homedir()}/Library/Java/JavaVirtualMachines`],
  linux: ['/usr/lib/jvm', '/opt/java', '/usr/java', `${os.homedir()}/.local/share/java`],
};

function majorFromVersionString(text) {
  const m = text.match(/version "(\d+)(?:\.(\d+))?/);
  if (!m) return null;
  if (m[1] === '1') return Number(m[2] || 0); // 1.8.0_x → 8
  return Number(m[1]);
}

async function probe(javaBin) {
  try {
    const st = await fs.stat(javaBin);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  const { stderr, stdout } = await run(javaBin, ['-version']);
  const text = `${stderr}${stdout}`;
  const major = majorFromVersionString(text);
  if (!major) return null;
  const vendor = /openjdk/i.test(text) ? 'OpenJDK' : /java hotspot/i.test(text) ? 'Oracle' : 'JVM';
  return { path: javaBin, major, vendor, versionLine: text.split('\n')[0]?.trim() || '' };
}

let cached = null;
export async function detectJavaRuntimes({ force = false } = {}) {
  if (cached && !force) return cached;
  const found = new Map();
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';

  // 1) java trong PATH
  const which = process.platform === 'win32' ? 'where' : 'which';
  const { stdout } = await run(which, [exe === 'java.exe' ? 'java' : 'java']);
  for (const line of stdout.split(/\r?\n/)) {
    const p = line.trim();
    if (!p) continue;
    const info = await probe(p);
    if (info) found.set(info.path, info);
  }

  // 2) các thư mục cài đặt phổ biến
  for (const base of CANDIDATE_DIRS[process.platform] || []) {
    if (!base) continue;
    let entries = [];
    try {
      entries = await fs.readdir(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const bin = e.isDirectory() ? path.join(base, e.name, 'bin', exe) : null;
      if (!bin) continue;
      const info = await probe(bin);
      if (info) found.set(info.path, info);
    }
  }

  // 3) Java do Zeko tự tải về
  try {
    const entries = await fs.readdir(Paths.javaRuntimes, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const bin = path.join(Paths.javaRuntimes, e.name, 'bin', exe);
      const info = await probe(bin);
      if (info) found.set(info.path, { ...info, managed: true });
    }
  } catch {
    /* chưa có */
  }

  // 4) JAVA_HOME
  if (process.env.JAVA_HOME) {
    const info = await probe(path.join(process.env.JAVA_HOME, 'bin', exe));
    if (info) found.set(info.path, info);
  }

  cached = [...found.values()].sort((a, b) => b.major - a.major);
  return cached;
}

export function requiredJava(minecraftVersion) {
  const m = String(minecraftVersion || '').match(/^(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!m) return 17;
  const minor = Number(m[2]);
  const patch = Number(m[3] || 0);
  if (minor >= 21 || (minor === 20 && patch >= 5)) return 21;
  if (minor >= 17) return 17;
  return 8;
}

export async function pickJava(minecraftVersion, preferredPath = null) {
  const need = requiredJava(minecraftVersion);
  const runtimes = await detectJavaRuntimes();
  if (preferredPath) {
    const info = runtimes.find((r) => r.path === preferredPath);
    if (info) return { ...info, matches: info.major >= need, need };
  }
  const exact = runtimes.find((r) => r.major === need);
  const higher = runtimes.find((r) => r.major > need);
  const chosen = exact || higher || runtimes[0] || null;
  return chosen ? { ...chosen, need, matches: chosen.major >= need } : { need, matches: false, path: null, runtimes };
}

export async function javaStatus() {
  const runtimes = await detectJavaRuntimes();
  return {
    installed: runtimes.length > 0,
    runtimes,
    recommended: [
      { major: 21, label: 'Java 21 (LTS)', for: 'Minecraft 1.20.5 trở lên', url: 'https://adoptium.net/temurin/releases/?version=21' },
      { major: 17, label: 'Java 17 (LTS)', for: 'Minecraft 1.17 – 1.20.4', url: 'https://adoptium.net/temurin/releases/?version=17' },
      { major: 8, label: 'Java 8', for: 'Minecraft 1.16.5 trở xuống', url: 'https://adoptium.net/temurin/releases/?version=8' },
    ],
    missing: [21, 17, 8].filter((m) => !runtimes.some((r) => r.major === m)),
  };
}
