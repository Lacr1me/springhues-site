// Synthetic, isolated evidence only. Never use these records as production verification.
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as ops from './daily-operations.mjs';
import { channelSections, requiredSourceIds, requiredSourceLabels } from './source-registry.mjs';
export const hash = buffer => createHash('sha256').update(buffer).digest('hex');
export const fixtureDate = '2026-09-10';
export const fixtureNow = new Date(fixtureDate + 'T11:01:00+08:00');
// 归档只保留最近 7 期，测试所需的历史期次改读这份固定夹具（真实期次的副本），不再依赖 data/ 里的旧文件。
export const archiveSeedRoot = fileURLToPath(new URL('./fixtures/archive-seed/', import.meta.url));
// 把夹具复制到 base/seed，并为每个索引期次补一个仅含 PNG 头的假文件（宽 3840），供健康检查类测试当作站点根目录。
export async function materializeArchiveSeed(base) {
  const root = path.join(base, 'seed');
  await cp(archiveSeedRoot, root, { recursive: true });
  const png = Buffer.alloc(25); Buffer.from([137,80,78,71,13,10,26,10]).copy(png); png.writeUInt32BE(3840,16);
  for (const [channel, index] of [['game','data/index.json'],['minsheng','data/minsheng/index.json']]) {
    for (const edition of JSON.parse(await readFile(path.join(root, index), 'utf8')).editions) {
      await mkdir(path.join(root,'downloads',channel), { recursive: true });
      await writeFile(path.join(root,'downloads',channel,edition.date+'.png'), png);
    }
  }
  return root;
}
export async function writeJson(file, data) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data,null,2)+'\n'); }
export function evidenceFor(id, date, item = {}) {
  return { id, decision: 'accepted', url: item.url || 'https://example.test/source/' + encodeURIComponent(id), checkedAt: date+'T07:00:00+08:00', basis: 'synthetic isolated fixture; not source verification', facts: { fixture: true, ...item } };
}
export async function makeReadyFixture(base, channel = 'minsheng', projectRoot = process.cwd(), options = {}) {
  const root = options.root || path.join(base, channel);
  const date = fixtureDate, now = fixtureNow, runId = 'fixture';
  const brief = JSON.parse(await readFile(ops.archiveContentPath(archiveSeedRoot,date,channel),'utf8')); // projectRoot 仅为兼容旧调用保留
  brief.issue = 1;
  const candidate = path.join(root,'data','.pending',...(channel === 'minsheng' ? ['minsheng'] : []),date+'.json');
  const paths = ops.operationPaths(root,date);
  const render = path.join(paths.directory,date+'-render');
  const html = path.join(render,channel+'.html'), png = path.join(render,channel+'.png');
  const publicPng = path.join(root,'downloads',channel,date+'.png');
  const renderEvidence = path.join(render,channel+'-render-evidence.json'), visualEvidence = path.join(render,channel+'-visual-evidence.json');
  await ops.acquireRunLease(root,{date,runId,now:new Date(date+'T07:00:00+08:00')});
  await ops.initializeRunState(root,{date,runId,gameIssue:1,minshengIssue:1,now:new Date(date+'T07:00:00+08:00')});
  if (channel === 'game') await ops.freezeSteamDiscovery(root,{date,runId,now:new Date(date+'T07:00:00+08:00'),sourceUrl:'https://store.steampowered.com/search/?specials=1',appIds:brief.deals.map(item => /\/app\/(\d+)/.exec(item.url)[1])});
  await ops.acquireRunLease(root,{date,runId,now});
  for (const section of channelSections(channel)) {
    const items = channel === 'game' ? brief[section] : section === 'metrics' ? brief.metrics : brief.sections[section];
    const itemId = item => section === 'deals' ? /\/app\/(\d+)/.exec(item.url)[1] : typeof item === 'string' ? item : item.id || item.kind || item.url;
    const sources = requiredSourceIds(channel,section);
    for (const [index,sourceId] of sources.entries()) {
      let selected = index === 0 ? items : [];
      if (section === 'deals' && sourceId === 'steam-cn') selected = items;
      if (section === 'deals' && sourceId === 'steam-price-history') selected = items.filter(item => item.label.includes('史低'));
      const candidateIds = selected.map(itemId);
      await ops.appendResearchLedger(root,{date,runId,channel,section,sourceId,status:'accepted',candidateIds,availableCount:candidateIds.length,coverageComplete:true,evidenceComplete:true,candidateEvidence:selected.map(item=>evidenceFor(itemId(item),date,typeof item === 'string' ? { title:item } : item)),now});
    }
  }
  await writeJson(candidate,brief);
  await writeJson(path.join(root,'data',...(channel === 'minsheng' ? ['minsheng'] : []),'index.json'),{timezone:'Asia/Shanghai',publishAt:'11:00',editions:[]});
  if (channel === 'minsheng') {
    const auditEntry = (section,items) => ({ attemptedChinaSources:requiredSourceLabels(channel,section), usableChinaCandidates:items.filter(item=>item.sourceOrigin!=='external').length, rejectedChinaCandidates:0,rejectionReasons:[],shortageReason:items.some(item=>item.sourceOrigin==='external')?'synthetic shortage':'',finalChinaCount:items.filter(item=>item.sourceOrigin!=='external').length,finalExternalCount:items.filter(item=>item.sourceOrigin==='external').length });
    await writeJson(paths.audit,{date,sourcePolicyVersion:2,categories:Object.fromEntries(Object.entries(brief.sections).map(([section,items])=>[section,auditEntry(section,items)])),metrics:auditEntry('metrics',brief.metrics)});
  }
  await mkdir(render,{recursive:true}); await mkdir(path.dirname(publicPng),{recursive:true});
  await writeFile(html,`<a href="${channel==='game'?'downloads/game/':'../downloads/minsheng/'}${date}.png">${date}</a>`);
  // PNG metadata fixture; this is deliberately not a claim of a real render.
  const buffer=Buffer.alloc(25); Buffer.from([137,80,78,71,13,10,26,10]).copy(buffer);buffer.writeUInt32BE(3840,16);
  await writeFile(png,buffer);await writeFile(publicPng,buffer);
  const candidateSha256=hash(await readFile(candidate)),htmlSha256=hash(await readFile(html)),pngSha256=hash(buffer);
  await writeJson(renderEvidence,{date,channel,renderer:'render.mjs',scale:2,validate:true,checkedAt:now.toISOString(),candidateSha256,htmlSha256,pngSha256,fixture:true});
  await writeJson(visualEvidence,{date,channel,method:'view_image',result:'pass',inspector:'synthetic-test-double',inspectedAt:now.toISOString(),pngSha256,findings:[],fixture:true});
  return {root,date,channel,now,runId,candidate,html,png,publicPng,renderEvidence,visualEvidence,candidateSha256,pngSha256,brief};
}
