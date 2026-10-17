import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
// Reproduce original file ordering with successful gates as substitutes.
// This is not validation of production content or readiness.
const root=await mkdtemp(path.join(os.tmpdir(),'springhues-c-legacy-'));
const date='2026-09-11';
for(const channel of ['game','minsheng']) {
  const script=channel==='game'?'publish-brief.mjs':'publish-minsheng.mjs';
  let source=execFileSync('git',['show',`6b34e7a:scripts/${script}`],{encoding:'utf8'});
  source=source.replace(/^import .* from "\.\/.*";\r?\n/gm,'');
  source=`const beijingDate=()=> '${date}';
const safePendingPath=(root,date)=>({pending:root+'/data/.pending/${channel==='game'?'':channel+'/'}'+date+'.json'});
const validateGame=()=>{},validateMinsheng=()=>{},assertResearchComplete=async()=>{},assertGameDealCoverage=async()=>{},assertReadyProof=async()=>{},assertPublishTime=()=>{},assertGamePublishCandidate=()=>{},assertMinshengPublishCandidate=()=>{},checkpointRunState=async()=>{},mergeSourceAudits=async()=>{},validateMinshengSourceAudit=()=>{};
`+source.replace(/await rename\(pending,\s*target\);/,"await rename(pending,target); throw new Error('INJECTED_AFTER_RENAME');");
  const dir=path.join(root,channel),data=channel==='game'?'data':'data/minsheng';
  await mkdir(path.join(dir,'data/.pending',channel==='game'?'':channel),{recursive:true});
  await mkdir(path.join(dir,data),{recursive:true});
  await mkdir(path.join(dir,'artifacts/operations'),{recursive:true});
  await writeFile(path.join(dir,'data/.pending',channel==='game'?'':channel,`${date}.json`),JSON.stringify({date,issue:1,features:[],topStoryIds:[],sections:{}}));
  await writeFile(path.join(dir,data,'index.json'),JSON.stringify({editions:[]}));
  await writeFile(path.join(dir,'artifacts/operations',`${date}-source-audit.json`),'{}');
  const runner=path.join(dir,'legacy.mjs');await writeFile(runner,source);
  const first=spawnSync(process.execPath,[runner],{cwd:dir,encoding:'utf8'});
  assert.match(first.stderr,/INJECTED_AFTER_RENAME/);
  assert.equal(JSON.parse(await readFile(path.join(dir,data,'index.json'))).editions.length,0);
  const second=spawnSync(process.execPath,[runner],{cwd:dir,encoding:'utf8'});
  assert.match(second.stderr,/草稿不存在/);
}
console.log(`Original defect reproduced in both channels: rename leaves unindexed body; rerun cannot recover. Fixtures retained: ${root}`);
