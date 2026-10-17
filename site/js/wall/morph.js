// 作品墙高度补间：切换分类时，离场卡脱离文档流，.wall 的自然高度会瞬间塌缩或弹开。
// 做法（FLIP + WAAPI，全部走同一条 document.timeline）：切换前量出各卡起点矩形，切换后量出终点矩形与自然新高度，
// 常驻卡用 translate / scale 从起点播到终点，进场卡淡入，离场卡留在原位淡出，墙高从旧值缓动到新值；
// 下方的字幕条与「关于」随墙底刚性下移。快速连点时后一次接管前一次（latest-wins）。
// 纯模块：顶层不碰 window / document。
import { easeFrames, lerpFrames } from '../core/tween.js';
import { playRectMorph, rectOf } from '../core/flip.js';

export const MORPH_MS = 700;
export const MORPH_EASE = 'power3InOut';
// power3InOut 中点的最大斜率：缓动为四次方，8x⁴ 在 x=.5 处斜率 32x³=4；验收脚本用它换算“每帧最大位移”
export const PEAK_SLOPE = 4;
const SETTLE_MS = 420;
const SETTLE_EASE = 'cubic-bezier(.16,1,.3,1)';
const LEAVE_MS = 400;
const ENTER_MS = 500;

export function createMorph({ wall, cards, app }) {
  const slots = cards.map(c => c.root);
  let running = false, seq = 0;
  let wallAnim = null;
  let anims = [];     // 本模块创建的全部 Animation（含上一轮结束时的视差结算）
  let handles = [];   // playRectMorph 的句柄
  let ghosts = [];    // 正在离场的卡
  let entering = [];  // 正在进场的卡

  const settled = a => a.finished.then(() => {}, () => {});
  const track = a => { anims.push(a); return a; };

  function clearGhost(g) {
    g.classList.remove('is-leaving');
    for (const p of ['left', 'top', 'width', 'height']) g.style.removeProperty(p);
    g.hidden = true;
  }
  // 取消上一轮的一切：位置在调用前已被量走，所以取消不会产生可见跳变。
  function cancelAll() {
    if (wallAnim) { wallAnim.cancel(); wallAnim = null; }
    handles.forEach(hd => hd.cancel()); handles = [];
    anims.forEach(a => a.cancel()); anims = [];
    ghosts.forEach(clearGhost); ghosts = [];
    entering.forEach(s => s.classList.remove('is-entering')); entering = [];
  }

  // 补间结束：只有最后一轮会执行（seq 对不上说明已被后一次接管）。
  function end(mine) {
    if (mine !== seq) return;
    wallAnim = null; handles = [];
    anims.forEach(a => a.cancel()); anims = []; // 已播完；离场卡的 fill:'forwards' 要在这里摘掉，否则之后再显示时仍是透明的
    running = false;
    wall.classList.remove('is-morphing');
    ghosts.forEach(clearGhost); ghosts = [];
    entering.forEach(s => s.classList.remove('is-entering')); entering = [];
    // 视差结算：恢复视差并重算（只此一次）。常驻卡的视差 y 会按新布局重算，用独立的 translate
    // 属性把这次位移补偿成缓动，避免瞬间跳变。lite 档没有视差，直接跳过。
    // resume() 返回时各卡的新 y 已同步写好，所以同一个任务里读“之后”的位置并补偿，首帧即无跳变。
    if (!app.parallax) return;
    const roots = slots.filter(r => !r.hidden);
    const before = roots.map(r => r.getBoundingClientRect().top);
    app.parallax.resume();
    roots.forEach((r, i) => {
      const d = before[i] - r.getBoundingClientRect().top;
      if (Math.abs(d) > 0.5 && r.animate) track(r.animate([{ translate: `0 ${d}px` }, { translate: '0 0' }], { duration: SETTLE_MS, easing: SETTLE_EASE }));
    });
  }

  // mutate()：负责切换各卡的 hidden。
  function run(mutate) {
    const mine = ++seq;
    const h0 = wall.getBoundingClientRect().height; // 上一轮补间进行中时，这里读到的是当前中间值
    const first = new Map();                          // 起点：所有正在渲染的卡（含上一轮还没收尾的离场卡）
    for (const s of slots) if (!s.hidden) first.set(s, { rect: rectOf(s), opacity: Number(getComputedStyle(s).opacity) });
    cancelAll();
    mutate();
    const h1 = wall.getBoundingClientRect().height;  // 自然新高度：此时没有进行中的动画，也没有离场卡
    const last = new Map();
    for (const s of slots) if (!s.hidden) last.set(s, rectOf(s));
    if (!running) { running = true; if (app.parallax) app.parallax.pause(); }
    wall.classList.add('is-morphing');                // 离场卡以墙为定位参照；同时裁掉压出墙底的部分（见 wall.css）
    const wr = wall.getBoundingClientRect();
    const finished = [];

    for (const [s, f] of first) {
      if (last.has(s)) continue;
      // 离场：脱离网格流，停在起点矩形上淡出
      s.classList.add('is-leaving');
      s.hidden = false;
      s.style.left = (f.rect.left - wr.left - wall.clientLeft) + 'px';
      s.style.top = (f.rect.top - wr.top - wall.clientTop) + 'px';
      s.style.width = f.rect.width + 'px';
      s.style.height = f.rect.height + 'px';
      ghosts.push(s);
      const a = track(s.animate(lerpFrames('power1Out', { opacity: [f.opacity, 0], scale: [1, 0.8] }).map(k => ({ offset: k.offset, opacity: k.opacity, scale: String(k.scale) })), { duration: LEAVE_MS, easing: 'linear', fill: 'forwards' }));
      finished.push(settled(a));
    }
    for (const [s, rect] of last) {
      const f = first.get(s);
      if (!f) {
        // 进场：在终点位置淡入并放大
        s.classList.add('is-entering');
        entering.push(s);
        const a = track(s.animate(lerpFrames('power1Out', { opacity: [0, 1], scale: [0.8, 1] }).map(k => ({ offset: k.offset, opacity: k.opacity, scale: String(k.scale) })), { duration: ENTER_MS, easing: 'linear', fill: 'backwards' }));
        finished.push(settled(a));
        continue;
      }
      // 常驻：从起点矩形播到终点矩形
      const hd = playRectMorph(s, f.rect, rect, { duration: MORPH_MS, ease: MORPH_EASE, scale: true });
      handles.push(hd); finished.push(hd.finished);
      if (f.opacity < 0.999) {
        const a = track(s.animate(lerpFrames('power1Out', { opacity: [f.opacity, 1] }), { duration: ENTER_MS, easing: 'linear' }));
        finished.push(settled(a));
      }
    }
    // 墙高：与卡片位移同一时钟、同一缓动，从第一帧起就覆盖自然高度，不需要内联钉高
    if (Math.abs(h1 - h0) > 0.5) {
      wallAnim = wall.animate(easeFrames(MORPH_EASE, h0, h1).map(k => ({ offset: k.offset, height: k.value + 'px' })), { duration: MORPH_MS, easing: 'linear' });
      finished.push(settled(wallAnim));
    }
    Promise.all(finished).then(() => end(mine));
  }

  return { run };
}
