/**
 * Bảng điều khiển Zeko — hero, trạng thái máy, FPS, an toàn, tin tức.
 */
import { api } from '../api.js';
import { escapeHtml, humanTime, timeAgo, ring, FpsChart, toast, verdictChip } from '../ui.js';
import { store, selectedInstance, renderPlaybar, invalidate } from '../main.js';

export async function render(host) {
  host.innerHTML = `
  <div class="grid dash">
    <div class="grid" style="gap:16px">
      ${heroHtml()}
      <div class="grid cols-4" id="stat-strip">
        ${statCard('⚡', 'Hồ sơ hiệu năng', store.settings?.perfProfile || '—', store.recommend?.preset?.name || '')}
        ${statCard('🧊', 'Instance', store.instances.length, store.instances.filter(i => i.launches).length + ' đã từng chơi')}
        ${statCard('🛡️', 'Tệp đang cách ly', store.security?.quarantine?.items ?? 0, store.security?.quarantine?.activeBatches ? `${store.security.quarantine.activeBatches} lô` : 'sạch')}
        ${statCard('🧮', 'Điểm máy (ZPI)', store.benchmark?.index ?? '—', store.benchmark?.tier?.label ?? 'chưa chấm điểm')}
      </div>
      <div class="grid cols-2">
        <div class="card hoverable">
          <div class="card-title"><span class="ico">📈</span> Giám sát FPS <span class="spacer"></span><span class="chip" id="fps-src">mô phỏng</span></div>
          <div class="fps-box">
            <div class="fps-head"><span class="fps-num" id="fps-num">0</span><span class="muted">khung hình/giây</span>
              <span class="spacer grow"></span>
              <span class="chip ok" id="fps-1p">1% low: —</span></div>
            <canvas class="fps-canvas" id="fps-canvas"></canvas>
            <p class="hint">Biểu đồ đọc từ log game (dòng <span class="mono">FPS:</span> của F3) khi game đang chạy; khi chưa chạy, Zeko hiển thị mô phỏng theo hồ sơ hiệu năng để bạn thấy trước mục tiêu.</p>
          </div>
        </div>
        <div class="card hoverable">
          <div class="card-title"><span class="ico">🖥️</span> Hệ thống <span class="spacer"></span><span class="chip" id="sys-tier">—</span></div>
          <div id="sys-body">${sysSkeleton()}</div>
          <div class="row" style="margin-top:12px">
            <button class="btn tiny ghost" id="btn-bench">🧮 Chấm điểm máy</button>
            <button class="btn tiny ghost" id="btn-tune">🎯 Gợi ý tối ưu</button>
          </div>
        </div>
      </div>
    </div>

    <div class="grid" style="gap:16px">
      <div class="card glass hoverable">
        <div class="card-title"><span class="ico">🛡️</span> Trạng thái an toàn</div>
        <div class="row" style="gap:18px;align-items:center">
          ${ring(100 - (store.security?.instances?.reduce((m, i) => Math.max(m, i.riskScore ?? 0), 0) || 0), 100, 'an toàn', 'var(--ok)')}
          <div class="grow">
            <div id="risk-summary">${riskSummary()}</div>
            <div class="row" style="margin-top:10px">
              <button class="btn tiny primary" id="btn-quickscan">Quét nhanh</button>
              <button class="btn tiny ghost" id="btn-goto-sec">Chi tiết</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card hoverable">
        <div class="card-title"><span class="ico">🕘</span> Chơi gần đây</div>
        ${recentHtml()}
      </div>

      <div class="card hoverable">
        <div class="card-title"><span class="ico">📰</span> Tin mới</div>
        ${newsHtml()}
      </div>

      <div class="card hoverable">
        <div class="card-title"><span class="ico">☕</span> Java</div>
        ${javaHtml()}
      </div>
    </div>
  </div>`;

  return {};
}

export function mount(host) {
  // FPS chart
  const canvas = host.querySelector('#fps-canvas');
  const chart = canvas ? new FpsChart(canvas) : null;
  const fpsNum = host.querySelector('#fps-num');
  const fps1p = host.querySelector('#fps-1p');
  const fpsSrc = host.querySelector('#fps-src');
  const samples = [];
  let simTimer = null;
  let logFps = null;

  const inst = selectedInstance();
  const target = { potato: 45, lowend: 90, balanced: 150, ultra: 240 }[inst?.perfProfile || store.settings?.perfProfile || 'lowend'];

  function paint(fps, source) {
    if (!chart) return;
    chart.push(fps);
    fpsNum.textContent = Math.round(fps);
    fpsSrc.textContent = source;
    samples.push(fps);
    if (samples.length > 240) samples.shift();
    const sorted = [...samples].sort((a, b) => a - b);
    fps1p.textContent = `1% low: ${Math.round(sorted[Math.floor(sorted.length * 0.01)] ?? fps)}`;
  }

  function startSim() {
    stopSim();
    simTimer = setInterval(() => {
      if (logFps !== null) return;
      const noise = (Math.random() - 0.5) * target * 0.22;
      paint(Math.max(8, target + noise - Math.random() * 4), 'mô phỏng');
    }, 900);
  }
  function stopSim() { if (simTimer) clearInterval(simTimer); simTimer = null; }
  startSim();

  const onLog = (e) => {
    const m = String(e.detail?.line || '').match(/FPS:\s*(\d+)/);
    if (m) { logFps = Number(m[1]); paint(logFps, 'từ game'); }
  };
  window.addEventListener('zeko:log', onLog);

  // system panel live
  const sysBody = host.querySelector('#sys-body');
  const sysTier = host.querySelector('#sys-tier');
  const paintSys = (m) => {
    if (!m || !sysBody) return;
    sysBody.innerHTML = sysHtml(m);
  };
  const onMetrics = (e) => paintSys(e.detail);
  window.addEventListener('zeko:metrics', onMetrics);

  host.querySelector('#btn-bench').addEventListener('click', async (e) => {
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Đang chấm điểm…';
    try {
      const res = await api.benchmark();
      store.benchmark = res.benchmark;
      invalidate();
      toast(`Điểm máy ZPI: ${res.benchmark.index}/1000 — ${res.benchmark.tier.label}. Đề xuất hồ sơ: ${res.benchmark.suggestedProfile}`, 'ok', 7000);
    } catch (err) { toast(err.message, 'bad'); }
    finally { b.disabled = false; b.textContent = '🧮 Chấm điểm máy'; }
  });

  host.querySelector('#btn-tune').addEventListener('click', async () => {
    const rec = await api.recommend();
    store.recommend = rec;
    toast(rec.reason, 'info', 8000);
    location.hash = '#/performance';
  });

  host.querySelector('#btn-goto-sec').addEventListener('click', () => (location.hash = '#/security'));
  host.querySelector('#btn-quickscan').addEventListener('click', async (e) => {
    const target = selectedInstance();
    if (!target) return toast('Chọn một instance trước đã', 'warn');
    const b = e.currentTarget;
    b.disabled = true; b.textContent = 'Đang quét…';
    try {
      const { jobId } = await api.startScan(target.id, true);
      const report = await pollScan(jobId, (p) => (b.textContent = `Đang quét ${p}%`));
      const threats = report.counts?.threats ?? 0;
      toast(threats ? `Phát hiện ${threats} tệp rủi ro cao — đã cách ly.` : `Sạch! Đã quét ${report.counts?.scanned} tệp, rủi ro ${report.riskScore}/100.`, threats ? 'bad' : 'ok', 7000);
      invalidate();
    } catch (err) { toast(err.message, 'bad'); }
    finally { b.disabled = false; b.textContent = 'Quét nhanh'; }
  });

  host.querySelectorAll('[data-open-instance]').forEach((n) =>
    n.addEventListener('click', () => {
      store.selected = n.dataset.openInstance;
      renderPlaybar();
      location.hash = '#/instances';
      invalidate();
    })
  );

  // dọn dẹp khi rời màn hình
  const obs = new MutationObserver(() => {
    if (!document.body.contains(canvas)) {
      stopSim();
      window.removeEventListener('zeko:log', onLog);
      window.removeEventListener('zeko:metrics', onMetrics);
      obs.disconnect();
    }
  });
  obs.observe(document.getElementById('view-wrap'), { childList: true, subtree: true });

  api.system().then((s) => { paintSys(s); if (sysTier) sysTier.textContent = `${s.cpuCores} nhân · ${s.memory.totalMb} MB RAM`; }).catch(() => {});
}

async function pollScan(jobId, onProgress) {
  for (let i = 0; i < 240; i++) {
    const job = await api.scanJob(jobId);
    onProgress?.(job.progress || 0);
    if (job.state === 'done') return job.report || {};
    await new Promise((r) => setTimeout(r, 420));
  }
  throw new Error('Quét quá lâu');
}

/* ── Mảnh HTML ─────────────────────────────────────────────────── */
function heroHtml() {
  const rec = store.recommend;
  const inst = selectedInstance();
  return `<div class="hero">
    <span class="chip accent" style="width:max-content">⚡ ZEK0 AURORA · v${escapeHtml(store.meta?.app?.version || '1.0')}</span>
    <h2>${escapeHtml(store.settings?.account?.username || 'Zeko Player')}</h2>
    <p>Máy bạn được xếp hạng <b>${escapeHtml(rec?.preset?.name || 'Cân bằng')}</b>. ${inst ? `Instance đang chọn: <b>${escapeHtml(inst.name)}</b> (${escapeHtml(inst.version)}) — bấm <span class="kbd">Space</span> để chơi.` : 'Tạo instance đầu tiên để bắt đầu.'}</p>
    <div class="row">
      <button class="btn primary" data-nav="#/instances">🧊 ${inst ? 'Đổi instance' : 'Tạo instance'}</button>
      <button class="btn ghost" data-nav="#/performance">⚡ Zeko Turbo</button>
      <button class="btn ghost" data-nav="#/security">🛡️ Sentinel</button>
    </div>
  </div>`;
}

function statCard(icon, k, v, d) {
  return `<div class="card hoverable" style="padding:14px 16px">
    <div class="stat"><span class="k">${icon} ${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span><span class="d">${escapeHtml(d || '')}</span></div>
  </div>`;
}

function sysSkeleton() {
  return `<div class="skeleton" style="height:16px;margin-bottom:8px"></div>
  <div class="progress" style="margin-bottom:8px"><i style="width:30%"></i></div>
  <div class="progress" style="margin-bottom:8px"><i style="width:55%"></i></div>
  <div class="skeleton" style="height:14px;width:60%"></div>`;
}

function sysHtml(m) {
  const mem = m.memory || {};
  const disk = m.disk;
  const bar = (label, pct, text) => `<div style="margin-bottom:11px">
    <div class="row between" style="font-size:11.5px;color:var(--text-2)"><span>${label}</span><b class="mono">${text}</b></div>
    <div class="progress" style="height:6px;margin-top:4px"><i style="width:${Math.min(100, pct)}%"></i></div></div>`;
  return `
    <div class="mono muted" style="font-size:11px;margin-bottom:9px">${escapeHtml((m.cpuModel || '').slice(0, 46))}</div>
    ${bar('CPU', m.cpuPercent ?? 0, `${m.cpuPercent ?? '—'}% · ${(m.loadAvg || [0])[0]} load`)}
    ${bar('RAM', mem.percent ?? 0, `${mem.usedMb ?? '—'} / ${mem.totalMb ?? '—'} MB`)}
    ${disk ? bar('Ổ đĩa', disk.percentUsed ?? 0, `còn ${disk.freeGb ?? '—'} / ${disk.totalGb ?? '—'} GB`) : ''}
    <div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px">
      <span class="chip">${escapeHtml(m.platform || '')} ${escapeHtml(m.arch || '')}</span>
      <span class="chip">${m.cpuCores || '—'} nhân</span>
      <span class="chip">uptime ${humanTime(m.uptimeSeconds)}</span>
    </div>`;
}

function riskSummary() {
  const list = store.security?.instances || [];
  const dirty = list.filter((i) => (i.riskScore ?? 0) > 0);
  const q = store.security?.quarantine || { items: 0, batches: 0, bytes: 0 };
  if (!list.length) return `<p class="hint">Chưa có instance nào để quét.</p>`;
  if (!dirty.length && !q.items) return `<p style="font-size:12.5px">Tất cả ${list.length} instance đều <b style="color:var(--ok)">sạch</b> ở lần quét gần nhất.</p>`;
  return `<p style="font-size:12.5px">${dirty.length ? `<b style="color:var(--warn)">${dirty.length}</b> instance có phát hiện. ` : ''}
    ${q.items ? `<b style="color:var(--bad)">${q.items}</b> tệp đang nằm trong vùng cách ly. ` : ''}
    <span class="muted">Luôn có thể khôi phục 1-chạm.</span></p>`;
}

function recentHtml() {
  const list = [...store.instances].filter((i) => i.lastPlayed).sort((a, b) => new Date(b.lastPlayed) - new Date(a.lastPlayed)).slice(0, 5);
  if (!list.length) {
    return `<div class="empty"><div class="big">🕹️</div><b>Chưa có phiên chơi nào</b><span class="hint">Instance bạn chơi sẽ xuất hiện ở đây kèm thời lượng.</span></div>`;
  }
  return `<div class="timeline">${list
    .map(
      (i) => `<div class="tl-item" style="cursor:pointer" data-open-instance="${i.id}">
        <div class="tl-dot">${escapeHtml(i.icon || '🧊')}</div>
        <div><h5>${escapeHtml(i.name)}</h5>
        <p>${escapeHtml(i.version)} · ${timeAgo(i.lastPlayed)} · ${humanTime(i.playTimeSeconds)} · ${i.launches} lượt</p></div>
      </div>`
    )
    .join('')}</div>`;
}

function newsHtml() {
  if (!store.news?.length) return `<p class="hint">Không tải được tin tức (ngoại tuyến).</p>`;
  const kindIcon = { release: '🚀', mod: '🧩', security: '🛡️', tips: '💡' };
  return store.news
    .map(
      (n) => `<a class="news-item" href="${escapeHtml(n.href || '#')}" ${/^https?:/.test(n.href || '') ? 'target="_blank" rel="noopener"' : ''}>
      <div class="news-meta"><span>${kindIcon[n.kind] || '📌'}</span><span>${escapeHtml(n.date || '')}</span></div>
      <h5>${escapeHtml(n.title)}</h5><p>${escapeHtml(n.text)}</p></a>`
    )
    .join('');
}

function javaHtml() {
  const j = store.java;
  if (!j) return `<p class="hint">Đang kiểm tra…</p>`;
  if (!j.installed) {
    return `<div class="notice warn"><span class="ni">☕</span><div><b>Chưa cài Java.</b> Minecraft cần Java 21 (1.20.5+), Java 17 (1.17–1.20.4) hoặc Java 8 (cũ hơn).
      <div class="row" style="margin-top:8px">${j.recommended.map((r) => `<a class="btn tiny ghost" href="${r.url}" target="_blank" rel="noopener">${escapeHtml(r.label)}</a>`).join('')}</div></div></div>`;
  }
  return `<div class="grid" style="gap:8px">${j.runtimes
    .map((r) => `<div class="row between"><span class="mono">${escapeHtml(r.path)}</span><span class="chip ok">Java ${r.major}</span></div>`)
    .join('')}
    ${j.missing.length ? `<div class="notice" style="margin-top:6px"><span class="ni">💡</span><div>Còn thiếu: ${j.missing.map((m) => `<b>Java ${m}</b>`).join(', ')} — cần cho một số phiên bản Minecraft.</div></div>` : ''}
  </div>`;
}

