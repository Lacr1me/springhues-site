import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { assertSource, assertWindow, loadPlaywright, parseDocument, replay, SOURCE_URL } from './collect-steam-discovery.mjs';

test('historical/future date and late discovery are rejected', () => {
  const now = new Date('2026-09-26T23:59:59Z');
  assert.doesNotThrow(() => assertWindow('2026-09-27', now));
  assert.throws(() => assertWindow('2026-09-26', now), /DATE_NOT_TODAY/);
  assert.throws(() => assertWindow('2026-09-28', now), /DATE_NOT_TODAY/);
  assert.throws(() => assertWindow('2026-09-27', new Date('2026-09-27T00:00:00Z')), /WINDOW_CLOSED/);
});

test('strict source boundary preserves region, default ordering and first page', () => {
  assert.doesNotThrow(() => assertSource(SOURCE_URL));
  for (const url of [SOURCE_URL.replace('store.steampowered.com', 'example.org'), SOURCE_URL + '&page=2', SOURCE_URL + '&sort_by=Price_ASC', SOURCE_URL.replace('cc=cn', 'cc=us')]) assert.throws(() => assertSource(url), /SOURCE_REJECTED/);
  assert.throws(() => assertSource(SOURCE_URL, 'POST'), /SOURCE_REJECTED/);
});

test('replay refuses modified raw response before browser parsing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'steam-replay-test-'));
  try {
    await fs.writeFile(path.join(dir, 'raw.html'), '<html>modified</html>');
    const file = path.join(dir, 'evidence.json');
    await fs.writeFile(file, JSON.stringify({ date: '2026-09-27', observedAt: '2026-09-26T23:00:00Z', frozen: false, httpStatus: 200, sourceUrl: SOURCE_URL, responseUrl: SOURCE_URL, rawResponseFile: 'raw.html', rawResponseSha256: '0'.repeat(64) }));
    await assert.rejects(replay(file), /RAW_HASH_MISMATCH/);
  } finally {
    // Delete only the two known files; no recursive directory operations.
    await fs.unlink(path.join(dir, 'raw.html'));
    await fs.unlink(path.join(dir, 'evidence.json'));
    await fs.rmdir(dir);
  }
});

test('saved official response parsing includes every card and fails closed', async () => {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const card = id => `<a class="search_result_row" data-ds-appid="${id}" href="https://store.steampowered.com/app/${id}/"><span class="title">Game ${id}</span><div class="discount_original_price">¥100</div><div class="discount_final_price">¥20</div><div class="discount_pct">-80%</div></a>`;
    const html = `<div id="search_resultsRows">${Array.from({ length: 50 }, (_, i) => card(i + 1)).join('')}</div>`;
    const parsed = await page.evaluate(parseDocument, html);
    assert.equal(parsed.appIds.length, 50);
    assert.equal(parsed.cards[49].currentPrice, '¥20');
    await assert.rejects(page.evaluate(parseDocument, '<html></html>'), /CARDS_MISSING/);
    await assert.rejects(page.evaluate(parseDocument, html.replace('store.steampowered.com', 'example.org')), /CARD_DOMAIN_REJECTED/);
    await assert.rejects(page.evaluate(parseDocument, html.replace('¥20', '$20')), /CARD_CNY_PRICE_MISSING/);
  } finally { await browser.close(); }
});
