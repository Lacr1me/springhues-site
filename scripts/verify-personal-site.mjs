import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd();
const options = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)));
const evidence = path.resolve(options.out || 'output/playwright/personal-site');
await fs.mkdir(evidence, { recursive: true });
const fixture = JSON.parse(await fs.readFile(path.join(root, 'scripts', 'portal-resources.fixture.json'), 'utf8'));
const catalog = JSON.parse(await fs.readFile(path.join(root, 'data', 'resources.json'), 'utf8'));
const { loadPlaywright } = await import('./collect-steam-discovery.mjs');
const { chromium } = await loadPlaywright();
await fs.mkdir(path.join(evidence, 'downloads'), { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true, downloadsPath: path.join(evidence, 'downloads') });
const fileUrl = options.base || 'http://127.0.0.1:4275/';
const resize = async (page, size) => {
  await page.setViewportSize(size);
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
};
const report = { checkedAt: new Date().toISOString(), browser: 'Microsoft Edge / Playwright', artifact: fileUrl, checks: [], errors: [], widths: [], environmentRequestOrigins: [] };
const check = async (name, fn) => {
  try {
    await fn();
    report.checks.push({ name, passed: true });
    console.log('PASS ' + name);
  } catch (error) {
    report.checks.push({ name, passed: false, error: error.message });
    throw error;
  }
};
const countCards = async (page, count) => page.waitForFunction(n => document.querySelectorAll('#projectGrid .resource-card').length === n, count);
const showDetail = async (page, visible) => page.waitForFunction(value => document.querySelector('#detailView').hidden === !value && (!value || document.querySelector('#detailTitle')?.textContent !== '正在读取资源…'), visible);
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce', offline: false, acceptDownloads: true });
await context.route('**/*', route => new URL(route.request().url()).origin === new URL(fileUrl).origin ? route.continue() : route.abort());
let fixturePayload = structuredClone(fixture);
let fixtureStatus = 200;
let fixtureDelay = 0;
await context.route('**/data/resources.json', async route => {
  if (fixtureDelay) await new Promise(resolve => setTimeout(resolve, fixtureDelay));
  await route.fulfill({ status: fixtureStatus, contentType: 'application/json', body: JSON.stringify(fixturePayload) });
});
const page = await context.newPage();
page.on('pageerror', error => report.errors.push(error.message));
const externalRequests = [];
page.on('request', request => {
  if (!/^https?:/.test(request.url())) return;
  const url = new URL(request.url());
  if (url.origin === new URL(fileUrl).origin) return;
  // The installed security product injects its own transport into HTTP pages; source files do not include it.
  if (url.hostname.endsWith('.kaspersky-labs.com')) {
    if (!report.environmentRequestOrigins.includes(url.origin)) report.environmentRequestOrigins.push(url.origin);
  } else externalRequests.push(request.url());
});
try {
  const live = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', reducedMotion: 'reduce' });
  await live.route('**/*', route => new URL(route.request().url()).origin === new URL(fileUrl).origin ? route.continue() : route.abort());
  const livePage = await live.newPage();
  livePage.on('pageerror', error => report.errors.push(error.message));
  await livePage.goto(fileUrl, { waitUntil: 'load' });
  await livePage.waitForFunction(() => document.querySelector('#projectGrid').getAttribute('aria-busy') === 'false');
  await check('真实资源清单与日报归档入口', async () => {
    assert.equal(await livePage.locator('.resource-card').count(), catalog.resources.filter(item => item.status !== 'draft' && (!item.publishAt || Date.parse(item.publishAt) <= Date.now())).length);
    if (catalog.resources.length === 0) assert.equal(await livePage.locator('#emptyTitle').textContent(), '作品正在整理');
    for (const [name, location] of [['civic', 'data/minsheng/index.json'], ['game', 'data/index.json']]) {
      const manifest = JSON.parse(await fs.readFile(path.join(root, location), 'utf8'));
      const current = manifest.editions.filter(item => Date.parse(item.publishAt) <= Date.now()).sort((a, b) => b.date.localeCompare(a.date))[0];
      await livePage.waitForFunction(({name,date}) => new URL(document.querySelector('#' + name + 'Link').href).searchParams.get('date') === date, {name,date:current.date});
      assert.equal(await livePage.locator('#' + name + 'Date').getAttribute('datetime'), current.date);
    }
  });
  await livePage.screenshot({ path: path.join(evidence, 'production-desktop.png'), fullPage: true });
  await resize(livePage, { width: 390, height: 844 });
  await livePage.screenshot({ path: path.join(evidence, 'production-mobile.png'), fullPage: true });
  await livePage.locator('.main-nav [data-view="journal"]').click();
  await livePage.screenshot({ path: path.join(evidence, 'production-journal-mobile.png'), fullPage: true });
  await resize(livePage, { width: 1440, height: 1000 });
  await livePage.screenshot({ path: path.join(evidence, 'production-journal-desktop.png'), fullPage: true });
  await check('现有留言与隐私页面样式及入口', async () => {
    await livePage.goto(new URL('privacy/', fileUrl).href);
    assert(await livePage.locator('h2').filter({hasText:'资源收藏与搜索'}).isVisible());
    assert.equal(await livePage.locator('link[href^="portal.css"]').count(), 1);
    await livePage.goto(new URL('messages/', fileUrl).href);
    assert(await livePage.locator('[data-message-form]').isVisible());
    assert.equal(await livePage.locator('link[href^="portal.css"]').count(), 1);
    await livePage.screenshot({ path: path.join(evidence, 'messages-preserved-desktop.png'), fullPage: true });
  });
  await live.close();
  await page.goto(fileUrl, { waitUntil: 'load' });
  await countCards(page, 3);
  await page.screenshot({ path: path.join(evidence, 'fixture-shelf-desktop.png'), fullPage: true });
  await page.screenshot({ path: path.join(evidence, 'fixture-shelf-desktop-first-screen.png') });
  await resize(page, { width: 390, height: 844 });
  await page.screenshot({ path: path.join(evidence, 'fixture-shelf-mobile.png'), fullPage: true });
  await resize(page, { width: 1440, height: 1000 });
  await page.locator('.resource-title [data-work="quiet-download"]').click();
  await showDetail(page, true);
  await page.screenshot({ path: path.join(evidence, 'fixture-shelf-detail-desktop.png'), fullPage: true });
  await resize(page, { width: 390, height: 844 });
  await page.screenshot({ path: path.join(evidence, 'fixture-shelf-detail-mobile.png'), fullPage: true });
  await resize(page, { width: 1440, height: 1000 });
  await page.locator('[data-back]').first().click();
  await showDetail(page, false);
  await check('生产页面本地依赖完整加载且只使用个人 Logo', async () => {
    assert.equal(await page.locator('.resource-card').count(), 3);
    const imageInfo = await page.evaluate(() => [...document.images].map(image => ({
      loaded: image.complete && image.naturalWidth > 0,
      width: image.naturalWidth, height: image.naturalHeight, src: image.src
    })));
    assert(imageInfo.every(image => image.loaded));
    assert.equal(new Set(imageInfo.map(image => image.src)).size, 1);
    assert.equal(await page.locator('script[src^="portal"]').count(), 2);
    assert.equal(externalRequests.length, 0, JSON.stringify(externalRequests.map(url => new URL(url).origin)));
    assert.equal(await page.locator('dialog').count(), 0);
    assert.equal(await page.locator('.card-actions button:disabled').count(), 3);
  });
  await check('320–1920px 首页与详情无横向溢出', async () => {
    for (const width of [320, 390, 768, 820, 1024, 1440, 1920]) {
      await resize(page, { width, height: 1000 });
      const measured = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      report.widths.push({ view: 'library', ...measured });
      assert(measured.content <= measured.client, JSON.stringify(measured));
    }
    await page.locator('.resource-title [data-work="quiet-download"]').click();
    await showDetail(page, true);
    for (const width of [320, 390, 768, 820, 1024, 1440, 1920]) {
      await resize(page, { width, height: 1000 });
      const measured = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
      report.widths.push({ view: 'detail', ...measured });
      if (measured.content > measured.client) measured.offenders = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const rect=e.getBoundingClientRect(); return rect.width>0 && rect.right>innerWidth+1; }).map(e=>({tag:e.tagName,id:e.id,class:String(e.className),x:e.getBoundingClientRect().x,width:e.getBoundingClientRect().width})));
      assert(measured.content <= measured.client, JSON.stringify(measured));
    }
    await page.locator('[data-back]').first().click();
    await showDetail(page, false);
    await resize(page, { width: 1440, height: 1000 });
  });
  await check('搜索功能词、组合分类和清除筛选', async () => {
    await page.locator('#workSearch').fill('暂停');
    await countCards(page, 1);
    assert.equal(await page.locator('.resource-card').getAttribute('data-card'), 'quiet-download');
    await page.locator('[data-category="game"]').click();
    await countCards(page, 0);
    assert(await page.locator('#emptyState').isVisible());
    await page.locator('#clearFilters').click();
    await countCards(page, 3);
    assert.equal(await page.locator('#workSearch').inputValue(), '');
  });
  await check('收藏保存、刷新持久化、取消与空状态', async () => {
    await page.locator('.resource-card [data-save="quiet-download"]').click();
    assert.equal(await page.locator('#favoriteCount').textContent(), '1');
    await page.reload();
    await countCards(page, 3);
    assert.equal(await page.locator('.resource-card [data-save="quiet-download"]').getAttribute('aria-pressed'), 'true');
    await page.locator('.main-nav [data-view="saved"]').click();
    await countCards(page, 1);
    await page.locator('.resource-card [data-save="quiet-download"]').click();
    await countCards(page, 0);
    assert.equal(await page.locator('#emptyTitle').textContent(), '还没有收藏的资源');
    await page.locator('#clearFilters').click();
    await countCards(page, 3);
  });
  await check('详情完整页面、后退与前进保留位置和焦点', async () => {
    await resize(page, { width: 1440, height: 780 });
    const link = page.locator('.resource-title [data-work="block-notes"]');
    await link.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      // Playwright may scroll again for click hit-testing; capture the position the user actually opens from.
      document.addEventListener('pointerdown', () => { window.openedFromY = scrollY; }, { capture: true, once: true });
    });
    await link.click();
    const before = await page.evaluate(() => window.openedFromY);
    await showDetail(page, true);
    assert.equal(new URL(page.url()).searchParams.get('work'), 'block-notes');
    assert.equal(await page.locator('#detailTitle').textContent(), '方块资源手记');
    assert(await page.locator('#detailTitle').evaluate(element => element === document.activeElement));
    assert(await page.locator('.download-sidebar > button').isDisabled());
    await page.keyboard.press('Escape');
    await showDetail(page, false);
    assert.equal(new URL(page.url()).searchParams.get('work'), null);
    assert(await link.evaluate(element => element === document.activeElement));
    const returned = await page.evaluate(() => ({ scrollY, history: history.state, height: document.documentElement.scrollHeight }));
    assert(Math.abs(returned.scrollY - before) < 4, JSON.stringify({ before, returned }));
    await page.goForward();
    await showDetail(page, true);
    await page.reload();
    await showDetail(page, true);
    await page.locator('[data-back]').first().click();
    await showDetail(page, false);
    await resize(page, { width: 1440, height: 1000 });
  });
  await check('详情返回保留分类和关键词', async () => {
    await page.locator('[data-category="tools"]').click();
    await page.locator('#workSearch').fill('下载');
    await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === '下载');
    await page.locator('.resource-title [data-work="quiet-download"]').click();
    await showDetail(page, true);
    await page.locator('[data-back]').first().click();
    await showDetail(page, false);
    assert.equal(await page.locator('#workSearch').inputValue(), '下载');
    assert.equal(await page.locator('[data-category="tools"]').getAttribute('aria-pressed'), 'true');
    await countCards(page, 1);
    await page.goto(fileUrl);
  });
  await check('独立详情链接和失效链接', async () => {
    const direct = await context.newPage();
    await direct.goto(fileUrl + '?work=reading-room');
    await showDetail(direct, true);
    assert.equal(await direct.locator('#detailTitle').textContent(), '安静的阅读页');
    await direct.locator('[data-back]').first().click();
    await showDetail(direct, false);
    await direct.goto(fileUrl + '?work=not-a-resource');
    await showDetail(direct, true);
    assert.equal(await direct.locator('#detailTitle').textContent(), '没有找到这个资源');
    await direct.locator('[data-back]').first().click();
    await showDetail(direct, false);
    await direct.close();
  });
  await check('复制受限时提供可选中链接', async () => {
    await page.locator('.resource-title [data-work="quiet-download"]').click();
    await showDetail(page, true);
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('test blocked clipboard')) } }));
    await page.locator('[data-copy]').click();
    assert(await page.locator('#copyFallback').isVisible());
    assert.equal(await page.locator('#manualCopyLink').inputValue(), page.url());
    assert(await page.locator('#manualCopyLink').evaluate(input => input.selectionEnd - input.selectionStart === input.value.length));
    await page.locator('[data-back]').first().click();
    await showDetail(page, false);
  });
  await check('收藏保存失败时状态不虚报成功', async () => {
    await page.evaluate(() => {
      window.originalSetItem = Storage.prototype.setItem;
      Storage.prototype.setItem = () => { throw new Error('test storage failure'); };
    });
    const button = page.locator('.resource-card [data-save="quiet-download"]');
    await button.click();
    assert.equal(await button.getAttribute('aria-pressed'), 'false');
    assert.equal(await page.locator('#favoriteCount').textContent(), '0');
    assert((await page.locator('#toast').textContent()).includes('未能保存'));
    await page.evaluate(() => { Storage.prototype.setItem = window.originalSetItem; delete window.originalSetItem; });
  });
  await check('页面切换、日报入口与外链安全属性', async () => {
    await page.locator('.main-nav [data-view="journal"]').click();
    assert(await page.locator('#journalView').isVisible());
    const links = await page.locator('#civicLink,#gameLink').evaluateAll(elements => elements.map(element => element.href));
    assert(links[0].startsWith(new URL('minsheng/', fileUrl).href));
    assert(links[1].startsWith(new URL('game/', fileUrl).href));
    await page.locator('#toast').waitFor({ state: 'hidden' });
    await page.screenshot({ path: path.join(evidence, 'fixture-shelf-journal-desktop.png'), fullPage: true });
    await page.locator('.main-nav [data-view="about"]').click();
    assert(await page.locator('#aboutView').isVisible());
    assert(await page.locator('.about-brand img').isVisible());
    const unsafe = await page.locator('a[target="_blank"]').evaluateAll(elements => elements.filter(element => !element.rel.includes('noopener') || !element.rel.includes('noreferrer')).length);
    assert.equal(unsafe, 0);
    await page.locator('.main-nav [data-view="library"]').click();
    await countCards(page, 3);
  });
  await check('键盘快捷键和减少动态效果', async () => {
    await page.keyboard.press('/');
    assert(await page.locator('#workSearch').evaluate(element => element === document.activeElement));
    await page.keyboard.type('安静');
    await countCards(page, 1);
    await page.keyboard.press('Escape');
    await countCards(page, 3);
    assert.equal(await page.locator('#workSearch').inputValue(), '');
    assert.equal(await page.locator('.resource-card').first().evaluate(element => getComputedStyle(element).animationName), 'none');
  });
  await check('正常动效下导航、悬停与连续切换', async () => {
    const motionContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', offline: false, reducedMotion: 'no-preference' });
    await motionContext.route('**/*', route => new URL(route.request().url()).origin === new URL(fileUrl).origin ? route.continue() : route.abort());
    await motionContext.route('**/data/resources.json', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify(fixture) }));
    const motionPage = await motionContext.newPage();
    motionPage.on('pageerror', error => report.errors.push(error.message));
    await motionPage.goto(fileUrl);
    await countCards(motionPage, 3);
    await motionPage.waitForFunction(() => document.getAnimations().filter(animation => animation.playState === 'running').length === 0);
    await motionPage.locator('.resource-card').first().hover();
    await motionPage.waitForFunction(() => getComputedStyle(document.querySelector('.resource-card')).transform !== 'none');
    await motionPage.locator('.resource-title [data-work="reading-room"]').click();
    await showDetail(motionPage, true);
    await motionPage.waitForFunction(() => document.getAnimations().filter(animation => animation.playState === 'running').length === 0);
    await motionPage.locator('[data-back]').first().click();
    await showDetail(motionPage, false);
    await motionPage.evaluate(() => {
      document.querySelector('.main-nav [data-view="journal"]').click();
      document.querySelector('.main-nav [data-view="about"]').click();
      document.querySelector('.main-nav [data-view="library"]').click();
    });
    await motionPage.waitForFunction(() => !document.querySelector('#libraryView').hidden && document.querySelector('#projectGrid').children.length === 3);
    await motionContext.close();
  });
  await check('手机导航、分类与详情返回', async () => {
    await resize(page, { width: 390, height: 844 });
    await page.locator('.main-nav [data-view="journal"]').click();
    assert(await page.locator('#journalView').isVisible());
    await page.locator('.main-nav [data-view="library"]').click();
    await page.locator('[data-category="game"]').click();
    await countCards(page, 1);
    await page.locator('.resource-title [data-work="block-notes"]').click();
    await showDetail(page, true);
    await page.locator('[data-back]').first().click();
    await showDetail(page, false);
    assert.equal(await page.locator('[data-category="game"]').getAttribute('aria-pressed'), 'true');
  });
  await check('目录读取失败可重试，空目录与失效详情明确区分', async () => {
    fixtureStatus = 503;
    await page.goto(fileUrl);
    await page.locator('#retryCatalog').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#emptyTitle').textContent(), '资源暂时没读到');
    fixtureStatus = 200;
    await page.locator('#retryCatalog').click();
    await countCards(page, 3);
    fixturePayload = { schemaVersion: 1, resources: [] };
    await page.reload();
    await countCards(page, 0);
    await page.waitForFunction(() => document.querySelector('#emptyTitle').textContent === '作品正在整理');
    await page.locator('#clearFilters').click();
    assert(await page.locator('#journalView').isVisible());
    fixturePayload = structuredClone(fixture);
  });
  await check('资源中的文本与链接经过安全处理', async () => {
    fixturePayload.resources[0].title = '<img src=x onerror=window.injected=true>';
    await page.goto(fileUrl);
    await countCards(page, 3);
    assert.equal(await page.locator('.resource-title').first().textContent(), '<img src=x onerror=window.injected=true>');
    assert.equal(await page.locator('.resource-title img').count(), 0);
    assert.equal(await page.evaluate(() => window.injected), undefined);
    fixturePayload.resources[0].status = 'published';
    fixturePayload.resources[0].downloadUrl = 'javascript:alert(1)';
    await page.reload();
    await page.locator('#retryCatalog').waitFor({ state: 'visible' });
    fixturePayload = structuredClone(fixture);
  });
  await check('同源文件下载与外部项目链接', async () => {
    fixturePayload.resources[0].status = 'published';
    // Edge cancels route.fulfill downloads; use an actual local file without adding a public resource.
    fixturePayload.resources[0].downloadUrl = '/brand-assets/springhues-logo.png';
    fixturePayload.resources[0].filename = 'portal-test-logo.png';
    const expectedBytes = await fs.readFile(path.join(root, 'brand-assets', 'springhues-logo.png'));
    fixturePayload.resources[0].fileSize = expectedBytes.length + ' B';
    fixturePayload.resources[0].sourceUrl = 'https://example.com/project';
    await page.goto(fileUrl + '?work=quiet-download');
    await showDetail(page, true);
    await page.locator('.resource-download').waitFor();
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.resource-download').click()]);
    assert.equal(download.suggestedFilename(), 'portal-test-logo.png');
    assert.equal(await download.failure(), null);
    assert((await fs.readFile(await download.path())).equals(expectedBytes));
    const source = page.locator('.resource-source');
    assert.equal(await source.getAttribute('href'), 'https://example.com/project');
    assert.equal(await source.getAttribute('rel'), 'noopener noreferrer');
    fixturePayload = structuredClone(fixture);
  });
  await check('慢速加载期间输入不丢失，中文组合输入不中断', async () => {
    fixtureDelay = 500;
    await page.goto(fileUrl);
    await page.locator('#workSearch').fill('暂停');
    await countCards(page, 1);
    assert.equal(await page.locator('#workSearch').inputValue(), '暂停');
    await page.locator('#workSearch').evaluate(input => {
      input.dispatchEvent(new CompositionEvent('compositionstart', {bubbles:true}));
      input.value = '安静';
      input.dispatchEvent(new InputEvent('input', {bubbles:true,isComposing:true,data:'静'}));
    });
    assert.equal(await page.locator('#workSearch').inputValue(), '安静');
    await page.locator('#workSearch').evaluate(input => input.dispatchEvent(new CompositionEvent('compositionend', {bubbles:true,data:'安静'})));
    await page.waitForFunction(() => document.querySelector('.resource-card')?.dataset.card === 'reading-room');
    fixtureDelay = 0;
  });
  await check('两个日报独立加载并过滤未来期次', async () => {
    const latest = { date:'2020-01-02',publishAt:'2020-01-02T11:00:00+08:00',headline:'已发布',issue:2 };
    await page.route('**/data/index.json', route => route.fulfill({contentType:'application/json',body:JSON.stringify({editions:[{date:'9999-12-31',publishAt:'9999-12-31T11:00:00+08:00',headline:'未来'},latest]})}));
    let failCivic = true;
    await page.route('**/data/minsheng/index.json', route => failCivic ? route.fulfill({status:503,body:'unavailable'}) : route.fulfill({contentType:'application/json',body:JSON.stringify({editions:[latest]})}));
    await page.goto(fileUrl + '?view=journal');
    await page.locator('[data-retry-channel="civic"]').waitFor();
    assert.equal(new URL(await page.locator('#gameLink').getAttribute('href'), fileUrl).searchParams.get('date'), '2020-01-02');
    assert.equal(await page.locator('#gameHeadline').textContent(), '已发布');
    failCivic = false;
    await page.locator('[data-retry-channel="civic"]').click();
    await page.waitForFunction(() => document.querySelector('#civicDate').getAttribute('datetime') === '2020-01-02');
  });
  await check('没有浏览器脚本异常或外部加载请求', async () => {
    assert.deepEqual(report.errors, []);
    assert.deepEqual(externalRequests, []);
  });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.failure = error.stack;
  console.error(error);
  await page.screenshot({ path: path.join(evidence, 'fixture-shelf-verification-failure.png'), fullPage: true });
  process.exitCode = 1;
} finally {
  await fs.writeFile(path.join(evidence, 'fixture-shelf-verification.json'), JSON.stringify(report, null, 2) + '\n');
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, checks: report.checks.length, report: path.join(evidence, 'fixture-shelf-verification.json') }));
}
