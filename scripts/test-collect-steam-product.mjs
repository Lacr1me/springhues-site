import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPlaywright } from './collect-steam-discovery.mjs';
import { assertProductSource, parseProduct } from './collect-steam-product.mjs';

test('product requests reject other products, domains, mutations and wrong region', () => {
  const url = 'https://store.steampowered.com/app/447040/?cc=cn&l=schinese';
  assert.doesNotThrow(() => assertProductSource(url, '447040'));
  for (const bad of [url.replace('447040', '123'), url.replace('store.steampowered.com', 'example.org'), url.replace('cc=cn', 'cc=us'), url + '&x=1']) assert.throws(() => assertProductSource(bad, '447040'));
  assert.throws(() => assertProductSource(url, '447040', 'POST'));
});

test('sale timestamp is tied to each purchase box, missing dates remain missing', async () => {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    const box = timer => `<div class="game_area_purchase_game"><h1>Buy base game</h1><div class="discount_block" data-discount="90"><span class="discount_original_price">¥100</span><span class="discount_final_price">¥10</span></div>${timer}</div>`;
    const html = `<div id="appHubAppName">Game</div>${box('<script>InitDailyDealTimer("timer",1790874000);</script>')}${box('')}`;
    const parsed = await page.evaluate(parseProduct, { html, appId: '447040' });
    assert.equal(parsed.offers[0].saleEndUnix, 1790874000);
    assert.equal(parsed.offers[1].saleEndStatus, 'missing');
    assert.equal(parsed.offers[1].saleEndUnix, null);
    assert.equal(parsed.historicalPriceVerified, false);
    await assert.rejects(page.evaluate(parseProduct, { html: '<html>age gate</html>', appId: '447040' }), /PRODUCT_MISSING/);
    await assert.rejects(page.evaluate(parseProduct, { html: html.replaceAll('¥', '$'), appId: '447040' }), /NON_CNY/);
    await assert.rejects(page.evaluate(parseProduct, { html: '<div id="application_config" data-config=\'{"COUNTRY":"US","LANGUAGE":"schinese"}\'></div>' + html, appId: '447040' }), /RESPONSE_REGION_REJECTED/);
  } finally { await browser.close(); }
});
