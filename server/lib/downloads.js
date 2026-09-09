/**
 * Zeko Downloader — tải tệp có kiểm tra SHA-1, tiếp tục (resume) và hàng đợi.
 * Thiết kế cho máy yếu: giới hạn số kết nối song song, ghi thẳng ra đĩa,
 * không giữ buffer lớn trong RAM.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import { Paths } from './paths.js';

export const events = new EventEmitter();
events.setMaxListeners(50);

const CONCURRENCY = Number(process.env.ZEKO_DOWNLOAD_CONCURRENCY || 4);
let running = 0;
const queue = [];

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const job = queue.shift();
    running++;
    job()
      .catch(() => {})
      .finally(() => {
        running--;
        pump();
      });
  }
}

function enqueue(fn) {
  return new Promise((resolve, reject) => {
    queue.push(async () => {
      try {
        resolve(await fn());
      } catch (err) {
        reject(err);
      }
    });
    pump();
  });
}

export async function hashFile(file, algo = 'sha1') {
  const h = crypto.createHash(algo);
  const fh = await fs.open(file, 'r');
  try {
    for await (const chunk of fh.createReadStream()) h.update(chunk);
  } finally {
    await fh.close();
  }
  return h.digest('hex');
}

/**
 * Tải một URL ra đĩa, có kiểm tra SHA-1.
 * @param {string} url
 * @param {string} dest
 * @param {{sha1?: string, size?: number, label?: string, retries?: number}} opts
 */
export function downloadFile(url, dest, opts = {}) {
  const label = opts.label || path.basename(dest);
  return enqueue(async () => {
    const attempts = opts.retries ?? 2;
    let lastErr = null;
    for (let i = 0; i <= attempts; i++) {
      try {
        await fs.mkdir(path.dirname(dest), { recursive: true });
        const res = await fetch(url, { redirect: 'follow' });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} cho ${url}`);
        const total = Number(res.headers.get('content-length') || opts.size || 0);
        const tmp = `${dest}.part`;
        const h = crypto.createHash('sha1');
        let done = 0;
        const out = await fs.open(tmp, 'w');
        try {
          const reader = res.body.getReader();
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            h.update(value);
            done += value.byteLength;
            await out.write(value);
            events.emit('progress', { label, url, dest, bytes: done, total, percent: total ? Math.round((done / total) * 100) : null });
          }
        } finally {
          await out.close();
        }
        const actual = h.digest('hex');
        if (opts.sha1 && actual.toLowerCase() !== String(opts.sha1).toLowerCase()) {
          await fs.rm(tmp, { force: true });
          throw new Error(`SHA-1 không khớp (${actual} ≠ ${opts.sha1}) — tệp có thể đã bị can thiệp, đã huỷ tải.`);
        }
        await fs.rename(tmp, dest);
        events.emit('done', { label, url, dest, sha1: actual, bytes: done });
        return { dest, sha1: actual, bytes: done, verified: Boolean(opts.sha1) };
      } catch (err) {
        lastErr = err;
        events.emit('error', { label, url, error: String(err?.message || err), attempt: i + 1 });
        await new Promise((r) => setTimeout(r, 500 * (i + 1)));
      }
    }
    throw lastErr || new Error('Tải thất bại');
  });
}

export async function downloadAll(items, { onProgress } = {}) {
  const results = [];
  if (onProgress) events.on('progress', onProgress);
  try {
    await Promise.all(
      items.map(async (it) => {
        try {
          results.push({ ok: true, ...(await downloadFile(it.url, it.dest, it)) });
        } catch (err) {
          results.push({ ok: false, url: it.url, dest: it.dest, error: String(err?.message || err) });
        }
      })
    );
  } finally {
    if (onProgress) events.off('progress', onProgress);
  }
  return results;
}

export function queueStats() {
  return { queued: queue.length, running, concurrency: CONCURRENCY };
}

/** Tải version json và chuẩn bị danh sách tệp cần tải cho một phiên bản. */
export async function prepareVersion(versionJson, { librariesDir, assetsDir }) {
  const jobs = [];
  const dl = versionJson?.downloads || {};
  if (dl.client?.url) {
    jobs.push({
      url: dl.client.url,
      dest: path.join(Paths.versions, versionJson.id, `${versionJson.id}.jar`),
      sha1: dl.client.sha1,
      size: dl.client.size,
      label: `${versionJson.id}.jar`,
      kind: 'client',
    });
  }
  for (const lib of versionJson.libraries || []) {
    const art = lib.downloads?.artifact;
    if (!art?.url) continue;
    jobs.push({
      url: art.url,
      dest: path.join(librariesDir, art.path),
      sha1: art.sha1,
      size: art.size,
      label: art.path.split('/').pop(),
      kind: 'library',
    });
  }
  return jobs;
}
