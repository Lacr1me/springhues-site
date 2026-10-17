import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { probeRenderedEdition } from './health-browser-probe.mjs';
import { verifyPageEvidence } from './health-lib.mjs';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root=process.cwd();
// 归档只保留最近 7 期：每个频道取当前索引里最新的两期做目标期与历史期，不再写死日期。
const editionsOf=async channel=>JSON.parse(await readFile(path.join(root,channel==='game'?'data/index.json':'data/minsheng/index.json'),'utf8')).editions.map(edition=>edition.date);
const dates={game:await editionsOf('game'),minsheng:await editionsOf('minsheng')};
const server=createServer(async (req,res)=>{
  try {
    let pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
    if(pathname.endsWith('/')) pathname+='index.html';
    const file=path.resolve(root, '.'+pathname);
    if(!file.startsWith(root+path.sep)) throw new Error('Invalid path');
    const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png'};
    res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');
    res.end(await readFile(file));
  }catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const observations=[];
try {
  browser=await chromium.launch({headless:true,channel:'msedge'});
  const page=await browser.newPage();
  await page.route('**/*',route=>new URL(route.request().url()).origin===base?route.continue():route.abort());
  for(const channel of ['game','minsheng']) {
    const [latest,previous]=dates[channel];
    for(const date of [latest,previous]) {
      const url=`${base}/${channel}/?date=${date}&health=local-test`;
      const proof=await probeRenderedEdition(page,{url,date});
      verifyPageEvidence(proof,{url,date,channel,checkedAt:new Date().toISOString()});
      observations.push({channel,...proof});
    }
    // Exercise the real archive picker, not just direct URL reads.
    await page.locator('#archiveDate').evaluate((input,value)=>{input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}));},latest);
    await page.waitForFunction(value=>document.querySelector('#navDate')?.textContent.trim()===value,latest);
    assert.equal(new URL(page.url()).searchParams.get('date'),latest);
    await page.goto(`${base}/${channel}/?date=2099-01-01`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(value=>document.querySelector('#navDate')?.textContent.trim()===value,latest);
    assert.equal(new URL(page.url()).searchParams.get('date'),latest);
  }
  // Freeze the browser's clock around publishAt. generateAt remains only metadata.
  for (const channel of ['game','minsheng']) {
    const [latest,previous]=dates[channel];
    await page.clock.setFixedTime(new Date(latest+'T10:59:59+08:00'));
    await page.goto(`${base}/${channel}/?date=${latest}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(value=>document.querySelector('#navDate')?.textContent.trim()===value,previous);
    await page.clock.setFixedTime(new Date(latest+'T11:00:00+08:00'));
    await page.goto(`${base}/${channel}/?date=${latest}`,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(value=>document.querySelector('#navDate')?.textContent.trim()===value,latest);
  }
  const output=path.join(root,'output/playwright'); await mkdir(output,{recursive:true});
  await writeFile(path.join(output,'task-c-browser-evidence.json'),JSON.stringify({scope:'isolated local browser; external requests blocked',observations},null,2));
  console.log('Real Edge browser passed: both channels target/history, archive picker, future-date fallback and download URLs.');
} finally { await browser?.close(); await new Promise(resolve=>server.close(resolve)); }
