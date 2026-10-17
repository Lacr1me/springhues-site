import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runDailyHealth } from './check-daily-health.mjs';
import { materializeArchiveSeed } from './state-evidence-fixtures.mjs';
// 归档只保留最近 7 期：用固定夹具期次（含 2026-09-10）作为被检查的站点根目录。
const root = await materializeArchiveSeed(await mkdtemp(path.join(os.tmpdir(), 'health-evidence-')));
const date = '2026-09-10';
const checkedAt = '2026-09-11T01:00:00.000Z';
const targetCommit = 'a'.repeat(40);
const base = 'https://isolated.test';
const requests = [];
const fetchImpl = async input => {
  const url = new URL(input); requests.push(url.pathname);
  if (['/', '/game/', '/minsheng/'].includes(url.pathname)) return new Response('<html>static shell</html>');
  const bytes = await readFile(path.join(root, url.pathname.slice(1)));
  return new Response(bytes, { headers: { 'content-type': url.pathname.endsWith('.png') ? 'image/png' : 'application/json' } });
};
// Synthetic browser/API evidence only tests evidence validation, not real rendering.
const pageProbe = async ({url, date, channel}) => ({ method: 'browser', checkedAt, url,
  displayedDate: date, selectedDate: date, downloadUrl: `${base}/downloads/${channel}/${date}.png` });
const deploymentProof = { source: 'github-pages-api', checkedAt, headSha: targetCommit, conclusion: 'success',
  siteUrl: base, evidenceUrl: 'https://api.github.com/repos/example/site/pages/builds/1' };
const options = { root, date, checkedAt, targetCommit, liveBase: base, fetchImpl, pageProbe, deploymentProof };
const good = await runDailyHealth({...options, channel:'game'});
assert.equal(good.healthy, true);
assert.deepEqual(Object.keys(good.channels), ['game']);
assert(!requests.some(x => x.includes('minsheng')));
const noProof = await runDailyHealth({root,date,channel:'game',liveBase:base,fetchImpl,checkedAt,targetCommit});
assert.equal(noProof.healthy, false, 'HTTP and correct JSON/PNG alone cannot prove rendering/deployment');
const wrongPng = await runDailyHealth({...options, channel:'game', fetchImpl:async url => {
  if (new URL(url).pathname.endsWith('.png')) {
    const bytes = Buffer.from(await (await fetchImpl(url)).arrayBuffer()); bytes[bytes.length-1] ^= 1;
    return new Response(bytes,{headers:{'content-type':'image/png'}});
  } return fetchImpl(url);
}});
assert.equal(wrongPng.live.game.png.valid,false);
const wrongDate = await runDailyHealth({...options,channel:'game',pageProbe:async args=>({...await pageProbe(args),displayedDate:'2026-09-09'})});
assert.equal(wrongDate.live.game.page.valid,false);
const oldJson = await runDailyHealth({...options,channel:'game',fetchImpl:async url=>{
  if(new URL(url).pathname === `/data/${date}.json`) { const brief=await (await fetchImpl(url)).json(); brief.issue += 1; return Response.json(brief); }
  return fetchImpl(url);
}});
assert.equal(oldJson.live.game.content.valid,false);
const wrongCommit = await runDailyHealth({...options,channel:'game',deploymentProof:{...deploymentProof,headSha:'b'.repeat(40)}});
assert.equal(wrongCommit.live.game.deployment.valid,false);
const stale = await runDailyHealth({...options,channel:'game',deploymentProof:{...deploymentProof,checkedAt:'2026-09-10T01:00:00.000Z'}});
assert.equal(stale.live.game.deployment.valid,false);
const unrelatedPage = await runDailyHealth({...options,channel:'game',pageProbe:async args=>({...await pageProbe(args),url:'https://another.test/game/?date='+date})});
assert.equal(unrelatedPage.live.game.page.valid,false);
const unpublished = await runDailyHealth({...options,channel:'game',checkedAt:date+'T10:59:59+08:00'});
assert.equal(unpublished.local.game.content.valid,false);
const mixed = await runDailyHealth({...options,pageProbe:async args=>({...await pageProbe(args),displayedDate:args.channel==='game'?date:'2026-09-09'})});
assert.equal(mixed.channels.game.healthy,true); assert.equal(mixed.channels.minsheng.healthy,false); assert.equal(mixed.healthy,false);
const mirror = await runDailyHealth({...options,channel:'game',mirror:{game:{status:'failed',reason:'offline'}}});
assert.equal(mirror.healthy,true); assert.equal(mirror.mirror.game.status,'failed');
console.log('Health evidence tests passed (injected HTTP/browser/API evidence; no production access).');
