// 磁吸按钮：[data-magnetic]，80px 范围内最多位移 8px，离开回弹。用 translate 属性，不与 hover 的 transform 冲突。
import { subscribe } from '../core/ticker.js';

export function initMagnetic() {
  const els = () => [...document.querySelectorAll('[data-magnetic]')];
  const state = new Map(); // el -> {x,y,tx,ty}
  let mx = -9999, my = -9999;
  addEventListener('pointermove', e => { if (e.pointerType !== 'touch') { mx = e.clientX; my = e.clientY; } }, { passive: true });
  subscribe(() => {
    for (const el of els()) {
      if (el.closest('[hidden]') || el.closest('[inert]')) continue;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const dx = mx - cx, dy = my - cy;
      const d = Math.hypot(dx, dy);
      const near = d < Math.max(r.width, r.height) / 2 + 80;
      const s = state.get(el) || { x: 0, y: 0 };
      const tx = near ? Math.max(-8, Math.min(8, dx * 0.18)) : 0;
      const ty = near ? Math.max(-8, Math.min(8, dy * 0.18)) : 0;
      s.x += (tx - s.x) * 0.18; s.y += (ty - s.y) * 0.18;
      state.set(el, s);
      if (Math.abs(s.x) < 0.02 && Math.abs(s.y) < 0.02 && !near) { if (el.style.translate) el.style.translate = ''; }
      else el.style.translate = `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`;
    }
  });
}
