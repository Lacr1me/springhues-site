import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as ops from './daily-operations.mjs';
import { makeReadyFixture } from './state-evidence-fixtures.mjs';
import { publishChannel } from './publish-channel.mjs';

const base=await mkdtemp(path.join(os.tmpdir(),'springhues-c-integration-'));
console.log(`Integration fixtures retained: ${base}`);
const boundaries=['journal:prepared:staged','journal:prepared','state:publishing','body:written','journal:body:staged','journal:body','state:body','index:staged','index:written','journal:index:staged','journal:index','state:index','embedded:staged','embedded:written','journal:embedded:staged','journal:embedded','state:embedded','state:published','journal:complete:staged','journal:complete'];
let passed=0;
for(const channel of ['game','minsheng']) {
  for(const boundary of boundaries.filter(item=>channel==='game'||!item.includes('embedded'))) {
    const f=await makeReadyFixture(path.join(base,boundary.replaceAll(':','-')),channel);
    await ops.createReadyProof(f.root,f);
    const stateFile=ops.operationPaths(f.root,f.date).state;
    const other=channel==='game'?'minsheng':'game';
    const otherBefore=JSON.parse(await readFile(stateFile)).channels[other];
    await assert.rejects(publishChannel({...f,afterBoundary:async step=>{if(step===boundary)throw new Error('INJECTED');}}),/INJECTED/);
    const recovered=await publishChannel(f);
    assert.equal(recovered.status,'complete');
    assert.equal((await publishChannel(f)).status,'complete');
    const state=JSON.parse(await readFile(stateFile));
    assert.equal(state.channels[channel].published,true);
    assert.equal(state.channels[channel].publication.step,'complete');
    assert.deepEqual(state.channels[other],otherBefore);
    const view=await ops.queryRunState(f.root,f.date,{channel,now:f.now});
    assert.equal(view.channels[channel].archive.valid,true);
    assert.equal(view.channels[channel].online.valid,false);
    const body=await readFile(ops.archiveContentPath(f.root,f.date,channel));
    await assert.rejects(publishChannel({...f,runId:'intruder'}),{code:'LEASE_MISMATCH'});
    await assert.rejects(publishChannel({...f,now:new Date(f.date+'T10:59:59+08:00')}));
    await writeFile(f.publicPng,Buffer.from('changed'));
    await assert.rejects(publishChannel(f),/CONFLICT/);
    assert.deepEqual(await readFile(ops.archiveContentPath(f.root,f.date,channel)),body);
    passed++;
  }
}
console.log(`Actual B preflight/state + C publication: ${passed} interrupted boundaries recovered idempotently; wrong lease/time/PNG rejected; other channel retained. Synthetic source/render/visual fixtures only.`);
for(const first of ['game','minsheng']) {
  const shared=path.join(base,`shared-${first}`);
  const successful=await makeReadyFixture(base,first,process.cwd(),{root:shared});
  await ops.createReadyProof(shared,successful);
  await publishChannel(successful);
  const files=[ops.archiveContentPath(shared,successful.date,first),successful.publicPng,path.join(path.dirname(ops.archiveContentPath(shared,successful.date,first)),'index.json')];
  if(first==='game') files.push(path.join(shared,'data/embedded.js'));
  const before=await Promise.all(files.map(file=>readFile(file)));
  const successfulState=JSON.parse(await readFile(ops.operationPaths(shared,successful.date).state)).channels[first];
  const other=first==='game'?'minsheng':'game';
  const f=await makeReadyFixture(base,other,process.cwd(),{root:shared});
  await ops.createReadyProof(shared,f);
  await assert.rejects(publishChannel({...f,afterBoundary:async step=>{if(step==='index:written')throw new Error('INJECTED_OTHER_CHANNEL');}}),/INJECTED/);
  assert.deepEqual(await Promise.all(files.map(file=>readFile(file))),before);
  await publishChannel(f);
  assert.deepEqual(await Promise.all(files.map(file=>readFile(file))),before);
  assert.deepEqual(JSON.parse(await readFile(ops.operationPaths(shared,f.date).state)).channels[first],successfulState);
}
console.log('Shared root: either successful channel stays byte-identical while the other interrupts and recovers.');
for(const channel of ['game','minsheng']) {
  const f=await makeReadyFixture(path.join(base,'lease-expires'),channel);
  await ops.createReadyProof(f.root,f);
  const now=new Date(f.now);
  await assert.rejects(publishChannel({...f,now,afterBoundary:async step=>{
    if(step==='index:staged') now.setTime(Date.parse(f.date+'T13:00:00+08:00'));
  }}),{code:'LEASE_EXPIRED'});
  const indexFile=path.join(path.dirname(ops.archiveContentPath(f.root,f.date,channel)),'index.json');
  assert.equal(JSON.parse(await readFile(indexFile)).editions.length,0,'Expired lease must not commit staged index');
  const lease=await ops.acquireRunLease(f.root,{date:f.date,runId:'recovery-owner',now});
  assert.equal(lease.acquired,true);
  assert.equal((await publishChannel({...f,now,runId:'recovery-owner'})).status,'complete');
}
console.log('Lease expiration between staging and rename blocks index commit; new lease owner resumes the same transaction.');
