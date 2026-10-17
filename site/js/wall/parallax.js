// 作品墙视差：槽 .slot 承担纵向位移（CSS 变量 --py），内层 .face 承担倾斜与共享元素转场。lite / calm 不启用。
// 滚动取值：Lenis / 原生 scroll 事件（core/scroll.js 的 onScroll）+ IntersectionObserver 只更新可见卡。
import { app } from '../core/app.js';
import { onScroll } from '../core/scroll.js';

const AMPLITUDE = 46; // px：卡片进入视口底部时 +46·p，离开视口顶部时 -46·p（p 为分类视差系数）
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);

// 进度 0..1：卡片顶边刚碰到视口底边为 0，卡片底边刚离开视口顶边为 1。
export function progressFor(scrollY, vh, top, h) {
  return clamp01((scrollY + vh - top) / (vh + h));
}
export function yFor(p, par) {
  return AMPLITUDE * par * (1 - 2 * p);
}

// 文档坐标下的顶边：沿 offsetParent 链累加 offsetTop，不受 transform / translate 动画影响。
function docTop(el) {
  let top = 0;
  for (let n = el; n; n = n.offsetParent) top += n.offsetTop;
  return top;
}

export function initParallax(cards) {
  const root = document.documentElement;
  const items = cards.map(card => ({ el: card.root, par: Number(card.root.dataset.parallax || 1), top: 0, h: 0, shown: false, visible: false }));
  let vh = window.innerHeight;
  let paused = false;
  let destroyed = false;

  const measure = () => {
    vh = window.innerHeight;
    for (const it of items) {
      it.shown = !it.el.hidden && !!it.el.offsetParent;
      if (it.shown) { it.top = docTop(it.el); it.h = it.el.offsetHeight; }
    }
  };
  const write = it => {
    if (!it.shown) return;
    it.el.style.setProperty('--py', yFor(progressFor(window.scrollY, vh, it.top, it.h), it.par).toFixed(2) + 'px');
  };
  const writeAll = () => { for (const it of items) write(it); };

  const io = typeof IntersectionObserver === 'function'
    ? new IntersectionObserver(entries => {
      for (const e of entries) {
        const it = items.find(x => x.el === e.target);
        if (!it) continue;
        it.visible = e.isIntersecting;
        if (!paused) { if (!it.shown) measure(); write(it); } // 进入时算一次；离开时算最后一次（已钳位）
      }
    }, { rootMargin: '50% 0px' })
    : null;
  if (io) items.forEach(it => io.observe(it.el));

  const off = onScroll(() => {
    if (paused || destroyed) return;
    for (const it of items) if (it.shown && (it.visible || !io)) write(it);
  });

  let rafId = 0;
  const onResize = () => {
    if (rafId) return;
    rafId = requestAnimationFrame(() => { rafId = 0; if (!paused && !destroyed) { measure(); writeAll(); } });
  };
  const onLateLayout = () => { if (!paused && !destroyed) { measure(); writeAll(); } };
  window.addEventListener('resize', onResize);
  window.addEventListener('load', onLateLayout);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(onLateLayout);

  root.classList.add('has-parallax');
  measure();
  writeAll();

  const api = {
    // 暂停：保持当前 --py（墙高补间期间卡片位置由 FLIP 接管）
    pause() { paused = true; },
    // 恢复：同步重量并写入，返回时新的 --py 已生效
    resume() { paused = false; measure(); writeAll(); },
    refresh() { measure(); writeAll(); },
    destroy() {
      destroyed = true;
      off();
      if (io) io.disconnect();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('load', onLateLayout);
      root.classList.remove('has-parallax');
      for (const it of items) it.el.style.removeProperty('--py');
      if (app.parallax === api) app.parallax = null;
    }
  };
  app.parallax = api;
  return api;
}
