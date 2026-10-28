import * as THREE from '../vendor/three.module.min.js';

// These figures represent an aggregate count. They are not identifiable people
// and their little journeys are choreography, not a replay of browsing sessions.
export function buildVisitors({ reducedMotion = false, maxPeople = 24 } = {}) {
  const group = new THREE.Group();
  group.name = 'Springhues visitor representatives';
  const limit = Number.isSafeInteger(maxPeople) ? Math.max(0, Math.min(64, maxPeople)) : 24;
  const actors = [];
  const partLists = { box: [], round: [], limb: [], hair: [] };
  const batches = [];
  const outfits = [
    { coat: 0x3157a9, trousers: 0x474853, shirt: 0xf0e8d7, hair: 0x46372f, skin: 0xd9b294 },
    { coat: 0xe2d6bb, trousers: 0x526578, shirt: 0x8b2c43, hair: 0x685142, skin: 0xe0bda2 },
    { coat: 0x85354b, trousers: 0x68685c, shirt: 0xeee7d6, hair: 0x3d3430, skin: 0xc99a7e },
    { coat: 0x77866e, trousers: 0x66544b, shirt: 0xd9d7c6, hair: 0x514031, skin: 0xd7b295 },
    { coat: 0x9b795c, trousers: 0x3d526a, shirt: 0xf1e9d8, hair: 0x382f2c, skin: 0xbd8d72 },
    { coat: 0x4b677c, trousers: 0x81776b, shirt: 0xddcbb2, hair: 0x706051, skin: 0xe5c6a8 },
  ];
  // Keep strolling clear of the door swing, the A-board at (1.46, 2.92),
  // the rear tree, the planter, and the building's solid walls.
  const zones = [
    { x: [-3.62, -1.06], z: [2.96, 3.40], start: [-2.72, 3.10] },
    { x: [2.12, 3.71], z: [2.91, 3.42], start: [2.74, 3.25] },
    { x: [3.23, 3.84], z: [-.55, 2.40], start: [3.47, .72] },
    { x: [-3.82, -3.22], z: [-.30, 2.47], start: [-3.54, 1.24] },
    { x: [-.76, .64], z: [3.20, 3.43], start: [-.28, 3.36] },
  ];
  let total = null, desiredCount = 0, reduced = Boolean(reducedMotion);
  let elapsed = 0, opening = 0, guest = null, seed = 7319027;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const smooth = n => n * n * (3 - 2 * n);
  const clamp = THREE.MathUtils.clamp;
  const temp = new THREE.Vector3();
  const delta = new THREE.Vector3();
  const targetColor = new THREE.Color();

  function part(actor, kind, parent, color, position, scale, rotation = null) {
    const node = new THREE.Object3D();
    node.position.set(...position); node.scale.set(...scale);
    if (rotation) node.rotation.set(...rotation);
    parent.add(node); partLists[kind].push({ actor, node, color });
    return node;
  }
  function joint(parent, x, y, z) {
    const node = new THREE.Object3D(); node.position.set(x, y, z); parent.add(node); return node;
  }
  function home(actor) {
    const zone = actor.zone;
    if (actor.index < zones.length) actor.rig.position.set(zone.start[0], .12, zone.start[1]);
    else {
      const row = Math.floor(actor.index / zones.length);
      const tx = ((row * .381966 + actor.index * .113) % 1);
      const tz = ((row * .618034 + actor.index * .137) % 1);
      actor.rig.position.set(THREE.MathUtils.lerp(...zone.x, tx), .12, THREE.MathUtils.lerp(...zone.z, tz));
    }
    actor.rig.rotation.y = actor.index % 2 ? -.8 : .65;
    actor.activity = 'standing'; actor.path = []; actor.wait = 1 + actor.index * .29;
    actor.nextVisit = elapsed + 3 + actor.index * 13; actor.heading = actor.rig.rotation.y;
    actor.stride = 0; actor.speed = 0; actor.blocked = 0;
  }
  for (let index = 0; index < limit; index++) {
    const outfit = outfits[index % outfits.length];
    const rig = new THREE.Object3D();
    const actor = { index, rig, pose: joint(rig, 0, 0, 0), zone: zones[index % zones.length],
      opacity: 0, targetOpacity: 0, phase: index * 1.9, limbs: [], arms: [], activity: 'standing',
      stride: 0, speed: 0, blocked: 0, target: new THREE.Vector3(), path: [],
      walkSpeed: .29 + (index % 5) * .017, targetScale: .96 + (index % 4) * .025 };
    const pose = actor.pose;
    // Small sculpted coats, a visible shirt opening, lapels, buttons, and faces.
    part(actor, 'round', pose, outfit.coat, [0, .457, 0], [.107, .155, .070]);
    part(actor, 'box', pose, outfit.shirt, [0, .525, .060], [.070, .111, .020]);
    for (const side of [-1, 1]) {
      part(actor, 'box', pose, outfit.coat, [side * .043, .535, .071], [.039, .094, .017], [0, 0, -side * .32]);
      part(actor, 'round', pose, 0x594d3e, [.006, .425 + (side + 1) * .025, .073], [.006, .006, .004]);
    }
    part(actor, 'round', pose, outfit.skin, [0, .603, 0], [.034, .042, .033]);
    part(actor, 'round', pose, outfit.skin, [0, .687, .006], [.074, .088, .068]);
    part(actor, 'hair', pose, outfit.hair, [0, .692, .001], [.078, .090, .073]);
    part(actor, 'round', pose, outfit.skin, [0, .678, .074], [.012, .015, .017]);
    for (const side of [-1, 1]) {
      part(actor, 'round', pose, 0x4b423a, [side * .025, .697, .067], [.005, .005, .003]);
      part(actor, 'round', pose, outfit.skin, [side * .070, .678, .004], [.012, .020, .014]);
      const hip = joint(pose, side * .046, .341, 0);
      part(actor, 'limb', hip, outfit.trousers, [0, -.076, 0], [.039, .154, .039]);
      const knee = joint(hip, 0, -.154, 0);
      part(actor, 'limb', knee, outfit.trousers, [0, -.074, 0], [.031, .150, .031]);
      part(actor, 'round', knee, 0x423c36, [0, -.159, .024], [.037, .026, .066]);
      actor.limbs.push({ hip, knee, side });
      const shoulder = joint(pose, side * .108, .553, .003);
      shoulder.rotation.z = side * -.10;
      part(actor, 'limb', shoulder, outfit.coat, [0, -.062, 0], [.032, .126, .032]);
      const elbow = joint(shoulder, 0, -.127, 0);
      part(actor, 'limb', elbow, outfit.coat, [0, -.047, 0], [.026, .100, .026]);
      part(actor, 'round', elbow, outfit.skin, [0, -.112, .002], [.025, .032, .024]);
      actor.arms.push({ shoulder, elbow, side, carrying: side > 0 && index % 3 === 0 });
    }
    if (index % 3 === 0) {
      const hand = actor.arms[1].elbow;
      part(actor, 'box', hand, 0x284a9b, [0, -.102, .028], [.102, .135, .042], [.18, 0, -.10]);
      part(actor, 'box', hand, 0xe8dfc8, [0, -.102, .054], [.089, .122, .013], [.18, 0, -.10]);
    } else if (index % 3 === 1) {
      part(actor, 'box', pose, 0xc3a178, [.135, .323, .008], [.120, .155, .065], [0, 0, -.06]);
      part(actor, 'box', pose, 0x745a45, [.083, .455, .071], [.016, .244, .012], [0, 0, .37]);
      part(actor, 'box', pose, 0xe6dbc0, [.135, .329, .046], [.063, .064, .006]);
    } else {
      part(actor, 'box', pose, 0xe3d1b8, [0, .591, .036], [.095, .035, .067]);
      part(actor, 'box', pose, 0xe3d1b8, [-.035, .520, .079], [.033, .137, .018], [0, 0, -.08]);
    }
    if (index % 5 === 3) part(actor, 'round', pose, 0x7d3446, [0, .757, -.005], [.082, .039, .078]);
    actors.push(actor); home(actor);
  }

  // One pooled mesh for each shape. Ordered stippling lets each instance fade
  // without transparent sorting, material clones, or per-person GPU resources.
  function fadeShader(shader) {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nattribute float instanceOpacity;\nvarying float vVisitorOpacity;');
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvVisitorOpacity = instanceOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying float vVisitorOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>',
      '#include <alphatest_fragment>\nfloat visitorDither = fract(dot(floor(gl_FragCoord.xy), vec2(0.754877666, 0.569840296)));\nif (vVisitorOpacity <= visitorDither) discard;');
  }
  const surface = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .86, metalness: 0 });
  surface.onBeforeCompile = fadeShader; surface.customProgramCacheKey = () => 'springhues-visitors-fade-v1';
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depth.onBeforeCompile = fadeShader; depth.customProgramCacheKey = () => 'springhues-visitors-depth-v1';
  const shapes = {
    box: new THREE.BoxGeometry(1, 1, 1),
    round: new THREE.SphereGeometry(1, 10, 7),
    limb: new THREE.CylinderGeometry(.84, 1, 1, 8),
    hair: new THREE.SphereGeometry(1, 12, 7, 0, Math.PI * 2, 0, Math.PI * .58),
  };
  // Lift the fringe over the face while keeping the nape lower at the back.
  const hairPositions = shapes.hair.getAttribute('position');
  for (let i = 0; i < hairPositions.count; i++) {
    const azimuth = Math.atan2(hairPositions.getX(i), hairPositions.getZ(i));
    const original = Math.acos(clamp(hairPositions.getY(i), -1, 1));
    const edge = 1.93 - Math.max(0, Math.cos(azimuth)) * .79;
    const theta = original / (Math.PI * .58) * edge;
    hairPositions.setXYZ(i, Math.sin(azimuth) * Math.sin(theta), Math.cos(theta), Math.cos(azimuth) * Math.sin(theta));
  }
  shapes.hair.computeVertexNormals();
  for (const [kind, parts] of Object.entries(partLists)) {
    const alpha = new THREE.InstancedBufferAttribute(new Float32Array(parts.length), 1);
    alpha.setUsage(THREE.DynamicDrawUsage); shapes[kind].setAttribute('instanceOpacity', alpha);
    const mesh = new THREE.InstancedMesh(shapes[kind], surface, parts.length);
    mesh.name = `Pooled visitor ${kind} parts`; mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.customDepthMaterial = depth; mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    parts.forEach((item, index) => mesh.setColorAt(index, targetColor.setHex(item.color)));
    group.add(mesh); batches.push({ mesh, parts, alpha });
  }
  function syncInstances() {
    for (const actor of actors) {
      const visible = smooth(clamp(actor.opacity, 0, 1));
      actor.rig.scale.setScalar(actor.targetScale * (.96 + visible * .04));
      actor.rig.updateMatrixWorld(true);
    }
    for (const { mesh, parts, alpha } of batches) {
      parts.forEach(({ actor, node }, index) => {
        mesh.setMatrixAt(index, node.matrixWorld);
        alpha.setX(index, smooth(clamp(actor.opacity, 0, 1)));
      });
      mesh.instanceMatrix.needsUpdate = true; alpha.needsUpdate = true;
    }
    group.visible = actors.some(actor => actor.opacity > 0);
  }
  function poseActor(actor, distance, dt) {
    const walking = distance > .00001 ? 1 : 0;
    actor.stride = THREE.MathUtils.damp(actor.stride, walking, 11, dt);
    actor.phase += distance * 24;
    const swing = Math.sin(actor.phase);
    actor.pose.position.y = Math.abs(swing) * .006 * actor.stride;
    actor.pose.rotation.z = swing * .018 * actor.stride;
    for (const leg of actor.limbs) {
      const step = Math.sin(actor.phase + (leg.side > 0 ? Math.PI : 0));
      leg.hip.rotation.x = step * .35 * actor.stride;
      leg.knee.rotation.x = Math.max(0, -step) * .44 * actor.stride;
    }
    for (const arm of actor.arms) {
      arm.shoulder.rotation.x = arm.carrying ? -.20 : -swing * arm.side * .25 * actor.stride;
      arm.elbow.rotation.x = arm.carrying ? -.75 : -.10 - Math.max(0, swing * arm.side) * .10 * actor.stride;
    }
  }
  function chooseWander(actor, away = null) {
    const zone = actor.zone;
    let x = THREE.MathUtils.lerp(...zone.x, random());
    let z = THREE.MathUtils.lerp(...zone.z, random());
    if (away) {
      x = actor.rig.position.x >= away.x ? zone.x[1] : zone.x[0];
      z = actor.rig.position.z >= away.z ? zone.z[1] : zone.z[0];
    }
    actor.target.set(x, .12, z); actor.activity = 'walking'; actor.blocked = 0;
  }
  function startVisit(actor) {
    guest = actor;
    const p = actor.rig.position;
    const route = [];
    if (p.z < 2.8) route.push([p.x > 0 ? 3.50 : -3.48, .12, 3.38]);
    if (p.x > 1.0) route.push([2.15, .12, 3.46]);
    route.push([0, .12, 3.40], [0, .12, 2.74], [0, .29, 2.36], [0, .33, 1.50]);
    actor.path = route; actor.target.fromArray(actor.path.shift()); actor.activity = 'approaching'; actor.wait = 0;
  }
  function reached(actor) {
    if (actor.activity === 'walking') {
      actor.activity = 'standing'; actor.wait = .8 + random() * 3.4; return;
    }
    if (actor.path.length) {
      actor.target.fromArray(actor.path.shift());
      if (actor.activity === 'approaching' && actor.target.z < 2.5) actor.activity = 'entering';
      return;
    }
    if (actor.activity === 'entering' || actor.activity === 'approaching') {
      actor.activity = 'browsing'; actor.wait = 4.5 + random() * 4.0;
    } else if (actor.activity === 'leaving') {
      guest = null; actor.nextVisit = elapsed + 30 + actor.index * 5;
      chooseWander(actor);
      const destination = actor.target.toArray();
      const route = [];
      if (actor.zone.x[0] > 0) route.push([2.15, .12, 3.46]);
      if (actor.zone.z[0] < 2.8) route.push([actor.zone.x[0] > 0 ? 3.50 : -3.48, .12, 3.40]);
      route.push(destination);
      actor.activity = 'returning'; actor.path = route; actor.target.fromArray(actor.path.shift());
    } else if (actor.activity === 'returning') {
      actor.activity = 'standing'; actor.wait = 1 + random() * 2;
    }
  }
  function setCount(value) {
    total = Number.isSafeInteger(value) && value >= 0 ? value : null;
    desiredCount = Math.min(total ?? 0, limit);
    for (const actor of actors) {
      const active = actor.index < desiredCount;
      if (active && !actor.targetOpacity) home(actor);
      actor.targetOpacity = active ? 1 : 0;
      if (reduced) { actor.opacity = actor.targetOpacity; home(actor); poseActor(actor, 0, 1); }
    }
    if (guest && guest.index >= desiredCount) guest = null;
    if (reduced || desiredCount === 0) opening = 0;
    syncInstances();
  }
  function setReducedMotion(value) {
    reduced = Boolean(value); guest = null; opening = 0;
    for (const actor of actors) {
      home(actor); actor.opacity = actor.targetOpacity; poseActor(actor, 0, 10);
    }
    syncInstances();
  }
  function step(_time, dt) {
    const seconds = clamp(Number.isFinite(dt) ? dt : 0, 0, .1);
    if (reduced || seconds === 0) return;
    elapsed += seconds;
    for (const actor of actors) actor.opacity += Math.sign(actor.targetOpacity - actor.opacity)
      * Math.min(Math.abs(actor.targetOpacity - actor.opacity), seconds * 2.0);
    const needsDoor = guest && guest.targetOpacity > 0 && guest.rig.position.z < 3.16
      && (guest.activity === 'approaching' || guest.activity === 'entering' || guest.activity === 'leaving');
    opening = THREE.MathUtils.damp(opening, needsDoor ? 1 : 0, 6, seconds);
    if (opening < .001) opening = 0;
    const active = actors.filter(actor => actor.targetOpacity > 0);
    // The visitor entering the shop has priority; walkers leave its route clear.
    const ordered = guest ? [guest, ...active.filter(actor => actor !== guest)] : active;
    for (const actor of ordered) {
      let moved = 0;
      if (actor.activity === 'standing' || actor.activity === 'browsing') {
        actor.wait -= seconds;
        if (actor.activity === 'browsing') actor.rig.rotation.y = THREE.MathUtils.damp(actor.rig.rotation.y, -.55, 3, seconds);
        if (actor.wait <= 0) {
          if (actor.activity === 'browsing') {
            actor.activity = 'leaving'; actor.path = [[0, .29, 2.36], [0, .12, 2.74], [0, .12, 3.40]];
            actor.target.fromArray(actor.path.shift());
          } else if (!guest && elapsed >= actor.nextVisit) startVisit(actor);
          else chooseWander(actor);
        }
      } else {
        delta.copy(actor.target).sub(actor.rig.position);
        const distance = delta.length();
        if (distance < .012) { actor.rig.position.copy(actor.target); reached(actor); }
        else {
          const heading = Math.atan2(delta.x, delta.z);
          const angle = Math.atan2(Math.sin(heading - actor.rig.rotation.y), Math.cos(heading - actor.rig.rotation.y));
          actor.rig.rotation.y += angle * (1 - Math.exp(-seconds * 8));
          const waitsForDoor = actor === guest && opening < .90
            && ((actor.activity === 'entering' && actor.rig.position.z > 2.36 && actor.rig.position.z < 2.78)
              || (actor.activity === 'leaving' && actor.rig.position.z > 2.05 && actor.rig.position.z < 2.4));
          const speed = waitsForDoor ? 0 : actor.walkSpeed * (Math.abs(angle) > 1.0 ? .48 : 1);
          moved = Math.min(distance, speed * seconds);
          temp.copy(actor.rig.position).addScaledVector(delta, moved / distance);
          const obstacle = active.find(other => other !== actor
            && Math.abs(other.rig.position.y - temp.y) < .15
            && Math.hypot(other.rig.position.x - temp.x, other.rig.position.z - temp.z) < .235);
          if (obstacle && actor !== guest) {
            moved = 0; actor.blocked += seconds;
            if (actor.blocked > .55 && actor.activity === 'walking') chooseWander(actor, obstacle.rig.position);
          } else {
            actor.rig.position.copy(temp); actor.blocked = 0;
            if (moved >= distance - .001) reached(actor);
          }
        }
      }
      poseActor(actor, moved, seconds);
    }
    syncInstances();
  }
  syncInstances();
  return {
    group, setCount, setReducedMotion, step,
    get doorOpen() { return opening; },
    get state() {
      return {
        totalCount: total, count: desiredCount, representedCount: desiredCount,
        visibleCount: actors.filter(actor => actor.opacity > .01).length,
        capped: total !== null && total > limit, maxPeople: limit, reducedMotion: reduced,
        doorOpen: opening,
        activities: actors.filter(actor => actor.index < desiredCount).map(actor => ({
          index: actor.index, activity: actor.activity, position: actor.rig.position.toArray(), opacity: actor.opacity,
        })),
      };
    },
  };
}
