// 碎片擦除：红（领头窄带）、蓝、白三层斜四边形。菜单 / 主题切换 / 加载器共用。
// 顶点数一致，WAAPI 可直接插值。重入时取消前一次。
import { getTier } from './tier.js';

const START = 'polygon(-60% 0, -36% 0, -60% 100%, -84% 100%)';
const COVER = 'polygon(-30% 0, 130% 0, 106% 100%, -54% 100%)';
const EXIT = 'polygon(130% 0, 130% 0, 106% 100%, 106% 100%)';
const BAND_START = 'polygon(-32% 0, -24% 0, -48% 100%, -56% 100%)';
const BAND_END = 'polygon(154% 0, 162% 0, 138% 100%, 130% 100%)';
const EASE = 'cubic-bezier(.7,0,.2,1)';
const DUR = 360;

let host = null;
let layers = null;
let active = null;

function ensure() {
  if (host) return;
  host = document.createElement('div');
  host.className = 'wipe';
  host.setAttribute('aria-hidden', 'true');
  layers = {};
  for (const k of ['white', 'blue', 'red']) {
    const i = document.createElement('i');
    i.className = 'w-' + k;
    host.appendChild(i);
    layers[k] = i;
  }
  document.body.appendChild(host);
}
const run = (el, frames, opts) => el.animate(frames, { fill: 'both', easing: EASE, ...opts });
const done = anims => Promise.all(anims.map(a => a.finished.catch(() => {})));

// wipe({ onCover, top }) -> Promise。top：最上层颜色（默认白；主题切换时传入目标底色）。
export async function wipe({ onCover, top } = {}) {
  ensure();
  if (active) active.cancel();
  releaseHeld();
  let cancelled = false;
  const anims = [];
  active = { cancel() { cancelled = true; anims.forEach(a => a.cancel()); } };
  const me = active;
  layers.white.style.background = top || '';
  const calm = getTier() === 'calm' || (host.dataset.calm === '1');
  host.classList.toggle('is-calm', calm);
  try {
    if (calm) {
      const a = run(layers.white, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'linear' });
      anims.push(a); await done([a]);
      if (cancelled) return;
      if (onCover) await onCover();
      const b = run(layers.white, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear' });
      anims.push(b); await done([b]);
    } else {
      const enter = [
        run(layers.red, [{ clipPath: BAND_START }, { clipPath: BAND_END }], { duration: DUR + 120, easing: 'cubic-bezier(.5,0,.3,1)' }),
        run(layers.blue, [{ clipPath: START }, { clipPath: COVER }], { duration: DUR, delay: 90 }),
        run(layers.white, [{ clipPath: START }, { clipPath: COVER }], { duration: DUR, delay: 180 })
      ];
      anims.push(...enter); await done(enter);
      if (cancelled) return;
      if (onCover) await onCover();
      const out = [
        run(layers.white, [{ clipPath: COVER }, { clipPath: EXIT }], { duration: DUR }),
        run(layers.blue, [{ clipPath: COVER }, { clipPath: EXIT }], { duration: DUR, delay: 90 }),
        run(layers.red, [{ clipPath: BAND_START }, { clipPath: BAND_END }], { duration: DUR + 120, delay: 60, easing: 'cubic-bezier(.5,0,.3,1)' })
      ];
      anims.push(...out); await done(out);
    }
  } finally {
    if (active === me) {
      active = null;
      anims.forEach(a => { try { a.cancel(); } catch { /* 已结束 */ } });
      for (const el of Object.values(layers)) { el.style.clipPath = ''; el.style.opacity = ''; }
      layers.white.style.background = '';
    }
  }
}
export function forceCalmWipe(v) { ensure(); host.dataset.calm = v ? '1' : '0'; }

// ---- 跨页面过渡：离开页面时“盖住并停留”，到达页面时“从盖住状态擦出” ----
const isCalm = () => getTier() === 'calm' || (host && host.dataset.calm === '1');
let held = null; // wipeCover 结束后停留在遮盖态的动画（fill:both），由 wipeReveal / wipeReset 释放
function releaseHeld() {
  if (!held) return;
  held.forEach(a => { try { a.cancel(); } catch { /* 已结束 */ } });
  held = null;
}
function clearInline() {
  for (const el of Object.values(layers || {})) { el.style.clipPath = ''; el.style.opacity = ''; }
  if (layers) layers.white.style.background = '';
}
// wipeCover({ top }) -> Promise<boolean>：播放进入段并停留在遮盖态；被新的擦除打断时返回 false。
export async function wipeCover({ top } = {}) {
  ensure();
  if (active) active.cancel();
  releaseHeld();
  let cancelled = false;
  const anims = [];
  const me = active = { cancel() { cancelled = true; anims.forEach(a => a.cancel()); } };
  layers.white.style.background = top || '';
  const calm = isCalm();
  host.classList.toggle('is-calm', calm);
  try {
    if (calm) anims.push(run(layers.white, [{ opacity: 0 }, { opacity: 1 }], { duration: 150, easing: 'linear' }));
    else anims.push(
      run(layers.red, [{ clipPath: BAND_START }, { clipPath: BAND_END }], { duration: DUR + 120, easing: 'cubic-bezier(.5,0,.3,1)' }),
      run(layers.blue, [{ clipPath: START }, { clipPath: COVER }], { duration: DUR, delay: 90 }),
      run(layers.white, [{ clipPath: START }, { clipPath: COVER }], { duration: DUR, delay: 180 })
    );
    await done(anims);
    if (cancelled) return false;
    held = anims;
    return true;
  } finally {
    if (active === me) active = null;
    if (held !== anims) anims.forEach(a => { try { a.cancel(); } catch { /* 已结束 */ } });
  }
}
// wipeReveal({ top, onCover }) -> Promise：先同步进入遮盖态（若尚未处于），触发 onCover，再播放退出段并清理。
export async function wipeReveal({ top, onCover } = {}) {
  ensure();
  if (active) active.cancel();
  let cancelled = false;
  const anims = [];
  const me = active = { cancel() { cancelled = true; anims.forEach(a => a.cancel()); } };
  layers.white.style.background = top || '';
  const calm = isCalm();
  host.classList.toggle('is-calm', calm);
  // 先用内联样式钉住遮盖态，再释放停留的动画，避免任何一帧露底
  if (calm) layers.white.style.opacity = '1';
  else { layers.white.style.clipPath = COVER; layers.blue.style.clipPath = COVER; layers.red.style.clipPath = BAND_END; }
  releaseHeld();
  try {
    if (onCover) await onCover();
    if (cancelled) return;
    if (calm) anims.push(run(layers.white, [{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: 'linear' }));
    else anims.push(
      run(layers.white, [{ clipPath: COVER }, { clipPath: EXIT }], { duration: DUR }),
      run(layers.blue, [{ clipPath: COVER }, { clipPath: EXIT }], { duration: DUR, delay: 90 }),
      run(layers.red, [{ clipPath: BAND_START }, { clipPath: BAND_END }], { duration: DUR + 120, delay: 60, easing: 'cubic-bezier(.5,0,.3,1)' })
    );
    await done(anims);
  } finally {
    if (active === me) {
      active = null;
      anims.forEach(a => { try { a.cancel(); } catch { /* 已结束 */ } });
      clearInline();
    }
  }
}
// 浏览器后退/前进缓存恢复（pageshow persisted）时复位：撤掉停留的遮盖。
export function wipeReset() {
  if (!host) return;
  if (active) active.cancel();
  active = null;
  releaseHeld();
  clearInline();
}
