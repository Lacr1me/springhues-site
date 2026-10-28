import * as k from './kit/iso-kit.mjs';
import * as A from './kit/audit.mjs';

// Original teaching object. Anatomy MIT supplies geometry, shading and auditing.
const WIDTH = 1000, HEIGHT = 660;
const BASE = { x:-165, y:-102, w:330, d:210, r:9 };
const DECK = 12;
const P = k.fitProjection([
  ...k.boxCorners(BASE,-12,12), ...k.boxCorners({x:-138,y:-88,w:283,d:80,r:0},12,90),
],WIDTH,HEIGHT,{pad:68,azimuth:57,elevation:36});
const iso = p => k.iso(p,P);
const line = (d,tone='lo',free=false) => k.lineSvg(d,{tone,free});
const outline = (p,z,inset=0,tone='faint') => line(k.planOutline(k.insetPlan(p,inset),z,P,4),tone);
const dots = (ps,tone='mid',size=.55) => k.dotsSvg(ps.map(iso),{tone,size});
const screws = (p,z,inset=3) => {
  const cs=k.corners(p,inset);
  return line(cs.map(([x,y])=>k.ring(x,y,.95,z,P,12)).join(''),'lo')+dots(cs.map(([x,y])=>[x,y,z]),'mid',.48);
};
const rules = (p,z,count=5,tone='lo') => Array.from({length:count},(_,i)=>
  line(k.lineOnTop([p.x+4,p.y+5+i*3.2],[p.x+p.w-4-(i%3)*3,p.y+5+i*3.2],z,P),tone,true)
).join('');
const vents = (p,z,count=7) => Array.from({length:count},(_,i)=>
  outline({x:p.x+3+i*3,y:p.y+3,w:1.2,d:p.d-6,r:.5},z,0,'lo')
).join('');
const frontOutline=(p,y,tone='lo')=>line(k.pathOf(k.roundedPlan(p,5).map(([x,z])=>iso([x,y,z])),true),tone);
const stationIds=['goal','context','decide','tool','observe','check'];
const stationX=[-124,-76,-20,74,24,124];
const rest=[-124,75,16];
const axis=k.axisVector(P,[1,0,0]);
const points=stationIds.map((step,i)=>({step,world:[stationX[i],75,16],x:(stationX[i]-rest[0])*axis[0],y:(stationX[i]-rest[0])*axis[1],anchor:iso([stationX[i],75,16])}));

export const MACHINE_CSS=k.ISO_CSS+`
.agent-machine{isolation:isolate;--anatomy-paper:#fff;--anatomy-top:#fff;--anatomy-face:#fff;--anatomy-shade-0:#b9c2d1;--anatomy-shade-1:#cad2df;--anatomy-shade-2:#dce2eb;--anatomy-shade-3:#edf0f6;--anatomy-hi:#586880;--anatomy-mid:#8290a8;--anatomy-lo:#a8b4c7;--anatomy-faint:#ccd5e2;--anatomy-dot:#596c89;--anatomy-halo:#15315e;--anatomy-halo-opacity:.12;--anatomy-weight:.68px;--anatomy-lit:#002fa7;--anatomy-lit-top:#fff;--anatomy-lit-shade:#e8edff;--anatomy-blue:#002fa7;--anatomy-red:#800020}
.agent-machine .am-blue{--anatomy-paper:#002fa7;--anatomy-top:#2855c2;--anatomy-face:#002fa7;--anatomy-shade-0:#001c68;--anatomy-shade-1:#00247f;--anatomy-shade-2:#002fa7;--anatomy-shade-3:#1645b4;--anatomy-hi:#193475;--anatomy-mid:#9db8ef;--anatomy-lo:#7398e5;--anatomy-faint:#4b76ce;--anatomy-dot:#e3ebff}
.agent-machine .am-wine{--anatomy-paper:#800020;--anatomy-top:#a33050;--anatomy-face:#800020;--anatomy-shade-0:#510015;--anatomy-shade-1:#69001b;--anatomy-shade-2:#800020;--anatomy-shade-3:#941936;--anatomy-hi:#5e0b22;--anatomy-mid:#db9aab;--anatomy-lo:#c87991;--anatomy-faint:#b2506b;--anatomy-dot:#ffe3eb}
.agent-machine .am-metal{--anatomy-paper:#adb7c7;--anatomy-top:#d5dce7;--anatomy-face:#adb7c7;--anatomy-shade-0:#6c7b93;--anatomy-shade-1:#8796ac;--anatomy-shade-2:#9daabe;--anatomy-shade-3:#b9c3d3;--anatomy-hi:#63748f;--anatomy-mid:#7e8fa8;--anatomy-lo:#9aa9bf;--anatomy-faint:#c7d0de}
.agent-machine .am-paper{--anatomy-paper:#fff;--anatomy-top:#fff;--anatomy-face:#fff;--anatomy-shade-0:#dae1ee;--anatomy-shade-1:#e5ebf5;--anatomy-shade-2:#edf1f8;--anatomy-shade-3:#f6f8fc}
.agent-machine .am-part{opacity:1;transition:filter .45s ease}
.agent-machine[data-focus] .am-part[data-station]{filter:saturate(.6)}
.agent-machine[data-focus] .am-part[data-active=true]{filter:saturate(1)}
.agent-machine [data-station-light]{fill:#d2ddf2;stroke:#7e96bb;stroke-width:.55;transition:fill .45s ease,stroke .45s ease}
.agent-machine [data-active=true] [data-station-light],.agent-machine [data-station-light][data-active=true]{fill:#002fa7;stroke:#002fa7}
.agent-machine [data-station=check][data-active=true] [data-station-light]{fill:#800020;stroke:#800020}
.agent-machine .am-screen-rule{stroke:#dce7ff}
@media(prefers-reduced-motion:reduce){.agent-machine .am-part,.agent-machine [data-station-light]{transition:none}}
`;

function geometry() {
  const R=A.recorder(P), front=[], moving=[];
  const put=(name,station,p,z,h,material='',detail='',options={})=>{
    const shape=R.solid(A.slab(p,z,h,{name,ground:options.ground??false},4));
    const svg=`<g class="am-part ${material}" data-part="${name}"${station?` data-station="${station}"`:''}>${k.solidSvg(k.slabOf(p,z,h,P,4,options.bevel??.65),{tone:options.tone??'mid',crease:'faint',lit:!!options.lit,inner:options.inner??''})}${detail}</g>`;
    const item=R.put({name,piece:options.moving?'carriage':'fixed',at:[p.x+p.w/2,p.y+p.d/2,z+h/2],svg,shapes:[shape]});
    if(options.moving)moving.push(item);
    if(options.front)front.push(item);
    return item;
  };
  // The table is supported by four actual feet, not a floating illustration.
  k.corners(BASE,21).forEach(([x,y],i)=>{
    put(`foot-${i}`,'',{x:x-7,y:y-6,w:14,d:12,r:2},-12,6,'am-metal','',{ground:true});
    put(`foot-mount-${i}`,'',{x:x-9,y:y-8,w:18,d:16,r:2},-6,3,'');
  });
  put('cast-base','',BASE,-3,13,'',screws(BASE,10,12),{bevel:1.5,tone:'lo',inner:line(k.sideSeam(BASE,3.5,P,4),'lo')});
  const deck=k.insetPlan(BASE,5);
  put('working-deck','',deck,10,2,'',outline(deck,12,4),{bevel:.5,tone:'lo'});
  const plaque={x:101,y:98,w:44,d:7,r:.8};
  put('maker-plate','',plaque,12,.7,'am-blue',k.faceTextSvg(k.topMatrix([123,103.2],12.7,P,'x'),'AGENT',{size:3.7,tone:'mid',anchor:'middle'})+dots([[104,101.6,12.7],[142,101.6,12.7]],'hi',.5),{bevel:.2,front:true});

  // Context cabinet: two real drawers. The extended upper floor supports cards.
  const ctx={x:-140,y:-84,w:72,d:65,r:2};
  put('context-floor','context',ctx,12,4,'');
  put('context-left-wall','context',{x:-140,y:-84,w:4,d:65,r:1},16,55,'');
  put('context-right-wall','context',{x:-72,y:-84,w:4,d:65,r:1},16,55,'');
  put('context-back-wall','context',{x:-136,y:-84,w:64,d:4,r:1},16,55,'am-blue');
  put('context-lid','context',{x:-141,y:-85,w:74,d:67,r:2},71,4,'',screws({x:-141,y:-85,w:74,d:67,r:2},75,4),{bevel:.8});
  put('context-lower-drawer','context',{x:-135.6,y:-79.5,w:63.2,d:60,r:1},16,19,'am-blue',outline({x:-135.6,y:-79.5,w:63.2,d:60,r:1},35,3));
  put('context-lower-handle','context',{x:-119,y:-19.5,w:31,d:4,r:1},23,4,'am-metal');
  for(const [i,x]of[-136,-73.7].entries())put(`context-drawer-runner-${i}`,'context',{x,y:-77,w:1.7,d:57,r:0},38,3,'am-metal');
  put('context-upper-floor','context',{x:-135.6,y:-79.5,w:63.2,d:75,r:1},41,3,'',outline({x:-135.6,y:-79.5,w:63.2,d:75,r:1},44,2));
  put('context-upper-front','context',{x:-135.6,y:-4.5,w:63.2,d:3,r:1},41,17,'',screws({x:-135.6,y:-4.5,w:63.2,d:3,r:1},58,1));
  put('context-upper-handle','context',{x:-119,y:-1.5,w:31,d:4,r:1},47,4,'am-blue');
  for(let i=0;i<2;i++){
    const card={x:-131+i*28,y:-67,w:24,d:56,r:1};
    put(`context-card-${i}`,'context',card,44,.8,i?'am-paper':'am-blue',rules(card,44.8,12,i?'lo':'mid'),{bevel:.15});
  }

  // A squat model console, with a paper planning window and three keys.
  put('console-plinth','decide',{x:-50,y:-86,w:98,d:83,r:4},12,5,'am-metal');
  const consolePlan={x:-46,y:-82,w:90,d:75,r:5};
  const access=frontOutline({x:-34,y:30,w:66,d:25,r:2},-7,'lo')+dots([[-30,-7,34],[28,-7,34],[-30,-7,51],[28,-7,51]],'mid',.52)+Array.from({length:8},(_,i)=>frontOutline({x:-22+i*6,y:39,w:2,d:8,r:1},-7,'lo')).join('');
  put('console-body','decide',consolePlan,17,49,'',outline(consolePlan,66,3)+access,{bevel:1.3,inner:line(k.sideSeam(consolePlan,24,P,5),'lo')});
  put('console-cap','decide',{x:-47,y:-83,w:92,d:77,r:4},66,4,'am-blue',screws({x:-47,y:-83,w:92,d:77,r:4},70,5),{bevel:.8});
  put('console-window-seat','decide',{x:-38,y:-72,w:74,d:46,r:3},70,3,'am-metal',outline({x:-38,y:-72,w:74,d:46,r:3},73,2));
  const screen={x:-34,y:-68,w:66,d:38,r:2};
  put('console-screen','decide',screen,73,.8,'am-blue',rules(screen,73.8,7,'mid'),{bevel:.2});
  const plan={x:-25,y:-18,w:48,d:10,r:.7};
  put('plan-card-window','decide',plan,70,.7,'am-paper',rules(plan,70.7,1,'blue'),{bevel:.1});
  const keyboard={x:-43,y:0,w:85,d:29,r:3};
  put('keyboard-board','decide',keyboard,12,4,'',screws(keyboard,16,4));
  for(let i=0;i<3;i++)put(`keyboard-key-${i}`,'decide',{x:-30+i*23,y:7,w:17,d:15,r:2},16,3.5,i===1?'am-blue':'',outline({x:-30+i*23,y:7,w:17,d:15,r:2},19.5,3),{bevel:.7});

  // Three removable tool cartridges. Each has an actual socket floor and grip.
  put('tool-socket-floor','tool',{x:64,y:-85,w:84,d:69,r:3},12,5,'am-metal',screws({x:64,y:-85,w:84,d:69,r:3},17,4));
  put('tool-backplane','tool',{x:64,y:-85,w:84,d:4,r:1},17,54,'am-blue');
  for(let i=0;i<3;i++){
    const x=68+i*26,mod={x,y:-77,w:23,d:56,r:2};
    put(`tool-cassette-${i}`,'tool',mod,17,40,i===1?'am-blue':'',outline(mod,57,3),{bevel:.9,inner:line(k.sideSeam(mod,24,P,4),'faint')});
    const cap={x:x-.3,y:-77.3,w:23.6,d:56.6,r:2};
    put(`tool-cap-${i}`,'tool',cap,57,3,i===1?'am-blue':'',screws(cap,60,3)+vents({x:x+1,y:-47,w:21,d:20,r:1},60,6),{bevel:.55});
    put(`tool-handle-${i}`,'tool',{x:x+4,y:-68,w:15,d:7,r:1.5},60,4,'am-metal',outline({x:x+6,y:-66,w:11,d:3,r:.6},64,0,'lo'));
  }

  // The goal arrives in a shallow in-tray, and evidence returns on a clipboard.
  const inbox={x:-145,y:10,w:67,d:36,r:2};
  put('inbox-floor','goal',inbox,12,3,'',outline(inbox,15,3));
  put('inbox-back-lip','goal',{x:-145,y:7,w:67,d:3,r:.8},12,11,'am-blue');
  put('inbox-left-lip','goal',{x:-148,y:7,w:3,d:39,r:.8},12,11,'');
  for(let i=0;i<2;i++){
    const page={x:-140+i*.8,y:13+i*.8,w:56,d:28,r:.7};
    put(`inbox-sheet-${i}`,'goal',page,15+i*.8,.8,'am-paper',i?rules(page,16.6,6):'',{bevel:.1});
  }
  const clipboard={x:47,y:6,w:40,d:37,r:2};
  put('receipt-clipboard','observe',clipboard,12,2.4,'am-blue',screws(clipboard,14.4,3));
  const receipt={x:51,y:11,w:32,d:28,r:.7};
  put('receipt-paper','observe',receipt,14.4,.8,'am-paper',rules(receipt,15.2,6,'blue'),{bevel:.1});
  put('receipt-clip-neck','observe',{x:61,y:6,w:12,d:4,r:.4},14.4,3,'am-metal');
  put('receipt-clip-cap','observe',{x:58,y:6,w:18,d:7,r:.7},17.4,2,'am-metal',outline({x:61,y:7,w:12,d:4,r:.5},19.4,0,'lo'));

  // The burgundy block is a permission/verification stamp, parked on its ink pad.
  const stampBase={x:104,y:3,w:39,d:42,r:3};
  put('check-pad-base','check',stampBase,12,3,'',screws(stampBase,15,4));
  put('check-ink-pad','check',{x:109,y:8,w:29,d:32,r:2},15,1.8,'am-wine',outline({x:109,y:8,w:29,d:32,r:2},16.8,2,'mid'));
  put('check-stamp-face','check',{x:114,y:15,w:19,d:19,r:1.3},16.8,4,'am-metal');
  put('check-stamp-stem','check',{x:120.5,y:21.5,w:6,d:6,r:1},20.8,17,'am-wine');
  put('check-stamp-grip','check',{x:114,y:15,w:19,d:19,r:4},37.8,6,'am-wine',outline({x:114,y:15,w:19,d:19,r:4},43.8,2,'lo'),{bevel:1.2});

  // A paper guide channel, not a conveyor: one hand-operated task sled can reverse.
  const track={x:-147,y:58,w:294,d:36,r:2};
  put('task-channel-floor','',track,12,2,'am-metal',outline(track,14,3));
  put('task-channel-back','',{x:-147,y:55,w:294,d:3,r:.8},12,5,'');
  put('task-channel-front','',{x:-147,y:94,w:294,d:3,r:.8},12,5,'',dots([[-142,95.5,17],[142,95.5,17]],'mid',.55),{front:true});
  for(const [i,x]of[-150,147].entries())put(`task-channel-stop-${i}`,'',{x,y:55,w:3,d:42,r:.8},12,5,'am-blue','',{front:i===1});
  const sled={x:rest[0]-16,y:62,w:32,d:27,r:1.8};
  put('task-sled','',sled,14,2,'am-blue',outline(sled,16,2,'lo'),{moving:true,bevel:.4});
  const task={x:rest[0]-13,y:65,w:26,d:21,r:.7};
  put('task-paper','',task,16,.8,'am-paper',rules(task,16.8,4,'blue'),{moving:true,lit:true,bevel:.1});
  put('task-card-clip','',{x:rest[0]-5,y:62,w:10,d:3,r:.6},16,1.3,'am-metal','',{moving:true,bevel:.2});

  const ruler={x:-142,y:100,w:216,d:4.5,r:.6};
  const ticks=k.topTicks(-138,70,4,5,100,12.6,[1.7,3.1],P);
  put('registration-scale','',ruler,12,.6,'',line(ticks.minor,'lo')+line(ticks.major,'mid'),{bevel:.15,front:true});
  const lamps={goal:[-124,48],context:[-76,48],decide:[-20,48],tool:[74,48],observe:[24,48],check:[124,48]};
  for(const step of stationIds){
    const[x,y]=lamps[step], lamp={x:x-5,y:y-2,w:10,d:4,r:1};
    const window={x:x-3,y:y-1,w:6,d:2,r:.7};
    put(`lamp-${step}`,step,lamp,12,.8,'',`<path data-station-light="${step}" d="${k.planOutline(window,12.8,P,5)}"/>`,{bevel:.2});
  }

  // Settle all fixed parts geometrically. Motion uses a deliberately clear lane.
  const staticItems=R.items.filter(it=>!moving.includes(it));
  const solved=A.overlapsOf(staticItems,P,{step:.45});
  const settled=A.orderKeys(staticItems,solved);
  staticItems.forEach((it,i)=>it.key=settled.keys[i]);
  // Put the carriage in one invariant slot, before the channel's near rim.
  const back=staticItems.filter(it=>!front.includes(it)).sort((a,b)=>a.key-b.key);
  front.sort((a,b)=>a.key-b.key);
  const movingSettled=A.orderKeys(moving,A.overlapsOf(moving,P,{step:.45}));
  moving.forEach((it,i)=>it.key=movingSettled.keys[i]);
  moving.sort((a,b)=>a.key-b.key);
  const ordered=[...back,...moving,...front];
  ordered.forEach((it,i)=>it.key=i);
  return {R,ordered,back,moving,front};
}

export function createMachine({audit=false}={}){
  const {R,ordered,back,moving,front}=geometry();
  if(audit)auditGeometry({R,ordered,moving});
  const body=`<title>Agent 任务调度台</title><desc>由 ${R.solids.length} 个实体零件组成的教学工作台。一张任务卡沿前方滑槽来回移动，后方抽屉保存资料，中央控制台提出下一步，右侧工具匣执行操作，回执夹板记录结果，勃艮第红印章负责检查。</desc><path class="iso-halo" d="${k.haloOf(k.insetPlan(BASE,-5),-12,6,P)}"/>${back.map(it=>it.svg).join('')}<g id="task-carriage" data-moving="task">${moving.map(it=>it.svg).join('')}</g>${front.map(it=>it.svg).join('')}`;
  const svg=k.figureSvg({width:WIDTH,height:HEIGHT,label:'Agent 任务调度台 任务卡在六个工作站之间来回移动',className:'agent-machine',body});
  const meta={width:WIDTH,height:HEIGHT,projection:P,partCount:R.solids.length,axis,points,stations:Object.fromEntries(points.map(p=>[p.step,p])),path:points.map(p=>({step:p.step,world:p.world,screen:[p.x,p.y]})),rest,range:[0,248],label:'Agent 任务调度台',motion:'translate'};
  return {svg,css:MACHINE_CSS,meta};
}

function auditGeometry({R,ordered,moving}){
  const support=A.supports(R.solids,R.tubes);
  const shapeCoverage=A.coverage(R.items,P);
  const failures=[];
  if(support.loose?.length||support.sunk?.length||support.hanging?.length)failures.push({support});
  if(shapeCoverage.length)failures.push({shapeCoverage});
  const deltas=[...new Set([...Array.from({length:63},(_,i)=>i*4),...points.map(p=>p.world[0]-rest[0])])];
  const states=deltas.map(delta=>({label:`task x +${delta}`,shares:{carriage:delta/248}}));
  const movingItems=ordered.map(it=>moving.includes(it)?{...it,move:[248,0,0]}:it);
  const sweptOverlaps=A.overlapsOf(movingItems,P,{step:.45,states,skip:(a,b)=>a.piece==='fixed'&&b.piece==='fixed'});
  // Deliberately pass unchanged keys: the runtime DOM order is invariant.
  const sweptDepth=A.depthOrder(ordered,P,{overlaps:sweptOverlaps,rest:states});
  if(sweptDepth.problems.length)failures.push({movingDepth:sweptDepth.problems});
  const still=ordered.filter(it=>!moving.includes(it));
  const stillOverlaps=A.overlapsOf(still,P,{step:.45});
  const stillDepth=A.depthOrder(still,P,{overlaps:stillOverlaps});
  if(stillDepth.problems.length)failures.push({fixedDepth:stillDepth.problems});
  // Sample the entire reversible lane, including every station and both ends.
  for(const delta of deltas){
    const posed=ordered.map(it=>moving.includes(it)?{...it,shapes:it.shapes.map(s=>A.moved(s,[delta,0,0]))}:it);
    // Every moving solid is directly tested against every fixed solid.
    for(const item of posed.filter(it=>moving.some(m=>m.name===it.name))){
      for(const shape of item.shapes){
        const b=A.boundsOf(shape),corners=k.boxCorners({x:b.min[0],y:b.min[1],w:b.max[0]-b.min[0],d:b.max[1]-b.min[1],r:0},b.min[2],b.max[2]);
        for(const fixed of R.solids.filter(s=>!moving.some(m=>m.shapes.includes(s)))){
          if(corners.some(p=>A.sdf(fixed,p)<-.15))failures.push({delta,collision:[shape.name,fixed.name]});
        }
      }
    }
  }
  console.log(JSON.stringify({parts:R.solids.length,poses:deltas.length,overlapPairs:sweptOverlaps.pairs.length,support,shapeCoverage,failures},null,2));
  if(failures.length){console.error('audit failed');process.exitCode=1;}else console.log('audit passed');
}

if(process.argv.includes('--audit'))createMachine({audit:true});
