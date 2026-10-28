// 新首页（SHARD）的纯函数单测与静态检查。由 scripts/test-site.mjs 末尾导入，随 CI 运行；也可单独运行：node scripts/test-home.mjs
//
// 前提：
// - Node >= 22.7。仓库没有 package.json，Node 靠语法检测识别 site/js 下 .js 的 ESM，
//   所以这些被 Node 导入的模块必须是“纯 ESM”（含 import/export），且顶层不得碰 window / document。
// - 缓存规则：除入口 main.js 外，site/js 下所有模块的导入路径都不带 ?v=。导出签名只增不改；
//   确需破坏性改动时改文件名（新文件名即新缓存键），旧文件保留一个版本后再删。
import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rel = (...p) => path.join(root, ...p);
const imp = p => import(pathToFileURL(rel(p)).href);
let checks = 0;
function check(name, fn) { return Promise.resolve(fn()).then(() => { checks += 1; }, e => { e.message = `[test-home] ${name}: ${e.message}`; throw e; }); }
async function walk(dir, ext) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await walk(full, ext));
    else if (e.name.endsWith(ext)) out.push(full);
  }
  return out;
}

const { parseWorks, safeHref, WorksDataError } = await imp('site/js/data/works.js');
const { computeTier } = await imp('site/js/core/tier.js');
const { shouldDegrade } = await imp('site/js/hero/fallback.js');
const { fitShape, hashSlug, jitterFor, sizeFor } = await imp('site/js/wall/layout.js');
const { legacyRoute, parseHash, parseAnchor } = await imp('site/js/core/url.js');
const { resolveCategory, LEGACY_CATEGORY_ALIASES } = await imp('site/js/core/category.js');
const { fuzzyFilter } = await imp('site/js/ui/fuzzy.js');
const occ = await imp('site/js/hero/occluders.js');
const { getCarrier, registerCarrier, carrierFor } = await imp('site/js/carriers/index.js');
const { createArchive, editionHref } = await imp('site/js/data/archive.js');
const { classifyFamilies } = await imp('scripts/color-family.mjs');
const shardStyle = await imp('scripts/check-shard-style.mjs');
const { scanCss, SHARD_VERSION } = shardStyle;

const worksJson = JSON.parse(await readFile(rel('site/works.json'), 'utf8'));

await check('works.json 通过校验且无丢弃', async () => {
  const warns = [];
  const w = console.warn; console.warn = (...a) => warns.push(a.join(' '));
  let parsed;
  try { parsed = parseWorks(worksJson); } finally { console.warn = w; }
  assert.equal(warns.length, 0, '真实 works.json 不应触发丢弃：' + warns.join('|'));
  assert.equal(parsed.works.length, worksJson.works.length);
  assert.ok(parsed.works.length >= 3, '至少有已填入的真实作品与两条日报');
  assert.equal(parsed.categories.length, 4);
  const carriers = Object.fromEntries(parsed.categories.map(c => [c.id, c.carrier]));
  assert.deepEqual(carriers, { software: 'window', web: 'browser', game: 'shard', daily: 'page' });
  assert.deepEqual(parsed.categories.map(c => c.id), ['software', 'game', 'web', 'daily']);
  const counts = {};
  parsed.works.forEach(x => { counts[x.category] = (counts[x.category] || 0) + 1; });
  assert.equal(counts.daily, 2, '日报分类固定两条频道卡');
  assert.ok(Object.keys(counts).every(id => id in carriers), '作品都落在已登记分类');
  assert.ok(parsed.works.every(x => x.category in carriers), '作品分类都属于四个新 id');
  assert.ok(parsed.works.every(x => x.platform === undefined || (typeof x.platform === 'string' && x.platform.length > 0 && x.platform.length <= 16)));
  const byCat = new Map(parsed.categories.map(c => [c.id, c]));
  const typeOf = x => carrierFor(x, byCat.get(x.category)).type;
  assert.deepEqual([...new Set(parsed.works.map(typeOf))].sort(), ['browser', 'page', 'phone', 'shard', 'window'], '五种载体都应出现');
  // 载体：日报固定 page；作品显式写了 carrier 就按它；其余走分类默认
  for (const x of parsed.works) {
    if (x.slug.startsWith('daily-')) assert.equal(typeOf(x), 'page', x.slug);
    else if (x.carrier) assert.equal(typeOf(x), x.carrier, x.slug);
  }
  // 站内允许频道、作品入口及带显式文件名的作品下载；下载文件必须真实存在。
  const links = parsed.works.flatMap(x => x.links).filter(l => l.href !== '#');
  const hrefs = links.map(l => l.href);
  const siteLocal = h => h === 'game/' || h === 'minsheng/' || /^works\/[a-z0-9-]+\/$/.test(h) || /^works\/simple-download\/\?platform=(?:windows|android)$/.test(h);
  const localDownload = l => l.kind === 'download' && l.download && /^works\/[a-z0-9-]+\/[A-Za-z0-9._-]+$/.test(l.href);
  assert.ok(links.every(l => siteLocal(l.href) || localDownload(l) || l.href.startsWith('https://')), '真实链接只能是站内入口、作品下载或 https：' + hrefs.join(','));
  for (const link of links.filter(localDownload)) assert.ok((await stat(rel(link.href))).size > 0, '下载文件必须存在：' + link.href);
  assert.ok(hrefs.includes('game/') && hrefs.includes('minsheng/'), '日报两条入口都在');
  for (const platform of ['windows', 'android']) {
    const work = parsed.works.find(x => x.slug === `simple-download-${platform}`);
    const entry = work.links.filter(link => link.href === `works/simple-download/?platform=${platform}`);
    assert.equal(entry.length, 1, `${platform} 详情必须有对应平台的原理入口`);
    assert.equal(entry[0].label, '工作原理');
    assert.equal(entry[0].kind, 'visit');
  }
  assert.ok((await stat(rel('works/simple-download/index.html'))).size > 0, '原理入口须有真实页面');
  // 图片：cover / shots 引用的文件必须真实存在，且在 assets/works 下
  for (const x of parsed.works) {
    const srcs = [x.cover && x.cover.kind === 'image' ? x.cover.src : null, ...x.shots.map(s => s.src)].filter(Boolean);
    for (const s of srcs) {
      assert.ok(s.startsWith('assets/works/'), `${x.slug} 的图片应放在 assets/works：${s}`);
      assert.ok((await stat(rel(s))).size > 0, `${x.slug} 的图片文件缺失：${s}`);
    }
  }
});

await check('safeHref 拒绝危险与后台链接', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'http://example.com/', '//evil.com/x', '/abs', '../x', 'a/../b', 'admin/messages/', './Admin/x', 'https://springhues.com/admin/messages/', 'https://u:p@example.com/', 'mailto:a@b.c', 'a b', 'a\\b', '', 'x'.repeat(301)]) {
    assert.equal(safeHref(bad), null, '应拒绝：' + bad);
  }
  for (const good of ['#', 'game/', 'minsheng/?date=2026-10-16', 'https://example.com/a', 'downloads/admin-tool.zip', './messages/']) {
    assert.notEqual(safeHref(good), null, '应允许：' + good);
  }
});

await check('works 字段规则：截断、丢弃、合成分类、source 成对', () => {
  const base = { schemaVersion: 1, categories: [{ id: 'a', name: 'x'.repeat(30), en: 'A', carrier: 'Bad Name', accent: { surface: 'nope', blade: ['tag', 'zzz', 'tag'] }, parallax: 9, order: 'x' }], works: [] };
  const w = (o = {}) => ({ slug: 'w-1', category: 'a', name: 'n', intro: 'i', links: [], ...o });
  const quiet = fn => { const o = console.warn; console.warn = () => {}; try { return fn(); } finally { console.warn = o; } };
  const r = quiet(() => parseWorks({ ...base, works: [w({ slug: 'dup' }), w({ slug: 'dup' }), w({ slug: 'Bad_Slug' }), w({ slug: 'ok', category: 'newcat' }), w({ slug: 'src', source: { type: 'daily-archive', manifest: 'data/index.json', base: 'minsheng/' } }), w({ slug: 'lnk', links: [{ kind: 'zip', label: 'L', href: 'javascript:1' }, { kind: 'zip', label: 'L', href: 'x/y' }] }), w({ slug: 'img', cover: { kind: 'image', src: 'assets/../x.png', alt: 'a', width: 1, height: 1 }, shots: [{ label: 's', ratio: 'bad' }] })] }));
  assert.deepEqual(r.works.map(x => x.slug), ['dup', 'ok', 'src', 'lnk', 'img']);
  const cat = r.categories.find(c => c.id === 'a');
  assert.equal(cat.name.length, 16); assert.equal(cat.carrier, 'shard'); assert.equal(cat.accent.surface, 'klein-500');
  assert.deepEqual(cat.accent.blade, ['tag']); assert.equal(cat.parallax, 1.6); assert.equal(cat.order, 1000);
  assert.ok(r.categories.find(c => c.id === 'newcat' && c.synthetic), '未登记分类应合成');
  assert.equal(r.works.find(x => x.slug === 'src').source, null, 'manifest 与 base 不成对应丢弃 source');
  const lnk = r.works.find(x => x.slug === 'lnk');
  assert.equal(lnk.links.length, 1); assert.equal(lnk.links[0].kind, 'visit');
  const img = r.works.find(x => x.slug === 'img');
  assert.equal(img.cover.kind, 'placeholder'); assert.equal(img.shots[0].ratio, '16/9');
  const plat = quiet(() => parseWorks({ ...base, works: [w({ slug: 'p1', platform: 'P'.repeat(30) }), w({ slug: 'p2', platform: '' }), w({ slug: 'p3', platform: 5 })] }));
  assert.equal(plat.works[0].platform.length, 16, 'platform 截断到 16');
  assert.equal(plat.works[1].platform, undefined); assert.equal(plat.works[2].platform, undefined);
  assert.throws(() => parseWorks({ schemaVersion: 2, categories: [], works: [] }), WorksDataError);
  assert.throws(() => parseWorks({ schemaVersion: 1, categories: {}, works: [] }), WorksDataError);
  assert.throws(() => parseWorks(null), WorksDataError);
});

await check('作品下载：中文文件名保留，非法文件名与非站内下载不改变链接行为', () => {
  const base = { schemaVersion: 1, categories: [{ id: 'web', name: '网页', en: 'WEB' }], works: [] };
  const rawLink = { kind: 'download', label: '下载', href: 'works/tutorial/tutorial.html.txt', download: '完整教程.html' };
  const parseLink = overrides => parseWorks({ ...base, works: [{ slug: 'tutorial', category: 'web', name: '教程', intro: '教程', links: [{ ...rawLink, ...overrides }] }] }).works[0].links[0];
  assert.equal(parseLink({}).download, '完整教程.html');
  for (const download of ['', '../教程.html', 'a\\b.html', 'a:b.html', 'a\n.html', 'a'.repeat(121), true, '教程.html ', '教程.']) {
    const link = parseLink({ download });
    assert.equal(link.download, undefined, String(download));
    assert.equal(link.href, rawLink.href, '无效文件名不丢弃合法链接');
  }
  for (const overrides of [{ kind: 'visit' }, { href: '#' }, { href: 'https://example.com/tutorial.html' }]) {
    assert.equal(parseLink(overrides).download, undefined);
  }
  const tutorial = parseWorks(worksJson).works.find(work => work.slug === 'ai-desktop-starter');
  assert.deepEqual(tutorial.links.find(link => link.kind === 'download'), {
    kind: 'download', label: '下载离线教程', href: 'works/ai-desktop-starter/AI-desktop-starter.html.txt', download: 'AI桌面入门-离线教程合集.html'
  });
});

await check('resolveCategory：旧别名、规范值与未知值', () => {
  const known = new Map(['software', 'web', 'game', 'daily'].map(id => [id, {}]));
  for (const [raw, want] of [['android', 'software'], ['windows', 'software'], ['mod', 'game'], ['web', 'web'], ['game', 'game'], ['daily', 'daily'], ['software', 'software'], ['all', 'all'], ['zzz', 'all'], ['', 'all'], [undefined, 'all'], [null, 'all'], ['constructor', 'all'], ['__proto__', 'all']]) {
    assert.equal(resolveCategory(raw, known), want, String(raw));
  }
  assert.equal(resolveCategory('android', new Map()), 'all', '目标分类不存在时回退 all');
  assert.equal(resolveCategory('web', new Set()), 'all');
  assert.equal(resolveCategory('android', new Set(['software'])), 'software', '也接受 Set');
  assert.deepEqual(Object.keys(LEGACY_CATEGORY_ALIASES).sort(), ['android', 'mod', 'windows']);
  assert.ok(Object.isFrozen(LEGACY_CATEGORY_ALIASES));
});

await check('computeTier', () => {
  const env = o => ({ reduced: false, finePointer: true, canHover: true, width: 1440, deviceMemory: undefined, ...o });
  assert.equal(computeTier(env({ deviceMemory: undefined })), 'full');
  assert.equal(computeTier(env({ reduced: true })), 'calm');
  assert.equal(computeTier(env({ width: 600 })), 'lite');
  assert.equal(computeTier(env({ finePointer: false, canHover: false, width: 820 })), 'lite', '平板');
  assert.equal(computeTier(env({ finePointer: true, canHover: true, width: 1280 })), 'full', '触屏笔记本主指针为触控板');
  assert.equal(computeTier(env({ deviceMemory: 2 })), 'lite');
  assert.equal(computeTier(env({ deviceMemory: 8 })), 'full');
  assert.equal(computeTier(env({ reduced: true, width: 300 })), 'calm');
});

await check('shouldDegrade', () => {
  assert.equal(shouldDegrade({ tier: 'lite', hardwareConcurrency: 16 }), true);
  assert.equal(shouldDegrade({ tier: 'calm', hardwareConcurrency: 16 }), true);
  assert.equal(shouldDegrade({ tier: 'full', hardwareConcurrency: undefined }), false);
  assert.equal(shouldDegrade({ tier: 'full', hardwareConcurrency: 2 }), true);
  assert.equal(shouldDegrade({ tier: 'full', hardwareConcurrency: 8 }), false);
});

await check('fitShape：整数、<=G、>=minCols；phone 在窄网格宽高比 >=0.4', () => {
  const carriers = ['phone', 'window', 'page', 'shard', 'browser'].map(getCarrier);
  for (const c of carriers) for (const size of ['s', 'm', 'l']) for (const G of [12, 8, 6]) {
    const [cc, rr] = c.shapes[size];
    const { cols, rows } = fitShape([cc, rr], G, c.minCols);
    assert.ok(Number.isInteger(cols) && Number.isInteger(rows), `${c.type}/${size}/${G}`);
    assert.ok(cols <= G && cols >= Math.min(c.minCols || 2, G) && rows >= 2, `${c.type}/${size}/${G} => ${cols}x${rows}`);
    if (G === 12) assert.deepEqual({ cols, rows }, { cols: cc, rows: rr }, '12 列恒等');
  }
  const phone = getCarrier('phone');
  for (const G of [8, 6]) {
    const { cols, rows } = fitShape(phone.shapes.m, G, phone.minCols);
    assert.ok(cols / rows >= 0.4, `phone ${G} 列 ${cols}/${rows}`);
  }
  assert.deepEqual(fitShape([3, 7], 6), { cols: 2, rows: 5 });
  assert.deepEqual(fitShape([4, 6], 6, 3), { cols: 3, rows: 5 });
  assert.deepEqual(fitShape([5, 4], 6), { cols: 3, rows: 2 });
  assert.deepEqual(fitShape([3, 7], 8), { cols: 2, rows: 5 });
});

await check('layout：哈希稳定且范围正确', () => {
  assert.equal(hashSlug('abc'), hashSlug('abc'));
  assert.notEqual(hashSlug('abc'), hashSlug('abd'));
  for (const w of worksJson.works) {
    const j = jitterFor(w.slug);
    assert.ok(Math.abs(j.tilt) <= 2.5 && Math.abs(j.dx) <= 14 && Math.abs(j.dy) <= 14);
    assert.ok(['s', 'm', 'l'].includes(sizeFor(w)));
  }
  assert.equal(sizeFor({ slug: 'x', layout: { size: 'l' } }), 'l');
});

await check('legacyRoute / parseHash', () => {
  assert.deepEqual(legacyRoute('?view=journal'), { scroll: 'works', cat: 'daily', work: null });
  assert.deepEqual(legacyRoute('?view=about'), { scroll: 'about', cat: null, work: null });
  assert.deepEqual(legacyRoute('?view=saved'), { scroll: 'works', cat: 'all', work: null });
  assert.deepEqual(legacyRoute('?view=library'), { scroll: 'works', cat: 'all', work: null });
  assert.deepEqual(legacyRoute('?work=android-sample-note'), { scroll: null, cat: null, work: 'android-sample-note' });
  assert.deepEqual(legacyRoute('?work=Bad Slug'), { scroll: null, cat: null, work: null });
  assert.deepEqual(legacyRoute('?q=abc'), { scroll: null, cat: null, work: null });
  assert.equal(legacyRoute(''), null);
  assert.equal(legacyRoute('?utm=1'), null);
  assert.deepEqual(parseHash('#work=daily-game'), { work: 'daily-game', cat: null, raw: '#work=daily-game' });
  assert.equal(parseHash('#cat=daily').cat, 'daily');
  assert.equal(parseHash('#work=../x').work, null);
});

await check('fuzzy 匹配与排序', () => {
  const items = [{ title: '示例·某某便签', hint: '安卓软件' }, { title: '游戏日报', hint: 'game/', keywords: ['daily'] }, { title: '民生日报', hint: 'minsheng/' }];
  assert.equal(fuzzyFilter(items, '日报')[0].title, '游戏日报');
  assert.equal(fuzzyFilter(items, '日报').length, 2);
  assert.equal(fuzzyFilter(items, 'zzz').length, 0);
  assert.equal(fuzzyFilter(items, '').length, 3);
  assert.equal(fuzzyFilter(items, 'daily')[0].title, '游戏日报');
  assert.ok(fuzzyFilter(Array.from({ length: 30 }, (_, i) => ({ title: 'a' + i })), 'a').length <= 12);
});

await check('occluder 几何', () => {
  const { OCCLUDERS, TITLE_BAND, SAFE, CROP, toCrop } = occ;
  for (const [name, poly] of Object.entries(OCCLUDERS)) {
    assert.ok(occ.bandOverlap(poly) > 0, `${name} 必须与标题带有正面积交集`);
    const b = occ.bbox(poly);
    assert.ok(b.x0 >= SAFE.x[0] && b.x1 <= SAFE.x[1], `${name} x 越界`);
    for (const p of poly) { const [x, y] = toCrop(p); assert.ok(x >= 0 && x <= 1 && y >= 0 && y <= 1, `${name} 裁切换算越界`); }
  }
  assert.deepEqual(TITLE_BAND, [0.29, 0.51]);
  assert.equal(CROP.x + CROP.w, 0.68);
});

await check('classifyFamilies 锚点颜色', () => {
  const px = (r, g, b) => [r, g, b, 255];
  const buf = Uint8Array.from([...px(5, 55, 180), ...px(244, 246, 255), ...px(144, 7, 42), ...px(8, 6, 10), ...px(13, 24, 80), 0, 0, 0, 0]);
  const { counts, total } = classifyFamilies(buf);
  assert.equal(total, 5, '透明像素不计');
  assert.deepEqual(counts, { blue: 2, white: 1, red: 1, ink: 1 });
});

await check('archive：publishAt 过滤、一轮只请求一次、链接改写、失败不抛', async () => {
  const api = { publishedEditions: (m, now) => m.editions.filter(e => Date.parse(e.publishAt) <= now).sort((a, b) => b.date.localeCompare(a.date)) };
  const manifests = {
    'data/index.json': { editions: [{ date: '2026-10-16', publishAt: '2026-10-16T11:00:00+08:00' }, { date: '2026-10-15', publishAt: '2026-10-15T11:00:00+08:00' }] },
    'data/minsheng/index.json': { editions: [{ date: '2026-10-17', publishAt: '2026-10-17T11:00:00+08:00' }] }
  };
  const calls = [];
  const fetchImpl = async url => { calls.push(url); return { ok: true, json: async () => manifests[url] }; };
  const links = [{ k: 'game', href: 'game/' }, { k: 'minsheng', href: 'minsheng/' }].map(l => ({ ...l, setAttribute(n, v) { this.href = v; } }));
  const root = { querySelectorAll: sel => links.filter(l => sel.includes(`"${l.k}"`)) };
  const archive = createArchive({ fetchImpl, now: () => Date.parse('2026-10-17T10:59:59+08:00'), data: api });
  const r = await archive.applyLinks(root);
  await archive.readManifest('data/index.json');
  assert.equal(calls.length, 2, '同一 manifest 一轮只请求一次');
  assert.equal(links[0].href, 'game/?date=2026-10-16');
  assert.equal(links[1].href, 'minsheng/', '未到 publishAt 的期次不得写入');
  assert.equal(r.minsheng.latest, null);
  assert.equal(await archive.totalEditions(), 2);
  assert.equal(editionHref('game/', { date: '2026-10-16' }), 'game/?date=2026-10-16');
  const bad = createArchive({ fetchImpl: async () => { throw new Error('boom'); }, data: api });
  const w = console.warn; console.warn = () => {};
  try {
    assert.equal((await bad.readManifest('x')).ok, false);
    assert.equal(await bad.totalEditions(), null, '任一失败时总数为 null');
    const missing = createArchive({ fetchImpl, data: null });
    const saved = globalThis.SpringhuesPortalData; delete globalThis.SpringhuesPortalData;
    assert.equal((await missing.readManifest('data/index.json')).ok, false, 'SpringhuesPortalData 缺失按读取失败处理');
    if (saved) globalThis.SpringhuesPortalData = saved;
  } finally { console.warn = w; }
});

await check('载体结构（假 h）：.card-hit 无嵌套交互元素', async () => {
  const h = (tag, attrs, ...children) => ({ tag, attrs: attrs || {}, children: children.flat(Infinity).filter(c => c != null && c !== false) });
  const find = (n, fn, out = []) => { if (n && typeof n === 'object') { if (fn(n)) out.push(n); n.children.forEach(c => find(c, fn, out)); } return out; };
  const cls = (n, c) => (n.attrs.class || '').split(/\s+/).includes(c);
  const parsed = parseWorks(worksJson);
  const byId = new Map(parsed.categories.map(c => [c.id, c]));
  const seen = new Set();
  for (const work of parsed.works) {
    const category = byId.get(work.category);
    const carrier = getCarrier(work.carrier || category.carrier);
    seen.add(carrier.type);
    const { root, face, hit } = carrier.create(work, category, { h, index: 1 });
    assert.equal(hit.tag, 'a'); assert.ok(cls(hit, 'card-hit')); assert.equal(hit.children.length, 0, '.card-hit 不得有后代');
    assert.equal(root.tag, 'li'); assert.equal(face.tag, 'article');
    const interactive = find(root, n => n.tag === 'a' || n.tag === 'button');
    for (const n of interactive) {
      const ok = n === hit || (cls(n, 'card-link') && face.children.includes(n));
      assert.ok(ok, `${work.slug} 出现非法交互元素 ${n.tag}.${n.attrs.class}`);
    }
    assert.equal(find(root, n => n.tag === 'button').length, 0);
    if (carrier.type === 'window') {
      const btns = find(root, n => cls(n, 'win-btns'))[0];
      assert.ok(btns.children.every(c => c.tag === 'span'));
      assert.equal(find(root, n => cls(n, 'win-bar'))[0].attrs['aria-hidden'], 'true');
    }
    if (carrier.type === 'page') assert.equal(find(root, n => cls(n, 'card-link')).length, 2, '日报卡两个 .card-link');
  }
  assert.deepEqual([...seen].sort(), ['browser', 'page', 'phone', 'shard', 'window']);
  const stub = { type: 'cartridge', shapes: { s: [3, 3], m: [3, 3], l: [3, 3] }, create() {} };
  assert.equal(getCarrier('cartridge').type, 'shard', '未注册时回退 shard');
  registerCarrier('cartridge', stub);
  assert.equal(getCarrier('cartridge'), stub);
  registerCarrier('cartridge', getCarrier('shard')); // 还原，避免影响后续
});

await check('静态检查：模块说明符、load 助手、CDN、admin、border-radius', async () => {
  const jsFiles = await walk(rel('site/js'), '.js');
  assert.ok(jsFiles.length > 20);
  for (const f of jsFiles) {
    const src = await readFile(f, 'utf8');
    const specs = [...src.matchAll(/\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g), ...src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]);
    for (const s of specs) assert.ok(/^\.{1,2}\//.test(s) && s.endsWith('.js') && !/[?#]/.test(s), `${path.relative(root, f)} 导入说明符不合规：${s}`);
    assert.ok(!/\bload\(/.test(src), `${path.relative(root, f)} 不得出现 readManifest( 助手`);
    assert.ok(/\bexport\b|\bimport\b/.test(src), `${path.relative(root, f)} 必须是纯 ESM`);
    assert.ok(!/(href|src)\s*[:=]\s*['"`](?:\.\/)?admin\//.test(src), `${path.relative(root, f)} 不得链接后台`);
  }
  const cdn = /unpkg|jsdelivr|cdnjs|googleapis|gstatic|@import\s+url\(\s*['"]?http/i;
  const files = [rel('index.html'), rel('site/boot.js'), ...jsFiles, ...await walk(rel('site/css'), '.css'), rel('site/works.json')];
  for (const f of files) {
    const src = await readFile(f, 'utf8');
    assert.ok(!cdn.test(src), `${path.relative(root, f)} 含 CDN 引用`);
    if (!f.endsWith('.js')) assert.ok(!/href=["'](?:\.\/)?admin\//.test(src) && !/"href"\s*:\s*"(?:\.\/)?admin\//.test(src), `${path.relative(root, f)} 含后台链接`);
  }
  // 圆角：委托 check-shard-style 的同一实现（白名单只有 .sd-dot / .sd-avatar 且值为 50%，其余一律为 0）
  for (const f of await walk(rel('site/css'), '.css')) {
    const r = scanCss(await readFile(f, 'utf8'), path.relative(root, f));
    assert.deepEqual(r.errors.filter(e => e.includes('圆角')), [], '出现圆角');
  }
  const html = await readFile(rel('index.html'), 'utf8');
  assert.ok(html.includes('site/js/main.js?v=') && html.includes('portal-data.js?v=20261017-shard-v1'));
  assert.ok(!html.includes('character-hero') && !html.includes('data-message-form'));
});

await check('首屏：无指针驱动的涟漪/扭曲，时间流动与昼夜仍在（第二轮 C）', async () => {
  const { FRAG } = await imp('site/js/hero/shaders.js');
  for (const bad of ['uMouse', 'uVel', 'wave', 'uAspect']) assert.ok(!FRAG.includes(bad), `FRAG 不应含 ${bad}`);
  for (const good of ['uTime', 'uDay', 'uMask']) assert.ok(FRAG.includes(good), `FRAG 应含 ${good}`);
  const gl = await readFile(rel('site/js/hero/webgl.js'), 'utf8');
  assert.ok(!/uMouse|uVel|mouse/i.test(gl), 'webgl.js 不应含鼠标相关代码');
  assert.ok(/render\(t, dt\)\s*\{/.test(gl), 'render 应只接收 (t, dt)');
  const hero = await readFile(rel('site/js/hero/hero.js'), 'utf8');
  const idx = [...hero.matchAll(/pointermove/g)].map(m => m.index);
  assert.equal(idx.length, 1, 'hero.js 的 pointermove 应只在 degrade() 内出现一次');
  assert.ok(idx[0] > hero.indexOf('function degrade') && idx[0] < hero.indexOf('function resizeGL'), 'pointermove 应位于 degrade 与 resizeGL 之间');
  assert.ok(!/state\.(mx|my|tx|ty|vel)\b/.test(hero), 'hero.js 不应再有指针状态');
});

await check('tween/flip 纯函数', async () => {
  const { EASES, ease, easeFrames, lerpFrames } = await imp('site/js/core/tween.js');
  const { flipDelta, rectOf, canAnimateRects, playRectMorph } = await imp('site/js/core/flip.js');
  const N = 2000;
  for (const name of Object.keys(EASES)) {
    const fn = ease(name);
    assert.ok(Math.abs(fn(0)) < 1e-12 && Math.abs(fn(1) - 1) < 1e-12, `${name} 端点 0 / 1`);
    let prev = -1;
    for (let i = 0; i <= N; i++) { const v = fn(i / N); assert.ok(v >= prev - 1e-12, `${name} 单调`); prev = v; }
  }
  const io = EASES.power3InOut;
  assert.ok(Math.abs(io(0.5) - 0.5) < 1e-12);
  for (let i = 0; i <= 50; i++) assert.ok(Math.abs(io(i / 100) + io(1 - i / 100) - 1) < 1e-12, '关于 (.5,.5) 点对称');
  let peak = 0;
  for (let i = 1; i <= N; i++) peak = Math.max(peak, (io(i / N) - io((i - 1) / N)) * N);
  assert.ok(peak >= 3.9 && peak <= 4.0, `power3InOut 最大斜率应 ∈ [3.9, 4.0]：${peak}`);
  assert.equal(EASES.power1Out(0.5), 0.75);
  assert.equal(EASES.power3Out(0.5), 1 - 0.0625);
  assert.throws(() => ease('nope'), /未知缓动/);
  assert.equal(ease(EASES.linear), EASES.linear);
  const fr = easeFrames('power3InOut', 10, 30, 48);
  assert.equal(fr.length, 49);
  assert.deepEqual([fr[0].offset, fr[0].value, fr[48].offset, fr[48].value], [0, 10, 1, 30]);
  assert.equal(easeFrames('linear', 0, 1).length, 49, '默认 n = 48');
  const lf = lerpFrames('power1Out', { opacity: [0, 1], scale: [0.8, 1] }, 10);
  assert.equal(lf.length, 11);
  assert.deepEqual([lf[0].opacity, lf[0].scale, lf[10].opacity, lf[10].scale], [0, 0.8, 1, 1]);
  // 与主 morph 的验收常量同源：PEAK_SLOPE 必须不小于缓动的数值最大斜率
  const { PEAK_SLOPE, MORPH_MS, MORPH_EASE } = await imp('site/js/wall/morph.js');
  assert.equal(PEAK_SLOPE, 4); assert.equal(MORPH_MS, 700); assert.equal(MORPH_EASE, 'power3InOut');
  assert.ok(peak <= PEAK_SLOPE);
  // flipDelta：中心对齐
  assert.deepEqual(flipDelta({ left: 100, top: 50, width: 200, height: 100 }, { left: 0, top: 0, width: 100, height: 50 }), { dx: 150, dy: 75, sx: 2, sy: 2 });
  assert.deepEqual(flipDelta({ left: 10, top: 10, width: 40, height: 40 }, { left: 10, top: 10, width: 40, height: 40 }), { dx: 0, dy: 0, sx: 1, sy: 1 });
  const z = flipDelta({ left: 0, top: 0, width: 0, height: 0 }, { left: 10, top: 20, width: 30, height: 40 });
  assert.deepEqual([z.sx, z.sy], [1, 1], '宽高为 0 时缩放取 1');
  const z2 = flipDelta({ left: 0, top: 0, width: 30, height: 40 }, { left: 0, top: 0, width: 0, height: 0 });
  assert.deepEqual([z2.sx, z2.sy], [1, 1]);
  // 无 DOM 环境：特性检测为 false，播放原语安全返回
  assert.equal(canAnimateRects(), false);
  const noop = playRectMorph(null, { left: 0, top: 0, width: 1, height: 1 }, { left: 5, top: 5, width: 1, height: 1 }, { duration: 100 });
  await noop.finished; noop.cancel();
  let animated = 0;
  const fake = { style: { transformOrigin: '' }, animate() { animated += 1; return { finished: Promise.resolve(), cancel() {} }; }, getBoundingClientRect() { return { left: 1, top: 2, width: 3, height: 4 }; } };
  assert.deepEqual(rectOf(fake), { left: 1, top: 2, width: 3, height: 4 });
  await playRectMorph(fake, { left: 0, top: 0, width: 10, height: 10 }, { left: 0, top: 0, width: 10, height: 10 }, { duration: 100, scale: true }).finished;
  assert.equal(animated, 0, '起终点相同不创建动画');
  await playRectMorph(fake, { left: 0, top: 0, width: 10, height: 10 }, { left: 20, top: 0, width: 20, height: 20 }, { duration: 100, scale: true }).finished;
  assert.equal(animated, 2, '位移 + 缩放各一条动画');
  assert.equal(fake.style.transformOrigin, '', '结束后还原 transformOrigin');
});

await check('视差数学', async () => {
  const { progressFor, yFor, initParallax } = await imp('site/js/wall/parallax.js');
  const { onScroll } = await imp('site/js/core/scroll.js');
  assert.equal(typeof initParallax, 'function'); assert.equal(typeof onScroll, 'function');
  const vh = 800, top = 1000, h = 300;
  assert.equal(progressFor(top - vh, vh, top, h), 0, '顶边碰到视口底边');
  assert.equal(progressFor(top + h, vh, top, h), 1, '底边离开视口顶边');
  assert.equal(progressFor(top - vh + (vh + h) / 2, vh, top, h), 0.5);
  assert.equal(progressFor(-500, vh, top, h), 0); assert.equal(progressFor(99999, vh, top, h), 1);
  for (const p of [0.5, 1, 1.4]) {
    assert.equal(yFor(0, p), 46 * p); assert.equal(yFor(1, p), -46 * p); assert.equal(yFor(0.5, p), 0);
  }
  // 订阅 / 去重（Node 无 window：onScroll 只登记订阅，不绑定原生事件）
  const off = onScroll(() => {}); assert.equal(typeof off, 'function'); off();
});

await check('去除第三方动画库：全仓零字样、vendor 目录与 core 模块', async () => {
  // 正则用拼接构造，避免本文件自己命中
  const banned = new RegExp(['gs' + 'ap', 'GS' + 'AP', 'Scroll' + 'Trigger', '\\bFl' + 'ip\\b'].join('|'));
  const targets = ['site', 'scripts', 'vendor', 'index.html', 'THIRD-PARTY-NOTICES.txt', 'docs', 'AGENTS.md', 'privacy', 'game', 'minsheng', 'messages'];
  const textExt = /\.(?:js|mjs|css|html|json|txt|md)$/;
  const files = [];
  for (const t of targets) {
    const full = rel(t);
    let st;
    try { st = await stat(full); } catch { continue; }
    if (st.isDirectory()) { for (const ext of ['.js', '.mjs', '.css', '.html', '.json', '.txt', '.md']) files.push(...await walk(full, ext)); }
    else if (textExt.test(full)) files.push(full);
  }
  assert.ok(files.length > 40);
  for (const f of files) {
    const m = banned.exec(await readFile(f, 'utf8'));
    assert.equal(m, null, `${path.relative(root, f)} 含已移除的动画库字样：${m && m[0]}`);
  }
  await assert.rejects(stat(rel('vendor', 'gs' + 'ap')), 'vendor 下不得再有该库目录');
  await stat(rel('vendor/lenis/lenis.min.js'));
  for (const f of ['site/js/core/tween.js', 'site/js/core/flip.js', 'site/js/wall/parallax.js']) await stat(rel(f));
  const vendorSrc = await readFile(rel('site/js/core/vendor.js'), 'utf8');
  assert.ok(!/loadGs/i.test(vendorSrc) && /export function loadLenis/.test(vendorSrc));
  const appMod = await imp('site/js/core/app.js');
  assert.ok(!('gs' + 'ap' in appMod.app), 'app 不再有该库的可用标记');
  assert.ok('parallax' in appMod.app, 'app.parallax 显式声明');
});

await check('parseAnchor：只认 #works / #about / #top', () => {
  assert.equal(parseAnchor('#works'), 'works'); assert.equal(parseAnchor('#about'), 'about'); assert.equal(parseAnchor('#top'), 'top');
  for (const bad of ['', '#', '#cat=daily', '#work=x', '#Works', '#works2', '#admin', undefined, null]) assert.equal(parseAnchor(bad), null, String(bad));
  assert.deepEqual(parseHash('#works'), { work: null, cat: null, raw: '#works' }, 'parseHash 返回形状不变');
});

await check('page-transition：shouldIntercept 真值表、wipe 新旧导出并存', async () => {
  const { shouldIntercept } = await imp('site/js/core/page-transition.js');
  const wipe = await imp('site/js/core/wipe.js');
  for (const n of ['wipe', 'forceCalmWipe', 'wipeCover', 'wipeReveal', 'wipeReset']) assert.equal(typeof wipe[n], 'function', n);
  const loc = { href: 'https://springhues.com/game/', origin: 'https://springhues.com', pathname: '/game/' };
  const L = o => ({ href: 'https://springhues.com/messages/', button: 0, ...o });
  assert.equal(shouldIntercept(L(), loc), true, '同源不同路径');
  assert.equal(shouldIntercept(L({ href: 'https://springhues.com/#works' }), loc), true, '子页 → 首页锚点');
  assert.equal(shouldIntercept(L({ href: '/messages/' }), loc), true, '相对地址按 loc 解析');
  for (const [name, o] of [['ctrl', { ctrlKey: true }], ['meta', { metaKey: true }], ['shift', { shiftKey: true }], ['alt', { altKey: true }], ['中键', { button: 1 }], ['右键', { button: 2 }],
    ['target=_blank', { target: '_blank' }], ['download', { download: true }], ['rel=external', { rel: 'external noopener' }], ['data-no-transition', { noTransition: true }],
    ['已 preventDefault', { defaultPrevented: true }], ['跨源', { href: 'https://example.com/x' }], ['同路径仅 hash', { href: 'https://springhues.com/game/#a' }],
    ['同路径仅查询串', { href: 'https://springhues.com/game/?date=2026-10-01' }], ['mailto', { href: 'mailto:a@b.c' }], ['javascript', { href: 'javascript:void(0)' }], ['坏地址', { href: 'http://[' }]]) {
    assert.equal(shouldIntercept(L(o), loc), false, name);
  }
  assert.equal(shouldIntercept(L({ target: '_self' }), loc), true, 'target=_self 允许');
  assert.equal(shouldIntercept(L(), loc, { tier: 'calm' }), false, 'calm 档不拦截');
  assert.equal(shouldIntercept(L(), loc, { tier: 'lite' }), true);
  assert.equal(shouldIntercept(null, loc), false);
});

await check('shell 链接表：无 admin，页脚五个目标，菜单含首页锚点；shell 不依赖首页专属模块', async () => {
  const { PRIMARY, PAGES, FOOTER, pageInfo } = await imp('site/js/shell/links.js');
  const all = JSON.stringify([PRIMARY, PAGES, FOOTER]);
  assert.ok(!/admin/i.test(all), '链接表不得含 admin');
  assert.deepEqual(FOOTER.map(l => l.cn), ['返回首页', '游戏日报', '民生日报', '留言簿', '隐私说明']);
  assert.deepEqual(FOOTER.map(l => l.href), ['./', 'game/', 'minsheng/', 'messages/', 'privacy/']);
  assert.deepEqual(PRIMARY.map(l => l.href), ['./#works', './#cat=daily', './#about']);
  assert.equal(pageInfo('messages').cn, '留言簿'); assert.equal(pageInfo('nope'), null);
  const shellSrc = await readFile(rel('site/js/shell/shell.js'), 'utf8');
  assert.ok(!/from\s+['"]\.\.\/(?:hero|wall|loader|ui|carriers|data)\//.test(shellSrc), 'shell.js 不得 import 首页专属模块');
  assert.ok(!/(?:href|src)\s*[:=]\s*['"`](?:\.\/)?admin\//.test(shellSrc));
  assert.ok(/classList\.contains\('shard-live'\)/.test(shellSrc), 'shell.js 须以 shard-live 门控');
  // 导出器守卫：html 没有 shard-live 时，导入 shell.js 不创建任何节点、不注册任何监听
  const saved = globalThis.document;
  const touched = [];
  globalThis.document = {
    readyState: 'complete', documentElement: { classList: { contains: () => false } },
    createElement() { touched.push('createElement'); return {}; }, createElementNS() { touched.push('createElementNS'); return {}; },
    addEventListener() { touched.push('addEventListener'); }, querySelector() { touched.push('querySelector'); return null; }, get body() { touched.push('body'); return null; }
  };
  try { await import(pathToFileURL(rel('site/js/shell/shell.js')).href + '?guard'); } finally { globalThis.document = saved; if (saved === undefined) delete globalThis.document; }
  assert.deepEqual(touched, [], '导出运行时 shell.js 必须零副作用：' + touched.join(','));
});

await check('boot.js：Date 被冻结（日报导出器）时不启用外壳；正常运行时设置主题与 shard-live', async () => {
  const vm = await import('node:vm');
  const src = await readFile(rel('site/boot.js'), 'utf8');
  const run = ({ dateClass, stored, dark, reduced = false, referrer = '' }) => {
    const classes = new Set(), attrs = {};
    const ctx = {
      Date: dateClass, performance: { getEntriesByType: () => [{ type: 'navigate' }] }, location: { origin: 'https://springhues.com' },
      localStorage: { getItem: () => stored }, URL,
      matchMedia: q => ({ matches: q.includes('reduced-motion') ? reduced : dark }),
      document: { referrer, documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, classList: { add: (...c) => c.forEach(x => classes.add(x)) } }, querySelector: () => null }
    };
    ctx.globalThis = ctx;
    vm.runInNewContext(src, ctx);
    return { classes: [...classes].sort(), attrs };
  };
  class FixedDate extends Date {}
  const frozen = run({ dateClass: FixedDate, stored: null, dark: true });
  assert.deepEqual(frozen, { classes: [], attrs: {} }, '冻结 Date 时必须完全不动');
  assert.deepEqual(run({ dateClass: Date, stored: null, dark: true }), { classes: ['sd-reveal', 'shard-live'], attrs: { 'data-theme': 'night' } }, '默认跟随系统');
  assert.equal(run({ dateClass: Date, stored: 'day', dark: true }).attrs['data-theme'], 'day', '手动选择优先');
  assert.equal(run({ dateClass: Date, stored: 'bad', dark: false }).attrs['data-theme'], 'day');
  assert.ok(!run({ dateClass: Date, stored: null, dark: false, reduced: true }).classes.includes('sd-reveal'), 'reduced-motion 不隐藏 reveal 元素');
  assert.ok(run({ dateClass: Date, stored: null, dark: false, referrer: 'https://springhues.com/' }).classes.includes('shard-arrive'), '站内到达');
  assert.ok(!run({ dateClass: Date, stored: null, dark: false, referrer: 'https://example.com/' }).classes.includes('shard-arrive'), '外站来源不擦屏');
  assert.ok(!run({ dateClass: Date, stored: null, dark: false, referrer: 'https://springhues.com/', reduced: true }).classes.includes('shard-arrive'), 'reduced-motion 不擦屏');
  const forced = (() => { const classes = new Set(); const ctx = { Date: FixedDate, URL, performance: { getEntriesByType: () => [] }, location: { origin: 'x' }, localStorage: { getItem: () => null }, matchMedia: () => ({ matches: false }), document: { referrer: '', documentElement: { setAttribute() {}, classList: { add: c => classes.add(c) } }, querySelector: () => null } }; ctx.globalThis = ctx; ctx.__SHARD_FORCE__ = true; vm.runInNewContext(src, ctx); return classes; })();
  assert.ok(forced.has('shard-live'), '__SHARD_FORCE__ 仅供本地验收，强制启用');
});

await check('check-shard-style：自测、仓库零错误、SHARD_VERSION 全站一致', async () => {
  assert.equal(shardStyle.selfTest(), true);
  const r = await shardStyle.checkShardStyle({ root });
  assert.deepEqual(r.errors, [], r.errors.join('\n'));
  const home = await readFile(rel('index.html'), 'utf8');
  const stamps = [...home.matchAll(/site\/(?:css|js)\/[\w./-]+\?v=([\w-]+)/g)].map(m => m[1]);
  assert.ok(stamps.length >= 12 && stamps.every(v => v === SHARD_VERSION), '首页 site/ 引用戳应全部等于 SHARD_VERSION：' + [...new Set(stamps)]);
  assert.ok(home.includes('site/css/wipe.css?v=' + SHARD_VERSION));
  // 跨文档 View Transition：整站不使用。brand.css（被导出消费，不可改）声明了 navigation:auto，必须由 pages-daily.css 覆盖为 none；
  // 首页与 site/css 里任何文件都不得再声明 navigation:auto，否则日报页 / 子页面 / 首页互跳会抛 "ViewTransition opt-in disabled"。
  assert.ok(!/@view-transition/.test(home), '首页不应声明 @view-transition');
  for (const f of await walk(rel('site/css'), '.css')) {
    const css = (await readFile(f, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    if (f.endsWith('pages-daily.css')) assert.ok(/@view-transition\s*\{\s*navigation:\s*none/.test(css), 'pages-daily.css 应用 navigation:none 覆盖 brand.css 的跨文档过渡声明');
    else assert.ok(!/@view-transition/.test(css), f + ' 不应声明 @view-transition');
  }
  for (const f of ['game/index.html', 'minsheng/index.html']) { const h = await readFile(rel(f), 'utf8'); assert.ok(h.indexOf('brand.css') < h.indexOf('pages-daily.css'), f + ' 应先加载 brand.css 再加载 pages-daily.css'); }
  for (const f of ['game/index.html', 'minsheng/index.html', 'messages/index.html', 'privacy/index.html']) {
    const html = await readFile(rel(f), 'utf8');
    for (const part of ['site/boot.js?v=', 'site/css/shard-theme.css?v=', 'site/css/wipe.css?v=', 'site/js/shell/shell.js?v=']) assert.ok(html.includes(part + SHARD_VERSION), `${f} 缺少 ${part}${SHARD_VERSION}`);
  }
});
await check('docs/shard-style.md 与 shard-theme.css / tokens.css 一致；提示词纯文本与文档开头同文', async () => {
  const md = (await readFile(rel('docs/shard-style.md'), 'utf8')).replace(/\r\n/g, '\n');
  const txt = (await readFile(rel('docs/shard-style-prompt.txt'), 'utf8')).replace(/\r\n/g, '\n');
  const block = /```text\n([\s\S]*?)```/.exec(md);
  assert.ok(block, '文档开头应有“一键配置提示词”代码块');
  assert.equal(block[1].trim(), txt.trim(), 'docs/shard-style-prompt.txt 必须与文档里的提示词一致');
  for (const must of ['check-shard-style.mjs', 'shard-theme.css', 'docs/shard-style.md']) assert.ok(txt.includes(must), '提示词应提到 ' + must);
  const theme = await readFile(rel('site/css/shard-theme.css'), 'utf8');
  const tokens = await readFile(rel('site/css/tokens.css'), 'utf8');
  // 文档里的 .sd-* 类都存在于 shard-theme.css
  const classes = [...new Set([...md.matchAll(/\.(sd-[a-z0-9][a-z0-9-]*)/g)].map(m => m[1]).filter(n => !n.endsWith('-')))];
  assert.ok(classes.length > 20, '文档应覆盖全部组件类：' + classes.length);
  for (const n of classes) assert.ok(theme.includes('.' + n), `文档提到的 .${n} 在 shard-theme.css 里不存在`);
  // 文档里的 --sh-* / --sd-* 变量都有定义；调色板表的值与 tokens.css 逐项相同
  for (const v of new Set([...md.matchAll(/`(--(?:sh|sd)-[a-z0-9-]+)`/g)].map(m => m[1]))) assert.ok(new RegExp(v + '\\s*:').test(theme), `文档提到的 ${v} 未在 shard-theme.css 定义`);
  for (const m of md.matchAll(/^\| `(--sh-[a-z0-9-]+)` \| `(#[0-9A-Fa-f]{6})`/gm)) {
    assert.ok(new RegExp(m[1] + '\\s*:\\s*' + m[2] + '\\s*;', 'i').test(tokens), `${m[1]} 的文档值 ${m[2]} 与 tokens.css 不一致`);
  }
  for (const m of md.matchAll(/^\| `(--(?:bg|fg|surface|on-surface|blade|focus-ring|edge|muted))` \| `([^`]+)` \| `([^`]+)` \|$/gm)) {
    const day = new RegExp('data-theme="day"\\]\\s*\\{[^}]*' + m[1] + '\\s*:\\s*([^;]+);').exec(tokens)[1].trim();
    const night = new RegExp('data-theme="night"\\]\\s*\\{[^}]*' + m[1] + '\\s*:\\s*([^;]+);').exec(tokens)[1].trim();
    assert.deepEqual([m[2], m[3]], [day, night], `${m[1]} 的日 / 夜取值应与 tokens.css 一致`);
  }
  assert.ok(!/(?:gs|GS)ap|Scroll(?:Trigger)|\bFl(?:ip)\b/.test(md), '文档不得出现已移除的动画库字样');
});
console.log(`首页(SHARD)单测通过：${checks} 组`);
