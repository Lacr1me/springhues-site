import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile);
export const readGit = async (root,args) => (await exec('git',args,{cwd:root,encoding:'buffer',maxBuffer:16*1024*1024})).stdout;
export async function assertUncommittedPublication(root,{date,channel,expectedHead},read=readGit) {
  const conflict=message=>{throw new Error('PUBLISH_REVERT_CONFLICT: '+message);};
  if(!['game','minsheng'].includes(channel)||!/^\d{4}-\d{2}-\d{2}$/.test(date||''))conflict('explicit channel and date required');
  if(!/^[a-f0-9]{40}$/.test(expectedHead||''))conflict('explicit repository HEAD required');
  const data=channel==='game'?'data':'data/minsheng';
  if((await read(root,['rev-parse','HEAD'])).toString().trim()!==expectedHead)conflict('repository HEAD changed');
  const before=await read(root,['show',`${expectedHead}:${data}/index.json`]);
  if(JSON.parse(before).editions.some(e=>e.date===date))conflict('edition is already committed');
  try {await read(root,['cat-file','-e',`${expectedHead}:${data}/${date}.json`]);}
  catch(e) {if(e.code===1||e.code===128)return await assertNotStaged();throw e;}
  conflict('archive body is already committed');
  async function assertNotStaged() {
    const staged=await read(root,['diff','--cached','--name-only','--',`${data}/index.json`,`${data}/${date}.json`,`downloads/${channel}/${date}.png`,...(channel==='game'?['data/embedded.js']:[])]);
    if(staged.toString().trim())conflict('publication files are staged');
    return before;
  }
}
