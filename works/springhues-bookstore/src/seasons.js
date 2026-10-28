import * as THREE from '../vendor/three.module.min.js';

const NAMES = ['spring', 'summer', 'autumn', 'winter'];
const GROUND_Y = 0.12;
const TRANSITION_SECONDS = 0.5;
const clamp = value => Math.min(1, Math.max(0, Number(value) || 0));
const smooth = t => t * t * (3 - 2 * t);

function randomGenerator(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// A folded leaf catches the light on two faces without a texture or a shader.
function makeLeafGeometry() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, -0.5, 0, -0.28, 0, 0, 0, 0, 0.075,
    0, -0.5, 0, 0, 0, 0.075, 0.28, 0, 0,
    -0.28, 0, 0, 0, 0.5, 0, 0, 0, 0.075,
    0, 0, 0.075, 0, 0.5, 0, 0.28, 0, 0,
  ], 3));
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Restrained surroundings for the standalone Springhues bookshop.
 * Coordinates: front +Z, right +X, slab surface y=0.12.
 * step(time, dt) takes seconds. Pass reducedMotion to disable particle motion.
 */
export function buildSeasons({ roofY = 6.2, reducedMotion = false } = {}) {
  const group = new THREE.Group();
  group.name = 'Seasonal surroundings';
  const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
  const sphereGeometry = new THREE.IcosahedronGeometry(1, 1);
  const cylinderGeometry = new THREE.CylinderGeometry(1, 1, 1, 8);
  const leafGeometry = makeLeafGeometry();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const up = new THREE.Vector3(0, 1, 0);

  const neutral = {
    pot: new THREE.MeshStandardMaterial({ color: '#2445a1', roughness: 0.83 }),
    rim: new THREE.MeshStandardMaterial({ color: '#192e72', roughness: 0.8 }),
    soil: new THREE.MeshStandardMaterial({ color: '#4d3c32', roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: '#796454', roughness: 0.94 }),
    brass: new THREE.MeshStandardMaterial({ color: '#b3a16c', roughness: 0.7, metalness: 0.2 }),
  };

  function mesh(parent, geometry, material, position, scale) {
    const item = new THREE.Mesh(geometry, material);
    item.position.set(...position);
    item.scale.set(...scale);
    item.castShadow = true;
    item.receiveShadow = true;
    parent.add(item);
    return item;
  }

  function rod(parent, start, end, radius) {
    const a = new THREE.Vector3(...start);
    const b = new THREE.Vector3(...end);
    const delta = b.clone().sub(a);
    const item = mesh(parent, cylinderGeometry, neutral.wood,
      a.clone().add(b).multiplyScalar(0.5).toArray(), [radius, delta.length(), radius]);
    item.quaternion.setFromUnitVectors(up, delta.normalize());
    return item;
  }

  // Permanent props stay in place while the weather changes.
  const tree = new THREE.Group();
  tree.name = 'Back left potted tree';
  tree.position.set(-3.3, GROUND_Y, -1.65);
  group.add(tree);
  mesh(tree, new THREE.CylinderGeometry(0.4, 0.31, 0.48, 10), neutral.pot,
    [0, 0.24, 0], [1, 1, 1]);
  mesh(tree, new THREE.CylinderGeometry(0.425, 0.425, 0.075, 10), neutral.rim,
    [0, 0.47, 0], [1, 1, 1]);
  mesh(tree, cylinderGeometry, neutral.soil, [0, 0.51, 0], [0.365, 0.025, 0.365]);
  mesh(tree, new THREE.CylinderGeometry(0.4, 0.4, 0.025, 10), neutral.brass,
    [0, 0.405, 0], [1, 1, 1]);

  const branches = [
    [[0, 0.5, 0], [-0.04, 1.55, 0.04], 0.055],
    [[-0.04, 1.55, 0.04], [0.08, 2.65, 0], 0.035],
    [[-0.02, 1.3, 0.02], [-0.54, 2.01, 0.16], 0.032],
    [[-0.54, 2.01, 0.16], [-0.65, 2.48, 0.27], 0.017],
    [[-0.02, 1.64, 0.03], [0.53, 2.2, 0.14], 0.027],
    [[0.53, 2.2, 0.14], [0.6, 2.65, 0.25], 0.014],
    [[0.02, 1.88, 0.02], [0.13, 2.45, -0.52], 0.027],
    [[0.13, 2.45, -0.52], [-0.05, 2.88, -0.57], 0.013],
    [[0.02, 2.16, 0.01], [-0.38, 2.63, -0.18], 0.022],
    [[-0.38, 2.63, -0.18], [-0.52, 2.96, -0.25], 0.012],
    [[0.08, 2.48, 0], [0.24, 3.03, -0.02], 0.018],
    [[0.01, 2.08, 0.01], [-0.04, 2.65, 0.48], 0.022],
    [[-0.04, 2.65, 0.48], [-0.17, 2.9, 0.57], 0.012],
  ];
  for (const [a, b, radius] of branches) rod(tree, a, b, radius);

  const planter = new THREE.Group();
  planter.name = 'Back right window planter';
  planter.position.set(3.28, GROUND_Y, -1.6);
  group.add(planter);
  mesh(planter, boxGeometry, neutral.pot, [0, 0.22, 0], [0.68, 0.44, 1]);
  mesh(planter, boxGeometry, neutral.soil, [0, 0.445, 0], [0.58, 0.025, 0.88]);
  mesh(planter, boxGeometry, neutral.rim, [-0.335, 0.46, 0], [0.06, 0.07, 1.07]);
  mesh(planter, boxGeometry, neutral.rim, [0.335, 0.46, 0], [0.06, 0.07, 1.07]);
  mesh(planter, boxGeometry, neutral.rim, [0, 0.46, -0.505], [0.62, 0.07, 0.06]);
  mesh(planter, boxGeometry, neutral.rim, [0, 0.46, 0.505], [0.62, 0.07, 0.06]);
  for (let i = 0; i < 5; i++) {
    const x = (i % 2 ? 1 : -1) * 0.13;
    const z = -0.34 + i * 0.17;
    rod(planter, [x, 0.46, z], [x + 0.04, 0.77 + (i % 3) * 0.055, z], 0.009);
  }

  const stages = Object.fromEntries(NAMES.map(name => {
    const stage = new THREE.Group();
    stage.name = name;
    group.add(stage);
    return [name, { group: stage, materials: [], pops: [], particles: [], weight: 0, from: 0 }];
  }));

  function seasonalMaterial(stage, tint, options = {}) {
    const material = new THREE.MeshStandardMaterial({
      color: tint, roughness: 0.9, side: THREE.DoubleSide,
      transparent: true, opacity: 0, depthWrite: false, ...options,
    });
    material.userData.baseOpacity = options.opacity ?? 1;
    stage.materials.push(material);
    return material;
  }

  function batch(parent, geometry, material, items, palette) {
    const instance = new THREE.InstancedMesh(geometry, material, items.length);
    items.forEach((item, index) => {
      dummy.position.set(...item.position);
      dummy.rotation.set(...(item.rotation || [0, 0, 0]));
      dummy.scale.set(...item.scale);
      dummy.updateMatrix();
      instance.setMatrixAt(index, dummy.matrix);
      if (palette) instance.setColorAt(index, color.set(palette[index % palette.length]));
    });
    instance.instanceMatrix.needsUpdate = true;
    instance.castShadow = false;
    instance.receiveShadow = true;
    parent.add(instance);
    return instance;
  }

  const palettes = {
    spring: ['#a1ad7c', '#7e9568', '#bcc595'],
    summer: ['#788d67', '#637c56', '#94a478'],
    autumn: ['#b66d45', '#b59b53', '#925c42', '#c79159'],
  };

  for (const [seasonIndex, name] of NAMES.entries()) {
    const stage = stages[name];
    const random = randomGenerator(2718 + seasonIndex * 107);
    const crown = new THREE.Group();
    crown.position.copy(tree.position).add(new THREE.Vector3(0, 2.2, 0));
    stage.group.add(crown);
    stage.pops.push(crown);

    if (name !== 'winter') {
      const leafMaterial = seasonalMaterial(stage, '#ffffff');
      const leaves = [];
      const count = name === 'summer' ? 126 : name === 'spring' ? 80 : 92;
      for (let i = 0; i < count; i++) {
        const branch = branches[2 + i % (branches.length - 2)];
        const t = 0.45 + random() * 0.6;
        const start = new THREE.Vector3(...branch[0]);
        const end = new THREE.Vector3(...branch[1]);
        const p = start.lerp(end, t);
        p.x += (random() - 0.5) * 0.42;
        p.y += (random() - 0.5) * 0.27 - 2.2;
        p.z += (random() - 0.5) * 0.42;
        const size = 0.19 + random() * 0.11;
        leaves.push({ position: p.toArray(), scale: [size * 0.95, size, size],
          rotation: [random() * 3, random() * 6, random() * 6] });
      }
      batch(crown, leafGeometry, leafMaterial, leaves, palettes[name]);

      const planterLeaves = [];
      for (let i = 0; i < 28; i++) {
        const size = 0.15 + random() * 0.09;
        planterLeaves.push({
          position: [3.28 + (random() - 0.5) * 0.42,
            GROUND_Y + 0.6 + random() * 0.28, -1.6 + (random() - 0.5) * 0.8],
          scale: [size, size * 1.4, size],
          rotation: [random() * 2.5, random() * 6, (random() - 0.5) * 2],
        });
      }
      batch(stage.group, leafGeometry, leafMaterial, planterLeaves, palettes[name]);
    }

    if (name === 'spring') {
      const blossoms = [];
      for (let i = 0; i < 34; i++) {
        const tip = branches[2 + i % (branches.length - 2)][1];
        blossoms.push({
          position: [tip[0] + (random() - 0.5) * 0.35,
            tip[1] - 2.2 + (random() - 0.5) * 0.26, tip[2] + (random() - 0.5) * 0.3],
          scale: [0.065, 0.05, 0.065],
        });
      }
      batch(crown, sphereGeometry, seasonalMaterial(stage, '#ffffff'), blossoms,
        ['#ead5d0', '#f0e4d9', '#d7b1af']);
      const flowers = [];
      for (let i = 0; i < 12; i++) flowers.push({
        position: [3.28 + (random() - 0.5) * 0.35, 0.89 + random() * 0.09,
          -1.6 + (random() - 0.5) * 0.7], scale: [0.055, 0.045, 0.055],
      });
      batch(stage.group, sphereGeometry, seasonalMaterial(stage, '#e7c5bd'), flowers);
    }

    if (name === 'autumn') {
      const fallen = [];
      for (let i = 0; i < 30; i++) {
        const leftSide = i < 22;
        fallen.push({
          position: [leftSide ? -3.3 + (random() - 0.5) * 1.45 : 3.25 + (random() - 0.5) * 0.75,
            GROUND_Y + 0.018 + random() * 0.01, -1.5 + (random() - 0.5) * 2],
          scale: [0.14, 0.2, 0.14], rotation: [-Math.PI / 2, 0, random() * 6.28],
        });
      }
      batch(stage.group, leafGeometry, seasonalMaterial(stage, '#ffffff'), fallen, palettes.autumn);
    }

    if (name === 'winter') {
      const snowMaterial = seasonalMaterial(stage, '#f3f5fa');
      // Thin inset roof powder, separate from the blue parapet and outer walls.
      mesh(stage.group, boxGeometry, snowMaterial, [0, roofY + 0.035, 0], [4.88, 0.06, 4.38]);
      const patches = [];
      for (let i = 0; i < 18; i++) {
        const left = i < 12;
        patches.push({
          position: [left ? -3.45 + (random() - 0.5) * 1.2 : 3.35 + (random() - 0.5) * 0.7,
            GROUND_Y + 0.027, -1.5 + (random() - 0.5) * 2.5],
          scale: [0.12 + random() * 0.18, 0.025 + random() * 0.02, 0.16 + random() * 0.2],
        });
      }
      batch(stage.group, sphereGeometry, snowMaterial, patches);
      mesh(stage.group, boxGeometry, snowMaterial,
        [3.28, GROUND_Y + 0.49, -1.6], [0.57, 0.05, 0.86]);
      const twigs = branches.slice(2).map(branch => ({
        position: [branch[1][0], branch[1][1] - 2.2 + 0.025, branch[1][2]],
        scale: [0.095, 0.026, 0.065],
      }));
      batch(crown, sphereGeometry, snowMaterial, twigs);
    }

    const particleCount = { spring: 20, summer: 18, autumn: 18, winter: 56 }[name];
    const particleMaterial = seasonalMaterial(stage,
      { spring: '#e9c9c2', summer: '#f4e9b2', autumn: '#b98b52', winter: '#f6f9ff' }[name],
      { emissive: name === 'summer' ? '#b5a25f' : '#000000', emissiveIntensity: 0.1,
        opacity: name === 'summer' ? 0.62 : 0.88 });
    const particles = new THREE.InstancedMesh(
      name === 'summer' || name === 'winter' ? sphereGeometry : leafGeometry,
      particleMaterial, particleCount);
    particles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    particles.frustumCulled = false;
    stage.group.add(particles);
    stage.particles.push({ mesh: particles, random, seeds: Array.from({ length: particleCount }, () => ({
      x: name === 'winter' ? (random() - 0.5) * 8.4 : -3.35 + (random() - 0.5) * 1.1,
      z: name === 'winter' ? (random() - 0.5) * 7.2 : -1.6 + (random() - 0.5) * 1.5,
      y: random(), phase: random() * 6.28, speed: 0.07 + random() * 0.09,
      size: name === 'winter' ? 0.016 + random() * 0.014 : name === 'summer' ? 0.012 : 0.06 + random() * 0.03,
    })) });
  }

  let selected = 'spring';
  let night = 0;
  let elapsed = TRANSITION_SECONDS;
  let particleTime = 0;

  function applyWeight(stage, weight) {
    stage.weight = weight;
    stage.group.visible = weight > 0.001;
    for (const material of stage.materials) {
      material.opacity = material.userData.baseOpacity * weight;
      material.depthWrite = weight > 0.995;
    }
    for (const pop of stage.pops) pop.scale.setScalar(0.96 + weight * 0.04);
  }

  function setSeason(name, { immediate = false } = {}) {
    if (!NAMES.includes(name)) throw new RangeError(`Unknown season: ${name}`);
    selected = name;
    elapsed = immediate || reducedMotion ? TRANSITION_SECONDS : 0;
    for (const [key, stage] of Object.entries(stages)) {
      stage.from = stage.weight;
      if (elapsed === TRANSITION_SECONDS) applyWeight(stage, key === selected ? 1 : 0);
    }
  }

  function setNight(amount) {
    night = clamp(amount);
    for (const material of stages.summer.materials) {
      if (material.emissive.getHex() !== 0) material.emissiveIntensity = 0.1 + night * 0.75;
    }
  }

  function setReducedMotion(enabled) {
    reducedMotion = Boolean(enabled);
    if (reducedMotion) setSeason(selected, { immediate: true });
  }

  function step(time, dt) {
    if (elapsed < TRANSITION_SECONDS) {
      elapsed = Math.min(TRANSITION_SECONDS, elapsed + Math.max(0, Number(dt) || 0));
      const progress = smooth(elapsed / TRANSITION_SECONDS);
      for (const [name, stage] of Object.entries(stages)) {
        const target = name === selected ? 1 : 0;
        applyWeight(stage, THREE.MathUtils.lerp(stage.from, target, progress));
      }
    }
    if (!reducedMotion) particleTime = Math.max(0, Number(time) || 0);
    const t = particleTime;
    for (const [name, stage] of Object.entries(stages)) {
      if (!stage.group.visible) continue;
      for (const { mesh: particles, seeds } of stage.particles) {
        seeds.forEach((seed, index) => {
          const fall = (seed.y + t * seed.speed) % 1;
          const height = name === 'winter' ? 7.8 : 3.3;
          const drift = name === 'summer' ? 0.1 : name === 'winter' ? 0.17 : 0.25;
          dummy.position.set(seed.x + Math.sin(t * 0.55 + seed.phase) * drift,
            GROUND_Y + 0.08 + (name === 'summer' ? seed.y : 1 - fall) * height,
            seed.z + Math.cos(t * 0.4 + seed.phase) * drift);
          dummy.rotation.set(seed.phase + t * 0.3, t * 0.4 + seed.phase, seed.phase + t * 0.2);
          dummy.scale.setScalar(seed.size);
          dummy.updateMatrix();
          particles.setMatrixAt(index, dummy.matrix);
        });
        particles.instanceMatrix.needsUpdate = true;
      }
    }
  }

  setSeason('spring', { immediate: true });
  step(0, 0);
  return {
    group, setSeason, setNight, setReducedMotion, step,
    get state() {
      return {
        season: selected, night, transitioning: elapsed < TRANSITION_SECONDS,
        reducedMotion, weights: Object.fromEntries(NAMES.map(name => [name, stages[name].weight])),
      };
    },
  };
}
