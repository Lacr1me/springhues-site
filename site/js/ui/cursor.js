// 自定义光标：三色碎片（蓝主体 + 白边 + 红刃尖）。仅 full 档 + 精细指针；输入框恢复原生；创建失败不隐藏原生光标。
import { subscribe } from '../core/ticker.js';
import { h } from '../core/dom.js';

const LABELS = { open: 'OPEN', play: 'PLAY', download: 'DOWNLOAD', skip: 'SKIP', copy: 'COPY' };

// 原生滚动条不派发移动事件，自定义光标会停在原地。指针进入滚动条前先切回系统光标。
function onScrollbar(target, e) {
  const panel = target.closest && target.closest('.detail-panel');
  if (panel) {
    const r = panel.getBoundingClientRect();
    const sbw = panel.offsetWidth - panel.clientWidth;
    const sbh = panel.offsetHeight - panel.clientHeight;
    if (sbw > 0 && e.clientX >= r.right - sbw - 4) return true;
    if (sbh > 0 && e.clientY >= r.bottom - sbh - 4) return true;
  }
  const docw = window.innerWidth - document.documentElement.clientWidth;
  const doch = window.innerHeight - document.documentElement.clientHeight;
  if (docw > 0 && e.clientX >= document.documentElement.clientWidth - 4) return true;
  if (doch > 0 && e.clientY >= document.documentElement.clientHeight - 4) return true;
  return false;
}

export function initCursor() {
  let el;
  try {
    el = h('div', { class: 'cursor', 'aria-hidden': 'true' }, h('i', { class: 'c-white' }), h('i', { class: 'c-blue' }), h('i', { class: 'c-red' }), h('i', { class: 'c-label' }, 'OPEN'));
    document.body.appendChild(el);
  } catch (e) { console.warn('[cursor] 创建失败，保留原生光标', e); return; }
  const label = el.querySelector('.c-label');
  let x = innerWidth / 2, y = innerHeight / 2, seen = false;
  addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    x = e.clientX; y = e.clientY;
    if (!seen) { seen = true; document.documentElement.classList.add('has-cursor'); }
    const t = e.target;
    const typing = t.closest && t.closest('input, textarea, [contenteditable="true"]');
    const native = !!typing || onScrollbar(t, e);
    document.documentElement.classList.toggle('native-cursor', native);
    el.classList.toggle('is-native', native);
    const hot = t.closest && t.closest('[data-cursor]');
    el.classList.toggle('is-hot', !!hot && !native);
    if (hot) label.textContent = LABELS[hot.dataset.cursor] || 'OPEN';
  }, { passive: true });
  addEventListener('pointerdown', () => el.classList.add('is-down'));
  addEventListener('pointerup', () => el.classList.remove('is-down'));
  document.addEventListener('pointerleave', () => document.documentElement.classList.remove('has-cursor'));
  document.addEventListener('pointerenter', () => { if (seen) document.documentElement.classList.add('has-cursor'); });
  subscribe(() => {
    // 跟随指针本身，不做缓动：缓动会与实际指针错位，尤其在按钮和滚动条附近。
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
  });
}
