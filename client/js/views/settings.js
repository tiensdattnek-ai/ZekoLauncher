/**
 * Cài đặt — giao diện, tài khoản, Java, RAM, cửa sổ, bảo mật, dữ liệu.
 */
import { api } from '../api.js';
import { escapeHtml, toast, confirmModal, openModal, humanSize } from '../ui.js';
import { store, applyAppearance, invalidate } from '../main.js';

const THEMES = [
  { id: 'violet', name: 'Zeko Violet', c1: '#8b5cf6', c2: '#22d3ee' },
  { id: 'emerald', name: 'Emerald', c1: '#10b981', c2: '#a3e635' },
  { id: 'sunset', name: 'Sunset', c1: '#fb7185', c2: '#fbbf24' },
  { id: 'ocean', name: 'Ocean', c1: '#3b82f6', c2: '#06b6d4' },
  { id: 'cyber', name: 'Cyberpunk', c1: '#ff00ff', c2: '#00ffff' },
  { id: 'mono', name: 'Mono (nhẹ nhất)', c1: '#e5e7eb', c2: '#9ca3af' },
];

export async function render(host) {
  const s = store.settings || (await api.getSettings()).settings;
  store.settings = s;
  const rec = store.recommend;

  host.innerHTML = `
  <div class="grid cols-2" style="align-items:start">
    <div class="grid" style="gap:16px">
      <div class="card">
        <div class="card-title"><span class="ico">🎨</span> Giao diện</div>
        <label class="field" style="margin-bottom:14px"><b>Chủ đề màu</b>
          <div class="row" id="themes" style="gap:9px">
            ${THEMES.map((t) => `<button class="theme-dot ${t.id === s.theme ? 'on' : ''}" data-theme-id="${t.id}" title="${escapeHtml(t.name)}"
              style="width:38px;height:38px;border-radius:12px;border:2px solid ${t.id === s.theme ? '#fff' : 'var(--line)'};cursor:pointer;
              background:linear-gradient(135deg,${t.c1},${t.c2})"></button>`).join('')}
          </div></label>
        <label class="field"><b>Hiệu ứng nền</b>
          <select class="select" data-k="effects">
            <option value="off" ${s.effects === 'off' ? 'selected' : ''}>Tắt — nhẹ máy nhất (khuyên dùng cho máy yếu)</option>
            <option value="balanced" ${s.effects === 'balanced' ? 'selected' : ''}>Cân bằng — nền mờ + hạt nhẹ</option>
            <option value="full" ${s.effects === 'full' ? 'selected' : ''}>Đầy đủ — hạt, ánh sáng, hiệu ứng nút</option>
          </select>
          <span class="hint">Tắt hiệu ứng giúp giảm tải GPU/CPU khi launcher mở nền.</span></label>
        <div class="switch"><div><div class="t">Ngôn ngữ</div><div class="d">Tiếng Việt / English</div></div>
          <button class="btn tiny ghost" id="btn-lang2">${s.language === 'en' ? 'English' : 'Tiếng Việt'}</button></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">👤</span> Tài khoản</div>
        <div class="notice" style="margin-bottom:12px"><span class="ni">💡</span><div>Zeko đang chạy ở chế độ <b>offline</b>: tên người chơi chỉ dùng để tạo UUID ngoại tuyến. Đăng nhập Microsoft thật cần thêm module xác thực (xem <span class="mono">docs/ARCHITECTURE.md</span>).</div></div>
        <div class="grid cols-2" style="gap:12px">
          <label class="field"><b>Tên người chơi</b><input class="input" data-k="username" value="${escapeHtml(s.account?.username || '')}" maxlength="16" /></label>
          <label class="field"><b>UUID (để trống = tự sinh)</b><input class="input" data-k="uuid" value="${escapeHtml(s.account?.uuid || '')}" placeholder="tự động" /></label>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">☕</span> Java & bộ nhớ</div>
        <label class="field" style="margin-bottom:12px"><b>Đường dẫn Java (để trống = tự tìm)</b>
          <input class="input mono" data-k="javaPath" value="${escapeHtml(s.java?.path || '')}" placeholder="VD: C:\\Program Files\\Eclipse Adoptium\\jdk-21\\bin\\java.exe" /></label>
        <div class="grid cols-2" style="gap:12px">
          <label class="field"><b>RAM tối thiểu (MB)</b><input class="input" type="number" step="256" data-k="ramMin" value="${s.ram?.minMb ?? 2048}" /></label>
          <label class="field"><b>RAM tối đa (MB)</b><input class="input" type="number" step="256" data-k="ramMax" value="${s.ram?.maxMb ?? 4096}" /></label>
        </div>
        <span class="hint">Máy bạn có ${Math.round((rec?.totalMb || s.system?.totalRamMb || 0) / 1024)} GB RAM · Zeko khuyên tối đa <b>${rec?.maxMb || s.system?.recommendedMaxRamMb} MB</b> cho game.</span>
        <label class="field" style="margin-top:12px"><b>JVM args bổ sung (mỗi dòng một tham số)</b>
          <textarea class="input" data-k="javaArgs">${(s.java?.args || []).join('\n')}</textarea></label>
        <div class="row" style="margin-top:10px;gap:8px">
          <button class="btn tiny ghost" id="btn-detect-java">↻ Tìm lại JVM</button>
          <button class="btn tiny ghost" id="btn-show-java">Xem JVM đã tìm thấy</button>
        </div>
      </div>
    </div>

    <div class="grid" style="gap:16px">
      <div class="card">
        <div class="card-title"><span class="ico">🚀</span> Khởi động</div>
        <label class="field" style="margin-bottom:12px"><b>Hồ sơ hiệu năng mặc định</b>
          <select class="select" data-k="perfProfile">
            ${(store.presets?.presets || []).map((p) => `<option value="${p.id}" ${p.id === s.perfProfile ? 'selected' : ''}>${p.icon} ${escapeHtml(p.name)}</option>`).join('')}
          </select></label>
        <div class="grid cols-2" style="gap:12px">
          <label class="field"><b>Chiều rộng cửa sổ</b><input class="input" type="number" data-k="winW" value="${s.window?.width || 1280}" /></label>
          <label class="field"><b>Chiều cao</b><input class="input" type="number" data-k="winH" value="${s.window?.height || 720}" /></label>
        </div>
        <div class="switch"><div><div class="t">Toàn màn hình</div><div class="d">Vào game là fullscreen</div></div><div class="toggle ${s.window?.fullscreen ? 'on' : ''}" data-t="fullscreen"><i></i></div></div>
        <div class="switch"><div><div class="t">Tự tối ưu theo máy (Auto-Tune)</div><div class="d">Zeko tự gợi ý hạ RAM/render distance khi máy quá tải</div></div><div class="toggle ${s.perfAutoTune ? 'on' : ''}" data-t="perfAutoTune"><i></i></div></div>
        <div class="switch"><div><div class="t">Đóng launcher khi vào game</div><div class="d">Giải phóng RAM cho máy yếu</div></div><div class="toggle ${s.launch?.closeLauncher ? 'on' : ''}" data-t="closeLauncher"><i></i></div></div>
        <div class="switch"><div><div class="t">Hiện snapshot trong danh sách phiên bản</div><div class="d">Bản thử nghiệm, có thể lỗi</div></div><div class="toggle ${s.launch?.showSnapshots ? 'on' : ''}" data-t="showSnapshots"><i></i></div></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">🛡️</span> Bảo mật (Zeko Sentinel)</div>
        <div class="switch"><div><div class="t">Tự quét trước khi chơi</div><div class="d">Thêm 1–3 giây, đổi lại an tâm</div></div><div class="toggle ${s.security?.autoScanOnLaunch ? 'on' : ''}" data-s="autoScanOnLaunch"><i></i></div></div>
        <div class="switch"><div><div class="t">Chặn khởi động khi có mối đe doạ</div><div class="d">Tệp bị giữ ở vùng cách ly, khôi phục được</div></div><div class="toggle ${s.security?.blockOnThreat ? 'on' : ''}" data-s="blockOnThreat"><i></i></div></div>
        <div class="switch"><div><div class="t">Quét sâu bên trong JAR</div><div class="d">Đọc class/script trong gói để tìm payload</div></div><div class="toggle ${s.security?.deepScan ? 'on' : ''}" data-s="deepScan"><i></i></div></div>
        <div class="switch"><div><div class="t">Kiểm SHA-1 khi tải</div><div class="d">Huỷ tải nếu tệp không khớp chữ ký Mojang</div></div><div class="toggle ${s.security?.scanOnDownload ? 'on' : ''}" data-s="scanOnDownload"><i></i></div></div>
        <div class="notice warn" style="margin-top:12px"><span class="ni">⚠️</span><div>Sentinel bảo vệ <b>thư mục game</b>. Nó không quét toàn bộ ổ đĩa và không thay thế phần mềm diệt virus hệ thống.</div></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">🗄️</span> Dữ liệu & nguy hiểm</div>
        <table class="table" style="margin-bottom:12px"><tbody>
          ${[['Gốc dữ liệu', s.system ? store.meta?.paths?.root : ''], ['Số instance', store.instances.length], ['Tệp cách ly', store.security?.quarantine?.items ?? 0]]
            .map(([k, v]) => `<tr><td style="color:var(--text-3);width:120px">${escapeHtml(k)}</td><td class="mono" style="font-size:11px;word-break:break-all">${escapeHtml(String(v ?? ''))}</td></tr>`).join('')}
        </tbody></table>
        <div class="row" style="gap:8px">
          <button class="btn ghost tiny" id="btn-export">⤓ Xuất cấu hình</button>
          <button class="btn ghost tiny" id="btn-refresh-catalog">↻ Đồng bộ danh mục phiên bản</button>
          <button class="btn danger tiny" id="btn-reset">↺ Đặt lại cài đặt</button>
        </div>
      </div>
    </div>
  </div>

  <div class="row end" style="position:sticky;bottom:0;padding:14px 0 4px;margin-top:8px;background:linear-gradient(180deg,transparent,var(--bg) 40%)">
    <span class="hint grow" id="save-hint">Thay đổi được lưu tự động khi bạn chỉnh.</span>
    <button class="btn primary" id="btn-save">💾 Lưu tất cả</button>
  </div>`;
  return {};
}

export function mount(host) {
  const patch = {};
  const setNested = (pathStr, value) => {
    const keys = pathStr.split('.');
    let o = patch;
    for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]] ??= {};
    o[keys.at(-1)] = value;
  };

  const collect = () => {
    const get = (k) => host.querySelector(`[data-k="${k}"]`)?.value;
    setNested('account.username', get('username'));
    if (get('uuid')) setNested('account.uuid', get('uuid'));
    setNested('java.path', get('javaPath') || null);
    setNested('java.args', (get('javaArgs') || '').split('\n').map((x) => x.trim()).filter(Boolean));
    setNested('ram.minMb', Number(get('ramMin')) || 2048);
    setNested('ram.maxMb', Number(get('ramMax')) || 4096);
    setNested('window.width', Number(get('winW')) || 1280);
    setNested('window.height', Number(get('winH')) || 720);
    setNested('theme', document.documentElement.dataset.theme);
    setNested('effects', get('effects'));
    setNested('perfProfile', get('perfProfile'));
  };

  const save = async (silent = false) => {
    collect();
    for (const [k, v] of Object.entries(toggles)) setNested(k, v);
    const res = await api.saveSettings(patch);
    store.settings = res.settings;
    applyAppearance(res.settings);
    if (!silent) toast('Đã lưu cài đặt', 'ok', 2000);
    const hint = host.querySelector('#save-hint');
    if (hint) { hint.textContent = `Đã lưu lúc ${new Date().toLocaleTimeString('vi-VN')}`; setTimeout(() => (hint.textContent = 'Thay đổi được lưu tự động khi bạn chỉnh.'), 2600); }
  };

  const toggles = {};
  host.querySelectorAll('[data-t]').forEach((tg) => {
    const map = { fullscreen: 'window.fullscreen', perfAutoTune: 'perfAutoTune', closeLauncher: 'launch.closeLauncher', showSnapshots: 'launch.showSnapshots' };
    tg.onclick = () => { tg.classList.toggle('on'); toggles[map[tg.dataset.t]] = tg.classList.contains('on'); save(true); };
  });
  host.querySelectorAll('[data-s]').forEach((tg) => {
    tg.onclick = () => { tg.classList.toggle('on'); setNested(`security.${tg.dataset.s}`, tg.classList.contains('on')); save(true); };
  });

  host.querySelectorAll('[data-theme-id]').forEach((b) => {
    b.onclick = async () => {
      host.querySelectorAll('[data-theme-id]').forEach((x) => { x.classList.remove('on'); x.style.borderColor = 'var(--line)'; });
      b.classList.add('on'); b.style.borderColor = '#fff';
      document.documentElement.dataset.theme = b.dataset.themeId;
      await save(true);
      toast(`Chủ đề: ${THEMES.find((t) => t.id === b.dataset.themeId)?.name}`, 'ok', 1800);
    };
  });

  host.querySelectorAll('[data-k]').forEach((n) => { n.onchange = () => save(true); });
  host.querySelector('#btn-save').onclick = () => save();
  host.querySelector('#btn-lang2').onclick = async () => {
    const next = store.settings.language === 'vi' ? 'en' : 'vi';
    await api.saveSettings({ language: next });
    location.reload();
  };

  host.querySelector('#btn-detect-java').onclick = async () => {
    store.java = await api.java();
    toast(store.java.installed ? `Tìm thấy ${store.java.runtimes.length} JVM trên máy` : 'Không tìm thấy Java nào', store.java.installed ? 'ok' : 'warn');
    invalidate();
  };

  host.querySelector('#btn-show-java').onclick = async () => {
    const j = store.java || (store.java = await api.java());
    openModal(`<h3>☕ JVM trên máy bạn</h3><p class="modal-sub">Zeko tự chọn bản Java phù hợp với từng phiên bản Minecraft.</p>
      ${j.installed ? `<table class="table"><thead><tr><th>Đường dẫn</th><th>Phiên bản</th><th>Nhà cung cấp</th></tr></thead><tbody>
        ${j.runtimes.map((r) => `<tr><td class="mono" style="font-size:11px;word-break:break-all">${escapeHtml(r.path)}</td><td><span class="chip ok">Java ${r.major}</span></td><td class="muted">${escapeHtml(r.vendor)}${r.managed ? ' · Zeko quản lý' : ''}</td></tr>`).join('')}
      </tbody></table>` : '<div class="notice warn"><span class="ni">☕</span><div>Chưa có Java. Tải Temurin (Adoptium) là lựa chọn tốt nhất cho Minecraft.</div></div>'}
      <div class="sep"></div>
      <table class="table"><thead><tr><th>Cần cho</th><th>Java</th><th></th></tr></thead><tbody>
      ${j.recommended.map((r) => `<tr><td>${escapeHtml(r.for)}</td><td><span class="chip ${j.runtimes.some((x) => x.major === r.major) ? 'ok' : 'bad'}">${escapeHtml(r.label)}</span></td>
        <td style="text-align:right"><a class="btn tiny ghost" href="${r.url}" target="_blank" rel="noopener">Tải</a></td></tr>`).join('')}
      </tbody></table>
      <div class="modal-foot"><button class="btn primary" data-close>Đóng</button></div>`, { wide: true });
  };

  host.querySelector('#btn-export').onclick = async () => {
    const data = JSON.stringify({ settings: store.settings, instances: store.instances }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `zeko-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('Đã xuất cấu hình ra tệp JSON', 'ok');
  };

  host.querySelector('#btn-refresh-catalog').onclick = async () => {
    toast('Đang đồng bộ danh mục phiên bản từ Mojang…', 'info', 2500);
    const res = await api.versions(false, true);
    store.catalog = res;
    store.versionsCache = res.versions;
    const pill = document.getElementById('net-pill');
    pill.className = `net-pill ${res.source === 'live' ? 'ok' : 'bad'}`;
    pill.querySelector('span').textContent = `Danh mục: ${res.source === 'live' ? 'trực tuyến' : 'ngoại tuyến'}`;
    toast(res.source === 'live' ? `Đã đồng bộ ${res.counts.total} phiên bản từ Mojang` : `Không kết nối được Mojang (${res.error || 'không rõ'}). Đang dùng danh mục nhúng ${res.versions.length} phiên bản.`, res.source === 'live' ? 'ok' : 'warn', 8000);
  };

  host.querySelector('#btn-reset').onclick = () =>
    confirmModal({
      title: 'Đặt lại toàn bộ cài đặt?',
      text: 'Chủ đề, tài khoản, RAM, JVM args và chính sách bảo mật sẽ về mặc định. <b>Instance và thế giới của bạn không bị ảnh hưởng.</b>',
      confirmText: 'Đặt lại',
      danger: true,
      onConfirm: async () => {
        store.settings = await api.resetSettings();
        applyAppearance(store.settings);
        invalidate();
        toast('Đã đặt lại cài đặt', 'warn');
      },
    });
}
