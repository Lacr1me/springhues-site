import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { collectLivePageEvidence } from './collect-live-page-evidence.mjs';
import { verifyPageEvidence, sha256 } from './health-lib.mjs';

test('real local Edge verifies both channels, archive flows and downloaded bytes; altered download fails closed', async () => {
  const root = process.cwd();
  let corruptDownload = false;
  const server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(root + path.sep)) throw new Error('Outside test root');
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.end(corruptDownload && pathname.startsWith('/downloads/') ? Buffer.from('wrong PNG bytes') : await readFile(file));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const directory = path.join(root, 'output', `page-evidence-test-${process.pid}`);
  const saved = [];
  try {
    for (const channel of ['game', 'minsheng']) {
      const file = channel === 'game' ? 'data/index.json' : 'data/minsheng/index.json';
      const manifest = JSON.parse(await readFile(path.join(root, file), 'utf8'));
      const date = manifest.editions.filter(item => Date.parse(item.publishAt) <= Date.now()).sort((a, b) => b.date.localeCompare(a.date))[0].date;
      const out = path.join(directory, `${channel}.json`);
      const result = await collectLivePageEvidence({ channel, date, base, out });
      saved.push(out);
      verifyPageEvidence(result.pages[channel], { url: `${base}/${channel}/?date=${date}`, date, channel, checkedAt: result.checkedAt });
      const expectedPng = await readFile(path.join(root, 'downloads', channel, `${date}.png`));
      assert.equal(result.acceptance.download.sha256, sha256(expectedPng));
      assert.equal(result.acceptance.download.width, 3840);
      assert.equal(result.acceptance.latest.displayedDate, date);
      assert.equal(result.acceptance.invalidDateFallback.selectedDate, date);
      assert.equal(result.acceptance.futureDateFallback.selectedDate, date);
      assert.equal(result.acceptance.archivePicker.selectedDate, date);
      assert.equal(new URL(result.acceptance.portal.url).pathname, `/${channel}/`);
      assert.deepEqual(JSON.parse(await readFile(out, 'utf8')), result);
      corruptDownload = true;
      const failedOut = path.join(directory, `${channel}-rejected.json`);
      await assert.rejects(collectLivePageEvidence({ channel, date, base, out: failedOut }), /PNG_HASH_MISMATCH/);
      await assert.rejects(readFile(failedOut), { code: 'ENOENT' });
      corruptDownload = false;
    }
    await assert.rejects(collectLivePageEvidence({ channel: 'minsheng', date: '9999-12-31', base, out: path.join(directory, 'future.json') }), /EDITION_NOT_PUBLISHED/);
    await assert.rejects(collectLivePageEvidence({ channel: 'minsheng', date: '2026-09-29', base, out: 'artifacts/operations/forbidden.json' }), /OUTPUT_REJECTED/);
    await assert.rejects(collectLivePageEvidence({ channel: 'minsheng', date: '2026-09-29', base: 'https://example.org', out: path.join(directory, 'other-site.json') }), /SITE_REJECTED/);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const file of saved) await unlink(file);
    if (saved.length) await rmdir(directory);
  }
});
