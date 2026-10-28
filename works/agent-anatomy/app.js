const DATA=JSON.parse(document.getElementById('agent-data').textContent);
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const calm=matchMedia('(prefers-reduced-motion: reduce)');
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let scenario='sunny', run=makeRun(scenario), cursor=0, playing=false, speed=1, visible=false, lastAdvance=performance.now(), frame=0, lastFrame=performance.now();
let position={x:0,y:0},target={x:0,y:0};
const carriage=$('#task-carriage');
const machine=$('.agent-machine');
const stationsById=Object.fromEntries(STATIONS.map(s=>[s.id,s]));
const iconHTML=n=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${n}"/></svg>`;
// Read-only inspection surface for QA; the application still changes via real controls.
Object.defineProperty(window,'agentPreview',{get:()=>Object.freeze({scenario,step:cursor,playing,speed,total:run.length,station:run[cursor].station,visible,reduced:calm.matches,x:position.x,y:position.y})});

function appear(el,oldHTML=null){
  if(calm.matches)return;
  el.getAnimations().forEach(a=>a.cancel());
  el.animate([{opacity:.35,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],{duration:360,easing:'cubic-bezier(.2,.75,.25,1)'});
}
function fadeOutInPlace(el){
  if(calm.matches||!el.textContent.trim())return;
  const rect=el.getBoundingClientRect(), parent=el.parentElement;
  if(rect.bottom<0||rect.top>innerHeight)return;
  const ghost=el.cloneNode(true);ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
  ghost.setAttribute('aria-hidden','true');ghost.inert=true;
  Object.assign(ghost.style,{position:'absolute',left:rect.left+'px',top:(rect.top+scrollY)+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',pointerEvents:'none',zIndex:'5',background:'var(--white)'});
  document.body.append(ghost);
  const a=ghost.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}],{duration:160,easing:'ease-out',fill:'forwards'});
  a.finished.finally(()=>ghost.remove());
}
function stop(){playing=false;updatePlay();}
function updatePlay(){
  $('#play').setAttribute('aria-pressed',String(playing));
  $('#play-label').textContent=playing?'暂停流程':'播放流程';
  $('#play-icon').innerHTML=iconHTML(playing?'pause':'play');
}
function render({animate=true}={}){
  const s=run[cursor], station=stationsById[s.station], budget=budgetOf(s);
  if(animate)fadeOutInPlace($('#step-story'));
  $('#simulation').dataset.scenario=scenario;$('#simulation').dataset.step=cursor;
  $('#step-current').textContent=String(cursor+1).padStart(2,'0');$('#step-total').textContent=String(run.length).padStart(2,'0');
  $('#stage-label').textContent=station.name;$('#step-title').textContent=s.title;$('#step-body').textContent=s.body;
  $('#step-action').textContent=s.action;$('#machine-caption').textContent=s.action;
  $('#run-status').textContent=s.status;$('#call-count').textContent=s.calls;$('#round-count').textContent=s.round;
  $('#budget-label').textContent=budget.known?`${budget.used} / ${s.budget} 元`:'尚未计算';
  $('#budget-fill').style.width=`${budget.ratio*100}%`;
  $('#budget-note').textContent=budget.known?`剩余 ${budget.left} 元 · 预设费用，仅供演示`:'总预算 600 元 · 查询前不填假数字';
  $('#state-list').innerHTML=[['天气',s.weather],['地点',s.place],['权限与边界',s.security],['人数与餐单',`${s.people} 人 · ${s.meals}`],['时间安排（预设）',s.schedule],['天气对应方案',s.weatherPlan]].map(([a,b])=>`<div><dt>${escapeHTML(a)}</dt><dd>${escapeHTML(b)}</dd></div>`).join('');
  $('#result').textContent=s.result;
  $('#request-json').textContent=s.request?JSON.stringify(s.request,null,2):'尚未提出工具请求';
  $('#receipt-json').textContent=s.receipt?JSON.stringify(s.receipt,null,2):'尚未收到工具回执';
  $('#execution-log').innerHTML=run.slice(0,cursor+1).map((r,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span>${escapeHTML(r.action)}</li>`).join('');
  $('#prev').disabled=cursor===0;$('#next').disabled=cursor===run.length-1;
  $$('.scenario').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===scenario)));
  $$('.station').forEach(b=>{const active=b.dataset.jumpStation===s.station;b.dataset.active=active;b.setAttribute('aria-current',active?'step':'false');});
  machine.dataset.focus=s.station;
  machine.querySelectorAll('[data-station]').forEach(g=>g.dataset.active=String(g.dataset.station===s.station));
  if($('#step-progress').children.length!==run.length){
    $('#step-progress').innerHTML=run.map((r,i)=>`<button data-seek="${i}" aria-label="第 ${i+1} 步 ${escapeHTML(r.title)}" title="${escapeHTML(r.title)}"></button>`).join('');
  }
  $$('#step-progress button').forEach((b,i)=>{b.dataset.done=String(i<=cursor);b.setAttribute('aria-current',i===cursor?'step':'false');});
  target=DATA.meta.stations?.[s.station]??DATA.meta.points.find(p=>p.step===s.station);
  if(calm.matches){position={x:target.x,y:target.y};carriage.setAttribute('transform',`translate(${position.x} ${position.y})`);}
  if(animate)appear($('#step-story'));lastAdvance=performance.now();wake();
}
function seek(index,manual=true){if(manual)stop();cursor=Math.max(0,Math.min(run.length-1,index));render();}
function wake(){if(!frame)frame=requestAnimationFrame(tick);}
function tick(now){
  frame=0;const dt=Math.min((now-lastFrame)/1000,.05);lastFrame=now;
  let moving=false;
  if(visible&&!document.hidden&&!calm.matches){
    const f=1-Math.exp(-dt/0.18);position.x+=(target.x-position.x)*f;position.y+=(target.y-position.y)*f;
    moving=Math.abs(target.x-position.x)+Math.abs(target.y-position.y)>.03;
    if(!moving)position={x:target.x,y:target.y};
    carriage.setAttribute('transform',`translate(${position.x.toFixed(3)} ${position.y.toFixed(3)})`);
    if(playing&&now-lastAdvance>6500/speed){
      if(cursor<run.length-1)seek(cursor+1,false);else stop();
    }
  }
  if(visible&&!document.hidden&&(moving||playing)&&!calm.matches)wake();
}
$('#next').addEventListener('click',()=>seek(cursor+1));$('#prev').addEventListener('click',()=>seek(cursor-1));
$('#reset').addEventListener('click',()=>seek(0));
$('#play').addEventListener('click',()=>{playing=!playing;if(playing&&cursor===run.length-1){cursor=0;render();}lastAdvance=performance.now();updatePlay();wake();});
$('#speed').addEventListener('change',e=>{speed=Number(e.target.value);lastAdvance=performance.now();});
$('.scenario-bar').addEventListener('click',e=>{const b=e.target.closest('[data-scenario]');if(!b)return;stop();scenario=b.dataset.scenario;run=makeRun(scenario);cursor=0;$('#step-progress').innerHTML='';render();});
$('#step-progress').addEventListener('click',e=>{const b=e.target.closest('[data-seek]');if(b)seek(Number(b.dataset.seek));});
$('.stations').addEventListener('click',e=>{const b=e.target.closest('[data-jump-station]');if(!b)return;const next=run.findIndex((s,i)=>i>cursor&&s.station===b.dataset.jumpStation);seek(next>=0?next:run.findIndex(s=>s.station===b.dataset.jumpStation));});
$('#machine-stage').addEventListener('keydown',e=>{if(e.key==='ArrowRight'){e.preventDefault();seek(cursor+1);}if(e.key==='ArrowLeft'){e.preventDefault();seek(cursor-1);}if(e.key===' '){e.preventDefault();$('#play').click();}if(e.key==='Home'){e.preventDefault();seek(0);}if(e.key==='End'){e.preventDefault();seek(run.length-1);}});
new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;lastAdvance=performance.now();lastFrame=performance.now();if(visible)wake();},{threshold:.1}).observe($('#simulation'));
document.addEventListener('visibilitychange',()=>{lastAdvance=performance.now();if(!document.hidden)wake();});
calm.addEventListener('change',()=>{stop();render({animate:false});});
// Under reduced motion the user can still read every frame using next/back.
$('#play').addEventListener('click',()=>{if(calm.matches&&playing){stop();seek(cursor<run.length-1?cursor+1:0);}});

function setTab(name,focus=false){
  $$('[data-tab]').forEach(b=>{const on=b.dataset.tab===name;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;if(on&&focus)b.focus();});
  ['state','receipt','log'].forEach(n=>{$('#panel-'+n).hidden=n!==name;});appear($('#panel-'+name));
}
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
function tabKeys(group,selector,select){
  group.addEventListener('keydown',e=>{if(!['ArrowRight','ArrowLeft','Home','End'].includes(e.key))return;const buttons=[...group.querySelectorAll(selector)],i=buttons.indexOf(e.target);if(i<0)return;e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;select(buttons[next]);buttons[next].focus();});
}
tabKeys($('.inspector-tabs'),'[data-tab]',b=>setTab(b.dataset.tab));
const MODES={
  chat:['告诉你可以怎样做','普通对话可以把知识组织成建议，但如果没有外部工具和执行循环，这些建议不会自己变成查天气、查场地等动作。','“下雨的话，你可以考虑室内活动。”','这是概念对比；今天的聊天产品也可能在内部使用 Agent。'],
  workflow:['沿着提前画好的路线做','开发者提前约定步骤与分支：先查天气，雨天走室内分支，晴天走公园分支。它也能调用模型和工具，甚至处理复杂条件。','走开发者写好的“雨天 → 室内”分支。','可预知、稳定的任务常常很适合工作流，不必为了 Agent 而使用 Agent。'],
  agent:['看一眼结果，再决定下一步','运行程序把新结果交给模型。模型在允许的范围内决定继续查什么、是否改计划、是否交付，程序负责落实动作与控制边界。','“下雨了，接下来找允许自带食物的室内场地。”','Agent 也可以嵌在固定工作流中。实际产品经常是两种方式的组合。']
};
function mode(id){
  const m=MODES[id];$$('[data-mode]').forEach(b=>{const on=b.dataset.mode===id;b.setAttribute('aria-selected',String(on));b.tabIndex=on?0:-1;});
  $('#compare-content').setAttribute('aria-labelledby','mode-'+id);['title','desc','example','limit'].forEach((s,i)=>$('#compare-'+s).textContent=m[i]);appear($('#compare-content'));
}
$$('[data-mode]').forEach(b=>b.addEventListener('click',()=>mode(b.dataset.mode)));
tabKeys($('.compare-tabs'),'[data-mode]',b=>mode(b.dataset.mode));
const MEMORY={context:['本轮材料','上下文是这一次真正读到的内容','系统规则、用户要求、相关记忆片段和工具回执，被整理进本轮输入。上下文有长度上限，塞得越多不一定越好。'],memory:['保存的档案','记忆需要保存，也需要找回来','跨任务保留“有人吃素”等偏好，可以放进数据库或文件。存过不等于每次都用，也不意味着模型的参数被重新训练。'],rag:['取来的资料','RAG 是找资料后再拿来用','先检索与问题相关的片段，再把它们放进上下文帮助回答。它可以成为 Agent 的一个工具，也能独立用于普通问答。']};
function memory(id){const m=MEMORY[id];$$('[data-memory]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.memory===id)));$('#memory-object').textContent=m[0];$('#memory-title').textContent=m[1];$('#memory-text').textContent=m[2];appear($('.memory-demo'));}
$$('[data-memory]').forEach(b=>b.addEventListener('click',()=>memory(b.dataset.memory)));
function limit(){const value=Number($('#limit').value),r=loopBudget(value);$('#limit-value').textContent=value;$('#attempts').innerHTML=Array.from({length:8},(_,i)=>`<span data-done="${i<r.attempts}" data-stop="${i===r.attempts-1&&!r.done}">${i+1}</span>`).join('');$('#limit-result').textContent=`实际尝试 ${r.attempts} 次 · ${r.reason}`;}
$('#limit').addEventListener('input',limit);
// Native details semantics with reversible height motion and unchanged focus.
const detailAnimations=new WeakMap();
$$('details').forEach(d=>{
  const summary=d.querySelector('summary'), body=d.querySelector('.detail-body');
  summary.addEventListener('click',e=>{
    e.preventDefault();const previous=detailAnimations.get(d);if(previous)previous.cancel();
    if(calm.matches){d.open=!d.open;return;}
    const closing=d.open, start=d.getBoundingClientRect().height;
    if(!closing)d.open=true;
    const end=closing?summary.getBoundingClientRect().height:d.getBoundingClientRect().height;
    d.style.overflow='hidden';const a=d.animate([{height:start+'px'},{height:end+'px'}],{duration:320,easing:'cubic-bezier(.2,.75,.25,1)'});detailAnimations.set(d,a);
    body.animate(closing?[{opacity:1},{opacity:0}]:[{opacity:0},{opacity:1}],{duration:240});
    a.finished.then(()=>{if(closing)d.open=false;d.style.overflow='';detailAnimations.delete(d);}).catch(()=>{d.style.overflow='';});
  });
});
$('#expand-all').addEventListener('click',()=>{const open=$('#expand-all').getAttribute('aria-expanded')!=='true';$$('.chapter-detail').forEach(d=>{detailAnimations.get(d)?.cancel();d.open=open;d.style.overflow='';});$('#expand-all').setAttribute('aria-expanded',String(open));$('#expand-all').innerHTML=(open?'收起全部案例':'展开全部案例')+iconHTML(open?'x':'book-open');});
const search=$('#glossary-search');search.addEventListener('input',()=>{const q=search.value.trim().toLowerCase();let count=0;$$('.glossary-item').forEach(el=>{const match=el.textContent.toLowerCase().includes(q);el.hidden=!match;if(match){count++;appear(el);}});$('#no-terms').hidden=count>0;});
if(!calm.matches){const reveal=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){appear(e.target);reveal.unobserve(e.target);} }),{threshold:.05});$$('.reveal').forEach(el=>reveal.observe(el));}
const tocLinks=$$('.toc nav a');
function readingPosition(){const articles=$$('[data-chapter]');let active=0;articles.forEach((el,i)=>{if(el.getBoundingClientRect().top<innerHeight*.4)active=i;});tocLinks.forEach((a,i)=>a.setAttribute('aria-current',String(i===active)));$('#reading-position').textContent=`${String(active+1).padStart(2,'0')} / ${articles.length}`;}
let readFrame=0;document.addEventListener('scroll',()=>{if(!readFrame)readFrame=requestAnimationFrame(()=>{readFrame=0;readingPosition();});},{passive:true});
mode('agent');memory('context');limit();render({animate:false});readingPosition();document.documentElement.dataset.ready='true';
// Quiet introductory tour, cancelled by the reader's first interaction.
let touched=false;document.addEventListener('pointerdown',()=>{touched=true;},{once:true});document.addEventListener('keydown',()=>{touched=true;},{once:true});
setTimeout(()=>{if(!touched&&!calm.matches&&visible){playing=true;updatePlay();lastAdvance=performance.now();wake();}},12000);
