import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as ops from './daily-operations.mjs';

const base = await mkdtemp(path.join(os.tmpdir(), 'springhues-b-evidence-'));
console.log(`保留隔离夹具：${base}`);
let failures = 0;
async function test(name, fn) {
  try { await fn(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}: ${error.stack}`); }
}
const date = '2026-09-01';
const now = new Date('2026-09-01T07:00:00+08:00');
async function fixture(name) {
  const root = path.join(base, name);
  await ops.acquireRunLease(root, { date, runId: '0700', now });
  await ops.initializeRunState(root, { date, runId: '0700', now });
  return root;
}
const entry = { date, runId: '0700', channel: 'minsheng', section: 'domestic', sourceId: 'xinhua', status: 'accepted', candidateIds: ['one'], availableCount: 1, now };
await test('撤销 accepted 后当前候选减少且重复撤销幂等', async () => {
  const root = await fixture('revoke');
  await ops.appendResearchLedger(root, entry);
  await ops.appendResearchLedger(root, { ...entry, candidateIds: [], availableCount: 0, revokedCandidateIds: ['one'], reasons: ['duplicate'] });
  await ops.appendResearchLedger(root, { ...entry, candidateIds: [], availableCount: 0, revokedCandidateIds: ['one'], reasons: ['duplicate'] });
  assert.equal((await ops.researchCompleteness(root, date, 'minsheng')).sections.domestic.candidateCount, 0);
});
await test('相同更新不追加重复账本', async () => {
  const root = await fixture('idempotence');
  await ops.appendResearchLedger(root, entry);
  await ops.appendResearchLedger(root, entry);
  assert.equal((await ops.readResearchLedger(root, date)).length, 1);
});
await test('无租约不得初始化共享状态', async () => {
  await assert.rejects(ops.initializeRunState(path.join(base, 'no-lease'), { date, runId: '0700', now }), { code: 'LEASE_REQUIRED' });
});
await test('checkpoint 拒绝未知枚举', async () => {
  const root = await fixture('checkpoint');
  await assert.rejects(ops.checkpointRunState(root, date, { runId: '0700', stage: 'whatever', now }), { code: 'INVALID_CHECKPOINT' });
});
await test('迟于八点创建冻结必须失败', async () => {
  const root = await fixture('freeze-late');
  await ops.acquireRunLease(root, { date, runId: '0700', now: new Date('2026-09-01T09:00:00+08:00') });
  await assert.rejects(ops.freezeSteamDiscovery(root, { date, runId: '0700', sourceUrl: 'https://store.steampowered.com/search/?specials=1', appIds: ['100','101','102','103','104','105'], now: new Date('2026-09-01T09:00:00+08:00') }));
});
await test('冻结文件存在但日期错误不算完成', async () => {
  const root = await fixture('freeze-corrupt');
  await writeFile(ops.operationPaths(root, date).steamDiscovery, JSON.stringify({ date: 'wrong', frozen: true }));
  assert.equal((await ops.researchCompleteness(root, date, 'game')).sections.deals.frozenDiscoveryComplete, false);
});
await test('查询旧状态不写文件且给出证据缺失', async () => {
  const root = await fixture('query');
  const statePath = ops.operationPaths(root, date).state;
  await writeFile(statePath, JSON.stringify({ date, channels: { game: { status: 'ready' } } }));
  const before = await readFile(statePath);
  const result = await ops.queryRunState(root, date, { channel: 'game', now });
  assert.equal(result.channels.game.readiness.valid, false);
  assert.deepEqual(Object.keys(result.channels), ['game']);
  assert.deepEqual(await readFile(statePath), before);
});

await test('租约到期与错误持有人均拒绝写入', async () => {
  const root=await fixture('expired');
  await assert.rejects(ops.checkpointRunState(root,date,{runId:'other',now}),{code:'LEASE_MISMATCH'});
  await assert.rejects(ops.checkpointRunState(root,date,{runId:'0700',now:new Date('2026-09-01T10:00:00+08:00')}),{code:'LEASE_EXPIRED'});
});
await test('冻结后篡改内容和身份被识别', async () => {
  const root=await fixture('freeze-hash');
  const snapshot=await ops.freezeSteamDiscovery(root,{date,runId:'0700',now,sourceUrl:'https://store.steampowered.com/search/?specials=1',appIds:['100','101','102','103','104','105']});
  snapshot.appIds[0]='999';
  await writeFile(ops.operationPaths(root,date).steamDiscovery,JSON.stringify(snapshot));
  await assert.rejects(ops.inspectSteamDiscovery(root,date),{code:'FREEZE_CHANGED'});
  assert.equal((await ops.researchCompleteness(root,date,'game')).sections.deals.frozenDiscoveryComplete,false);
});
await test('旧布尔证据不能闭环；逐项证据更新与淘汰生效', async () => {
  const root=await fixture('evidence-update');
  await ops.appendResearchLedger(root,{...entry,evidenceComplete:true});
  assert.equal((await ops.researchCompleteness(root,date,'minsheng')).sections.domestic.evidenceComplete,false);
  const evidence={id:'one',decision:'accepted',url:'https://example.test/one',checkedAt:now.toISOString(),basis:'fixture',facts:{title:'one'}};
  await ops.appendResearchLedger(root,{...entry,candidateEvidence:[evidence]});
  assert.equal((await ops.researchCompleteness(root,date,'minsheng')).sections.domestic.evidenceComplete,true);
  await ops.appendResearchLedger(root,{...entry,candidateIds:[],candidateEvidence:[{...evidence,decision:'rejected',basis:'stale source'}]});
  assert.equal((await ops.researchCompleteness(root,date,'minsheng')).sections.domestic.candidateCount,0);
});
await test('相同 eventId 不允许改变历史内容', async () => {
  const root=await fixture('event-conflict');
  await ops.appendResearchLedger(root,{...entry,eventId:'fixed'});
  const before=await readFile(ops.operationPaths(root,date).ledger);
  await assert.rejects(ops.appendResearchLedger(root,{...entry,eventId:'fixed',candidateIds:['two']}),{code:'LEDGER_CONFLICT'});
  assert.deepEqual(await readFile(ops.operationPaths(root,date).ledger),before);
});
await test('退出原因区分配置预算和真实环境边界', async () => {
  const root=await fixture('budget');
  await assert.rejects(ops.checkpointRunState(root,date,{runId:'0700',runStatus:'complete',exitReason:'ENVIRONMENT_LIMIT',budget:{kind:'configured',deadlineAt:now.toISOString(),basis:'25 minutes'},now}),{code:'INVALID_CHECKPOINT'});
  await assert.rejects(ops.checkpointRunState(root,date,{runId:'0700',runStatus:'complete',exitReason:'CONFIGURED_BUDGET',budget:{kind:'configured',deadlineAt:now.toISOString(),basis:'lease TTL 1500 seconds'},now}),{code:'BUDGET_UNCONFIGURED'});
  await mkdir(path.join(root,'config'),{recursive:true});
  await writeFile(path.join(root,'config','daily-execution-policy.json'),JSON.stringify({schemaVersion:1,configuredBudgetMinutes:25}));
  const budget={kind:'configured',deadlineAt:'2026-09-01T07:25:00+08:00',basis:'explicit fixture configuration',policyFile:'config/daily-execution-policy.json'};
  await assert.rejects(ops.checkpointRunState(root,date,{runId:'0700',runStatus:'complete',exitReason:'CONFIGURED_BUDGET',budget,now}),{code:'BUDGET_NOT_REACHED'});
  const state=await ops.checkpointRunState(root,date,{runId:'0700',runStatus:'complete',exitReason:'CONFIGURED_BUDGET',budget,now:new Date(budget.deadlineAt)});
  assert.equal(state.runs[0].exitReason,'CONFIGURED_BUDGET');
  assert.equal(state.channels.game.published,false);
});
await test('最后发布补跑未上线不得正常完成并静默退出', async () => {
  const root=path.join(base,'last-recovery');
  const started=new Date('2026-09-01T11:31:00+08:00');
  await ops.acquireRunLease(root,{date,runId:'1131',now:started,ttlSeconds:3000});
  await ops.initializeRunState(root,{date,runId:'1131',kind:'recovery',now:started});
  const ended=new Date('2026-09-01T11:58:00+08:00');
  await assert.rejects(ops.checkpointRunState(root,date,{runId:'1131',runStatus:'complete',exitReason:'HANDOFF_BOUNDARY',budget:{kind:'handoff',deadlineAt:ended.toISOString(),basis:'next day'},now:ended}),{code:'RECOVERY_INCOMPLETE'});
  const state=await ops.checkpointRunState(root,date,{runId:'1131',runStatus:'failed',exitReason:'HARD_BLOCKER',now:ended});
  assert.equal(state.runs[0].status,'failed');
  assert.equal(state.channels.game.published,false);
});
await test('历史原文补核保留真实复核时间并验证原文哈希', async () => {
  const root=await fixture('historical-source');
  const sourcePath='artifacts/operations/retained-source.json';
  const source=Buffer.from('retained source published on 2026-09-01');
  await writeFile(path.join(root,sourcePath),source);
  const evidence={id:'one',decision:'accepted',url:'https://example.test/one',checkedAt:'2026-09-02T01:00:00Z',basis:'actual next-day source recheck',facts:{title:'one'},historicalSourceProof:{editionDate:date,sourcePublishedAt:'2026-09-01T01:00:00Z',capturedAt:'2026-09-02T01:00:00Z',sourceUrl:'https://example.test/one',sourcePath,sourceSha256:createHash('sha256').update(source).digest('hex')}};
  await ops.appendResearchLedger(root,{...entry,candidateEvidence:[evidence]});
  await ops.assertRetainedSourceEvidence(root,evidence,date);
  const mod=structuredClone(evidence);mod.historicalSourceProof.sourcePublishedAt='2026-08-12T10:00:00+08:00';
  await ops.appendResearchLedger(root,{...entry,channel:'game',section:'mods',sourceId:'china-minecraft-mod-site',candidateEvidence:[mod]});
  assert.equal((await ops.researchCompleteness(root,date,'game')).sections.mods.evidenceComplete,true);
  await assert.rejects(ops.appendResearchLedger(root,{...entry,candidateEvidence:[mod]}),{code:'EVIDENCE_INVALID'});
  mod.historicalSourceProof.sourcePublishedAt='2026-08-01T10:00:00+08:00';
  await assert.rejects(ops.appendResearchLedger(root,{...entry,channel:'game',section:'mods',sourceId:'china-minecraft-mod-site',candidateEvidence:[mod]}),{code:'EVIDENCE_INVALID'});
  await writeFile(path.join(root,sourcePath),'changed');
  await assert.rejects(ops.assertRetainedSourceEvidence(root,evidence,date),{code:'EVIDENCE_CHANGED'});
});
await test('历史游戏复用前日快照限定栏目并绑定原始响应哈希', async () => {
  const root=await fixture('retained-game');
  const sourcePath='artifacts/operations/prior-pack-response.json',raw=Buffer.from('original 2026-08-31 snapshot: 200 downloads');
  await writeFile(path.join(root,sourcePath),raw);
  const proof={editionDate:date,channel:'game',section:'packs',sourceObservedAt:'2026-08-31T06:00:00+08:00',capturedAt:'2026-09-02T01:00:00Z',sourcePath,sourceSha256:createHash('sha256').update(raw).digest('hex')};
  const evidence={id:'prior-pack',decision:'accepted',url:'https://example.test/pack',checkedAt:proof.capturedAt,basis:'actual historical recheck of retained previous-day response',facts:{heatEvidenceAt:'2026-08-31',downloads:200},retainedResearchProof:proof};
  const record={date,runId:'0700',channel:'game',section:'packs',sourceId:'china-minecraft-site',status:'accepted',candidateIds:[evidence.id],availableCount:1,candidateEvidence:[evidence],now};
  await ops.appendResearchLedger(root,record);
  assert.equal((await ops.researchCompleteness(root,date,'game')).sections.packs.evidenceComplete,true);
  await ops.assertRetainedSourceEvidence(root,evidence,date,{channel:'game',section:'packs'});
  await assert.rejects(ops.appendResearchLedger(root,{...record,section:'deals',sourceId:'steam-cn'}),{code:'EVIDENCE_INVALID'});
  const stale=structuredClone(evidence);stale.retainedResearchProof.sourceObservedAt='2026-08-30T06:00:00+08:00';
  await assert.rejects(ops.appendResearchLedger(root,{...record,candidateEvidence:[stale]}),{code:'EVIDENCE_INVALID'});
  await writeFile(path.join(root,sourcePath),'changed');
  await assert.rejects(ops.assertRetainedSourceEvidence(root,evidence,date,{channel:'game',section:'packs'}),{code:'EVIDENCE_CHANGED'});
});
await test('历史补刊后仅空白未就绪频道可纠正下一期编号', async () => {
  const root=await fixture('next-issue');await mkdir(path.join(root,'data'),{recursive:true});
  await writeFile(path.join(root,'data/index.json'),JSON.stringify({editions:[{date:'2026-08-31',issue:5,file:'data/2026-08-31.json'}]}));
  await assert.rejects(ops.correctUnpublishedIssue(root,{date,runId:'0700',channel:'game',issue:7,now}),{code:'ISSUE_INVALID'});
  const state=await ops.correctUnpublishedIssue(root,{date,runId:'0700',channel:'game',issue:6,now});assert.equal(state.channels.game.issue,6);
  await mkdir(path.join(root,'data/.pending'),{recursive:true});await writeFile(path.join(root,`data/.pending/${date}.json`),'{}');
  await assert.rejects(ops.correctUnpublishedIssue(root,{date,runId:'0700',channel:'game',issue:6,now}),{code:'ISSUE_LOCKED'});
  const other=await fixture('published-issue'),file=ops.operationPaths(other,date).state,published=JSON.parse(await readFile(file));published.channels.game.published=true;await writeFile(file,JSON.stringify(published));
  await assert.rejects(ops.correctUnpublishedIssue(other,{date,runId:'0700',channel:'game',issue:6,now}),{code:'ISSUE_LOCKED'});
});
await test('并发写入串行锁拒绝交错且保留成功记录', async () => {
  const root=await fixture('concurrent');
  const results=await Promise.allSettled([ops.appendResearchLedger(root,{...entry,eventId:'a'}),ops.appendResearchLedger(root,{...entry,eventId:'b',candidateIds:['two']})]);
  assert(results.some(item=>item.status==='fulfilled'));
  assert(results.filter(item=>item.status==='rejected').every(item=>item.reason.code==='STATE_BUSY'));
  assert.equal((await ops.readResearchLedger(root,date)).length,results.filter(item=>item.status==='fulfilled').length);
});

if (failures) process.exitCode = 1;
