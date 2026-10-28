(() => {
  const {CONTENT,icons,stageIcons,P,positions,sort}=JSON.parse(document.getElementById('principles-data').textContent);
  const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
  const still=matchMedia('(prefers-reduced-motion: reduce)');
  const machine=$('#machine'), svg=machine.querySelector('svg');
  const ordered=sort.map(s=>({...s,el:svg.querySelector(`[data-order="${s.i}"]`)}));
  const moving=ordered.filter(s=>s.lift!==0);
  const initialPlatform=new URLSearchParams(location.search).get('platform')==='android'?'android':'windows';
  const model={platform:initialPlatform,step:0,at:0,target:0,playing:!still.matches,visible:false,hover:false,elapsed:-1.5,frame:0,last:0,zoom:false,revision:0};
  let orderSignature='';
  function travel(x) {
    const a=P.azimuth*Math.PI/180,e=P.elevation*Math.PI/180,k=P.scale*Math.sqrt(1.6);
    return [x*Math.sin(a)*k,x*Math.cos(a)*Math.sin(e)*k];
  }
  function draw(){
    const [dx,dy]=travel(model.at*290);
    moving.forEach(item=>item.el.setAttribute('transform',`translate(${dx.toFixed(3)} ${dy.toFixed(3)})`));
    const list=[...ordered].sort((a,b)=>(a.key+a.lift*model.at)-(b.key+b.lift*model.at));
    const signature=list.map(i=>i.i).join(',');
    if(signature!==orderSignature){list.forEach(item=>svg.appendChild(item.el));orderSignature=signature;}
    const movingNow=Math.abs(model.target-model.at)>.001;
    const readout=movingNow?`移动至 ${String(model.step+1).padStart(2,'0')} · ${CONTENT.steps[model.step].short}`:`${String(model.step+1).padStart(2,'0')} / 06 · ${CONTENT.steps[model.step].short}`;
    $('[data-readout]').textContent=readout;
    machine.dataset.step=String(model.step);
    machine.dataset.position=model.at.toFixed(5);
    machine.dataset.settled=String(!movingNow);
  }
  function playUi(){
    const running=model.playing;
    $('#play').innerHTML=icons[still.matches?'list-ordered':running?'pause':'play']+`<span>${still.matches?'逐步探索':running?'暂停演示':'播放演示'}</span>`;
    $('#play').disabled=still.matches;
    $('#play').title=still.matches?'系统已开启减少动态效果，请点选六个步骤':'播放或暂停原理演示';
    $('#play').setAttribute('aria-pressed',String(running));
    $('#play-state').textContent=still.matches?'减少动态效果':running?(model.hover?'悬停阅读中':'自动导览'):'自由探索';
  }
  function setPlaying(value){model.playing=value&&!still.matches;model.elapsed=0;playUi();kick();}
  function copy(){
    const s=CONTENT.steps[model.step],text=s[model.platform];
    $('#step-title').textContent=s.title;$('#step-lead').textContent=s.lead;$('#step-body').textContent=text.text;$('#step-tag').textContent=text.tag;$('#detail-text').textContent=text.detail;$('#mechanism-text').textContent='图中 · '+s.mechanism;
  }
  function updateCopy(){
    const n=++model.revision,panel=$('#copy');
    panel.getAnimations?.().forEach(a=>a.cancel());
    if(still.matches||typeof panel.animate!=='function'){copy();return;}
    let leave;
    try{leave=panel.animate([{opacity:1,transform:'translateY(0)'},{opacity:0,transform:'translateY(-4px)'}],{duration:100,easing:'ease-out',fill:'forwards'});}
    catch{copy();return;}
    leave.finished.then(()=>{if(n!==model.revision)return;copy();leave.cancel();panel.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.22,.75,.18,1)'});}).catch(()=>{});
  }
  function choose(index,{manual=true}={}){
    model.step=Math.max(0,Math.min(5,index));model.target=model.step/5;model.elapsed=0;
    if(manual)setPlaying(false);
    if(still.matches)model.at=model.target;
    $$('.stage-btn').forEach((b,i)=>{if(i===model.step)b.setAttribute('aria-current','step');else b.removeAttribute('aria-current');});
    $$('.component').forEach(e=>e.classList.toggle('focused',Number(e.dataset.stage)===model.step));
    $('#step-number').textContent=String(model.step+1).padStart(2,'0');$('#step-icon').innerHTML=icons[stageIcons[model.step]];
    $('#prev').disabled=model.step===0;$('#next').disabled=model.step===5;
    updateCopy();zoomOrigin();draw();kick();
    if(manual)$('#announcement').textContent=`${model.platform==='windows'?'Windows':'Android'}，第 ${model.step+1} 步，${CONTENT.steps[model.step].title}`;
  }
  function tick(now){
    model.frame=0;
    const dt=model.last?Math.min((now-model.last)/1000,1/30):1/60;model.last=now;
    if(model.playing&&!model.hover&&!document.hidden&&!still.matches){model.elapsed+=dt;if(model.elapsed>7.5)choose((model.step+1)%6,{manual:false});}
    model.at=still.matches?model.target:model.at+(model.target-model.at)*(1-Math.exp(-dt/.3));
    if(Math.abs(model.at-model.target)<.00006)model.at=model.target;
    draw();
    if(model.visible&&!document.hidden&&((model.playing&&!model.hover)||model.at!==model.target)&&!model.frame)model.frame=requestAnimationFrame(tick);
  }
  function kick(){if(!model.frame&&model.visible&&!document.hidden){model.last=0;model.frame=requestAnimationFrame(tick);}}
  function haltFrame(){if(model.frame)cancelAnimationFrame(model.frame);model.frame=0;model.last=0;}
  function zoomOrigin(){
    const a=P.azimuth*Math.PI/180,e=P.elevation*Math.PI/180,k=P.scale*Math.sqrt(1.6),x=positions[model.step],y=3,z=10;
    const sx=P.origin[0]+(x*Math.sin(a)-y*Math.cos(a))*k,sy=P.origin[1]+((x*Math.cos(a)+y*Math.sin(a))*Math.sin(e)-z*Math.cos(e))*k;
    machine.style.setProperty('--origin-x',`${Math.max(17,Math.min(83,sx/9.6))}%`);machine.style.setProperty('--origin-y',`${Math.max(25,Math.min(75,sy/5.7))}%`);
  }
  $$('.stage-btn').forEach(b=>b.addEventListener('click',()=>choose(+b.dataset.step)));
  $('#prev').addEventListener('click',()=>choose(model.step-1));$('#next').addEventListener('click',()=>choose(model.step+1));
  $('#play').addEventListener('click',()=>{
    if(still.matches){$('#announcement').textContent='已遵循减少动态效果设置，请用步骤按钮逐步探索';return;}
    setPlaying(!model.playing);
  });
  function selectPlatform(platform,{updateUrl=false}={}){
    model.platform=platform==='android'?'android':'windows';
    $$('.platform-btn').forEach(p=>p.setAttribute('aria-pressed',String(p.dataset.platform===model.platform)));
    $$('[data-system-platform]').forEach(p=>p.classList.toggle('selected',p.dataset.systemPlatform===model.platform));
    document.body.dataset.platform=model.platform;
    $('#platform-label').textContent=model.platform==='android'?'Android':'Windows';
    $('#back-to-intro').href=new URL('./#work=simple-download-'+model.platform,document.baseURI).href;
    if(updateUrl){const url=new URL(location.href);url.searchParams.set('platform',model.platform);history.replaceState(history.state,'',url);localSkip();}
  }
  $$('.platform-btn').forEach(b=>b.addEventListener('click',()=>{
    selectPlatform(b.dataset.platform,{updateUrl:true});choose(model.step);
  }));
  machine.addEventListener('click',e=>{const p=e.target.closest('[data-stage]');if(p&&+p.dataset.stage>=0)choose(+p.dataset.stage);});
  machine.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse'){model.hover=true;playUi();}});
  machine.addEventListener('pointerleave',()=>{model.hover=false;playUi();kick();});
  function keyboard(e){
    if(e.key==='ArrowRight'){e.preventDefault();choose(model.step+1);}else if(e.key==='ArrowLeft'){e.preventDefault();choose(model.step-1);}else if(e.key==='Home'){e.preventDefault();choose(0);}else if(e.key==='End'){e.preventDefault();choose(5);}else if(e.key===' '&&e.target===machine){e.preventDefault();setPlaying(!model.playing);}else if(e.key==='Escape'){setPlaying(false);if(model.zoom)$('#zoom').click();}
  }
  machine.addEventListener('keydown',keyboard);$('.stage-nav').addEventListener('keydown',keyboard);
  $('.workspace').addEventListener('focusin',()=>{if(document.activeElement!==$('#play'))setPlaying(false);});
  $('#zoom').addEventListener('click',()=>{model.zoom=!model.zoom;machine.classList.toggle('zoomed',model.zoom);$('#zoom').setAttribute('aria-pressed',String(model.zoom));$('#zoom').setAttribute('aria-label',model.zoom?'恢复整体视图':'放大机械细节');$('#zoom').innerHTML=icons[model.zoom?'minus':'maximize-2'];zoomOrigin();setPlaying(false);});
  function disclosure(button,panel){button.addEventListener('click',()=>{const open=button.getAttribute('aria-expanded')!=='true';button.setAttribute('aria-expanded',String(open));panel.classList.toggle('open',open);panel.inert=!open;});panel.inert=button.getAttribute('aria-expanded')!=='true';}
  disclosure($('#detail-toggle'),$('#step-detail'));
  $$('.system-toggle').forEach(b=>disclosure(b,document.getElementById(b.getAttribute('aria-controls'))));
  // Figure colors inherit html[data-theme] from the shared site shell.
  // No local theme button, preference, or independent theme state is created.
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{model.visible=entries.at(-1).isIntersecting;if(model.visible)kick();else haltFrame();},{threshold:.1}).observe(machine);
  else model.visible=true;
  document.addEventListener('visibilitychange',()=>{if(document.hidden)haltFrame();else kick();});
  still.addEventListener('change',()=>{if(still.matches){model.playing=false;model.at=model.target;}playUi();draw();kick();});
  selectPlatform(initialPlatform);copy();choose(0,{manual:false});model.elapsed=-1.5;playUi();
  // The shared shell's fragment link needs a document URL when <base> points
  // at the site root. DOMContentLoaded runs after deferred module evaluation.
  function localSkip(){const link=$('.sd-skip');if(link)link.href=new URL('#main',location.href).href;}
  if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',localSkip,{once:true});
  else localSkip();
  window.__ANATOMY__={getState:()=>({platform:model.platform,step:model.step,at:model.at,target:model.target,playing:model.playing,visible:model.visible,frame:model.frame,reduced:still.matches}),partCount:ordered.length};
})();
