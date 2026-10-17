// 单一 rAF 循环：WebGL、Lenis、光标、倾斜共用。页面隐藏时暂停。
const subs = new Set();
let raf = 0;
let last = 0;
function frame(t) {
  raf = 0;
  const dt = last ? Math.min(100, t - last) : 16.7;
  last = t;
  for (const fn of [...subs]) {
    try { fn(t, dt); } catch (e) { subs.delete(fn); console.error('[ticker] 订阅者出错，已移除', e); }
  }
  if (subs.size && !document.hidden) raf = requestAnimationFrame(frame);
  else last = 0;
}
function kick() { if (!raf && subs.size && !document.hidden) raf = requestAnimationFrame(frame); }
export function subscribe(fn) { subs.add(fn); kick(); return () => subs.delete(fn); }
if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { last = 0; kick(); });
