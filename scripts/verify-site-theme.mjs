import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPlaywright } from './collect-steam-discovery.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(arg => arg.replace(/^--/, '').split(/=(.*)/s).slice(0,2)));
const base = args.base || 'http://127.0.0.1:4173/';
const out = path.resolve(args.out || 'output/playwright/site-theme');
await fs.mkdir(out, {recursive:true});
const {chromium} = await loadPlaywright();
const browser = await chromium.launch({channel:'msedge',headless:true});
const report = {at:new Date().toISOString(),base,checks:[],widths:[],errors:[]};
const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce',locale:'zh-CN'});
let feed = 'empty';
const sample = {id:'test-only',nickname:'测试留言',content:'<img src=x onerror=alert(1)> '+ '长内容测试'.repeat(45),approvedAt:'2026-10-16T04:00:00Z',createdAt:'2026-10-16T03:00:00Z',status:'approved',reply:{content:'谢谢来访\n这是仅在验证浏览器中显示的回复',repliedAt:'2026-10-16T05:00:00Z'}};
let mutations = 0;
await context.route('**/*', async route => {
  const request=route.request(), url=new URL(request.url());
  if(url.origin===new URL(base).origin) return route.continue();
  if(url.pathname.endsWith('/list-messages')) {
    const body = feed==='error' ? {error:{message:'测试网络错误'}} : {items:feed==='populated'?[sample]:[],nextCursor:null};
    return route.fulfill({status:feed==='error'?503:200,contentType:'application/json',body:JSON.stringify(body)});
  }
  if(url.pathname.endsWith('/manage-messages') && request.method()==='GET') return route.fulfill({json:{items:[sample],nextCursor:null}});
  if(url.pathname.endsWith('/manage-admin-logs') && request.method()==='GET') return route.fulfill({json:{items:[{id:'mock-log',kind:url.searchParams.get('kind'),title:'浏览器样式验证',summary:'仅使用本地模拟响应\n核对长文本与导航',status:'success',occurredAt:'2026-10-16T06:00:00Z',source:'manual',metadata:{test:true}}],nextCursor:null}});
  if(/supabase\.co$/.test(url.hostname) && request.method()!=='GET') mutations++;
  return route.abort();
});
const page = await context.newPage();
page.on('pageerror',e=>report.errors.push(e.message));
const check=async(name,fn)=>{await fn();report.checks.push(name);console.log('PASS '+name);};
const settle=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
const resize=async width=>{await page.setViewportSize({width,height:1000});await settle();};
const ready=async channel=>{
  await page.waitForFunction(()=>/^\d{4}-\d{2}-\d{2}$/.test(document.querySelector('#navDate')?.textContent));
  if(channel==='minsheng') await page.waitForFunction(()=>document.querySelector('#loading').classList.contains('hidden'));
  await settle();
};
const overflow=async(label,width)=>{
  await resize(width);
  const result=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,offenders:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.right>innerWidth+1&&getComputedStyle(e).position!=='fixed';}).slice(0,8).map(e=>e.className)}));
  report.widths.push({label,...result});
  assert(result.scroll<=width+1,JSON.stringify({label,...result}));
};
try {
  for(const route of ['game','minsheng','messages','privacy','admin/messages']) {
    await page.goto(new URL(route+'/',base).href);
    if(['game','minsheng'].includes(route)) await ready(route);
    await check(route+' shared navigation and responsive layout',async()=>{
      assert.equal(await page.locator('.site-rail').count(),1);
      assert.equal(await page.locator('.site-rail a[href*="admin"]').count(),0);
      assert.equal(await page.locator('.rail-logo img').evaluate(img=>img.complete&&img.naturalWidth>0),true);
      assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(245, 242, 239)');
      for(const width of [320,390,768,1024,1440,1920]) await overflow(route,width);
      const header=await page.locator('body > header').boundingBox();
      assert.equal(Math.round(header.x),234);
      assert.equal(Math.round(header.width),1920-234);
    });
    await resize(1440);
    await page.screenshot({path:path.join(out,route.replace('/','-')+'-desktop.png'),fullPage:!['game','minsheng'].includes(route)});
    await resize(390);
    await page.screenshot({path:path.join(out,route.replace('/','-')+'-mobile.png'),fullPage:!['game','minsheng'].includes(route)});
    if(['game','minsheng'].includes(route)) {
      const manifest = JSON.parse(await fs.readFile(path.join(process.cwd(),route==='game'?'data/index.json':'data/minsheng/index.json'),'utf8'));
      const editions=manifest.editions.filter(e=>Date.parse(e.publishAt)<=Date.now()).sort((a,b)=>b.date.localeCompare(a.date));
      await check(route+' archive keyboard, edition navigation and download',async()=>{
        await page.locator('.archive-trigger').click();
        assert(await page.locator('#archiveDialog').isVisible());
        await page.screenshot({path:path.join(out,route+'-archive-mobile.png')});
        await page.keyboard.press('Escape');
        assert(!(await page.locator('#archiveDialog').isVisible()));
        assert(await page.locator('.archive-trigger').evaluate(e=>e===document.activeElement));
        await page.locator('.archive-trigger').click();
        await page.locator('#archiveList a').nth(1).click();
        await page.waitForFunction(date=>document.querySelector('#navDate')?.textContent===date,editions[1].date);
        await ready(route);
        assert.equal(new URL(page.url()).searchParams.get('date'),editions[1].date);
        assert((await page.locator('#downloadPng').getAttribute('href')).includes(editions[1].date+'.png'));
        for(const value of ['invalid','2099-12-31']){
          await page.goto(new URL(route+'/?date='+value,base).href); await ready(route);
          assert.equal(await page.locator('#navDate').textContent(),editions[0].date);
        }
      });
      if(route==='game') await check('game full Steam list and image capture cap',async()=>{
        const data=JSON.parse(await fs.readFile(path.join(process.cwd(),editions[0].file),'utf8'));
        assert.equal(await page.locator('#dealList > *').count(),data.deals.length);
        await page.evaluate(()=>document.body.classList.add('png-capture'));
        assert.equal(await page.locator('#dealList > *:visible').count(),Math.min(6,data.deals.length));
        await page.evaluate(()=>document.body.classList.remove('png-capture'));
      });
      if(route==='minsheng') await check('minsheng aligned desktop rows and mobile natural heights',async()=>{
        await resize(1920);
        const result=await page.evaluate(()=>Array.from({length:10},(_,i)=>['domesticStories','internationalStories','techStories'].map(id=>document.getElementById(id).children[i].getBoundingClientRect().height)));
        for(const heights of result) assert(Math.max(...heights)-Math.min(...heights)<1);
        assert.equal(await page.locator('.story').count(),35);
        await resize(390);
        assert(await page.locator('#domesticStories .story').evaluateAll(nodes=>nodes.every(n=>!n.style.height)));
      });
    }
  }
  await check('message empty, error, retry, safe replies and hidden honeypot',async()=>{
    await page.goto(new URL('messages/',base).href);
    await page.waitForFunction(()=>document.querySelector('#messageState').textContent.includes('还没有'));
    assert((await page.locator('.honeypot').boundingBox()).x < -9000);
    assert.equal(await page.locator('[name=website]').getAttribute('tabindex'),'-1');
    await page.locator('.message-form button[type=submit]').click();
    await page.waitForFunction(()=>document.querySelector('[data-message-status]').dataset.state==='error');
    assert.equal(mutations,0);
    feed='error';await page.reload();
    await page.waitForFunction(()=>document.querySelector('#loadMore').textContent==='重新加载');
    feed='populated';await page.locator('#loadMore').click();
    await page.waitForSelector('.message-item');
    assert.equal(await page.locator('.message-content').textContent(),sample.content);
    assert.equal(await page.locator('.message-item img').count(),0);
    assert(await page.locator('.owner-reply').isVisible());
    for(const width of [320,390,768,1440]) await overflow('message populated',width);
    await page.evaluate(()=>scrollTo({top:0,behavior:'instant'}));
    await page.screenshot({path:path.join(out,'messages-populated-desktop.png'),fullPage:true});
    await resize(390);await page.screenshot({path:path.join(out,'messages-populated-mobile.png'),fullPage:true});
  });
  await check('private dashboard simulated session, tabs and narrow layout',async()=>{
    // Ephemeral test-only session; every external request is intercepted above. No actual login.
    await page.evaluate(()=>sessionStorage.setItem('springhues-message-admin-session',JSON.stringify({accessToken:'test-only',refreshToken:'test-only',expiresAt:Math.floor(Date.now()/1000)+3600,user:{id:'test-only',email:'preview@example.invalid'}})));
    await page.goto(new URL('admin/messages/',base).href);
    await page.waitForSelector('.admin-log-card');
    for(const width of [320,390,768,1440]) await overflow('admin logs',width);
    await page.screenshot({path:path.join(out,'admin-dashboard-desktop.png'),fullPage:true});
    await page.locator('#messagesTab').click();await page.waitForSelector('.admin-message-card');
    assert.equal(await page.locator('.admin-reply-field textarea').getAttribute('maxlength'),'500');
    for(const width of [320,390,768,1440]) await overflow('admin messages',width);
    await resize(390);await page.screenshot({path:path.join(out,'admin-dashboard-mobile.png'),fullPage:true});
    await page.locator('#maintenanceTab').click();await page.waitForSelector('#maintenanceList .admin-log-card');
    assert.equal(await page.locator('meta[name=robots]').getAttribute('content'),'noindex,nofollow,noarchive');
    const policy=await page.locator('meta[http-equiv=Content-Security-Policy]').getAttribute('content');
    report.observedAdminPolicy=policy;
    assert(/(?:^|;)\s*script-src\s[^;]*'self'/.test(policy),policy);
  });
  await check('normal and reduced motion archive transitions',async()=>{
    await page.emulateMedia({reducedMotion:'no-preference'});
    await page.goto(new URL('game/',base).href);await ready('game');
    await page.locator('.archive-trigger').click();
    await page.locator('#archiveList a').nth(1).click();
    await page.waitForFunction(()=>!document.querySelector('#archiveDialog').open);
    assert(await page.locator('main section').first().evaluate(e=>getComputedStyle(e).animationName!=='none'));
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await page.locator('main section').first().evaluate(e=>getComputedStyle(e).animationName),'none');
  });
  assert.equal(mutations,0,'No external mutations may be attempted by this verification');
  assert.deepEqual(report.errors,[]);
  report.passed=true;
} catch(error) {
  report.passed=false;report.failure=error.stack;
  await page.screenshot({path:path.join(out,'failure.png'),fullPage:true});
  throw error;
} finally {
  await fs.writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  await browser.close();
}
