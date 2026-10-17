import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaywright, sha256 } from './collect-steam-discovery.mjs';

export function assertProductSource(url, appId, method = 'GET') {
  const u = new URL(url);
  if (!/^\d+$/.test(String(appId)) || method !== 'GET' || u.protocol !== 'https:' || u.hostname !== 'store.steampowered.com' || u.port || u.username || u.password || !u.pathname.startsWith(`/app/${appId}/`)) throw new Error('SOURCE_REJECTED');
  if (JSON.stringify([...u.searchParams.entries()].sort()) !== JSON.stringify([['cc', 'cn'], ['l', 'schinese']])) throw new Error('REGION_OR_QUERY_REJECTED');
}

// Browser-side pure parsing of the original HTTP body; scripts are never executed.
export function parseProduct({ html, appId }) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const config = doc.querySelector('#application_config')?.getAttribute('data-config');
  if (config) { const parsed = JSON.parse(config); if (parsed.COUNTRY !== 'CN' || parsed.LANGUAGE !== 'schinese') throw new Error('RESPONSE_REGION_REJECTED'); }
  const title = doc.querySelector('#appHubAppName')?.textContent?.trim();
  if (!title) throw new Error('PRODUCT_MISSING_OR_AGE_GATE');
  const text = (el, selector) => el.querySelector(selector)?.textContent?.trim() || null;
  const offers = [...doc.querySelectorAll('.game_area_purchase_game')].map((el, index) => {
    const discount = el.querySelector('.discount_block');
    const raw = el.outerHTML;
    const timestamps = [...raw.matchAll(/(?:data-discount-end-timestamp=["']|InitDailyDealTimer\s*\([^,]+,\s*)(\d{10})/g)].map(m => Number(m[1]));
    const saleEndUnix = [...new Set(timestamps)];
    return { index, label: text(el, 'h1, h2, .title'), packageId: el.querySelector('input[name="subid"]')?.getAttribute('value') || null,
      originalPrice: text(el, '.discount_original_price'), currentPrice: text(el, '.discount_final_price') || text(el, '.game_purchase_price'),
      discountPercent: discount?.getAttribute('data-discount') || text(el, '.discount_pct'),
      priceFinalMinor: discount?.getAttribute('data-price-final') || null,
      saleEndUnix: saleEndUnix.length === 1 ? saleEndUnix[0] : null,
      saleEndStatus: saleEndUnix.length === 1 ? 'explicit-official-unix' : saleEndUnix.length ? 'ambiguous' : 'missing',
      saleText: text(el, '.game_purchase_discount_countdown') || text(el, '.game_purchase_discount_quantity') };
  });
  if (!offers.length) throw new Error('PURCHASE_OFFERS_MISSING');
  for (const offer of offers) if (offer.currentPrice && !/[¥￥]|免费/.test(offer.currentPrice)) throw new Error('NON_CNY_PRICE');
  return { appId: String(appId), title, country: 'CN', currency: 'CNY', offers, historicalPriceVerified: false };
}

export async function collectProduct(appId, out) {
  if (!/^\d+$/.test(String(appId))) throw new Error('INVALID_APP_ID');
  const target = path.resolve(out || '');
  const relative = path.relative(path.resolve('output'), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !target.endsWith('.json')) throw new Error('OUTPUT_REJECTED');
  const url = `https://store.steampowered.com/app/${appId}/?cc=cn&l=schinese`;
  const { chromium } = await loadPlaywright();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let proxy;
  if (proxyUrl) { const u = new URL(proxyUrl); if (!['http:', 'https:', 'socks5:'].includes(u.protocol) || u.username || u.password) throw new Error('PROXY_UNSUPPORTED'); proxy = { server: u.origin }; }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, ...(proxy ? { proxy } : {}) });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', javaScriptEnabled: false, serviceWorkers: 'block' });
    const page = await context.newPage();
    await page.route('**/*', route => {
      try {
        assertProductSource(route.request().url(), appId, route.request().method());
        const headers = { ...route.request().headers() };
        delete headers.cookie;
        delete headers.authorization;
        return route.continue({ headers });
      } catch { return route.abort(); }
    });
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    if (!response || response.status() !== 200) throw new Error(`HTTP_ERROR: ${response?.status()}`);
    assertProductSource(response.url(), appId);
    const raw = await response.body();
    const observedAt = new Date().toISOString();
    const parser = await browser.newPage();
    let product = null;
    let parseError = null;
    try { product = await parser.evaluate(parseProduct, { html: raw.toString('utf8'), appId }); } catch (error) { parseError = error.message; }
    const rawFile = target.replace(/\.json$/, '.response.html');
    const evidence = { schemaVersion: 1, observedAt, sourceUrl: url, responseUrl: response.url(), httpStatus: 200, method: 'GET', appId: String(appId), rawResponseFile: path.basename(rawFile), rawResponseSha256: sha256(raw), product, parseError };
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(rawFile, raw, { flag: 'wx' });
    await fs.writeFile(target, JSON.stringify(evidence, null, 2) + '\n', { flag: 'wx' });
    if (parseError) throw new Error(`PRODUCT_PARSE_FAILED: evidence saved at ${target}; ${parseError}`);
    return evidence;
  } finally { await browser.close(); }
}

export async function replayProduct(file) {
  const evidence = JSON.parse(await fs.readFile(file, 'utf8'));
  assertProductSource(evidence.sourceUrl, evidence.appId);
  assertProductSource(evidence.responseUrl, evidence.appId);
  if (evidence.httpStatus !== 200 || !Number.isFinite(Date.parse(evidence.observedAt))) throw new Error('EVIDENCE_INVALID');
  const raw = await fs.readFile(path.resolve(path.dirname(file), evidence.rawResponseFile));
  if (sha256(raw) !== evidence.rawResponseSha256) throw new Error('RAW_HASH_MISMATCH');
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const parsed = await page.evaluate(parseProduct, { html: raw.toString('utf8'), appId: evidence.appId });
    if (JSON.stringify(parsed) !== JSON.stringify(evidence.product)) throw new Error('PARSED_EVIDENCE_MISMATCH');
    return { valid: true, appId: evidence.appId, rawResponseSha256: evidence.rawResponseSha256 };
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(2, i), arg.slice(i + 1)]; }));
    const result = args.replay ? await replayProduct(args.replay) : await collectProduct(args['app-id'], args.out);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
