import assert from 'node:assert/strict';
import { selectArchiveComparisonEditions, loadArchiveComparisonBriefs, assertGamePublishCandidate, assertMinshengPublishCandidate } from './archive-consistency.mjs';

const dates = Array.from({length: 20}, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
const manifest = {editions: dates.filter(date => date !== '2026-09-10').map((date, i) => ({date, issue:i+1, file:`data/${date}.json`, publishAt:`${date}T11:00:00+08:00`}))};
const selected = selectArchiveComparisonEditions(manifest, '2026-09-10', 'game');
assert.deepEqual(selected.map(e => e.date), [...dates.slice(2,9).reverse(), ...dates.slice(10,17)]);
let reads = 0;
await loadArchiveComparisonBriefs('.', manifest, '2026-09-10', 'game', async file => {
  reads++;
  return JSON.stringify(selected.find(e => file.replaceAll('\\','/').endsWith(e.file)));
});
assert.equal(reads, 14);

const items = Array.from({length:6}, (_, i) => ({name:`pack ${i}`,url:`https://example.com/pack/${i}`,image:`game-brief-assets/2026-09-10-${i}.jpg`}));
const game = {date:'2026-09-10',issue:20,backfilledAt:new Date().toISOString(),cutoff:'2026-09-10',dataWindow:'2026-09-09 至 2026-09-10',features:[],news:[],packs:items,mods:[],trends:[],deals:items};
const later = {date:'2026-09-11',packs:items,features:[],news:[],mods:[],trends:[]};
assert.throws(() => assertGamePublishCandidate(game, manifest, [later]), /2026-09-11.*2026-09-10.*packs.*6.*5/);
assertGamePublishCandidate({...game,packs:items.slice(0,5)},manifest,[later]);
assertGamePublishCandidate(game,manifest,[{...later,date:'2026-09-18'},...dates.slice(10,17).map(date=>({...later,date,packs:[]}))]);

const stories = Array.from({length:12}, (_,i) => ({title:`story ${i}`,url:`https://example.com/story/${i}`,publishedAt:'2026-09-10'}));
const minsheng = {date:'2026-09-10',issue:20,backfilledAt:new Date().toISOString(),sourcePolicyVersion:2,cutoff:'2026-09-10',metricsCutoff:'2026-09-10',sections:{domestic:stories}};
minsheng.productionTime = new Date(Date.parse(minsheng.backfilledAt) + 8*3600000).toISOString().slice(0,16).replace('T',' ')+'（北京时间）';
assert.throws(() => assertMinshengPublishCandidate(minsheng,manifest,[{date:'2026-09-11',sections:{domestic:stories}}]), /2026-09-11.*2026-09-10.*12.*10/);
console.log('Historical admission checks both adjacent seven-edition windows before publication.');
