// 页面间的碎片擦屏过渡：离开时冒泡阶段拦截站内链接，盖住屏幕后再跳转；到达时从遮盖态擦出。
// 任何失败（动画不可用、抛错、超时）都退化为普通跳转，绝不阻塞导航。首页与子页面共用。
import { getTier } from './tier.js';
import { wipeCover, wipeReveal, wipeReset } from './wipe.js';

const LEAVE_TIMEOUT = 700; // 盖屏最长等待；超时直接跳转
const NO_TARGET = new Set(['', '_self']);

// 纯函数：这次点击是否应该走擦屏过渡。link 为 { href, target, download, rel, noTransition, button, ctrlKey, metaKey, shiftKey, altKey, defaultPrevented }，
// loc 为 { href, origin, pathname }，opts.tier 为当前动效档（calm 不拦截）。
export function shouldIntercept(link, loc, opts = {}) {
  if (!link || !loc) return false;
  if (link.defaultPrevented) return false;
  if ((link.button ?? 0) !== 0) return false;
  if (link.ctrlKey || link.metaKey || link.shiftKey || link.altKey) return false;
  if (opts.tier === 'calm') return false;
  if (!NO_TARGET.has(link.target || '')) return false;
  if (link.download) return false;
  if (link.noTransition) return false;
  if (/(^|\s)external(\s|$)/i.test(link.rel || '')) return false;
  let url;
  try { url = new URL(link.href, loc.href); } catch { return false; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  if (url.origin !== loc.origin) return false;
  if (url.pathname === loc.pathname) return false; // 同页（含仅 hash / 仅查询串变化）交给页面自己处理
  return true;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
let leaving = false;
async function leave(url) {
  if (leaving) return;
  leaving = true;
  try {
    // top 用当前页面底色：与到达页首帧的 html.shard-arrive 遮罩同色，两页之间没有闪烁
    await Promise.race([wipeCover({ top: 'var(--bg)' }), sleep(LEAVE_TIMEOUT)]);
  } catch { /* 动画失败：照常跳转 */ }
  location.assign(url);
}

const canAnimate = () => typeof Element !== 'undefined' && typeof Element.prototype.animate === 'function';

// 站内程序化跳转（命令面板等）：满足条件时走过渡，否则直接跳转。
export function navigate(href) {
  let url;
  try { url = new URL(href, document.baseURI); } catch { location.assign(href); return; }
  const ok = canAnimate() && shouldIntercept({ href: url.href }, { href: location.href, origin: location.origin, pathname: location.pathname }, { tier: getTier() });
  if (ok) leave(url.href); else location.assign(url.href);
}

let armed = false;
export function armLeave() {
  if (armed || typeof document === 'undefined') return;
  armed = true;
  document.addEventListener('click', e => {
    if (!canAnimate()) return;
    const a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    const link = {
      href: a.href, target: a.getAttribute('target'), download: a.hasAttribute('download'), rel: a.getAttribute('rel'),
      noTransition: a.hasAttribute('data-no-transition'), button: e.button, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey,
      defaultPrevented: e.defaultPrevented
    };
    if (!shouldIntercept(link, { href: location.href, origin: location.origin, pathname: location.pathname }, { tier: getTier() })) return;
    e.preventDefault();
    leave(a.href);
  });
  // 从后退/前进缓存恢复时撤掉停留的遮盖，并允许再次离开
  addEventListener('pageshow', e => {
    if (!e.persisted) return;
    leaving = false;
    document.documentElement.classList.remove('shard-arrive');
    wipeReset();
  });
}

// 到达：html.shard-arrive 由首帧前的内联脚本加上（同源 referrer + 导航类型为 navigate + 非 reduced-motion）。
export async function playArrival() {
  const root = document.documentElement;
  if (!root.classList.contains('shard-arrive')) return;
  try {
    await wipeReveal({ top: 'var(--bg)', onCover: () => root.classList.remove('shard-arrive') });
  } catch {
    root.classList.remove('shard-arrive');
  }
}
