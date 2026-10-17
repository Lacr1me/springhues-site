import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { validateMinsheng } from './minsheng-lib.mjs';
import { archiveSeedRoot } from './state-evidence-fixtures.mjs';
import { assertMinshengPublishCandidate } from './archive-consistency.mjs';

const brief = JSON.parse(await readFile(path.join(archiveSeedRoot, 'data/minsheng/2026-09-25.json'), 'utf8'));
const original = structuredClone(brief);
const legacy = JSON.parse(await readFile(path.join(archiveSeedRoot, 'data/minsheng/2026-08-23.json'), 'utf8'));
validateMinsheng(legacy);
const now = new Date();
const fields = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
}).formatToParts(now).map(part => [part.type, part.value]));
brief.backfilledAt = now.toISOString();
brief.productionTime = `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}（北京时间）`;
assert.notEqual(brief.productionTime.slice(0,10), brief.date, 'fixture需要跨日制作');
validateMinsheng(brief);
assertMinshengPublishCandidate(brief, { editions: [{ date: '2026-09-24', issue: 34, publishAt: '2026-09-24T11:00:00+08:00' }] }, []);

const unmarked = structuredClone(brief);
delete unmarked.backfilledAt;
assert.throws(() => validateMinsheng(unmarked), /productionTime/);
const falseDate = structuredClone(brief);
falseDate.productionTime = original.productionTime;
assert.throws(() => validateMinsheng(falseDate), /productionTime/);
const future = structuredClone(brief);
future.backfilledAt = new Date(now.getTime() + 3600_000).toISOString();
assert.throws(() => validateMinsheng(future), /backfilledAt/);
const badCutoff = structuredClone(brief);
badCutoff.cutoff = brief.productionTime;
assert.throws(() => validateMinsheng(badCutoff), /cutoff/);
console.log('民生历史补刊真实制作时间、披露标记、未来时间与原始观察日检查通过。');
