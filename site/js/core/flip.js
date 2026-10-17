// FLIP（First / Last / Invert / Play）：量出元素前后两个矩形，用 WAAPI 把“差值”播成缓动。
// 纯模块：顶层不碰 window / document。位移写在独立的 translate 属性上并用 composite:'add' 叠加，
// 不会覆盖 .face 自带的 translate（抖动偏移）、rotate（倾斜）与 transform（按压 / 倾斜）。
import { easeFrames } from './tween.js';

export function canAnimateRects() {
  return typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function'
    && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('translate', '0 0');
}

// 含进行中的 transform / translate 动画。
export function rectOf(el) {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
}

// 以中心点对齐：dx / dy 是把“最终布局”的元素推回“起点”所需的位移，sx / sy 是起点相对终点的缩放比。
export function flipDelta(first, last) {
  const dx = first.left + first.width / 2 - (last.left + last.width / 2);
  const dy = first.top + first.height / 2 - (last.top + last.height / 2);
  const sx = first.width > 0 && last.width > 0 ? first.width / last.width : 1;
  const sy = first.height > 0 && last.height > 0 ? first.height / last.height : 1;
  return { dx, dy, sx, sy };
}

const DONE = { finished: Promise.resolve(), cancel() {} };

// 返回 { finished, cancel }；finished 在播完或被取消时都会 resolve。
export function playRectMorph(el, first, last, { duration, ease = 'power3InOut', scale = false, composite = 'add' } = {}) {
  if (!el || typeof el.animate !== 'function') return DONE;
  const d = flipDelta(first, last);
  const moves = Math.abs(d.dx) > 0.01 || Math.abs(d.dy) > 0.01;
  const scales = scale && (Math.abs(d.sx - 1) > 0.0005 || Math.abs(d.sy - 1) > 0.0005);
  if (!moves && !scales) return DONE;
  const prevOrigin = el.style.transformOrigin;
  el.style.transformOrigin = '50% 50%';
  const anims = [];
  const opts = { duration, easing: 'linear', fill: 'none' };
  if (moves) {
    const frames = easeFrames(ease, 1, 0).map(f => ({ offset: f.offset, translate: `${d.dx * f.value}px ${d.dy * f.value}px` }));
    anims.push(el.animate(frames, { ...opts, composite }));
  }
  if (scales) {
    const fx = easeFrames(ease, d.sx, 1), fy = easeFrames(ease, d.sy, 1);
    anims.push(el.animate(fx.map((f, i) => ({ offset: f.offset, scale: `${f.value} ${fy[i].value}` })), { ...opts, composite: 'replace' }));
  }
  const settled = anims.map(a => a.finished.then(() => {}, () => {}));
  const finished = Promise.all(settled).then(() => { el.style.transformOrigin = prevOrigin; });
  return { finished, cancel() { anims.forEach(a => a.cancel()); } };
}
