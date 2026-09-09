/**
 * Zeko Sentinel — trung tâm an toàn tệp game.
 * Quét heuristic + chữ ký, kiểm tra toàn vẹn SHA-1, vùng cách ly.
 */
import { api } from '../api.js';
import { escapeHtml, toast, openModal, confirmModal, ring, humanSize, fmtDate, severityChip } from '../ui.js';
import { store, selectedInstance, invalidate } from '../main.js';

export async function render(host) {
  const status = await api.securityStatus();
  store.security = status;
  const q = status.quarantine || { batches: 0, items: 0, bytes: 0 };
  const inst = selectedInstance();
  const instRows = status.instances || [];

  host.innerHTML = `
  <div class="notice warn" style="margin-bottom:16px">
    <span class="ni">🛡️</span>
    <div class="grow"><b>Zeko Sentinel là gì?</b> Bộ kiểm tra an toàn <i>tệp game</i>: so SHA-1 với manifest chính thức của Mojang, phân tích cấu trúc JAR/ZIP, đối chiếu chữ ký các họ mã độc Minecraft đã ghi nhận công khai và chấm điểm rủi ro heuristic.
    <br><span class="hint">Sentinel <b>không</b> diệt virus toàn hệ điều hành và không thay thế Windows Defender / phần mềm AV thật. Xem <span class="mono">docs/SECURITY.md</span>. Sentinel <b>không bao giờ xoá</b> tệp — chỉ chuyển vào vùng cách ly, khôi phục được 1 chạm.</span></div>
    <span class="chip">chữ ký v${status.rulesVersion || '—'}</span>
  </div>

  <div class="grid cols-4" style="margin-bottom:16px">
    ${mini('🧪', 'Instance đã quét', instRows.filter((i) => i.scannedAt).length + '/' + instRows.length, 'lần quét gần nhất')}
    ${mini('⚠️', 'Điểm rủi ro cao nhất', Math.max(0, ...instRows.map((i) => i.riskScore ?? 0)), 'thang 0–100')}
    ${mini('📦', 'Tệp đang cách ly', q.items, q.batches + ' lô · ' + humanSize(q.bytes))}
    ${mini('🔒', 'Chặn khởi động', status.settings?.blockOnThreat ? 'BẬT' : 'TẮT', 'khi phát hiện mối đe doạ')}
  </div>

  <div class="grid cols-2" style="align-items:start">
    <div class="grid" style="gap:16px">
      <div class="card glass">
        <div class="card-title"><span class="ico">🔎</span> Quét instance</div>
        ${inst ? `<div class="row" style="gap:12px;align-items:center">
          <div class="inst-ico" style="width:44px;height:44px;font-size:21px;margin:0">${escapeHtml(inst.icon || '🧊')}</div>
          <div class="grow"><b>${escapeHtml(inst.name)}</b><div class="hint">${escapeHtml(inst.version)} · ${inst.stats?.fileCount || 0} tệp · ${inst.stats?.sizeHuman}</div></div>
        </div>` : '<p class="hint">Chưa chọn instance.</p>'}
        <div class="row" style="gap:8px;margin-top:14px;flex-wrap:wrap">
          <button class="btn primary" id="btn-scan" ${inst ? '' : 'disabled'}>🛡 Quét toàn bộ</button>
          <button class="btn ghost" id="btn-scan-sample" ${inst ? '' : 'disabled'}>Tạo tệp mẫu kiểm thử</button>
          <select class="select" id="sel-inst" style="width:auto">
            ${store.instances.map((i) => `<option value="${i.id}" ${i.id === inst?.id ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
          </select>
        </div>
        <div id="scan-out" style="margin-top:14px"></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">🔐</span> Kiểm tra toàn vẹn (SHA-1)</div>
        <p class="hint" style="margin-bottom:12px">Chụp "ảnh gốc" SHA-1 của instance khi bạn tin rằng nó sạch. Những lần sau, Zeko so lại để phát hiện tệp nào bị thay đổi/chèn thêm — cách chắc chắn nhất để biết client.jar có bị sửa hay không.</p>
        <div class="row" style="gap:8px">
          <button class="btn ghost" id="btn-baseline" ${inst ? '' : 'disabled'}>📸 Chụp ảnh gốc</button>
          <button class="btn" id="btn-verify" ${inst ? '' : 'disabled'}>✔ Kiểm tra lại</button>
        </div>
        <div id="verify-out" style="margin-top:12px"></div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">🧬</span> Bộ quy tắc đang dùng</div>
        <div id="rules-body">${'<div class="skeleton" style="height:120px"></div>'}</div>
      </div>
    </div>

    <div class="grid" style="gap:16px">
      <div class="card">
        <div class="card-title"><span class="ico">🧊</span> Tình trạng từng instance</div>
        <table class="table"><thead><tr><th>Instance</th><th style="text-align:center">Rủi ro</th><th>Lần quét</th><th></th></tr></thead>
        <tbody>${instRows.length ? instRows.map((i) => `<tr>
          <td><b>${escapeHtml(i.name)}</b><div class="hint">${escapeHtml(i.slug)}</div></td>
          <td style="text-align:center">${i.riskScore === null ? '<span class="chip">chưa quét</span>' : `<span class="score-pill ${i.riskScore >= 70 ? 'threat' : i.riskScore >= 45 ? 'review' : i.riskScore >= 25 ? 'flag' : 'clean'}" style="font-size:13px;padding:2px 9px">${i.riskScore}</span>`}</td>
          <td class="muted">${i.scannedAt ? fmtDate(i.scannedAt) : '—'}</td>
          <td style="text-align:right"><button class="btn tiny ghost" data-scan-inst="${i.id}">Quét</button></td>
        </tr>`).join('') : '<tr><td colspan="4" class="muted">Chưa có instance.</td></tr>'}</tbody></table>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">📦</span> Vùng cách ly <span class="spacer"></span>
          <span class="chip ${q.items ? 'bad' : 'ok'}">${q.items} tệp</span></div>
        <div id="quar-body">${'<div class="skeleton" style="height:80px"></div>'}</div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">⚙️</span> Chính sách bảo mật</div>
        <div class="switch"><div><div class="t">Tự quét trước khi chơi</div><div class="d">Thêm ~1–3 giây trước khi vào game</div></div>
          <div class="toggle ${status.settings?.autoScanOnLaunch ? 'on' : ''}" data-sec="autoScanOnLaunch"><i></i></div></div>
        <div class="switch"><div><div class="t">Chặn khởi động khi có mối đe doạ</div><div class="d">Tắt = chỉ cảnh báo rồi vẫn cho chơi</div></div>
          <div class="toggle ${status.settings?.blockOnThreat ? 'on' : ''}" data-sec="blockOnThreat"><i></i></div></div>
        <div class="switch"><div><div class="t">Quét sâu (phân tích trong JAR)</div><div class="d">Chậm hơn nhưng bắt được payload giấu trong class</div></div>
          <div class="toggle ${status.settings?.deepScan ? 'on' : ''}" data-sec="deepScan"><i></i></div></div>
        <div class="switch"><div><div class="t">Kiểm tra SHA-1 khi tải tệp</div><div class="d">Huỷ tải nếu tệp không khớp chữ ký của Mojang</div></div>
          <div class="toggle ${status.settings?.scanOnDownload ? 'on' : ''}" data-sec="scanOnDownload"><i></i></div></div>
      </div>
    </div>
  </div>`;
  return { status };
}

export function mount(host) {
  const out = host.querySelector('#scan-out');
  const btn = host.querySelector('#btn-scan');
  const sel = host.querySelector('#sel-inst');
  sel.onchange = () => { store.selected = sel.value; invalidate(); };

  btn.onclick = () => runScan(sel.value || selectedInstance()?.id, out, btn);
  host.querySelector('#btn-scan-sample').onclick = async () => {
    const id = sel.value || selectedInstance()?.id;
    if (!id) return;
    await api.createSample(id, 'trap-pack');
    await api.createSample(id, 'sus-mod');
    await api.createSample(id, 'clean-pack');
    toast('Đã tạo 3 tệp mẫu: 1 pack sạch, 1 pack có .bat + PowerShell mã hoá, 1 mod giả mạo. Bấm "Quét toàn bộ".', 'ok', 9000);
  };

  host.querySelectorAll('[data-scan-inst]').forEach((b) => {
    b.onclick = () => {
      store.selected = b.dataset.scanInst;
      host.querySelector('#sel-inst').value = b.dataset.scanInst;
      runScan(b.dataset.scanInst, out, btn);
    };
  });

  host.querySelector('#btn-baseline').onclick = async () => {
    const id = sel.value || selectedInstance()?.id;
    if (!id) return;
    const b = host.querySelector('#btn-baseline');
    b.disabled = true; b.textContent = 'Đang băm SHA-1…';
    try {
      const res = await api.verify(id, 'build');
      host.querySelector('#verify-out').innerHTML = `<div class="notice ok"><span class="ni">📸</span><div>Đã lưu ảnh gốc SHA-1 cho <b>${res.files}</b> tệp.</div></div>`;
      toast(`Đã chụp ảnh gốc ${res.files} tệp`, 'ok');
    } catch (err) { toast(err.message, 'bad'); }
    finally { b.disabled = false; b.textContent = '📸 Chụp ảnh gốc'; }
  };

  host.querySelector('#btn-verify').onclick = async () => {
    const id = sel.value || selectedInstance()?.id;
    if (!id) return;
    const outv = host.querySelector('#verify-out');
    outv.innerHTML = '<div class="progress indeterminate"><i></i></div>';
    try {
      const res = await api.verify(id, 'check');
      outv.innerHTML = `<div class="notice ${res.tampered ? 'bad' : 'ok'}"><span class="ni">${res.tampered ? '⛔' : '✅'}</span>
        <div>${res.tampered ? `<b>${res.bad.length} tệp đã bị thay đổi</b> so với ảnh gốc chụp ${fmtDate(res.builtAt)}.` : 'Không có tệp nào bị thay đổi.'}
        <div class="hint">Khớp: ${res.ok} · Thiếu: ${res.missing.length} · Khác SHA-1: ${res.bad.length}</div>
        ${res.bad.length ? `<div class="console" style="max-height:140px;margin-top:8px;min-height:0">${res.bad.map((b) => `${escapeHtml(b.path)}\n  mong đợi ${b.expected}\n  thực tế  ${b.actual}`).join('\n')}</div>` : ''}
        ${res.missing.length ? `<div class="hint" style="margin-top:6px">Thiếu: ${res.missing.slice(0, 8).map(escapeHtml).join(', ')}${res.missing.length > 8 ? '…' : ''}</div>` : ''}
        </div></div>`;
    } catch (err) {
      outv.innerHTML = `<div class="notice warn"><span class="ni">💡</span><div>${escapeHtml(err.message)}</div></div>`;
    }
  };

  host.querySelectorAll('[data-sec]').forEach((tg) => {
    tg.onclick = async () => {
      tg.classList.toggle('on');
      const on = tg.classList.contains('on');
      await api.saveSettings({ security: { [tg.dataset.sec]: on } });
      store.settings = (await api.getSettings()).settings;
      toast(`Đã ${on ? 'bật' : 'tắt'}: ${tg.closest('.switch').querySelector('.t').textContent}`, 'ok', 2200);
    };
  });

  loadQuarantine(host.querySelector('#quar-body'));
  loadRules(host.querySelector('#rules-body'));
}

async function runScan(id, out, btn) {
  if (!id) return toast('Chọn instance trước', 'warn');
  btn.disabled = true;
  out.innerHTML = '<div class="progress indeterminate"><i></i></div><div class="hint">Sentinel đang đọc cấu trúc JAR, băm SHA-1 và đối chiếu chữ ký…</div>';
  try {
    const { jobId } = await api.startScan(id, true);
    let job = null;
    for (let i = 0; i < 600; i++) {
      job = await api.scanJob(jobId);
      out.innerHTML = `<div class="progress"><i style="width:${job.progress || 0}%"></i></div>
        <div class="hint" style="margin-top:6px">${job.progress || 0}% · ${escapeHtml(job.current || 'đang đọc…')}</div>`;
      if (job.state === 'done') break;
      await new Promise((r) => setTimeout(r, 350));
    }
    out.innerHTML = reportHtml(job?.report || {});
    bindReport(out);
    store.security = await api.securityStatus();
    loadQuarantine(document.querySelector('#quar-body'));
    invalidateSoft();
    const threats = job?.report?.counts?.threats || 0;
    toast(threats ? `⛔ Phát hiện ${threats} tệp rủi ro cao — đã cách ly` : `✅ Sạch: ${job?.report?.counts?.scanned || 0} tệp, rủi ro ${job?.report?.riskScore}/100`, threats ? 'bad' : 'ok', 7000);
  } catch (err) {
    out.innerHTML = `<div class="notice bad"><span class="ni">⛔</span><div>${escapeHtml(err.message)}</div></div>`;
  } finally {
    btn.disabled = false;
  }
}

function invalidateSoft() {
  const rows = document.querySelectorAll('[data-scan-inst]');
  rows.forEach((r) => r.textContent === 'Quét');
}

function reportHtml(rep) {
  if (!rep || !rep.counts) return '<p class="hint">Không có kết quả.</p>';
  const c = rep.counts;
  const color = rep.riskScore >= 70 ? 'var(--bad)' : rep.riskScore >= 45 ? 'var(--warn)' : 'var(--ok)';
  return `<div class="row" style="gap:18px;align-items:center">
      ${ring(rep.riskScore, 100, 'rủi ro', color)}
      <div class="grow">
        <div class="row" style="gap:6px;flex-wrap:wrap">
          <span class="chip bad">${c.threats} rủi ro cao</span>
          <span class="chip warn">${c.reviews} cần xem</span>
          <span class="chip info">${c.flags} đáng chú ý</span>
          <span class="chip ok">${c.clean} sạch</span>
        </div>
        <div class="hint" style="margin-top:8px">Đã quét ${c.scanned} tệp (${humanSize(rep.bytes || 0)}) trong ${((rep.durationMs || 0) / 1000).toFixed(1)} giây${c.quarantined ? ` · <b style="color:var(--bad)">đã cách ly ${c.quarantined}</b>` : ''}.</div>
      </div>
    </div>
    <div class="sep"></div>
    ${(rep.results || []).length ? (rep.results || []).slice(0, 40).map((r) => `<div class="threat-row ${r.verdict}">
      <div><div class="threat-file">${escapeHtml(r.file)}</div>
      <div class="reasons">${(r.reasons || []).map((x) => `<div class="reason">${severityChip(x.severity)} <b>${escapeHtml(x.name)}</b> <span class="muted">(+${x.points})</span> — ${escapeHtml(x.detail || '')}</div>`).join('')}</div></div>
      <div style="text-align:end"><span class="score-pill ${r.verdict}">${r.score}</span>
      <div class="hint" style="margin-top:4px">${humanSize(r.size || 0)}</div></div>
    </div>`).join('') : '<div class="notice ok"><span class="ni">✅</span><div>Không phát hiện tệp đáng ngờ nào. Tuyệt!</div></div>'}`;
}

function bindReport(root) {
  root.querySelectorAll('.threat-row').forEach((row) => {
    row.style.cursor = 'pointer';
    row.onclick = () => {
      const file = row.querySelector('.threat-file')?.textContent;
      const reasons = [...row.querySelectorAll('.reason')].map((r) => r.textContent);
      openModal(`<h3>Chi tiết phát hiện</h3><p class="modal-sub mono">${escapeHtml(file || '')}</p>
        <div class="grid" style="gap:9px">${reasons.map((r) => `<div class="notice warn"><span class="ni">🔍</span><div>${escapeHtml(r)}</div></div>`).join('')}</div>
        <div class="sep"></div>
        <div class="notice"><span class="ni">💡</span><div><b>Nên làm gì?</b> Nếu tệp này đến từ nguồn không rõ (link rút gọn, Discord, YouTube mô tả), hãy xoá. Nếu bạn tự viết mod/pack thì đây có thể là báo động giả — kiểm tra lại các chuỗi bị đánh dấu rồi thêm vào danh sách cho phép.</div></div>
        <div class="modal-foot"><button class="btn primary" data-close>Đã hiểu</button></div>`, { wide: true });
    };
  });
}

async function loadQuarantine(box) {
  if (!box) return;
  try {
    const { list, details } = await api.quarantine();
    if (!list.length) {
      box.innerHTML = '<div class="notice ok"><span class="ni">🧼</span><div>Vùng cách ly trống — chưa có tệp nào bị giữ lại.</div></div>';
      return;
    }
    box.innerHTML = details
      .slice(0, 8)
      .map(
        (b) => `<div class="threat-row ${b.restored ? '' : 'review'}" style="margin-bottom:9px">
        <div><div class="threat-file">${escapeHtml(b.batch)}</div>
          <div class="hint">${fmtDate(b.createdAt)} · nguồn <span class="mono">${escapeHtml(b.sourceRoot.split(/[\\/]/).pop() || '')}</span> · ${b.items?.length || 0} tệp${b.restored ? ' · <b style="color:var(--ok)">đã khôi phục</b>' : ''}</div>
          <div class="reasons">${(b.items || []).slice(0, 3).map((i) => `<div class="reason">📄 <b>${escapeHtml(i.rel)}</b> ${i.score !== null ? `<span class="chip ${i.verdict}" style="font-size:10px">${i.score}</span>` : ''}</div>`).join('')}</div>
        </div>
        <div style="display:grid;gap:6px;justify-items:end">
          <button class="btn tiny ghost" data-restore="${b.batch}" ${b.restored ? 'disabled' : ''}>↩ Khôi phục</button>
          <button class="btn tiny danger" data-purge="${b.batch}">Xoá hẳn</button>
        </div></div>`
      )
      .join('');

    box.querySelectorAll('[data-restore]').forEach((b) => {
      b.onclick = async () => {
        const res = await api.restore(b.dataset.restore);
        toast(`Đã khôi phục ${res.restored.length} tệp${res.conflicts.length ? `, bỏ qua ${res.conflicts.length} (đã tồn tại)` : ''}`, 'ok');
        loadQuarantine(box);
        store.security = await api.securityStatus();
      };
    });
    box.querySelectorAll('[data-purge]').forEach((b) => {
      b.onclick = () =>
        confirmModal({
          title: 'Xoá hẳn lô cách ly này?',
          text: 'Các tệp trong lô sẽ bị xoá vĩnh viễn khỏi vùng cách ly. Chỉ làm vậy khi bạn chắc chắn chúng độc hại.',
          confirmText: 'Xoá hẳn',
          danger: true,
          onConfirm: async () => {
            await api.purge(b.dataset.purge);
            toast('Đã xoá lô cách ly', 'warn');
            loadQuarantine(box);
            store.security = await api.securityStatus();
          },
        });
    });
  } catch (err) {
    box.innerHTML = `<div class="notice bad"><span class="ni">⛔</span><div>${escapeHtml(err.message)}</div></div>`;
  }
}

async function loadRules(box) {
  if (!box) return;
  try {
    const res = await api.securityStatus();
    const rules = await api.rules().catch(() => null);
    if (!rules) {
      box.innerHTML = `<div class="hint">Bộ chữ ký phiên bản <b>v${res.rulesVersion || '—'}</b>. Gồm 3 lớp: SHA-1 theo manifest Mojang, heuristic cấu trúc JAR/ZIP, và chữ ký theo mẫu.</div>
      <div class="grid" style="gap:7px;margin-top:10px">
        ${[['Lớp 1 · VERIFY', 'So SHA-1 của client.jar và thư viện với manifest chính thức → biết ngay file gốc có bị sửa.'],
           ['Lớp 2 · HEURISTIC', 'JAR có .exe/.bat/.ps1? Magic bytes MZ/ELF? Thiếu fabric.mod.json? Entropy > 7.9? URL lạ?'],
           ['Lớp 3 · SIGNATURE', 'Chuỗi đặc trưng của stealer/rat/trap-pack: lastlogin, discord tokens, -encodedcommand, webhook…']]
          .map(([t, d]) => `<div class="card" style="padding:11px 13px"><b style="font-size:12.5px">${t}</b><div class="hint">${d}</div></div>`).join('')}
      </div>`;
      return;
    }
    box.innerHTML = `<table class="table"><tbody>${rules.signatures.map((s) => `<tr><td class="mono" style="width:120px">${escapeHtml(s.id)}</td><td><b>${escapeHtml(s.name)}</b><div class="hint">${escapeHtml(s.desc)}</div></td><td style="text-align:right">${severityChip(s.severity)}<div class="hint">+${s.weight}</div></td></tr>`).join('')}</tbody></table>`;
  } catch {
    box.innerHTML = '<p class="hint">Không đọc được danh sách quy tắc.</p>';
  }
}

function mini(icon, k, v, d) {
  return `<div class="card hoverable" style="padding:14px 16px"><div class="stat">
    <span class="k">${icon} ${escapeHtml(k)}</span><span class="v">${escapeHtml(String(v))}</span><span class="d">${escapeHtml(d || '')}</span>
  </div></div>`;
}
