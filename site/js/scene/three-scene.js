// 街角书店：按参考图重做的两层小店，蓝色窗框、酒红饰带、SPRINGHUES 招牌。
// 天气随季节变化；街上的人数等于真实独立访客数。three.js 内置在 vendor/three。
import * as THREE from '../../../vendor/three/three.module.min.js';

const B = {
  x0: -2.6, x1: 2.6,
  z0: -2.6, z1: 2.6,
  ground: 2.5,
  band: 0.55,
  upper: 2.1,
  wall: 0.24
};

const C = {
  white: '#F7F6F2',
  whiteShade: '#E8E7E2',
  blue: '#2B4CA0',
  blueDeep: '#16306E',
  burgundy: '#7C1B33',
  burgundyDeep: '#5E1426',
  roof: '#A9AEBA',
  roofDark: '#8E939E',
  base: '#B9BEC7',
  baseTop: '#C7CBD3',
  glass: '#CFDCF4',
  warm: '#EFCB9A',
  lamp: '#FFD79A',
  metal: '#23262E'
};

function canvasTexture(width, height, paint, repeat = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  paint(canvas.getContext('2d'), width, height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.anisotropy = 4;
  return texture;
}

// 磨砂暖色室内：参考图里橱窗后是虚化的暖光
function interiorBlur() {
  return canvasTexture(256, 256, (ctx, w, h) => {
    ctx.fillStyle = '#E7C9A2';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i += 1) {
      const g = ctx.createRadialGradient(
        Math.random() * w, Math.random() * h, 4,
        Math.random() * w, Math.random() * h, 40 + Math.random() * 60
      );
      g.addColorStop(0, i % 3 === 0 ? 'rgba(120,70,40,0.35)' : 'rgba(255,236,200,0.45)');
      g.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
  });
}

// 彩色书脊
function bookSpines() {
  return canvasTexture(512, 256, (ctx, w, h) => {
    ctx.fillStyle = '#3B2A20';
    ctx.fillRect(0, 0, w, h);
    const palette = ['#B6483F', '#2F5AA8', '#D8A23C', '#4E7A4A', '#8C3B63', '#E0D6C3', '#2B4CA0', '#7C1B33'];
    let x = 0;
    while (x < w) {
      const bw = 8 + Math.random() * 14;
      const bh = h * (0.62 + Math.random() * 0.36);
      ctx.fillStyle = palette[Math.floor(Math.random() * palette.length)];
      ctx.fillRect(x, h - bh, bw - 2, bh);
      ctx.fillStyle = 'rgba(0,0,0,0.18)';
      ctx.fillRect(x + bw - 3, h - bh, 2, bh);
      x += bw;
    }
    // 书架横板
    ctx.fillStyle = '#6B4B33';
    for (const y of [0.32, 0.66]) {
      ctx.fillRect(0, h * y, w, 9);
    }
  });
}

function signTexture() {
  return canvasTexture(1024, 256, (ctx, w, h) => {
    ctx.fillStyle = C.white;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = C.burgundy;
    ctx.font = '800 122px "Arial Narrow", Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPRINGHUES', w / 2, h / 2 + 6);
  });
}

function posterTexture(kind) {
  return canvasTexture(128, 160, (ctx, w, h) => {
    ctx.fillStyle = '#F3F1EA';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#8B8B86';
    ctx.lineWidth = 5;
    ctx.strokeRect(4, 4, w - 8, h - 8);
    ctx.fillStyle = kind === 'leaf' ? '#4E7A4A' : kind === 'heart' ? '#7C1B33' : '#2B4CA0';
    if (kind === 'leaf') {
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2 - 6, 20, 34, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#4E7A4A';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(w / 2 - 14, h / 2 + 34);
      ctx.lineTo(w / 2 + 10, h / 2 - 34);
      ctx.stroke();
    } else if (kind === 'heart') {
      ctx.beginPath();
      ctx.moveTo(w / 2, h / 2 + 22);
      ctx.bezierCurveTo(w / 2 - 34, h / 2 - 10, w / 2 - 10, h / 2 - 40, w / 2, h / 2 - 14);
      ctx.bezierCurveTo(w / 2 + 10, h / 2 - 40, w / 2 + 34, h / 2 - 10, w / 2, h / 2 + 22);
      ctx.fill();
    } else {
      ctx.font = '800 74px "Arial Narrow", Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(kind, w / 2, h / 2);
    }
  });
}

function circleTexture() {
  return canvasTexture(64, 64, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  });
}

export function createExperience({ canvas, stage }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-6, 6, 6, -6, 0.1, 160);
  const target = new THREE.Vector3(0, 2.55, 0);
  const view = { azimuth: 0.78, polar: 1.13, radius: 34, zoom: 1 };

  const hemi = new THREE.HemisphereLight('#FFFFFF', '#B9BEC7', 1.5);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight('#FFFFFF', 2.4);
  sun.position.set(8, 13, 9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -9;
  sun.shadow.camera.right = 9;
  sun.shadow.camera.top = 9;
  sun.shadow.camera.bottom = -9;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 50;
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.03;
  sun.shadow.radius = 3;
  scene.add(sun);

  const fill = new THREE.DirectionalLight('#C6D2F2', 0.5);
  fill.position.set(-8, 7, -7);
  scene.add(fill);

  const materials = [];
  function mat(options) {
    const m = new THREE.MeshStandardMaterial(options);
    materials.push(m);
    return m;
  }

  const whiteMat = mat({ color: C.white, roughness: 0.95, metalness: 0 });
  const shadeMat = mat({ color: C.whiteShade, roughness: 0.95, metalness: 0 });
  const blueMat = mat({ color: C.blue, roughness: 0.72, metalness: 0.05 });
  const blueDeepMat = mat({ color: C.blueDeep, roughness: 0.72, metalness: 0.05 });
  const burgundyMat = mat({ color: C.burgundy, roughness: 0.78, metalness: 0 });
  const roofMat = mat({ color: C.roof, roughness: 0.95, metalness: 0 });
  const roofDarkMat = mat({ color: C.roofDark, roughness: 0.95, metalness: 0 });
  const baseMat = mat({ color: C.base, roughness: 0.95, metalness: 0 });
  const baseTopMat = mat({ color: C.baseTop, roughness: 0.95, metalness: 0 });
  const metalMat = mat({ color: C.metal, roughness: 0.5, metalness: 0.4 });
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: C.glass,
    roughness: 0.18,
    metalness: 0,
    transparent: true,
    opacity: 0.28,
    depthWrite: false,
    envMapIntensity: 0.5,
    side: THREE.DoubleSide
  });
  materials.push(glassMat);

  const blurTex = interiorBlur();
  const blurMat = mat({ color: '#FFFFFF', map: blurTex, roughness: 0.9, emissive: new THREE.Color(C.warm), emissiveIntensity: 0.12, emissiveMap: blurTex });
  const spineTex = bookSpines();
  const spineMat = mat({ color: '#FFFFFF', map: spineTex, roughness: 0.9 });

  const root = new THREE.Group();
  scene.add(root);

  function box(parent, w, h, d, material, x, y, z, opts = {}) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = opts.cast !== false;
    mesh.receiveShadow = opts.receive !== false;
    parent.add(mesh);
    return mesh;
  }

  function plane(parent, w, h, material, x, y, z, rotY = 0) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.receiveShadow = false;
    mesh.castShadow = false;
    parent.add(mesh);
    return mesh;
  }

  // ── 底座 ────────────────────────────────────────────────────
  box(root, 7.9, 0.52, 7.9, baseMat, 0, -0.26, 0, { receive: true });
  box(root, 7.8, 0.04, 7.8, baseTopMat, 0, 0.02, 0, { receive: true });

  const building = new THREE.Group();
  root.add(building);

  const W = B.x1 - B.x0;
  const D = B.z1 - B.z0;
  const T = B.wall;
  const H1 = B.ground;
  const H2 = B.upper;
  const BAND = B.band;

  // 一层墙体
  box(building, W, H1, T, whiteMat, 0, H1 / 2, B.z1 - T / 2);
  box(building, W, H1, T, whiteMat, 0, H1 / 2, B.z0 + T / 2);
  box(building, T, H1, D, whiteMat, B.x0 + T / 2, H1 / 2, 0);
  box(building, T, H1, D, whiteMat, B.x1 - T / 2, H1 / 2, 0);

  // 招牌带（两层之间的一圈白带）
  box(building, W + 0.08, BAND, D + 0.08, whiteMat, 0, H1 + BAND / 2, 0);
  box(building, W + 0.1, 0.09, D + 0.1, burgundyMat, 0, H1 + 0.02, 0);
  box(building, W + 0.1, 0.09, D + 0.1, burgundyMat, 0, H1 + BAND - 0.02, 0);

  // 二层墙体
  box(building, W, H2, D, whiteMat, 0, H1 + BAND + H2 / 2, 0);
  const topY = H1 + BAND + H2;

  // 屋顶
  box(building, W + 0.16, 0.16, D + 0.16, blueMat, 0, topY + 0.08, 0);
  box(building, W - 0.1, 0.06, D - 0.1, roofMat, 0, topY + 0.17, 0);
  box(building, W - 0.5, 0.12, D - 0.5, roofDarkMat, 0, topY + 0.22, 0, { cast: false });

  // 一层基座酒红饰带
  box(building, W + 0.06, 0.34, D + 0.06, burgundyMat, 0, 0.17, 0);

  // ── 橱窗与门 ────────────────────────────────────────────────
  // 窗面分层：贴墙的内景 0.008 → 玻璃 0.03 → 蓝框 0.05，永不同面。
  const FACE = 0.008;
  const GLASS = 0.03;
  const FRAME = 0.05;

  function shopWindow(face, a0, a1, y0, y1) {
    const centre = (a0 + a1) / 2;
    const len = a1 - a0;
    const my = (y0 + y1) / 2;
    const mh = y1 - y0;

    if (face === 'z') {
      const f = B.z1;
      plane(building, len - 0.08, mh - 0.08, blurMat, centre, my, f + FACE);
      plane(building, len - 0.14, mh - 0.14, glassMat, centre, my, f + GLASS);
      box(building, len, 0.1, 0.12, blueMat, centre, y1, f + FRAME);
      box(building, len, 0.1, 0.12, blueMat, centre, y0, f + FRAME);
      box(building, 0.1, mh, 0.12, blueMat, a0, my, f + FRAME);
      box(building, 0.1, mh, 0.12, blueMat, a1, my, f + FRAME);
      box(building, 0.07, mh, 0.1, blueMat, centre - len / 6, my, f + FRAME);
      box(building, 0.07, mh, 0.1, blueMat, centre + len / 6, my, f + FRAME);
      box(building, len, 0.07, 0.1, blueMat, centre, my + mh / 5, f + FRAME);
    } else {
      const f = B.x1;
      plane(building, len - 0.08, mh - 0.08, blurMat, f + FACE, my, centre, Math.PI / 2);
      plane(building, len - 0.14, mh - 0.14, glassMat, f + GLASS, my, centre, Math.PI / 2);
      box(building, 0.12, 0.1, len, blueMat, f + FRAME, y1, centre);
      box(building, 0.12, 0.1, len, blueMat, f + FRAME, y0, centre);
      box(building, 0.12, mh, 0.1, blueMat, f + FRAME, my, a0);
      box(building, 0.12, mh, 0.1, blueMat, f + FRAME, my, a1);
      box(building, 0.1, mh, 0.07, blueMat, f + FRAME, my, centre - len / 6);
      box(building, 0.1, mh, 0.07, blueMat, f + FRAME, my, centre + len / 6);
      box(building, 0.1, 0.07, len, blueMat, f + FRAME, my + mh / 5, centre);
    }
  }

  // 正面（+z）：左边大窗，右边双开门
  shopWindow('z', -2.2, -0.2, 0.62, 2.18);
  shopWindow('x', -2.2, 0.2, 0.62, 2.18);

  // 双开门（+z）
  const doorX = 1.15;
  box(building, 1.5, 2.2, 0.14, blueMat, doorX, 1.1, B.z1 + 0.02);
  plane(building, 0.6, 1.8, glassMat, doorX - 0.36, 1.15, B.z1 + 0.11);
  plane(building, 0.6, 1.8, glassMat, doorX + 0.36, 1.15, B.z1 + 0.11);
  box(building, 0.07, 1.9, 0.08, blueDeepMat, doorX, 1.15, B.z1 + 0.12);
  box(building, 0.06, 0.06, 0.06, mat({ color: '#D9B45A', roughness: 0.35, metalness: 0.8 }), doorX - 0.14, 1.15, B.z1 + 0.14);
  box(building, 0.06, 0.06, 0.06, mat({ color: '#D9B45A', roughness: 0.35, metalness: 0.8 }), doorX + 0.14, 1.15, B.z1 + 0.14);

  // 门上方酒红横板
  box(building, 1.6, 0.34, 0.12, burgundyMat, doorX, 2.32, B.z1 + 0.04);

  // ── 二楼窗 ──────────────────────────────────────────────────
  const upY0 = H1 + BAND + 0.28;
  const upY1 = topY - 0.3;
  const upMid = (upY0 + upY1) / 2;
  const upH = upY1 - upY0;

  function upperWindow(face, a0, a1, shelves) {
    const centre = (a0 + a1) / 2;
    const len = a1 - a0;
    if (face === 'z') {
      const f = B.z1;
      plane(building, len - 0.1, upH - 0.1, shelves ? spineMat : blurMat, centre, upMid, f + FACE);
      plane(building, len - 0.2, upH - 0.2, glassMat, centre, upMid, f + GLASS);
      box(building, len, 0.12, 0.14, blueMat, centre, upY1, f + FRAME);
      box(building, len, 0.12, 0.14, blueMat, centre, upY0, f + FRAME);
      box(building, 0.12, upH, 0.14, blueMat, a0, upMid, f + FRAME);
      box(building, 0.12, upH, 0.14, blueMat, a1, upMid, f + FRAME);
      for (let i = 1; i < 3; i += 1) {
        box(building, 0.08, upH, 0.12, blueMat, a0 + (len / 3) * i, upMid, f + FRAME);
      }
      box(building, len, 0.08, 0.12, blueMat, centre, upMid, f + FRAME);
    } else {
      const f = B.x1;
      plane(building, len - 0.1, upH - 0.1, shelves ? spineMat : blurMat, f + FACE, upMid, centre, Math.PI / 2);
      plane(building, len - 0.2, upH - 0.2, glassMat, f + GLASS, upMid, centre, Math.PI / 2);
      box(building, 0.14, 0.12, len, blueMat, f + FRAME, upY1, centre);
      box(building, 0.14, 0.12, len, blueMat, f + FRAME, upY0, centre);
      box(building, 0.14, upH, 0.12, blueMat, f + FRAME, upMid, a0);
      box(building, 0.14, upH, 0.12, blueMat, f + FRAME, upMid, a1);
      for (let i = 1; i < 3; i += 1) {
        box(building, 0.12, upH, 0.08, blueMat, f + FRAME, upMid, a0 + (len / 3) * i);
      }
      box(building, 0.12, 0.08, len, blueMat, f + FRAME, upMid, centre);
    }
  }

  upperWindow('z', -2.25, 0.35, false);
  upperWindow('x', -2.25, 0.6, true);

  // 招牌：两面同字
  const signTex = signTexture();
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    emissive: new THREE.Color('#FFFFFF'),
    emissiveMap: signTex,
    emissiveIntensity: 0.08,
    roughness: 0.85
  });
  materials.push(signMat);
  const signZ = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), signMat);
  signZ.position.set(-0.8, H1 + BAND / 2, B.z1 + 0.055);
  building.add(signZ);
  const signX = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 0.42), signMat);
  signX.position.set(B.x1 + 0.055, H1 + BAND / 2, -0.6);
  signX.rotation.y = Math.PI / 2;
  building.add(signX);

  // ── 壁灯 ────────────────────────────────────────────────────
  const lampMeshes = [];
  function wallLamp(x, y, z, face) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    if (face === 'x') g.rotation.y = Math.PI / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.34), metalMat);
    arm.position.set(0, 0, 0.17);
    arm.castShadow = true;
    g.add(arm);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.2, 10), metalMat);
    body.position.set(0, -0.16, 0.34);
    body.castShadow = true;
    g.add(body);
    const glowMat = new THREE.MeshStandardMaterial({
      color: '#FFF3D6', emissive: new THREE.Color(C.lamp), emissiveIntensity: 0
    });
    materials.push(glowMat);
    const glow = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.085, 0.16, 10), glowMat);
    glow.position.set(0, -0.17, 0.34);
    g.add(glow);
    building.add(g);
    lampMeshes.push(glowMat);
    return g;
  }
  wallLamp(-2.75, 2.05, B.z1 + 0.02, 'z');
  wallLamp(2.1, 1.55, B.z1 + 0.02, 'z');
  wallLamp(B.x1 + 0.02, 2.05, -2.35, 'x');
  wallLamp(B.x1 + 0.02, 1.55, 1.9, 'x');

  // ── 海报卡 ──────────────────────────────────────────────────
  function poster(kind, x, y, z, rotY) {
    const tex = posterTexture(kind);
    const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    materials.push(m);
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.42), m);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    building.add(mesh);
  }
  poster('P', -0.75, 2.05, B.z1 + 0.02, 0);
  poster('N', -0.75, 1.55, B.z1 + 0.02, 0);
  poster('leaf', -0.75, 1.05, B.z1 + 0.02, 0);
  poster('A', B.x1 + 0.02, 2.05, 1.55, Math.PI / 2);
  poster('N', B.x1 + 0.02, 1.55, 1.55, Math.PI / 2);
  poster('heart', B.x1 + 0.02, 1.05, 1.55, Math.PI / 2);
  poster('heart', -2.75, 1.55, B.z1 + 0.02, 0);
  poster('leaf', B.x1 + 0.02, 1.55, -1.75, Math.PI / 2);

  // ── 门口立牌 ────────────────────────────────────────────────
  const board = new THREE.Group();
  board.position.set(1.15, 0, B.z1 + 0.85);
  board.rotation.y = -0.25;
  const boardMat = mat({ color: '#9A6B44', roughness: 0.9 });
  const boardTex = posterTexture('leaf');
  const boardFaceMat = new THREE.MeshStandardMaterial({ map: boardTex, roughness: 0.9 });
  materials.push(boardFaceMat);
  for (const side of [-1, 1]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.86, 0.04), boardMat);
    panel.position.set(0, 0.5, side * 0.12);
    panel.rotation.x = side * 0.22;
    panel.castShadow = true;
    board.add(panel);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.72), boardFaceMat);
    face.position.set(0, 0.5, side * 0.15);
    face.rotation.x = side * 0.22;
    face.rotation.y = side > 0 ? 0 : Math.PI;
    board.add(face);
  }
  root.add(board);

  // ── 盆栽小树 ────────────────────────────────────────────────
  const trees = [];
  function potTree(x, z) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.19, 0.34, 12), burgundyMat);
    pot.position.y = 0.17;
    pot.castShadow = true;
    pot.receiveShadow = true;
    g.add(pot);
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.8, 8), mat({ color: '#6B4B33', roughness: 0.9 }));
    trunk.position.y = 0.7;
    trunk.castShadow = true;
    g.add(trunk);
    const foliageMat = mat({ color: '#2F6B4F', roughness: 0.9, flatShading: true });
    for (const [dx, dy, dz, r] of [[0, 1.25, 0, 0.3], [-0.18, 1.05, 0.08, 0.22], [0.16, 1.1, -0.06, 0.2]]) {
      const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), foliageMat);
      blob.position.set(dx, dy, dz);
      blob.castShadow = true;
      g.add(blob);
    }
    root.add(g);
    trees.push(foliageMat);
    return g;
  }
  potTree(-3.7, 3.3);
  potTree(3.7, 3.3);
  potTree(-3.7, -3.2);

  // ── 行人：数量等于独立访客 ──────────────────────────────────
  const people = [];
  // 只走观察者看得见的两条人行道（L 形），人数一眼可数。
  const PATH_A = 6.7;
  const PATH_TOTAL = 13.4;
  const PATH_OFFSET = 3.32;
  function pathPoint(t) {
    const s = ((t % PATH_TOTAL) + PATH_TOTAL) % PATH_TOTAL;
    if (s < PATH_A) return { x: -PATH_A / 2 + s, z: PATH_OFFSET };
    return { x: PATH_OFFSET, z: PATH_A / 2 - (s - PATH_A) };
  }
  function makePerson(i) {
    const g = new THREE.Group();
    const coatColors = [C.blue, C.burgundy, C.blueDeep, '#3F6B4E'];
    const coat = mat({ color: coatColors[i % coatColors.length], roughness: 0.9 });
    const skin = mat({ color: '#E8D3BC', roughness: 0.85 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.13, 0.42, 4, 12), coat);
    body.position.y = 0.42;
    body.castShadow = true;
    g.add(body);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 16, 12), skin);
    head.position.y = 0.79;
    head.castShadow = true;
    g.add(head);
    const legMat = mat({ color: '#2A2E38', roughness: 0.9 });
    for (const dx of [-0.06, 0.06]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.24, 4, 8), legMat);
      leg.position.set(dx, 0.16, 0);
      leg.castShadow = true;
      g.add(leg);
    }
    g.userData = { t: 0, speed: 0.45 + (i % 4) * 0.06, phase: i * 1.3 };
    root.add(g);
    return g;
  }

  function setPeople(count) {
    const target = Math.max(0, Math.min(30, Math.round(count)));
    while (people.length < target) {
      people.push(makePerson(people.length));
    }
    while (people.length > target) {
      const person = people.pop();
      root.remove(person);
    }
    people.forEach((person, index) => {
      person.userData.t = (index / Math.max(1, people.length)) * PATH_TOTAL;
    });
  }
  setPeople(1);

  // ── 天气 ────────────────────────────────────────────────────
  const PETAL_COUNT = 260;
  const petalGeo = new THREE.BufferGeometry();
  const petalPos = new Float32Array(PETAL_COUNT * 3);
  for (let i = 0; i < PETAL_COUNT; i += 1) {
    const r = 4.8 + Math.random() * 2.4;
    const a = Math.random() * Math.PI * 2;
    petalPos[i * 3] = Math.cos(a) * r;
    petalPos[i * 3 + 1] = Math.random() * 6;
    petalPos[i * 3 + 2] = Math.sin(a) * r;
  }
  petalGeo.setAttribute('position', new THREE.BufferAttribute(petalPos, 3));
  const petalMat = new THREE.PointsMaterial({
    color: new THREE.Color('#F4F6FF'), size: 0.09, transparent: true, opacity: 0.9, depthWrite: false,
    map: circleTexture(), alphaTest: 0.15
  });
  materials.push(petalMat);
  const petals = new THREE.Points(petalGeo, petalMat);
  root.add(petals);

  // 雨：线段
  const RAIN_COUNT = 240;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(RAIN_COUNT * 6);
  for (let i = 0; i < RAIN_COUNT; i += 1) {
    const x = (Math.random() - 0.5) * 13;
    const y = Math.random() * 8;
    const z = (Math.random() - 0.5) * 13;
    rainPos[i * 6] = x; rainPos[i * 6 + 1] = y; rainPos[i * 6 + 2] = z;
    rainPos[i * 6 + 3] = x + 0.04; rainPos[i * 6 + 4] = y - 0.42; rainPos[i * 6 + 5] = z;
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rainMat = new THREE.LineBasicMaterial({ color: new THREE.Color('#9FB8E8'), transparent: true, opacity: 0.55 });
  materials.push(rainMat);
  const rain = new THREE.LineSegments(rainGeo, rainMat);
  rain.visible = false;
  root.add(rain);

  // ── 状态 ────────────────────────────────────────────────────
  let theme = 'day';
  let season = 'spring';
  let intro = 0;
  let time = 0;
  let dragging = false;
  let lastX = 0;
  let azimuthTarget = view.azimuth;
  let parallax = 0;
  let parallaxTarget = 0;

  function applyTheme(next) {
    theme = next;
    const night = next === 'night';
    renderer.toneMappingExposure = night ? 1.15 : 1.0;
    hemi.color = new THREE.Color(night ? '#6E7FC0' : '#FFFFFF');
    hemi.groundColor = new THREE.Color(night ? '#1A2140' : '#B9BEC7');
    hemi.intensity = night ? 0.7 : 1.5;
    sun.color = new THREE.Color(night ? '#8FA2E8' : '#FFFFFF');
    sun.intensity = night ? 0.55 : 2.4;
    fill.intensity = night ? 0.2 : 0.5;
    for (const m of lampMeshes) m.emissiveIntensity = night ? 2.6 : 0;
    signMat.emissiveIntensity = night ? 0.9 : 0.08;
    blurMat.emissiveIntensity = night ? 0.85 : 0.12;
    glassMat.opacity = night ? 0.18 : 0.28;
    applySeason(season);
  }

  function applySeason(next) {
    season = next;
    const night = theme === 'night';
    const foliage = night
      ? (next === 'winter' ? '#DDE6F8' : '#1B3E63')
      : (next === 'spring' ? '#3E8E63' : next === 'summer' ? '#2F7A52' : next === 'autumn' ? '#B05A2A' : '#E3E9F3');
    for (const m of trees) m.color = new THREE.Color(foliage);

    rain.visible = next === 'spring';
    petals.visible = next !== 'spring';

    const color = next === 'autumn' ? '#B05A2A' : next === 'winter' ? '#FFFFFF' : '#F7EDF0';
    petalMat.color = new THREE.Color(color);
    petalMat.size = next === 'winter' ? 0.11 : next === 'autumn' ? 0.12 : 0.08;
    petalMat.opacity = next === 'summer' ? 0.5 : 0.9;
    if (next === 'summer') petalMat.color = new THREE.Color('#BFE0FF');
    roofMat.color = new THREE.Color(next === 'winter' ? '#E8EDF7' : C.roof);
    baseTopMat.color = new THREE.Color(next === 'winter' ? '#DDE4F0' : C.baseTop);
  }

  function resize() {
    const rect = stage.getBoundingClientRect();
    const w = Math.max(320, rect.width);
    const h = Math.max(320, rect.height);
    renderer.setSize(w, h, false);
    const aspect = w / h;
    const size = 4.05;
    camera.left = -size * aspect;
    camera.right = size * aspect;
    camera.top = size;
    camera.bottom = -size;
    camera.updateProjectionMatrix();
  }

  function updateCamera() {
    const azimuth = view.azimuth + Math.sin(time * 0.15) * 0.02 + parallax * 0.05;
    camera.position.set(
      target.x + view.radius * Math.sin(view.polar) * Math.sin(azimuth),
      target.y + view.radius * Math.cos(view.polar),
      target.z + view.radius * Math.sin(view.polar) * Math.cos(azimuth)
    );
    camera.lookAt(target);
    camera.zoom = (0.9 + 0.1 * (1 - Math.pow(1 - Math.min(1, intro), 3))) * view.zoom;
    camera.updateProjectionMatrix();
  }

  function step(dt) {
    time += dt;
    intro = Math.min(1, intro + dt / 1.5);
    parallax += (parallaxTarget - parallax) * Math.min(1, dt * 3);
    view.azimuth += (azimuthTarget - view.azimuth) * Math.min(1, dt * 6);

    for (const person of people) {
      person.userData.t += person.userData.speed * dt;
      const at = pathPoint(person.userData.t);
      person.position.set(at.x, Math.abs(Math.sin(time * 4 + person.userData.phase)) * 0.02, at.z);
    }

    if (petals.visible) {
      const pos = petalGeo.attributes.position.array;
      for (let i = 0; i < PETAL_COUNT; i += 1) {
        pos[i * 3 + 1] -= dt * (0.35 + (i % 5) * 0.14);
        pos[i * 3] += Math.sin(time * 0.9 + i) * dt * 0.22;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 5.5;
          const a = Math.random() * Math.PI * 2;
          const r = 4.4 + Math.random() * 2.6;
          pos[i * 3] = Math.cos(a) * r;
          pos[i * 3 + 2] = Math.sin(a) * r;
        }
      }
      petalGeo.attributes.position.needsUpdate = true;
    }

    if (rain.visible) {
      const pos = rainGeo.attributes.position.array;
      for (let i = 0; i < RAIN_COUNT; i += 1) {
        const fall = dt * 7;
        pos[i * 6 + 1] -= fall;
        pos[i * 6 + 4] -= fall;
        if (pos[i * 6 + 1] < 0) {
          const x = (Math.random() - 0.5) * 13;
          const z = (Math.random() - 0.5) * 13;
          pos[i * 6] = x; pos[i * 6 + 1] = 6.5; pos[i * 6 + 2] = z;
          pos[i * 6 + 3] = x + 0.04; pos[i * 6 + 4] = 6.05; pos[i * 6 + 5] = z;
        }
      }
      rainGeo.attributes.position.needsUpdate = true;
    }

    updateCamera();
  }

  function bind() {
    canvas.addEventListener('pointerdown', (event) => {
      dragging = true;
      lastX = event.clientX;
      canvas.setPointerCapture(event.pointerId);
    });
    canvas.addEventListener('pointermove', (event) => {
      const rect = canvas.getBoundingClientRect();
      parallaxTarget = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      if (!dragging) return;
      const dx = (event.clientX - lastX) / rect.width;
      lastX = event.clientX;
      azimuthTarget = Math.max(-0.55, Math.min(0.55, azimuthTarget - dx * 1.1));
    });
    const end = () => { dragging = false; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', () => { if (!dragging) parallaxTarget = 0; });
  }

  resize();
  applyTheme('day');
  applySeason('spring');
  updateCamera();
  bind();

  return {
    scene,
    camera,
    renderer,
    step,
    resize,
    setTheme: applyTheme,
    setSeason: applySeason,
    setPeople
  };
}
