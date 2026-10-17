import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
const runtime=path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const {chromium}=await import(pathToFileURL(runtime));

const html = process.argv.find(value=>value.startsWith('--html='))?.slice(7);
if (!html) throw Error('Usage: node scripts/test-game-deal-export.mjs --html=<canonical game HTML>');
const browser = await chromium.launch({channel:'msedge',headless:true});
try {
 for (const width of [1920,390]) {
  const page = await browser.newPage({viewport:{width,height:1080}});
  await page.goto(pathToFileURL(path.resolve(html)).href);
  await page.evaluate(()=>document.fonts.ready);
  await page.addStyleTag({path:path.resolve('styles.css')});
  const total = await page.locator('.deal-row:visible').count();
  assert.ok(total>6,'web must retain all verified offers');
  await page.evaluate(()=>document.documentElement.classList.add('png-capture'));
  assert.equal(await page.locator('.deal-row:visible').count(),6,'PNG must show exactly six offers');
  const clipped = await page.locator('.deal-row:visible').evaluateAll(rows=>rows.flatMap(row=>{
   const r=row.getBoundingClientRect();
   for(let parent=row.parentElement;parent;parent=parent.parentElement){
    const s=getComputedStyle(parent),p=parent.getBoundingClientRect();
    if(['hidden','auto','scroll','clip'].includes(s.overflowY)&&(r.top<p.top-1||r.bottom>p.bottom+1))return [{title:row.innerText,ancestor:parent.className}];
   }
   return [];
  }));
  assert.deepEqual(clipped,[],`${width}px PNG contains clipped offer rows`);
  await page.evaluate(()=>document.documentElement.classList.remove('png-capture'));
  assert.equal(await page.locator('.deal-row:visible').count(),total,'capture must preserve web offers');
  console.log(JSON.stringify({width,total,staticCount:6,clipped,passed:true}));
  await page.close();
 }
} finally {await browser.close();}
