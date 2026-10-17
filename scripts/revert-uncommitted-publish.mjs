import {createHash, randomUUID} from 'node:crypto';
import {mkdir, open, readFile, rename} from 'node:fs/promises';
import path from 'node:path';
import {assertUncommittedPublication,readGit as git} from './publication-repository.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
const conflict = message => {throw new Error('PUBLISH_REVERT_CONFLICT: '+message);};
async function optional(file) {try {return await readFile(file);} catch(e) {if(e.code==='ENOENT')return null;throw e;}}
async function replace(file, bytes, check) {
  await check();
  const temporary=file+'.'+randomUUID()+'.staged',handle=await open(temporary,'wx');
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
  await check(); await rename(temporary,file);
}
async function retain(file,bytes) {
  const old=await optional(file);
  if(old) {if(!old.equals(bytes))conflict('backup differs: '+file);return;}
  const handle=await open(file,'wx');
  try {await handle.writeFile(bytes);await handle.sync();} finally {await handle.close();}
}
// Cancel only this run's completed local transaction before its first commit.
// Every original byte is retained; published repository editions are refused.
export async function revertUncommittedPublication({root=process.cwd(),date,channel,runId,transactionId,expectedHead,operations,readGit=git,reason,afterBoundary=async()=>{}}={}) {
  if(!['game','minsheng'].includes(channel)||!/^\d{4}-\d{2}-\d{2}$/.test(date||'')||!runId||!transactionId||!reason)conflict('explicit identity and reason required');
  operations ||= await import('./daily-operations.mjs');
  const options={date,channel,runId,transactionId,expectedHead,reason};
  const check=async()=>{
    await operations.assertRunLease(root,date,{runId});
    return assertUncommittedPublication(root,options,readGit);
  };
  const before=await check(),data=channel==='game'?'data':'data/minsheng';
  const journalPath=path.join(root,'artifacts/operations',`${date}-${channel}-publish-transaction.json`);
  const journal=JSON.parse(await readFile(journalPath));
  if(journal.schemaVersion!==1||journal.id!==transactionId||journal.step!=='complete'||journal.identity.date!==date||journal.identity.channel!==channel||hash(before)!==journal.indexBeforeSha256||hash(jsonBytes(journal.manifestAfter))!==journal.indexAfterSha256)conflict('journal identity or manifest differs');
  const stateFile=path.join(root,'artifacts/operations',`${date}-run-state.json`),stateBytes=await readFile(stateFile),state=JSON.parse(stateBytes);
  const saved=state.channels?.[channel]?.publication || state.publicationCancellations?.findLast(item=>item.transactionId===transactionId&&item.runId===runId);
  if(saved?.runId!==runId||saved.transactionId!==transactionId||saved.candidateSha256!==journal.identity.candidateSha256||saved.pngSha256!==journal.identity.pngSha256)conflict('transaction belongs to another run');
  const target=path.join(root,data,`${date}.json`),pending=path.join(root,'data/.pending',channel==='game'?'':channel,`${date}.json`),index=path.join(root,data,'index.json');
  const body=await optional(target),draft=await optional(pending),indexBytes=await readFile(index),png=await readFile(path.join(root,'downloads',channel,`${date}.png`));
  if(body&&draft||!body&&!draft||hash(body||draft)!==saved.candidateSha256||hash(png)!==saved.pngSha256||![journal.indexBeforeSha256,journal.indexAfterSha256].includes(hash(indexBytes)))conflict('local files changed');
  const backup=path.join(root,'artifacts/operations',`${date}-${channel}-cancelled-${transactionId}`);
  await check();await mkdir(backup,{recursive:true});
  for(const [name,bytes] of [['journal.json',jsonBytes(journal)],['body.json',body||draft],['public.png',png],['index-before.json',before]])await retain(path.join(backup,name),bytes);
  if(!await optional(path.join(backup,'state-before.json')))await retain(path.join(backup,'state-before.json'),stateBytes);
  const readyFile=path.join(root,'artifacts/operations',`${date}-readiness.json`),ready=await optional(readyFile);
  if(ready&&!await optional(path.join(backup,'readiness-before.json')))await retain(path.join(backup,'readiness-before.json'),ready);
  if(hash(indexBytes)!==journal.indexBeforeSha256)await replace(index,before,check);
  if(body) {await check();await mkdir(path.dirname(pending),{recursive:true});await rename(target,pending);}
  if(channel==='game') {
    const embedded=await readGit(root,['show',`${expectedHead}:data/embedded.js`]);
    await replace(path.join(root,'data/embedded.js'),embedded,check);
  }
  await check();
  await operations.cancelUncommittedPublication(root,{...options,backup:path.relative(root,backup).replaceAll('\\','/')});
  await afterBoundary('state:cancelled');
  await check();await rename(journalPath,path.join(backup,'completed-journal.json'));
  return {status:'cancelled',date,channel,transactionId,backup};
}
if(path.resolve(process.argv[1]||'')===path.resolve(import.meta.filename)) {
  const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const i=arg.indexOf('=');return [arg.slice(2,i),arg.slice(i+1)];}));
  console.log(JSON.stringify(await revertUncommittedPublication({date:args.date,channel:args.channel,runId:args['run-id'],transactionId:args['transaction-id'],expectedHead:args['expected-head'],reason:args.reason}),null,2));
}
