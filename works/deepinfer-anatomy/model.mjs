// Educational models only. These are not DeepInfer performance measurements.
export const STAGES = [
  { name:'接住你的问题', en:'INPUT', short:'接单', title:'把一句话 变成机器能接的订单', analogy:'你走进印刷店，说「帮我把这份长稿浓缩成三句话」。店员先把要求和原稿整理成一张工单。', actual:'文字先按模型的词表编码成 token ID。Token 可以是一小段词、字或其他片段，并不固定等于一个汉字。服务协议转换属于外围接入层；DeepInfer 的离线示例也可以直接接收准备好的输入。', note:'图中的纸票只是数据的比喻 不是真实分词结果', example:['帮我','把这份长稿','总结成','三句话'], tag:'文本 → token 序列' },
  { name:'读懂整份来稿', en:'PREFILL', short:'读稿', title:'先通读原稿 才知道从哪里接着写', analogy:'编辑要先读完你递来的材料，记下前后关系；还没读完就动笔，很容易答非所问。', actual:'Prefill 对输入 token 做模型前向计算，为后续生成准备上下文状态。长输入通常意味着更多这一步的工作。这里的「读懂」是类比，不表示机器像人一样理解。', note:'首字等待也包含排队、接入等开销 不只这一项', example:['整份输入','模型前向','上下文状态','首个输出'], tag:'一次处理输入上下文' },
  { name:'留下可用的便笺', en:'KV STATE', short:'记住', title:'已经算过的线索 留着接下来使用', analogy:'编辑把关键线索记在桌边便笺上，写下一句时拿起来看，不必从头抄写每一页。', actual:'注意力中的 K/V 是可复用的中间张量，不是保存好的最终答案。DeepInfer 的核心计算会处理这些状态；跨请求、跨机器的完整 KV 缓存系统并没有随这次发行一起提供。', note:'SWA 局部状态的 bounded replay 属于另一个更细的机制', example:['之前的 K/V','新 token','读取并更新','继续生成'], tag:'复用中间计算' },
  { name:'让合适的模块干活', en:'MoE · EP', short:'分工', title:'把一份工作 分给被选中的工位', analogy:'一本书进印刷厂，不必让所有设备同时处理每张纸；需要装订的送装订，需要裁切的送裁切。', actual:'在 MoE 层，路由器按 token 表示选择专家，把计算分发出去，再合回结果。EP 把专家分布在设备上，EPLB 调整负载。专家是参数模块，并非按「数学老师」「语文老师」固定分科的人。', note:'注意力和专家层会在模型层中反复执行 不是只过一次', example:['路由','分发','专家计算','合并'], tag:'少量专家参与当前计算' },
  { name:'先打草稿 再安排校对', en:'DSpark', short:'校对', title:'先试写几步 把校对机会用在刀刃上', analogy:'学徒先试排几行，老师傅来核对。把握大的连续草稿值得多检查；开头就不靠谱的，后面也不能直接跳着交稿。', actual:'启用 DSpark 时，引擎用草稿和置信度信息调度验证。置信度关注草稿被主模型接受的可能性，不代表答案事实正确率。GPU 在预算内分配各请求的验证长度，保持连续前缀。', note:'并非所有优化都默认开启 真实接受与修正由验证和采样算法决定', example:['草稿候选','预测接受概率','分配验证预算','验证与修正'], tag:'推测执行 → 验证' },
  { name:'一段段交付回答', en:'DECODE', short:'出稿', title:'新片段接上旧片段 直到满足停止条件', analogy:'校对过的版面继续往出纸口走。刚印出的内容又成为下一段要接续的上下文，循环往复。', actual:'Decode 继续产生 token、更新状态，再进入下一轮。采样参数影响选取方式；结构化输出可以限制合法 token。达到结束标记或长度等条件后停止。网页聊天中的流式发送还需要服务接入层。', note:'这是一条教学主线 实际系统会重叠多个请求与多个阶段', example:['新 token','更新上下文','下一轮','结束'], tag:'生成 → 更新 → 循环' }
];

export const DRAFTS = [
  {name:'A',label:'总结短文',confidence:[.95,.82,.60]},
  {name:'B',label:'续写故事',confidence:[.88,.74,.52]},
  {name:'C',label:'解释概念',confidence:[.62,.48,.30]}
];

export function allocateDraftBudget(budget) {
  const n=Math.max(1,Math.min(9,Math.round(Number(budget)||1)));
  const candidates=DRAFTS.flatMap((row,r)=>{let p=1;return row.confidence.map((c,i)=>({r,i,score:p*=c}));});
  const chosen=candidates.slice().sort((a,b)=>b.score-a.score).slice(0,n);
  const counts=DRAFTS.map((_,r)=>chosen.filter(c=>c.r===r).length);
  return {budget:n,counts,candidates,chosen};
}

export function schedulingModel(overlap=true) {
  const cpu=2,gpu=5,n=4,rows=[];let cpuEnd=0,gpuEnd=0;
  for(let i=0;i<n;i++){
    const c0=overlap?cpuEnd:gpuEnd,c1=c0+cpu;
    const g0=Math.max(c1,gpuEnd),g1=g0+gpu;
    rows.push({i,c0,c1,g0,g1});cpuEnd=c1;gpuEnd=g1;
  }
  return {cpu,gpu,n,rows,total:gpuEnd,extent:n*(cpu+gpu)};
}
