/**
 * Console — log thời gian thực của game + log của Zeko.
 */
import { api } from '../api.js';
import { escapeHtml, toast } from '../ui.js';
import { store, selectedInstance, renderPlaybar } from '../main.js';

export async function render(host) {
  const inst = selectedInstance();
  host.innerHTML = `
  <div class="card" style="padding:0;overflow:hidden;display:flex;flex-direction:column;height:calc(100vh - var(--topbar-h) - var(--playbar-h) - 74px);min-height:380px">
    <div class="row between" style="padding:13px 16px;border-bottom:1px solid var(--line)">
      <div class="row" style="gap:9px">
        <span class="ico">🖥️</span>
        <b>${inst ? escapeHtml(inst.name) : 'Chưa chọn instance'}</b>
        <span class="chip" id="c-state">—</span>
        <span class="chip" id="c-fps">FPS: —</span>
      </div>
      <div class="row" style="gap:7px">
        <select class="select tiny" id="c-inst" style="max-width:190px">
          ${store.instances.map((i) => `<option value="${i.id}" ${i.id === inst?.id ? 'selected' : ''}>${escapeHtml(i.name)}</option>`).join('')}
        </select>
        <input class="input" id="c-filter" placeholder="Lọc log…" style="width:150px;padding:6px 10px;font-size:11.5px" />
        <button class="btn tiny ghost" id="c-clear">🧹 Xoá</button>
        <button class="btn tiny ghost" id="c-copy">⧉ Chép</button>
        <button class="btn tiny ghost" id="c-loadfile">📄 latest.log</button>
        <button class="btn tiny primary" id="c-launch">▶ Chơi</button>
        <button class="btn tiny danger" id="c-stop" hidden>■ Dừng</button>
      </div>
    </div>
    <div class="console grow" id="c-out" style="border:none;border-radius:0"><span class="console-empty">Chưa có log. Bấm "▶ Chơi" để khởi động game, hoặc "📄 latest.log" để đọc log cũ.</span></div>
    <div class="row between" style="padding:9px 16px;border-top:1px solid var(--line);font-size:11.5px;color:var(--text-3)">
      <span id="c-count">0 dòng</span>
      <span>Zeko ghi log vào <span class="mono">logs/</span> sau mỗi phiên · <span class="kbd">Ctrl</span>+<span class="kbd">F</span> để lọc</span>
    </div>
  </div>`;
  return {};
}

export function mount(host) {
  const out = host.querySelector('#c-out');
  const stateChip = host.querySelector('#c-state');
  const fpsChip = host.querySelector('#c-fps');
  const countEl = host.querySelector('#c-count');
  const filter = host.querySelector('#c-filter');
  let lines = [];
  let autoscroll = true;

  out.addEventListener('scroll', () => {
    autoscroll = out.scrollHeight - out.scrollTop - out.clientHeight < 60;
  });

  function paint() {
    const q = filter.value.toLowerCase();
    const shown = q ? lines.filter((l) => l.line.toLowerCase().includes(q)) : lines;
    out.innerHTML = shown.length
      ? shown.slice(-1200).map((l) => `<div class="l-${cls(l)}">${escapeHtml(l.line)}</div>`).join('')
      : '<span class="console-empty">Không có dòng nào khớp bộ lọc.</span>';
    countEl.textContent = `${shown.length}/${lines.length} dòng`;
    if (autoscroll) out.scrollTop = out.scrollHeight;
  }

  function cls(l) {
    const s = l.line;
    if (l.type === 'zeko') return 'zeko';
    if (l.type === 'err' || /ERROR|Exception|Caused by|FATAL/i.test(s)) return 'err';
    if (/WARN/i.test(s)) return 'warn';
    return 'out';
  }

  function push(entry) {
    lines.push(entry);
    if (lines.length > 5000) lines.splice(0, 1500);
    paint();
  }

  const instSel = host.querySelector('#c-inst');
  instSel.onchange = () => { store.selected = instSel.value; load(); renderPlaybar(); };
  filter.oninput = paint;
  host.querySelector('#c-clear').onclick = () => { lines = []; paint(); };
  host.querySelector('#c-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(lines.map((l) => l.line).join('\n')); toast('Đã chép toàn bộ log', 'ok'); }
    catch { toast('Trình duyệt chặn clipboard', 'warn'); }
  };

  host.querySelector('#c-loadfile').onclick = async () => {
    const id = instSel.value;
    if (!id) return;
    const res = await api.instanceLogs(id);
    if (!res.lines.length) return toast('Chưa có latest.log — hãy chơi ít nhất một lần', 'warn');
    lines = res.lines.map((line) => ({ t: Date.now(), type: /ERROR|Exception/.test(line) ? 'err' : 'out', line }));
    paint();
    toast(`Đã nạp ${res.lines.length} dòng từ ${res.file}${res.fpsLines.length ? ` · ${res.fpsLines.length} dòng FPS` : ''}`, 'ok');
    if (res.fpsLines.length) {
      push({ t: Date.now(), type: 'zeko', line: `⚡ Zeko: ${res.fpsLines.length} dòng FPS tìm thấy trong log — mở bảng điều khiển để xem biểu đồ.` });
    }
  };

  host.querySelector('#c-launch').onclick = async () => {
    const id = instSel.value;
    if (!id) return;
    lines = [];
    paint();
    push({ t: Date.now(), type: 'zeko', line: '⚡ Zeko: đang dựng lệnh khởi động và chạy Sentinel…' });
    try {
      const res = await api.launch(id);
      push({ t: Date.now(), type: 'zeko', line: `✔ Đã khởi động PID ${res.pid} · hồ sơ ${res.preset} · RAM ${res.ram.minMb}–${res.ram.maxMb} MB` });
      push({ t: Date.now(), type: 'zeko', line: `$ ${res.command}` });
      stateChip.textContent = 'đang chạy';
      stateChip.className = 'chip ok';
      host.querySelector('#c-stop').hidden = false;
    } catch (err) {
      push({ t: Date.now(), type: 'zeko', line: `⛔ ${err.message}` });
      if (err.details?.command) push({ t: Date.now(), type: 'zeko', line: `$ ${err.details.command}` });
      (err.details?.problems || []).forEach((p) => push({ t: Date.now(), type: 'err', line: `• ${p}` }));
      stateChip.textContent = 'không chạy được';
      stateChip.className = 'chip bad';
    }
  };

  host.querySelector('#c-stop').onclick = async () => {
    await api.stop(instSel.value);
    push({ t: Date.now(), type: 'zeko', line: '■ Zeko: đã gửi lệnh dừng game.' });
    host.querySelector('#c-stop').hidden = true;
  };

  async function load() {
    const id = instSel.value;
    if (!id) return;
    const res = await api.console(id).catch(() => null);
    if (res?.lines?.length) {
      lines = res.lines;
      stateChip.textContent = res.running ? res.state : 'đã dừng';
      stateChip.className = `chip ${res.running ? 'ok' : ''}`;
      fpsChip.textContent = `FPS: ${res.fpsHint ?? '—'}`;
      host.querySelector('#c-stop').hidden = !res.running;
      paint();
    } else {
      lines = [];
      stateChip.textContent = 'chưa chạy';
      stateChip.className = 'chip';
      paint();
    }
  }

  const onLog = (e) => {
    if (e.detail.instanceId && e.detail.instanceId !== instSel.value) return;
    push(e.detail);
  };
  const onExit = () => {
    stateChip.textContent = 'đã dừng';
    stateChip.className = 'chip';
    host.querySelector('#c-stop').hidden = true;
    push({ t: Date.now(), type: 'zeko', line: '■ Zeko: game đã thoát.' });
  };
  window.addEventListener('zeko:log', onLog);
  window.addEventListener('zeko:exit', onExit);

  const obs = new MutationObserver(() => {
    if (!document.body.contains(out)) {
      window.removeEventListener('zeko:log', onLog);
      window.removeEventListener('zeko:exit', onExit);
      obs.disconnect();
    }
  });
  obs.observe(document.getElementById('view-wrap'), { childList: true, subtree: true });

  load();
}
