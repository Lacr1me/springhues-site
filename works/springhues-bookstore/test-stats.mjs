import test from 'node:test';
import assert from 'node:assert/strict';
import { loadStats, parseCount } from './src/stats.js';

const RAW = 'https://springhues.goatcounter.com/counter/TOTAL.json';
const PROXY = 'https://etkjbxfdwmhqmuyzpttq.supabase.co/functions/v1/scene-stats';
const SNAPSHOT = 'https://springhues.com/data/scene-stats.json';
const NOW = () => new Date('2026-10-19T12:00:00Z');
const response = data => ({ ok: true, status: 200, json: async () => data });
const unavailable = () => ({ ok: false, status: 503, json: async () => ({}) });

function fixture(url) {
  if (url === RAW) return { count: '1,234', count_unique: '1,234' };
  if (url === RAW + '?start=week') return { count: '12', count_unique: '12' };
  if (url === RAW + '?start=month') return { count: '34', count_unique: '34' };
  if (url.endsWith('/site/works.json')) return { works: [{ slug: 'one' }, { slug: 'two' }] };
  if (url.endsWith('/data/index.json')) return { editions: [
    { date: '2026-10-18', publishAt: '2026-10-18T11:00:00+08:00' },
    { date: '2026-10-20', publishAt: '2026-10-20T11:00:00+08:00' },
  ] };
  if (url.endsWith('/data/minsheng/index.json')) return { editions: [{ date: '2026-10-19' }] };
  throw new Error('Unexpected request: ' + url);
}

test('strict counts preserve real zero and parse comma formatting without coercing missing values', () => {
  for (const [input, expected] of [[0, 0], ['0', 0], [12, 12], ['1,234', 1234], [' 12,345,678 ', 12345678]]) {
    assert.equal(parseCount(input), expected);
  }
  for (const invalid of [null, undefined, false, true, '', ' ', [], {}, '1.5', -1, 1.5, NaN, Infinity,
    '1e3', '1,23', '1,234,56', '-1', '+1', '00', '0x10', Number.MAX_SAFE_INTEGER + 1, '9007199254740992']) {
    assert.equal(parseCount(invalid), null, 'must reject ' + String(invalid));
  }
});

test('primary data uses one metric, bounded anonymous GETs and published catalog records', async () => {
  const requests = [];
  let active = 0, peak = 0;
  const result = await loadStats({ now: NOW, fetchImpl: async (url, options) => {
    requests.push({ url, options }); active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 2));
    active--;
    return response(fixture(url));
  } });
  assert.equal(result.status, 'live'); assert.equal(result.source, 'goatcounter');
  assert.equal(result.visitors, 1234); assert.equal(result.sourceUpdatedAt, null);
  assert.deepEqual(result.periods, { week: 12, month: 34 }); assert.equal(result.trend, null);
  assert.deepEqual(result.catalog, { works: 2, archives: 2, latestDate: '2026-10-19' });
  assert.equal(result.fetchedAt, NOW().toISOString()); assert.match(result.cacheHint, /4 小时/);
  assert.equal(requests.length, 6); assert.ok(peak <= 4);
  for (const { url, options } of requests) {
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.ok(options.signal);
    assert.ok(!url.endsWith('/count') && !url.includes('count.js'));
  }
});

test('count_unique is not treated as another metric or used to replace malformed count', async () => {
  const result = await loadStats({ now: NOW, fetchImpl: async url => {
    if (url === RAW) return response({ count: '1,234', count_unique: '9,999' });
    return response(fixture(url));
  } });
  assert.equal(result.visitors, 1234);
  assert.equal(Object.hasOwn(result, 'visits'), false);
});

test('primary failure falls back to existing read-only API without mixing period sources', async () => {
  const requests = [];
  const result = await loadStats({ now: NOW, fetchImpl: async url => {
    requests.push(url);
    if (url === RAW) return response({ count: null, count_unique: '99' });
    if (url === PROXY) return response({ visitors: 7, visits: 7, updated: '2026-10-19T10:00:00Z' });
    return response(fixture(url));
  } });
  assert.equal(result.source, 'public-api'); assert.equal(result.visitors, 7);
  assert.equal(result.sourceUpdatedAt, '2026-10-19T10:00:00.000Z');
  assert.equal(result.periods, null); assert.ok(!requests.includes(SNAPSHOT));
});

test('snapshot fallback preserves its own timestamp and is marked as a snapshot', async () => {
  const result = await loadStats({ now: NOW, fetchImpl: async url => {
    if (url === RAW) return unavailable();
    if (url === PROXY) return response({ visitors: false });
    if (url === SNAPSHOT) return response({ visitors: '0', updated: '2026-10-18T18:10:31Z' });
    return response(fixture(url));
  } });
  assert.equal(result.status, 'snapshot'); assert.equal(result.visitors, 0);
  assert.equal(result.source, 'static-snapshot'); assert.equal(result.sourceUpdatedAt, '2026-10-18T18:10:31.000Z');
});

test('unavailable sources remain unknown rather than invented zeroes', async () => {
  const result = await loadStats({ now: NOW, fetchImpl: async () => unavailable() });
  assert.equal(result.status, 'unavailable'); assert.equal(result.visitors, null);
  assert.equal(result.source, null); assert.equal(result.periods, null);
  assert.deepEqual(result.catalog, { works: null, archives: null, latestDate: null });
});

test('one missing period or catalog channel remains partial without fabricating the rest', async () => {
  const result = await loadStats({ now: NOW, fetchImpl: async url => {
    if (url === RAW + '?start=week' || url.endsWith('/data/minsheng/index.json')) return unavailable();
    return response(fixture(url));
  } });
  assert.deepEqual(result.periods, { week: null, month: 34 });
  assert.equal(result.catalog.archives, null); assert.equal(result.catalog.works, 2);
});

test('pre-cancelled refresh makes no request', async () => {
  const controller = new AbortController(); controller.abort();
  let calls = 0;
  await assert.rejects(loadStats({ signal: controller.signal, fetchImpl: async () => { calls++; return unavailable(); } }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('cancellation interrupts in-flight fetches and prevents queued requests or fallback', async () => {
  const controller = new AbortController();
  let calls = 0;
  const pending = loadStats({ signal: controller.signal, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  assert.equal(calls, 4);
});

test('each request times out even when transport ignores abort and the total request count stays bounded', async () => {
  let calls = 0;
  const result = await loadStats({ now: NOW, timeoutMs: 10, fetchImpl: () => { calls++; return new Promise(() => {}); } });
  assert.equal(result.status, 'unavailable'); assert.equal(calls, 8);
});
