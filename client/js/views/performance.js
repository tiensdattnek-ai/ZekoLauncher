/**
 * Zeko Turbo — trung tâm tối ưu hiệu năng.
 */
import { api } from '../api.js';
import { escapeHtml, toast, impactDots, ring, openModal, humanSize } from '../ui.js';
import { store, selectedInstance, invalidate, renderPlaybar } from '../main.js';

export async function render(host) {
  const [presets, rec, mods] = await Promise.all([
    store.presets || api.presets(),
    store.recommend || api.recommend(),
    api.mods(),
  ]);
  store.presets = presets;
  store.recommend = rec;
  const inst = selectedInstance();
  const bench = store.benchmark;

  host.innerHTML = `
  ${bench ? '' : `<div class="notice" style="margin-bottom:16px"><span class="ni">🧮</span>
    <div class="grow">Chưa chấm điểm máy. Điểm chuẩn nhanh (~0,5 giây) giúp Zeko chọn đúng hồ sơ FPS cho phần cứng của bạn.</div>
    <button class="btn primary tiny" id="run-bench">Chấm điểm ngay</button></div>`}

  <div class="grid cols-2" style="align-items:start;margin-bottom:16px">
    <div class="card glass">
      <div class="card-title"><span class="ico">🧭</span> Đề xuất cho máy bạn</div>
      <div class="row" style="gap:20px;align-items:center">
        ${ring(rec.index ?? bench?.index ?? 60, 1000, 'ZPI', 'var(--accent)')}
        <div class="grow">
          <div style="font-size:19px;font-weight:800">${escapeHtml(rec.preset.name)}</div>
          <p class="hint" style="margin-top:4px">${escapeHtml(rec.reason || '')}</p>
          <p class="hint" style="margin-top:6px">ZPI ${rec.index ?? bench?.index ?? '—'}/1000 đo <b>CPU + đĩa</b>; hồ sơ được chọn còn bị chặn bởi <b>RAM vật lý</b>${rec.ramBound ? ' — máy bạn đang bị giới hạn RAM' : ''}.</p>
          <div class="row" style="gap:6px;margin-top:10px">
            <span class="chip">${rec.cpus} nhân CPU</span>
            <span class="chip">${Math.round(rec.totalMb / 1024)} GB RAM</span>
            <span class="chip accent">RAM game: ${rec.minMb}–${rec.maxMb} MB</span>
          </div>
          <div class="row" style="gap:8px;margin-top:12px">
            <button class="btn primary tiny" id="apply-rec">⚡ Áp dụng hồ sơ "${escapeHtml(rec.preset.name)}"</button>
            <button class="btn ghost tiny" id="show-advice">Xem lời khuyên</button>
          </div>
        </div>
      </div>
    </div>

    <div class="card hoverable">
      <div class="card-title"><span class="ico">🧪</span> Điểm chuẩn chi tiết</div>
      <div id="bench-body">${bench ? benchHtml(bench) : '<p class="hint">Bấm "Chấm điểm ngay" để đo CPU, đĩa và khả năng cấp phát bộ nhớ.</p>'}</div>
    </div>
  </div>

  <div class="card-title" style="margin:22px 0 12px"><span class="ico">⚡</span> Hồ sơ hiệu năng
    <span class="spacer"></span>
    <span class="chip ${inst ? 'accent' : ''}">${inst ? 'đang áp dụng cho: ' + escapeHtml(inst.name) : 'chưa chọn instance'}</span>
  </div>
  <div class="preset-grid" id="preset-grid">
    ${presets.presets.map((p) => presetCard(p, inst?.perfProfile || store.settings?.perfProfile)).join('')}
  </div>

  <div class="grid cols-2" style="align-items:start;margin-top:22px">
    <div class="card">
      <div class="card-title"><span class="ico">🧩</span> Mod tăng FPS nên cài <span class="spacer"></span><span class="chip">${mods.mods.length} mod</span></div>
      <div class="row" style="gap:8px;margin-bottom:12px">
        <input class="input" id="mod-q" placeholder="Tìm mod…" style="width:200px" />
        <select class="select" id="mod-role" style="width:auto">
          <option value="">Mọi vai trò</option>
          <option value="render">Kết xuất</option><option value="logic">Logic game</option>
          <option value="memory">Bộ nhớ</option><option value="network">Mạng</option>
          <option value="startup">Khởi động</option><option value="worldgen">Sinh thế giới</option>
        </select>
      </div>
      <div id="mod-list">${modRows(mods.mods)}</div>
    </div>

    <div class="grid" style="gap:16px">
      <div class="card">
        <div class="card-title"><span class="ico">🎨</span> Shader theo sức máy</div>
        <div class="grid" style="gap:9px">
          ${(presets.shaders || []).map((s) => `<a class="row between card hoverable" style="padding:11px 13px;border-radius:12px" href="${s.url}" target="_blank" rel="noopener">
            <div><div style="font-weight:600;font-size:13px">${escapeHtml(s.name)}</div>
            <div class="hint">${tierLabel(s.tier)}</div></div>
            <span class="chip ${s.tier === 'potato' ? 'bad' : s.tier === 'low' ? 'warn' : 'ok'}">${s.tier}</span>
          </a>`).join('')}
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">🪟</span> Tối ưu ngoài game</div>
        <div id="os-tweaks">${osTweaks(rec.preset)}</div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">☕</span> Java & bộ nhớ</div>
        ${javaPanel()}
      </div>
    </div>
  </div>`;
  return { presets, rec, mods };
}

export function mount(host, ctx) {
  const { rec } = ctx;
  const rb = host.querySelector('#run-bench');
  if (rb) rb.onclick = async () => {
    rb.disabled = true; rb.textContent = 'Đang đo…';
    const res = await api.benchmark();
    store.benchmark = res.benchmark;
    invalidate();
    toast(`ZPI ${res.benchmark.index}/1000 · ${res.benchmark.tier.label} · đề xuất: ${res.benchmark.suggestedProfile}`, 'ok', 6000);
  };

  host.querySelector('#apply-rec')?.addEventListener('click', () => applyProfile(rec.preset.id, rec.preset.name));

  host.querySelector('#show-advice')?.addEventListener('click', async () => {
    const r = await api.recommend();
    const adv = r.advice?.advice || [];
    openModal(`<h3>🎯 Lời khuyên tối ưu cho máy bạn</h3>
      <p class="modal-sub">Dựa trên CPU, RAM, đĩa và tải hệ thống ngay lúc này.</p>
      ${adv.length ? adv.map((a) => `<div class="notice ${a.level === 'warn' ? 'warn' : ''}" style="margin-bottom:9px"><span class="ni">${a.level === 'warn' ? '⚠️' : '💡'}</span><div>${escapeHtml(a.text)}</div></div>`).join('') : '<div class="notice ok"><span class="ni">✅</span><div>Máy đang khoẻ — không có gì cần chỉnh.</div></div>'}
      <div class="sep"></div>
      <div class="card-title" style="margin-bottom:8px">Các bước trong game</div>
      <ul class="grid" style="gap:7px;font-size:12.5px;color:var(--text-2)">
        ${(rec.preset.osTweaks || []).map((t) => `<li>• ${escapeHtml(t)}</li>`).join('')}
        <li>• Giảm <b>Render Distance</b> trước tiên — đây là thứ ngốn FPS nhiều nhất.</li>
        <li>• Tắt <b>VSync</b>, đặt <b>Max FPS</b> = tần số quét màn hình + 10.</li>
        <li>• Đặt <b>Particles: Minimal</b> và <b>Biome Blend: 0</b> khi đánh nhau/farm.</li>
        <li>• Dùng <span class="mono">/spark profiler</span> (mod spark) để biết chính xác nguyên nhân tụt FPS.</li>
      </ul>
      <div class="modal-foot"><button class="btn primary" data-close>Đã hiểu</button></div>`, { wide: true });
  });

  host.querySelectorAll('[data-preset]').forEach((card) => {
    card.onclick = () => {
      const id = card.dataset.preset;
      const p = store.presets.presets.find((x) => x.id === id);
      detailPreset(p);
    };
    const btn = card.querySelector('[data-apply]');
    if (btn) btn.onclick = (e) => { e.stopPropagation(); applyProfile(card.dataset.preset, card.querySelector('h4').textContent); };
  });

  const mq = host.querySelector('#mod-q');
  const mr = host.querySelector('#mod-role');
  const filterMods = () => {
    const q = mq.value.toLowerCase();
    const role = mr.value;
    host.querySelector('#mod-list').innerHTML = modRows(ctx.mods.mods.filter((m) => (!q || `${m.name} ${m.desc}`.toLowerCase().includes(q)) && (!role || m.role === role)));
    bindModRows(host);
  };
  mq.oninput = filterMods;
  mr.onchange = filterMods;
  bindModRows(host);

  host.querySelector('#btn-java-detect')?.addEventListener('click', async () => {
    store.java = await api.java();
    invalidate();
    toast(store.java.installed ? `Tìm thấy ${store.java.runtimes.length} JVM` : 'Không tìm thấy Java nào trên máy', store.java.installed ? 'ok' : 'warn');
  });
}

function bindModRows(host) {
  host.querySelectorAll('[data-copy-mod]').forEach((b) => {
    b.onclick = async () => {
      const name = b.dataset.copyMod;
      try { await navigator.clipboard.writeText(name); toast(`Đã chép "${name}" — dán vào ô tìm kiếm trên Modrinth`, 'ok'); }
      catch { toast(name, 'info', 6000); }
    };
  });
}

async function applyProfile(id, label) {
  const inst = selectedInstance();
  if (!inst) {
    await api.saveSettings({ perfProfile: id });
    store.settings = (await api.getSettings()).settings;
    toast(`Đã đặt hồ sơ mặc định toàn cục: ${label}`, 'ok');
    invalidate();
    return;
  }
  await api.applyPerf(inst.id, id);
  store.instances = (await api.instances()).instances;
  toast(`Đã áp dụng "${label}" cho ${inst.name} và ghi options.txt`, 'ok');
  renderPlaybar();
  invalidate();
}

function detailPreset(p) {
  openModal(`<h3>${p.icon} ${escapeHtml(p.name)}</h3>
    <p class="modal-sub">${escapeHtml(p.tagline)}</p>
    <div class="row" style="gap:8px;margin-bottom:14px">
      <span class="chip accent">RAM ${p.minRamMb}–${p.maxRamMb} MB</span>
      <span class="chip">Render ${p.gameSettings.renderDistance} chunk</span>
      <span class="chip">FPS tối đa ${p.gameSettings.maxFps}</span>
      <span class="chip">${(p.mods || []).length} mod đề xuất</span>
    </div>
    <h4 style="margin-bottom:8px">Tham số JVM</h4>
    <div class="console" style="max-height:170px;min-height:0">${p.jvmArgs.map(escapeHtml).join('\n')}</div>
    <h4 style="margin:14px 0 8px">Cài đặt game sẽ được ghi vào options.txt</h4>
    <table class="table"><tbody>${Object.entries(p.gameSettings).map(([k, v]) => `<tr><td class="mono">${escapeHtml(k)}</td><td style="text-align:right"><b>${escapeHtml(String(v))}</b></td></tr>`).join('')}</tbody></table>
    <h4 style="margin:14px 0 8px">Tinh chỉnh hệ điều hành</h4>
    <ul class="grid" style="gap:6px;font-size:12.5px;color:var(--text-2)">${(p.osTweaks || []).map((t) => `<li>• ${escapeHtml(t)}</li>`).join('')}</ul>
    <div class="modal-foot">
      <button class="btn ghost" data-close>Đóng</button>
      <button class="btn primary" id="pd-apply">Áp dụng hồ sơ này</button>
    </div>`, {
    wide: true,
    onMount(box, close) {
      box.querySelector('#pd-apply').onclick = () => { close(); applyProfile(p.id, p.name); };
    },
  });
}

/* ── HTML helpers ──────────────────────────────────────────────── */
function presetCard(p, activeId) {
  const active = p.id === activeId;
  return `<article class="preset ${active ? 'active' : ''}" data-preset="${p.id}">
    <span class="tick">✓</span>
    <div class="preset-ico">${p.icon}</div>
    <h4>${escapeHtml(p.name)}</h4>
    <div class="tag">${escapeHtml(p.tagline)}</div>
    <div class="kv"><span>RAM</span><b>${p.minRamMb}–${p.maxRamMb} MB</b></div>
    <div class="kv"><span>Render distance</span><b>${p.gameSettings.renderDistance} chunk</b></div>
    <div class="kv"><span>Đồ hoạ</span><b>${p.gameSettings.graphics === 'fast' ? 'Nhanh' : p.gameSettings.graphics === 'fancy' ? 'Đẹp' : p.gameSettings.graphics}</b></div>
    <div class="kv"><span>Tăng FPS</span>${impactDots(p.id === 'ultra' ? 5 : p.id === 'balanced' ? 4 : p.id === 'lowend' ? 5 : 5)}</div>
    <div class="row" style="margin-top:12px;gap:8px">
      <button class="btn tiny primary grow" data-apply>${active ? 'Đang dùng' : 'Áp dụng'}</button>
    </div>
  </article>`;
}

function modRows(mods) {
  if (!mods.length) return '<p class="hint">Không có mod khớp bộ lọc.</p>';
  const roleIcon = { render: '🎨', logic: '🧠', memory: '🧮', network: '🌐', startup: '⏱️', worldgen: '🌍', shaders: '✨', compat: '🔗', background: '🌙', profiler: '📊', visual: '🖼️', ui: '🗂️' };
  return mods
    .sort((a, b) => (b.impact || 0) - (a.impact || 0))
    .map(
      (m) => `<div class="mod-row">
      <div class="mod-ico">${roleIcon[m.role] || '🧩'}</div>
      <div><div class="mod-name">${escapeHtml(m.name)} <a class="chip tiny" href="${m.url}" target="_blank" rel="noopener" style="margin-left:6px">↗</a></div>
        <div class="mod-desc">${escapeHtml(m.desc || '')}</div>
        <div class="row" style="gap:6px;margin-top:5px">${(m.platforms || []).map((p) => `<span class="chip" style="font-size:10px;padding:2px 7px">${escapeHtml(p)}</span>`).join('')}</div></div>
      <div style="display:grid;gap:6px;justify-items:end">
        ${impactDots(m.impact || 0)}
        <button class="btn tiny ghost" data-copy-mod="${escapeHtml(m.name)}">Chép tên</button>
      </div>
    </div>`
    )
    .join('');
}

function benchHtml(b) {
  const parts = b.parts || {};
  const row = (label, value, max, unit) => `<div style="margin-bottom:10px">
    <div class="row between" style="font-size:11.5px;color:var(--text-2)"><span>${label}</span><b class="mono">${value}${unit || ''}</b></div>
    <div class="progress" style="height:6px;margin-top:4px"><i style="width:${Math.min(100, (value / max) * 100)}%"></i></div></div>`;
  return `<div style="font-size:34px;font-weight:800;letter-spacing:-.02em">${b.index}<small style="font-size:14px;color:var(--text-3)">/1000</small></div>
    <div class="chip ${b.index > 560 ? 'ok' : b.index > 300 ? 'warn' : 'bad'}" style="margin:6px 0 12px">${escapeHtml(b.tier.label)}</div>
    ${row('CPU (sàng nguyên tố)', Math.round(parts.cpuScore || 0), 400)}
    ${row('Đĩa (ghi 8 MB)', Math.round(parts.diskScore || 0), 250)}
    ${row('RAM vật lý', Math.round(parts.memScore || 0), 250)}
    ${row('Cấp phát / GC', Math.round(parts.allocScore || 0), 100)}
    <div class="sep"></div>
    <div class="row" style="gap:10px;font-size:11.5px;color:var(--text-3)">
      <span>Đĩa: <b class="mono">${b.diskMbps} MB/s</b></span>
      <span>Prime: <b class="mono">${b.primeMs.toFixed(0)} ms</b></span>
      <span>Alloc: <b class="mono">${b.allocMs.toFixed(0)} ms</b></span>
    </div>
    <div class="notice ${b.suggestedProfile === 'potato' || b.suggestedProfile === 'lowend' ? 'warn' : 'ok'}" style="margin-top:12px">
      <span class="ni">🎯</span><div>Hồ sơ phù hợp nhất: <b>${b.suggestedProfile}</b>.</div></div>`;
}

function osTweaks(preset) {
  return `<ul class="grid" style="gap:8px;font-size:12.5px;color:var(--text-2)">
    ${(preset?.osTweaks || []).map((t) => `<li>• ${escapeHtml(t)}</li>`).join('')}
  </ul>`;
}

function tierLabel(tier) {
  return { potato: 'Chạy được cả trên máy cực yếu', low: 'Nhẹ — hợp máy yếu / iGPU', balanced: 'Cân bằng đẹp & FPS' }[tier] || tier;
}

function javaPanel() {
  const j = store.java;
  if (!j) return '<p class="hint">Đang kiểm tra…</p>';
  return `<div class="grid" style="gap:9px">
    ${j.installed
      ? j.runtimes.map((r) => `<div class="row between"><span class="mono ellip" style="max-width:60%">${escapeHtml(r.path)}</span><span class="chip ok">Java ${r.major}</span></div>`).join('')
      : '<div class="notice warn"><span class="ni">☕</span><div>Chưa tìm thấy Java. Minecraft không chạy được nếu thiếu Java.</div></div>'}
    ${[21, 17, 8].map((m) => {
      const have = j.runtimes.find((r) => r.major === m);
      const rec = j.recommended.find((x) => x.major === m);
      return `<div class="row between"><div><b style="font-size:12.5px">Java ${m}</b><div class="hint">${rec?.for || ''}</div></div>
        ${have ? '<span class="chip ok">đã cài</span>' : `<a class="btn tiny ghost" href="${rec?.url}" target="_blank" rel="noopener">Tải về</a>`}</div>`;
    }).join('')}
    <button class="btn ghost tiny" id="btn-java-detect">↻ Quét lại JVM trên máy</button>
  </div>`;
}
