/**
 * Zeko API client — mọi lời gọi tới máy chủ cục bộ.
 */
const BASE = '/api';

async function call(pathname, opts = {}) {
  const res = await fetch(BASE + pathname, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* phản hồi rỗng */
  }
  if (!res.ok) {
    const err = new Error(data?.error || `HTTP ${res.status}`);
    err.code = data?.code;
    err.details = data?.details;
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  meta: () => call('/meta'),
  health: () => call('/health'),

  getSettings: () => call('/settings'),
  saveSettings: (patch) => call('/settings', { method: 'PATCH', body: patch }),
  resetSettings: () => call('/settings/reset', { method: 'POST' }),

  versions: (snapshots = false, refresh = false) =>
    call(`/versions?snapshots=${snapshots ? 1 : 0}${refresh ? '&refresh=1' : ''}`),
  version: (id) => call(`/versions/${encodeURIComponent(id)}`),

  instances: () => call('/instances'),
  instance: (id) => call(`/instances/${id}`),
  createInstance: (body) => call('/instances', { method: 'POST', body }),
  updateInstance: (id, body) => call(`/instances/${id}`, { method: 'PATCH', body }),
  deleteInstance: (id, keep = false) => call(`/instances/${id}?keep=${keep ? 1 : 0}`, { method: 'DELETE' }),
  duplicateInstance: (id, name) => call(`/instances/${id}/duplicate`, { method: 'POST', body: { name } }),
  instanceFiles: (id, dir = '.') => call(`/instances/${id}/files?dir=${encodeURIComponent(dir)}`),
  instanceLogs: (id) => call(`/instances/${id}/logs`),
  createSample: (id, kind) => call(`/instances/${id}/files/sample`, { method: 'POST', body: { kind } }),

  presets: () => call('/performance/presets'),
  recommend: () => call('/performance/recommend'),
  mods: () => call('/performance/mods'),
  applyPerf: (instanceId, preset) => call(`/performance/apply/${instanceId}`, { method: 'POST', body: { preset } }),

  system: () => call('/system'),
  benchmark: () => call('/system/benchmark', { method: 'POST' }),
  java: () => call('/system/java'),

  securityStatus: () => call('/security/status'),
  rules: () => call('/security/rules'),
  startScan: (instanceId, autoQuarantine = true) => call('/security/scan', { method: 'POST', body: { instanceId, autoQuarantine } }),
  scanJob: (jobId) => call(`/security/scan/${jobId}`),
  scanFile: (p) => call('/security/scan-file', { method: 'POST', body: { path: p } }),
  verify: (instanceId, mode) => call('/security/verify', { method: 'POST', body: { instanceId, mode } }),
  quarantine: () => call('/security/quarantine'),
  restore: (batch) => call(`/security/quarantine/${batch}/restore`, { method: 'POST' }),
  purge: (batch) => call(`/security/quarantine/${batch}`, { method: 'DELETE' }),

  download: (instanceId) => call('/download', { method: 'POST', body: { instanceId } }),
  launch: (instanceId, profile) => call(`/launch/${instanceId}`, { method: 'POST', body: { profile } }),
  stop: (instanceId) => call(`/stop/${instanceId}`, { method: 'POST' }),
  sessions: () => call('/sessions'),
  console: (instanceId) => call(`/console/${instanceId}`),

  news: () => call('/news'),
};

/* ── SSE ─────────────────────────────────────────────────────── */
export function connectStream(handlers = {}) {
  const es = new EventSource('/api/stream');
  const map = { hello: 'hello', log: 'log', exit: 'exit', download: 'download', 'download-done': 'downloadDone', 'download-error': 'downloadError', metrics: 'metrics' };
  for (const [ev, name] of Object.entries(map)) {
    es.addEventListener(ev, (e) => {
      try {
        handlers[name]?.(JSON.parse(e.data));
      } catch { /* bỏ qua gói lỗi */ }
    });
  }
  es.onerror = () => handlers.error?.();
  return es;
}
