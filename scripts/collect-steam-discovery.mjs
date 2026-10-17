import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

export const SOURCE_URL = 'https://store.steampowered.com/search/?specials=1&cc=cn&l=schinese';
export const sha256 = data => createHash('sha256').update(data).digest('hex');

export function assertWindow(date, now = new Date()) {
  const local = new Date(now.getTime() + 8 * 3600000).toISOString();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date !== local.slice(0, 10)) throw new Error('DATE_NOT_TODAY: discovery must use actual Beijing date');
  if (local.slice(11, 19) >= '08:00:00') throw new Error('FREEZE_WINDOW_CLOSED: discovery must finish before 08:00 Beijing');
}

export function assertSource(url, method = 'GET') {
  const u = new URL(url);
  if (!['GET', 'HEAD'].includes(method) || u.protocol !== 'https:' || u.hostname !== 'store.steampowered.com' || u.port || u.username || u.password || u.pathname !== '/search/') throw new Error('SOURCE_REJECTED: only official default search discovery GET/HEAD allowed');
  const entries = [...u.searchParams.entries()].sort();
  const expected = [['cc', 'cn'], ['l', 'schinese'], ['specials', '1']];
  if (JSON.stringify(entries) !== JSON.stringify(expected)) throw new Error('SOURCE_REJECTED: region, language, default ordering and first page must be unchanged');
}

export async function loadPlaywright() {
  const root = path.join(os.homedir(), '.cache', 'codex-runtimes');
  for (const name of await fs.readdir(root)) {
    const anchor = path.join(root, name, 'dependencies', 'node', 'package.json');
    try { return createRequire(anchor)('playwright'); } catch { /* Try next bundled runtime. */ }
  }
  throw new Error('PLAYWRIGHT_MISSING: no bundled runtime Playwright found');
}

// Runs in an empty browser page. Parse the saved response, never mutable live DOM.
export function parseDocument(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const container = doc.querySelector('#search_resultsRows');
  if (!container) throw new Error('CARDS_MISSING: no first-page results container');
  const rows = [...container.querySelectorAll('a.search_result_row')];
  if (!rows.length) throw new Error('CARDS_MISSING: empty first-page results');
  const text = (row, selector) => row.querySelector(selector)?.textContent?.trim() || null;
  const cards = rows.map((row, index) => {
    const url = new URL(row.getAttribute('href'));
    if (url.protocol !== 'https:' || url.hostname !== 'store.steampowered.com') throw new Error('CARD_DOMAIN_REJECTED');
    const ids = (row.getAttribute('data-ds-appid') || '').split(',').filter(Boolean);
    if (!ids.length || ids.some(id => !/^\d+$/.test(id))) throw new Error('CARD_APPID_MISSING');
    const price = text(row, '.discount_final_price') || text(row, '.search_price');
    if (!price || !/[¥￥]/.test(price)) throw new Error('CARD_CNY_PRICE_MISSING');
    return { index, appIds: ids, title: text(row, '.title'), url: url.href, originalPrice: text(row, '.discount_original_price'), currentPrice: price, discount: text(row, '.discount_pct') || text(row, '.search_discount'), priceFinalMinor: row.getAttribute('data-price-final') };
  });
  if (cards.some(card => !card.title)) throw new Error('CARD_TITLE_MISSING');
  return { cardCount: cards.length, appIds: [...new Set(cards.flatMap(card => card.appIds))], cards };
}

export async function replay(file) {
  const evidence = JSON.parse(await fs.readFile(file, 'utf8'));
  assertSource(evidence.sourceUrl);
  assertSource(evidence.responseUrl);
  assertWindow(evidence.date, new Date(evidence.observedAt));
  if (evidence.frozen !== false || evidence.httpStatus !== 200) throw new Error('EVIDENCE_INVALID');
  const raw = await fs.readFile(path.resolve(path.dirname(file), evidence.rawResponseFile));
  if (sha256(raw) !== evidence.rawResponseSha256) throw new Error('RAW_HASH_MISMATCH');
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const parsed = await page.evaluate(parseDocument, raw.toString('utf8'));
    if (JSON.stringify(parsed) !== JSON.stringify(evidence.discovery)) throw new Error('PARSED_EVIDENCE_MISMATCH');
    return { valid: true, appIdCount: parsed.appIds.length, rawResponseSha256: evidence.rawResponseSha256 };
  } finally { await browser.close(); }
}

export async function collect(date, out) {
  assertWindow(date);
  const target = path.resolve(out);
  // Collector has no production-state write path, even when passed an accidental output argument.
  const relative = path.relative(path.resolve('output'), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !target.endsWith('.json')) throw new Error('OUTPUT_REJECTED: use a new JSON file under output/');
  await fs.mkdir(path.dirname(target), { recursive: true });
  const { chromium } = await loadPlaywright();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let proxy;
  if (proxyUrl) {
    const u = new URL(proxyUrl);
    if (!['http:', 'https:', 'socks5:'].includes(u.protocol) || u.username || u.password) throw new Error('PROXY_UNSUPPORTED: require existing credential-free proxy');
    proxy = { server: u.origin };
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, ...(proxy ? { proxy } : {}) });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block', javaScriptEnabled: false });
    const page = await context.newPage();
    await page.route('**/*', route => {
      try { assertSource(route.request().url(), route.request().method()); return route.continue(); }
      catch { return route.abort(); }
    });
    const response = await page.goto(SOURCE_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!response) throw new Error('RESPONSE_MISSING');
    assertSource(response.url());
    if (response.status() !== 200) throw new Error(`HTTP_ERROR: ${response.status()}`);
    const raw = await response.body();
    const observedAt = new Date().toISOString();
    assertWindow(date, new Date(observedAt));
    const parser = await browser.newPage();
    const discovery = await parser.evaluate(parseDocument, raw.toString('utf8'));
    const rawFile = target.replace(/\.json$/, '.response.html');
    const evidence = { schemaVersion: 1, date, observedAt, frozen: false, sourceUrl: SOURCE_URL, responseUrl: response.url(), method: 'GET', httpStatus: response.status(), rawResponseFile: path.basename(rawFile), rawResponseSha256: sha256(raw), discovery };
    await fs.writeFile(rawFile, raw, { flag: 'wx' });
    await fs.writeFile(target, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    return { output: target, ...evidence };
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(2, i), arg.slice(i + 1)]; }));
    const result = args.replay ? await replay(path.resolve(args.replay)) : await collect(args.date, args.out || '');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
