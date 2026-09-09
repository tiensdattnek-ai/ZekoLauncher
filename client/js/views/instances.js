/**
 * Instance — tạo / sửa / nhân bản / xoá / duyệt tệp mod.
 */
import { api } from '../api.js';
import { escapeHtml, toast, openModal, confirmModal, humanSize, timeAgo, fmtDate, humanTime } from '../ui.js';
import { store, selectedInstance, renderPlaybar, invalidate } from '../main.js';

const ICONS = ['🧊', '⚔️', '🏰', '🌋', '🌲', '🐉', '🚀', '💎', '🔥', '🌊', '🎮', '🛠️', '🧪', '🌙', '☄️', '🏹'];
const LOADERS = [
  { id: 'vanilla', name: 'Vanilla', desc: 'Minecraft gốc, không mod loader' },
  { id: 'fabric', name: 'Fabric', desc: 'Nhẹ, khởi động nhanh — tốt nhất cho máy yếu' },
  { id: 'quilt', name: 'Quilt', desc: 'Nhánh của Fabric, tương thích phần lớn mod Fabric' },
  { id: 'forge', name: 'Forge', desc: 'Hệ mod lớn cho 1.12.2 – 1.20.x' },
  { id: 'neoforge', name: 'NeoForge', desc: 'Hiện đại, cho 1.20.4 trở lên' },
];

export async function render(host) {
  const versions = store.catalog?.versions?.length
    ? store.catalog.versions
    : (await api.versions(false).catch(() => ({ versions: [] }))).versions;
  store.versionsCache = versions;

  const inst = selectedInstance();
  host.innerHTML = `
  <div class="row between" style="margin-bottom:16px">
    <div class="row" style="gap:8px">
      <button class="btn primary" id="btn-new">＋ Instance mới</button>
      <button class="btn ghost" id="btn-refresh">↻ Làm mới</button>
      <span class="chip" id="chip-count">${store.instances.length} instance</span>
      <span class="chip ${store.catalog?.source === 'live' ? 'ok' : 'warn'}" title="${escapeHtml(store.catalog?.error || '')}">
        danh mục: ${escapeHtml(store.catalog?.source || '—')}
      </span>
    </div>
    <div class="row" style="gap:8px">
      <input class="input" id="q" placeholder="Tìm instance…" style="width:190px" />
      <select class="select" id="sort" style="width:auto">
        <option value="recent">Mới chơi</option>
        <option value="name">Tên A→Z</option>
        <option value="size">Dung lượng</option>
        <option value="created">Mới tạo</option>
      </select>
    </div>
  </div>
  <div id="inst-list">${listHtml(store.instances)}</div>`;
  return {};
}

export function mount(host) {
  host.querySelector('#btn-new').onclick = () => newModal();
  host.querySelector('#btn-refresh').onclick = async () => {
    store.instances = (await api.instances()).instances;
    invalidate();
    toast('Đã làm mới danh sách instance', 'ok', 1800);
  };
  host.querySelector('#q').oninput = (e) => filter(e.target.value, host.querySelector('#sort').value);
  host.querySelector('#sort').onchange = (e) => filter(host.querySelector('#q').value, e.target.value);
  bindCards(host);
}

function filter(q, sort) {
  const list = document.getElementById('inst-list');
  let arr = [...store.instances];
  if (q) {
    const s = q.toLowerCase();
    arr = arr.filter((i) => `${i.name} ${i.version} ${i.loader} ${i.group}`.toLowerCase().includes(s));
  }
  const by = {
    recent: (a, b) => new Date(b.lastPlayed || 0) - new Date(a.lastPlayed || 0),
    name: (a, b) => a.name.localeCompare(b.name, 'vi'),
    size: (a, b) => (b.stats?.sizeBytes || 0) - (a.stats?.sizeBytes || 0),
    created: (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
  };
  arr.sort(by[sort] || by.recent);
  list.innerHTML = listHtml(arr);
  bindCards(list);
}

function bindCards(root) {
  root.querySelectorAll('.inst-card').forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest('[data-act]')) return;
      store.selected = card.dataset.id;
      root.querySelectorAll('.inst-card').forEach((c) => c.classList.toggle('selected', c.dataset.id === card.dataset.id));
      renderPlaybar();
      toast(`Đã chọn "${card.dataset.name}"`, 'info', 1600);
    };
    card.ondblclick = () => detailModal(card.dataset.id);
  });
  root.querySelectorAll('[data-act]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      const id = b.closest('.inst-card').dataset.id;
      const act = b.dataset.act;
      if (act === 'edit') detailModal(id);
      else if (act === 'files') filesModal(id);
      else if (act === 'scan') scanModal(id);
      else if (act === 'dupe') doDuplicate(id);
      else if (act === 'del') doDelete(id);
    };
  });
}

function listHtml(list) {
  if (!list.length) {
    return `<div class="card"><div class="empty">
      <div class="big">🧊</div><b>Chưa có instance nào</b>
      <span class="hint">Instance giống như một "hồ sơ chơi" riêng: phiên bản, mod, gói tài nguyên và thế giới của nó.</span>
      <button class="btn primary" onclick="document.getElementById('btn-new').click()">＋ Tạo instance đầu tiên</button>
    </div></div>`;
  }
  return `<div class="inst-grid">${list.map(cardHtml).join('')}</div>`;
}

function cardHtml(i) {
  const running = store.sessions.some((s) => s.instanceId === i.id && s.state !== 'exited');
  return `<article class="inst-card ${i.id === store.selected ? 'selected' : ''} ${running ? 'running' : ''}" data-id="${i.id}" data-name="${escapeHtml(i.name)}" tabindex="0">
    ${running ? '<span class="inst-live"><span class="pulse-dot"></span></span>' : ''}
    <div class="inst-ico">${escapeHtml(i.icon || '🧊')}</div>
    <div class="inst-name ellip">${escapeHtml(i.name)}</div>
    <div class="inst-meta"><span class="chip">${escapeHtml(i.version)}</span><span>${escapeHtml(loaderName(i.loader))}</span></div>
    <div class="inst-foot">
      <span title="Dung lượng">💾 ${escapeHtml(i.stats?.sizeHuman || '0 B')}</span>
      <span title="Số mod">🧩 ${i.stats?.modCount || 0}</span>
      <span class="grow"></span>
      <span title="Lần chơi cuối">${timeAgo(i.lastPlayed)}</span>
    </div>
    <div class="row" style="gap:5px;margin-top:11px">
      <button class="btn tiny ghost" data-act="edit" title="Chi tiết & chỉnh sửa">⚙️</button>
      <button class="btn tiny ghost" data-act="files" title="Tệp & mod">📁</button>
      <button class="btn tiny ghost" data-act="scan" title="Quét an toàn">🛡️</button>
      <button class="btn tiny ghost" data-act="dupe" title="Nhân bản">⧉</button>
      <button class="btn tiny ghost" data-act="del" title="Xoá">🗑</button>
    </div>
  </article>`;
}

function loaderName(id) {
  return LOADERS.find((l) => l.id === id)?.name || id || 'vanilla';
}

/* ── TẠO MỚI ───────────────────────────────────────────────────── */
function newModal() {
  const versions = store.versionsCache || [];
  const releases = versions.filter((v) => v.type === 'release');
  const snapshots = versions.filter((v) => v.type !== 'release');
  const rec = store.recommend;
  openModal(`
    <h3>＋ Instance mới</h3>
    <p class="modal-sub">Mỗi instance là một hồ sơ chơi độc lập — mod, thế giới và cấu hình hiệu năng riêng.</p>
    <div class="grid cols-2" style="gap:14px">
      <label class="field"><b>Tên instance</b>
        <input class="input" id="f-name" value="Sinh tồn ${new Date().getFullYear()}" maxlength="64" /></label>
      <label class="field"><b>Nhóm</b>
        <input class="input" id="f-group" value="Mặc định" /></label>
      <label class="field"><b>Phiên bản Minecraft</b>
        <select class="select" id="f-version">
          <optgroup label="Phổ biến / đề xuất">
            ${releases.filter((v) => v.popular).map((v) => `<option value="${v.id}" ${v.id === '1.20.4' ? 'selected' : ''}>${v.id}${v.note ? ' — ' + escapeHtml(v.note) : ''}</option>`).join('')}
          </optgroup>
          <optgroup label="Bản phát hành">
            ${releases.map((v) => `<option value="${v.id}">${v.id}</option>`).join('')}
          </optgroup>
          ${snapshots.length ? `<optgroup label="Snapshot / bản cũ">${snapshots.slice(0, 24).map((v) => `<option value="${v.id}">${v.id} (${v.type})</option>`).join('')}</optgroup>` : ''}
        </select>
        <span class="hint" id="f-java-hint"></span>
      </label>
      <label class="field"><b>Mod loader</b>
        <select class="select" id="f-loader">
          ${LOADERS.map((l) => `<option value="${l.id}" ${l.id === 'fabric' ? 'selected' : ''}>${l.name} — ${l.desc}</option>`).join('')}
        </select></label>
      <label class="field"><b>Hồ sơ hiệu năng</b>
        <select class="select" id="f-perf">
          ${(store.presets?.presets || []).map((p) => `<option value="${p.id}" ${p.id === (rec?.preset?.id || 'lowend') ? 'selected' : ''}>${p.icon} ${escapeHtml(p.name)} — ${escapeHtml(p.tagline.slice(0, 46))}</option>`).join('')}
        </select>
        <span class="hint">${escapeHtml(rec?.reason || '')}</span></label>
      <label class="field"><b>RAM tối đa (MB)</b>
        <input class="input" id="f-ram" type="number" min="512" max="32768" step="256" value="${rec?.maxMb || 4096}" />
        <span class="hint">Máy bạn có ${Math.round((rec?.totalMb || 0) / 1024)} GB — Zeko khuyên không vượt quá 50%.</span></label>
    </div>
    <div class="sep"></div>
    <label class="field"><b>Biểu tượng</b>
      <div class="row" id="f-icons" style="gap:6px">${ICONS.map((i, k) => `<button type="button" class="icon-btn ${k === 0 ? 'accent' : ''}" data-ico="${i}" style="${k === 0 ? 'border-color:var(--accent);background:var(--grad-soft)' : ''}">${i}</button>`).join('')}</div></label>
    <div class="modal-foot">
      <button class="btn ghost" data-close>Huỷ</button>
      <button class="btn primary" id="f-create">Tạo instance</button>
    </div>`, {
    wide: true,
    onMount(box, close) {
      let icon = ICONS[0];
      box.querySelectorAll('#f-icons [data-ico]').forEach((b) => {
        b.onclick = () => {
          icon = b.dataset.ico;
          box.querySelectorAll('#f-icons [data-ico]').forEach((x) => { x.style.borderColor = ''; x.style.background = ''; });
          b.style.borderColor = 'var(--accent)';
          b.style.background = 'var(--grad-soft)';
        };
      });
      const hint = box.querySelector('#f-java-hint');
      const updHint = () => {
        const v = box.querySelector('#f-version').value;
        const minor = Number(v.split('.')[1] || 0);
        const patch = Number(v.split('.')[2] || 0);
        const need = minor >= 21 || (minor === 20 && patch >= 5) ? 21 : minor >= 17 ? 17 : 8;
        const have = store.java?.runtimes || [];
        const ok = have.some((h) => h.major >= need);
        hint.innerHTML = `Cần <b>Java ${need}</b> — ${ok ? '<span style="color:var(--ok)">đã có trên máy ✓</span>' : '<span style="color:var(--warn)">chưa thấy trên máy ✗</span>'}`;
      };
      box.querySelector('#f-version').onchange = updHint;
      updHint();

      box.querySelector('#f-create').onclick = async () => {
        const body = {
          name: box.querySelector('#f-name').value.trim() || 'Instance mới',
          group: box.querySelector('#f-group').value.trim() || 'Mặc định',
          version: box.querySelector('#f-version').value,
          loader: box.querySelector('#f-loader').value,
          perfProfile: box.querySelector('#f-perf').value,
          icon,
          ram: { maxMb: Number(box.querySelector('#f-ram').value) || 4096 },
        };
        try {
          const res = await api.createInstance(body);
          store.instances.push(res.instance);
          store.selected = res.instance.id;
          close();
          invalidate();
          renderPlaybar();
          toast(`Đã tạo "${body.name}" (${body.version} · ${loaderName(body.loader)})`, 'ok');
          setTimeout(() => offerDownload(res.instance), 700);
        } catch (err) {
          toast(err.message, 'bad');
        }
      };
    },
  });
}

function offerDownload(inst) {
  confirmModal({
    title: `Tải tệp game cho "${escapeHtml(inst.name)}"?`,
    text: `Zeko sẽ tải client.jar + thư viện của <b>${escapeHtml(inst.version)}</b> về máy, kiểm tra SHA-1 từng tệp và quét Sentinel sau khi tải.<br><span class="hint">Cần kết nối tới máy chủ Mojang. Nếu môi trường đang ngoại tuyến, bước này sẽ báo lỗi và bạn có thể làm lại sau.</span>`,
    confirmText: 'Tải ngay',
    onConfirm: async () => {
      try {
        const res = await api.download(inst.id);
        toast(`Đã đưa ${res.queued} tệp vào hàng đợi tải`, 'ok');
        location.hash = '#/downloads';
      } catch (err) {
        toast(`Không tải được: ${err.message}`, 'warn', 9000);
      }
    },
  });
}

/* ── CHI TIẾT / SỬA ────────────────────────────────────────────── */
async function detailModal(id) {
  const { instance, files, lastScan, running } = await api.instance(id);
  openModal(`
    <h3>${escapeHtml(instance.icon)} ${escapeHtml(instance.name)}</h3>
    <p class="modal-sub">Tạo ${fmtDate(instance.createdAt)} · thư mục <span class="mono">${escapeHtml(instance.slug)}</span> · ${instance.stats?.sizeHuman} / ${instance.stats?.fileCount} tệp</p>
    <div class="tabs" id="d-tabs">
      <div class="tab active" data-t="general">Chung</div>
      <div class="tab" data-t="perf">Hiệu năng</div>
      <div class="tab" data-t="files">Tệp & mod</div>
      <div class="tab" data-t="sec">An toàn</div>
    </div>
    <div id="d-body"></div>
    <div class="modal-foot">
      <button class="btn ghost" data-close>Đóng</button>
      <button class="btn primary" id="d-save">Lưu thay đổi</button>
    </div>`, {
    wide: true,
    onMount(box, close) {
      const body = box.querySelector('#d-body');
      const tabs = box.querySelectorAll('#d-tabs .tab');
      const patch = {};
      const set = (k, v) => (patch[k] = v);

      const panes = {
        general: () => `
          <div class="grid cols-2" style="gap:14px">
            <label class="field"><b>Tên</b><input class="input" data-k="name" value="${escapeHtml(instance.name)}" /></label>
            <label class="field"><b>Nhóm</b><input class="input" data-k="group" value="${escapeHtml(instance.group || '')}" /></label>
            <label class="field"><b>Phiên bản</b><input class="input" data-k="version" value="${escapeHtml(instance.version)}" /></label>
            <label class="field"><b>Mod loader</b>
              <select class="select" data-k="loader">${LOADERS.map((l) => `<option value="${l.id}" ${l.id === instance.loader ? 'selected' : ''}>${l.name}</option>`).join('')}</select></label>
            <label class="field"><b>Kích thước cửa sổ</b>
              <div class="row"><input class="input" data-k="w" type="number" value="${instance.window?.width || 1280}" />
              <input class="input" data-k="h" type="number" value="${instance.window?.height || 720}" /></div></label>
            <label class="field"><b>Ghi chú</b><input class="input" data-k="notes" value="${escapeHtml(instance.notes || '')}" placeholder="VD: bản chơi cùng bạn bè" /></label>
          </div>
          <div class="switch"><div><div class="t">Toàn màn hình</div><div class="d">Vào game là fullscreen luôn</div></div>
            <div class="toggle ${instance.window?.fullscreen ? 'on' : ''}" data-toggle="fullscreen"><i></i></div></div>`,
        perf: () => `
          <div class="preset-grid">${(store.presets?.presets || []).map((p) => `
            <div class="preset ${p.id === instance.perfProfile ? 'active' : ''}" data-perf="${p.id}">
              <span class="tick">✓</span>
              <div class="preset-ico">${p.icon}</div><h4>${escapeHtml(p.name)}</h4>
              <div class="tag">${escapeHtml(p.tagline)}</div>
              <div class="kv"><span>RAM</span><b>${p.minRamMb}–${p.maxRamMb} MB</b></div>
              <div class="kv"><span>Render</span><b>${p.gameSettings.renderDistance} chunk</b></div>
            </div>`).join('')}</div>
          <div class="sep"></div>
          <div class="grid cols-2" style="gap:14px">
            <label class="field"><b>RAM tối thiểu (MB)</b><input class="input" type="number" data-k="ramMin" value="${instance.ram?.minMb ?? 1024}" /></label>
            <label class="field"><b>RAM tối đa (MB)</b><input class="input" type="number" data-k="ramMax" value="${instance.ram?.maxMb ?? 4096}" /></label>
          </div>
          <label class="field" style="margin-top:12px"><b>JVM args bổ sung (mỗi dòng một tham số)</b>
            <textarea class="input" data-k="jvm">${(instance.javaArgsExtra || []).join('\n')}</textarea></label>
          <div class="notice" style="margin-top:12px"><span class="ni">⚡</span><div>Lưu lại sẽ ghi <span class="mono">options.txt</span> theo hồ sơ đã chọn — render distance, hạt hiệu ứng, mây, bóng entity… được đặt sẵn để tăng FPS.</div></div>`,
        files: () => `
          <div class="row between" style="margin-bottom:10px">
            <span class="chip">🧩 ${files.mods.length} mod</span>
            <span class="chip">🖼️ ${files.packs.length} resource pack</span>
            <span class="chip">✨ ${files.shaders.length} shader</span>
            <span class="chip">🌍 ${files.saves.length} thế giới</span>
          </div>
          <table class="table"><thead><tr><th>Tệp</th><th>Loại</th><th style="text-align:right">Dung lượng</th></tr></thead><tbody>
          ${[...files.mods.map((f) => ({ ...f, kind: 'mod' })), ...files.packs.map((f) => ({ ...f, kind: 'pack' })), ...files.shaders.map((f) => ({ ...f, kind: 'shader' }))]
            .map((f) => `<tr><td class="mono">${escapeHtml(f.name)}</td><td><span class="chip">${f.kind}</span></td><td style="text-align:right">${escapeHtml(humanSize(f.size))}</td></tr>`)
            .join('') || '<tr><td colspan="3" class="muted">Chưa có tệp nào.</td></tr>'}
          </tbody></table>
          <div class="notice" style="margin-top:12px"><span class="ni">💡</span><div>Thả tệp <span class="mono">.jar</span> vào thư mục <span class="mono">mods</span> của instance rồi bấm Quét ở tab An toàn. Chỉ tải mod từ Modrinth/CurseForge.</div></div>`,
        sec: () => `
          ${lastScan ? `<div class="row between" style="margin-bottom:12px">
            <div><div class="k muted" style="font-size:11px">LẦN QUÉT GẦN NHẤT</div>
            <div style="font-size:19px;font-weight:800">${lastScan.riskScore}/100 <span class="muted" style="font-size:12px;font-weight:500">điểm rủi ro</span></div></div>
            <div class="row" style="gap:6px">
              <span class="chip bad">${lastScan.counts?.threats || 0} rủi ro cao</span>
              <span class="chip warn">${lastScan.counts?.reviews || 0} cần xem</span>
              <span class="chip ok">${lastScan.counts?.clean || 0} sạch</span>
            </div></div>
            <div class="progress" style="margin-bottom:12px"><i style="width:${lastScan.riskScore}%;background:${lastScan.riskScore > 45 ? 'var(--bad)' : lastScan.riskScore > 20 ? 'var(--warn)' : 'var(--ok)'}"></i></div>` : '<p class="hint">Chưa quét lần nào.</p>'}
          <div class="row" style="gap:8px">
            <button class="btn primary tiny" id="d-scan">🛡 Quét ngay</button>
            <button class="btn ghost tiny" id="d-scan-sample">Tạo tệp mẫu để thử</button>
          </div>
          <div id="d-scan-out" style="margin-top:12px"></div>
          <div class="sep"></div>
          <div class="switch"><div><div class="t">Tự quét trước khi chơi</div><div class="d">Chặn khởi động nếu thấy tệp rủi ro cao</div></div>
            <div class="toggle ${instance.security?.autoScanOnLaunch ? 'on' : ''}" data-toggle="autoScan"><i></i></div></div>
          <div class="switch"><div><div class="t">Chặn khi phát hiện mối đe doạ</div><div class="d">Tắt = chỉ cảnh báo, vẫn cho chơi</div></div>
            <div class="toggle ${instance.security?.blockOnThreat ? 'on' : ''}" data-toggle="block"><i></i></div></div>`,
      };

      const show = (t) => {
        tabs.forEach((x) => x.classList.toggle('active', x.dataset.t === t));
        body.innerHTML = panes[t]();
        wire();
      };
      const wire = () => {
        body.querySelectorAll('[data-k]').forEach((n) => {
          n.oninput = n.onchange = () => {
            const k = n.dataset.k;
            if (k === 'w' || k === 'h') patch.window = { width: Number(body.querySelector('[data-k=w]').value), height: Number(body.querySelector('[data-k=h]').value), fullscreen: !!patch.window?.fullscreen };
            else if (k === 'ramMin' || k === 'ramMax') patch.ram = { minMb: Number(body.querySelector('[data-k=ramMin]').value), maxMb: Number(body.querySelector('[data-k=ramMax]').value) };
            else if (k === 'jvm') patch.javaArgsExtra = n.value.split('\n').map((s) => s.trim()).filter(Boolean);
            else patch[k] = n.value;
          };
        });
        body.querySelectorAll('[data-perf]').forEach((p) => {
          p.onclick = () => {
            body.querySelectorAll('[data-perf]').forEach((x) => x.classList.remove('active'));
            p.classList.add('active');
            patch.perfProfile = p.dataset.perf;
          };
        });
        body.querySelectorAll('[data-toggle]').forEach((tg) => {
          tg.onclick = () => {
            tg.classList.toggle('on');
            const on = tg.classList.contains('on');
            const k = tg.dataset.toggle;
            if (k === 'fullscreen') patch.window = { ...(patch.window || instance.window), fullscreen: on };
            if (k === 'autoScan') patch.security = { ...(patch.security || instance.security), autoScanOnLaunch: on };
            if (k === 'block') patch.security = { ...(patch.security || instance.security), blockOnThreat: on };
          };
        });
        const ds = body.querySelector('#d-scan');
        if (ds) ds.onclick = () => scanInline(id, body.querySelector('#d-scan-out'), ds);
        const dss = body.querySelector('#d-scan-sample');
        if (dss) dss.onclick = async () => {
          await api.createSample(id, 'trap-pack');
          await api.createSample(id, 'sus-mod');
          await api.createSample(id, 'clean-pack');
          toast('Đã tạo 3 tệp mẫu (1 sạch, 2 đáng ngờ) để thử Sentinel', 'ok', 5000);
        };
      };
      tabs.forEach((t) => (t.onclick = () => show(t.dataset.t)));
      show('general');

      box.querySelector('#d-save').onclick = async () => {
        try {
          const res = await api.updateInstance(id, patch);
          const idx = store.instances.findIndex((i) => i.id === id);
          if (idx > -1) store.instances[idx] = res.instance;
          close();
          invalidate();
          renderPlaybar();
          toast('Đã lưu cấu hình instance', 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      };
    },
  });
}

async function scanInline(id, out, btn = null) {
  if (btn) { btn.disabled = true; btn.textContent = 'Đang quét…'; }
  out.innerHTML = '<div class="progress indeterminate"><i></i></div>';
  try {
    const { jobId } = await api.startScan(id, true);
    let job;
    for (let i = 0; i < 240; i++) {
      job = await api.scanJob(jobId);
      out.innerHTML = `<div class="progress"><i style="width:${job.progress || 0}%"></i></div>
        <div class="hint" style="margin-top:6px">${job.progress || 0}% · ${escapeHtml(job.current || 'đang đọc…')}</div>`;
      if (job.state === 'done') break;
      await new Promise((r) => setTimeout(r, 380));
    }
    const rep = job?.report || {};
    out.innerHTML = `<div class="row between"><div><b style="font-size:17px">${rep.riskScore ?? '—'}/100</b> <span class="muted">điểm rủi ro</span></div>
      <div class="row" style="gap:6px"><span class="chip bad">${rep.counts?.threats || 0} cao</span>
      <span class="chip warn">${rep.counts?.reviews || 0} xem xét</span>
      <span class="chip ok">${rep.counts?.clean || 0} sạch</span></div></div>
      ${rep.quarantined ? `<div class="notice bad" style="margin-top:10px"><span class="ni">📦</span><div>Đã chuyển ${rep.quarantined} tệp vào vùng cách ly.</div></div>` : ''}
      ${(rep.results || []).slice(0, 6).map((r) => `<div class="threat-row ${r.verdict}"><div>
        <div class="threat-file">${escapeHtml(r.file)}</div>
        <div class="reasons">${(r.reasons || []).map((x) => `<div class="reason">${severityDot(x.severity)} <b>${escapeHtml(x.name)}</b> · ${escapeHtml(x.detail || '')}</div>`).join('')}</div>
      </div><div>${r.score}</div></div>`).join('')}`;
  } catch (err) {
    out.innerHTML = `<div class="notice bad"><span class="ni">⛔</span><div>${escapeHtml(err.message)}</div></div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🛡 Quét lại'; }
  }
}

function severityDot(sev) {
  const c = { low: 'var(--text-3)', medium: 'var(--info)', high: 'var(--warn)', critical: 'var(--bad)' }[sev] || 'var(--text-3)';
  return `<span style="color:${c}">●</span>`;
}

function scanModal(id) {
  const inst = store.instances.find((i) => i.id === id);
  openModal(`<h3>🛡 Quét "${escapeHtml(inst?.name || '')}"</h3>
    <p class="modal-sub">Sentinel kiểm tra SHA-1, cấu trúc JAR, chữ ký mã độc đã biết và heuristic.</p>
    <div id="sm-out"><div class="progress indeterminate"><i></i></div></div>
    <div class="modal-foot"><button class="btn ghost" data-close>Đóng</button></div>`, {
    wide: true,
    onMount(box) { scanInline(id, box.querySelector('#sm-out')); },
  });
}

async function doDuplicate(id) {
  const inst = store.instances.find((i) => i.id === id);
  openModal(`<h3>⧉ Nhân bản instance</h3><p class="modal-sub">Sao chép toàn bộ mod, thế giới và cấu hình của "${escapeHtml(inst.name)}".</p>
    <label class="field"><b>Tên bản sao</b><input class="input" id="dup-name" value="${escapeHtml(inst.name)} (bản sao)" /></label>
    <div class="modal-foot"><button class="btn ghost" data-close>Huỷ</button><button class="btn primary" id="dup-go">Nhân bản</button></div>`, {
    onMount(box, close) {
      box.querySelector('#dup-go').onclick = async () => {
        try {
          const res = await api.duplicateInstance(id, box.querySelector('#dup-name').value);
          store.instances.push(res.instance);
          close();
          invalidate();
          toast('Đã nhân bản xong', 'ok');
        } catch (err) { toast(err.message, 'bad'); }
      };
    },
  });
}

function doDelete(id) {
  const inst = store.instances.find((i) => i.id === id);
  confirmModal({
    title: `Xoá "${escapeHtml(inst.name)}"?`,
    text: `Thư mục <span class="mono">${escapeHtml(inst.slug)}</span> (${inst.stats?.sizeHuman}) gồm mod, thế giới và ảnh chụp sẽ bị xoá vĩnh viễn.<br>Hành động này <b>không thể hoàn tác</b>.`,
    confirmText: 'Xoá vĩnh viễn',
    danger: true,
    onConfirm: async () => {
      await api.deleteInstance(id);
      store.instances = store.instances.filter((i) => i.id !== id);
      if (store.selected === id) store.selected = store.instances[0]?.id || null;
      invalidate();
      renderPlaybar();
      toast('Đã xoá instance', 'warn');
    },
  });
}

async function filesModal(id) {
  const { instance, files } = await api.instance(id);
  const rows = (arr, kind) => arr.map((f) => `<tr><td class="mono">${escapeHtml(f.name)}</td><td><span class="chip">${kind}</span></td><td style="text-align:right">${escapeHtml(humanSize(f.size))}</td><td class="muted">${fmtDate(new Date(f.mtime).toISOString())}</td></tr>`).join('');
  openModal(`<h3>📁 ${escapeHtml(instance.name)} — tệp</h3>
    <p class="modal-sub">Thư mục: <span class="mono">${escapeHtml(instance.dir)}</span> · tổng ${instance.stats?.sizeHuman}</p>
    <table class="table"><thead><tr><th>Tệp</th><th>Loại</th><th style="text-align:right">Dung lượng</th><th>Sửa đổi</th></tr></thead><tbody>
      ${rows(files.mods, 'mod')}${rows(files.packs, 'pack')}${rows(files.shaders, 'shader')}${rows(files.saves, 'save') || ''}
      ${!(files.mods.length + files.packs.length + files.shaders.length + files.saves.length) ? '<tr><td colspan="4" class="muted">Trống — hãy thêm mod hoặc resource pack.</td></tr>' : ''}
    </tbody></table>
    <div class="row" style="margin-top:14px;gap:8px">
      <button class="btn tiny ghost" id="mk-sample">Tạo tệp mẫu kiểm thử</button>
      <button class="btn tiny ghost" id="open-dir" title="Chép đường dẫn">Chép đường dẫn thư mục</button>
    </div>
    <div class="modal-foot"><button class="btn ghost" data-close>Đóng</button></div>`, {
    wide: true,
    onMount(box, close) {
      box.querySelector('#mk-sample').onclick = async () => {
        await api.createSample(id, 'sus-mod');
        toast('Đã tạo mods/freecoins-mod.jar (tệp mẫu đáng ngờ)', 'ok');
        close();
        invalidate();
      };
      box.querySelector('#open-dir').onclick = async () => {
        try { await navigator.clipboard.writeText(instance.dir); toast('Đã chép đường dẫn', 'ok'); } catch { toast(instance.dir, 'info', 8000); }
      };
    },
  });
}
