import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as ops from './daily-operations.mjs';
import { evidenceFor } from './state-evidence-fixtures.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'steam-research-coverage-'));
const date = '2026-09-28';
const runId = 'fixture';
const now = new Date(date + 'T07:00:00+08:00');
const ids = ['100001', '100002', '100003', '100004', '100005', '100006'];
const missingId = '100007';
const record = entry => ops.appendResearchLedger(root, {
  date, runId, channel: 'game', section: 'deals', now, ...entry
});
const status = async () => (await ops.researchCompleteness(root, date, 'game')).sections.deals;

try {
  await ops.acquireRunLease(root, { date, runId, now });
  await ops.initializeRunState(root, { date, runId, now });
  const missingFreeze = await status();
  assert.equal(missingFreeze.frozenDiscoveryComplete, false);
  assert.equal(missingFreeze.frozenCoverageComplete, false);
  await ops.freezeSteamDiscovery(root, {
    date, runId, now, sourceUrl: 'https://store.steampowered.com/search/?specials=1&cc=cn&l=schinese',
    appIds: [...ids, missingId]
  });
  const accepted = ids.map(id => evidenceFor(id, date, {
    url: `https://store.steampowered.com/app/${id}/?cc=cn&l=schinese`
  }));
  await record({ sourceId: 'steam-price-history', status: 'accepted', coverageComplete: true });
  await record({ sourceId: 'steam-cn', status: 'accepted', availableCount: ids.length,
    candidateIds: ids, candidateEvidence: accepted, coverageComplete: false });
  for (const minute of ['01', '02']) await record({
    sourceId: 'steam-cn', status: 'unavailable', reasons: 'same frozen item is inaccessible',
    attemptedAt: `${date}T07:${minute}:00+08:00`
  });
  let result = await status();
  assert.equal(result.complete, false, 'two failed requests do not resolve frozen Steam coverage');
  assert.deepEqual(result.unresolvedAppIds, [missingId]);

  await record({ sourceId: 'steam-cn', status: 'accepted', availableCount: ids.length,
    candidateIds: ids, candidateEvidence: accepted, coverageComplete: true });
  result = await status();
  assert.equal(result.complete, false, 'a coverage label cannot replace a decision for every frozen item');
  assert.deepEqual(result.unresolvedAppIds, [missingId]);

  await record({ sourceId: 'steam-cn', status: 'accepted', availableCount: ids.length,
    candidateIds: ids, coverageComplete: true,
    candidateEvidence: [...accepted, { ...evidenceFor(missingId, date),
      decision: 'rejected', basis: 'isolated fixture: explicit offer ended before edition day' }] });
  result = await status();
  assert.equal(result.complete, true, 'accepted and evidenced rejected items together close coverage');
  assert.deepEqual(result.unresolvedAppIds, []);

  await record({ sourceId: 'steam-cn', status: 'started' });
  assert.equal((await status()).complete, false, 'a later open recheck must remain incomplete');
  console.log('Steam research coverage regression checks passed.');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('steam-research-coverage-'));
  await rm(root, { recursive: true, force: true });
}
