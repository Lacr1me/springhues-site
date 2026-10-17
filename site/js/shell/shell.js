// 子页面外壳：页首（logo、页名、主题、菜单）、全屏菜单、页脚、擦屏过渡、reveal。
// 轻量：只依赖 core/{tier,store,wipe,focus,page-transition}，不加载 hero / wall / loader 等首页专属模块。
// 只在 html.shard-live 下运行；日报导出运行时没有该类（见 site/boot.js），这里立即返回，零 DOM、零副作用。
import { initTier, readEnv, getTier } from '../core/tier.js';
import { KEYS, read, write } from '../core/store.js';
import { wipe } from '../core/wipe.js';
import { openLayer } from '../core/focus.js';
import { armLeave, playArrival } from '../core/page-transition.js';
import { PRIMARY, PAGES, FOOTER, pageInfo } from './links.js';

const root = document.documentElement;
const COLORS = { day: '#F4F6FF', night: '#0D1850' };
const SVG = 'http://www.w3.org/2000/svg';

function el(tag, attrs, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) n.setAttribute(k, v === true ? '' : String(v));
  for (const k of kids) if (k != null) n.append(k);
  return n;
}
function icon(cls, ...paths) {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'sd-ic ' + cls); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  for (const d of paths) { const p = document.createElementNS(SVG, d.startsWith('c:') ? 'circle' : 'path'); if (d.startsWith('c:')) { const [cx, cy, r] = d.slice(2).split(','); p.setAttribute('cx', cx); p.setAttribute('cy', cy); p.setAttribute('r', r); } else p.setAttribute('d', d); svg.append(p); }
  return svg;
}

function init() {
  initTier(readEnv());
  const siteRoot = new URL('../../../', import.meta.url);
  const abs = href => new URL(href, siteRoot).href;
  const body = document.body;
  const key = body.dataset.sitePage || '';
  const info = pageInfo(key);
  const title = info ? info.cn : (body.dataset.sdTitle || document.title.split('·')[0].trim());
  const en = info ? info.en : (body.dataset.sdTitleEn || '');

  // 跳转目标：页面里的 <main>（game / minsheng 的 main 已有 id="top"，不改动它们）
  const main = document.querySelector('main');
  if (main && !main.id) main.id = 'main';
  if (main && !main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');
  const skip = el('a', { class: 'sd-skip', href: '#' + (main ? main.id : 'main') }, '跳到主要内容');

  const themeBtn = el('button', { class: 'sd-act', type: 'button' }, icon('sd-ic-sun', 'c:12,12,4', 'M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4'), icon('sd-ic-moon', 'M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z'));
  const menuBtn = el('button', { class: 'sd-act', type: 'button', 'aria-expanded': 'false', 'aria-controls': 'sdMenu', 'aria-label': '打开菜单' }, icon('', 'M3 7h18M3 12h12M3 17h18'));
  const titleBar = el('div', { class: 'sd-title', 'aria-hidden': 'true' }, el('b', {}, title), en ? el('i', {}, en) : null);
  const header = el('header', { class: 'sd-top' },
    el('a', { class: 'sd-corner', href: abs('./'), 'aria-label': 'Springhues 首页' }), titleBar,
    el('div', { class: 'sd-actions', role: 'group', 'aria-label': '快捷操作' }, themeBtn, menuBtn));

  const links = [...PRIMARY, ...PAGES];
  const menuNav = el('nav', { class: 'sd-menu-nav', 'aria-label': '菜单' }, ...links.map(l => {
    const a = el('a', { href: abs(l.href) }, el('span', { class: 'no', 'aria-hidden': 'true' }, l.no), el('span', { class: 'cn' }, l.cn), el('span', { class: 'en', 'aria-hidden': 'true' }, l.en));
    if (l.key === key) a.setAttribute('aria-current', 'page');
    return a;
  }));
  const closeBtn = el('button', { class: 'sd-menu-close', type: 'button', 'aria-label': '关闭菜单' }, icon('', 'm18 6-12 12M6 6l12 12'));
  const menu = el('div', { id: 'sdMenu', class: 'sd-menu', role: 'dialog', 'aria-modal': 'true', 'aria-label': '菜单', hidden: true }, menuNav, closeBtn);

  const foot = el('footer', { class: 'sd-foot' }, el('div', { class: 'sd-foot-inner' },
    el('nav', { 'aria-label': '站内入口' }, ...FOOTER.map(l => { const a = el('a', { href: abs(l.href) }, l.cn); if (l.key === key) a.setAttribute('aria-current', 'page'); return a; })),
    el('p', {}, '© 2026 Springhues · 作品与日常')));

  body.prepend(skip, header);
  body.append(menu, foot);

  // ---- 主题：与首页共用键；跟随系统直到手动选择 ----
  const current = () => (root.getAttribute('data-theme') === 'night' ? 'night' : 'day');
  function apply(theme) {
    root.setAttribute('data-theme', theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', COLORS[theme]);
    themeBtn.setAttribute('aria-label', theme === 'night' ? '切换到昼间主题（当前夜间）' : '切换到夜间主题（当前昼间）');
  }
  apply(current());
  let themeBusy = false;
  themeBtn.addEventListener('click', async () => {
    if (themeBusy) return;
    themeBusy = true;
    const next = current() === 'night' ? 'day' : 'night';
    write('local', KEYS.theme, next);
    try { await wipe({ top: COLORS[next], onCover: () => apply(next) }); } catch { apply(next); }
    themeBusy = false;
  });
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', e => { if (!read('local', KEYS.theme)) apply(e.matches ? 'night' : 'day'); });
  addEventListener('storage', e => { if (e.key === KEYS.theme && (e.newValue === 'day' || e.newValue === 'night')) apply(e.newValue); });

  // ---- 菜单 ----
  let release = null, menuBusy = false;
  const bg = ['main', '.sd-top', '.sd-foot', 'body > .site-bar', 'body > footer.shell', 'body > footer:not(.sd-foot)'];
  const label = open => { menuBtn.setAttribute('aria-expanded', String(open)); menuBtn.setAttribute('aria-label', open ? '关闭菜单' : '打开菜单'); };
  async function openMenu() {
    if (menuBusy || release) return;
    menuBusy = true;
    const show = () => { menu.hidden = false; release = openLayer({ el: menu, trigger: menuBtn, onEscape: closeMenu, bg }); label(true); };
    try { await wipe({ onCover: show }); } catch { if (!release) show(); }
    menuBusy = false;
  }
  async function closeMenu() {
    if (menuBusy || !release) return;
    menuBusy = true;
    const hide = () => { menu.hidden = true; const r = release; release = null; label(false); r && r(); };
    try { await wipe({ onCover: hide }); } catch { if (release) hide(); }
    menuBusy = false;
  }
  menuBtn.addEventListener('click', () => (release ? closeMenu() : openMenu()));
  closeBtn.addEventListener('click', () => closeMenu());

  armLeave();
  playArrival();
  initReveal();
}

// reveal：[data-sd-reveal] 进入视口时用 WAAPI 淡入上移；data-sd-reveal="n" 为同批错峰序号。
function initReveal() {
  const items = [...document.querySelectorAll('[data-sd-reveal]')];
  if (!items.length) return;
  const play = el => {
    if (el.classList.contains('is-in')) return;
    el.classList.add('is-in');
    if (getTier() === 'calm' || typeof el.animate !== 'function') return;
    const i = Number(el.getAttribute('data-sd-reveal')) || 0;
    try { el.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: 620, delay: i * 70, easing: 'cubic-bezier(.16,1,.3,1)', fill: 'backwards' }); } catch { /* 动画失败：内容已可见 */ }
  };
  if (!('IntersectionObserver' in window)) { items.forEach(play); return; }
  const io = new IntersectionObserver(entries => { for (const e of entries) if (e.isIntersecting) { play(e.target); io.unobserve(e.target); } }, { rootMargin: '0px 0px -8% 0px' });
  items.forEach(n => io.observe(n));
}

if (root.classList.contains('shard-live')) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
}
