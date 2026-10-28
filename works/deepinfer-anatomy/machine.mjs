import * as k from './vendor/anatomy/iso-kit.mjs';

// Original physical teaching metaphor; geometry primitives reuse Anatomy (MIT).
// The machine is illustrative: module/card counts are not DeepInfer parameters.
const W = 700, H = 450;
const BASE = { x: -164, y: -70, w: 336, d: 136, r: 8 };
const P = k.fitProjection([
  ...k.boxCorners({ x: -196, y: -74, w: 396, d: 146, r: 0 }, -13, 0),
  [-80, -64, 80], [75, 46, 76], [190, 45, 30],
], W, H, { pad: 57, azimuth: 58, elevation: 32 });
const point = p => k.iso(p, P);
const line = (d, tone = 'lo', free = false) => k.lineSvg(d, { tone, free });
const dots = (ps, tone = 'mid', size = .55) => k.dotsSvg(ps.map(point), { tone, size });
const outline = (p, z, inset = 0, tone = 'faint') => line(k.planOutline(k.insetPlan(p, inset), z, P, 4), tone);
const screwSet = (p, z, inset = 3) => {
  const cs = k.corners(p, inset);
  return line(cs.map(([x,y]) => k.ring(x, y, 1.15, z, P, 12)).join(''), 'lo')
    + dots(cs.map(([x,y]) => [x,y,z]), 'mid', .48);
};
const ruleSet = (p, z, count = 4, tone = 'lo') => Array.from({ length: count }, (_, i) => {
  const y = p.y + 5 + i * 3.1;
  const len = p.w - 11 - (i % 3) * 4;
  return line(k.lineOnTop([p.x+5,y], [p.x+5+len,y], z, P), tone, true);
}).join('');
const slotSet = (p, z, count = 5) => Array.from({ length: count }, (_, i) =>
  outline({ x:p.x+3+i*3.2, y:p.y+3, w:1.25, d:p.d-6, r:.6 }, z, 0, 'lo')
).join('');

export const MACHINE_CSS = k.ISO_CSS + `
.machine-svg{isolation:isolate;--anatomy-paper:#f7f8fc;--anatomy-top:#fff;--anatomy-face:#fff;--anatomy-shade-0:#bec6d4;--anatomy-shade-1:#ccd3df;--anatomy-shade-2:#dce2eb;--anatomy-shade-3:#ebeff5;--anatomy-hi:#596780;--anatomy-mid:#7b88a0;--anatomy-lo:#a7b1c1;--anatomy-faint:#c6cedb;--anatomy-dot:#475773;--anatomy-halo:#233455;--anatomy-halo-opacity:.14;--anatomy-weight:.64px;--anatomy-lit:#002fa7;--anatomy-lit-top:#fff;--anatomy-lit-shade:#e6ecfc;--anatomy-blue:#002fa7;--anatomy-red:#800020}
.machine-svg .machine-blue{--anatomy-paper:#002fa7;--anatomy-top:#184ec4;--anatomy-shade-0:#001d69;--anatomy-shade-1:#00257f;--anatomy-shade-2:#002fa7;--anatomy-shade-3:#1044b9;--anatomy-hi:#092b80;--anatomy-mid:#79a0ef;--anatomy-lo:#6d93df;--anatomy-faint:#3265d2;--anatomy-dot:#d5e2ff}
.machine-svg .machine-wine{--anatomy-paper:#800020;--anatomy-top:#a32849;--anatomy-shade-0:#570018;--anatomy-shade-1:#6a001b;--anatomy-shade-2:#800020;--anatomy-shade-3:#941332;--anatomy-hi:#5c001b;--anatomy-mid:#d78a9d;--anatomy-lo:#c8758b;--anatomy-faint:#b34662;--anatomy-dot:#ffe2e9}
.machine-svg .machine-graphite{--anatomy-paper:#748198;--anatomy-top:#aeb8c8;--anatomy-shade-0:#66748d;--anatomy-shade-1:#78869d;--anatomy-shade-2:#8b97aa;--anatomy-shade-3:#9eaabb;--anatomy-hi:#586981;--anatomy-mid:#53647e;--anatomy-lo:#77869e;--anatomy-faint:#b6c0cf}
.machine-svg .machine-paper{--anatomy-paper:#fff;--anatomy-top:#fff;--anatomy-shade-0:#d9deea;--anatomy-shade-1:#e5e9f1;--anatomy-shade-2:#edf0f7;--anatomy-shade-3:#f7f9fc;--anatomy-mid:#7990b0;--anatomy-lo:#9dafc8;--anatomy-faint:#d6deeb}
.machine-svg .machine-part{transition:opacity .5s ease,filter .5s ease}
.machine-svg[data-focus] .machine-part[data-station]{opacity:1;filter:saturate(.65)}
.machine-svg[data-focus] .machine-part[data-active="true"]{opacity:1;filter:drop-shadow(0 1px 2px #002fa722)}
.machine-svg .iso-edge{transition:stroke .5s ease}
@media(prefers-reduced-motion:reduce){.machine-svg .machine-part,.machine-svg .iso-edge{transition:none}}
`;

export const MACHINE_META = {
  width: W, height: H, projection: P,
  ticketAxis: k.axisVector(P, [1, 0, 0]),
  proofAxis: k.axisVector(P, [0, 0, -1]),
  proofMaxStroke: 6.25,
  ticketTravel: 327,
  // Translate the one ticket by these world-x offsets for the six teaching stops.
  stationStops: [0, 61, 90, 165, 247, 327],
  label: '一台等距推理印刷工作台 纸票依次经过阅读头 记忆抽屉 专家模块 红色校对机构和出纸托盘',
};

export function buildMachine() {
  let count = 0;
  const layers = new Map();
  const add = (layer, station, name, p, z, h, material = '', detail = '', options = {}) => {
    count++;
    const entry = `<g class="machine-part ${material}" data-station="${station}" data-machine-part="${name}">${k.solidSvg(k.slabOf(p,z,h,P,4,options.bevel ?? .65), { tone:options.tone ?? 'mid', crease:'faint', lit:!!options.lit, inner:options.inner || '' })}${detail}</g>`;
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push({ svg:entry, depth:k.depthOf([p.x+p.w/2,p.y+p.d/2,z+h/2],P) });
  };
  const push = (layer, svg, depth = 0) => {
    if (!layers.has(layer)) layers.set(layer, []);
    layers.get(layer).push({svg,depth});
  };
  // +y faces the viewer. An entire gantry cannot share one paint layer:
  // rear legs < transport < ticket < plunger < near legs < bridge.
  const gantryLayers = [
    {foot:10.1,pillar:10.2},
    {foot:16.5,pillar:17},
  ];
  const paperBase = 23.8;
  push(0, `<path class="iso-halo" d="${k.haloOf(k.insetPlan(BASE,-4),-13,5,P)}"/>`);
  // A heavy cast base sits on four small square elastomer feet.
  k.corners(BASE,20).forEach(([x,y],i) => {
    add(1, 0, `rubber-foot-${i}`, {x:x-7,y:y-6,w:14,d:12,r:2}, -13, 5, 'machine-graphite');
    add(2, 0, `foot-mount-${i}`, {x:x-8.5,y:y-7.5,w:17,d:15,r:2}, -8, 3);
  });
  add(3, 0, 'cast-base', BASE, -5, 12, '', screwSet(BASE,7,12), {bevel:1.5,inner:line(k.sideSeam(BASE,0,P,4),'lo')});
  const deck = k.insetPlan(BASE,5);
  add(4, 0, 'working-deck', deck, 7, 1.6, '', outline(deck,8.6,4,'faint'), {bevel:.5});

  // Memory cabinet: two real open-front drawers; cards seat in the upper tray.
  const mem = {x:-117,y:-61,w:58,d:37,r:2};
  add(5, 2, 'memory-floor', mem, 8.6, 4, '');
  add(6, 2, 'memory-left-wall', {x:-117,y:-61,w:4,d:37,r:1}, 12.6, 34, '');
  add(6, 2, 'memory-right-wall', {x:-63,y:-61,w:4,d:37,r:1}, 12.6, 34, '');
  add(7, 2, 'memory-drawer-lower', {x:-112.7,y:-59,w:49.4,d:37,r:1}, 13, 10, 'machine-blue', outline({x:-112.7,y:-59,w:49.4,d:37,r:1},23,2,'faint'));
  add(7, 2, 'memory-drawer-upper', {x:-112.7,y:-55,w:49.4,d:40,r:1}, 27, 11, '', outline({x:-112.7,y:-55,w:49.4,d:40,r:1},38,2,'lo'));
  add(8, 2, 'memory-handle-lower', {x:-99,y:-22,w:22,d:3,r:.7}, 16, 3, 'machine-graphite');
  add(8, 2, 'memory-handle-upper', {x:-99,y:-15,w:22,d:3,r:.7}, 30, 3, 'machine-blue');
  for(let i=0;i<3;i++) {
    const card={x:-108+i*13.5,y:-52,w:10,d:26,r:.8};
    add(9, 2, `memory-card-${i}`, card,38, .85, i===1?'machine-blue':'machine-paper', ruleSet(card,38.85,4,i===1?'mid':'lo'), {bevel:.2});
  }
  add(10, 2, 'memory-cabinet-lid', {x:-118,y:-62,w:60,d:34,r:2.2},46.6,3.4,'',screwSet({x:-118,y:-62,w:60,d:34,r:2.2},50,4));

  // Replaceable expert modules. Their common rack is part of the same machine.
  add(5, 3, 'expert-socket-bed', {x:-43,y:-55,w:100,d:51,r:2},8.6,7,'machine-graphite');
  add(6, 3, 'expert-backplane', {x:-43,y:-55,w:100,d:5,r:1.2},15.6,49,'machine-blue', dots([[-36,-52.5,64.6],[50,-52.5,64.6]],'hi',.6));
  for(let i=0;i<3;i++) {
    const x=-39+i*32;
    const shell={x,y:-48,w:26,d:39,r:2.1};
    add(7,3,`expert-cassette-${i}`,shell,15.6,38,i===1?'machine-blue':'',outline(shell,53.6,2.7,'faint'),{bevel:1,inner:line(k.sideSeam(shell,22,P,4),'faint')});
    const cap={x:x+1,y:-47,w:24,d:37,r:1.7};
    add(8,3,`expert-cap-${i}`,cap,53.6,3.3,i===1?'machine-blue':'',screwSet(cap,56.9,3),{bevel:.6});
    add(9,3,`expert-lift-handle-${i}`,{x:x+5,y:-34,w:16,d:5,r:1},56.9,3.5,'machine-graphite',outline({x:x+7,y:-33,w:12,d:3,r:.4},60.4,0,'lo'));
    const vents={x:x+3,y:-23,w:20,d:10,r:.6};
    add(9,3,`expert-cooling-fins-${i}`,vents,56.9,.7,i===1?'machine-blue':'',slotSet(vents,57.6,5),{bevel:.2});
  }

  // Transport: the paper bed is mechanically fixed between two guide rails.
  add(11,1,'transport-bed',{x:-142,y:0,w:279,d:40,r:2},8.6,12,'machine-graphite');
  add(11.5,1,'feed-belt',{x:-142,y:3,w:279,d:34,r:.8},20.6,paperBase-20.6,'machine-graphite','',{bevel:.25});
  for(const [i,y] of [-1,37].entries()) {
    add(i===0?11.25:12,1,`guide-rail-${i}`,{x:-142,y,w:279,d:3,r:.8},20.6,4.3,'',outline({x:-142,y,w:279,d:3,r:.8},24.9,.6,'lo'),{bevel:.4});
    for(const [j,x] of [-144,133].entries()) add(i===0?11.3:13,1,`rail-shoe-${i}-${j}`,{x,y:y-1,w:6,d:5,r:.8},20.6,5.3,'',screwSet({x,y:y-1,w:6,d:5,r:.8},25.9,1.4),{bevel:.4});
  }
  for(const [i,x] of [-145,137].entries()) add(14,1,`bed-stop-${i}`,{x,y:4,w:3,d:30,r:.5},20.6,2.4,'machine-blue');

  // Input tray on the left, with thin real paper layers and raised tray lips.
  const tray={x:-194,y:1,w:52,d:40,r:2.2};
  add(11,0,'input-tray-floor',tray,17,3.6,'',outline(tray,20.6,3,'faint'));
  add(12,0,'input-tray-rear-lip',{x:-194,y:0,w:52,d:2.5,r:.7},20.6,4,'machine-blue');
  add(12,0,'input-tray-near-lip',{x:-194,y:39,w:52,d:2.5,r:.7},20.6,4,'machine-blue');
  add(12,0,'input-paper-stop',{x:-195,y:0,w:2.5,d:42,r:.7},20.6,6,'');
  for(let i=0;i<3;i++){
    const sheet={x:-190+i*.8,y:5+i*.7,w:45,d:31,r:.65};
    const thickness=(paperBase-20.6)/3;
    add(13,0,`input-sheet-${i}`,sheet,20.6+i*thickness,thickness,'machine-paper',i===2?ruleSet(sheet,paperBase,6):'',{bevel:0});
  }

  // One moving ticket, intentionally isolated for the shared page model.
  const ticket={x:-178,y:5,w:35,d:29,r:.8};
  const ticketSolid=k.solidSvg(k.slabOf(ticket,paperBase,.85,P,4,.2),{tone:'hi',crease:'lo',lit:true});
  count++;
  push(15, `<g id="machine-ticket" class="machine-part machine-paper" data-station="0" data-machine-part="moving-ticket">${ticketSolid}${ruleSet(ticket,24.65,5,'blue')}${outline({x:-173,y:25,w:15,d:3.4,r:.3},24.65,0,'blue')}</g>`);

  // Reading gantry, with a real gap above the paper and a sliding scan head.
  for(const [i,y] of [-5,40].entries()) {
    const foot={x:-111,y:i===0?y-4:y,w:22,d:8,r:1.4};
    add(gantryLayers[i].foot,1,`reader-foot-${i}`,foot,8.6,5,'',screwSet(foot,13.6,2));
    add(gantryLayers[i].pillar,1,`reader-pillar-${i}`,{x:-106,y,w:12,d:4,r:1},13.6,43,'',outline({x:-106,y,w:12,d:4,r:1},56.6,.7,'faint'));
  }
  add(18,1,'reader-bridge',{x:-110,y:-5,w:20,d:49,r:2},56.6,8,'',screwSet({x:-110,y:-5,w:20,d:49,r:2},64.6,3));
  add(19,1,'reader-carriage',{x:-111,y:9,w:22,d:21,r:1.6},64.6,5,'machine-blue',outline({x:-111,y:9,w:22,d:21,r:1.6},69.6,2,'faint'));
  add(20,1,'reader-glass-window',{x:-107.5,y:12,w:15,d:15,r:1},69.6,.6,'machine-graphite',outline({x:-106,y:13.5,w:12,d:12,r:.6},70.2,0,'blue'),{bevel:.2});
  for(const [i,y] of [0,35].entries())add(19,1,`reader-guide-block-${i}`,{x:-106,y,w:12,d:4,r:.7},64.6,2.8,'machine-graphite');

  // Proof press: a square plunger avoids an ornamental pipe or false round joint.
  for(const [i,y] of [-6,40].entries()){
    const foot={x:75,y:i===0?y-4:y,w:23,d:8,r:1.4};
    add(gantryLayers[i].foot,4,`proof-foot-${i}`,foot,8.6,5,'',screwSet(foot,13.6,2));
    add(gantryLayers[i].pillar,4,`proof-pillar-${i}`,{x:81,y,w:11,d:4,r:1},13.6,46.4,'');
  }
  add(18,4,'proof-bridge',{x:76,y:-6,w:21,d:50,r:1.8},60,8,'machine-wine',screwSet({x:76,y:-6,w:21,d:50,r:1.8},68,3));
  const proof = [];
  const proofPart=(name,p,z,h,material,detail='')=>{
    count++;
    proof.push(`<g class="machine-part ${material}" data-station="4" data-machine-part="${name}">${k.solidSvg(k.slabOf(p,z,h,P,4,.6),{tone:'mid',crease:'faint'})}${detail}</g>`);
  };
  proofPart('proof-stamp-face',{x:75,y:10,w:23,d:20,r:.8},31,3,'machine-wine');
  proofPart('proof-stamp-head',{x:72,y:7,w:29,d:26,r:2},34,6,'machine-wine',screwSet({x:72,y:7,w:29,d:26,r:2},40,3));
  proofPart('proof-square-plunger',{x:82,y:15,w:9,d:9,r:.6},40,26.25,'machine-graphite');
  // Fixed clip hides the spare rod length inside its bridge while the whole
  // plunger moves. It remains attached throughout the legal 0..6.25 stroke.
  const proofClip=k.slabOf({x:70,y:5,w:34,d:30,r:0},24,17,P,1).fill
    +k.slabOf({x:82,y:15,w:9,d:9,r:.6},40,20,P,4).fill;
  push(16,`<defs><clipPath id="machine-proof-clip"><path d="${proofClip}"/></clipPath></defs><g clip-path="url(#machine-proof-clip)"><g id="machine-proof">${proof.join('')}</g></g>`);

  // Output: finished paper lands in a tray, not a floating conceptual box.
  const output={x:139,y:0,w:58,d:42,r:2};
  add(11,5,'output-tray-floor',output,17,3.6,'',outline(output,20.6,3,'faint'));
  add(12,5,'output-tray-rear-lip',{x:139,y:0,w:58,d:2.5,r:.8},20.6,3.8,'machine-blue');
  add(12,5,'output-tray-near-lip',{x:139,y:40,w:58,d:2.5,r:.8},20.6,3.8,'machine-blue');
  add(12,5,'output-paper-stop',{x:195,y:0,w:2.5,d:42,r:.8},20.6,5,'');
  for(let i=0;i<2;i++){
    const page={x:144+i*1.4,y:4+i,w:46,d:32,r:.7};
    const thickness=(paperBase-20.6)/2;
    add(13,5,`output-sheet-${i}`,page,20.6+i*thickness,thickness,'machine-paper',i===1?ruleSet(page,paperBase,6,'blue'):'',{bevel:0});
  }

  // Surface details, a functional ruler, and the sole engraved word.
  add(21,1,'front-safety-edge',{x:-144,y:48.5,w:282,d:3,r:.8},8.6,4.3,'',dots([[-139,50,12.9],[133,50,12.9]],'mid',.5));
  const ruler={x:-126,y:54,w:209,d:5.4,r:.8};
  const ticks=k.topTicks(ruler.x+3,ruler.x+ruler.w-3,4,5,ruler.y,9.2,[1.8,3.7],P);
  add(22,1,'registration-ruler',ruler,8.6,.6,'',line(ticks.minor,'lo')+line(ticks.major,'mid'),{bevel:.2});
  const plaque={x:100,y:52,w:49,d:9,r:1};
  add(22,0,'engraved-maker-plate',plaque,8.6,.7,'machine-blue',k.faceTextSvg(k.topMatrix([124.5,58.3],9.3,P,'x'),'DEEPINFER',{size:4.1,tone:'mid',anchor:'middle'})+dots([[103,56.5,9.3],[146,56.5,9.3]],'hi',.5),{bevel:.2});

  const body=[...layers.entries()].sort((a,b)=>a[0]-b[0]).flatMap(([,items])=>items.sort((a,b)=>a.depth-b.depth).map(it=>it.svg)).join('');
  return k.figureSvg({width:W,height:H,label:MACHINE_META.label,className:'machine-svg',body:`<title>推理印刷工作台</title><desc>教学模型，共 ${count} 个实体零件。左侧托盘接收纸票，阅读头与记忆柜负责上下文，专家插匣处理计算，红色压头校对草稿，右侧托盘承接输出。</desc>${body}`});
}

export default buildMachine;
