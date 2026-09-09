/**
 * Zeko Catalog — danh mục phiên bản Minecraft
 * -------------------------------------------------------------
 * Ưu tiên offline-first: luôn có catalog nhúng để launcher chạy được
 * kể cả khi không có mạng. Nếu mạng thông, tự đồng bộ từ Mojang
 * (piston-meta.mojang.com) và lưu vào cache để dùng cho lần sau.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { Paths, DataDir } from './paths.js';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const CACHE_TTL_MS = 1000 * 60 * 60 * 12; // 12 giờ

let memory = null;

export async function loadEmbeddedCatalog() {
  const raw = await fs.readFile(path.join(DataDir, 'versions.json'), 'utf8');
  return JSON.parse(raw);
}

async function loadCache() {
  try {
    const file = path.join(Paths.cache, 'version_manifest_v2.json');
    const stat = await fs.stat(file);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) return null;
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

async function saveCache(data) {
  try {
    await fs.mkdir(Paths.cache, { recursive: true });
    await fs.writeFile(path.join(Paths.cache, 'version_manifest_v2.json'), JSON.stringify(data, null, 2));
  } catch {
    /* bỏ qua nếu không ghi được cache */
  }
}

/**
 * @param {{force?: boolean, timeoutMs?: number}} opts
 * @returns danh mục phiên bản + trạng thái nguồn
 */
export async function getCatalog({ force = false, timeoutMs = 6000 } = {}) {
  if (memory && !force) return memory;

  const embedded = await loadEmbeddedCatalog();
  let live = null;
  let source = 'embedded';
  let error = null;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(MANIFEST_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data?.versions) && data.versions.length) {
      live = data;
      source = 'live';
      await saveCache(data);
    }
  } catch (err) {
    error = err?.name === 'AbortError' ? 'Mojang API quá chậm / không truy cập được' : String(err?.message || err);
    live = await loadCache();
    if (live) source = 'cache';
  }

  const versions = live?.versions?.length ? live.versions : embedded.versions;
  const popularIds = new Set((embedded.versions || []).filter((v) => v.popular).map((v) => v.id));
  const notes = Object.fromEntries((embedded.versions || []).filter((v) => v.note).map((v) => [v.id, v.note]));
  const javas = Object.fromEntries((embedded.versions || []).filter((v) => v.java).map((v) => [v.id, v.java]));

  memory = {
    source,
    error,
    syncedAt: live ? new Date().toISOString() : null,
    latest: live?.latest || embedded.latest,
    counts: {
      total: versions.length,
      release: versions.filter((v) => v.type === 'release').length,
      snapshot: versions.filter((v) => v.type === 'snapshot').length,
    },
    versions: versions.map((v) => ({
      id: v.id,
      type: v.type,
      url: v.url,
      sha1: v.sha1,
      releaseTime: v.releaseTime,
      time: v.time,
      popular: popularIds.has(v.id),
      note: notes[v.id] || null,
      java: javas[v.id] || (v.type === 'release' && Number(v.id.split('.')[1] || 0) >= 17 ? 17 : 8),
    })),
  };
  return memory;
}

export function findVersion(catalog, id) {
  return catalog.versions.find((v) => v.id === id) || null;
}

/** Tải version json chi tiết (assets/libraries/downloads) — cần mạng. */
export async function fetchVersionJson(meta, timeoutMs = 8000) {
  if (!meta?.url) throw new Error('Không có URL metadata cho phiên bản này (catalog offline).');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(meta.url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

export function invalidate() {
  memory = null;
}
