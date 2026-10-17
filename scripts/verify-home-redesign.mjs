// 新首页（SHARD）浏览器验收：本地手动运行，不进 CI（CI 没有 Playwright），沿用现有 verify-*.mjs 的做法。
//   node scripts/verify-home-redesign.mjs --section=boot|hero|loader|wall|detail|chrome|responsive|degrade|filter|pages|all [--out=<截图目录>]
//   （可用逗号组合多个分区，例如 --section=wall,detail,degrade）
//   filter：切换分类时作品墙高度补间的连续性（逐帧 rAF 采样：墙高、关于区、筛选条、常驻卡位置、parallax 结算次数，即 resume / refresh 调用次数）。
//   pages：子页面（game/ minsheng/ messages/ privacy/）的 SHARD 外壳——页首页脚、主题同步、哈希路由、擦屏过渡与退化、日报保留项（?date= / 下载 / rel / 外网标识 / 逐行对齐）、
//          留言安全与未配置禁用、版式 / 焦点 / 对比度、零圆角、色彩占比，并输出 screenshots/pages/ 截图。
// 进程内静态服务器（端口 0），拦截并断言零非同源请求；任一断言失败则退出码非 0。
//
// D4 实测（WebGL 开关）：本机无头 Edge 默认没有 GPU。WebGL 路径使用
//   --use-angle=swiftshader --enable-unsafe-swiftshader --ignore-gpu-blocklist（实测可拿到 getContext('webgl')）；
// 无 WebGL 路径使用 --disable-3d-apis（实测 getContext('webgl') 为 null）。
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './collect-steam-discovery.mjs';
import { classifyFamilies } from './color-family.mjs';
import { TITLE_BAND, SAFE, S_NECK, CROP } from '../site/js/hero/occluders.js';
import { MORPH_MS, PEAK_SLOPE } from '../site/js/wall/morph.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.slice(2).split('=')));
const SECTION = args.section || 'all';
const OUT = path.resolve(args.out || path.join(root, '.agents', 'tasks', 'site-redesign', 'screenshots'));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
// 禁用 FLIP：让特性检测认为不支持独立的 translate 属性（core/flip.js 的 canAnimateRects 因此为 false）。
const NO_FLIP = () => { const orig = CSS.supports.bind(CSS); CSS.supports = (...a) => (a[0] === 'translate' ? false : orig(...a)); };
const SKIP_INTRO = () => { try { sessionStorage.setItem('springhues.home.introSeen', '1'); } catch { /* 忽略 */ } };

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x');
    let f = path.join(root, decodeURIComponent(u.pathname));
    if (!f.startsWith(root)) { res.writeHead(403).end(); return; }
    if ((await fs.stat(f)).isDirectory()) f = path.join(f, 'index.html');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await fs.readFile(f));
  } catch { res.writeHead(404).end('Not found'); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const pw = await loadPlaywright();
const results = [];
const injected = new Set();
const log = (...a) => console.log(...a);
async function step(name, fn) {
  if (args.grep && !name.includes(args.grep)) return; // 调试用：--grep=<步骤名片段> 只跑匹配的步骤
  try {
    // 单步 5 分钟硬上限：个别步骤卡住（页面无响应）时给出失败而不是无限挂起。
    let timer; const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('步骤超时（300s）')), 300000); });
    const info = await Promise.race([fn(), limit]).finally(() => clearTimeout(timer));
    results.push({ name, ok: true, info }); log('PASS', name, info ? JSON.stringify(info) : '');
  }
  catch (e) { results.push({ name, ok: false, error: e.message }); log('FAIL', name, '\n     ', e.message.split('\n')[0]); }
}
const eq = (a, b, msg) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${msg || '不相等'}：实际 ${JSON.stringify(a)}，期望 ${JSON.stringify(b)}`); };
const ok = (v, msg) => { if (!v) throw new Error(msg || '断言失败'); };
const shotPath = (section, name) => { const p = path.join(OUT, section, name + '.png'); return fs.mkdir(path.dirname(p), { recursive: true }).then(() => p); };

async function launch(extra = []) { return pw.chromium.launch({ channel: 'msedge', args: [...GL_ARGS, ...extra] }); }

// 打开一个受控页面：零外部请求、收集控制台错误与 4xx/5xx。
async function openPage(browser, o = {}) {
  const ctx = await browser.newContext({
    viewport: o.viewport || { width: 1440, height: 900 }, deviceScaleFactor: 1, reducedMotion: o.reduced ? 'reduce' : 'no-preference',
    colorScheme: o.dark ? 'dark' : 'light', hasTouch: !!o.touch, isMobile: !!o.touch, javaScriptEnabled: o.js !== false
  });
  const state = { external: [], errors: [], bad: [], ctx };
  await ctx.route('**/*', route => {
    const u = new URL(route.request().url());
    // 本机杀毒软件（卡巴斯基）会向每个页面注入脚本，不是站点请求：拦截并单独记录，不计入外部请求。
    if (/(^|\.)kaspersky-labs\.com$/.test(u.hostname)) { injected.add(u.hostname); return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }); }
    if (u.protocol.startsWith('http') && u.origin !== BASE) { state.external.push(u.href); return route.abort(); }
    return route.continue();
  });
  if (o.intro !== 'full' && o.js !== false) await ctx.addInitScript(SKIP_INTRO);
  for (const s of o.init || []) await ctx.addInitScript(s);
  const page = await ctx.newPage();
  state.page = page;
  page.on('console', m => { if (m.type() === 'error') state.errors.push(m.text()); });
  page.on('pageerror', e => state.errors.push('pageerror: ' + e.message));
  page.on('response', r => { if (r.status() >= 400) state.bad.push(r.status() + ' ' + r.url()); });
  for (const [pattern, handler] of o.routes || []) await page.route(pattern, handler);
  return state;
}
async function go(st, url = '/', wait = true) {
  await st.page.goto(BASE + url, { waitUntil: 'load' });
  if (wait) await st.page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 20000 });
  return st;
}
const clean = st => { eq(st.external, [], '出现非同源请求'); eq(st.errors, [], '控制台错误'); eq(st.bad, [], '4xx/5xx 响应'); };
const close = async st => st.ctx.close();

// ---- 图像分析（在 about:blank 页内用 canvas 完成） ----
let helper = null;
async function getHelper(browser) { if (!helper) { helper = await browser.newPage(); await helper.goto('about:blank'); } return helper; }
async function classify(browser, buf) {
  const hp = await getHelper(browser);
  return hp.evaluate(async ({ b64, src }) => {
    const fn = new Function('return ' + src)();
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const w = Math.min(960, img.width), h = Math.round(img.height * w / img.width);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, w, h);
    return fn(g.getImageData(0, 0, w, h).data).pct;
  }, { b64: buf.toString('base64'), src: classifyFamilies.toString() });
}
async function diffRects(browser, a, b, rects) {
  const hp = await getHelper(browser);
  return hp.evaluate(async ({ a, b, rects }) => {
    const load = async s => { const i = new Image(); i.src = 'data:image/png;base64,' + s; await i.decode(); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0); return g; };
    const ga = await load(a), gb = await load(b);
    return rects.map(r => {
      const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y)), w = Math.max(1, Math.floor(r.w)), h = Math.max(1, Math.floor(r.h));
      const da = ga.getImageData(x, y, w, h).data, db = gb.getImageData(x, y, w, h).data;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
      return n / (w * h);
    });
  }, { a: a.toString('base64'), b: b.toString('base64'), rects });
}
const avgPct = list => { const o = {}; for (const k of ['blue', 'white', 'red', 'ink']) o[k] = +(list.reduce((s, p) => s + p[k], 0) / list.length).toFixed(2); return o; };
const latestDate = async manifest => {
  const j = JSON.parse(await fs.readFile(path.join(root, manifest), 'utf8'));
  return j.editions.filter(e => Date.parse(e.publishAt) <= Date.now()).map(e => e.date).sort().pop();
};

// =============================================================== boot
async function boot(browser) {
  const gameDate = await latestDate('data/index.json'), civicDate = await latestDate('data/minsheng/index.json');
  await step('boot: 旧链接 ?view=journal|about|saved|library 与 ?work= 落到正确位置并清空 search', async () => {
    const found = {};
    for (const q of ['journal', 'about', 'saved', 'library']) {
      const st = await go(await openPage(browser), '/?view=' + q);
      await st.page.waitForFunction(() => document.querySelector('#worksWall .slot'), null, { timeout: 10000 });
      await st.page.waitForTimeout(900);
      const r = await st.page.evaluate(() => ({ search: location.search, cat: document.querySelector('#filters [aria-pressed="true"]')?.dataset.cat, worksTop: Math.round(document.getElementById('works').getBoundingClientRect().top), aboutTop: Math.round(document.getElementById('about').getBoundingClientRect().top) }));
      eq(r.search, '', q + ' search 应被清空');
      if (q === 'journal') { eq(r.cat, 'daily'); ok(Math.abs(r.worksTop) < 40, 'journal 应滚到作品墙：' + r.worksTop); }
      if (q === 'about') ok(Math.abs(r.aboutTop) < 40, 'about 应滚到关于区：' + r.aboutTop);
      if (q === 'saved' || q === 'library') { eq(r.cat, 'all'); ok(Math.abs(r.worksTop) < 40, q + ' 应滚到作品墙'); }
      found[q] = r; clean(st); await close(st);
    }
    const st = await go(await openPage(browser), '/?work=android-sample-note');
    await st.page.waitForFunction(() => !document.getElementById('detail').hidden, null, { timeout: 10000 });
    const r = await st.page.evaluate(() => ({ search: location.search, title: document.getElementById('detailTitle')?.textContent }));
    eq(r.search, ''); eq(r.title, '示例·某某便签'); clean(st); await close(st);
    return found;
  });
  await step('boot: 旧分类链接 #cat=android|windows|mod 别名到规范分类，未知值回退 all 并清 hash', async () => {
    const out = {};
    for (const [from, wantCat, wantHash] of [['android', 'software', '#cat=software'], ['windows', 'software', '#cat=software'], ['mod', 'game', '#cat=game'], ['web', 'web', '#cat=web'], ['game', 'game', '#cat=game'], ['daily', 'daily', '#cat=daily'], ['software', 'software', '#cat=software'], ['zzz', 'all', '']]) {
      const st = await go(await openPage(browser), '/#cat=' + from);
      await st.page.waitForSelector('#worksWall .slot', { state: 'attached' }); await st.page.waitForTimeout(700); // 被筛掉的首张卡是 hidden，不能等“可见”
      const r = await st.page.evaluate(() => ({ pressed: [...document.querySelectorAll('#filters [aria-pressed="true"]')].map(b => b.dataset.cat), hash: location.hash, visible: document.querySelectorAll('#worksWall .slot:not([hidden])').length }));
      eq(r.pressed, [wantCat], '#cat=' + from + ' 应按下 ' + wantCat); eq(r.hash, wantHash, '#cat=' + from + ' 的地址栏');
      out[from] = r.pressed[0] + ' ' + (r.hash || '(空)') + ' ' + r.visible;
      clean(st); await close(st);
    }
    return out;
  });
  await step('boot: 静态入口与全部 a[data-latest] 带最新已发布日期；未来 publishAt 夹具不出现；works.json 404 仍改写', async () => {
    let st = await go(await openPage(browser));
    await st.page.waitForFunction(() => document.getElementById('gameLink').getAttribute('href').includes('?date='), null, { timeout: 10000 });
    let r = await st.page.evaluate(() => ({ game: document.getElementById('gameLink').getAttribute('href'), civic: document.getElementById('civicLink').getAttribute('href'), all: [...document.querySelectorAll('a[data-latest]')].map(a => a.getAttribute('href')), hidden: document.querySelector('ul.static-links').hidden, prop: document.getElementById('gameLink').href }));
    eq(r.game, 'game/?date=' + gameDate); eq(r.civic, 'minsheng/?date=' + civicDate);
    ok(r.all.length >= 6 && r.all.every(h => /\?date=\d{4}-\d{2}-\d{2}$/.test(h)), '所有 a[data-latest] 都应带日期：' + r.all.join(','));
    eq(r.hidden, true, '作品墙成功后静态列表应隐藏'); ok(r.prop.includes('?date='), '.href 仍可读取');
    clean(st); await close(st);
    const future = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10);
    const fixture = [['**/data/index.json*', async route => { const j = await (await route.fetch()).json(); j.editions.unshift({ date: future, issue: 999, publishAt: future + 'T11:00:00+08:00', headline: '未来' }); route.fulfill({ json: j }); }]];
    st = await go(await openPage(browser, { routes: fixture }));
    await st.page.waitForFunction(() => document.getElementById('gameLink').getAttribute('href').includes('?date='), null, { timeout: 10000 });
    await st.page.waitForTimeout(500);
    const text = await st.page.evaluate(() => document.body.innerHTML);
    ok(!text.includes(future), '未到 publishAt 的日期不得出现在页面'); eq(await st.page.getAttribute('#gameLink', 'href'), 'game/?date=' + gameDate); clean(st); await close(st);
    st = await go(await openPage(browser, { routes: [['**/site/works.json*', route => route.fulfill({ status: 404, body: 'no' })]] }));
    await st.page.waitForFunction(() => document.getElementById('gameLink').getAttribute('href').includes('?date='), null, { timeout: 10000 });
    const f = await st.page.evaluate(() => ({ fb: !!document.querySelector('.wall-fallback'), vis: document.getElementById('gameLink').getClientRects().length > 0 }));
    ok(f.fb && f.vis, 'works.json 404 时应出现回退块且静态链接可见');
    return { gameDate, civicDate };
  });
  await step('boot: 无交互元素嵌套、无 admin 链接、零外部请求', async () => {
    const st = await go(await openPage(browser));
    await st.page.waitForSelector('#worksWall .slot');
    const r = await st.page.evaluate(() => ({ nest: document.querySelectorAll('a a, a button, button a, button button').length, admin: [...document.querySelectorAll('a[href]')].filter(a => /(^|\/)admin\//i.test(a.getAttribute('href'))).length, rel: [...document.querySelectorAll('a[target="_blank"]')].every(a => /noopener/.test(a.rel)) }));
    eq(r.nest, 0); eq(r.admin, 0); ok(r.rel); clean(st); await close(st);
  });
  await step('boot: 键盘走完菜单与命令面板（Tab 圈住、Esc 回焦、Ctrl+K、↑↓/Enter）', async () => {
    const st = await go(await openPage(browser));
    const p = st.page;
    await p.focus('#btnMenu'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.getElementById('menu').hidden);
    await p.waitForTimeout(700);
    for (let i = 0; i < 9; i++) { await p.keyboard.press('Tab'); ok(await p.evaluate(() => document.getElementById('menu').contains(document.activeElement)), 'Tab 应被圈在菜单内'); }
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.getElementById('menu').hidden); await p.waitForTimeout(900);
    eq(await p.evaluate(() => document.activeElement.id), 'btnMenu', 'Esc 后焦点应回到菜单按钮');
    await p.keyboard.press('Control+k');
    await p.waitForFunction(() => !document.getElementById('palette').hidden);
    await p.keyboard.type('日报');
    const n = await p.evaluate(() => document.querySelectorAll('#paletteList [role=option]').length);
    ok(n >= 2, '搜索“日报”应至少有 2 项：' + n);
    const first = await p.getAttribute('#paletteInput', 'aria-activedescendant');
    await p.keyboard.press('ArrowDown');
    ok((await p.getAttribute('#paletteInput', 'aria-activedescendant')) !== first, '↓ 应移动选中项');
    for (let i = 0; i < 4; i++) { await p.keyboard.press('Tab'); ok(await p.evaluate(() => document.getElementById('palette').contains(document.activeElement))); }
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => document.getElementById('palette').hidden);
    await p.keyboard.press('Control+k'); await p.keyboard.type('zzzzqq');
    ok(await p.isVisible('#paletteEmpty'), '空结果应显示“没有匹配项”');
    await p.keyboard.press('Escape');
    await p.keyboard.press('Control+k'); await p.keyboard.type('便签'); await p.keyboard.press('Enter');
    await p.waitForFunction(() => !document.getElementById('detail').hidden, null, { timeout: 8000 });
    clean(st); await close(st);
  });
  await step('boot: 禁用 JS 时静态链接、留言与页脚可见可点', async () => {
    const st = await go(await openPage(browser, { js: false }), '/', false);
    const p = st.page;
    for (const sel of ['#gameLink', '#civicLink', '.quick-message-link', '.site-foot', 'noscript']) {
      if (sel === 'noscript') continue;
      ok(await p.isVisible(sel), sel + ' 应可见');
    }
    eq(await p.getAttribute('#gameLink', 'href'), 'game/'); await close(st);
  });
  await step('boot: game/ 与 minsheng/ 的 ?date= 页面仍可打开', async () => {
    for (const [p, d] of [['game', gameDate], ['minsheng', civicDate]]) {
      const st = await openPage(browser);
      const res = await st.page.goto(`${BASE}/${p}/?date=${d}`, { waitUntil: 'load' });
      eq(res.status(), 200); await st.page.waitForTimeout(1500);
      const t = await st.page.evaluate(() => ({ title: document.title, text: document.body.innerText.length }));
      ok(t.title && t.text > 500, p + ' 页面内容过少');
      eq(st.external, []); eq(st.errors, [], p + ' 控制台错误'); await close(st);
    }
  });
}

// =============================================================== hero
const VIEWPORTS = [[1920, 1080], [2560, 1080], [3440, 1440], [1366, 768], [1280, 720], [1024, 768], [768, 1024], [430, 932], [390, 844], [360, 640]];
async function hero(browser) {
  await step('hero: 10 个视口的图源、安全矩形 S 与颈部/四角控件', async () => {
    const report = [];
    for (const [w, h] of VIEWPORTS) {
      const st = await go(await openPage(browser, { viewport: { width: w, height: h } }));
      await st.page.waitForTimeout(1600);
      const r = await st.page.evaluate(({ SAFE, S_NECK, CROP }) => {
        const stage = document.getElementById('heroStage').getBoundingClientRect();
        const portrait = matchMedia('(max-aspect-ratio: 9/10)').matches;
        const conv = x => (portrait ? (x - CROP.x) / CROP.w : x);
        const rect = (xs, ys) => ({ l: stage.left + conv(xs[0]) * stage.width, r: stage.left + conv(xs[1]) * stage.width, t: stage.top + ys[0] * stage.height, b: stage.top + ys[1] * stage.height });
        const corners = ['.corner-logo', '.corner-actions', '.corner-index', '.corner-progress'].map(s => document.querySelector(s).getBoundingClientRect());
        const neck = rect(S_NECK.x, S_NECK.y);
        const hit = c => Math.max(0, Math.min(neck.r, c.right) - Math.max(neck.l, c.left)) * Math.max(0, Math.min(neck.b, c.bottom) - Math.max(neck.t, c.top));
        return { portrait, src: document.getElementById('heroImg').currentSrc, S: rect(SAFE.x, SAFE.y), vw: innerWidth, vh: innerHeight, neckHit: corners.map(hit), sw: [document.documentElement.scrollWidth, document.documentElement.clientWidth] };
      }, { SAFE, S_NECK, CROP });
      eq(r.src.includes('hero-p-'), r.portrait, `${w}x${h} 图源应与 max-aspect-ratio:9/10 一致`);
      const tol = 0.01;
      ok(r.S.l >= -r.vw * tol && r.S.r <= r.vw * (1 + tol) && r.S.t >= -r.vh * tol && r.S.b <= r.vh * (1 + tol) + 0.5, `${w}x${h} 安全矩形越界 ${JSON.stringify(r.S)}`);
      ok(r.neckHit.every(a => a === 0), `${w}x${h} 颈部与四角控件相交 ${r.neckHit}`);
      ok(r.sw[0] <= r.sw[1], `${w}x${h} 水平溢出`);
      await st.page.screenshot({ path: await shotPath('hero', `vp-${w}x${h}`) });
      report.push(`${w}x${h}:${r.portrait ? 'p' : 'l'}`); clean(st); await close(st);
    }
    return report.join(' ');
  });
  await step('hero: WebGL 开 / 关各一张，并且 html[data-theme] 昼夜明暗一致', async () => {
    const out = {};
    for (const gl of [true, false]) {
      const b = gl ? browser : await launch(['--disable-3d-apis']);
      for (const dark of [false, true]) {
        const st = await go(await openPage(b, { dark }));
        await st.page.waitForTimeout(1800);
        const cls = await st.page.evaluate(() => ({ gl: document.documentElement.classList.contains('gl-on'), theme: document.documentElement.dataset.theme, canGL: !!document.createElement('canvas').getContext('webgl') }));
        eq(cls.gl, gl, `WebGL ${gl ? '应开启' : '应关闭'}：${JSON.stringify(cls)}`); eq(cls.theme, dark ? 'night' : 'day');
        const buf = await st.page.screenshot({ path: await shotPath('hero', `${gl ? 'webgl' : 'static'}-${dark ? 'night' : 'day'}`) });
        out[`${gl ? 'gl' : 'css'}-${dark ? 'n' : 'd'}`] = await classify(browser, buf);
        clean(st); await close(st);
      }
      if (!gl) await b.close();
    }
    const lum = k => out[k].blue;
    ok(Math.abs(lum('gl-d') - lum('css-d')) < 8 && Math.abs(lum('gl-n') - lum('css-n')) < 8, '两条路径昼夜首屏蓝占比应接近：' + JSON.stringify(out));
    return out;
  });
  await step('hero: 颜色层 A（1920x1080 首屏）蓝类 ≥ 45%、红类 ≤ 10%，昼夜取较低者', async () => {
    const res = {};
    for (const dark of [false, true]) {
      const st = await go(await openPage(browser, { viewport: { width: 1920, height: 1080 }, dark }));
      await st.page.waitForTimeout(1800);
      res[dark ? 'night' : 'day'] = await classify(browser, await st.page.screenshot({ path: await shotPath('hero', `layerA-${dark ? 'night' : 'day'}`) }));
      await close(st);
    }
    const lowBlue = Math.min(res.day.blue, res.night.blue), maxRed = Math.max(res.day.red, res.night.red);
    ok(lowBlue >= 45, `首屏蓝类 ${lowBlue}% < 45%：${JSON.stringify(res)}`); ok(maxRed <= 10, `首屏红类 ${maxRed}% > 10%`);
    return res;
  });
  await step('hero: 标题带 B 覆盖字高，字母被 occluder 遮挡 ≤25%（16:9 / 21:9 / 3:2）', async () => {
    const out = {};
    for (const [w, h] of [[1920, 1080], [2560, 1080], [1500, 1000]]) {
      const st = await go(await openPage(browser, { viewport: { width: w, height: h } }));
      await st.page.waitForTimeout(1800);
      await st.page.addStyleTag({ content: '*{animation:none!important} .hero-sweep{display:none!important}' });
      const info = await st.page.evaluate(({ TITLE_BAND }) => {
        const stage = document.getElementById('heroStage').getBoundingClientRect();
        const title = document.getElementById('heroTitle');
        const fs = parseFloat(getComputedStyle(title).fontSize);
        const letters = [...title.querySelectorAll('.ch-in')].map(c => { const r = c.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
        const band = { t: stage.top + TITLE_BAND[0] * stage.height, b: stage.top + TITLE_BAND[1] * stage.height };
        return { fs, cap: fs * 0.73, band, bandH: band.b - band.t, letters, occOn: document.documentElement.classList.contains('has-occ') };
      }, { TITLE_BAND });
      ok(info.occOn, `${w}x${h} 宽屏应启用 occluder`);
      ok(info.cap + 2 * parseFloat(3) <= info.bandH, `${w}x${h} 标题带 ${info.bandH.toFixed(0)}px 不足以覆盖字高 ${info.cap.toFixed(0)}px`);
      const on = await st.page.screenshot();
      await st.page.evaluate(() => { document.getElementById('heroOcc').style.display = 'none'; });
      const off = await st.page.screenshot();
      const fr = await diffRects(browser, on, off, info.letters);
      const worst = Math.max(...fr);
      ok(worst <= 0.25, `${w}x${h} 单个字母被遮挡 ${(worst * 100).toFixed(1)}% > 25%`);
      await shotPath('hero', 'x').then(p => fs.writeFile(p.replace('x.png', `occ-on-${w}x${h}.png`), on));
      out[`${w}x${h}`] = +(worst * 100).toFixed(1) + '%'; await close(st);
    }
    return out;
  });
  await step('hero: 鼠标移动不引起 uniform 变化，时间流动仍在', async () => {
    // 间谍：记录 getUniformLocation 的名称，以及每个 uniform 每次写入的取值串。
    const GL_SPY = () => {
      const names = new WeakMap(), asked = [], calls = {};
      window.__glSpy = { asked, calls };
      for (const Ctor of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
        if (!Ctor) continue;
        const gu = Ctor.prototype.getUniformLocation;
        Ctor.prototype.getUniformLocation = function (p, n) { const l = gu.call(this, p, n); if (l) { names.set(l, n); asked.push(n); } return l; };
        for (const fn of ['uniform1f', 'uniform2f', 'uniform1i']) {
          const orig = Ctor.prototype[fn];
          Ctor.prototype[fn] = function (l, ...v) { const n = names.get(l); if (n) (calls[n] = calls[n] || []).push(v.join(',')); return orig.call(this, l, ...v); };
        }
      }
    };
    const st = await go(await openPage(browser, { init: [GL_SPY] }));
    const p = st.page;
    await p.waitForFunction(() => document.documentElement.classList.contains('gl-on'), null, { timeout: 10000 });
    await p.mouse.move(120, 120);
    await p.waitForTimeout(600);
    const snap = () => p.evaluate(() => JSON.parse(JSON.stringify(window.__glSpy.calls)));
    const mark0 = await snap();
    await p.waitForTimeout(800);
    const mark1 = await snap();
    for (let i = 0; i <= 40; i++) { await p.mouse.move(120 + i * 30, 150 + (i % 2 ? 420 : 0) + i * 5); await p.waitForTimeout(20); }
    const mark2 = await snap();
    const asked = await p.evaluate(() => window.__glSpy.asked);
    ok(!asked.some(n => /uMouse|uVel/.test(n)), '不应再向 GL 查询 uMouse/uVel：' + asked.join(','));
    const slice = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, (b[k] || []).slice((a[k] || []).length)]));
    const still = slice(mark0, mark1), moving = slice(mark1, mark2);
    const timeOf = o => (o.uTime || []).map(Number);
    for (const [label, ph] of [['静止', still], ['移动', moving]]) {
      const t = timeOf(ph);
      ok(t.length >= 10, `${label}阶段 uTime 写入次数 ${t.length} < 10`);
      ok(t.every((v, i) => i === 0 || v > t[i - 1]), `${label}阶段 uTime 应严格递增`);
    }
    for (const k of Object.keys(mark2).filter(k => k !== 'uTime')) {
      const a = new Set(still[k] || []), b = new Set(moving[k] || []);
      ok(a.size <= 1 && b.size <= 1 && [...b].every(v => a.size === 0 || a.has(v)), `uniform ${k} 在鼠标移动前后取值应一致：${[...a]} / ${[...b]}`);
    }
    eq(await p.evaluate(() => document.documentElement.classList.contains('gl-on')), true, 'gl-on 应仍为真');
    // 鼠标回到原位静止，间隔 1.5s 两张首屏：隐藏文字/刀光/导航后，像素应有变化（时间流动）。
    await p.mouse.move(120, 120);
    await p.addStyleTag({ content: '.hero-title-layer,.hero-sweep,.hero-band,.chrome,#heroOcc,.hero-shade,.scroll-cue,.counters{visibility:hidden!important}' });
    await p.waitForTimeout(500);
    const a = await p.screenshot(), shot = await p.screenshot({ path: await shotPath('hero', 'flow-t0') });
    await p.waitForTimeout(1500);
    const b = await p.screenshot({ path: await shotPath('hero', 'flow-t1') });
    const [frac] = await diffRects(browser, a, b, [{ x: 0, y: 0, w: 1440, h: 900 }]);
    // 实测：1440x900、通道差和 >6、间隔 1.5s，像素差比例 18.196%（swiftshader）；阈值取实测值的一半。
    const FLOW_MIN = 0.09;
    ok(frac > FLOW_MIN, `鼠标静止 1.5s 的首屏像素差比例 ${(frac * 100).toFixed(3)}% 应 > ${(FLOW_MIN * 100).toFixed(3)}%（时间流动）`);
    clean(st); await close(st);
    return { flowDiffPct: +(frac * 100).toFixed(3), uTimeStill: timeOf(still).length, uTimeMoving: timeOf(moving).length, shot: shot.length };
  });
  await step('hero: 帧探测 —— CPU 6x~20x 慢帧会降级到静态图', async () => {
    const st = await go(await openPage(browser));
    const cdp = await st.ctx.newCDPSession(st.page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 20 });
    await st.page.waitForFunction(() => document.documentElement.classList.contains('hero-breathe') && !document.documentElement.classList.contains('gl-on'), null, { timeout: 40000 });
    await st.page.screenshot({ path: await shotPath('hero', 'degraded-after-slow-frames') }); await close(st);
  });
}

// =============================================================== loader
async function loader(browser) {
  const mode = async (name, o, expect, extra) => step(`loader: ${name} → ${expect}`, async () => {
    const st = await openPage(browser, { ...o, intro: 'full' });
    await st.page.goto(BASE + (o.url || '/'), { waitUntil: 'commit' });
    await st.page.waitForSelector('html[data-intro]', { state: 'attached' });
    eq(await st.page.getAttribute('html', 'data-intro'), expect);
    const t = await st.page.evaluate(() => new Promise(res => { const d = document.documentElement; const done = () => res(performance.now()); if (!d.classList.contains('is-loading')) return done(); new MutationObserver((_, ob) => { if (!d.classList.contains('is-loading')) { ob.disconnect(); done(); } }).observe(d, { attributes: true, attributeFilter: ['class'] }); }));
    const after = await st.page.evaluate(() => ({ inert: document.querySelectorAll('[inert]').length, active: document.activeElement.id, loaderShown: getComputedStyle(document.getElementById('loader')).display }));
    eq(after.inert, 0); eq(after.active, 'main'); eq(after.loaderShown, 'none');
    if (extra) extra(t);
    clean(st); await close(st); return { ms: Math.round(t) };
  });
  await mode('reduced-motion', { reduced: true }, 'calm', t => ok(t < 3000, 'calm 应很快：' + t));
  await mode('sessionStorage introSeen', { init: [SKIP_INTRO] }, 'skip', t => ok(t < 3000));
  await mode('#work= 深链', { url: '/#work=android-sample-note' }, 'skip');
  await mode('7 天内访问过', { init: [() => localStorage.setItem('springhues.home.introAt', String(Date.now() - 1000))] }, 'short', t => ok(t < 3500, 'short ≈0.9s：' + t));
  await mode('首次访问', {}, 'full', t => ok(t >= 2400 && t <= 3800, 'full 自导航起应在 2.4–3.6s 附近：' + Math.round(t)));
  for (const how of ['按钮', 'Esc', '点击']) {
    await step(`loader: 跳过方式 ${how} 立即结束`, async () => {
      const st = await openPage(browser, { intro: 'full' });
      await st.page.goto(BASE + '/', { waitUntil: 'load' });
      await st.page.waitForTimeout(500);
      const t0 = Date.now();
      if (how === '按钮') await st.page.click('#loaderSkip'); else if (how === 'Esc') await st.page.keyboard.press('Escape'); else await st.page.mouse.click(700, 450);
      await st.page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 5000 });
      ok(Date.now() - t0 < 1500, '跳过后应在 1.5s 内结束');
      eq(await st.page.evaluate(() => [document.activeElement.id, document.querySelectorAll('[inert]').length]), ['main', 0]);
      clean(st); await close(st);
    });
  }
  await step('loader: 存储被禁用不报错，按 full 处理', async () => {
    const init = () => { const bad = () => { throw new DOMException('denied', 'SecurityError'); }; for (const k of ['localStorage', 'sessionStorage']) Object.defineProperty(window, k, { get: bad }); };
    const st = await openPage(browser, { intro: 'full', init: [init] });
    await st.page.goto(BASE + '/', { waitUntil: 'load' });
    eq(await st.page.getAttribute('html', 'data-intro'), 'full');
    await st.page.waitForFunction(() => !document.documentElement.classList.contains('is-loading'), null, { timeout: 20000 });
    clean(st); await close(st);
  });
  await step('loader: main.js 404 → 8 秒内 .js-failed、可滚动、静态链接可点', async () => {
    const st = await openPage(browser, { intro: 'full', routes: [['**/site/js/main.js*', r => r.fulfill({ status: 404, body: 'no' })]] });
    await st.page.goto(BASE + '/', { waitUntil: 'load' });
    await st.page.waitForSelector('html.js-failed', { timeout: 10000 });
    await st.page.mouse.wheel(0, 1200); await st.page.waitForTimeout(400);
    ok((await st.page.evaluate(() => scrollY)) > 100, '失败后页面应可滚动');
    await st.page.locator('#gameLink').scrollIntoViewIfNeeded();
    ok(await st.page.isVisible('#gameLink'), '静态链接应可见');
    await st.page.screenshot({ path: await shotPath('loader', 'js-failed') }); await close(st);
  });
  await step('loader: 模块晚到（9s）→ js-failed 被清除', async () => {
    const st = await openPage(browser, { intro: 'full', routes: [['**/site/js/main.js*', async r => { await new Promise(res => setTimeout(res, 9000)); r.continue(); }]] });
    await st.page.goto(BASE + '/', { waitUntil: 'commit' });
    await st.page.waitForSelector('html.js-failed', { timeout: 12000 });
    await st.page.waitForFunction(() => !document.documentElement.classList.contains('js-failed') && !document.documentElement.classList.contains('is-loading'), null, { timeout: 25000 });
    await close(st);
  });
}

// =============================================================== wall
const EXPECT_CARRIER = { 'android-sample-note': 'phone', 'android-sample-gallery': 'phone', 'android-sample-timer': 'phone', 'windows-sample-renamer': 'window', 'windows-sample-capture': 'window', 'windows-sample-launcher': 'window', 'daily-game': 'page', 'daily-minsheng': 'page', 'mod-sample-patch': 'shard', 'mod-sample-texture': 'shard', 'web-sample-folio': 'shard', 'web-sample-lab': 'shard', 'game-sample-arcade': 'shard', 'game-sample-proto': 'shard' };
async function wall(browser) {
  await step('wall: 14 张卡载体正确，静态列表 hidden，日报卡显示已发布期次', async () => {
    const st = await go(await openPage(browser));
    await st.page.waitForSelector('#worksWall .slot');
    await st.page.waitForFunction(() => document.querySelector('.pg-no')?.textContent.includes('NO.5'), null, { timeout: 8000 });
    const r = await st.page.evaluate(() => ({ cards: Object.fromEntries([...document.querySelectorAll('#worksWall .slot')].map(s => [s.dataset.slug, s.dataset.carrier])), hidden: document.querySelector('ul.static-links').hidden, inDom: !!document.getElementById('gameLink'), href: document.getElementById('gameLink').getAttribute('href'), daily: [...document.querySelectorAll('.slot[data-carrier=page]')].map(s => s.innerText.replace(/\s+/g, ' ').slice(0, 90)) }));
    eq(Object.entries(r.cards).sort(), Object.entries(EXPECT_CARRIER).sort(), '载体映射'); ok(r.hidden && r.inDom && r.href.includes('?date=')); clean(st);
    await st.page.evaluate(() => document.getElementById('works').scrollIntoView());
    await st.page.waitForTimeout(1200);
    await st.page.screenshot({ path: await shotPath('wall', 'wall-1440x900') }); await close(st);
    return r.daily;
  });
  await step('wall: 5 个筛选芯片、顺序与文案、计数 14/6/2/4/2；390px 无页面横向溢出且芯片可滑动', async () => {
    let st = await go(await openPage(browser));
    await st.page.waitForSelector('#worksWall .slot');
    const chips = await st.page.evaluate(() => [...document.querySelectorAll('#filters button')].map(b => ({ cat: b.dataset.cat, label: b.firstChild.textContent.trim(), n: +(b.querySelector('small').textContent.match(/\d+/) || [-1])[0], text: b.textContent })));
    eq(chips.map(c => c.cat), ['all', 'software', 'game', 'web', 'daily']);
    eq(chips.map(c => c.label), ['全部资源', '软件工具', '游戏资源', '网页设计', '每日简报']);
    eq(chips.map(c => c.n), [14, 6, 2, 4, 2]);
    const filtersText = await st.page.evaluate(() => document.getElementById('filters').textContent);
    ok(!/安卓软件|Windows 软件|模组/.test(filtersText), '筛选条不应再出现旧分类文案：' + filtersText);
    const text = await st.page.evaluate(() => [[...document.querySelectorAll('#menu .mi-cn')].map(x => x.textContent), document.getElementById('gameLink').textContent, document.getElementById('civicLink').textContent]);
    ok(text[0].includes('每日简报') && !text[0].includes('日报'), '菜单应为“每日简报”：' + text[0]); eq(text.slice(1), ['游戏日报', '民生日报'], '频道名不应改动');
    clean(st); await close(st);
    st = await go(await openPage(browser, { viewport: { width: 390, height: 844 }, touch: true }));
    const p = st.page; await p.waitForSelector('#worksWall .slot');
    await p.evaluate(() => document.getElementById('works').scrollIntoView({ behavior: 'instant' })); await p.waitForTimeout(900);
    const m = await p.evaluate(() => { const f = document.getElementById('filters'); const de = document.documentElement; const rs = [...f.children].map(b => b.getBoundingClientRect()); return { pageOverflow: de.scrollWidth > de.clientWidth, barScrolls: f.scrollWidth > f.clientWidth, allInViewport: rs.every(r => r.left >= 0 && r.right <= innerWidth), vw: innerWidth }; });
    ok(!m.pageOverflow, '390px 页面出现横向溢出：' + JSON.stringify(m));
    ok(m.barScrolls || m.allInViewport, '芯片栏应可横向滑动或全部在视口内：' + JSON.stringify(m));
    await p.screenshot({ path: await shotPath('wall', 'chips-390') });
    await p.click('#filters [data-cat=daily]'); await p.waitForTimeout(1500);
    const after = await p.evaluate(() => { const f = document.getElementById('filters'), de = document.documentElement; const fr = f.getBoundingClientRect(), br = f.querySelector('[data-cat=daily]').getBoundingClientRect(); return { inBar: br.left >= fr.left - 1 && br.right <= fr.right + 1, pageOverflow: de.scrollWidth > de.clientWidth, sl: Math.round(f.scrollLeft) }; });
    ok(after.inBar && !after.pageOverflow, '选中最后一个芯片后应在筛选条内可见且页面不横向滚动：' + JSON.stringify(after));
    clean(st); await close(st);
    return { chips: chips.map(c => c.cat + ':' + c.n), mobile: m, after };
  });
  await step('wall: wall.js 404 → render-basic 渲染，详情 <dialog> 可用，仍改写 ?date=', async () => {
    const st = await go(await openPage(browser, { routes: [['**/site/js/wall/wall.js*', r => r.fulfill({ status: 404, body: 'no' })]] }));
    await st.page.waitForSelector('#worksWall[data-mode=basic] .slot');
    eq(await st.page.locator('#worksWall .slot').count(), 14);
    await st.page.locator('a.card-hit').first().scrollIntoViewIfNeeded();
    await st.page.locator('a.card-hit').first().click();
    await st.page.waitForSelector('dialog.basic-detail[open]');
    eq(await st.page.evaluate(() => document.querySelector('dialog.basic-detail h2').textContent.length > 0), true);
    ok((await st.page.getAttribute('#gameLink', 'href')).includes('?date='));
    await st.page.screenshot({ path: await shotPath('wall', 'render-basic-dialog') });
    ok(st.errors.every(e => /404|wall\.js/i.test(e)), '除 404 外不应有其他错误：' + st.errors.join('|')); await close(st);
  });
  await step('wall: 颜色层 B（首屏 + 作品墙第一屏）蓝 ≥45%、红 ≤10%，层 C 记录', async () => {
    const res = {};
    for (const dark of [false, true]) {
      const st = await go(await openPage(browser, { dark, viewport: { width: 1920, height: 1080 } }));
      await st.page.waitForSelector('#worksWall .slot'); await st.page.waitForTimeout(1600);
      const a = await st.page.screenshot();
      await st.page.evaluate(() => scrollTo(0, document.getElementById('works').offsetTop + 80)); await st.page.waitForTimeout(1500);
      const b = await st.page.screenshot({ path: await shotPath('wall', `layerB-wall-${dark ? 'night' : 'day'}`) });
      res[dark ? 'night' : 'day'] = { B: avgPct([await classify(browser, a), await classify(browser, b)]) };
      await st.page.evaluate(() => scrollTo(0, 0)); await st.page.waitForTimeout(500);
      const full = await st.page.screenshot({ fullPage: true });
      res[dark ? 'night' : 'day'].C = await classify(browser, full);
      await close(st);
    }
    const lowB = Math.min(res.day.B.blue, res.night.B.blue), redB = Math.max(res.day.B.red, res.night.B.red);
    ok(lowB >= 45, `层 B 蓝类 ${lowB}% < 45%：${JSON.stringify(res)}`); ok(redB <= 10, `层 B 红类 ${redB}% > 10%`);
    return res;
  });
  await step('wall: 载体 hover / focus 点亮与刀光（截图目检）', async () => {
    const st = await go(await openPage(browser));
    await st.page.evaluate(() => document.getElementById('works').scrollIntoView()); await st.page.waitForTimeout(1200);
    for (const c of ['phone', 'window', 'shard']) {
      const loc = st.page.locator(`.slot[data-carrier=${c}] a.card-hit`).first();
      await loc.scrollIntoViewIfNeeded(); await st.page.waitForTimeout(700);
      const box = await loc.boundingBox();
      await st.page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.45, { steps: 8 }); await st.page.waitForTimeout(700);
      await st.page.screenshot({ path: await shotPath('wall', `hover-${c}`) });
    }
    await st.page.keyboard.press('Tab');
    await close(st);
  });
}

// =============================================================== detail
async function detail(browser) {
  await step('detail: 筛选与 #cat= 同步；卡片开合、历史、焦点', async () => {
    const st = await go(await openPage(browser));
    const p = st.page;
    await p.waitForSelector('#worksWall .slot');
    await p.evaluate(() => document.getElementById('works').scrollIntoView()); await p.waitForTimeout(600);
    await p.click('#filters [data-cat=daily]'); await p.waitForTimeout(1300);
    eq(await p.evaluate(() => [...document.querySelectorAll('#worksWall .slot')].filter(s => !s.hidden).map(s => s.dataset.slug).sort()), ['daily-game', 'daily-minsheng']);
    eq(await p.evaluate(() => location.hash), '#cat=daily');
    await p.click('#filters [data-cat=software]'); await p.waitForTimeout(1300);
    eq(await p.evaluate(() => location.hash), '#cat=software');
    eq(await p.evaluate(() => [...document.querySelectorAll('#worksWall .slot')].filter(s => !s.hidden).map(s => s.dataset.slug).sort()), ['android-sample-gallery', 'android-sample-note', 'android-sample-timer', 'windows-sample-capture', 'windows-sample-launcher', 'windows-sample-renamer'], 'software 应含 6 个软件作品');
    const hit = p.locator('a.card-hit[data-slug=android-sample-gallery]');
    await hit.click(); await p.waitForFunction(() => !document.getElementById('detail').hidden); await p.waitForTimeout(1100);
    eq(await p.evaluate(() => [location.hash, history.state?.work]), ['#work=android-sample-gallery', 'android-sample-gallery']);
    await p.waitForTimeout(900);
    await p.screenshot({ path: await shotPath('detail', 'open-1440x900') });
    await p.keyboard.press('Escape'); await p.waitForFunction(() => document.getElementById('detail').hidden); await p.waitForTimeout(500);
    eq(await p.evaluate(() => [location.hash, document.activeElement.dataset.slug]), ['#cat=software', 'android-sample-gallery'], 'Esc 后 URL 与焦点应恢复');
    await hit.click(); await p.waitForFunction(() => !document.getElementById('detail').hidden); await p.waitForTimeout(900);
    await p.goBack(); await p.waitForFunction(() => document.getElementById('detail').hidden); eq(await p.evaluate(() => location.hash), '#cat=software');
    await hit.click(); await p.waitForFunction(() => !document.getElementById('detail').hidden); await p.waitForTimeout(900);
    await p.click('#detailClose'); await p.waitForFunction(() => document.getElementById('detail').hidden); eq(await p.evaluate(() => location.hash), '#cat=software');
    await p.click('#filters [data-cat=all]'); await p.waitForTimeout(1200);
    eq(await p.evaluate(() => location.hash), '', 'all 时应清除 hash'); eq(await p.evaluate(() => document.querySelectorAll('#worksWall .slot:not([hidden])').length), 14);
    clean(st); await close(st);
  });
  await step('detail: #work= 深链、无效 slug、占位链接、日报详情', async () => {
    let st = await go(await openPage(browser), '/#work=windows-sample-capture');
    let p = st.page;
    await p.waitForFunction(() => !document.getElementById('detail').hidden, null, { timeout: 10000 });
    eq(await p.textContent('#detailTitle'), '示例·某某截图工具');
    const y0 = await p.evaluate(() => scrollY), url0 = p.url();
    await p.click('#detail a[data-placeholder]', { force: true }); // aria-disabled 链接在 Playwright 看来是 disabled，需强制点击 await p.waitForTimeout(300);
    eq(p.url(), url0, '占位链接不得改 URL'); eq(await p.evaluate(() => scrollY), y0); ok(await p.isVisible('.toast .t'));
    await p.click('#detailClose'); await p.waitForFunction(() => document.getElementById('detail').hidden);
    eq(await p.evaluate(() => location.hash), '', '深链关闭用 replaceState 清除 hash');
    clean(st); await close(st);
    st = await go(await openPage(browser), '/#work=nope'); p = st.page;
    await p.waitForSelector('.toast .t', { timeout: 8000 });
    eq(await p.textContent('.toast .t'), '没有找到这个作品'); eq(await p.evaluate(() => location.hash), ''); await close(st);
    st = await go(await openPage(browser), '/#work=daily-game'); p = st.page;
    await p.waitForFunction(() => !document.getElementById('detail').hidden, null, { timeout: 10000 }); await p.waitForTimeout(500);
    const d = await p.evaluate(() => ({ latest: [...document.querySelectorAll('#detail a')].filter(a => a.textContent.trim() === '阅读最新一期').length, channel: [...document.querySelectorAll('#detail a')].filter(a => a.textContent.trim() === '进入频道').length, href: document.querySelector('#detail a[data-latest]')?.getAttribute('href') }));
    eq(d.latest, 1, '“阅读最新一期”不得重复'); eq(d.channel, 1); ok(/\?date=/.test(d.href));
    await p.screenshot({ path: await shotPath('detail', 'daily-open') }); clean(st); await close(st);
  });
  for (const [label, routes, init] of [['禁用 FLIP → View Transitions', [], [NO_FLIP]], ['禁用 FLIP 且无 VT → 直接切换', [], [NO_FLIP, () => { delete Document.prototype.startViewTransition; }]]]) {
    await step('detail: ' + label + ' 都能打开 / 关闭', async () => {
      const st = await go(await openPage(browser, { routes, init }));
      const p = st.page;
      await p.waitForSelector('#worksWall .slot'); await p.waitForTimeout(800);
      const hit = p.locator('a.card-hit[data-slug=windows-sample-renamer]');
      await hit.scrollIntoViewIfNeeded(); await hit.click();
      await p.waitForFunction(() => !document.getElementById('detail').hidden); await p.waitForTimeout(900);
      await p.keyboard.press('Escape'); await p.waitForFunction(() => document.getElementById('detail').hidden);
      ok(st.errors.every(e => /404|vendor/i.test(e)), '除 404 外不应有错误：' + st.errors.join('|')); await close(st);
    });
  }
}

// =============================================================== chrome
async function chrome(browser) {
  await step('chrome: 精细指针 full 档有自定义光标并变形；触屏 / reduced-motion 无光标、无 Lenis', async () => {
    let st = await go(await openPage(browser));
    let p = st.page;
    await p.waitForSelector('#worksWall .slot'); await p.mouse.move(300, 300, { steps: 4 }); await p.waitForTimeout(300);
    ok(await p.evaluate(() => !!document.querySelector('.cursor') && document.documentElement.classList.contains('has-cursor')), '应有光标');
    await p.hover('#btnSearch'); await p.waitForTimeout(300);
    ok(await p.evaluate(() => document.querySelector('.cursor').classList.contains('is-hot')), '悬停 [data-cursor] 应变形');
    ok(await p.evaluate(() => document.documentElement.classList.contains('lenis')), 'full 档应有 Lenis');
    clean(st); await close(st);
    for (const [name, o] of [['touch', { touch: true, viewport: { width: 390, height: 844 } }], ['reduced', { reduced: true }]]) {
      st = await go(await openPage(browser, o)); await st.page.waitForTimeout(800);
      const r = await st.page.evaluate(() => ({ cursor: !!document.querySelector('.cursor'), lenis: document.documentElement.classList.contains('lenis'), gl: document.documentElement.classList.contains('gl-on') }));
      eq(r, { cursor: false, lenis: false, gl: false }, name); clean(st); await close(st);
    }
  });
  await step('chrome: 主题——擦除、刷新保持、默认跟随系统、手动选择后不再跟随', async () => {
    let st = await go(await openPage(browser, { dark: true }));
    let p = st.page;
    eq(await p.getAttribute('html', 'data-theme'), 'night', '默认跟随系统');
    await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
    eq(await p.getAttribute('html', 'data-theme'), 'day', '未手动选择时应跟随系统变化');
    await p.click('#btnTheme'); await p.waitForTimeout(120);
    ok(await p.evaluate(() => document.getAnimations().some(a => a.effect?.target?.closest?.('.wipe'))), '切换时应出现碎片擦除');
    await p.screenshot({ path: await shotPath('chrome', 'theme-wipe-frame') });
    await p.waitForTimeout(1500);
    eq(await p.getAttribute('html', 'data-theme'), 'night');
    await p.emulateMedia({ colorScheme: 'light' }); await p.emulateMedia({ colorScheme: 'dark' }); await p.emulateMedia({ colorScheme: 'light' }); await p.waitForTimeout(300);
    eq(await p.getAttribute('html', 'data-theme'), 'night', '手动选择后不再跟随系统');
    await p.reload(); await p.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
    eq(await p.getAttribute('html', 'data-theme'), 'night', '刷新后保持'); clean(st); await close(st);
  });
  await step('chrome: 彩蛋——三击触发、2s 复原、布局无位移；间隔 >1.2s 清零；命令面板入口', async () => {
    const st = await go(await openPage(browser)); const p = st.page; await p.waitForTimeout(1500);
    const read = () => p.evaluate(() => { const t = document.getElementById('heroTitle'); const r = t.getBoundingClientRect(); return { text: [...t.querySelectorAll('.ch-in')].map(c => c.textContent).join('').replace(/\u00a0/g, ' '), cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), label: t.getAttribute('aria-label') }; });
    const before = await read();
    await p.click('#eggHit', { force: true }); await p.waitForTimeout(1400); await p.click('#eggHit', { force: true }); await p.click('#eggHit', { force: true }); await p.waitForTimeout(300);
    eq((await read()).text, 'SPRINGHUES', '间隔 >1.2s 后计数应清零');
    await p.click('#eggHit', { force: true }); await p.click('#eggHit', { force: true }); await p.click('#eggHit', { force: true }); await p.waitForTimeout(900);
    const mid = await read(); eq(mid.text, 'THE SILENT THINGS');
    ok(Math.abs(mid.cx - before.cx) <= 3 && Math.abs(mid.cy - before.cy) <= 3, '布局不得位移');
    await p.screenshot({ path: await shotPath('chrome', 'egg-active') });
    await p.waitForTimeout(2400); const after = await read(); eq(after.text, 'SPRINGHUES'); eq(after.label, 'SPRINGHUES');
    await p.keyboard.press('Control+k'); await p.keyboard.type('Silent'); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
    ok((await read()).text === 'THE SILENT THINGS', '命令面板入口应触发彩蛋'); clean(st); await close(st);
  });
  await step('chrome: 章节计数器与关于区在 full / lite / calm 下的降级', async () => {
    const res = {};
    for (const [name, o] of [['full', {}], ['lite', { touch: true, viewport: { width: 390, height: 844 } }], ['calm', { reduced: true }]]) {
      const st = await go(await openPage(browser, o)); const p = st.page;
      await p.waitForSelector('#worksWall .slot');
      await p.evaluate(() => document.getElementById('about').scrollIntoView({ behavior: 'instant' })); await p.waitForTimeout(1200);
      const r = await p.evaluate(() => ({ now: document.getElementById('secNow').textContent, motion: document.documentElement.classList.contains('motion-js'), anim: getComputedStyle(document.getElementById('marquee')).animationName }));
      eq(r.now, '03', name + ' 关于区章节应为 03');
      if (name === 'full') ok(r.motion); if (name === 'lite') ok(!r.motion && r.anim === 'marquee', 'lite 应为纯 CSS 匀速：' + JSON.stringify(r)); if (name === 'calm') eq(r.anim, 'none', 'calm 字幕静止');
      res[name] = r; await p.screenshot({ path: await shotPath('chrome', 'about-' + name) }); clean(st); await close(st);
    }
    return res;
  });
  await step('chrome: 命令面板按新分类名、平台搜索命中正确作品', async () => {
    const st = await go(await openPage(browser)); const p = st.page; await p.waitForSelector('#worksWall .slot');
    const search = async q => {
      await p.keyboard.press('Control+k'); await p.waitForFunction(() => !document.getElementById('palette').hidden);
      await p.fill('#paletteInput', q); await p.waitForTimeout(250);
      const rows = await p.evaluate(() => [...document.querySelectorAll('#paletteList [role=option]')].map(o => ({ kind: o.querySelector('.pl-kind')?.textContent, title: o.querySelector('.pl-title')?.textContent, hint: o.querySelector('.pl-hint')?.textContent })));
      await p.keyboard.press('Escape'); await p.waitForFunction(() => document.getElementById('palette').hidden); await p.waitForTimeout(400);
      return rows;
    };
    const soft = (await search('软件工具')).filter(r => r.kind === '作品' && r.hint === '软件工具');
    eq(soft.length, 6, '“软件工具”应命中 6 个软件作品');
    const daily = (await search('每日简报')).filter(r => r.kind === '作品' && r.hint === '每日简报').map(r => r.title).sort();
    eq(daily, ['民生日报', '游戏日报'], '“每日简报”应命中两个日报作品');
    const android = (await search('android')).filter(r => r.kind === '作品').map(r => r.title).sort();
    for (const t of ['示例·某某便签', '示例·某某相册', '示例·某某计时器']) ok(android.includes(t), '“android”应命中 ' + t + '：' + android.join('|'));
    clean(st); await close(st);
  });
  await step('chrome: 菜单转场静态帧', async () => {
    const st = await go(await openPage(browser)); const p = st.page;
    await p.click('#btnMenu'); await p.waitForTimeout(260);
    await p.screenshot({ path: await shotPath('chrome', 'menu-wipe-frame') });
    await p.waitForTimeout(1000); await p.screenshot({ path: await shotPath('chrome', 'menu-open') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(1200);
    await p.keyboard.press('Control+k'); await p.keyboard.type('日报'); await p.waitForTimeout(300);
    await p.screenshot({ path: await shotPath('chrome', 'palette-open') });
    clean(st); await close(st);
  });
}

// =============================================================== responsive
async function responsive(browser) {
  await step('responsive: 8 个宽度无水平溢出，390px 下 phone 宽高比 ≥0.4，各截首屏与作品墙', async () => {
    const out = {};
    for (const w of [360, 390, 430, 768, 1024, 1366, 1920, 2560]) {
      const h = w < 700 ? 844 : w < 1100 ? 1024 : 900;
      const st = await go(await openPage(browser, { viewport: { width: w, height: h }, touch: w < 700 }));
      const p = st.page; await p.waitForSelector('#worksWall .slot'); await p.waitForTimeout(1300);
      await p.screenshot({ path: await shotPath('responsive', `hero-${w}`) });
      await p.evaluate(() => document.getElementById('works').scrollIntoView({ behavior: 'instant' })); await p.waitForTimeout(1000);
      await p.screenshot({ path: await shotPath('responsive', `wall-${w}`) });
      // 标题区可读性：眉题 / 标题 / 说明文字的文字行框不得与蓝色斜切块 .head-slab 相交，且不被拟声词 o1 压住说明文字
      const hit = await p.evaluate(() => {
        const rects = (sel) => { const el = document.querySelector(sel); if (!el) return []; const r = document.createRange(); r.selectNodeContents(el); return [...r.getClientRects()].filter(b => b.width > 1 && b.height > 1); };
        const cross = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
        const slab = document.querySelector('.head-slab').getBoundingClientRect();
        const o1 = document.querySelector('.works > .onomato.o1').getBoundingClientRect();
        // 斜切块左缘是 (14%,0)→(0,88%) 的斜线：文字行框右端须在该斜线左侧至少 4px（按行框底边取最靠左的边缘 x）
        const slabHit = (b) => {
          if (!cross(b, slab)) return false;
          const y = Math.min(Math.max(b.bottom - slab.top, 0), slab.height * 0.88);
          const edgeX = slab.left + slab.width * 0.14 * (1 - y / (slab.height * 0.88));
          return b.right + 4 > edgeX;
        };
        const bad = [];
        for (const sel of ['.works-head .eyebrow', '.works-head .h-cn', '.works-lead']) if (rects(sel).some(slabHit)) bad.push(sel + '×head-slab');
        if (rects('.works-lead').some(b => cross(b, o1))) bad.push('.works-lead×onomato.o1');
        return bad;
      });
      eq(hit, [], `${w}px 标题区文字被色块遮挡`);
      await p.evaluate(() => scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(600);
      const r = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sx: (scrollTo(500, scrollY), scrollX), phone: (() => { const f = document.querySelector('.slot[data-carrier=phone] .face'); if (!f) return null; const b = f.getBoundingClientRect(); return b.width / b.height; })() }));
      ok(r.sw <= r.cw && r.sx === 0, `${w}px 出现水平溢出或可横向滚动 ${JSON.stringify(r)}`);
      if (w === 390) ok(r.phone >= 0.4, 'phone 宽高比 ' + r.phone);
      out[w] = r.phone ? +r.phone.toFixed(2) : null; clean(st); await close(st);
    }
    return out;
  });
}

// =============================================================== degrade
async function degrade(browser) {
  const reach = async (st, label) => {
    const p = st.page;
    ok(await p.evaluate(() => !!document.getElementById('gameLink') && document.getElementById('gameLink').getAttribute('href').length > 0), label + ' 日报入口应在 DOM 中');
    await p.click('#btnMenu'); await p.waitForTimeout(1200); ok(await p.isVisible('#menu'), label + ' 菜单应可打开'); await p.keyboard.press('Escape'); await p.waitForTimeout(1000);
    ok(!st.errors.some(e => /pageerror/.test(e)), label + ' 不应有未处理异常：' + st.errors.join('|'));
  };
  await step('degrade: calm / lite / 无 WebGL / 无 Lenis / works.json 404 / main.js 改名', async () => {
    const out = {};
    let st = await go(await openPage(browser, { reduced: true })); await st.page.waitForSelector('#worksWall .slot'); await reach(st, 'calm'); clean(st); await close(st); out.calm = 'ok';
    st = await go(await openPage(browser, { touch: true, viewport: { width: 390, height: 844 } })); await st.page.waitForSelector('#worksWall .slot');
    eq(await st.page.evaluate(() => document.documentElement.classList.contains('gl-on')), false, 'lite 不应有 WebGL'); await reach(st, 'lite'); clean(st); await close(st); out.lite = 'ok';
    const nogl = await launch(['--disable-3d-apis']);
    st = await go(await openPage(nogl)); await st.page.waitForSelector('#worksWall .slot'); await st.page.waitForTimeout(1500);
    ok(await st.page.evaluate(() => document.documentElement.classList.contains('hero-breathe') && !document.documentElement.classList.contains('gl-on')), '无 WebGL 应走静态 + CSS');
    await reach(st, '无 WebGL'); clean(st); await close(st); await nogl.close(); out.noGL = 'ok';
    st = await go(await openPage(browser, { routes: [['**/vendor/**', r => r.fulfill({ status: 404, body: 'no' })]] })); await st.page.waitForSelector('#worksWall .slot'); await st.page.waitForTimeout(1500);
    eq(await st.page.evaluate(() => document.querySelectorAll('#worksWall .slot').length), 14); await reach(st, '无 Lenis'); eq(st.errors.filter(e => !/404|vendor/i.test(e)), []); await close(st); out.noLenis = 'ok';
    st = await go(await openPage(browser, { routes: [['**/site/works.json*', r => r.fulfill({ status: 404, body: 'no' })]] }));
    await st.page.waitForSelector('.wall-fallback'); ok(await st.page.isVisible('#gameLink'), '静态链接仍在'); ok(await st.page.isVisible('.wall-fallback button'), '应有重试按钮');
    await st.page.screenshot({ path: await shotPath('degrade', 'works-json-404') });
    await st.page.unroute('**/site/works.json*'); await st.page.click('.wall-fallback button'); await st.page.waitForSelector('#worksWall .slot', { timeout: 8000 }); await close(st); out.worksJson404 = 'ok';
    st = await openPage(browser, { intro: 'full', routes: [['**/site/js/main.js*', r => r.fulfill({ status: 404, body: 'no' })]] });
    await st.page.goto(BASE + '/'); await st.page.waitForSelector('html.js-failed', { timeout: 10000 }); ok(await st.page.evaluate(() => getComputedStyle(document.getElementById('loader')).display === 'none')); await close(st); out.mainRenamed = 'ok';
    return out;
  });
}

// =============================================================== filter
// 切换分类时作品墙高度必须连续补间：不塌到 0、不突变、字幕条/关于区刚性随动、筛选条不动、结束后常驻卡不瞬跳。
// 帧率无关：验收环境是 swiftshader 软渲染（约 40ms/帧），所以不比较“每帧位移 ≤ 固定像素”，而是
// 按缓动最大斜率换算：|ΔH| ≤ PEAK_SLOPE × 1.15 × Δ × dt / MORPH_MS + 2（任何区间的平均斜率都不超过峰值斜率）。
const SETTLE_PEAK = 6.25; // 视差结算缓动 cubic-bezier(.16,1,.3,1) 的起点斜率 = y1/x1
const SETTLE_MS = 420;
const CHAIN = ['all', 'software', 'web', 'game', 'daily', 'all', 'daily', 'all', 'game', 'web', 'software', 'all']; // 覆盖 14↔6↔2↔4↔2 互切与 2↔14
const WORKS_FILE = JSON.parse(await fs.readFile(path.join(root, 'site', 'works.json'), 'utf8'));
const CAT_SLUGS = { all: WORKS_FILE.works.map(w => w.slug).sort() };
for (const w of WORKS_FILE.works) (CAT_SLUGS[w.category] ||= []).push(w.slug);
for (const k of Object.keys(CAT_SLUGS)) CAT_SLUGS[k].sort();

// 页内探针：包一层视差的 resume / refresh，记录调用时刻与当时墙高（只装一次）。
// 模块路径唯一（无查询串），所以页内 import 到的 app 与站点用的是同一个单例。
const installProbe = p => p.evaluate(async () => {
  if (window.__probe) return;
  window.__probe = { refresh: [] };
  const { app } = await import('/site/js/core/app.js');
  const api = app.parallax;
  if (!api) return;
  for (const name of ['resume', 'refresh']) {
    const orig = api[name].bind(api);
    api[name] = function (...a) {
      const w = document.getElementById('worksWall');
      window.__probe.refresh.push({ t: performance.now(), wallH: w.getBoundingClientRect().height, inline: w.style.height, via: name });
      return orig(...a);
    };
  }
});
// 把 #filters 顶滚到距视口顶 top 像素处。
const scrollFilters = (p, top = 120) => p.evaluate(t => { const f = document.getElementById('filters'); window.scrollTo({ top: scrollY + f.getBoundingClientRect().top - t, behavior: 'instant' }); }, top);
const clickChip = (p, cat) => p.$eval(`#filters [data-cat=${cat}]`, el => el.click());
// 点击前先装好 rAF 采样器，再执行 act，等 ms 毫秒后收集。
async function recordSwitch(p, act, ms) {
  const pre = await p.evaluate(() => {
    const wall = document.getElementById('worksWall'), about = document.getElementById('about'), filters = document.getElementById('filters');
    // 时间基准：rAF 时间戳（与 WAAPI 同属 document.timeline，补间值正是它的函数）。
    const clock = ts => ts;
    const rec = { s: [], on: true, t0: clock(performance.now()) };
    window.__rec = rec;
    window.__probe.refresh = [];
    const tick = ts => {
      if (!rec.on) return;
      const wr = wall.getBoundingClientRect(), slots = [...wall.children].filter(s => s.dataset && s.dataset.slug && s.getClientRects().length > 0);
      const tops = {};
      let below = -Infinity, minOp = parseFloat(getComputedStyle(wall).opacity);
      for (const s of slots) {
        const r = s.getBoundingClientRect();
        const op = parseFloat(getComputedStyle(s).opacity);
        tops[s.dataset.slug] = r.top; minOp = Math.min(minOp, op);
        if (op > 0.05) below = Math.max(below, r.bottom); // 只统计肉眼可见（不透明度 >5%）的卡压出墙底多少
      }
      rec.s.push({ t: clock(ts) - rec.t0, ts, wallH: wr.height, wallBottom: wr.bottom, aboutTop: about.getBoundingClientRect().top, filtersTop: filters.getBoundingClientRect().top, scrollY, docH: document.documentElement.scrollHeight, overflow: slots.length ? below - wr.bottom : 0, minOp, tops });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    return { h0: wall.getBoundingClientRect().height, scroll0: scrollY, vh: innerHeight };
  });
  await act();
  await p.waitForTimeout(ms);
  const out = await p.evaluate(() => { window.__rec.on = false; return { s: window.__rec.s, refresh: window.__probe.refresh.slice() }; });
  return { ...out, ...pre };
}
// 终态：内联高度已清、可见集合正确、可见卡 position:relative 且 opacity:1、没有残留的 absolute 或 opacity:0 内联样式。
async function terminal(p, cat, label) {
  const r = await p.evaluate(() => {
    const wall = document.getElementById('worksWall'), slots = [...wall.querySelectorAll(':scope > .slot')], vis = slots.filter(s => !s.hidden);
    return { h: wall.style.height, morphing: wall.classList.contains('is-morphing'), vis: vis.map(s => s.dataset.slug).sort(), pos: [...new Set(vis.map(s => getComputedStyle(s).position))], op: [...new Set(vis.map(s => getComputedStyle(s).opacity))], inlineAbs: slots.filter(s => s.style.position === 'absolute').length, stuckOp: slots.filter(s => s.style.opacity === '0').length, pressed: [...document.querySelectorAll('#filters [aria-pressed="true"]')].map(b => b.dataset.cat) };
  });
  eq(r.h, '', label + ' 终态 wall.style.height 应为空'); eq(r.morphing, false, label + ' 终态不应残留 is-morphing');
  eq(r.vis, CAT_SLUGS[cat], label + ' 终态可见集合'); eq(r.pos, ['relative'], label + ' 终态可见卡 position'); eq(r.op, ['1'], label + ' 终态可见卡 opacity');
  eq(r.inlineAbs, 0, label + ' 终态不应残留内联 position:absolute'); eq(r.stuckOp, 0, label + ' 终态不应残留 opacity:0 内联样式'); eq(r.pressed, [cat], label + ' 终态按下的芯片');
}
// 单次切换分析：返回真实数值，断言见 plan-v2 A-6。
function analyse(label, rec, { refreshExactly = null } = {}) {
  const s = rec.s, h0 = rec.h0, h1 = s[s.length - 1].wallH, D = Math.abs(h1 - h0), dir = Math.sign(h1 - h0);
  const hs = s.map(x => x.wallH), out = { label, h0: Math.round(h0), h1: Math.round(h1), frames: s.length };
  out.minH = Math.round(Math.min(...hs)); out.maxH = Math.round(Math.max(...hs));
  ok(Math.min(...hs) >= Math.min(h0, h1) - 2, `${label}：墙高塌陷，最小 ${out.minH} < min(${Math.round(h0)}, ${Math.round(h1)}) - 2`);
  ok(Math.max(...hs) <= Math.max(h0, h1) + 2, `${label}：墙高超出，最大 ${out.maxH} > max(${Math.round(h0)}, ${Math.round(h1)}) + 2`);
  let ratio = 0, back = 0;
  for (let i = 1; i < s.length && D > 2; i++) {
    const dt = s[i].t - s[i - 1].t, d = s[i].wallH - s[i - 1].wallH, peak = PEAK_SLOPE * D * dt / MORPH_MS;
    if (peak > 0) ratio = Math.max(ratio, Math.abs(d) / peak);
    back = Math.max(back, -d * dir);
    ok(Math.abs(d) <= 1.15 * peak + 2, `${label}：第 ${i} 帧墙高位移 ${d.toFixed(1)}px 超过斜率上界 ${(1.15 * peak + 2).toFixed(1)}px（dt=${dt.toFixed(0)}ms）`);
  }
  if (D > 120) ok(back <= 2, `${label}：墙高出现回头 ${back.toFixed(1)}px`);
  out.maxRatio = +ratio.toFixed(2);
  const gap = s.map(x => x.aboutTop - x.wallBottom);
  out.aboutGapRange = +(Math.max(...gap) - Math.min(...gap)).toFixed(2);
  ok(out.aboutGapRange <= 2, `${label}：#about 顶与墙底的间距极差 ${out.aboutGapRange} > 2`);
  // 页面被新高度夹住滚动（文档比 scrollY + 视口还矮）时，筛选条位移是浏览器的合法行为，不计入断言。
  out.canHold = Math.min(...s.map(x => x.docH)) - rec.vh >= rec.scroll0 - 1;
  const ft = s.map(x => x.filtersTop), sy = s.map(x => x.scrollY);
  out.filtersRange = +(Math.max(...ft) - Math.min(...ft)).toFixed(2); out.scrollRange = +(Math.max(...sy) - Math.min(...sy)).toFixed(2);
  if (out.canHold) { ok(out.filtersRange <= 2, `${label}：#filters 顶极差 ${out.filtersRange} > 2`); ok(out.scrollRange <= 2, `${label}：scrollY 极差 ${out.scrollRange} > 2`); }
  out.overflowBelowWall = Math.round(Math.max(...s.map(x => x.overflow)));
  // 结算：墙高到位之后 600ms 内，常驻卡不得瞬跳，位移须是缓动（斜率 ≤ 结算缓动峰值）。
  if (D > 2) {
    let k = s.length - 1;
    while (k > 0 && Math.abs(s[k - 1].wallH - h1) <= 1) k--;
    const i0 = Math.max(0, k - 1), win = s.filter((x, i) => i >= i0 && x.ts <= s[k].ts + 600);
    const resident = Object.keys(s[0].tops).filter(slug => slug in s[s.length - 1].tops);
    let worst = 0, worstTotal = 0;
    for (const slug of resident) {
      const total = Math.abs(win[win.length - 1].tops[slug] - win[0].tops[slug]);
      for (let i = 1; i < win.length; i++) {
        const dt = win[i].ts - win[i - 1].ts, d = Math.abs(win[i].tops[slug] - win[i - 1].tops[slug]), lim = SETTLE_PEAK * 1.15 * total * dt / SETTLE_MS + 4;
        if (d > worst) { worst = d; worstTotal = total; }
        ok(d <= lim, `${label}：常驻卡 ${slug} 在结算窗口内一帧跳 ${d.toFixed(1)}px（总位移 ${total.toFixed(1)}px，上界 ${lim.toFixed(1)}px，dt=${dt.toFixed(0)}ms）序列 ${win.map(x => x.tops[slug].toFixed(1)).join(',')}；墙高 ${win.map(x => Math.round(x.wallH)).join(',')}`);
      }
    }
    out.settleMaxFrame = +worst.toFixed(1); out.settleTotalAtWorst = +worstTotal.toFixed(1);
  }
  out.refreshCalls = rec.refresh.length;
  if (refreshExactly !== null) eq(rec.refresh.length, refreshExactly, `${label}：parallax 结算次数`);
  else ok(rec.refresh.length <= 1, `${label}：parallax 结算次数 ${rec.refresh.length} > 1`);
  for (const c of rec.refresh) ok(Math.abs(c.wallH - h1) <= 2 && c.inline === '', `${label}：refresh 应在墙高到位后调用，实际墙高 ${Math.round(c.wallH)}（目标 ${Math.round(h1)}）内联 '${c.inline}'`);
  return out;
}
async function primeFilter(st, { desktop }) {
  const p = st.page;
  await p.waitForSelector('#worksWall .slot');
  await p.waitForFunction(d => !d || document.documentElement.classList.contains('has-parallax'), desktop, { timeout: 15000 });
  await p.waitForTimeout(1200);
  await installProbe(p);
}
async function chain(st, label, { desktop }) {
  const p = st.page, legs = [], H = { all: null };
  await primeFilter(st, { desktop });
  await scrollFilters(p); await p.waitForTimeout(800);
  H.all = await p.evaluate(() => document.getElementById('worksWall').getBoundingClientRect().height);
  for (let i = 1; i < CHAIN.length; i++) {
    const from = CHAIN[i - 1], to = CHAIN[i];
    await scrollFilters(p); await p.waitForTimeout(300);
    const rec = await recordSwitch(p, () => clickChip(p, to), 1800);
    legs.push(analyse(`${label} ${from}→${to}`, rec, { refreshExactly: desktop ? 1 : null }));
    await terminal(p, to, `${label} ${from}→${to}`);
    H[to] = H[to] || legs[legs.length - 1].h1;
  }
  return { legs, H };
}
async function quickClicks(st, label, H) {
  const p = st.page, seq = ['software', 'daily', 'game', 'all', 'web'];
  await scrollFilters(p); await p.waitForTimeout(500);
  const rec = await recordSwitch(p, () => p.evaluate(async cats => { for (const c of cats) { document.querySelector(`#filters [data-cat=${c}]`).click(); await new Promise(r => setTimeout(r, 120)); } }, seq), 2500);
  const starts = ['all', ...seq.slice(0, -1)].map(c => H[c]), targets = seq.map(c => H[c]), all = [...starts, ...targets];
  const lo = Math.min(...targets) - 2, hi = Math.max(...starts) + 2, D = Math.max(...all) - Math.min(...all), hs = rec.s.map(x => x.wallH);
  ok(Math.min(...hs) >= lo, `${label} 快速连点：墙高塌陷 ${Math.round(Math.min(...hs))} < ${Math.round(lo)}`); ok(Math.max(...hs) <= hi, `${label} 快速连点：墙高 ${Math.round(Math.max(...hs))} > ${Math.round(hi)}`);
  let ratio = 0;
  for (let i = 1; i < rec.s.length; i++) {
    const dt = rec.s[i].t - rec.s[i - 1].t, d = rec.s[i].wallH - rec.s[i - 1].wallH, peak = PEAK_SLOPE * D * dt / MORPH_MS;
    if (peak > 0) ratio = Math.max(ratio, Math.abs(d) / peak);
    ok(Math.abs(d) <= 1.15 * peak + 2, `${label} 快速连点：第 ${i} 帧墙高位移 ${d.toFixed(1)}px 超过上界 ${(1.15 * peak + 2).toFixed(1)}px`);
  }
  await terminal(p, 'web', label + ' 快速连点');
  return { frames: rec.s.length, minH: Math.round(Math.min(...hs)), maxH: Math.round(Math.max(...hs)), lo: Math.round(lo), hi: Math.round(hi), maxRatio: +ratio.toFixed(2), refreshCalls: rec.refresh.length };
}
const summary = legs => ({
  minWallH: Math.min(...legs.map(l => l.minH)), maxRatio: Math.max(...legs.map(l => l.maxRatio)), aboutGapRangeMax: Math.max(...legs.map(l => l.aboutGapRange)),
  filtersRangeMax: Math.max(...legs.filter(l => l.canHold).map(l => l.filtersRange)), heldLegs: legs.filter(l => l.canHold).length, legs: legs.length,
  settleMaxFrame: Math.max(...legs.map(l => l.settleMaxFrame || 0)), maxOverflowBelowWall: Math.max(...legs.map(l => l.overflowBelowWall)), refreshCalls: legs.map(l => l.refreshCalls)
});
async function midShot(browser, name, o) {
  const st = await go(await openPage(browser, o)); const p = st.page;
  try {
    await primeFilter(st, { desktop: !o.touch }); await scrollFilters(p); await p.waitForTimeout(600);
    // 暂停全部进行中的动画后截图，保证拿到的是同一时刻的中间帧
    for (const [to, tag] of [['daily', 'all-daily'], ['all', 'daily-all']]) {
      await clickChip(p, to); await p.waitForTimeout(330);
      await p.evaluate(() => { window.__paused = document.getAnimations().filter(a => a.playState === 'running'); window.__paused.forEach(a => a.pause()); });
      await p.screenshot({ path: await shotPath('filter', `mid-${tag}-${name}`) });
      await p.evaluate(() => { (window.__paused || []).forEach(a => a.play()); window.__paused = []; });
      await p.waitForTimeout(1500);
    }
    clean(st);
  } finally { await close(st); }
}
async function filter(browser) {
  for (const [name, o, desktop] of [['1440x900', {}, true], ['390x844', { touch: true, viewport: { width: 390, height: 844 } }, false]]) {
    await step(`filter: ${name} 五类互切——墙高连续不塌陷、关于区刚性随动、结算无瞬跳、refresh 仅一次；快速连点 5 次`, async () => {
      const st = await go(await openPage(browser, o));
      try { // 失败也要关页：否则未结束的 rAF 采样器会拖慢后续步骤
        const { legs, H } = await chain(st, name, { desktop });
        const quick = await quickClicks(st, name, H);
        clean(st);
        return { ...summary(legs), H: Object.fromEntries(Object.entries(H).map(([k, v]) => [k, Math.round(v)])), quick };
      } finally { await close(st); }
    });
    await step(`filter: ${name} 补间中间帧截图（all→daily、daily→all，目检卡片不压字幕条/关于区）`, async () => { await midShot(browser, name, o); });
  }
  for (const [label, o] of [['reduced-motion', { reduced: true }], ['禁用 FLIP', { init: [NO_FLIP] }]]) {
    await step(`filter: ${label} 一帧内切换，无 0 值、无 opacity<1 采样`, async () => {
      const st = await go(await openPage(browser, o)); const p = st.page;
      try {
        await p.waitForSelector('#worksWall .slot'); await p.waitForTimeout(1500); await installProbe(p);
        const out = [];
        for (const [from, to] of [['all', 'daily'], ['daily', 'all'], ['all', 'software']]) {
          await scrollFilters(p); await p.waitForTimeout(300);
          const rec = await recordSwitch(p, () => clickChip(p, to), 1000);
          const vals = [...new Set(rec.s.map(x => Math.round(x.wallH)))];
          ok(vals.length <= 2 && !vals.includes(0), `${label} ${from}→${to}：墙高取值应只有旧→新 ${JSON.stringify(vals)}`);
          ok(rec.s.every(x => x.minOp === 1), `${label} ${from}→${to}：存在 opacity<1 采样（闪烁）：${Math.min(...rec.s.map(x => x.minOp))}`);
          await terminal(p, to, `${label} ${from}→${to}`);
          out.push({ leg: from + '→' + to, vals });
        }
        eq(st.errors.filter(e => !/404|vendor/i.test(e)), [], label + ' 控制台错误'); eq(st.external, []);
        return out;
      } finally { await close(st); }
    });
  }
  await step('filter: popstate 即时路径——隐藏过的卡再显示时 opacity 为 1，且 refresh 仅一次', async () => {
    const st = await go(await openPage(browser)); const p = st.page;
    try {
      await primeFilter(st, { desktop: true });
      await p.evaluate(() => history.pushState(null, '', '#cat=game')); // 记下一条历史，分类不变
      await clickChip(p, 'daily'); await p.waitForTimeout(1800); // 动画切换（replaceState 覆盖上面那条）
      await p.evaluate(() => { window.__probe.refresh = []; });
      await p.evaluate(() => history.back()); await p.waitForTimeout(900);
      const r = await p.evaluate(() => ({ hash: location.hash, op: [...new Set([...document.querySelectorAll('#worksWall .slot:not([hidden])')].map(s => getComputedStyle(s).opacity))], n: document.querySelectorAll('#worksWall .slot:not([hidden])').length, stuck: [...document.querySelectorAll('#worksWall .slot')].filter(s => s.style.opacity === '0').length, h: document.getElementById('worksWall').style.height, refresh: window.__probe.refresh.length }));
      eq(r.n, 14, 'popstate 回到 all 后应有 14 张可见'); eq(r.op, ['1'], 'popstate 显示出来的卡应不透明'); eq(r.stuck, 0); eq(r.h, ''); eq(r.refresh, 1, 'popstate 即时路径 refresh 次数');
      clean(st);
      return r;
    } finally { await close(st); }
  });
}

// =============================================================== pages
// 子页面（game/ minsheng/ messages/ privacy/）的 SHARD 外壳验收：页首页脚、主题同步、哈希路由、擦屏过渡、日报保留项、留言安全、
// 版式与对比度、色彩占比、零圆角，并产出 4 页 × 日/夜 × 桌面/手机 的截图（screenshots/pages/）。
const SUB = [['game', '/game/'], ['minsheng', '/minsheng/'], ['messages', '/messages/'], ['privacy', '/privacy/']];
const SUPA_LIST = '**/functions/v1/list-messages*';
const MSG_FIXTURE = {
  items: [
    { id: 'm1', nickname: '春', content: '你好，这是一条已审核留言。', approvedAt: '2026-10-16T03:00:00Z', reply: { content: '欢迎常来。', repliedAt: '2026-10-16T04:00:00Z' } },
    { id: 'm2', nickname: '<img src=x onerror="window.__xss=1">', content: '<script>window.__xss=2</script> 纯文本 & <b>不应加粗</b>', approvedAt: '2026-10-16T05:00:00Z', reply: null }
  ],
  nextCursor: null
};
const msgRoutes = () => [[SUPA_LIST, r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MSG_FIXTURE) })]];
// 记录页面里是否出现过 .wipe 擦屏层（跨导航保存在 sessionStorage），用于验证过渡发生 / 未发生
const WIPE_SPY = () => {
  const mark = () => { try { sessionStorage.setItem('__wipeSeen', '1'); } catch { /* 忽略 */ } };
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('wipe')) mark(); }).observe(document, { childList: true, subtree: true });
};
const THROW_ANIMATE = () => { Element.prototype.animate = function () { throw new Error('animate 被禁用'); }; };

async function subOpen(browser, url, o = {}) {
  const st = await openPage(browser, { ...o, routes: [...msgRoutes(), ...(o.routes || [])], init: [...(o.init || [])] });
  if (o.theme) await st.ctx.addInitScript(t => { try { localStorage.setItem('springhues.home.theme', t); } catch { /* 忽略 */ } }, o.theme);
  await st.page.goto(BASE + url, { waitUntil: 'load' });
  await subReady(st.page, url);
  return st;
}
async function subReady(p, url) {
  await p.waitForSelector('.sd-top', { timeout: 15000 });
  if (url.startsWith('/game')) await p.waitForFunction(() => { const n = document.querySelector('#navDate'); return n && !/加载/.test(n.textContent) && document.querySelectorAll('#newsList > *').length > 0; }, null, { timeout: 15000 });
  if (url.startsWith('/minsheng')) await p.waitForFunction(() => { const n = document.querySelector('#navDate'); return n && !/加载/.test(n.textContent) && document.querySelectorAll('#domesticStories > *').length > 0 && document.querySelector('#loading')?.classList.contains('hidden'); }, null, { timeout: 15000 });
  if (url.startsWith('/messages')) await p.waitForFunction(() => !/正在读取/.test(document.getElementById('messageState').textContent), null, { timeout: 15000 });
  await p.waitForTimeout(500);
}
const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const hex = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
const rgbOf = s => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);

async function pages(browser) {
  const gameDate = await latestDate('data/index.json'), civicDate = await latestDate('data/minsheng/index.json');

  await step('pages: 四页都有页首与页脚；旧侧栏隐藏；页脚五个目标；整页无 admin 链接；无报错 / 404 / 外部请求', async () => {
    const out = {};
    for (const [name, url] of SUB) {
      const st = await subOpen(browser, url); const p = st.page;
      const r = await p.evaluate(() => {
        const vis = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
        const foot = [...document.querySelectorAll('.sd-foot nav a')];
        return {
          top: !!document.querySelector('header.sd-top'), foot: foot.map(a => a.textContent), hrefs: foot.map(a => new URL(a.href).pathname),
          rail: vis(document.querySelector('.site-rail')), padLeft: parseFloat(getComputedStyle(document.body).paddingLeft),
          admin: document.querySelectorAll('a[href*="admin/"]').length, title: document.querySelector('.sd-title b')?.textContent,
          logoHref: new URL(document.querySelector('.sd-corner').href).pathname, logoLabel: document.querySelector('.sd-corner').getAttribute('aria-label'),
          menuLinks: [...document.querySelectorAll('.sd-menu-nav a')].map(a => new URL(a.href).pathname + new URL(a.href).hash),
          themeBtn: !!document.querySelector('.sd-actions button'), live: document.documentElement.classList.contains('shard-live')
        };
      });
      ok(r.top && r.live && r.themeBtn, name + ' 缺少页首 / shard-live / 主题按钮');
      eq(r.foot, ['返回首页', '游戏日报', '民生日报', '留言簿', '隐私说明'], name + ' 页脚文案');
      eq(r.hrefs, ['/', '/game/', '/minsheng/', '/messages/', '/privacy/'], name + ' 页脚目标');
      ok(!r.rail && r.padLeft === 0, name + ' 旧侧栏应隐藏且无左侧让位：' + JSON.stringify({ rail: r.rail, pad: r.padLeft }));
      eq(r.admin, 0, name + ' 不得有 admin 链接');
      eq([r.logoHref, r.logoLabel], ['/', 'Springhues 首页'], name + ' logo');
      eq(r.menuLinks, ['/#works', '/#cat=daily', '/#about', '/game/', '/minsheng/', '/messages/', '/privacy/'], name + ' 菜单');
      clean(st); await close(st); out[name] = r.title;
    }
    return out;
  });

  await step('pages: 菜单键盘可达（Enter 打开、Tab 圈住、Esc 关闭、焦点回按钮、背景 inert）', async () => {
    const st = await subOpen(browser, '/messages/'); const p = st.page;
    await p.focus('.sd-actions button:nth-child(2)'); await p.keyboard.press('Enter'); await p.waitForTimeout(1100);
    ok(await p.isVisible('#sdMenu'), '菜单应打开');
    eq(await p.evaluate(() => ({ expanded: document.querySelector('.sd-actions button:nth-child(2)').getAttribute('aria-expanded'), inertMain: document.querySelector('main').hasAttribute('inert'), inertTop: document.querySelector('.sd-top').hasAttribute('inert'), inertFoot: document.querySelector('.sd-foot').hasAttribute('inert'), inside: document.getElementById('sdMenu').contains(document.activeElement) })), { expanded: 'true', inertMain: true, inertTop: true, inertFoot: true, inside: true });
    for (let i = 0; i < 12; i++) await p.keyboard.press('Tab');
    ok(await p.evaluate(() => document.getElementById('sdMenu').contains(document.activeElement)), 'Tab 应被圈在菜单内');
    await p.screenshot({ path: await shotPath('pages', 'menu-open-messages-1440x900') });
    await p.keyboard.press('Escape'); await p.waitForTimeout(1100);
    eq(await p.evaluate(() => ({ hidden: document.getElementById('sdMenu').hidden, focus: document.activeElement === document.querySelector('.sd-actions button:nth-child(2)'), inert: document.querySelector('main').hasAttribute('inert') })), { hidden: true, focus: true, inert: false });
    clean(st); await close(st);
  });

  await step('pages: 主题——默认跟随系统、手动切换写入同一键、刷新保持、首页与子页面双向同步', async () => {
    let st = await subOpen(browser, '/messages/', { dark: true }); let p = st.page;
    eq(await p.getAttribute('html', 'data-theme'), 'night', '默认跟随系统（夜）');
    eq(await p.evaluate(() => localStorage.getItem('springhues.home.theme')), null, '未手动选择时不写存储');
    await p.click('.sd-actions button:nth-child(1)'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => document.getAnimations().some(a => a.effect?.target?.closest?.('.wipe'))), '切换主题应有擦屏');
    await p.waitForTimeout(1300);
    eq(await p.getAttribute('html', 'data-theme'), 'day'); eq(await p.evaluate(() => localStorage.getItem('springhues.home.theme')), 'day');
    eq(await p.evaluate(() => document.querySelector('meta[name=theme-color]').content), '#F4F6FF');
    await p.reload(); await subReady(p, '/messages/');
    eq(await p.getAttribute('html', 'data-theme'), 'day', '刷新保持');
    await p.emulateMedia({ colorScheme: 'light' }); await p.emulateMedia({ colorScheme: 'dark' }); await p.waitForTimeout(300);
    eq(await p.getAttribute('html', 'data-theme'), 'day', '手动选择后不再跟随系统');
    // 同一浏览器上下文：子页面选 night → 首页应是 night；首页再切回 day → 另一个子页面应是 day
    await p.click('.sd-actions button:nth-child(1)'); await p.waitForTimeout(1400);
    eq(await p.getAttribute('html', 'data-theme'), 'night');
    const home = await st.ctx.newPage(); await home.goto(BASE + '/'); await home.waitForFunction(() => !document.documentElement.classList.contains('is-loading'));
    eq(await home.getAttribute('html', 'data-theme'), 'night', '首页应同步子页面的选择');
    await home.click('#btnTheme'); await home.waitForTimeout(1500);
    eq(await home.evaluate(() => localStorage.getItem('springhues.home.theme')), 'day');
    const game = await st.ctx.newPage(); await game.goto(BASE + '/game/'); await game.waitForSelector('.sd-top');
    eq(await game.getAttribute('html', 'data-theme'), 'day', '日报页应同步首页的选择');
    await p.bringToFront(); await p.waitForTimeout(300);
    eq(await p.getAttribute('html', 'data-theme'), 'day', '已打开的子页面通过 storage 事件同步');
    await close(st);
  });

  await step('pages: 路由——子页菜单 → 首页 #works / #cat=daily / #about；旧 ?view=journal 仍可用', async () => {
    const viaMenu = async (linkText, check) => {
      const st = await subOpen(browser, '/privacy/'); const p = st.page;
      await p.click('.sd-actions button:nth-child(2)'); await p.waitForSelector('#sdMenu:not([hidden])'); await p.waitForTimeout(900);
      await p.click(`.sd-menu-nav a:has-text("${linkText}")`);
      await p.waitForURL(u => new URL(u).pathname === '/', { timeout: 8000 });
      await p.waitForSelector('#worksWall .slot', { state: 'attached', timeout: 15000 }); await p.waitForTimeout(1800);
      const r = await check(p); clean(st); await close(st); return r;
    };
    const works = await viaMenu('作品', p => p.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('works').getBoundingClientRect().top), vh: innerHeight })));
    eq(works.hash, '#works'); ok(Math.abs(works.top) <= 80, '#works 应滚到视口顶：' + works.top);
    const daily = await viaMenu('每日简报', p => p.evaluate(() => ({ hash: location.hash, pressed: [...document.querySelectorAll('#filters [aria-pressed="true"]')].map(b => b.dataset.cat), top: Math.round(document.getElementById('works').getBoundingClientRect().top) })));
    eq([daily.hash, daily.pressed], ['#cat=daily', ['daily']]); ok(Math.abs(daily.top) <= 80, '#cat=daily 应滚到作品区：' + daily.top);
    const about = await viaMenu('关于', p => p.evaluate(() => ({ hash: location.hash, top: Math.round(document.getElementById('about').getBoundingClientRect().top) })));
    eq(about.hash, '#about'); ok(Math.abs(about.top) <= 80, '#about 应滚到视口顶：' + about.top);
    const st = await go2(browser, '/?view=journal');
    return { works: works.top, daily: daily.top, about: about.top, legacy: st };
  });

  await step('pages: 擦屏过渡——站内链接出现 .wipe 且 ≤1.5s 内到达；reduced-motion 直接跳转；animate 抛错仍能跳转；缓存恢复复位', async () => {
    const hop = async (o, expectWipe) => {
      const st = await subOpen(browser, '/privacy/', { ...o, init: [WIPE_SPY, ...(o.init || [])] }); const p = st.page; const t0 = Date.now();
      await p.click('.sd-foot nav a:has-text("留言簿")');
      await p.waitForURL(u => new URL(u).pathname === '/messages/', { timeout: 6000 });
      const took = Date.now() - t0;
      await p.waitForSelector('.sd-top'); await p.waitForTimeout(1200);
      const r = await p.evaluate(() => ({ seen: sessionStorage.getItem('__wipeSeen'), arrive: document.documentElement.classList.contains('shard-arrive'), leftover: [...document.querySelectorAll('.wipe i')].some(i => i.style.clipPath || i.style.opacity) }));
      if (expectWipe !== null) eq(r.seen, expectWipe ? '1' : null, '擦屏层出现与否');
      ok(!r.arrive && !r.leftover, '到达后遮罩与内联样式应清理干净：' + JSON.stringify(r));
      if (o.__shot) await p.screenshot({ path: await shotPath('pages', o.__shot) });
      clean(st); await close(st); return took;
    };
    const normal = await hop({}, true);
    ok(normal <= 1500, '过渡到达时间 ' + normal + 'ms');
    const reduced = await hop({ reduced: true }, false);
    const broken = await hop({ init: [THROW_ANIMATE] }, null);
    // 过渡中途静态帧
    const st = await subOpen(browser, '/privacy/'); const p = st.page;
    await p.click('.sd-foot nav a:has-text("留言簿")'); await p.waitForTimeout(180);
    ok(await p.evaluate(() => !!document.querySelector('.wipe') && document.getAnimations().some(a => a.effect?.target?.closest?.('.wipe'))), '点击后应有进行中的擦屏动画');
    await p.screenshot({ path: await shotPath('pages', 'wipe-leave-frame') });
    await p.waitForURL(u => new URL(u).pathname === '/messages/'); await close(st);
    // 同源到达 → html.shard-arrive 会在 JS 就绪后移除；pageshow(persisted) 复位
    const st2 = await subOpen(browser, '/privacy/'); const q = st2.page;
    const r = await q.evaluate(() => { const d = document.documentElement; d.classList.add('shard-arrive'); const e = new Event('pageshow'); e.persisted = true; window.dispatchEvent(e); return d.classList.contains('shard-arrive'); });
    eq(r, false, 'pageshow persisted 应移除 shard-arrive'); await close(st2);
    return { normal, reduced, broken };
  });

  await step('pages: 首页 → 子页面 → 首页往返：首页菜单链接与命令面板都走过渡，到达首页不重播开场', async () => {
    const st = await openPage(browser, { init: [WIPE_SPY], routes: msgRoutes() }); const p = st.page;
    await go(st); await p.waitForSelector('#worksWall .slot');
    await p.click('#btnMenu'); await p.waitForSelector('#menu:not([hidden])'); await p.waitForTimeout(1200); await p.click('#menu a[href="messages/"]');
    await p.waitForURL(u => new URL(u).pathname === '/messages/'); await p.waitForSelector('.sd-top');
    eq(await p.evaluate(() => sessionStorage.getItem('__wipeSeen')), '1', '首页 → 留言页应出现擦屏层');
    await p.click('.sd-foot nav a:has-text("返回首页")'); await p.waitForURL(u => new URL(u).pathname === '/');
    await p.waitForTimeout(2500);
    const r = await p.evaluate(() => ({ intro: document.documentElement.dataset.intro, loading: document.documentElement.classList.contains('is-loading'), arrive: document.documentElement.classList.contains('shard-arrive'), arrival: document.documentElement.classList.contains('shard-arrival'), loader: getComputedStyle(document.getElementById('loader')).display }));
    eq(r, { intro: 'skip', loading: false, arrive: false, arrival: true, loader: 'none' }, '到达首页不重播开场');
    // 命令面板
    await p.keyboard.press('Control+k'); await p.fill('#paletteInput', '隐私'); await p.waitForTimeout(250); await p.keyboard.press('Enter');
    await p.waitForURL(u => new URL(u).pathname === '/privacy/', { timeout: 6000 });
    clean(st); await close(st);
  });

  await step('pages: 日报页 → 留言页 / 隐私页 / 另一频道 的菜单与页脚擦屏跳转不抛未捕获错误（brand.css 的跨文档 View Transition 与目标页配对）', async () => {
    const out = {};
    for (const [name, url] of [['game', '/game/'], ['minsheng', '/minsheng/']]) {
      for (const [via, target, text] of [['menu', '/messages/', '留言簿'], ['menu', '/privacy/', '隐私说明'], ['foot', '/messages/', '留言簿'], ['foot', '/', '返回首页'], ['foot', name === 'game' ? '/minsheng/' : '/game/', name === 'game' ? '民生日报' : '游戏日报']]) {
        const st = await subOpen(browser, url, { init: [WIPE_SPY] }); const p = st.page;
        if (via === 'menu') { await p.click('.sd-actions button:nth-child(2)'); await p.waitForSelector('#sdMenu:not([hidden])'); await p.waitForTimeout(900); await p.click(`.sd-menu-nav a:has-text("${text}")`); }
        else await p.click(`.sd-foot nav a:has-text("${text}")`);
        await p.waitForURL(u => new URL(u).pathname === target, { timeout: 8000 });
        await p.waitForSelector(target === '/' ? '#worksWall .slot' : '.sd-top', { state: 'attached' }); await p.waitForTimeout(1500);
        ok(!st.errors.some(e => /pageerror/.test(e)), `${name} ${via} → ${target} 不应有未捕获错误：${st.errors.join('|')}`);
        eq(await p.evaluate(() => sessionStorage.getItem('__wipeSeen')), '1', `${name} ${via} → ${target} 应出现擦屏层`);
        clean(st); await close(st);
      }
      out[name] = 'ok';
    }
    return out;
  });

  await step('pages: 日报——?date= 有效 / 无效 / 未来日期回退，下载按钮指向当前期，外链 rel，来源标识，原始链接', async () => {
    const out = {};
    for (const [name, base, date, dl] of [['game', '/game/', gameDate, 'downloads/game/'], ['minsheng', '/minsheng/', civicDate, 'downloads/minsheng/']]) {
      for (const [label, q, expect] of [['有效', `?date=${date}`, date], ['无效', '?date=bad', date], ['未来', '?date=2099-01-01', date], ['缺省', '', date]]) {
        const st = await subOpen(browser, base + q); const p = st.page;
        const r = await p.evaluate(() => ({ nav: document.getElementById('navDate').textContent, href: document.getElementById('downloadPng').getAttribute('href'), dl: document.getElementById('downloadPng').hasAttribute('download'), ext: [...document.querySelectorAll('a[target=_blank]')].map(a => a.rel) }));
        eq(r.nav, expect, `${name} ?date 的 ${label} 应显示 ${expect}`);
        ok(new RegExp(`${dl}${expect}\\.png`).test(r.href) && r.dl, `${name} 下载按钮应指向当前期 PNG：${r.href}`);
        ok(r.ext.length > 0 && r.ext.every(x => /noopener/.test(x) && /noreferrer/.test(x)), `${name} 外链 rel：${r.ext.join('|')}`);
        if (label === '有效') {
          const more = await p.evaluate(() => ({ links: document.querySelectorAll('main a[href^="http"]').length, dialog: !!document.querySelector('dialog') }));
          ok(more.links >= 10 && more.dialog, `${name} 原始可点击链接与归档弹窗：${JSON.stringify(more)}`);
          await p.click('.archive-trigger'); await p.waitForTimeout(500);
          ok(await p.evaluate(() => document.querySelector('dialog').open), `${name} 归档弹窗应可打开`);
          await p.screenshot({ path: await shotPath('pages', `archive-dialog-${name}-1440x900`) });
          await p.keyboard.press('Escape'); await p.waitForTimeout(300);
        }
        clean(st); await close(st);
      }
      out[name] = date;
    }
    // 民生：外网来源标识由网页生成
    const brief = JSON.parse(await fs.readFile(path.join(root, 'data', 'minsheng', civicDate + '.json'), 'utf8'));
    const ext = [...Object.values(brief.sections || {}).flat(), ...(brief.metrics || [])].filter(i => i.sourceOrigin === 'external');
    const st = await subOpen(browser, '/minsheng/?date=' + civicDate);
    const text = await st.page.evaluate(() => document.body.textContent);
    for (const it of ext) ok(text.includes(it.source + '（来自于外网）'), '外网来源标识缺失：' + it.source);
    clean(st); await close(st); out.externalLabels = ext.length;
    return out;
  });

  await step('pages: 民生 桌面逐行对齐（≥1501）与窄屏 height:auto 重置在线上同时有效（1920 / 1600 / 1440 / 1180 / 390）', async () => {
    const out = {};
    for (const w of [1920, 1600, 1440, 1180, 390]) {
      const st = await subOpen(browser, '/minsheng/', { viewport: { width: w, height: w < 700 ? 844 : 900 }, touch: w < 700 }); const p = st.page;
      await p.waitForTimeout(800);
      const r = await p.evaluate(() => {
        const cols = ['domesticStories', 'internationalStories', 'techStories'].map(id => [...document.getElementById(id).children].map(s => Math.round(s.getBoundingClientRect().height)));
        const inline = [...document.querySelectorAll('.story')].filter(s => s.style.height).length;
        const overlap = [...document.querySelectorAll('.story-list')].some(list => { const k = [...list.children].map(c => c.getBoundingClientRect()); return k.some((b, i) => i && b.top < k[i - 1].bottom - 1); });
        const clipped = [...document.querySelectorAll('.story')].filter(s => s.scrollHeight > s.getBoundingClientRect().height + 2).length;
        return { cols, inline, overlap, clipped, sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth };
      });
      ok(!r.overlap && r.clipped === 0 && r.sw <= r.cw, `${w}px 行重叠 / 内容被裁 / 溢出：${JSON.stringify({ overlap: r.overlap, clipped: r.clipped, sw: r.sw })}`);
      if (w >= 1501) {
        eq(r.cols[0].length, 10); eq(r.cols[1].length, 10); eq(r.cols[2].length, 10);
        for (let i = 0; i < 10; i++) ok(Math.abs(r.cols[0][i] - r.cols[1][i]) <= 1 && Math.abs(r.cols[0][i] - r.cols[2][i]) <= 1, `${w}px 第 ${i + 1} 行三栏高度应一致：${r.cols.map(c => c[i])}`);
        ok(r.inline > 0, `${w}px 应有内联对齐高度`);
      } else {
        // ≤1500：app.js 的 alignStoryRows 不介入（matchMedia min-width:1501px），也不应残留内联高度；窄屏由 height:auto !important 兜底
        eq(r.inline, 0, `${w}px 不应残留内联行高`);
      }
      out[w] = { inline: r.inline, first: r.cols[0].slice(0, 3) };
      if (w === 1440 || w === 390) await p.screenshot({ path: await shotPath('pages', `minsheng-aligned-${w}`), fullPage: false });
      clean(st); await close(st);
    }
    return out;
  });

  await step('pages: 留言——配置齐全时表单结构与安全；配置未完成时安全禁用且不发往未知地址；纯文本渲染', async () => {
    let st = await subOpen(browser, '/messages/'); let p = st.page;
    const r = await p.evaluate(() => {
      const hp = document.querySelector('.honeypot'), slot = document.querySelector('.turnstile-slot'), hb = hp.getBoundingClientRect(), sb = slot.getBoundingClientRect();
      const bad = []; for (let n = slot.parentElement; n && n !== document.documentElement; n = n.parentElement) { const s = getComputedStyle(n); if (s.clipPath !== 'none' || s.overflowX === 'hidden' || s.overflowY === 'hidden') bad.push(n.tagName + '.' + n.className); }
      return {
        nick: document.querySelector('[name=nickname]').maxLength, content: document.querySelector('[name=content]').maxLength, counter: document.querySelector('[data-message-counter]').textContent,
        hpOff: hb.right <= 0 || hb.left < -5000, hpAria: hp.getAttribute('aria-hidden'), hpTab: hp.querySelector('input').tabIndex, slot: [Math.round(sb.width), Math.round(sb.height)], bad,
        btnDisabled: document.querySelector('button[type=submit]').disabled, items: document.querySelectorAll('.message-item').length, xss: window.__xss ?? null, imgs: document.querySelectorAll('#messageList img, #messageList script, #messageList b').length,
        names: [...document.querySelectorAll('.message-item h3')].map(h => h.textContent), reply: document.querySelectorAll('.owner-reply:not([hidden])').length, hiddenReply: document.querySelectorAll('.owner-reply[hidden]').length
      };
    });
    eq([r.nick, r.content], [20, 300]); eq(r.counter, '0/300'); ok(r.hpOff && r.hpAria === 'true' && r.hpTab === -1, '蜜罐应离屏且不可聚焦'); eq(r.slot, [1, 1], 'Turnstile 挂载点 1×1');
    eq(r.bad, [], 'Turnstile 祖先不得 clip-path / overflow:hidden'); eq(r.btnDisabled, false);
    eq(r.items, 2); eq(r.xss, null, '留言内容不得执行'); eq(r.imgs, 0, '留言必须按纯文本渲染'); ok(r.names[0] === '春' && r.names[1].includes('<img'), '昵称应原样显示为文本：' + r.names);
    eq([r.reply, r.hiddenReply], [1, 1], '回复区仅在有回复时显示');
    await p.fill('[name=content]', '字数测试'); eq(await p.textContent('[data-message-counter]'), '4/300');
    await p.screenshot({ path: await shotPath('pages', 'messages-configured-1440x900') });
    clean(st); await close(st);
    // 配置未完成：用空配置替换 message-config.js
    const unconfigured = 'export const MESSAGE_CONFIG = Object.freeze({ apiBaseUrl: "", turnstileSiteKey: "", supabaseUrl: "", supabasePublishableKey: "" });\nexport function messageServiceConfigured() { return false; }\nexport function adminServiceConfigured() { return false; }\n';
    const reqs = [];
    st = await openPage(browser, { routes: [['**/message-config.js*', rt => rt.fulfill({ status: 200, contentType: 'text/javascript', body: unconfigured })]] });
    st.page.on('request', rq => reqs.push(rq.url()));
    await st.page.goto(BASE + '/messages/', { waitUntil: 'load' }); await st.page.waitForSelector('.sd-top'); await st.page.waitForTimeout(800);
    const u = await st.page.evaluate(() => ({ disabled: document.querySelector('button[type=submit]').disabled, status: document.querySelector('[data-message-status]').textContent, state: document.getElementById('messageState').textContent, loadMore: document.getElementById('loadMore').hidden }));
    eq(u.disabled, true, '未配置时提交按钮应禁用'); ok(/尚未配置/.test(u.status) && /正在配置/.test(u.state) && u.loadMore, '状态文字应说明配置未完成：' + JSON.stringify(u));
    await st.page.screenshot({ path: await shotPath('pages', 'messages-unconfigured-1440x900') });
    eq(reqs.filter(x => /supabase|cloudflare/.test(x)), [], '不得向未知地址发送请求'); clean(st); await close(st);
    return { configured: r, unconfigured: u };
  });

  await step('pages: 版式——五个宽度无水平溢出；Tab 前 12 个可聚焦元素焦点可见；对比度 ≥4.5', async () => {
    const out = {};
    for (const [name, url] of SUB) for (const w of [390, 768, 1024, 1366, 1920]) {
      const st = await subOpen(browser, url, { viewport: { width: w, height: w < 700 ? 844 : 900 }, touch: w < 700 }); const p = st.page;
      const r = await p.evaluate(() => { scrollTo(document.documentElement.scrollWidth, 0); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, sx: scrollX }; });
      ok(r.sw <= r.cw && r.sx === 0, `${name} ${w}px 水平溢出：${JSON.stringify(r)}`);
      out[`${name}@${w}`] = 'ok'; clean(st); await close(st);
    }
    for (const [name, url, n] of [['messages', '/messages/', 12], ['privacy', '/privacy/', 12], ['game', '/game/', 10], ['minsheng', '/minsheng/', 10]]) {
      const st = await subOpen(browser, url); const p = st.page; const bad = [];
      for (let i = 0; i < n; i++) {
        await p.keyboard.press('Tab');
        const f = await p.evaluate(() => {
          const el = document.activeElement; if (!el || el === document.body) return null;
          const snap = () => { const s = getComputedStyle(el); return [s.outlineStyle, s.outlineWidth, s.backgroundColor, s.boxShadow, s.transform, s.clipPath].join('|'); };
          const on = snap(); const sel = el.tagName + '.' + el.className;
          return { on, sel, vis: el.matches(':focus-visible'), rect: el.getBoundingClientRect().width > 0 };
        });
        if (!f) continue;
        if (!f.vis) bad.push(f.sel + ' 不是 :focus-visible');
        const hasOutline = !/^none\|/.test(f.on) && !/^[a-z]+\|0px\|/.test(f.on);
        const changed = await p.evaluate(() => { const el = document.activeElement; const s0 = getComputedStyle(el); const bg = s0.backgroundColor, bs = s0.boxShadow, tf = s0.transform; el.blur(); const s1 = getComputedStyle(el); const diff = s1.backgroundColor !== bg || s1.boxShadow !== bs || s1.transform !== tf; el.focus(); return diff; });
        if (!hasOutline && !changed) bad.push(f.sel + ' 焦点不可见');
      }
      eq(bad, [], `${name} 焦点可见性`); await close(st);
    }
    // 对比度：文字色取计算值，背景色按组件的设计色给定（背景画在伪元素 / 切角层上，无法从祖先链读到）
    const CONTRAST = {
      '/messages/': [['.sd-lead', '#0537B4'], ['.hero-date', '#0D1850'], ['.compose-copy p', '#FFFFFF'], ['.sd-h2', '#FFFFFF'], ['.feed-state', '#FFFFFF'], ['.sd-foot nav a', '#0C2B92'], ['button[type=submit]', '#90072A']],
      '/privacy/': [['.privacy-lead', '#0537B4'], ['.sd-plate p', '#FFFFFF'], ['.sd-plate a', '#FFFFFF'], ['.sd-plate h2', '#FFFFFF'], ['.privacy-return', '#90072A']],
      '/game/': [['.hero h1', '#0537B4'], ['.hero-copy > p', '#0537B4'], ['.compact-heading span', '#FFFFFF'], ['.news-row', '#FFFFFF'], ['.download-button', '#90072A'], ['.archive-trigger b', '#0537B4']],
      '/minsheng/': [['.masthead .title-block h1', '#0537B4'], ['.top-stories a', '#0537B4'], ['.story h3 a', '#FFFFFF'], ['.story-summary', '#FFFFFF'], ['.news-column > header h2', '#0537B4'], ['.download-button', '#90072A']]
    };
    const low = [];
    for (const [url, list] of Object.entries(CONTRAST)) for (const theme of ['day', 'night']) {
      const st = await subOpen(browser, url, { theme }); const p = st.page;
      for (const [sel, bg] of list) {
        // 夜间：留言 / 隐私的卡片底是 klein-900，日报纸面保持浅色
        const night = theme === 'night' && /messages|privacy/.test(url);
        const bgc = night ? ({ '#FFFFFF': '#0A1D6C', '#0537B4': '#0A1D6C' }[bg] || bg) : bg;
        const col = await p.evaluate(s => { const e = document.querySelector(s); return e ? getComputedStyle(e).color : null; }, sel);
        if (!col) { low.push(`${url} ${sel} 不存在`); continue; }
        const r = ratio(rgbOf(col), hex(bgc));
        if (r < 4.5) low.push(`${url} ${theme} ${sel} ${r.toFixed(2)}（${col} on ${bgc}）`);
      }
      await close(st);
    }
    eq(low, [], '对比度不足');
    return out;
  });

  await step('pages: 零圆角——四页全部元素 border-radius 为 0（仅状态点 / 加载转圈除外）', async () => {
    const out = {};
    for (const [name, url] of SUB) for (const theme of ['day', 'night']) {
      const st = await subOpen(browser, url, { theme }); const p = st.page;
      const bad = await p.evaluate(() => [...document.querySelectorAll('body *')].filter(e => !e.matches('.live-dot, .loading > span, .sd-dot, .sd-avatar') && getComputedStyle(e).borderRadius.split(/[\s/]+/).some(v => parseFloat(v) > 0)).slice(0, 10).map(e => e.tagName + '.' + e.className));
      eq(bad, [], `${name} ${theme} 存在圆角元素`);
      if (url.startsWith('/game') || url.startsWith('/minsheng')) {
        await p.click('.archive-trigger'); await p.waitForTimeout(500);
        const dlg = await p.evaluate(() => [...document.querySelectorAll('dialog *'), document.querySelector('dialog')].filter(e => getComputedStyle(e).borderRadius.split(/[\s/]+/).some(v => parseFloat(v) > 0)).map(e => e.tagName + '.' + e.className));
        eq(dlg, [], `${name} 归档弹窗存在圆角`);
      }
      out[`${name}/${theme}`] = 'ok'; await close(st);
    }
    return out;
  });

  await step('pages: 色彩占比与截图——4 页 × 日/夜 × 1440×900 / 390×844；红 ≤10%，蓝+白占绝对多数', async () => {
    const rows = {};
    for (const [name, url] of SUB) for (const theme of ['day', 'night']) for (const [w, h] of [[1440, 900], [390, 844]]) {
      const st = await subOpen(browser, url, { theme, viewport: { width: w, height: h }, touch: w < 700 }); const p = st.page;
      await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(700);
      let buf = await p.screenshot({ path: await shotPath('pages', `${name}-${theme}-${w}x${h}`) });
      // 日报首屏的新闻配图是内容而不是配色（深色照片会被最近锚点误判为红 / 墨），统计时隐藏配图卡片
      if (/game|minsheng/.test(url)) { await p.addStyleTag({ content: '.feature-card, .news-row img, .pack-row img { visibility: hidden !important; }' }); buf = await p.screenshot(); }
      const pct = await classify(browser, buf);
      rows[`${name}/${theme}/${w}`] = pct;
      ok(pct.red <= 10, `${name} ${theme} ${w} 红占比 ${pct.red}% 超过 10%`);
      const need = /game|minsheng/.test(url) ? 60 : 80; // 日报首屏含新闻配图，门槛放宽到 60%；留言 / 隐私为纯色板 ≥80%
      ok(pct.blue + pct.white >= need, `${name} ${theme} ${w} 蓝+白 ${(pct.blue + pct.white).toFixed(1)}% < ${need}%`);
      if (theme === 'night' && !/game|minsheng/.test(url)) ok(pct.blue >= 50, `${name} night ${w} 蓝占比 ${pct.blue}%（应占多数）`);
      clean(st); await close(st);
    }
    return rows;
  });
}
async function go2(browser, url) {
  const st = await openPage(browser); await go(st, url); await st.page.waitForSelector('#worksWall .slot', { state: 'attached' }); await st.page.waitForTimeout(1500);
  const r = await st.page.evaluate(() => ({ pressed: [...document.querySelectorAll('#filters [aria-pressed="true"]')].map(b => b.dataset.cat), search: location.search }));
  eq(r, { pressed: ['daily'], search: '' }, '?view=journal 应落到每日简报并清空 search'); clean(st); await close(st); return r.pressed[0];
}

// =============================================================== main
const table = { boot, hero, loader, wall, detail, chrome, responsive, degrade, filter, pages };
const names = SECTION === 'all' ? Object.keys(table) : SECTION.split(',');
const browser = await launch();
try { for (const n of names) { if (!table[n]) throw new Error('未知 section ' + n); log(`\n== ${n} ==`); await table[n](browser); } }
finally { await browser.close(); server.close(); }
const failed = results.filter(r => !r.ok);
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, `verify-summary-${SECTION.replace(/,/g, '+')}.json`), JSON.stringify(results, null, 2));
log(`\n${results.length - failed.length}/${results.length} 通过`);
if (failed.length) { log('失败项：\n' + failed.map(f => ' - ' + f.name + '：' + f.error.split('\n')[0]).join('\n')); process.exit(1); }
