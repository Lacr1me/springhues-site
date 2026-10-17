import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
await import('../portal-data.js');
const { parseCatalog, latestEdition, publishedEditions, resourceUrl, matchesResource, validId } = globalThis.SpringhuesPortalData;
const fixture = JSON.parse(await readFile(new URL('./portal-resources.fixture.json', import.meta.url), 'utf8'));
let checks = 0;
function check(name, fn) {
  fn();
  checks++;
  console.log('PASS ' + name);
}
const withResource = override => ({ schemaVersion: 1, resources: [{ ...fixture.resources[0], ...override }] });
check('empty catalog is valid and fixtures normalize to known categories', () => {
  assert.deepEqual(parseCatalog({ schemaVersion: 1, resources: [] }), []);
  const resources = parseCatalog(fixture);
  assert.equal(resources.length, 3);
  assert.equal(resources[0].categoryLabel, '软件工具');
  assert.equal(resources[0].statusLabel, '示例项目');
});
check('IDs are bounded and cannot become selectors or duplicate entries', () => {
  for (const id of ['', 'a" onclick="x', 'x]#a', 'x'.repeat(65), 'a--b', '__proto__']) assert.equal(validId(id), false);
  assert.throws(() => parseCatalog({ schemaVersion: 1, resources: [fixture.resources[0], fixture.resources[0]] }));
});
check('required fields, categories and list types fail visibly', () => {
  for (const override of [{ title: '' }, { category: '__proto__' }, { status: 'confirmed-maybe' }, { features: '<img>' }, { requirements: [4] }, { updatedAt: '2026-02-30' }]) {
    assert.throws(() => parseCatalog(withResource(override)));
  }
  assert.throws(() => parseCatalog({ schemaVersion: 2, resources: [] }));
});
check('links accept local files or HTTPS and reject active, ambiguous and admin links', () => {
  assert.equal(resourceUrl('https://example.com/release.zip'), 'https://example.com/release.zip');
  assert.equal(resourceUrl('./downloads/resources/tool.zip'), '/downloads/resources/tool.zip');
  assert.equal(resourceUrl(null), null);
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'http://example.com/a', '//example.com/a', 'relative.zip', 'https://user:pass@example.com/a', '/admin/messages/', 'https://springhues.com/admin/messages/', ' https://example.com', '/\\example.com']) {
    assert.throws(() => resourceUrl(url), url);
  }
  assert.throws(() => parseCatalog(withResource({ downloadUrl: '/downloads/resources/example.zip' })));
  assert.throws(() => parseCatalog(withResource({ filename: '../bad.zip' })));
});
check('draft and scheduled resources stay hidden until eligible', () => {
  const now = Date.parse('2026-10-17T10:59:59+08:00');
  const data = withResource({ status: 'published', publishAt: '2026-10-17T11:00:00+08:00' });
  assert.equal(parseCatalog(data, { now }).length, 0);
  assert.equal(parseCatalog(data, { now: now + 1000 }).length, 1);
  assert.equal(parseCatalog(withResource({ status: 'draft' }), { now }).length, 0);
  assert.equal(parseCatalog(withResource({ status: 'draft' }), { now, includeUnpublished: true }).length, 1);
  assert.throws(() => parseCatalog(withResource({ publishAt: '2026-10-17T11:00:00' })));
});
check('archive selection uses canonical dates, actual time and latest date', () => {
  const data = { editions: [
    { date: '2026-10-17', publishAt: '2026-10-17T11:00:00+08:00' },
    { date: '2026-10-15', publishAt: '2026-10-15T11:00:00+08:00' },
    { date: '2026-10-16', publishAt: '2026-10-16T11:00:00+08:00' },
    { date: '2026-02-30', publishAt: '2026-02-30T11:00:00+08:00' },
    { date: '2027-10-18', publishAt: '2026-10-16T11:00:00+08:00' },
    { date: '2026-10-18', publishAt: 'bad' }
  ] };
  assert.equal(latestEdition(data, Date.parse('2026-10-17T10:59:59+08:00')).date, '2026-10-16');
  assert.equal(latestEdition(data, Date.parse('2026-10-17T11:00:00+08:00')).date, '2026-10-17');
  assert.equal(latestEdition({ editions: [] }), null);
  assert.throws(() => latestEdition({ editions: 'invalid' }));
});
check('publishedEditions counts only editions already past 11:00 publishAt', () => {
  const data = { editions: [
    { date: '2026-10-17', publishAt: '2026-10-17T11:00:00+08:00' },
    { date: '2026-10-16', publishAt: '2026-10-16T11:00:00+08:00' },
    { date: '2026-10-15', publishAt: '2026-10-15T10:00:00+08:00' },
    { date: '2026-10-14', publishAt: '2026-10-14T11:00:00' },
    { date: '2026-10-13', publishAt: '2026-10-12T11:00:00+08:00' },
    { date: '2026-10-12', publishAt: '2026-10-12T11:00:00+08:00' }
  ] };
  assert.deepEqual(publishedEditions(data, Date.parse('2026-10-17T10:59:59+08:00')).map(e => e.date), ['2026-10-16', '2026-10-12']);
  assert.deepEqual(publishedEditions(data, Date.parse('2026-10-17T11:00:00+08:00')).map(e => e.date), ['2026-10-17', '2026-10-16', '2026-10-12']);
  assert.throws(() => publishedEditions({ editions: 'invalid' }));
  assert.equal(latestEdition(data, Date.parse('2026-10-17T11:00:00+08:00')).date, publishedEditions(data, Date.parse('2026-10-17T11:00:00+08:00'))[0].date);
});
check('search covers features and requires every keyword', () => {
  const item = parseCatalog(fixture)[0];
  assert.equal(matchesResource(item, '暂停 下载'), true);
  assert.equal(matchesResource(item, '暂停 阅读'), false);
});
console.log('Portal data checks passed: ' + checks);
