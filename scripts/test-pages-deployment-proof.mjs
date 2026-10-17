import assert from 'node:assert/strict';
import { verifyDeploymentProof } from './health-lib.mjs';

// API-shaped fixture from the observed workflow deployment; no network or credentials.
const targetCommit='a'.repeat(40), checkedAt='2026-09-11T04:45:00+08:00';
const api='https://api.github.com/repos/example/daily';
const run='https://github.com/example/daily/actions/runs/345';
const proof={source:'github-actions-pages-api',checkedAt,headSha:targetCommit,conclusion:'success',siteUrl:'https://springhues.com/',evidenceUrl:`${api}/deployments/638`,
 deployment:{id:638,sha:targetCommit,environment:'github-pages',url:`${api}/deployments/638`,statuses_url:`${api}/deployments/638/statuses`},
 deploymentStatus:{id:181,state:'success',environment:'github-pages',environment_url:'https://springhues.com/',log_url:`${run}/job/103`,url:`${api}/deployments/638/statuses/181`},
 workflowRun:{id:345,path:'.github/workflows/pages.yml',head_sha:targetCommit,status:'completed',conclusion:'success',url:`${api}/actions/runs/345`,html_url:run}};
const options={targetCommit,checkedAt,base:'https://springhues.com'};
assert.equal(verifyDeploymentProof(proof,options).targetCommit,targetCommit);
const invalid=[
 p=>{p.deployment.sha='b'.repeat(40);},
 p=>{p.workflowRun.head_sha='b'.repeat(40);},
 p=>{p.deploymentStatus.state='failure';},
 p=>{p.workflowRun.conclusion='failure';},
 p=>{p.workflowRun.status='in_progress';},
 p=>{p.deployment.environment='preview';},
 p=>{p.deploymentStatus.environment='preview';},
 p=>{p.deploymentStatus.environment_url='https://other.example/';},
 p=>{p.deploymentStatus.url=`${api}/deployments/999/statuses/181`;},
 p=>{p.workflowRun.url='https://api.github.com/repos/other/repo/actions/runs/345';},
 p=>{p.deploymentStatus.log_url='https://github.com/example/daily/actions/runs/999/job/103';},
 p=>{p.workflowRun.path='.github/workflows/test.yml';},
 p=>{p.checkedAt='2026-09-11T03:00:00+08:00';},
 p=>{p.checkedAt='2026-09-11T05:45:00+08:00';},
 p=>{delete p.deploymentStatus;}
];
for(const change of invalid){const value=structuredClone(proof);change(value);assert.throws(()=>verifyDeploymentProof(value,options));}
const legacy={source:'github-pages-api',checkedAt,headSha:targetCommit,conclusion:'success',siteUrl:'https://springhues.com/',evidenceUrl:`${api}/pages/builds/123`};
assert.equal(verifyDeploymentProof(legacy,options).targetCommit,targetCommit);
console.log(`Pages proof: Actions chain accepted, ${invalid.length} invalid chains rejected, legacy proof retained.`);
