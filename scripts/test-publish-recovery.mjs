import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

// Retain isolated fixtures as interruption evidence; never touch production data.
const root = await mkdtemp(path.join(os.tmpdir(), 'springhues-c-recovery-'));
console.log(`Fixtures retained: ${root}`);
const { runPublishTransaction } = await import('./publish-transaction.mjs');
const date = '2026-09-11';
const boundaries = ['journal:prepared:staged','journal:prepared', 'state:publishing', 'body:written', 'journal:body:staged','journal:body','state:body', 'index:staged','index:written', 'journal:index:staged','journal:index','state:index', 'embedded:staged','embedded:written', 'journal:embedded:staged','journal:embedded','state:embedded', 'state:published', 'journal:complete:staged','journal:complete'];
for (const channel of ['game', 'minsheng']) {
  for (const boundary of boundaries.filter(x => channel === 'game' || !x.includes('embedded'))) {
    const dir = path.join(root, channel, boundary.replaceAll(':', '-'));
    const data = channel === 'game' ? 'data' : 'data/minsheng';
    await mkdir(path.join(dir, data), { recursive: true });
    await mkdir(path.join(dir, 'data/.pending', channel === 'game' ? '' : channel), { recursive: true });
    await mkdir(path.join(dir, 'downloads', channel), { recursive: true });
    const pending = path.join(dir, 'data/.pending', channel === 'game' ? '' : channel, `${date}.json`);
    await writeFile(pending, JSON.stringify({ date, issue: 1 }));
    await writeFile(path.join(dir, data, 'index.json'), JSON.stringify({ editions: [] }));
    await writeFile(path.join(dir, 'downloads', channel, `${date}.png`), 'fixture-png');
    let state = '';
    const options = { root: dir, date, channel, runId: 'test',
      preflight: async () => ({ valid: true }),
      updateState: async info => { state = info.status; },
      validateCandidate: async () => {},
      makeEdition: brief => ({ date, issue: brief.issue, publishAt: `${date}T11:00:00+08:00`, file: `${data}/${date}.json` }) };
    await assert.rejects(runPublishTransaction({ ...options, afterBoundary: async name => { if (name === boundary) throw new Error('injected'); } }), /injected/);
    const recovered = await runPublishTransaction(options);
    assert.equal(recovered.status, 'complete');
    assert.equal(state, 'published');
    const manifest = JSON.parse(await readFile(path.join(dir, data, 'index.json'), 'utf8'));
    assert.equal(manifest.editions.length, 1);
    const again = await runPublishTransaction(options);
    assert.equal(again.status, 'complete');
    assert.equal(JSON.parse(await readFile(path.join(dir, data, `${date}.json`), 'utf8')).issue, 1);
    await assert.rejects(runPublishTransaction({...options,preflight:async()=>({valid:false,errors:['lease expired']})}), /PREFLIGHT_FAILED/);
    await writeFile(path.join(dir,'downloads',channel,`${date}.png`),'changed-png');
    await assert.rejects(runPublishTransaction(options), /CONFLICT/);
    await writeFile(path.join(dir,'downloads',channel,`${date}.png`),'fixture-png');
    const indexBytes=await readFile(path.join(dir,data,'index.json'));
    await writeFile(path.join(dir,data,'index.json'),JSON.stringify({...manifest,unexpected:'another publisher'}));
    await assert.rejects(runPublishTransaction(options), /CONFLICT/);
    await writeFile(path.join(dir,data,'index.json'),indexBytes);
    const journalFile=path.join(dir,'artifacts/operations',`${date}-${channel}-publish-transaction.json`);
    const journalBytes=await readFile(journalFile), journal=JSON.parse(journalBytes);
    journal.manifestAfter.editions[0].issue=99;
    await writeFile(journalFile,JSON.stringify(journal));
    await assert.rejects(runPublishTransaction(options), /CONFLICT/);
    await writeFile(journalFile,journalBytes);
    await writeFile(pending, JSON.stringify({ date, issue: 99 }));
    await assert.rejects(runPublishTransaction(options), /CONFLICT/);
  }
}
console.log('Publish interruption recovery and conflict tests passed.');
