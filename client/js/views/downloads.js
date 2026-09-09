/**
 * Tải xuống — hàng đợi tải tệp game có kiểm tra SHA-1.
 */
import { api } from '../api.js';
import { escapeHtml, toast, humanSize } from '../ui.js';
import { store, selectedInstance, invalidate } from '../main.js';

export async function render(host) {
  const inst = selectedInstance();
  host.innerHTML = `
  <div class="grid cols-2" style="align-items:start">
    <div class="card glass">
      <div class="card-title"><span class="ico">📥</span> Tải tệp game</div>
      ${inst ? `<div class="row" style="gap:12px;align-items:center;margin-bottom:14px">
        <div class="inst-ico" style="width:44px;height:44px;font-size:21px;margin:0">${escapeHtml(inst.icon || '🧊')}</div>
        <div class="grow"><b>${escapeHtml(inst.name)}</b>
          <div class="hint">${escapeHtml(inst.version)} · ${escapeHtml(inst.loader || 'vanilla')} · thư mục <span class="mono">${escapeHtml(inst.slug)}</span></div></div>
      </div>
      <p class="hint" style="margin-bottom:12px">Zeko tải <b>client.jar</b>, toàn bộ <b>thư viện</b> và <b>assets</b> của phiên bản, kiểm tra SHA-1 từng tệp (huỷ tải nếu không khớp), rồi tự chạy Sentinel một lần nữa trước khi cho chơi.</p>
      <div class="row" style="gap:8px">
        <button class="btn primary" id="btn-dl">📥 Tải xuống & kiểm tra</button>
        <button class="btn ghost" id="btn-check">Kiểm tra tệp đã có</button>
      </div>` : '<p class="hint">Chọn một instance trước đã.</p>'}
      <div id="dl-out" style="margin-top:14px"></div>
    </div>

    <div class="grid" style="gap:16px">
      <div class="card">
        <div class="card-title"><span class="ico">🚦</span> Hàng đợi trực tiếp <span class="spacer"></span><span class="chip" id="q-count">0 đang tải</span></div>
        <div id="queue"><div class="empty" style="padding:26px"><div class="big">📭</div><b>Hàng đợi trống</b><span class="hint">Tiến độ tải sẽ hiện ở đây theo thời gian thực.</span></div></div>
      </div>
      <div class="card">
        <div class="card-title"><span class="ico">🗂️</span> Thư viện dùng chung</div>
        <div class="hint" style="margin-bottom:10px">Các phiên bản dùng chung một kho thư viện/assets để không tải trùng — giống cách PrismLauncher làm.</div>
        <div id="dirs"></div>
      </div>
      <div class="card">
        <div class="card-title"><span class="ico">🔒</span> Vì sao phải kiểm SHA-1?</div>
        <p class="hint">Tệp tải giữa đường có thể bị hỏng hoặc bị thay đổi. Mojang công bố SHA-1 của mọi client.jar và thư viện; Zeko so khớp <b>từng tệp</b> và xoá bản tải nếu khác. Đây là lớp bảo vệ thứ nhất của Sentinel.</p>
      </div>
    </div>
  </div>`;
  return {};
}

export function mount(host) {
  const out = host.querySelector('#dl-out');
  const queueBox = host.querySelector('#queue');
  const qCount = host.querySelector('#q-count');
  const items = new Map();

  host.querySelector('#btn-dl')?.addEventListener('click', async (e) => {
    const inst = selectedInstance();
    if (!inst) return;
    e.currentTarget.disabled = true;
    out.innerHTML = '<div class="progress indeterminate"><i></i></div><div class="hint">Đang liên hệ máy chủ Mojang…</div>';
    try {
      const res = await api.download(inst.id);
      out.innerHTML = `<div class="notice ok"><span class="ni">📥</span><div>Đã đưa <b>${res.queued}</b> tệp vào hàng đợi. Theo dõi tiến độ ở khung bên phải.</div></div>`;
      toast(`Bắt đầu tải ${res.queued} tệp cho ${inst.name}`, 'ok');
    } catch (err) {
      out.innerHTML = `<div class="notice bad"><span class="ni">⛔</span><div><b>${escapeHtml(err.message)}</b>
        <div class="hint" style="margin-top:6px">Nguyên nhân thường gặp: môi trường đang chạy không mở kết nối tới piston-meta.mojang.com. Trên máy của bạn (có mạng bình thường) bước này sẽ chạy được.</div></div></div>`;
    } finally {
      e.currentTarget.disabled = false;
    }
  });

  host.querySelector('#btn-check')?.addEventListener('click', async () => {
    const inst = selectedInstance();
    if (!inst) return;
    out.innerHTML = '<div class="progress indeterminate"><i></i></div>';
    try {
      const { jobId } = await api.startScan(inst.id, false);
      let job;
      for (let i = 0; i < 300; i++) {
        job = await api.scanJob(jobId);
        if (job.state === 'done') break;
        await new Promise((r) => setTimeout(r, 350));
      }
      out.innerHTML = `<div class="notice"><span class="ni">🔎</span><div>Đã kiểm tra <b>${job?.report?.counts?.scanned || 0}</b> tệp · rủi ro ${job?.report?.riskScore}/100 · ${job?.report?.counts?.threats || 0} tệp đáng ngờ.</div></div>`;
    } catch (err) {
      out.innerHTML = `<div class="notice bad"><span class="ni">⛔</span><div>${escapeHtml(err.message)}</div></div>`;
    }
  });

  const paintQueue = () => {
    const arr = [...items.values()].slice(-14).reverse();
    qCount.textContent = `${items.size} tệp đã xử lý`;
    if (!arr.length) return;
    queueBox.innerHTML = arr
      .map(
        (d) => `<div style="margin-bottom:11px">
        <div class="row between" style="font-size:11.5px"><span class="mono ellip" style="max-width:70%">${escapeHtml(d.label)}</span>
        <b class="${d.err ? 'muted' : ''}">${d.err ? 'lỗi' : d.percent === null ? '…' : d.percent + '%'}</b></div>
        <div class="progress" style="height:5px;margin-top:4px"><i style="width:${d.err ? 100 : d.percent || 0}%;background:${d.err ? 'var(--bad)' : d.done ? 'var(--ok)' : 'var(--grad)'}"></i></div>
        ${d.done ? `<div class="hint">✔ ${escapeHtml(humanSize(d.bytes || 0))} · SHA-1 ${escapeHtml((d.sha1 || '').slice(0, 12))}…</div>` : ''}
        ${d.err ? `<div class="hint" style="color:var(--bad)">${escapeHtml(d.err)}</div>` : ''}
      </div>`
      )
      .join('');
  };

  const onDl = (e) => {
    const d = e.detail;
    const cur = items.get(d.dest || d.label) || {};
    items.set(d.dest || d.label, { ...cur, ...d });
    paintQueue();
  };
  const onDone = (e) => {
    items.set(e.detail.dest, { ...(items.get(e.detail.dest) || {}), ...e.detail, done: true, percent: 100 });
    paintQueue();
  };
  const onErr = (e) => {
    items.set(e.detail.label, { label: e.detail.label, err: e.detail.error, percent: 100 });
    paintQueue();
  };
  window.addEventListener('zeko:download', onDl);
  window.addEventListener('zeko:download-done', onDone);
  window.addEventListener('zeko:download-error', onErr);

  const obs = new MutationObserver(() => {
    if (!document.body.contains(queueBox)) {
      window.removeEventListener('zeko:download', onDl);
      window.removeEventListener('zeko:download-done', onDone);
      window.removeEventListener('zeko:download-error', onErr);
      obs.disconnect();
    }
  });
  obs.observe(document.getElementById('view-wrap'), { childList: true, subtree: true });

  const meta = store.meta;
  host.querySelector('#dirs').innerHTML = `
    <table class="table"><tbody>
      ${[['Gốc dữ liệu', meta?.paths?.root], ['Instance', meta?.paths?.instances], ['Cách ly', meta?.paths?.quarantine], ['Log', meta?.paths?.logs]]
        .map(([k, v]) => `<tr><td style="width:110px;color:var(--text-3)">${escapeHtml(k)}</td><td class="mono" style="font-size:11px;word-break:break-all">${escapeHtml(v || '—')}</td></tr>`)
        .join('')}
    </tbody></table>`;
}
