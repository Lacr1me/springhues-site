(() => {
  'use strict';
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const still=matchMedia('(prefers-reduced-motion: reduce)');
  const stageEl=$('#machine-stage'),ticket=$('#machine-ticket'),proof=$('#machine-proof');
  const state={stage:0,playing:false,visible:true,hover:false,focus:false,elapsed:0,x:0,proof:0,last:0,frame:0,touched:false};
  let fadeId=0;
  const stageTabs=$$('.stage-tab');
  const iconMarkup=(name)=>`<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><use href="#i-${name}"/></svg>`;
  function replaceContent(s) {
    $('#stage-title').textContent=s.title;$('#stage-tag').textContent=s.tag;
    $('#stage-analogy').textContent=s.analogy;$('#stage-actual').textContent=s.actual;
    $('#stage-note').textContent=s.note;
    $('#stage-example').replaceChildren(...s.example.flatMap((text,i)=>{
      const chip=document.createElement('span');chip.className='paper-token';chip.textContent=text;
      if(!i)return [chip];
      const holder=document.createElement('span');holder.innerHTML=iconMarkup('arrow-right');return [holder.firstElementChild,chip];
    }));
  }
  function fadeContent(s) {
    const el=$('#stage-content'),id=++fadeId;
    el.getAnimations().forEach(a=>a.cancel());
    if(still.matches || !el.animate){replaceContent(s);return;}
    const a=el.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-5px)'}],{duration:120,easing:'ease-out',fill:'forwards'});
    a.finished.then(()=>{if(id!==fadeId)return;replaceContent(s);a.cancel();el.animate([{opacity:0,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,easing:'cubic-bezier(.22,1,.36,1)'});}).catch(()=>{});
  }
  function setStage(index,manual=true){
    state.stage=(index+STAGES.length)%STAGES.length;state.elapsed=0;
    if(manual){state.touched=true;setPlaying(false);}
    const s=STAGES[state.stage];
    stageEl.dataset.focus=String(state.stage);stageEl.dataset.stage=String(state.stage);
    $$('.machine-part[data-station]').forEach(el=>el.dataset.active=String(Number(el.dataset.station)===state.stage));
    stageTabs.forEach((el,i)=>{el.setAttribute('aria-selected',String(i===state.stage));el.tabIndex=i===state.stage?0:-1;});
    $('#stage-counter').textContent=String(state.stage+1).padStart(2,'0');
    $('#machine-readout').textContent=still.matches?s.name:`正在移到 · ${s.name}`;
    $('#stage-content').setAttribute('aria-labelledby',`tab-${state.stage}`);
    stageEl.setAttribute('aria-label',`推理工作台 第${state.stage+1}步 ${s.name} 使用左右方向键切换 空格播放或暂停 Escape暂停`);
    if(manual)$('#stage-announcement').textContent=`第 ${state.stage+1} 步 ${s.name}`;
    fadeContent(s);wake();
  }
  function setPlaying(on){
    state.playing=!!on&&!still.matches;state.elapsed=0;
    $('#play-tour').setAttribute('aria-pressed',String(state.playing));
    $('#play-tour').innerHTML=iconMarkup(state.playing?'pause':'play')+`<span>${state.playing?'暂停流程':still.matches?'手动逐步':'播放流程'}</span>`;
    $('#play-tour').setAttribute('aria-label',still.matches?'减少动态效果已启用 点击前进到下一步':state.playing?'暂停流程':'播放流程');
    if(state.playing)wake();
  }
  function tick(now){
    state.frame=0;
    if(!state.visible || document.hidden)return;
    const dt=state.last?Math.min((now-state.last)/1000,1/30):1/60;state.last=now;
    const touring=state.playing&&!state.hover&&!state.focus&&!still.matches;
    if(touring){state.elapsed+=dt;if(state.elapsed>5.8)setStage(state.stage+1,false);}
    const target=MACHINE_META.stationStops[state.stage],targetProof=state.stage===4?3.5:0;
    state.x=still.matches?target:state.x+(target-state.x)*(1-Math.exp(-dt/.35));
    state.proof=still.matches?targetProof:state.proof+(targetProof-state.proof)*(1-Math.exp(-dt/.25));
    if(Math.abs(state.x-target)<.015)state.x=target;
    if(Math.abs(state.proof-targetProof)<.015)state.proof=targetProof;
    $('#machine-readout').textContent=state.x===target&&state.proof===targetProof?STAGES[state.stage].name:`正在移到 · ${STAGES[state.stage].name}`;
    const ax=MACHINE_META.ticketAxis,ap=MACHINE_META.proofAxis;
    ticket?.setAttribute('transform',`translate(${(state.x*ax[0]).toFixed(3)} ${(state.x*ax[1]).toFixed(3)})`);
    proof?.setAttribute('transform',`translate(${(state.proof*ap[0]).toFixed(3)} ${(state.proof*ap[1]).toFixed(3)})`);
    if(touring || state.x!==target || state.proof!==targetProof)state.frame=requestAnimationFrame(tick);
  }
  function wake(){if(!state.frame&&state.visible&&!document.hidden){state.last=0;state.frame=requestAnimationFrame(tick);}}
  $('#previous-stage').addEventListener('click',()=>setStage(state.stage-1));
  $('#next-stage').addEventListener('click',()=>setStage(state.stage+1));
  $('#play-tour').addEventListener('click',()=>{state.touched=true;if(still.matches){setStage(state.stage+1);return;}setPlaying(!state.playing);});
  $('#start-tour').addEventListener('click',()=>{state.touched=true;setStage(still.matches?1:0,false);setPlaying(!still.matches);if(innerWidth<700)stageEl.scrollIntoView({behavior:still.matches?'instant':'smooth',block:'center'});});
  stageTabs.forEach((tab,i)=>tab.addEventListener('click',()=>setStage(i)));
  function handleKeys(e){
    if(['ArrowRight','ArrowDown','ArrowLeft','ArrowUp','Home','End',' ','Escape'].includes(e.key))e.preventDefault();else return;
    state.touched=true;
    if(e.key==='Escape')setPlaying(false);
    else if(e.key===' '){if(still.matches)setStage(state.stage+1);else setPlaying(!state.playing);}
    else {setStage(e.key==='Home'?0:e.key==='End'?5:state.stage+(['ArrowRight','ArrowDown'].includes(e.key)?1:-1));if(e.currentTarget.classList.contains('stage-tabs'))stageTabs[state.stage].focus();}
  }
  stageEl.addEventListener('keydown',handleKeys);$('.stage-tabs').addEventListener('keydown',handleKeys);
  stageEl.addEventListener('pointerenter',()=>{state.hover=true;});stageEl.addEventListener('pointerleave',()=>{state.hover=false;wake();});
  stageEl.addEventListener('focusin',()=>{state.focus=true;});stageEl.addEventListener('focusout',()=>{state.focus=false;wake();});
  new IntersectionObserver(entries=>{state.visible=entries[entries.length-1].isIntersecting;if(state.visible)wake();else if(state.frame){cancelAnimationFrame(state.frame);state.frame=0;}},{rootMargin:'120px 0px'}).observe(stageEl);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&state.frame){cancelAnimationFrame(state.frame);state.frame=0;}else wake();});
  still.addEventListener('change',()=>{if(still.matches)setPlaying(false);setStage(state.stage,false);wake();});
  setStage(0,false);setPlaying(false);
  setTimeout(()=>{if(!state.touched&&!still.matches)setPlaying(true);},4200);

  function renderSchedule(overlap){
    const m=schedulingModel(overlap);
    $$('[data-schedule]').forEach(b=>b.setAttribute('aria-pressed',String((b.dataset.schedule==='overlap')===overlap)));
    m.rows.forEach((r,i)=>{for(const [id,start,end]of[['cpu-track',r.c0,r.c1],['gpu-track',r.g0,r.g1]]){const el=$(`#${id} [data-batch="${i}"]`);el.style.left=`${start/m.extent*100}%`;el.style.width=`${(end-start)/m.extent*100}%`;el.setAttribute('aria-label',`第${i+1}批 第${start}至${end}格`);}});
    $('#schedule-total').textContent=m.total;$('#schedule-caption').textContent=overlap?'排程与印刷重叠 少等 6 格':'排程与印刷依次进行';
    $('#schedule-lab').dataset.mode=overlap?'overlap':'serial';
  }
  $$('[data-schedule]').forEach(b=>b.addEventListener('click',()=>renderSchedule(b.dataset.schedule==='overlap')));renderSchedule(true);
  function renderDraft(){const m=allocateDraftBudget($('#draft-budget').value);
    $('#budget-value').textContent=m.budget;
    m.candidates.forEach(c=>{const el=$(`.draft-token[data-row="${c.r}"][data-index="${c.i}"]`);el.textContent=c.score.toFixed(2);el.classList.toggle('selected',c.i<m.counts[c.r]);el.setAttribute('aria-label',`${DRAFTS[c.r].name}稿第${c.i+1}个候选 前缀分数${c.score.toFixed(2)} ${c.i<m.counts[c.r]?'本轮验证':'暂不验证'}`);});
    m.counts.forEach((c,r)=>$(`[data-count="${r}"]`).textContent=`${c}/3`);
    $('#draft-readout').textContent=`这轮分配：A 稿 ${m.counts[0]} 个 · B 稿 ${m.counts[1]} 个 · C 稿 ${m.counts[2]} 个。每份草稿都从开头连续验证。`;
    $('#draft-lab').dataset.budget=String(m.budget);
  }
  $('#draft-budget').addEventListener('input',renderDraft);renderDraft();

  const details=$$('.chapter details');
  function syncExpand(){const all=details.every(d=>d.open);$('#expand-all').setAttribute('aria-expanded',String(all));$('#expand-all span').textContent=all?'收起全部技术细节':'展开全部技术细节';}
  function animateDetail(d,open){
    const inner=d.querySelector('.detail-content');
    const old=d.getBoundingClientRect().height;
    d.getAnimations().forEach(a=>a.cancel());
    if(still.matches || !d.animate){d.open=open;syncExpand();return;}
    if(open){d.open=true;const next=d.getBoundingClientRect().height;d.style.overflow='hidden';const a=d.animate([{height:old+'px'},{height:next+'px'}],{duration:360,easing:'cubic-bezier(.22,1,.36,1)'});inner.animate([{opacity:0,transform:'translateY(-5px)'},{opacity:1,transform:'translateY(0)'}],{duration:300});a.finished.finally(()=>d.style.overflow='').catch(()=>{});syncExpand();}
    else {const next=d.querySelector('summary').getBoundingClientRect().height;d.style.overflow='hidden';const a=d.animate([{height:old+'px',opacity:1},{height:next+'px',opacity:1}],{duration:280,easing:'cubic-bezier(.22,1,.36,1)'});inner.animate([{opacity:1},{opacity:0}],{duration:170});a.finished.then(()=>{d.open=false;d.style.overflow='';syncExpand();}).catch(()=>{});}
  }
  details.forEach(d=>d.querySelector('summary').addEventListener('click',e=>{e.preventDefault();animateDetail(d,!d.open);}));
  $('#expand-all').addEventListener('click',()=>{const open=!details.every(d=>d.open);details.forEach(d=>{if(d.open!==open)animateDetail(d,open);});});
  const reveal=new IntersectionObserver(entries=>{entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add('is-in');reveal.unobserve(e.target);}});},{threshold:.05});$$('.reveal').forEach(el=>reveal.observe(el));
  const chapterLinks=$$('.outline-links a');
  const chapterObserver=new IntersectionObserver(entries=>{const shown=entries.filter(e=>e.isIntersecting);if(!shown.length)return;const id=shown[0].target.id;chapterLinks.forEach(a=>{const active=a.hash==='#'+id;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');});},{rootMargin:'-12% 0px -65% 0px'});$$('.chapter').forEach(el=>chapterObserver.observe(el));
  const progress=$('.reading-progress');let scrollFrame=0;function updateProgress(){scrollFrame=0;const range=document.documentElement.scrollHeight-innerHeight;progress.style.width=`${range>0?Math.min(100,scrollY/range*100):0}%`;}
  addEventListener('scroll',()=>{if(!scrollFrame)scrollFrame=requestAnimationFrame(updateProgress);},{passive:true});addEventListener('resize',updateProgress);updateProgress();
  document.documentElement.dataset.ready='true';
})();
