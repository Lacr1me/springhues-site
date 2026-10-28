import * as k from './kit/iso-kit.mjs';
import * as A from './kit/audit.mjs';

// Original library-desk metaphor; Anatomy MIT supplies projections and solids.
const W=1000,H=680,BASE={x:-176,y:-130,w:352,d:259,r:10},Z=11;
const P=k.fitProjection([...k.boxCorners(BASE,-12,11),[-106,-118,30],[164,44,32]],W,H,{pad:68,azimuth:49,elevation:43});
const at=p=>k.iso(p,P),line=(d,tone='lo',free=false)=>k.lineSvg(d,{tone,free});
const outline=(p,z,inset=0,tone='faint')=>line(k.planOutline(k.insetPlan(p,inset),z,P,4),tone);
const dots=(ps,tone='mid',size=.5)=>k.dotsSvg(ps.map(at),{tone,size});
const screws=(p,z,inset=3)=>{
  const cs=k.corners(p,inset);
  return line(cs.map(([x,y])=>k.ring(x,y,.95,z,P,12)).join(''),'lo')+dots(cs.map(([x,y])=>[x,y,z]),'mid',.45);
};
const textRules=(p,z,count=4,tone='lo')=>Array.from({length:count},(_,i)=>line(k.lineOnTop([p.x+3,p.y+4+i*3.5],[p.x+p.w-4-(i%3)*2.7,p.y+4+i*3.5],z,P),tone,true)).join('');
const axis=k.axisVector(P,[1,0,0]);
const headTravel={dx:176*axis[0],dy:176*axis[1]};
const stationOffsets=Object.fromEntries([['input',0],['prefill',.30],['decode',.68],['output',1]].map(([id,t])=>[id,{x:headTravel.dx*t,y:headTravel.dy*t,dx:headTravel.dx*t,dy:headTravel.dy*t,t}]));

// Reuse only the kit's SVG renderer styles, scoped to this figure. Its optional
// page/card CSS is deliberately excluded so integration cannot change layouts.
const rendererCSS=k.ISO_CSS.slice(k.ISO_CSS.indexOf('.iso-svg{'),k.ISO_CSS.indexOf('@keyframes iso-flow')).replace(/([^{}]+)\{/g,(_,selectors)=>selectors.split(',').map(s=>{
  const selector=s.trim();return selector.startsWith('.iso-svg')?selector.replace('.iso-svg','.vllm-machine'):'.vllm-machine '+selector;
}).join(',')+'{');
export const MACHINE_CSS=rendererCSS+`
.vllm-machine{isolation:isolate;--anatomy-paper:#fff;--anatomy-top:#fff;--anatomy-face:#fff;--anatomy-shade-0:#bac5d6;--anatomy-shade-1:#cbd5e3;--anatomy-shade-2:#dde5ee;--anatomy-shade-3:#eef2f7;--anatomy-hi:#526780;--anatomy-mid:#8193ad;--anatomy-lo:#acb9cc;--anatomy-faint:#cad5e4;--anatomy-dot:#5e7291;--anatomy-halo:#15345e;--anatomy-halo-opacity:.12;--anatomy-weight:.66px;--anatomy-lit:#002fa7;--anatomy-lit-top:#fff;--anatomy-lit-shade:#eaf0ff;--anatomy-blue:#002fa7;--anatomy-red:#800020}
.vllm-machine .vm-blue,.vllm-machine [data-cache-page][data-state=A]{--anatomy-paper:#002fa7;--anatomy-face:#002fa7;--anatomy-top:#2252c3;--anatomy-shade-0:#001d65;--anatomy-shade-1:#00257f;--anatomy-shade-2:#002fa7;--anatomy-shade-3:#1243b5;--anatomy-hi:#18347c;--anatomy-mid:#a1b9ee;--anatomy-lo:#86a9ef;--anatomy-faint:#5583d7;--anatomy-dot:#e0eaff}
.vllm-machine .vm-wine,.vllm-machine [data-cache-page][data-state=B]{--anatomy-paper:#800020;--anatomy-face:#800020;--anatomy-top:#a12a4c;--anatomy-shade-0:#540017;--anatomy-shade-1:#69001c;--anatomy-shade-2:#800020;--anatomy-shade-3:#951735;--anatomy-hi:#5b1024;--anatomy-mid:#e2a1b2;--anatomy-lo:#d28a9f;--anatomy-faint:#ba5973;--anatomy-dot:#ffe2ea}
.vllm-machine .vm-metal{--anatomy-paper:#a8b5c8;--anatomy-face:#a8b5c8;--anatomy-top:#d4deeb;--anatomy-shade-0:#6b7d97;--anatomy-shade-1:#8497b1;--anatomy-shade-2:#a0b0c6;--anatomy-shade-3:#bac8da;--anatomy-hi:#617996;--anatomy-mid:#7a91ae;--anatomy-lo:#a2b5ce;--anatomy-faint:#bdccde}
.vllm-machine [data-cache-page]{opacity:1;transition:opacity .4s ease,filter .4s ease}
.vllm-machine [data-cache-page] .iso-top,.vllm-machine [data-cache-page] .iso-shade,.vllm-machine [data-cache-page] .iso-fill{transition:fill .4s ease}
.vllm-machine [data-cache-page][data-state=free]{opacity:.18}
.vllm-machine [data-cache-page][data-state=C]{--anatomy-paper:#12203f;--anatomy-face:#12203f;--anatomy-top:#263857;--anatomy-shade-0:#09122b;--anatomy-shade-1:#0e1935;--anatomy-shade-2:#12203f;--anatomy-shade-3:#1d2e4f;--anatomy-hi:#0d1a34;--anatomy-mid:#a1b1cd;--anatomy-lo:#92a5c6;--anatomy-faint:#536b94;--anatomy-dot:#e0e8f7}
.vllm-machine [data-cache-page][data-state=shared]{--anatomy-paper:#dce5fc;--anatomy-face:#dce5fc;--anatomy-top:#dce5fc;--anatomy-shade-0:#778fcb;--anatomy-shade-1:#91a6d8;--anatomy-shade-2:#b0c1e9;--anatomy-shade-3:#c6d4f4;--anatomy-hi:#778fcb;--anatomy-mid:#6781bd;--anatomy-lo:#778fcb;--anatomy-faint:#aabce5;--anatomy-dot:#526fae}
.vllm-machine .vm-shared-mark{opacity:0;fill:#800020;stroke:none;transition:opacity .4s ease}
.vllm-machine .vm-shared-mark+.vm-shared-mark{fill:#002fa7}
.vllm-machine [data-state=shared] .vm-shared-mark{opacity:1}
.vllm-machine [data-cache-page][data-selected=true]{filter:drop-shadow(0 0 2px #002fa74d)}
.vllm-machine .vm-part{opacity:1}
.vllm-machine #reader-head{will-change:transform}
.vllm-machine .iso-face-text{font-family:ui-monospace,Consolas,monospace}
@media(prefers-reduced-motion:reduce){.vllm-machine [data-cache-page],.vllm-machine [data-cache-page] .iso-top,.vllm-machine [data-cache-page] .iso-fill,.vllm-machine [data-cache-page] .iso-shade,.vllm-machine .vm-shared-mark{transition:none}}
`;

function geometry(){
  const R=A.recorder(P),moving=[],front=[],pages=[];
  const put=(name,p,z,h,{material='',detail='',station='',bevel=.6,ground=false,mobile=false,fore=false,page=null,ring=null,inner=''}={})=>{
    const polygon=ring??k.roundedPlan(p,4);
    const shape=R.solid(A.extruded(polygon,z,h,{name,ground}));
    const solid=k.solidSvg(ring?k.extrude(ring,z,h,P,{convex:false,bevel}):k.slabOf(p,z,h,P,4,bevel),{tone:ground?'lo':'mid',crease:'faint',inner});
    const svg=`<g class="vm-part ${material}" data-part="${name}"${station?` data-station="${station}"`:''}${page!==null?` data-cache-page="${page}" data-state="${['A','B','C','shared'][page%4]}"`:''}>${solid}${detail}</g>`;
    const item=R.put({name,piece:mobile?'reader':'fixed',at:[p.x+p.w/2,p.y+p.d/2,z+h/2],shapes:[shape],svg});
    if(mobile)moving.push(item);if(fore)front.push(item);return item;
  };
  k.corners(BASE,23).forEach(([x,y],i)=>{
    put(`rubber-foot-${i}`,{x:x-8,y:y-7,w:16,d:14,r:2},-12,6,{material:'vm-metal',ground:true});
    put(`foot-socket-${i}`,{x:x-10,y:y-9,w:20,d:18,r:2},-6,3);
  });
  put('cast-base',BASE,-3,12,{detail:screws(BASE,9,13),bevel:1.4,inner:line(k.sideSeam(BASE,3,P,4),'lo')});
  const deck=k.insetPlan(BASE,5);
  put('working-deck',deck,9,2,{detail:outline(deck,11,4),bevel:.5});
  const pool={x:-106,y:-117,w:204,d:190,r:4};
  put('page-pool-bed',pool,Z,5,{material:'vm-metal',detail:screws(pool,16,5),bevel:1});

  // Each tray is one bottom, one concave U-frame and one separate sheet.
  // The U opens toward the reader. All drawn concave geometry is recorded exactly.
  for(let row=0;row<4;row++)for(let column=0;column<4;column++){
    const index=row*4+column,x=-98+column*49,y=-108+row*45,p={x,y,w:40,d:35,r:1.8};
    put(`tray-${index}-floor`,p,16,1.5,{detail:outline(p,17.5,2),bevel:.35});
    const t=1.8,ring=[[x,y+35],[x,y],[x+40,y],[x+40,y+35],[x+40-t,y+35],[x+40-t,y+t],[x+t,y+t],[x+t,y+35]];
    put(`tray-${index}-rim`,p,17.5,2,{ring,bevel:.25,detail:dots([[x+.9,y+.9,19.5],[x+39.1,y+.9,19.5]],'mid',.4)});
    const paper={x:x+4,y:y+4,w:32,d:27,r:.7};
    const marker1=k.planOutline({x:x+26,y:y+25,w:7,d:2,r:.35},18.35,P,4);
    const marker2=k.planOutline({x:x+16,y:y+25,w:7,d:2,r:.35},18.35,P,4);
    put(`cache-page-${index}`,paper,17.5,.85,{page:index,bevel:.1,detail:textRules(paper,18.35,5)+`<path class="vm-shared-mark" d="${marker1}"/><path class="vm-shared-mark" d="${marker2}"/>`});
    pages.push({index,row,column,world:[x+20,y+17.5,18.35],anchor:at([x+20,y+17.5,18.35])});
  }
  put('pool-rear-fence',{x:-106,y:-121,w:204,d:4,r:1},Z,13,{material:'vm-blue',detail:dots([[-100,-119,24],[92,-119,24]],'mid',.55)});

  // Two side-mounted dispatch clips, each fastened to the desk.
  for(const [side,x,station]of[['in',-163,'input'],['out',119,'output']]){
    const clip={x,y:-49,w:44,d:91,r:3};
    put(`${side}-clipboard`,clip,Z,3,{station,material:side==='in'?'vm-blue':'vm-wine',detail:screws(clip,14,4),bevel:.8});
    const sheet={x:x+4,y:-41,w:36,d:78,r:.8};
    put(`${side}-request-sheet`,sheet,14,.8,{station,detail:textRules(sheet,14.8,18,'lo'),bevel:.1});
    put(`${side}-clip-neck`,{x:x+16,y:-49,w:12,d:5,r:.8},14,4,{station,material:'vm-metal'});
    put(`${side}-clip-cap`,{x:x+11,y:-49,w:22,d:9,r:1.2},18,2.4,{station,material:'vm-metal',detail:outline({x:x+14,y:-47,w:16,d:4,r:.7},20.4,0,'lo')});
  }

  // A reader rides its own unobstructed rail. It never sweeps across the page pool.
  const rail={x:-111,y:83,w:222,d:31,r:2};
  put('reader-bed',rail,Z,3,{material:'vm-metal',detail:outline(rail,14,3),bevel:.6});
  put('reader-rear-guide',{x:-111,y:80,w:222,d:3,r:.8},Z,7,{detail:dots([[-104,81.5,18],[104,81.5,18]],'mid',.5)});
  put('reader-front-guide',{x:-111,y:114,w:222,d:3,r:.8},Z,7,{fore:true,detail:dots([[-104,115.5,18],[104,115.5,18]],'mid',.5)});
  for(const [i,x]of[-115,111].entries())put(`reader-stop-${i}`,{x,y:80,w:4,d:37,r:1},Z,8,{material:'vm-blue',fore:i===1});
  const head={x:-104,y:87,w:32,d:23,r:2.5};
  put('reader-slide',head,14,3,{mobile:true,material:'vm-metal',detail:outline(head,17,2),bevel:.5});
  const body={x:-101,y:89,w:26,d:19,r:2};
  put('reader-casing',body,17,13,{mobile:true,material:'vm-blue',detail:screws(body,30,3),bevel:.8,inner:line(k.sideSeam(body,21,P,4),'lo')});
  const glass={x:-97,y:93,w:18,d:11,r:1.2};
  put('reader-lens',glass,30,.8,{mobile:true,material:'vm-metal',detail:outline({x:-95,y:95,w:14,d:7,r:.8},30.8,0,'blue'),bevel:.2});
  const ruler={x:-110,y:121,w:178,d:4,r:.7},ticks=k.topTicks(-106,64,4,5,121,11.6,[1.6,2.8],P);
  put('scan-ruler',ruler,Z,.6,{fore:true,detail:line(ticks.minor,'lo')+line(ticks.major,'mid'),bevel:.2});
  const plaque={x:119,y:105,w:40,d:10,r:1};
  put('maker-plate',plaque,Z,.8,{fore:true,material:'vm-blue',detail:k.faceTextSvg(k.topMatrix([139,112],11.8,P,'x'),'vLLM',{size:4.4,tone:'mid',anchor:'middle'})+dots([[122,110,11.8],[156,110,11.8]],'mid',.5),bevel:.3});

  // Solve from real surfaces, not centre depth or hand-adjusted biases.
  A.settle(R,P,{step:.45});
  const back=R.items.filter(it=>!moving.includes(it)&&!front.includes(it)).sort((a,b)=>a.key-b.key);
  moving.sort((a,b)=>a.key-b.key);front.sort((a,b)=>a.key-b.key);
  const ordered=[...back,...moving,...front];ordered.forEach((it,i)=>it.key=i);
  return{R,back,moving,front,ordered,pages};
}

export function createMachine({audit=false}={}){
  const g=geometry();if(audit)auditGeometry(g);
  const body=`<title>vLLM 活页档案调度台</title><desc>共有 ${g.R.solids.length} 个实体零件。十六个固定浅托盘保存独立缓存纸页，左右文件夹代表请求和结果，前方共享读写头在安全导轨内滑动。物理造型为教学比喻，不表示真实硬件比例或扫描方式。</desc><path class="iso-halo" d="${k.haloOf(k.insetPlan(BASE,-5),-12,6,P)}"/>${g.back.map(it=>it.svg).join('')}<g id="reader-head">${g.moving.map(it=>it.svg).join('')}</g>${g.front.map(it=>it.svg).join('')}`;
  return{svg:k.figureSvg({width:W,height:H,label:'vLLM 活页档案调度台 十六个独立缓存页槽与共享读写头',className:'vllm-machine',body}),css:MACHINE_CSS,meta:{width:W,height:H,partCount:g.R.solids.length,projection:P,headTravel,stationOffsets,pages:g.pages,pageCount:16,headAxis:axis,headRange:[0,176],headRest:[-88,98.5,17],pageStateAttribute:'data-state',pageStates:['free','A','B','C','shared']}};
}

function auditGeometry({R,ordered,moving}){
  const base=A.audit(R,P),baseFailures=A.failures(base);
  const deltas=Array.from({length:45},(_,i)=>i*4),states=deltas.map(dx=>({label:`reader +${dx}`,shares:{reader:dx/176}}));
  const posed=ordered.map(it=>moving.includes(it)?{...it,move:[176,0,0]}:it);
  const overlaps=A.overlapsOf(posed,P,{step:.45,states,skip:(a,b)=>a.piece==='fixed'&&b.piece==='fixed'});
  const depth=A.depthOrder(ordered,P,{overlaps,rest:states});
  const fixed=R.solids.filter(s=>!moving.some(it=>it.shapes.includes(s))),collisions=[];
  for(const dx of deltas)for(const it of moving)for(const original of it.shapes){
    const shape=A.moved(original,[dx,0,0]),b=A.boundsOf(shape);
    const probes=k.boxCorners({x:b.min[0],y:b.min[1],w:b.max[0]-b.min[0],d:b.max[1]-b.min[1],r:0},b.min[2],b.max[2]);
    for(const other of fixed)if(probes.some(p=>A.sdf(other,p)<-.15))collisions.push({dx,a:shape.name,b:other.name});
  }
  console.log(A.report(base));
  console.log(JSON.stringify({parts:R.solids.length,poses:deltas.length,movingDepthPairs:overlaps.pairs.length,baseFailures,movingDepthErrors:depth.problems,collisions},null,2));
  if(baseFailures||depth.problems.length||collisions.length){process.exitCode=1;console.error('audit failed');}else console.log('audit passed');
}
if(process.argv.includes('--audit'))createMachine({audit:true});
