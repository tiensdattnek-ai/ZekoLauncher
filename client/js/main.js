/**
 * Zeko Launcher — entry point, router, trạng thái toàn cục, nền động.
 */
import { api, connectStream } from './api.js';
import { toast, escapeHtml, openModal, confirmModal } from './ui.js';
import { setLang, toggleLang, getLang } from './i18n.js';
import * as Dashboard from './views/dashboard.js';
import * as InstancesView from './views/instances.js';
import * as Performance from './views/performance.js';
import * as Security from './views/security.js';
import * as Console from './views/console.js';
import * as Downloads from './views/downloads.js';
import * as Settings from './views/settings.js';
import * as About from './views/about.js';

export const store = {
  meta: null,
  settings: null,
  instances: [],
  catalog: null,
  presets: null,
  recommend: null,
  java: null,
  sessions: [],
  security: null,
  news: [],
  selected: null,
  metrics: null,
  downloads: [],
  streamOk: false,
};

const VIEWS = {
  dashboard: { title: 'Bảng điều khiển', sub: 'Tổng quan hệ thống và phiên chơi gần nhất', mod: Dashboard },
  instances: { title: 'Instance', sub: 'Quản lý các hồ sơ game, mod, gói tài nguyên', mod: InstancesView },
  performance: { title: 'Zeko Turbo', sub: 'Hồ sơ tối ưu FPS theo phần cứng thật của máy bạn', mod: Performance },
  security: { title: 'Zeko Sentinel', sub: 'Kiểm tra toàn vẹn & phát hiện tệp đáng ngờ trong thư mục game', mod: Security },
  console: { title: 'Console', sub: 'Log thời gian thực của game và của launcher', mod: Console },
  downloads: { title: 'Tải xuống', sub: 'Hàng đợi tải tệp game có kiểm tra SHA-1', mod: Downloads },
  settings: { title: 'Cài đặt', sub: 'Giao diện, tài khoản, Java, RAM, bảo mật', mod: Settings },
  about: { title: 'Giới thiệu', sub: 'Zeko Launcher — bản dựng, giấy phép và lộ trình', mod: About },
};

let currentView = null; // null = chưa render lần nào → route() đầu tiên luôn render
const viewWrap = () => document.getElementById('view-wrap');

/* ── ROUTER ────────────────────────────────────────────────────── */
function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [name, param] = hash.split('/');
  const view = VIEWS[name] ? name : 'dashboard';
  if (view !== currentView || viewWrap().dataset.dirty === '1') render(view, param);
  else if (param) VIEWS[view].mod.param?.(param);
}

export async function render(view, param) {
  currentView = view;
  const def = VIEWS[view];
  document.getElementById('view-title').textContent = def.title;
  document.getElementById('view-sub').textContent = def.sub;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.view === view));
  document.body.classList.remove('nav-open');

  const wrap = viewWrap();
  wrap.innerHTML = '';
  wrap.dataset.dirty = '0';
  const host = document.createElement('div');
  host.className = 'view';
  wrap.appendChild(host);
  wrap.scrollTop = 0;
  try {
    const api2 = await def.mod.render(host, { param, state: store });
    def.mod.mount?.(host, api2, { param, state: store });
  } catch (err) {
    host.innerHTML = `<div class="notice bad"><span class="ni">⛔</span><div><b>Không tải được màn hình này.</b><br>${escapeHtml(err?.message || err)}</div></div>`;
  }
}

export const invalidate = () => {
  viewWrap().dataset.dirty = '1';
  render(currentView);
};

/* ── DỮ LIỆU ───────────────────────────────────────────────────── */
export async function refreshAll() {
  const [meta, instances, presets, recommend, java, security, sessions, news] = await Promise.allSettled([
    api.meta(), api.instances(), api.presets(), api.recommend(), api.java(), api.securityStatus(), api.sessions(), api.news(),
  ]);
  if (meta.status === 'fulfilled') {
    store.meta = meta.value;
    store.settings = meta.value.settings;
    store.catalog = meta.value.catalog;
    applyAppearance(store.settings);
    document.getElementById('app-version').textContent = meta.value.app.version;
    document.getElementById('brand-codename').textContent = meta.value.app.codename;
    setNetPill(meta.value.catalog);
  }
  if (instances.status === 'fulfilled') store.instances = instances.value.instances;
  if (presets.status === 'fulfilled') store.presets = presets.value;
  if (recommend.status === 'fulfilled') store.recommend = recommend.value;
  if (java.status === 'fulfilled') store.java = java.value;
  if (security.status === 'fulfilled') store.security = security.value;
  if (sessions.status === 'fulfilled') store.sessions = sessions.value.sessions;
  if (news.status === 'fulfilled') store.news = news.value.items;

  if (!store.selected && store.instances.length) store.selected = store.instances[0].id;
  updateBadges();
  renderPlaybar();
}

function setNetPill(catalog) {
  const pill = document.getElementById('net-pill');
  const map = { live: ['ok', 'Danh mục: trực tuyến'], cache: ['warn', 'Danh mục: bộ nhớ đệm'], embedded: ['bad', 'Danh mục: ngoại tuyến'] };
  const [cls, text] = map[catalog?.source] || ['', 'đang kiểm tra…'];
  pill.className = `net-pill ${cls}`;
  pill.title = catalog?.error ? `${text} — ${catalog.error}` : text;
  pill.querySelector('span').textContent = text;
}

function updateBadges() {
  document.getElementById('badge-instances').textContent = store.instances.length;
  const threats = store.security?.quarantine?.items || 0;
  const badge = document.getElementById('badge-threats');
  badge.hidden = threats === 0;
  badge.textContent = threats;
}

export function applyAppearance(settings) {
  const html = document.documentElement;
  html.dataset.theme = settings?.theme || 'violet';
  html.dataset.effects = settings?.effects || 'balanced';
  document.getElementById('avatar').textContent = (settings?.account?.username || 'Z')[0].toUpperCase();
  startBackground(html.dataset.effects !== 'off');
}

/* ── THANH CHƠI ────────────────────────────────────────────────── */
export function selectedInstance() {
  return store.instances.find((i) => i.id === store.selected) || null;
}

export function renderPlaybar() {
  const bar = document.getElementById('playbar');
  const inst = selectedInstance();
  if (!inst) {
    bar.hidden = true;
    return;
  }
  bar.hidden = false;
  document.getElementById('playbar-art').textContent = inst.icon || '🧊';
  document.getElementById('playbar-name').textContent = inst.name;
  const session = store.sessions.find((s) => s.instanceId === inst.id);
  const running = session && session.state !== 'exited';
  document.getElementById('playbar-meta').innerHTML = running
    ? `<span class="chip ok">● Đang chạy</span> ${escapeHtml(inst.version)} · ${escapeHtml(inst.loader || 'vanilla')} · ${session.pid ? 'PID ' + session.pid : ''}`
    : `${escapeHtml(inst.version)} · ${escapeHtml(inst.loader || 'vanilla')} · ${inst.stats?.modCount || 0} mod · ${inst.stats?.sizeHuman || '0 B'}`;

  const profileSel = document.getElementById('playbar-profile');
  if (store.presets && profileSel.dataset.filled !== '1') {
    profileSel.innerHTML = store.presets.presets.map((p) => `<option value="${p.id}">${p.icon} ${escapeHtml(p.name)}</option>`).join('');
    profileSel.dataset.filled = '1';
  }
  profileSel.value = inst.perfProfile || store.settings?.perfProfile || 'lowend';

  const btn = document.getElementById('btn-play');
  const stop = document.getElementById('btn-stop');
  btn.disabled = false;
  document.getElementById('btn-play-text').textContent = running ? 'ĐANG CHƠI' : 'CHƠI';
  stop.hidden = !running;
}

async function play() {
  const inst = selectedInstance();
  if (!inst) {
    toast('Hãy chọn hoặc tạo một instance trước đã.', 'warn');
    location.hash = '#/instances';
    return;
  }
  const profile = document.getElementById('playbar-profile').value;
  const btn = document.getElementById('btn-play');
  const label = document.getElementById('btn-play-text');
  btn.disabled = true;
  label.textContent = 'ĐANG KHỞI ĐỘNG…';
  const bar = document.getElementById('playbar-progress');
  bar.hidden = false;
  bar.classList.add('indeterminate');
  bar.querySelector('span').textContent = 'Sentinel đang quét tệp & dựng lệnh khởi động…';
  try {
    const res = await api.launch(inst.id, profile);
    toast(`Đã khởi động "${inst.name}" · hồ sơ ${res.preset} · RAM ${res.ram.minMb}–${res.ram.maxMb} MB`, 'ok');
    if (res.scanSummary) {
      bar.querySelector('span').textContent = `🛡 Đã quét ${res.scanSummary.scanned} tệp · rủi ro ${res.scanSummary.riskScore}/100`;
    }
    store.sessions = (await api.sessions()).sessions;
    renderPlaybar();
    invalidate();
  } catch (err) {
    if (err.code === 'ZEKO_BLOCKED_BY_SENTINEL') {
      toast('Sentinel đã CHẶN khởi động vì phát hiện tệp rủi ro cao.', 'bad', 7000);
      openBlockedModal(err.details?.scan || err.scan);
    } else if (err.code === 'ZEKO_NOT_READY') {
      openNotReadyModal(inst, err.details || {});
    } else {
      toast(`Không khởi động được: ${err.message}`, 'bad', 7000);
    }
  } finally {
    setTimeout(() => {
      bar.classList.remove('indeterminate');
      btn.disabled = false;
      label.textContent = 'CHƠI';
      setTimeout(() => (bar.hidden = true), 6000);
    }, 900);
  }
}

function openBlockedModal(scan) {
  const rows = (scan?.threats || [])
    .map(
      (t) => `<div class="threat-row threat">
        <div><div class="threat-file">${escapeHtml(t.file)}</div>
        <div class="reasons">${(t.reasons || []).map((r) => `<div class="reason"><b>${escapeHtml(r.name)}</b> · ${escapeHtml(r.detail || '')}</div>`).join('')}</div></div>
        <div>${t.score}</div></div>`
    )
    .join('');
  openModal(`<h3>🛡 Zeko Sentinel đã chặn lượt chơi</h3>
    <p class="modal-sub">Điểm rủi ro ${scan?.riskScore ?? '—'}/100. Những tệp sau bị coi là nguy hiểm và đã được cách ly.</p>
    ${rows || '<p class="muted">Không có chi tiết.</p>'}
    <div class="modal-foot"><button class="btn ghost" data-close>Đóng</button>
    <button class="btn primary" id="go-sec">Mở Zeko Sentinel</button></div>`, {
    onMount(box, close) {
      box.querySelector('#go-sec').onclick = () => { close(); location.hash = '#/security'; };
    },
  });
}

function openNotReadyModal(inst, details) {
  const problems = details.problems || [];
  openModal(`<h3>Chưa thể khởi động "${escapeHtml(inst.name)}"</h3>
    <p class="modal-sub">Zeko đã kiểm tra và thấy còn thiếu vài thứ. Đây là danh sách và cách xử lý.</p>
    <div class="grid" style="gap:10px">
      ${problems.map((p) => `<div class="notice warn"><span class="ni">⚠️</span><div>${escapeHtml(p)}</div></div>`).join('')}
      <div class="notice"><span class="ni">💡</span><div>Minecraft cần <b>Java thật</b> trên máy và <b>tệp game đã tải</b>. Trong môi trường xem trước trực tuyến này thường không có Java — bạn vẫn xem được toàn bộ lệnh mà Zeko sẽ chạy.</div></div>
    </div>
    <h4 style="margin:16px 0 6px">Lệnh khởi động Zeko đã dựng</h4>
    <div class="console" style="max-height:180px">${escapeHtml(details.command || '(không dựng được lệnh)')}</div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>Đóng</button>
      <button class="btn" id="copy-cmd">Chép lệnh</button>
      <button class="btn primary" id="go-perf">Mở Zeko Turbo</button>
    </div>`, {
    wide: true,
    onMount(box, close) {
      box.querySelector('#copy-cmd').onclick = async () => {
        try { await navigator.clipboard.writeText(details.command || ''); toast('Đã chép lệnh khởi động', 'ok'); }
        catch { toast('Trình duyệt chặn clipboard', 'warn'); }
      };
      box.querySelector('#go-perf').onclick = () => { close(); location.hash = '#/performance'; };
    },
  });
}

/* ── NỀN ĐỘNG (canvas, tắt được) ───────────────────────────────── */
let bgRaf = null;
function startBackground(enabled) {
  const c = document.getElementById('bg');
  if (!c) return;
  cancelAnimationFrame(bgRaf);
  if (!enabled) {
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, c.width, c.height);
    return;
  }
  const full = document.documentElement.dataset.effects === 'full';
  const count = full ? 54 : 26;
  const dpr = Math.min(window.devicePixelRatio || 1, 1.6);
  let w = 0; let h = 0;
  const parts = [];
  const ctx = c.getContext('2d');

  function resize() {
    w = c.clientWidth; h = c.clientHeight;
    c.width = Math.max(1, w * dpr); c.height = Math.max(1, h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < count; i++) {
    parts.push({
      x: Math.random() * w, y: Math.random() * h,
      r: Math.random() * 1.9 + 0.5,
      vx: (Math.random() - 0.5) * 0.14, vy: -(Math.random() * 0.16 + 0.03),
      a: Math.random() * 0.5 + 0.12,
      hue: Math.random() < 0.5 ? 'var(--accent)' : 'var(--accent-2)',
    });
  }

  const tick = () => {
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy;
      if (p.y < -8) { p.y = h + 8; p.x = Math.random() * w; }
      if (p.x < -8) p.x = w + 8;
      if (p.x > w + 8) p.x = -8;
      ctx.globalAlpha = p.a;
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(p.hue.includes('accent-2') ? '--accent-2' : '--accent').trim() || '#8b5cf6';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    bgRaf = requestAnimationFrame(tick);
  };
  tick();
}

/* ── STREAM (SSE) ──────────────────────────────────────────────── */
function startStream() {
  connectStream({
    metrics(m) {
      store.metrics = m;
      const cpu = document.getElementById('mini-cpu');
      const ram = document.getElementById('mini-ram');
      if (cpu && m.cpuPercent !== null) {
        cpu.style.width = `${Math.min(100, m.cpuPercent)}%`;
        document.getElementById('mini-cpu-txt').textContent = `${m.cpuPercent}%`;
      }
      if (ram && m.memory) {
        ram.style.width = `${m.memory.percent}%`;
        document.getElementById('mini-ram-txt').textContent = `${m.memory.percent}%`;
      }
      window.dispatchEvent(new CustomEvent('zeko:metrics', { detail: m }));
    },
    log(d) {
      window.dispatchEvent(new CustomEvent('zeko:log', { detail: d }));
    },
    async exit(d) {
      toast(`Game đã đóng (mã ${d.code ?? d.signal ?? 0}) sau ${d.uptimeSeconds ?? 0}s`, 'info');
      store.sessions = (await api.sessions().catch(() => ({ sessions: [] }))).sessions;
      await refreshAll().catch(() => {});
      renderPlaybar();
    },
    download(d) {
      window.dispatchEvent(new CustomEvent('zeko:download', { detail: d }));
      const bar = document.getElementById('playbar-progress');
      if (bar && !bar.hidden) {
        bar.classList.remove('indeterminate');
        if (d.percent !== null) bar.querySelector('i').style.width = `${d.percent}%`;
        bar.querySelector('span').textContent = `Đang tải ${d.label} ${d.percent ?? ''}%`;
      }
    },
    downloadDone(d) {
      window.dispatchEvent(new CustomEvent('zeko:download-done', { detail: d }));
    },
    downloadError(d) {
      window.dispatchEvent(new CustomEvent('zeko:download-error', { detail: d }));
    },
    hello() { store.streamOk = true; },
    error() { store.streamOk = false; },
  });
}

/* ── KHỞI ĐỘNG ─────────────────────────────────────────────────── */
const bootMsg = (t) => { const n = document.getElementById('boot-msg'); if (n) n.textContent = t; };
const bootErrors = [];

/**
 * Khởi động: KHÔNG BAO GIỜ để lỗi mạng/API làm trắng giao diện.
 * Mọi bước nạp dữ liệu đều được bọc lỗi riêng — thiếu gì thì UI hiện
 * chỗ trống kèm cách khắc phục, chứ không bỏ trống cả màn hình.
 */
async function boot() {
  const safe = async (label, fn) => {
    try {
      return await fn();
    } catch (err) {
      console.warn(`[zeko] ${label}:`, err?.message || err);
      bootErrors.push(`${label}: ${err?.message || err}`);
      return null;
    }
  };

  bootMsg('Đang đọc cấu hình và danh mục phiên bản…');
  await safe('nạp dữ liệu', refreshAll);
  bootMsg('Đang kết nối kênh thời gian thực…');
  safe('kết nối SSE', async () => startStream());
  if (bootErrors.length) {
    setTimeout(() => toast(`Không kết nối được máy chủ Zeko (${bootErrors[0]}). Giao diện vẫn chạy ở chế độ giới hạn.`, 'bad', 12000), 900);
  }

  // sự kiện UI cố định — bọc try để một phần tử thiếu không chặn cả UI
  try { wireUi(); } catch (err) { console.warn('[zeko] wireUi:', err); }
  window.addEventListener('hashchange', route);
  document.getElementById('app').hidden = false;
  requestAnimationFrame(() => document.getElementById('boot').classList.add('hide'));
  setTimeout(() => document.getElementById('boot')?.remove(), 700);
  route();
  setTimeout(softReminders, 2600);
}

function wireUi() {
  // Điều hướng khai báo bằng data-nav (dùng ở hero của bảng điều khiển)
  document.addEventListener('click', (e) => {
    const n = e.target.closest('[data-nav]');
    if (n) location.hash = n.dataset.nav;
  });
  document.getElementById('btn-play').addEventListener('click', play);
  document.getElementById('btn-stop').addEventListener('click', async () => {
    const inst = selectedInstance();
    if (!inst) return;
    confirmModal({ title: 'Dừng game?', text: `Tiến trình của "${escapeHtml(inst.name)}" sẽ bị kết thúc. Thế giới đã lưu vẫn an toàn.`, confirmText: 'Dừng game', danger: true,
      onConfirm: async () => { await api.stop(inst.id); toast('Đã gửi lệnh dừng', 'warn'); } });
  });
  document.getElementById('playbar-profile').addEventListener('change', async (e) => {
    const inst = selectedInstance();
    if (!inst) return;
    await api.applyPerf(inst.id, e.target.value);
    store.instances = (await api.instances()).instances;
    toast(`Đã áp dụng hồ sơ hiệu năng "${e.target.selectedOptions[0]?.textContent}" và ghi options.txt`, 'ok');
  });
  document.getElementById('menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  document.getElementById('sidebar-close').addEventListener('click', () => document.body.classList.remove('nav-open'));
  document.getElementById('btn-lang').addEventListener('click', (e) => {
    const l = toggleLang();
    e.target.textContent = l.toUpperCase();
    toast(l === 'vi' ? 'Đã chuyển sang Tiếng Việt' : 'Switched to English', 'info', 2000);
  });
  document.getElementById('btn-effects').addEventListener('click', async () => {
    const order = ['off', 'balanced', 'full'];
    const cur = store.settings?.effects || 'balanced';
    const next = order[(order.indexOf(cur) + 1) % order.length];
    store.settings = (await api.saveSettings({ effects: next })).settings;
    applyAppearance(store.settings);
    toast(`Hiệu ứng nền: ${next === 'off' ? 'TẮT (nhẹ máy nhất)' : next === 'balanced' ? 'cân bằng' : 'đầy đủ'}`, 'info', 2400);
  });
  document.getElementById('avatar').addEventListener('click', () => (location.hash = '#/settings'));
  document.getElementById('playbar-art').addEventListener('click', () => (location.hash = '#/instances'));
  document.querySelectorAll('.nav-item').forEach((n) => n.addEventListener('click', () => document.body.classList.remove('nav-open')));
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea, select')) return;
    if (e.code === 'Space' && !document.getElementById('playbar').hidden) { e.preventDefault(); play(); }
    if (e.key === '/' && e.ctrlKey) { e.preventDefault(); location.hash = '#/instances'; }
  });

}

/** Nhắc nhẹ sau khi UI đã hiện — không bao giờ chặn khởi động. */
async function softReminders() {
  try {
    const rec = store.recommend || (store.recommend = await api.recommend());
    const cur = store.settings?.perfProfile;
    const order = ['potato', 'lowend', 'balanced', 'ultra'];
    if (rec?.preset && cur && order.indexOf(cur) > order.indexOf(rec.preset.id)) {
      toast(`Máy bạn hợp với hồ sơ "${rec.preset.name}" hơn. Vào Zeko Turbo để đổi nhé.`, 'warn', 9000);
    }
    if (store.java && !store.java.installed) {
      toast('Chưa tìm thấy Java trên máy — Minecraft sẽ không chạy được. Xem Zeko Turbo → mục Java để tải đúng bản.', 'warn', 13000);
    }
  } catch { /* bỏ qua */ }
}

boot();
