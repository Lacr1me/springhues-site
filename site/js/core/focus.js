// 叠层的焦点管理：背景 inert、Tab 圈住、Esc 关闭、关闭后归还焦点。
import { app, emit } from './app.js';

const FOCUSABLE = 'a[href]:not([aria-disabled="true"]), button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
export function focusables(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.closest('[hidden]') && !el.closest('[inert]') && el.getClientRects().length > 0);
}
const bgSelectors = ['#main', '#chrome', '.site-foot'];
// selectors 缺省为首页的三块背景；子页面外壳传入自己的背景选择器（只增参数，旧调用不变）。
export function setBackgroundInert(on, except, selectors = bgSelectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el || (except && el.contains(except))) continue;
    if (on) el.setAttribute('inert', ''); else el.removeAttribute('inert');
  }
}

// openLayer({ el, trigger, initialFocus, onEscape, bg }) -> release()；bg：需要 inert 的背景选择器（缺省为首页三块）。
// 嵌套叠层（如详情里再开命令面板）依靠 app.overlays 计数，最后一个关闭时才解除背景 inert。
let activeBg = null;
export function openLayer({ el, trigger, initialFocus, onEscape, bg }) {
  const opener = trigger || document.activeElement;
  app.overlays += 1;
  if (bg) activeBg = bg;
  document.documentElement.classList.add('has-overlay');
  setBackgroundInert(true, el, bg || activeBg || undefined);
  emit('overlay', { open: true });
  const onKey = e => {
    if (e.key === 'Escape') {
      if (e.defaultPrevented) return;
      e.preventDefault(); e.stopPropagation();
      onEscape && onEscape();
      return;
    }
    if (e.key !== 'Tab') return;
    const list = focusables(el);
    if (!list.length) { e.preventDefault(); return; }
    const first = list[0], last = list[list.length - 1];
    if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
  };
  el.addEventListener('keydown', onKey);
  queueMicrotask(() => { (initialFocus || focusables(el)[0] || el).focus({ preventScroll: true }); });
  let released = false;
  return function release({ restore = true } = {}) {
    if (released) return;
    released = true;
    el.removeEventListener('keydown', onKey);
    app.overlays = Math.max(0, app.overlays - 1);
    if (!app.overlays) {
      setBackgroundInert(false, undefined, activeBg || undefined);
      activeBg = null;
      document.documentElement.classList.remove('has-overlay');
    }
    emit('overlay', { open: false });
    if (restore && opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true });
  };
}
