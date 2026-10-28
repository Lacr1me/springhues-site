// Deterministic teaching model, not a vLLM implementation or performance benchmark.
export const STATIONS=[
  {id:'receive',name:'接收请求',en:'RECEIVE'},
  {id:'tokenize',name:'变成 Token',en:'TOKENIZE'},
  {id:'allocate',name:'安排缓存页',en:'ALLOCATE'},
  {id:'schedule',name:'拼成一批',en:'SCHEDULE'},
  {id:'prefill',name:'读完输入',en:'PREFILL'},
  {id:'decode',name:'接着往下写',en:'DECODE'},
  {id:'release',name:'结束与回收',en:'RECYCLE'}
];
export const SCENARIOS=[
  {id:'single',name:'先看一单',desc:'跟着一条请求，从排队走到回答结束',capacity:16,requests:[{id:'A',name:'泡茶指南',prompt:8,output:6,arrival:0}]},
  {id:'continuous',name:'新请求插进来',desc:'短请求先结束，新请求及时补进空位',capacity:16,requests:[{id:'A',name:'写一段介绍',prompt:8,output:6,arrival:0},{id:'B',name:'一句话翻译',prompt:4,output:2,arrival:0},{id:'C',name:'给三个建议',prompt:6,output:4,arrival:2}]},
  {id:'prefix',name:'复用共同开头',desc:'两个人带着同一份手册，公共笔记只存一份',capacity:16,prefix:8,requests:[{id:'A',name:'手册里的退款规则',prompt:12,output:4,arrival:0},{id:'B',name:'手册里的配送规则',prompt:10,output:3,arrival:0}]},
  {id:'long',name:'长短任务同跑',desc:'长输入分几轮读，正在生成的回答继续往外发',capacity:16,requests:[{id:'B',name:'正在写的短回答',prompt:4,output:5,arrival:0},{id:'A',name:'一篇较长的材料',prompt:24,output:3,arrival:0},{id:'C',name:'后来的一句提问',prompt:4,output:2,arrival:2}]},
  {id:'pressure',name:'柜格快用完了',desc:'固定容量里先让一单完成，再接下一单',capacity:4,requests:[{id:'A',name:'先来的长回答',prompt:8,output:6,arrival:0},{id:'B',name:'等空位的请求',prompt:8,output:4,arrival:0}]}
];
export const PAGE_ORDER=[0,5,10,15,2,7,8,13,1,6,11,12,3,4,9,14];
const clone=o=>JSON.parse(JSON.stringify(o));
const bound=(n,a,b)=>Math.max(a,Math.min(b,Number(n)||a));

export function makeRun(id='single',options={}){
  const def=SCENARIOS.find(s=>s.id===id)||SCENARIOS[0];
  const blockSize=4,budget=Math.round(bound(options.budget??8,4,12)),capacity=def.capacity;
  const order=PAGE_ORDER.filter(n=>n<capacity),prefix=def.prefix||0;
  const sharedPages=order.slice(0,prefix/blockSize);
  const requests=def.requests.map(r=>({...r,computed:0,generated:0,pages:[],status:'future',started:null,finished:null,hit:0}));
  const frames=[];let round=0,totalComputed=0,totalHits=0;
  const occupied=()=>new Set([...sharedPages,...requests.flatMap(r=>r.status==='done'?[]:r.pages)]);
  function snapshot(station,title,body,actions=[],extra={}){
    const used=occupied();
    const pages=Array.from({length:16},(_,n)=>{
      const refs=requests.filter(r=>r.status!=='done'&&r.pages.includes(n));
      const shared=sharedPages.includes(n);
      const owner=shared?'shared':refs[0]?.id||'free';
      const usedTokens=shared?blockSize:Math.max(0,...refs.map(r=>Math.min(blockSize,Math.max(0,r.computed-r.pages.indexOf(n)*blockSize))));
      return {id:n,owner,refs:refs.map(r=>r.id),used:usedTokens,capacity:blockSize,disabled:n>=capacity,cached:shared};
    });
    frames.push(clone({station,title,body,round,actions,requests,pages,capacity,blockSize,budget,usedPages:used.size,freePages:capacity-used.size,totalComputed,totalHits,
      generated:requests.reduce((s,r)=>s+r.generated,0),completed:requests.filter(r=>r.status==='done').length,
      total:requests.length,head:STATIONS.findIndex(s=>s.id===station)/(STATIONS.length-1),...extra}));
  }
  snapshot('receive','先把请求接住','API 服务把输入和生成设置交给引擎。这里的 A、B、C 是独立请求；题目和 Token 数都为教学设定。');
  snapshot('tokenize','先变成模型能吃的 Token','文字经分词器变成 Token ID。字数不等于 Token 数。本演示把输入缩小到几个 Token，方便看清每一轮。');
  snapshot('allocate',prefix?'柜里已有两页公共笔记':'先准备一池可复用的空页',prefix?'8 个公共前缀 Token 的 KV 已由之前的请求算好，完整占用两页。新请求各自还有不同的后缀，所以仍然要计算。':'一格表示一个固定大小的 KV 块，每块在演示里装 4 个 Token 的 KV。物理位置不必连着；页表记住逻辑顺序。');
  for(round=0;round<80;round++){
    for(const r of requests)if(r.arrival<=round&&r.status==='future')r.status='waiting';
    const actions=[],blocked=[];let remaining=budget;
    // This teaching model uses conservative admission to guarantee completion.
    // Real vLLM may admit differently and preempt/recompute under memory pressure.
    for(const r of requests.filter(r=>r.status==='waiting')){
      const reserved=requests.filter(x=>x.status==='active').reduce((s,x)=>s+Math.ceil((x.prompt+x.output-1)/blockSize)-prefix/blockSize,0)+sharedPages.length;
      const needed=Math.ceil((r.prompt+r.output-1)/blockSize)-prefix/blockSize;
      if(reserved+needed>capacity){blocked.push(r.id);continue;}
      r.status='active';r.started=round;
      if(prefix){r.computed=prefix;r.hit=prefix;r.pages=[...sharedPages];totalHits+=prefix;}
    }
    const active=requests.filter(r=>r.status==='active');
    const sorted=[...active.filter(r=>r.computed>=r.prompt),...active.filter(r=>r.computed<r.prompt)];
    snapshot('schedule',`第 ${round+1} 轮 · 重新决定这一批算谁`,`${active.map(r=>r.id).join('、')} 已获准进入引擎。先安排已有回答的 Decode，再把剩余 Token 预算交给输入材料。${blocked.length?' 本演示为已接单请求保留后续增长余量，其他请求暂时排队；有空页也不一定立刻接单。':''}`,[],{blocked:[...new Set(blocked)]});
    for(const r of sorted){
      if(remaining<=0)break;
      const kind=r.computed>=r.prompt?'decode':'prefill';
      const n=kind==='decode'?1:Math.min(remaining,r.prompt-r.computed);
      const count=Math.ceil((r.computed+n)/blockSize)-r.pages.length;
      const free=order.filter(n=>!occupied().has(n));
      if(free.length<count){blocked.push(r.id);continue;}
      r.pages.push(...free.slice(0,count));
      r.computed+=n;remaining-=n;totalComputed+=n;
      const sampled=r.computed>=r.prompt?1:0;
      r.generated+=sampled;
      actions.push({id:r.id,kind,tokens:n,sampled,allocated:free.slice(0,count),finished:r.generated===r.output});
    }
    const finished=requests.filter(r=>r.status==='active'&&r.generated>=r.output);
    // The snapshot is taken before freeing blocks: the completed round remains inspectable.
    const prefill=actions.filter(a=>a.kind==='prefill').reduce((s,a)=>s+a.tokens,0);
    const decode=actions.filter(a=>a.kind==='decode').length;
    const station=prefill?'prefill':'decode';
    const title=decode&&prefill?'边读长材料 边接着回答':prefill?'这一轮先把输入读进去':'读回已有笔记 再生成一个 Token';
    const description=actions.map(a=>`${a.id} ${a.kind==='prefill'?'计算输入':'计算上一个输出'} ${a.tokens} 个 Token${a.sampled?'，采样 1 个新 Token':''}`).join('；');
    snapshot(station,`第 ${round+1} 轮 · ${title}`,`${description}。本轮预算用了 ${budget-remaining}/${budget}。${blocked.length?` ${[...new Set(blocked)].join('、')} 按本演示的保守准入规则等待容量。`:''}`,actions,{blocked:[...new Set(blocked)],scheduledTokens:budget-remaining});
    if(finished.length){
      const freed=[];
      for(const r of finished){r.status='done';r.finished=round+1;freed.push(...r.pages.filter(n=>!sharedPages.includes(n)));r.pages=[];}
      snapshot('release',`${finished.map(r=>r.id).join('、')} 已完成 空页归还池里`,`${freed.length} 个私有页现在可以给别的请求使用。${prefix?'公共前缀页留在缓存中，之后可命中，也可能因空间需要被驱逐。':'下一轮调度可以使用这些空位。'} 最后采样出的 Token 直接交付，不必为了本次回答再写进 KV。`,[],{freed});
    }
    if(requests.every(r=>r.status==='done'))break;
    if(!actions.length&&!requests.some(r=>r.status==='future'))throw new Error('Teaching model stalled');
  }
  snapshot('release','这批请求完成了',`一共生成 ${requests.reduce((s,r)=>s+r.generated,0)} 个输出 Token，实际计算了 ${totalComputed} 个 Token 位置。${prefix?`两条请求合计复用了 ${totalHits} 个前缀 Token 位置，物理上只保留 ${sharedPages.length} 页公共笔记。`:'所有私有缓存页已归还。'} 这里的轮数不能换算成真实耗时或速度倍数。`,[],{complete:true});
  return frames;
}

export function pagingExperiment(lengths=[9,6,5],blockSize=4){
  const size=[2,4,8].includes(Number(blockSize))?Number(blockSize):4;
  const inputs=lengths.map(n=>Math.round(bound(n,1,16)));
  const requests=inputs.map((n,i)=>({id:['A','B','C'][i],tokens:n,blocks:Math.ceil(n/size),capacity:Math.ceil(n/size)*size,waste:Math.ceil(n/size)*size-n}));
  return {requests,blockSize:size,tokens:inputs.reduce((a,b)=>a+b,0),blocks:requests.reduce((s,r)=>s+r.blocks,0),allocated:requests.reduce((s,r)=>s+r.capacity,0),waste:requests.reduce((s,r)=>s+r.waste,0),reserved:inputs.length*16};
}

export function prefixExperiment(prefix=12){
  const shared=Math.round(bound(prefix,0,24)),hit=Math.floor(shared/4)*4;
  return {shared,hit,remainder:shared-hit,prompt:28,prefill:28-hit,output:8,blockSize:4};
}

export function batchExperiment(policy='continuous'){
  const req=[{id:'A',length:6,arrival:0},{id:'B',length:2,arrival:0},{id:'C',length:4,arrival:2}].map(r=>({...r,done:0,started:null,finished:null}));
  const rounds=[];let cohort=[];
  for(let t=0;t<20&&req.some(r=>r.done<r.length);t++){
    const active=req.filter(r=>r.started!==null&&r.done<r.length);
    if(policy==='static'){
      if(!cohort.length||cohort.every(id=>req.find(r=>r.id===id).done===req.find(r=>r.id===id).length)){
        cohort=req.filter(r=>r.started===null&&r.arrival<=t).slice(0,2).map(r=>r.id);
        for(const id of cohort)req.find(r=>r.id===id).started=t;
      }
    }else{
      const arrivals=req.filter(r=>r.started===null&&r.arrival<=t).slice(0,2-active.length);
      arrivals.forEach(r=>r.started=t);
    }
    const executing=req.filter(r=>r.started!==null&&r.done<r.length);
    executing.forEach(r=>{r.done++;if(r.done===r.length)r.finished=t+1;});
    rounds.push({round:t+1,ids:executing.map(r=>r.id),idle:2-executing.length});
  }
  return {policy,requests:req,rounds,total:rounds.length,idle:rounds.reduce((s,r)=>s+r.idle,0),work:req.reduce((s,r)=>s+r.length,0)};
}

export function kvEstimate({layers=32,heads=8,dimension=128,bytes=2,tokens=8192}={}){
  const perToken=2*layers*heads*dimension*bytes;
  return {perToken,bytes:perToken*tokens,GiB:perToken*tokens/(1024**3)};
}
