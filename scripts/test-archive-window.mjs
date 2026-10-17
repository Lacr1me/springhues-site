import assert from 'node:assert/strict';
import { selectPriorEditions, loadPriorBriefs } from './archive-consistency.mjs';
for (const channel of ['game', 'minsheng']) {
  const prefix = channel === 'game' ? 'data' : 'data/minsheng';
  const editions = Array.from({length: 12}, (_, i) => {
    const date = `2026-09-${String(i + 1).padStart(2, '0')}`;
    return { date, issue: i + 1, file: `${prefix}/${date}.json`, publishAt: `${date}T11:00:00+08:00` };
  }).reverse();
  const manifest = { editions: [...editions.slice(5), ...editions.slice(0, 5), editions[3]] };
  const selected = selectPriorEditions(manifest, '2026-09-11', channel);
  assert.deepEqual(selected.map(x => x.issue), [10,9,8,7,6,5,4]);
  const reads = [];
  await loadPriorBriefs('.', manifest, '2026-09-11', channel, async file => {
    reads.push(file);
    return JSON.stringify(selected.find(x => file.replaceAll('\\', '/').endsWith(x.file)));
  });
  assert.equal(reads.length, 7);
  assert.equal(selectPriorEditions({ editions: editions.slice(-2) }, '2026-09-11', channel).length, 2);
  assert.throws(() => selectPriorEditions(manifest, '2026-09-11', channel === 'game' ? 'minsheng' : 'game'), /channel/);
  assert.throws(() => selectPriorEditions({ editions: [...editions, {...editions[0], issue: 99}] }, '2026-09-11', channel), /duplicate/);
}
console.log('Archive tests passed: seven reads, ordering, short history, future exclusion, duplicates, channel isolation.');
