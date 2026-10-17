// 滚动：full 档 + 精细指针时创建 Lenis；其余使用原生滚动。叠层打开时 stop。
import { getTier } from './tier.js';
import { subscribe } from './ticker.js';
import { app, on } from './app.js';

let lenis = null;
export function getLenis() { return lenis; }

// 滚动订阅：window 原生 scroll 与 Lenis 的 scroll 事件合流，按 scrollY 去重后同步回调 fn(scrollY)。
// 视差等随滚动取值的逻辑只订阅这里，不再需要第二套滚动驱动。返回取消订阅函数。
const scrollListeners = new Set();
let lastY = -1;
let nativeBound = false;
function notify() {
  const y = window.scrollY;
  if (y === lastY) return;
  lastY = y;
  for (const fn of [...scrollListeners]) {
    try { fn(y); } catch (e) { console.error('[scroll] 订阅者出错', e); }
  }
}
export function onScroll(fn) {
  if (!nativeBound && typeof window !== 'undefined') { nativeBound = true; window.addEventListener('scroll', notify, { passive: true }); }
  scrollListeners.add(fn);
  return () => { scrollListeners.delete(fn); };
}

export function initScroll() {
  if (getTier() !== 'full' || typeof globalThis.Lenis !== 'function') return null;
  try {
    lenis = new globalThis.Lenis({ lerp: 0.1, smoothWheel: true });
    subscribe(t => lenis && lenis.raf(t));
    lenis.on('scroll', notify);
    on('overlay', ({ open }) => { if (!lenis) return; if (open) lenis.stop(); else if (!app.overlays) lenis.start(); });
  } catch (e) {
    console.warn('[scroll] Lenis 创建失败，使用原生滚动', e);
    lenis = null;
  }
  return lenis;
}

export function scrollToEl(target, { immediate = false } = {}) {
  const el = typeof target === 'string' ? document.getElementById(target) : target;
  if (!el) return;
  const calm = getTier() === 'calm';
  if (lenis && !immediate) lenis.scrollTo(el, { offset: 0, duration: 1.1 });
  else el.scrollIntoView({ behavior: calm || immediate ? 'auto' : 'smooth', block: 'start' });
}
export function scrollToTop() {
  if (lenis) lenis.scrollTo(0, { duration: 1.2 });
  else window.scrollTo({ top: 0, behavior: getTier() === 'calm' ? 'auto' : 'smooth' });
}
