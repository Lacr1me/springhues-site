const DATA=JSON.parse(document.getElementById('vllm-data').textContent);
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const escapeHTML=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const calm=matchMedia('(prefers-reduced-motion: reduce)');
const iconHTML=n=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${n==='plus'?'x':n}"${n==='plus'?' transform="rotate(45 12 12)"':''}/></svg>`;
const stationById=Object.fromEntries(STATIONS.map(s=>[s.id,s]));
let scenario='single',budget=8,run=makeRun(scenario,{budget}),cursor=0,playing=false,speed=1,visible=false,selectedPage=0;
let x=0,y=0,targetX=0,targetY=0,raf=0,lastTime=0,lastAdvance=0,touched=false,touring=false;
let idleTimer=0;
const head=$('#reader-head'),stage=$('#machine-stage'),travel=DATA.meta.headTravel;
Object.defineProperty(window,'vllmPreview',{get:()=>Object.freeze({scenario,budget,step:cursor,total:run.length,playing,speed,station:run[cursor].station,visible,reduced:calm.matches,x,y})});

function animateExit(el){
  const rect=el.getBoundingClientRect();
  if(!calm.matches&&el.textContent.trim()&&rect.top<innerHeight&&rect.bottom>0&&!el.closest('[hidden]')){
    const ghost=el.cloneNode(true);ghost.removeAttribute('id');ghost.querySelectorAll('[id]').forEach(n=>n.removeAttribute('id'));
    ghost.setAttribute('aria-hidden','true');ghost.inert=true;ghost.dataset.transitionGhost='true';
    Object.assign(ghost.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',width:rect.width+'px',height:rect.height+'px',margin:'0',pointerEvents:'none',zIndex:'8',background:'var(--white)'});
    document.body.append(ghost);
    const fade=ghost.animate([{opacity:.85,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}],{duration:150,easing:'ease-out'});
    fade.finished.then(()=>ghost.remove(),()=>ghost.remove());
  }
}
function transitionHTML(el,html){
  if(el.innerHTML===html)return;
  animateExit(el);
  el.innerHTML=html;
  if(!calm.matches&&!el.closest('[hidden]')){
    el.getAnimations().forEach(a=>a.cancel());
    el.animate([{opacity:.35,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:320,easing:'cubic-bezier(.2,.75,.25,1)'});
  }
}
function updatePlay(){
  $('#play').setAttribute('aria-pressed',String(playing));
  $('#play-label').textContent=calm.matches?'手动下一步':playing?'暂停流程':'播放流程';
  $('#play-icon').innerHTML=iconHTML(calm.matches?'chevron-right':playing?'pause':'play');
}
function stop(){playing=false;touring=false;updatePlay();}
function interact(){touched=true;clearTimeout(idleTimer);if(touring)stop();}
function setStep(index){cursor=Math.max(0,Math.min(run.length-1,index));lastAdvance=performance.now();render();}
function renderProgress(){
  const host=$('#step-progress'),focused=host.contains(document.activeElement)?+document.activeElement.dataset.seek:null;
  if(host.children.length!==run.length){host.innerHTML=run.map((s,i)=>`<button data-seek="${i}"></button>`).join('');if(focused!==null)host.children[Math.min(focused,run.length-1)]?.focus({preventScroll:true});}
  [...host.children].forEach((b,i)=>{b.setAttribute('aria-label',`第 ${i+1} 步 ${run[i].title}`);b.setAttribute('aria-pressed',String(i===cursor));b.classList.toggle('past',i<cursor);});
}
function render(){
  const step=run[cursor],station=stationById[step.station];
  transitionHTML($('#step-story'),`<h3 id="step-title">${escapeHTML(step.title)}</h3><p id="step-body">${escapeHTML(step.body)}</p>`);
  $('#stage-label').textContent=station.name;
  $('#step-current').textContent=String(cursor+1).padStart(2,'0');$('#step-total').textContent=String(run.length).padStart(2,'0');
  $('#metric-pages').textContent=`${step.usedPages} / ${step.capacity}`;
  $('#metric-tokens').textContent=step.generated;$('#metric-done').textContent=`${step.completed} / ${step.total}`;
  $('#capacity-fill').style.width=(step.usedPages/step.capacity*100)+'%';
  $('#round-note').textContent=`每页 ${step.blockSize} 个 Token · 还可用 ${step.freePages} 页。${step.totalHits?`累计复用 ${step.totalHits} 个前缀 Token 位置。`:''}`;
  $('#prev').disabled=cursor===0;$('#next').disabled=cursor===run.length-1;
  $$('.station').forEach(b=>b.setAttribute('aria-current',b.dataset.jumpStation===step.station?'step':'false'));
  $$('.scenario').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.scenario===scenario)));
  $('#scenario-desc').textContent=SCENARIOS.find(s=>s.id===scenario).desc;
  renderProgress();renderInspector(step);
  for(const page of step.pages){
    const el=stage.querySelector(`[data-cache-page="${page.id}"]`);
    el.dataset.state=page.owner;el.dataset.disabled=String(page.disabled);
    el.style.opacity=page.disabled?'.06':'';
    el.setAttribute('aria-label',`物理页 ${page.id} ${page.disabled?'不在当前容量内':page.owner==='free'?'可用':page.owner+' 使用中'}`);
  }
  targetX=travel.dx*step.head;targetY=travel.dy*step.head;
  stage.setAttribute('aria-label',`vLLM 调度台 第 ${cursor+1}/${run.length} 步 ${step.title}。左右方向键逐步查看，空格播放或暂停。`);
  updatePageSelection();wake();
}
function requestStatus(r){return ({future:`第 ${r.arrival+1} 轮到达`,waiting:'排队等容量',active:r.generated>=r.output?'准备回收':r.computed<r.prompt?'正在读输入':'正在生成',done:'已完成'})[r.status];}
function renderInspector(step){
  transitionHTML($('#request-board'),step.requests.map(r=>`<article class="request-card owner-${r.id}"><header><strong>请求 ${r.id}</strong><span>${requestStatus(r)}</span></header><h4>${escapeHTML(r.name)}</h4><div class="row"><span>已计算输入</span><span>${Math.min(r.computed,r.prompt)} / ${r.prompt}</span></div><div class="track"><i style="width:${Math.min(r.computed/r.prompt,1)*100}%"></i></div><div class="row"><span>已生成输出</span><span>${r.generated} / ${r.output}</span></div><div class="track"><i style="width:${r.generated/r.output*100}%"></i></div><div class="row"><span>当前私有/共享页</span><span>${r.pages.length} 页${r.hit?' · 前缀命中 '+r.hit:''}</span></div><div class="tokens" aria-label="已产生 ${r.generated} 个演示输出 Token">${Array.from({length:r.generated},(_,i)=>`<span class="token-chip">o${i+1}</span>`).join('')||'<span class="small-label">等待首个输出</span>'}</div></article>`).join(''));
  const pageHost=$('#physical-pages');
  if(!pageHost.children.length)pageHost.innerHTML=step.pages.map(p=>`<button data-page="${p.id}"><b>P${String(p.id).padStart(2,'0')}</b><span></span></button>`).join('');
  step.pages.forEach(p=>{const b=pageHost.children[p.id];b.dataset.owner=p.owner;b.setAttribute('aria-pressed',String(p.id===selectedPage));b.disabled=p.disabled;b.querySelector('span').textContent=p.disabled?'未开放':p.owner==='free'?'可用':p.owner==='shared'?`共享 ${p.used}/4`:`${p.owner} · ${p.used}/4`;});
  $('#logical-pages').innerHTML=step.requests.map(r=>`<div class="logical-row"><strong>请求 ${r.id} · ${requestStatus(r)}</strong><code>${r.pages.length?r.pages.map((p,i)=>`逻辑 ${i} → P${String(p).padStart(2,'0')}`).join('　'):'尚无活跃映射'}</code></div>`).join('');
  $('#batch-now').innerHTML=step.actions.length?`<span class="small-label">这一轮真正执行的计算</span>${step.actions.map(a=>`<div class="batch-row"><strong>${a.id}</strong><span>${a.kind==='prefill'?'Prefill · 读输入':'Decode · 接着写'}</span><span>${a.tokens} 个位置 → ${a.sampled} 个输出</span></div>`).join('')}<p class="fine-print">${step.scheduledTokens}/${step.budget} 个 Token 计算预算已使用。这里统计被前向计算的 Token 位置，不是请求数，也不是完整历史 KV 的数量。读历史笔记仍要做 Attention。</p>`:'<p class="fine-print">这一步在接收、准备、调度或回收，尚未执行新的模型计算。走到 Prefill 或 Decode 时，可以看到每个请求拿到了多少计算预算。</p>';
  $('#event-log').innerHTML=run.slice(0,cursor+1).map((s,i)=>`<li><span>${String(i+1).padStart(2,'0')}</span><div><strong>${escapeHTML(s.title)}</strong><br>${escapeHTML(s.body)}</div></li>`).join('');
}
function updatePageSelection(){
  const p=run[cursor].pages[selectedPage];
  $$('#physical-pages button').forEach(b=>b.setAttribute('aria-pressed',String(+b.dataset.page===selectedPage)));
  $$('[data-cache-page]').forEach(el=>el.dataset.selected=String(+el.dataset.cachePage===selectedPage));
  $('#page-description').textContent=p.disabled?`P${String(p.id).padStart(2,'0')} 不在本情境开放的 ${run[cursor].capacity} 页中。`:p.owner==='free'?`P${String(p.id).padStart(2,'0')} 当前可用。它可以成为任意请求的下一张逻辑页，不必紧挨上一页。`:p.owner==='shared'?`P${String(p.id).padStart(2,'0')} 保存 ${p.used} 个公共前缀 Token 的 KV。${p.refs.length?'当前被 '+p.refs.join('、')+' 引用。':'当前没有活跃引用，缓存仍保留以便复用。'}共享的是已算好的笔记，不是后面的答案。`:`P${String(p.id).padStart(2,'0')} 属于请求 ${p.owner}，已写入 ${p.used}/4 个 Token 的 KV，剩余 ${4-p.used} 个位置留给本块继续增长。`;
}
function selectPage(n){selectedPage=n;updatePageSelection();}
function tick(now){
  raf=0;if(!visible)return;
  const dt=lastTime?Math.min((now-lastTime)/1000,1/30):1/60;lastTime=now;
  const factor=calm.matches?1:1-Math.exp(-dt/.18);
  x+=(targetX-x)*factor;y+=(targetY-y)*factor;
  const settled=Math.abs(x-targetX)+Math.abs(y-targetY)<.025;
  if(settled){x=targetX;y=targetY;}
  head.setAttribute('transform',`translate(${x.toFixed(4)} ${y.toFixed(4)})`);
  $('#machine-caption').textContent=(settled?'':'正在移到 · ')+stationById[run[cursor].station].name;
  if(playing&&!calm.matches&&now-lastAdvance>=5800/speed){
    if(cursor===run.length-1){if(touring)setStep(0);else stop();}else setStep(cursor+1);
  }
  if((!settled||playing)&&!raf)raf=requestAnimationFrame(tick);
}
function wake(){if(calm.matches){x=targetX;y=targetY;head.setAttribute('transform',`translate(${x} ${y})`);$('#machine-caption').textContent=stationById[run[cursor].station].name;return;}if(!raf&&visible){lastTime=0;raf=requestAnimationFrame(tick);}}
function scheduleTour(){clearTimeout(idleTimer);if(touched||calm.matches||!visible)return;idleTimer=setTimeout(()=>{if(visible&&!touched&&!stage.matches(':hover')&&!$('#lab').contains(document.activeElement)){playing=true;touring=true;lastAdvance=performance.now();updatePlay();wake();}},14000);}
function chooseScenario(id){interact();stop();scenario=id;run=makeRun(id,{budget});cursor=0;selectedPage=0;render();}
function togglePlay(){interact();if(calm.matches){setStep(cursor===run.length-1?0:cursor+1);return;}if(playing){stop();return;}if(cursor===run.length-1)setStep(0);playing=true;touring=false;lastAdvance=performance.now();updatePlay();wake();}
$('#prev').addEventListener('click',()=>{interact();stop();setStep(cursor-1);});$('#next').addEventListener('click',()=>{interact();stop();setStep(cursor+1);});
$('#reset').addEventListener('click',()=>{interact();stop();setStep(0);});$('#play').addEventListener('click',togglePlay);
$('#speed').addEventListener('change',e=>{interact();speed=+e.target.value;lastAdvance=performance.now();});
$('#budget').addEventListener('change',e=>{interact();stop();budget=+e.target.value;run=makeRun(scenario,{budget});cursor=0;render();});
$$('.scenario').forEach(b=>b.addEventListener('click',()=>chooseScenario(b.dataset.scenario)));
$$('.station').forEach(b=>b.addEventListener('click',()=>{interact();stop();const i=run.findIndex(s=>s.station===b.dataset.jumpStation);setStep(i<0?0:i);}));
$('#step-progress').addEventListener('click',e=>{const b=e.target.closest('[data-seek]');if(b){interact();stop();setStep(+b.dataset.seek);}});
$('#physical-pages').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b){interact();selectPage(+b.dataset.page);}});
stage.addEventListener('click',e=>{const el=e.target.closest('[data-cache-page]');if(el){interact();selectPage(+el.dataset.cachePage);setTab('pages');}});
stage.addEventListener('keydown',e=>{
  if(!['ArrowLeft','ArrowRight','Home','End',' '].includes(e.key))return;
  e.preventDefault();interact();if(e.key===' '){togglePlay();return;}stop();
  setStep(e.key==='Home'?0:e.key==='End'?run.length-1:cursor+(e.key==='ArrowRight'?1:-1));
});
stage.addEventListener('pointerenter',()=>{if(touring)stop();});
$('#lab').addEventListener('focusin',()=>{if(touring)stop();});
document.addEventListener('pointerdown',interact,{once:true});document.addEventListener('keydown',interact,{once:true});
new IntersectionObserver(entries=>{visible=entries[entries.length-1].isIntersecting;if(visible){wake();scheduleTour();}else{clearTimeout(idleTimer);stop();if(raf)cancelAnimationFrame(raf);raf=0;}},{threshold:.04}).observe(stage);
document.addEventListener('visibilitychange',()=>{if(document.hidden){stop();clearTimeout(idleTimer);if(raf)cancelAnimationFrame(raf);raf=0;}else wake();});
calm.addEventListener('change',()=>{stop();clearTimeout(idleTimer);if(raf)cancelAnimationFrame(raf);raf=0;wake();});

function setTab(id){
  $$('[data-tab]').forEach(b=>{const active=b.dataset.tab===id;b.setAttribute('aria-selected',String(active));b.tabIndex=active?0:-1;});
  $$('[role=tabpanel]').forEach(p=>{const show=p.id==='panel-'+id;if(show&&p.hidden){p.hidden=false;if(!calm.matches)p.animate([{opacity:0,transform:'translateY(5px)'},{opacity:1,transform:'none'}],{duration:280,easing:'ease-out'});}else if(!show&&!p.hidden){animateExit(p);p.hidden=true;}});
}
$$('[data-tab]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
$('.inspector-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const tabs=$$('[data-tab]'),i=tabs.indexOf(document.activeElement),next=e.key==='Home'?0:e.key==='End'?tabs.length-1:(i+(e.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;setTab(tabs[next].dataset.tab);tabs[next].focus();});

function renderPaging(){
  const lengths=$$('[data-length]').map(el=>+el.value),size=+$('#page-size').value,v=pagingExperiment(lengths,size);
  $$('[data-length]').forEach(el=>$('#length-'+el.dataset.length).textContent=el.value);
  $('#paging-used').innerHTML=v.allocated+'<small> 个位置</small>';$('#paging-waste').innerHTML=v.waste+'<small> 个位置</small>';
  transitionHTML($('#paging-rows'),v.requests.map(r=>`<div class="paging-row owner-${r.id}"><b>${r.id}</b><div>${Array.from({length:r.blocks},(_,b)=>`<span class="page-block" aria-label="${r.id} 的第 ${b+1} 块">${Array.from({length:size},(_,i)=>`<i class="${b*size+i<r.tokens?'filled':''}"></i>`).join('')}</span>`).join('')}</div></div>`).join(''));
  $('#paging-explanation').textContent=`当前确实需要 ${v.tokens} 个 Token 位置，分页申请 ${v.blocks} 块，共 ${v.allocated} 个位置。尾块仍有 ${v.waste} 个空位；相比每人固定预留 16 的教学基线少占 ${v.reserved-v.allocated} 个位置。这不包含页表等管理开销。`;
}
$$('[data-length]').forEach(el=>el.addEventListener('input',renderPaging));$('#page-size').addEventListener('change',renderPaging);
function renderBatch(policy='continuous'){
  const v=batchExperiment(policy);$$('[data-batch-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.batchMode===policy)));
  $('#batch-rounds').textContent=v.total;$('#batch-idle').textContent=v.idle;
  let html='<span>轮次</span>'+Array.from({length:10},(_,i)=>`<span>${i+1}</span>`).join('');
  for(const r of v.requests){html+=`<span><b>${r.id}</b></span>`;for(let t=0;t<10;t++){const active=v.rounds[t]?.ids.includes(r.id),wait=t>=r.arrival&&t<r.started;html+=`<span class="batch-cell owner-${r.id} ${active?'working':wait?'waiting':''}">${active?'算':wait?'等':''}</span>`;}}
  transitionHTML($('#batch-grid'),html);
  $('#batch-explanation').textContent=policy==='static'?'B 在第 2 轮结束，但这一组必须等 A 到第 6 轮结束。C 已经来了，也要等整批腾空，直到第 7 轮才能开始。':'B 在第 2 轮结束，C 在第 3 轮就接上空位。A 与 C 在第 6 轮都完成。同样 12 份工作，减少的是空等；真实 GPU 的批次耗时并不恒定。';
}
$$('[data-batch-mode]').forEach(b=>b.addEventListener('click',()=>renderBatch(b.dataset.batchMode)));
function renderPrefix(){const v=prefixExperiment(+$('#prefix-length').value);$('#prefix-length-value').textContent=v.shared;$('#prefix-hit').textContent=v.hit;$('#prefix-prefill').textContent=v.prefill;transitionHTML($('#prefix-strip'),Array.from({length:v.prompt},(_,i)=>`<i class="${i<v.hit?'cached':i<v.shared?'partial':''}"></i>`).join(''));$('#prefix-explanation').textContent=`蓝色 ${v.hit} 个位置复用完整块，${v.remainder?`红色 ${v.remainder} 个位置虽然相同，却不足一整块，仍要算。`:'没有不足一整块的匹配尾巴。'}缓存帮你少读一部分旧材料，不替你写后面的 8 个新 Token。`;}$('#prefix-length').addEventListener('input',renderPrefix);
function renderKV(){const v=kvEstimate({tokens:+$('#kv-length').value,bytes:+$('#kv-bytes').value});$('#kv-value').textContent=Number(v.GiB.toFixed(3))+' GiB';}$('#kv-length').addEventListener('change',renderKV);$('#kv-bytes').addEventListener('change',renderKV);

// Animate disclosure height in both directions while retaining native semantics.
$$('details').forEach(details=>{const summary=details.querySelector('summary');let animation=null,closing=false;
  summary.addEventListener('click',e=>{
    if(calm.matches)return;e.preventDefault();const from=details.getBoundingClientRect().height;if(animation){animation.cancel();animation=null;details.style.height='';details.style.overflow='';}
    const wasOpen=details.open&&!closing;closing=false;
    if(wasOpen){closing=true;const to=summary.getBoundingClientRect().height;details.style.overflow='hidden';animation=details.animate([{height:from+'px'},{height:to+'px'}],{duration:300,easing:'cubic-bezier(.2,.75,.25,1)'});animation.onfinish=()=>{details.open=false;closing=false;details.style.overflow='';animation=null;};}
    else{details.open=true;const to=details.getBoundingClientRect().height;details.style.overflow='hidden';animation=details.animate([{height:from+'px'},{height:to+'px'}],{duration:340,easing:'cubic-bezier(.2,.75,.25,1)'});animation.onfinish=()=>{details.style.overflow='';animation=null;};}
  });
});
$('#expand-all').addEventListener('click',()=>{const open=$('#expand-all').getAttribute('aria-expanded')!=='true';$$('.chapter-detail').forEach(d=>{d.getAnimations().forEach(a=>a.cancel());d.style.height='';d.style.overflow='';d.open=open;});$('#expand-all').setAttribute('aria-expanded',String(open));$('#expand-all').innerHTML=(open?'收起全部案例':'展开全部案例')+' '+iconHTML(open?'x':'plus');});
$('#glossary-search').addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();let matches=0;const items=$$('.glossary-grid>.glossary-item'),before=new Map(items.map(item=>[item,item.hidden?null:item.getBoundingClientRect()]));items.forEach(item=>{const show=item.textContent.toLowerCase().includes(q);if(!show&&!item.hidden)animateExit(item);item.hidden=!show;if(show)matches++;});if(!calm.matches)items.filter(item=>!item.hidden).forEach(item=>{const old=before.get(item),now=item.getBoundingClientRect();item.getAnimations().forEach(a=>a.cancel());item.animate([{opacity:old?1:0,transform:`translate(${old?old.left-now.left:0}px,${old?old.top-now.top:6}px)`},{opacity:1,transform:'none'}],{duration:300,easing:'ease-out'});});$('#no-terms').hidden=matches>0;});
const tocLinks=$$('.toc nav a');let readingFrame=0;
function readingPosition(){readingFrame=0;const chapters=$$('.chapter');let n=0;chapters.forEach((el,i)=>{if(el.getBoundingClientRect().top<innerHeight*.4)n=i;});tocLinks.forEach((a,i)=>a.classList.toggle('active',i===n));$('#reading-position').textContent=String(n+1).padStart(2,'0')+' / '+chapters.length;}
addEventListener('scroll',()=>{if(!readingFrame)readingFrame=requestAnimationFrame(readingPosition);},{passive:true});
document.documentElement.classList.add('js');
const revealObserver=new IntersectionObserver(entries=>entries.forEach(entry=>{if(entry.isIntersecting){entry.target.classList.add('is-visible');revealObserver.unobserve(entry.target);}}),{threshold:.035});$$('.reveal').forEach(el=>revealObserver.observe(el));
render();updatePlay();renderPaging();renderBatch();renderPrefix();renderKV();readingPosition();
document.documentElement.dataset.ready='true';
