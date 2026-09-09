/**
 * Zeko Instances — quản lý instance (hồ sơ game)
 * -------------------------------------------------------------
 * Lưu trong <root>/instances.json. Mỗi instance có thư mục riêng
 * tại <root>/instances/<slug>/ với cấu trúc giống .minecraft:
 *   mods/  resourcepacks/  shaderpacks/  config/  saves/  logs/
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { Paths } from './paths.js';

export const INSTANCE_DIRS = ['mods', 'resourcepacks', 'shaderpacks', 'config', 'saves', 'logs', 'screenshots', '.zeko'];

const DEFAULT_META = {
  name: 'Instance mới',
  version: '1.20.4',
  loader: 'vanilla', // vanilla | fabric | forge | quilt | neoforge
  loaderVersion: null,
  icon: '🧊',
  accent: 'violet',
  notes: '',
  group: 'Mặc định',
  lastPlayed: null,
  playTimeSeconds: 0,
  launches: 0,
  createdAt: null,
  ram: { minMb: null, maxMb: null }, // null = dùng toàn cục
  javaPath: null,
  javaArgsExtra: [],
  window: { width: 1280, height: 720, fullscreen: false },
  perfProfile: 'lowend',
  perfAuto: true,
  security: { autoScanOnLaunch: true, blockOnThreat: true },
  env: {},
};

/** Các trường thuộc metadata instance — mọi thứ khác (stats, dir…) chỉ là phái sinh. */
const META_KEYS = new Set(Object.keys(DEFAULT_META).concat(['id', 'slug', 'name', 'createdAt']));

/** Lọc ra đúng các trường metadata, bỏ field phái sinh để không ghi bẩn DB. */
export function pickMeta(input = {}) {
  const out = {};
  for (const k of Object.keys(input)) if (META_KEYS.has(k)) out[k] = input[k];
  return out;
}

function slugify(str, fallback = 'instance') {
  const base = String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return base || `${fallback}-${crypto.randomBytes(3).toString('hex')}`;
}

async function readDb() {
  try {
    const raw = await fs.readFile(Paths.dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeDb(list) {
  await fs.mkdir(Paths.root, { recursive: true });
  const tmp = `${Paths.dbFile}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(list, null, 2));
  await fs.rename(tmp, Paths.dbFile);
}

export async function listInstances() {
  const list = await readDb();
  const enriched = [];
  for (const inst of list) {
    enriched.push(await withStats(inst));
  }
  return enriched;
}

export async function getInstance(id) {
  const list = await readDb();
  return list.find((i) => i.id === id) || null;
}

async function dirSize(dir) {
  let total = 0;
  let files = 0;
  try {
    const stack = [dir];
    while (stack.length) {
      const cur = stack.pop();
      const entries = await fs.readdir(cur, { withFileTypes: true });
      for (const e of entries) {
        const p = path.join(cur, e.name);
        if (e.isDirectory()) stack.push(p);
        else if (e.isFile()) {
          const st = await fs.stat(p);
          total += st.size;
          files += 1;
        }
      }
    }
  } catch {
    /* thư mục chưa tồn tại */
  }
  return { sizeBytes: total, fileCount: files };
}

export async function withStats(inst) {
  const dir = path.join(Paths.instances, inst.slug);
  const { sizeBytes, fileCount } = await dirSize(dir);
  return {
    ...inst,
    dir,
    stats: {
      sizeBytes,
      fileCount,
      sizeHuman: humanSize(sizeBytes),
      modCount: await countDir(path.join(dir, 'mods')),
      packCount: await countDir(path.join(dir, 'resourcepacks')),
      shaderCount: await countDir(path.join(dir, 'shaderpacks')),
    },
  };
}

async function countDir(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile() && !e.name.startsWith('.')).length;
  } catch {
    return 0;
  }
}

export function humanSize(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export async function createInstance(input = {}) {
  const list = await readDb();
  const name = (input.name || 'Instance mới').trim().slice(0, 64);
  let slug = slugify(input.slug || name);
  let n = 2;
  while (list.some((i) => i.slug === slug)) slug = `${slugify(name)}-${n++}`;

  const inst = {
    ...DEFAULT_META,
    ...pickMeta(input),
    id: crypto.randomUUID(),
    slug,
    name,
    createdAt: new Date().toISOString(),
    ram: { ...DEFAULT_META.ram, ...(input.ram || {}) },
    window: { ...DEFAULT_META.window, ...(input.window || {}) },
    security: { ...DEFAULT_META.security, ...(input.security || {}) },
  };

  const dir = path.join(Paths.instances, slug);
  await fs.mkdir(dir, { recursive: true });
  for (const d of INSTANCE_DIRS) await fs.mkdir(path.join(dir, d), { recursive: true });

  await fs.writeFile(path.join(dir, '.zeko', 'instance.json'), JSON.stringify(inst, null, 2));
  list.push(inst);
  await writeDb(list);
  return withStats(inst);
}

export async function updateInstance(id, patch = {}) {
  const list = await readDb();
  const idx = list.findIndex((i) => i.id === id);
  if (idx === -1) throw new Error('Không tìm thấy instance');
  const merged = { ...list[idx] };
  for (const [k, v] of Object.entries(patch)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && merged[k] && typeof merged[k] === 'object') {
      merged[k] = { ...merged[k], ...v };
    } else {
      merged[k] = v;
    }
  }
  list[idx] = merged;
  await writeDb(list);
  await fs.mkdir(path.join(Paths.instances, merged.slug, '.zeko'), { recursive: true });
  await fs.writeFile(path.join(Paths.instances, merged.slug, '.zeko', 'instance.json'), JSON.stringify(merged, null, 2));
  return withStats(merged);
}

export async function deleteInstance(id, { keepBackups = false } = {}) {
  const list = await readDb();
  const inst = list.find((i) => i.id === id);
  if (!inst) throw new Error('Không tìm thấy instance');
  const next = list.filter((i) => i.id !== id);
  await writeDb(next);
  const dir = path.join(Paths.instances, inst.slug);
  if (!keepBackups) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { deleted: inst.slug, kept: keepBackups };
}

export async function duplicateInstance(id, newName) {
  const src = await getInstance(id);
  if (!src) throw new Error('Không tìm thấy instance');
  const seed = pickMeta(src);
  delete seed.id;
  delete seed.slug;
  delete seed.createdAt;
  const copy = await createInstance({
    ...seed,
    name: newName || `${src.name} (bản sao)`,
    lastPlayed: null,
    playTimeSeconds: 0,
    launches: 0,
  });
  const srcDir = path.join(Paths.instances, src.slug);
  const dstDir = path.join(Paths.instances, copy.slug);
  try {
    await fs.cp(srcDir, dstDir, { recursive: true, force: true });
  } catch {
    /* thư mục nguồn rỗng */
  }
  return withStats({ ...copy });
}

export async function instanceDir(id) {
  const inst = await getInstance(id);
  if (!inst) throw new Error('Không tìm thấy instance');
  return path.join(Paths.instances, inst.slug);
}

/** Đọc nhanh thư mục con của instance (mods, resourcepacks…) */
export async function listInstanceFiles(id, sub) {
  const dir = await instanceDir(id);
  const target = path.resolve(dir, sub || '.');
  if (!target.startsWith(dir)) throw new Error('Đường dẫn không hợp lệ');
  const out = [];
  try {
    const entries = await fs.readdir(target, { withFileTypes: true });
    for (const e of entries) {
      const p = path.join(target, e.name);
      const st = await fs.stat(p);
      out.push({ name: e.name, dir: e.isDirectory(), size: st.size, mtime: st.mtimeMs, sizeHuman: humanSize(st.size) });
    }
  } catch {
    /* thư mục trống */
  }
  return out.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
}
