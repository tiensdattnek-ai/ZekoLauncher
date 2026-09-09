/**
 * Giới thiệu — câu chuyện sản phẩm, kiến trúc, lộ trình, giấy phép.
 */
import { api } from '../api.js';
import { escapeHtml, humanSize, humanTime, openModal, toast } from '../ui.js';
import { store } from '../main.js';

export async function render(host) {
  const meta = store.meta || (await api.meta());
  const health = await api.health().catch(() => ({}));
  host.innerHTML = `
  <div class="grid cols-2" style="align-items:start">
    <div class="grid" style="gap:16px">
      <div class="card glass" style="text-align:center;padding:28px">
        <img src="/assets/logo.png" alt="Zeko Launcher" width="96" height="96" style="margin:0 auto 14px;border-radius:24px;box-shadow:var(--sh-2)" />
        <h2 style="font-size:26px;letter-spacing:-.02em">Zeko Launcher</h2>
        <div class="row" style="justify-content:center;gap:7px;margin:8px 0 14px">
          <span class="chip accent">v${escapeHtml(meta.app.version)}</span>
          <span class="chip">"${escapeHtml(meta.app.codename)}"</span>
          <span class="chip ${health.ok ? 'ok' : 'bad'}">${health.ok ? 'lõi đang chạy' : 'ngoại tuyến'}</span>
        </div>
        <p class="hint" style="max-width:52ch;margin:0 auto">Launcher Minecraft mã nguồn mở: giao diện hiện đại, hồ sơ hiệu năng đo theo phần cứng thật, và lớp bảo vệ tệp game do Zeko Sentinel đảm nhiệm.</p>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">✨</span> Bốn trụ cột của Zeko</div>
        <div class="grid" style="gap:11px">
          ${pillar('🎨', 'Giao diện Aurora', 'Nền kính mờ, 6 chủ đề, hiệu ứng tắt được bằng 1 nút để nhường tài nguyên cho game. Bố cục co giãn từ điện thoại tới màn hình rộng.')}
          ${pillar('⚡', 'Zeko Turbo', '4 hồ sơ hiệu năng (Máy cực yếu → Zeko Ultra) sinh ra JVM args + ghi sẵn options.txt + danh sách mod tăng FPS. Có điểm chuẩn ZPI đo CPU/đĩa/RAM để tự đề xuất.')}
          ${pillar('🛡️', 'Zeko Sentinel', '3 lớp: SHA-1 theo manifest Mojang, heuristic cấu trúc JAR/ZIP (entropy, magic bytes, thiếu metadata mod), và chữ ký các họ mã độc Minecraft. Cách ly chứ không xoá.')}
          ${pillar('🧊', 'Instance độc lập', 'Mỗi hồ sơ chơi có thư mục riêng nhưng dùng chung kho libraries/assets — không tải trùng, tiết kiệm hàng GB ổ đĩa.')}
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">🧱</span> Kiến trúc</div>
        <pre class="console" style="min-height:0;max-height:none;font-size:11px;line-height:1.6">${escapeHtml(ARCH)}</pre>
        <div class="row" style="gap:8px;margin-top:12px">
          <button class="btn tiny ghost" data-doc="/docs/ARCHITECTURE.md">📄 ARCHITECTURE.md</button>
          <button class="btn tiny ghost" data-doc="/docs/SECURITY.md">🔒 SECURITY.md</button>
          <button class="btn tiny ghost" data-doc="/docs/PERFORMANCE.md">⚡ PERFORMANCE.md</button>
          <button class="btn tiny ghost" data-doc="/README.md">📘 README.md</button>
        </div>
      </div>
    </div>

    <div class="grid" style="gap:16px">
      <div class="card">
        <div class="card-title"><span class="ico">🗺️</span> Lộ trình</div>
        <div class="timeline">
          ${roadmap('done', '1.0 Aurora', 'Giao diện Aurora, Zeko Turbo, Sentinel, instance, console SSE, điểm chuẩn máy, vùng cách ly, i18n Việt/Anh.')}
          ${roadmap('next', '1.1', 'Đăng nhập Microsoft (device-code OAuth), tải mod trực tiếp từ Modrinth/CurseForge, cài Fabric/Forge/NeoForge tự động, nhập modpack .mrpack/.zip.')}
          ${roadmap('plan', '1.2', 'Chạy đa phiên bản song song, biểu đồ FPS 1%-low trong game, hồ sơ shader, đồng bộ instance qua đám mây, trình sửa options.txt trực quan.')}
          ${roadmap('plan', '2.0', 'Bản desktop đóng gói (Tauri/Electron) + lõi C++/Qt cho Windows/Linux/macOS, cập nhật delta, dịch vụ chữ ký Sentinel cộng đồng.')}
        </div>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">📊</span> Phiên làm việc này</div>
        <table class="table"><tbody>
          ${kv('Instance đã tạo', store.instances.length)}
          ${kv('Tổng dung lượng', humanSize(store.instances.reduce((s, i) => s + (i.stats?.sizeBytes || 0), 0)))}
          ${kv('Thời gian chơi', humanTime(store.instances.reduce((s, i) => s + (i.playTimeSeconds || 0), 0)))}
          ${kv('Tệp đang cách ly', store.security?.quarantine?.items ?? 0)}
          ${kv('Danh mục phiên bản', `${meta.catalog?.source || '—'} · ${meta.catalog?.counts?.total || 0} phiên bản`)}
          ${kv('Nền tảng', `${meta.platform || '—'} · Node ${meta.node || '—'}`)}
          ${kv('Gốc dữ liệu', meta.paths?.root || '—')}
          ${kv('Máy chủ đã chạy', humanTime(health.uptimeSeconds || 0))}
        </tbody></table>
      </div>

      <div class="card">
        <div class="card-title"><span class="ico">⚖️</span> Giấy phép & ghi nhận</div>
        <p class="hint">Zeko Launcher phát hành theo <b>GPL-3.0-or-later</b>. Kiến trúc và nhiều ý tưởng lấy cảm hứng từ <a href="https://github.com/PrismLauncher/PrismLauncher" target="_blank" rel="noopener" style="color:var(--accent-2)">PrismLauncher</a> (GPL-3.0), MultiMC và PolyMC — cảm ơn cộng đồng launcher Minecraft mã nguồn mở.</p>
        <p class="hint" style="margin-top:9px">Minecraft là thương hiệu của Mojang Studios / Microsoft. Dự án này không liên kết và không được Mojang/Microsoft bảo trợ.</p>
        <p class="hint" style="margin-top:9px"><b>Zeko Sentinel không phải phần mềm diệt virus.</b> Đây là công cụ kiểm tra toàn vẹn và phát hiện bất thường trong thư mục game. Hãy luôn chạy song song Windows Defender hoặc một AV có uy tín. Xem <span class="mono">docs/SECURITY.md</span>.</p>
      </div>
    </div>
  </div>`;
  return {};
}

export function mount(host) {
  host.querySelectorAll('[data-doc]').forEach((b) => {
    b.onclick = async () => {
      const url = b.dataset.doc;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const md = await res.text();
        openModal(`<h3>${escapeHtml(url.split('/').pop())}</h3>
          <p class="modal-sub">Tài liệu đi kèm mã nguồn trong kho <span class="mono">docs/</span>.</p>
          <div class="md">${miniMarkdown(md)}</div>
          <div class="modal-foot"><button class="btn ghost" data-close>Đóng</button></div>`, { wide: true });
      } catch (err) {
        toast(`Không đọc được tài liệu: ${err.message}`, 'bad');
      }
    };
  });
}

/** Renderer markdown tối giản (không phụ thuộc thư viện ngoài). */
function miniMarkdown(md) {
  const lines = escapeHtml(md).split('\n');
  const out = [];
  let inCode = false;
  let inList = false;
  for (const raw of lines) {
    if (raw.trim().startsWith('```')) {
      if (inCode) { out.push('</pre>'); inCode = false; }
      else { if (inList) { out.push('</ul>'); inList = false; } out.push('<pre class="console" style="min-height:0;margin:8px 0;font-size:11px">'); inCode = true; }
      continue;
    }
    if (inCode) { out.push(raw + '\n'); continue; }
    if (!raw.trim()) { if (inList) { out.push('</ul>'); inList = false; } continue; }
    const h = raw.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      if (inList) { out.push('</ul>'); inList = false; }
      const lvl = Math.min(4, h[1].length);
      out.push(`<h${lvl} style="margin:14px 0 6px;font-size:${20 - lvl * 2}px">${inline(h[2])}</h${lvl}>`);
      continue;
    }
    if (/^(\s*)([-*]|\d+\.)\s+/.test(raw)) {
      if (!inList) { out.push('<ul class="grid" style="gap:5px;font-size:12.5px;color:var(--text-2)">'); inList = true; }
      out.push(`<li>${inline(raw.replace(/^(\s*)([-*]|\d+\.)\s+/, ''))}</li>`);
      continue;
    }
    if (inList) { out.push('</ul>'); inList = false; }
    out.push(`<p style="font-size:12.5px;color:var(--text-2);margin-bottom:7px">${inline(raw)}</p>`);
  }
  if (inCode) out.push('</pre>');
  if (inList) out.push('</ul>');
  return out.join('');
}

function inline(s) {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/`([^`]+)`/g, '<span class="mono" style="background:var(--surface-2);padding:1px 5px;border-radius:5px">$1</span>')
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener" style="color:var(--accent-2)">$1</a>');
}

function pillar(icon, title, desc) {
  return `<div class="card hoverable" style="padding:13px 15px">
    <div class="row" style="gap:9px"><span style="font-size:17px">${icon}</span><b style="font-size:13.5px">${escapeHtml(title)}</b></div>
    <p class="hint" style="margin-top:5px">${escapeHtml(desc)}</p></div>`;
}

function roadmap(state, ver, desc) {
  const map = { done: ['✅', 'var(--ok)'], next: ['🚧', 'var(--warn)'], plan: ['🔜', 'var(--text-3)'] };
  const [icon] = map[state];
  return `<div class="tl-item"><div class="tl-dot">${icon}</div><div><h5>${escapeHtml(ver)}</h5><p>${escapeHtml(desc)}</p></div></div>`;
}

function kv(k, v) {
  return `<tr><td style="color:var(--text-3);width:150px">${escapeHtml(k)}</td><td class="mono" style="font-size:11.5px;word-break:break-all">${escapeHtml(String(v))}</td></tr>`;
}

const ARCH = `ZekoLauncher/
├─ server/                 lõi Node.js (không cần build)
│  ├─ index.js             Express + SSE (log, tiến độ, metrics)
│  ├─ routes/api.js        ~40 endpoint REST
│  ├─ lib/
│  │  ├─ paths.js          thư mục dữ liệu theo từng OS
│  │  ├─ catalog.js        danh mục phiên bản (offline-first)
│  │  ├─ instances.js      CRUD instance + thống kê
│  │  ├─ downloads.js      hàng đợi tải + kiểm tra SHA-1
│  │  ├─ zip.js            đọc ZIP/JAR + Shannon entropy
│  │  ├─ scanner.js        ★ Zeko Sentinel (3 lớp)
│  │  ├─ quarantine.js     cách ly / khôi phục 1-chạm
│  │  ├─ performance.js    ★ Zeko Turbo (4 hồ sơ)
│  │  ├─ launcher.js       dựng JVM args + spawn game
│  │  ├─ java.js           dò JVM, chọn đúng bản Java
│  │  ├─ metrics.js        CPU/RAM/đĩa + điểm chuẩn ZPI
│  │  └─ settings.js       cấu hình + gợi ý RAM theo máy
│  └─ data/                catalog, preset, chữ ký quét
├─ client/                 UI thuần HTML/CSS/JS (ES modules)
│  ├─ css/main.css         design system Aurora
│  └─ js/                  router, api, i18n, ui-kit, 8 view
├─ scripts/                CLI quét nhanh từ terminal
└─ docs/                   kiến trúc, bảo mật, tinh chỉnh`;
