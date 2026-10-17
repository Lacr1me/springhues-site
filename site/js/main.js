// 启动器：tier、主题、并行拉数据、动态 import 其余模块。入口之外的模块路径一律不带查询串。
import { initTier, readEnv, getTier } from './core/tier.js';
import { legacyRoute, parseHash, parseAnchor } from './core/url.js';
import { armLeave, playArrival } from './core/page-transition.js';
import { app } from './core/app.js';
import { parseWorks } from './data/works.js';
import { createArchive } from './data/archive.js';

const root = document.documentElement;
const tier = initTier(readEnv());
const safe = async (name, fn) => { try { return await fn(); } catch (e) { console.error('[main] ' + name + ' 失败', e); return null; } };

// 未捕获异常：加载期间放弃动效，保证页面可用
const failFast = () => { if (root.classList.contains('is-loading')) root.classList.add('js-failed'); };
addEventListener('error', failFast);
addEventListener('unhandledrejection', failFast);

// 旧首页链接：先映射，再清掉 search（新首页自己不使用查询参数）
const legacy = legacyRoute(location.search);
if (location.search) history.replaceState(history.state, '', location.pathname + location.hash);

root.classList.add('title-prep');
app.archive = createArchive();
const archive = app.archive;
const archiveReady = archive.applyLinks(document); // 与作品墙互相独立：works.json 失败也会改写 ?date=

// 数据与 vendor 并行启动
const worksUrl = 'site/works.json';
async function fetchWorks() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(worksUrl, { cache: 'no-cache', signal: controller.signal, credentials: 'same-origin' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return parseWorks(await res.json());
  } finally { clearTimeout(timer); }
}
const vendors = safe('vendor', async () => {
  const { loadLenis } = await import('./core/vendor.js');
  await loadLenis();
});

const modules = {};
const loadModule = async (key, path) => { modules[key] = await safe(key, () => import(path)); return modules[key]; };

// ---- 开场 ----
const img = document.getElementById('heroImg');
const imgReady = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
const ready = Promise.all([imgReady, document.fonts ? document.fonts.ready : Promise.resolve()]);
let revealed = false;
let resolveRevealed;
const revealedP = new Promise(r => { resolveRevealed = r; });
let hero = null;
async function onReveal() {
  if (revealed) return;
  revealed = true;
  root.classList.remove('js-failed');
  playArrival(); // 从子页面到达时：从遮盖态擦出（html.shard-arrive 由 index.html 内联脚本在首帧前加上）
  await safe('hero.intro', () => hero && hero.intro());
  modules.counters && modules.counters.armCounters();
  await safe('scroll', async () => { await vendors; (await import('./core/scroll.js')).initScroll(); });
  if (modules.about) { modules.about.initReveal(); modules.about.initAbout(); }
  if (getTier() === 'full') { const c = await safe('cursor', () => import('./ui/cursor.js')); c && c.initCursor(); }
  resolveRevealed();
}

(async () => {
  await Promise.all([
    loadModule('corners', './ui/corners.js'), loadModule('menu', './ui/menu.js'), loadModule('palette', './ui/palette.js'), loadModule('theme', './ui/theme.js'),
    loadModule('counters', './ui/counters.js'), loadModule('about', './ui/about.js'), loadModule('egg', './ui/egg.js'), loadModule('magnetic', './ui/magnetic.js'),
    loadModule('hero', './hero/hero.js')
  ]);
  const m = modules;
  m.theme && safe('theme', () => m.theme.initTheme());
  m.corners && safe('corners', () => m.corners.initCorners());
  m.menu && safe('menu', () => m.menu.initMenu());
  m.palette && safe('palette', () => m.palette.initPalette());
  m.egg && safe('egg', () => m.egg.initEgg());
  if (tier !== 'calm' && matchMedia('(pointer: fine)').matches && m.magnetic) safe('magnetic', () => m.magnetic.initMagnetic());
  hero = m.hero ? await safe('hero', () => m.hero.initHero()) : null;
  document.getElementById('toTop').addEventListener('click', async () => (await import('./core/scroll.js')).scrollToTop());
  document.querySelector('.scroll-cue').addEventListener('click', async e => {
    e.preventDefault();
    (await import('./core/scroll.js')).scrollToEl('works');
  });
  const loaderMod = await safe('loader', () => import('./loader/loader.js'));
  if (loaderMod) loaderMod.runLoader({ mode: root.dataset.intro || 'full', ready, onReveal });
  else onReveal();
})();

// ---- 作品墙 ----
async function showWall() {
  let data;
  try { data = await fetchWorks(); } catch (e) { console.error('[main] 作品清单读取失败', e); showFallback(); return; }
  app.works = data.works; app.categories = data.categories;
  app.byCategory = new Map(data.categories.map(c => [c.id, c]));
  app.data = true;
  await loadModule('counters', './ui/counters.js');
  const c = modules.counters;
  if (c) {
    c.setCount('works', data.works.length);
    c.setCount('cats', new Set(data.works.map(w => w.category)).size);
    archive.totalEditions().then(n => c.setCount('issues', n));
  }
  let cards = null;
  try { cards = await (await import('./wall/wall.js')).initWall({ data, archive }); }
  catch (e) {
    console.error('[main] 作品墙增强层失败，回退到基础渲染', e);
    cards = await safe('render-basic', async () => (await import('./wall/render-basic.js')).renderBasic({ data, archive }));
  }
  if (cards) await handleRoute();
}
function showFallback() {
  import('./core/dom.js').then(({ h }) => {
    const wall = document.getElementById('worksWall');
    const btn = h('button', { type: 'button' }, '重新读取');
    btn.addEventListener('click', () => { wall.replaceChildren(); showWall(); });
    wall.replaceChildren(h('li', { class: 'wall-fallback' }, h('p', {}, '作品清单暂时没读到。下面的日报入口仍然可用。'), btn));
  });
}
async function handleRoute() {
  await revealedP;
  const { scrollToEl } = await import('./core/scroll.js');
  const hash = parseHash(location.hash);
  if (hash.work) { app.openWork && app.openWork(hash.work, { deep: true }); return; }
  if (hash.cat) { app.setCategory && app.setCategory(hash.cat, { silent: true, immediate: true }); scrollToEl('works', { immediate: true }); return; }
  const anchor = parseAnchor(location.hash); // 子页面菜单链接 ./#works | ./#about | ./#top
  if (anchor) { scrollToEl(anchor, { immediate: true }); return; }
  if (legacy) {
    if (legacy.cat) app.setCategory && app.setCategory(legacy.cat, { immediate: true });
    if (legacy.work) app.openWork && app.openWork(legacy.work, { deep: true });
    else if (legacy.scroll) scrollToEl(legacy.scroll, { immediate: true });
  }
}
armLeave();
showWall();
addEventListener('hashchange', async e => {
  if (app.overlays || (e.oldURL && e.oldURL.includes('#work='))) return;
  const { cat } = parseHash(location.hash);
  const anchor = parseAnchor(location.hash);
  if (anchor && !cat) { (await import('./core/scroll.js')).scrollToEl(anchor); return; }
  if (!cat) return;
  app.setCategory && app.setCategory(cat, { silent: true });
  (await import('./core/scroll.js')).scrollToEl('works');
});
archiveReady.catch(() => {});
