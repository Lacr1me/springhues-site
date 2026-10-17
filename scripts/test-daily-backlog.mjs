import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkDailyBacklog } from './check-daily-backlog.mjs';

const root = await mkdtemp(path.join(os.tmpdir(), 'daily-backlog-test-'));
const json = async (file, data) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data)); };
const now = new Date('2026-10-01T08:00:00+08:00');
try {
  for (const channel of ['game', 'minsheng']) {
    const data = path.join(root, 'data', ...(channel === 'minsheng' ? [channel] : []));
    await json(path.join(data, 'index.json'), { editions: [{ date: '2026-09-28' }, { date: '2026-09-30' }] });
    for (const date of ['2026-09-28', '2026-09-30']) {
      await json(path.join(data, date + '.json'), { date });
      const download = path.join(root, 'downloads', channel, date + '.png');
      await mkdir(path.dirname(download), { recursive: true }); await writeFile(download, 'synthetic existence fixture');
    }
  }
  const state = path.join(root, 'artifacts', 'operations', '2026-09-29-run-state.json');
  await json(state, { date: '2026-09-29', runs: [{ id: '0800', status: 'running', startedAt: '2026-09-29T00:00:00Z' }] });
  const original = await readFile(state);
  const result = await checkDailyBacklog({ root, now });
  assert.equal(result.missingCount, 2);
  assert.deepEqual(result.entries.map(item => [item.date, item.channel]), [['2026-09-29', 'game'], ['2026-09-29', 'minsheng']]);
  assert.deepEqual(result.archiveCounts, { game: 2, minsheng: 2 });
  assert.equal(result.unclosedRuns[0].runId, '0800');
  assert.equal(result.unclosedRuns[0].activeLease, false);
  assert.deepEqual(await readFile(state), original, 'a backlog check must leave shared state untouched');
  const scoped = await checkDailyBacklog({ root, now, channel: 'minsheng' });
  assert.equal(scoped.missingCount, 1);
  // 归档只保留最近 7 期：早于最早在档期次、已被清理的日期（只剩旧运行状态）不得被当作缺口。
  await json(path.join(root, 'artifacts', 'operations', '2026-09-20-run-state.json'), { date: '2026-09-20', runs: [] });
  const pruned = await checkDailyBacklog({ root, now });
  assert.equal(pruned.missingCount, 2);
  assert.deepEqual(pruned.entries.map(item => [item.date, item.channel]), [['2026-09-29', 'game'], ['2026-09-29', 'minsheng']]);
  await assert.rejects(checkDailyBacklog({ root, now, through: '2026-10-01' }), /PRECEDE_TODAY/);
  await assert.rejects(checkDailyBacklog({ root, now, through: '2026-09-31' }), /INVALID_DATE/);
  await assert.rejects(checkDailyBacklog({ root, now, channel: 'other' }), /INVALID_CHANNEL/);
  console.log('Historical backlog read-only regression checks passed.');
} finally {
  assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(root).startsWith('daily-backlog-test-'));
  await rm(root, { recursive: true, force: true });
}
