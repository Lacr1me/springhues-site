import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPlaywright } from './collect-steam-discovery.mjs';
import { probeRenderedEdition } from './health-browser-probe.mjs';
import { sha256, verifyPageEvidence } from './health-lib.mjs';

// Uses the bundled library directly: no Playwright CLI daemon or personal profile.
export async function collectLivePageEvidence({ root = process.cwd(), channel, date, base = 'https://springhues.com', out } = {}) {
  if (!['game', 'minsheng'].includes(channel)) throw new Error('CHANNEL_REQUIRED: game|minsheng');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error('DATE_REQUIRED: YYYY-MM-DD');
  const site = new URL(base);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(site.hostname);
  if (site.username || site.password || site.pathname !== '/' || site.search || site.hash ||
      !(site.protocol === 'https:' && site.hostname === 'springhues.com' && !site.port || loopback && ['http:', 'https:'].includes(site.protocol))) {
    throw new Error('SITE_REJECTED: use springhues.com or a local test server');
  }
  const target = path.resolve(root, out || '');
  const relative = path.relative(path.join(root, 'output'), target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !target.endsWith('.json')) throw new Error('OUTPUT_REJECTED: use a new JSON under output/');
  const manifestPath = channel === 'game' ? 'data/index.json' : 'data/minsheng/index.json';
  const manifest = JSON.parse(await readFile(path.join(root, manifestPath), 'utf8'));
  const editions = manifest.editions.filter(item => Date.parse(item.publishAt) <= Date.now()).sort((a, b) => b.date.localeCompare(a.date));
  if (!editions.some(item => item.date === date)) throw new Error('EDITION_NOT_PUBLISHED: no public local target edition');
  const latestDate = editions[0].date;
  const historyDate = editions.find(item => item.date < date)?.date;
  const localPng = await readFile(path.join(root, 'downloads', channel, `${date}.png`));
  const { chromium } = await loadPlaywright();
  const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY;
  let proxy;
  // Loopback verification must not leave the machine through an inherited proxy.
  if (proxyUrl && !loopback) {
    const u = new URL(proxyUrl);
    if (!['http:', 'https:', 'socks5:'].includes(u.protocol) || u.username || u.password) throw new Error('PROXY_UNSUPPORTED: require an existing credential-free proxy');
    proxy = { server: u.origin };
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true, ...(proxy ? { proxy } : {}) });
  try {
    const context = await browser.newContext({ locale: 'zh-CN', acceptDownloads: true, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(20_000);
    page.setDefaultNavigationTimeout(45_000);
    await page.route('**/*', route => {
      const request = route.request();
      if (new URL(request.url()).origin !== site.origin || !['GET', 'HEAD'].includes(request.method())) return route.abort();
      const headers = { ...request.headers() };
      delete headers.cookie;
      delete headers.authorization;
      return route.continue({ headers });
    });
    const pageUrl = `${site.origin}/${channel}/?date=${date}&health=${encodeURIComponent(new Date().toISOString())}`;
    const current = await probeRenderedEdition(page, { url: pageUrl, date });
    verifyPageEvidence(current, { url: pageUrl, date, channel, checkedAt: current.checkedAt });
    const downloaded = page.waitForEvent('download', { timeout: 60_000 });
    await page.locator('#downloadPng').click();
    const download = await downloaded;
    const error = await download.failure();
    if (error) throw new Error(`PNG_DOWNLOAD_FAILED: ${error}`);
    const bytes = await readFile(await download.path());
    if (!bytes.equals(localPng)) throw new Error('PNG_HASH_MISMATCH: downloaded bytes differ from local public PNG');
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(16) !== 3840) {
      throw new Error('PNG_INVALID: require a real 3840px PNG');
    }
    const acceptance = { download: { url: download.url(), filename: download.suggestedFilename(), bytes: bytes.length, width: 3840, sha256: sha256(bytes) } };
    if (historyDate) {
      acceptance.history = await probeRenderedEdition(page, { url: `${site.origin}/${channel}/?date=${historyDate}`, date: historyDate });
      await page.locator('#archiveDate').evaluate((input, selected) => { input.value = selected; input.dispatchEvent(new Event('change', { bubbles: true })); }, date);
      await page.waitForFunction(expected => document.querySelector('#navDate')?.textContent.trim() === expected, date);
      if (new URL(page.url()).searchParams.get('date') !== date) throw new Error('ARCHIVE_PICKER_FAILED');
      acceptance.archivePicker = { selectedDate: date, url: page.url() };
    }
    acceptance.latest = await probeRenderedEdition(page, { url: `${site.origin}/${channel}/`, date: latestDate });
    acceptance.invalidDateFallback = await probeRenderedEdition(page, { url: `${site.origin}/${channel}/?date=invalid-date`, date: latestDate });
    acceptance.futureDateFallback = await probeRenderedEdition(page, { url: `${site.origin}/${channel}/?date=9999-12-31`, date: latestDate });
    await page.goto(site.origin, { waitUntil: 'domcontentloaded' });
    const linkId = channel === 'game' ? 'gameLink' : 'civicLink';
    await page.waitForFunction(({ linkId, expected }) => {
      const href = document.querySelector(`#${linkId}`)?.href;
      return href && new URL(href).searchParams.get('date') === expected;
    }, { linkId, expected: latestDate });
    acceptance.portal = await page.locator(`#${linkId}`).evaluate(a => ({ url: a.href }));
    const result = { checkedAt: new Date().toISOString(), pages: { [channel]: current }, acceptance };
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    return result;
  } finally { await browser.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args = Object.fromEntries(process.argv.slice(2).map(arg => { const i = arg.indexOf('='); return [arg.slice(2, i), arg.slice(i + 1)]; }));
    const result = await collectLivePageEvidence({ channel: args.channel, date: args.date, base: args.base, out: args.out });
    console.log(JSON.stringify(result, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
