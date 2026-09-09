/**
 * Zeko UI kit — toast, modal, định dạng, thành phần nhỏ tái sử dụng.
 */

/* ── Toast ─────────────────────────────────────────────────────── */
const ICONS = { ok: '✅', bad: '⛔', warn: '⚠️', info: '💡', zeko: '⚡' };

export function toast(message, type = 'info', ms = 4200) {
  const root = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span class="ti">${ICONS[type] || ICONS.info}</span><div class="grow">${escapeHtml(message)}</div>`;
  root.appendChild(el);
  const kill = () => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 260);
  };
  el.addEventListener('click', kill);
  setTimeout(kill, ms);
  return el;
}

/* ── Modal ─────────────────────────────────────────────────────── */
let modalCleanup = null;

export function openModal(html, { wide = false, onMount } = {}) {
  const root = document.getElementById('modal-root');
  const box = document.getElementById('modal-box');
  box.className = `modal${wide ? ' wide' : ''}`;
  box.innerHTML = html;
  root.hidden = false;
  document.body.style.overflow = 'hidden';

  const close = () => {
    root.hidden = true;
    box.innerHTML = '';
    document.body.style.overflow = '';
    document.removeEventListener('keydown', onKey);
    modalCleanup?.();
    modalCleanup = null;
  };
  const onKey = (e) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
  box.querySelectorAll('[data-close]').forEach((n) => n.addEventListener('click', close));
  modalCleanup = close;
  onMount?.(box, close);
  return close;
}

export const closeModal = () => modalCleanup?.();

export function confirmModal({ title, text, confirmText = 'Xác nhận', danger = false, onConfirm }) {
  return openModal(`
    <h3>${escapeHtml(title)}</h3>
    <p class="modal-sub">${text}</p>
    <div class="modal-foot">
      <button class="btn ghost" data-close>Huỷ</button>
      <button class="btn ${danger ? 'danger' : 'primary'}" id="cf-yes">${escapeHtml(confirmText)}</button>
    </div>`, {
    onMount(box, close) {
      box.querySelector('#cf-yes').onclick = () => {
        close();
        onConfirm?.();
      };
    },
  });
}

/* ── Định dạng ─────────────────────────────────────────────────── */
export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export function humanSize(bytes) {
  if (!bytes) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(u.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function humanTime(sec) {
  if (!sec) return '0 phút';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h} giờ ${m} phút`;
  return `${m} phút`;
}

export function timeAgo(iso) {
  if (!iso) return 'chưa từng';
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'vừa xong';
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} ngày trước`;
  return new Date(iso).toLocaleDateString('vi-VN');
}

export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/* ── Thành phần nhỏ ────────────────────────────────────────────── */
export function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    n.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return n;
}

export function impactDots(n, max = 5) {
  return `<span class="impact" title="Mức tăng FPS: ${n}/${max}">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? 'on' : ''}"></i>`).join('')}</span>`;
}

export function scorePill(score, verdict) {
  const label = score === null || score === undefined ? '—' : score;
  return `<span class="score-pill ${verdict || 'clean'}">${label}</span>`;
}

export function verdictChip(verdict) {
  const map = { clean: ['ok', 'An toàn'], flag: ['info', 'Đáng chú ý'], review: ['warn', 'Cần xem xét'], threat: ['bad', 'Rủi ro cao'] };
  const [cls, label] = map[verdict] || map.clean;
  return `<span class="chip ${cls}">${label}</span>`;
}

export function severityChip(sev) {
  const map = { low: ['', 'Thấp'], medium: ['info', 'Trung bình'], high: ['warn', 'Cao'], critical: ['bad', 'Nghiêm trọng'] };
  const [cls, label] = map[sev] || ['', sev];
  return `<span class="chip ${cls}">${label}</span>`;
}

export function skeletonRows(n = 3, h = 62) {
  return Array.from({ length: n }, () => `<div class="skeleton" style="height:${h}px;margin-bottom:10px"></div>`).join('');
}

export function ring(value, max = 100, label = 'điểm', color) {
  const r = 50;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value / max));
  return `<div class="ring">
    <svg viewBox="0 0 116 116">
      <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${color || 'var(--accent)'}"/><stop offset="100%" stop-color="var(--accent-2)"/>
      </linearGradient></defs>
      <circle class="bg" cx="58" cy="58" r="${r}"/>
      <circle class="fg" cx="58" cy="58" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct)}"/>
    </svg>
    <div style="text-align:center"><b>${Math.round(value)}</b><small>${label}</small></div>
  </div>`;
}

/** Thanh FPS realtime vẽ bằng canvas — nhẹ, không dùng thư viện. */
export class FpsChart {
  constructor(canvas, { max = 240, color = '#22d3ee' } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.data = [];
    this.max = max;
    this.color = color;
    this.raf = null;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, rect.width * dpr);
    this.canvas.height = Math.max(1, rect.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    this.draw();
  }
  push(fps) {
    this.data.push(fps);
    if (this.data.length > this.w) this.data.shift();
    if (!this.raf) this.raf = requestAnimationFrame(() => { this.raf = null; this.draw(); });
  }
  draw() {
    const { ctx, w, h, data } = this;
    if (!ctx || !w) return;
    ctx.clearRect(0, 0, w, h);
    // lưới
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    if (data.length < 2) {
      ctx.fillStyle = 'rgba(255,255,255,.25)';
      ctx.font = '11px system-ui';
      ctx.fillText('Chưa có dữ liệu FPS', 10, h / 2);
      return;
    }
    const scale = Math.max(this.max, ...data) * 1.12;
    const step = w / Math.max(1, this.w - 1);
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = i * step;
      const y = h - (v / scale) * h;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'var(--accent)');
    grad.addColorStop(1, this.color);
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.lineTo((data.length - 1) * step, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    const fill = ctx.createLinearGradient(0, 0, 0, h);
    fill.addColorStop(0, 'rgba(34,211,238,.28)');
    fill.addColorStop(1, 'rgba(34,211,238,0)');
    ctx.fillStyle = fill;
    ctx.fill();
  }
}
