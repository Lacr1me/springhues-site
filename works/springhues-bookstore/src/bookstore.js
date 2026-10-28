import * as THREE from '../vendor/three.module.min.js';

/** A new, reference-led miniature. All geometry and artwork are generated locally. */
export function buildBookstore() {
  const group = new THREE.Group();
  group.name = 'Springhues — the little bookshop';
  const C = {
    ivory: 0xf1eee3, blue: 0x2850b3, blueEdge: 0x243c83,
    wine: 0x791e38, wood: 0x96724d, woodDark: 0x564534,
    paper: 0xe9dfbd, roof: 0x92958f, metal: 0x4b4d46,
    outline: 0x424840, green: 0x718b63,
  };
  const materials = Object.fromEntries(Object.entries(C).map(([name, color]) => [
    name, new THREE.MeshStandardMaterial({ color, roughness: name === 'metal' ? .55 : .81, metalness: name === 'metal' ? .42 : .02 }),
  ]));
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const edges = new THREE.EdgesGeometry(cube).getAttribute('position');
  const edgeVertices = [];
  const animatedSigns = [];
  const bulbs = [];
  const lampLights = [];
  const doorPivots = [];
  const bookInstances = { covers: [], pages: [], bands: [] };
  const stats = { books: 0, shelves: 0, lanterns: 0, windows: 0 };
  const _matrix = new THREE.Matrix4();
  const _position = new THREE.Vector3();
  const _quaternion = new THREE.Quaternion();
  const _scale = new THREE.Vector3();
  let seed = 30281019;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

  function box(w, h, d, x, y, z, material = materials.ivory, outline = false, parent = group) {
    const mesh = new THREE.Mesh(cube, material);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    if (outline && parent === group) {
      for (let i = 0; i < edges.count; i++) {
        edgeVertices.push(edges.getX(i) * w + x, edges.getY(i) * h + y, edges.getZ(i) * d + z);
      }
    }
    return mesh;
  }
  function cylinder(radiusTop, radiusBottom, height, material, x, y, z, parent = group, segments = 16) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, segments), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
  function sphere(radius, material, x, y, z, parent = group) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 12, 8), material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }
  function texture(width, height, paint) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paint(canvas.getContext('2d'), width, height);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
  }
  function artMaterial(kind = 'branch', tint = '#7c253b') {
    const map = texture(256, 384, (ctx, w, h) => {
      ctx.fillStyle = '#efe8d4'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = '#8b8068'; ctx.lineWidth = 3; ctx.strokeRect(12, 12, w - 24, h - 24);
      ctx.strokeStyle = '#53634b'; ctx.fillStyle = tint;
      ctx.lineWidth = 5; ctx.lineCap = 'round';
      if (kind === 'letter') {
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.font = 'italic bold 190px Georgia, serif'; ctx.fillText('S', w / 2, h / 2);
        ctx.strokeStyle = '#a79a78'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(65, 295); ctx.lineTo(190, 295); ctx.stroke();
      } else if (kind === 'book') {
        ctx.fillStyle = tint; ctx.strokeStyle = '#665344'; ctx.lineWidth = 7;
        ctx.beginPath(); ctx.moveTo(38, 135); ctx.quadraticCurveTo(88, 113, 128, 140);
        ctx.quadraticCurveTo(171, 113, 218, 135); ctx.lineTo(218, 258);
        ctx.quadraticCurveTo(168, 240, 128, 266); ctx.quadraticCurveTo(88, 240, 38, 258);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.strokeStyle = '#efe8d4'; ctx.lineWidth = 4;
        for (let y = 158; y < 235; y += 20) {
          ctx.beginPath(); ctx.moveTo(56, y); ctx.lineTo(108, y + 3); ctx.moveTo(148, y + 3); ctx.lineTo(200, y); ctx.stroke();
        }
        ctx.beginPath(); ctx.moveTo(128, 142); ctx.lineTo(128, 263); ctx.stroke();
      } else {
        ctx.beginPath(); ctx.moveTo(128, 333); ctx.bezierCurveTo(146, 247, 103, 160, 130, 72); ctx.stroke();
        const levels = kind === 'leaf' ? 3 : 5;
        for (let i = 0; i < levels; i++) {
          const y = 285 - i * 43;
          for (const side of [-1, 1]) {
            ctx.fillStyle = i % 3 === 0 && kind === 'leaf' ? '#b78961' : ['#829374', '#708b65', '#98a181'][i % 3];
            ctx.beginPath(); ctx.moveTo(128, y + 8);
            ctx.bezierCurveTo(128 + side * 55, y + 6, 128 + side * 68, y - 28, 128 + side * 65, y - 43);
            ctx.bezierCurveTo(128 + side * 27, y - 38, 128 + side * 9, y - 15, 128, y + 8);
            ctx.fill(); ctx.stroke();
          }
        }
        if (kind === 'branch') {
          ctx.fillStyle = '#c68c6c'; ctx.beginPath(); ctx.moveTo(129, 87);
          ctx.bezierCurveTo(92, 73, 101, 39, 113, 34); ctx.lineTo(128, 51); ctx.lineTo(144, 32);
          ctx.bezierCurveTo(160, 55, 156, 78, 129, 87); ctx.fill(); ctx.stroke();
        }
      }
    });
    return new THREE.MeshStandardMaterial({ map, roughness: 1, side: THREE.DoubleSide });
  }
  const art = [artMaterial('branch'), artMaterial('letter', '#973d42'), artMaterial('book', '#3a5d99'), artMaterial('leaf'), artMaterial('letter', '#344984')];

  // The opaque shell is assembled around openings — there are no walls behind the glass.
  box(5.2, .13, 4.7, 0, .185, 0, materials.blueEdge, true);
  box(4.92, .09, 4.42, 0, .285, 0, materials.wood);
  box(5.2, 5.68, .18, 0, 3.08, -2.26, materials.ivory, true);
  box(.18, 5.68, 4.52, -2.51, 3.08, 0, materials.ivory, true);
  // Square masonry columns at the two visible shopfronts.
  for (const x of [-2.38, 2.38]) {
    box(.44, 2.54, .34, x, 1.52, 2.19, materials.ivory, true);
    box(.46, .30, .37, x, .43, 2.20, materials.wine, true);
    box(.47, .12, .39, x, .22, 2.20, materials.blue, true);
  }
  box(.36, 2.54, .42, 2.42, 1.52, -2.13, materials.ivory, true);
  box(.39, .30, .43, 2.42, .43, -2.13, materials.wine, true);
  box(.42, .12, .46, 2.42, .22, -2.13, materials.blue, true);

  // Ground-floor kick panels, recessed ivory inserts and wine-coloured window sills.
  for (const [x, width] of [[-1.485, 1.35], [1.50, 1.30]]) {
    box(width, .51, .20, x, .535, 2.25, materials.ivory, true);
    box(width - .17, .32, .035, x, .54, 2.367, materials.woodDark);
    box(width - .21, .28, .042, x, .54, 2.392, materials.ivory);
    box(width + .08, .105, .32, x, .835, 2.29, materials.wine, true);
  }
  box(.20, .51, 3.92, 2.47, .535, 0, materials.ivory, true);
  for (const z of [-1.03, 1.03]) {
    box(.028, .32, 1.77, 2.578, .54, z, materials.woodDark);
    box(.035, .28, 1.73, 2.599, .54, z, materials.ivory);
  }
  box(.34, .105, 4.06, 2.49, .835, 0, materials.wine, true);

  // The thick blue shopfront fascia and continuous name band.
  box(5.37, .30, 4.84, 0, 2.865, 0, materials.blue, true);
  box(5.48, .065, 4.92, 0, 3.045, 0, materials.blue, true);
  box(5.2, .70, 4.7, 0, 3.425, 0, materials.ivory, true);
  box(4.87, .12, 4.38, 0, 3.80, 0, materials.wood);
  box(5.38, .095, 4.85, 0, 3.825, 0, materials.wine, true);
  // Second-storey corner piers and header create tall, continuous window bays.
  for (const x of [-2.38, 2.38]) box(.44, 2.20, .36, x, 4.95, 2.18, materials.ivory, true);
  box(.36, 2.20, .42, 2.42, 4.95, -2.13, materials.ivory, true);
  box(5.20, .23, 4.70, 0, 5.965, 0, materials.ivory, true);
  // Flat recessed roof, low stone parapet, and precise blue capping.
  box(4.99, .09, 4.49, 0, 6.085, 0, materials.roof);
  for (const z of [-2.30, 2.30]) {
    box(5.29, .16, .12, 0, 6.155, z, materials.roof, true);
    box(5.34, .035, .18, 0, 6.25, z, materials.blue, true);
  }
  for (const x of [-2.57, 2.57]) {
    box(.12, .16, 4.51, x, 6.155, 0, materials.roof, true);
    box(.18, .035, 4.52, x, 6.25, 0, materials.blue, true);
  }

  const frostingMap = texture(384, 512, (ctx, w, h) => {
    const base = ctx.createLinearGradient(0, 0, w, h);
    base.addColorStop(0, '#dfdfd5'); base.addColorStop(.33, '#c8c4b7');
    base.addColorStop(.66, '#e8e1d2'); base.addColorStop(1, '#c5c9c4');
    ctx.fillStyle = base; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createRadialGradient(w * .52, h * .40, 0, w * .52, h * .40, h * .48);
    glow.addColorStop(0, '#e8dcc3'); glow.addColorStop(1, 'rgba(232,220,195,0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const reflection = ctx.createLinearGradient(0, 0, w, 0);
    reflection.addColorStop(0, 'rgba(255,255,255,0)'); reflection.addColorStop(.18, 'rgba(255,255,255,.22)');
    reflection.addColorStop(.28, 'rgba(255,255,255,0)'); reflection.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = reflection; ctx.fillRect(0, 0, w, h);
  });
  const glassMat = new THREE.MeshStandardMaterial({
    map: frostingMap, color: 0xffffff, roughness: .82, metalness: .015, transparent: true,
    opacity: .68, depthWrite: false, side: THREE.DoubleSide,
    emissive: 0xffce88, emissiveIntensity: 0,
  });
  const frontUpperGlass = glassMat.clone(); frontUpperGlass.opacity = .78;
  const clearGlass = new THREE.MeshStandardMaterial({
    color: 0xd8e0db, roughness: .32, metalness: .08, transparent: true,
    opacity: .075, depthWrite: false, side: THREE.DoubleSide,
  });
  function glass(w, h, x, y, z, turn = 0, clear = false) {
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), clear ? clearGlass : glassMat);
    mesh.position.set(x, y, z); mesh.rotation.y = turn; mesh.renderOrder = 2; group.add(mesh); stats.windows++;
    return mesh;
  }
  // Front upper windows: four tall lights, with a horizontal transom.
  for (const x of [-2.105, -1.40, .06, 1.40, 2.105]) box(.055, 1.99, .105, x, 4.87, 2.345, materials.blue, true);
  for (const y of [3.90, 5.36, 5.84]) box(4.26, .055, .105, 0, y, 2.345, materials.blue, true);
  glass(4.20, 1.91, 0, 4.87, 2.332).material = frontUpperGlass;
  // Right upper windows open directly onto the very real little library.
  for (const z of [-1.93, -.64, .64, 1.93]) box(.105, 1.99, .055, 2.585, 4.87, z, materials.blue, true);
  for (const y of [3.90, 5.36, 5.84]) box(.105, .055, 3.91, 2.585, y, 0, materials.blue, true);
  glass(3.84, 1.91, 2.573, 4.87, 0, Math.PI / 2, true);
  // Lower side bay: two large panes with a top light.
  for (const z of [-1.93, -.65, .65, 1.93]) box(.10, 1.88, .065, 2.595, 1.79, z, materials.blue, true);
  for (const y of [.90, 2.30, 2.69]) box(.10, .065, 3.91, 2.595, y, 0, materials.blue, true);
  glass(3.82, 1.76, 2.585, 1.79, 0, Math.PI / 2);
  // Lower front glazing around the double doors.
  for (const [x, w] of [[-1.49, 1.30], [1.49, 1.30]]) {
    glass(w, 1.37, x, 1.575, 2.365);
    for (const dx of [-w / 2, w / 2]) box(.065, 1.88, .11, x + dx, 1.79, 2.38, materials.blue, true);
    box(w, .065, .11, x, 2.28, 2.38, materials.blue, true);
    box(w, .37, .07, x, 2.50, 2.355, materials.wine, true);
  }
  box(1.65, .37, .10, 0, 2.50, 2.355, materials.wine, true);
  box(1.72, .065, .12, 0, 2.28, 2.38, materials.blue, true);
  box(1.71, .055, .40, 0, .29, 2.35, materials.roof, true);
  // Each leaf pivots on its outer jamb and really opens towards the viewer.
  for (const side of [-1, 1]) {
    const pivot = new THREE.Group(); pivot.position.set(side * .80, .30, 2.38); group.add(pivot);
    pivot.userData.side = side; doorPivots.push(pivot);
    const x = -side * .39;
    box(.78, 1.96, .085, x, .98, 0, materials.blue, false, pivot);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(.58, 1.24), glassMat);
    pane.position.set(x, 1.23, .049); pivot.add(pane);
    // Actual cut-out glazing: replace the full leaf by rails and two stiles.
    const solid = pivot.children[0]; pivot.remove(solid);
    box(.078, 1.96, .09, x - .35, .98, 0, materials.blue, false, pivot);
    box(.078, 1.96, .09, x + .35, .98, 0, materials.blue, false, pivot);
    box(.70, .09, .09, x, 1.92, 0, materials.blue, false, pivot);
    box(.70, .095, .09, x, .54, 0, materials.blue, false, pivot);
    box(.70, .48, .095, x, .255, 0, materials.blue, false, pivot);
    box(.52, .30, .018, x, .255, .059, materials.blueEdge, false, pivot);
    box(.49, .27, .021, x, .255, .072, materials.blue, false, pivot);
    const brass = new THREE.MeshStandardMaterial({ color: 0xbca56a, metalness: .62, roughness: .4 });
    sphere(.040, brass, -side * .72, .72, .085, pivot);
    cylinder(.025, .025, .065, brass, -side * .72, .72, .053, pivot).rotation.x = Math.PI / 2;
  }

  // Raised burgundy lettering, drawn on alpha-cut local layers to preserve crisp letter shapes.
  const wordMap = texture(2048, 256, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = '900 220px "Arial Narrow", "Roboto Condensed", Arial, sans-serif';
    ctx.fillStyle = '#ffffff'; ctx.fillText('SPRINGHUES', w / 2, h / 2 + 7, w - 48);
  });
  for (let i = 0; i < 4; i++) {
    const letterMaterial = new THREE.MeshStandardMaterial({
      map: wordMap, color: i === 3 ? C.wine : 0x44232c, roughness: .75, transparent: true, alphaTest: .2,
    });
    const letters = new THREE.Mesh(new THREE.PlaneGeometry(4.00, .51), letterMaterial);
    letters.position.set(.005 * (3 - i), 3.415 - .006 * (3 - i), 2.365 + i * .006);
    letters.name = 'SPRINGHUES raised lettering'; group.add(letters);
  }

  const bookPalette = [0x9e5b4a, 0xb68158, 0xc6b581, 0x7b8b68, 0x6c7c8c, 0x80607b, 0xb7b49b, 0x536d5d, 0xc49d65, 0x965d55];
  function instance(kind, x, y, z, w, h, d, color, parentMatrix, tilt = 0) {
    _quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt);
    _matrix.compose(_position.set(x, y, z), _quaternion, _scale.set(w, h, d));
    if (parentMatrix) _matrix.premultiply(parentMatrix);
    bookInstances[kind].push({ matrix: _matrix.clone(), color });
  }
  function shelf({ x, y, z, width = 3.7, height = 1.91, rows = 4, columns = 3, turn = 0, density = 1 }) {
    const shelfGroup = new THREE.Group(); shelfGroup.position.set(x, y, z); shelfGroup.rotation.y = turn; group.add(shelfGroup);
    shelfGroup.updateMatrixWorld(true); const transform = shelfGroup.matrixWorld.clone();
    const depth = .40;
    box(width, height, .055, 0, height / 2, -depth / 2, materials.woodDark, false, shelfGroup);
    for (let i = 0; i <= columns; i++) box(.052, height, depth, -width / 2 + i * width / columns, height / 2, 0, materials.wood, false, shelfGroup);
    for (let row = 0; row <= rows; row++) box(width, .048, depth + .035, 0, row * height / rows, .012, materials.wood, false, shelfGroup);
    const bayW = width / columns;
    const rowH = height / rows;
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < columns; col++) {
        let cursor = -width / 2 + col * bayW + .055;
        const end = -width / 2 + (col + 1) * bayW - .05;
        while (cursor < end - .07) {
          const w = .055 + random() * .055;
          const h = rowH * (.63 + random() * .23);
          const d = .255 + random() * .055;
          const xx = cursor + w / 2;
          const yy = row * rowH + .026 + h / 2;
          const zz = .048 + random() * .018;
          const color = bookPalette[Math.floor(random() * bookPalette.length)];
          const tilt = random() > .90 ? (random() - .5) * .17 : 0;
          instance('covers', xx, yy, zz, w, h, d, color, transform, tilt);
          instance('pages', xx, yy + h / 2 + .002, zz - .012, w * .71, .011, d * .80, C.paper, transform, tilt);
          if (random() > .20) instance('bands', xx, yy + h * .28, zz + d / 2 + .002, w * .65, .012, .006, C.paper, transform, tilt);
          if (random() > .52) instance('bands', xx, yy - h * .27, zz + d / 2 + .002, w * .65, .009, .006, C.paper, transform, tilt);
          stats.books++; cursor += w + .009 + (random() > .94 ? .07 : 0);
          if (random() > density) cursor += .065;
        }
      }
    }
    stats.shelves++;
  }
  // The first shelf faces the right-hand window; the second sits across the rear wall.
  shelf({ x: 2.12, y: 3.92, z: -.02, width: 3.78, height: 1.84, turn: Math.PI / 2 });
  shelf({ x: -.21, y: 3.92, z: -1.94, width: 3.87, height: 1.84, density: .94 });
  shelf({ x: -.18, y: .40, z: -1.94, width: 3.80, height: 1.94, rows: 4, density: .88 });
  shelf({ x: -2.08, y: .40, z: -.10, width: 3.46, height: 1.94, turn: Math.PI / 2, density: .88 });

  // Warm interiors remain modelled and visible through the front, rather than pasted pictures.
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xb59b72, roughness: .93 });
  box(4.75, .04, 4.28, 0, 3.905, 0, floorMat);
  for (let i = 0; i < 13; i++) box(.010, .005, 4.20, -2.18 + i * .36, 3.929, 0, materials.wood);
  function table(x, y, z, width, depth) {
    box(width, .09, depth, x, y, z, materials.wood, true);
    for (const dx of [-width * .38, width * .38]) for (const dz of [-depth * .34, depth * .34]) {
      box(.07, .68, .07, x + dx, y - .36, z + dz, materials.woodDark);
    }
  }
  table(-.35, 4.60, .75, 2.16, 1.06);
  table(.40, 1.09, .30, 1.75, 1.04);
  for (let i = 0; i < 5; i++) {
    box(.42 - i * .018, .045, .30, -.63 + Math.sin(i) * .035, 4.67 + i * .045, .75, materials[i % 2 ? 'wine' : 'paper']);
    box(.40, .045, .29, .38 + Math.sin(i) * .015, 1.16 + i * .045, .30, materials[i % 2 ? 'blueEdge' : 'paper']);
  }
  // Two small chairs in the upstairs reading corner.
  for (const x of [-1.12, .43]) {
    box(.44, .06, .44, x, 4.35, 1.55, materials.wood);
    for (const dx of [-.16, .16]) for (const dz of [-.16, .16]) box(.045, .43, .045, x + dx, 4.11, 1.55 + dz, materials.woodDark);
    box(.43, .30, .06, x, 4.66, 1.74, materials.wood);
    for (const dx of [-.17, .17]) box(.04, .62, .04, x + dx, 4.58, 1.73, materials.woodDark);
  }
  function pot(x, y, z, scale = 1) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.scale.setScalar(scale); group.add(g);
    cylinder(.12, .085, .22, materials.ivory, 0, .11, 0, g);
    cylinder(.106, .106, .018, materials.woodDark, 0, .225, 0, g);
    for (let i = 0; i < 7; i++) {
      const angle = i * 2.399;
      const leaf = sphere(.10, materials.green, Math.cos(angle) * .09, .35 + (i % 3) * .055, Math.sin(angle) * .09, g);
      leaf.scale.set(.62, 1.75, .36); leaf.rotation.z = Math.cos(angle) * .65;
    }
  }
  pot(.43, 4.66, .68, .85); pot(-1.65, .34, 1.82, 1.1);

  function framedArt(parent, width, height, index) {
    box(width, height, .046, 0, 0, 0, materials.woodDark, false, parent);
    box(width - .035, height - .035, .052, 0, 0, .008, materials.wood, false, parent);
    const print = new THREE.Mesh(new THREE.PlaneGeometry(width - .065, height - .065), art[index % art.length]);
    print.position.z = .036; parent.add(print);
  }
  // Framed mini prints along both door posts and the right side.
  for (const x of [-2.37, 2.37]) for (let i = 0; i < 3; i++) {
    const frame = new THREE.Group(); frame.position.set(x, 1.05 + i * .43, 2.391); group.add(frame);
    framedArt(frame, .285, .35, i + (x > 0 ? 1 : 0));
  }
  for (const z of [-2.12, 2.12]) for (let i = 0; i < 3; i++) {
    const frame = new THREE.Group(); frame.position.set(2.612, 1.05 + i * .43, z); frame.rotation.y = Math.PI / 2; group.add(frame);
    framedArt(frame, .285, .35, 4 - i);
  }
  // Tall botanical flag, with a fine metal bracket and two hangers.
  function hangingArt(x, y, z, turn, width, height, index) {
    const fixture = new THREE.Group(); fixture.position.set(x, y, z); fixture.rotation.y = turn; group.add(fixture);
    cylinder(.075, .075, .035, materials.metal, .23, .12, -.22, fixture).rotation.x = Math.PI / 2;
    const bracket = box(.46, .026, .026, .015, .15, -.17, materials.metal, false, fixture);
    bracket.rotation.z = -.045;
    box(.025, .025, .30, .23, .13, -.09, materials.metal, false, fixture);
    for (const dx of [-width * .3, width * .3]) box(.012, .11, .012, dx, .05, 0, materials.metal, false, fixture);
    const pivot = new THREE.Group(); pivot.position.set(0, 0, 0); fixture.add(pivot);
    const panel = new THREE.Group(); panel.position.y = -height / 2; pivot.add(panel); framedArt(panel, width, height, index);
    animatedSigns.push({ pivot, phase: animatedSigns.length * 1.7 });
  }
  hangingArt(-2.70, 5.22, 2.56, 0, .38, .99, 0);
  hangingArt(2.75, 4.95, 1.94, Math.PI / 2, .37, .41, 2);
  hangingArt(2.75, 4.42, 1.94, Math.PI / 2, .31, .38, 4);

  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xffe8ac, emissive: 0xffcd70, emissiveIntensity: 0, roughness: .4 });
  const lanternGlass = new THREE.MeshStandardMaterial({ color: 0xffe6b2, transparent: true, opacity: .25, roughness: .26, depthWrite: false });
  function lantern(x, y, z, turn) {
    const g = new THREE.Group(); g.position.set(x, y, z); g.rotation.y = turn; group.add(g);
    cylinder(.065, .065, .045, materials.metal, 0, .06, .005, g).rotation.x = Math.PI / 2;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, .07, .025), new THREE.Vector3(0, .10, .23),
      new THREE.Vector3(0, .10, .48), new THREE.Vector3(0, -.04, .49),
    ]);
    const arm = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, .016, 6, false), materials.metal); arm.castShadow = true; g.add(arm);
    cylinder(.045, .17, .11, materials.metal, 0, -.105, .49, g);
    cylinder(.175, .175, .018, materials.metal, 0, -.167, .49, g);
    const enclosure = cylinder(.123, .123, .205, lanternGlass, 0, -.275, .49, g); enclosure.castShadow = false;
    cylinder(.128, .128, .025, materials.metal, 0, -.385, .49, g);
    for (const angle of [Math.PI / 4, Math.PI * 3 / 4, Math.PI * 5 / 4, Math.PI * 7 / 4]) {
      cylinder(.008, .008, .215, materials.metal, Math.cos(angle) * .123, -.276, .49 + Math.sin(angle) * .123, g, 6);
    }
    const bulb = sphere(.053, bulbMat, 0, -.27, .49, g); bulbs.push(bulb);
    const light = new THREE.PointLight(0xffcd88, 0, 2.5, 1.7); light.position.set(0, -.28, .55); g.add(light); lampLights.push(light);
    stats.lanterns++;
  }
  lantern(-2.37, 2.50, 2.39, 0); lantern(2.37, 2.50, 2.39, 0);
  lantern(2.62, 2.50, 2.12, Math.PI / 2); lantern(2.62, 2.50, -2.12, Math.PI / 2);
  const interiorLights = [];
  for (const y of [2.45, 5.65]) {
    const light = new THREE.PointLight(0xffd6a1, 0, 6.5, 1.5); light.position.set(.15, y, .4); group.add(light); interiorLights.push(light);
    cylinder(.14, .24, .10, materials.paper, .15, y + .08, .4);
    cylinder(.11, .11, .035, bulbMat, .15, y + .016, .4);
  }

  // The little folding sign is a physical A-board with independent front and rear legs.
  const board = new THREE.Group(); board.position.set(1.46, .13, 2.92); board.rotation.y = -.11; group.add(board);
  for (const side of [-1, 1]) {
    const panel = new THREE.Group(); panel.position.set(0, .49, side * .11); panel.rotation.x = -side * .23;
    panel.rotation.y = side < 0 ? Math.PI : 0; board.add(panel);
    framedArt(panel, .56, .75, 0);
    for (const x of [-.264, .264]) box(.045, .94, .06, x, -.02, 0, materials.wood, false, panel);
  }
  const boardHinge = cylinder(.025, .025, .59, materials.metal, 0, .93, 0, board); boardHinge.rotation.z = Math.PI / 2;
  for (const x of [-.24, .24]) box(.02, .02, .40, x, .34, 0, materials.metal, false, board);

  // Hundreds of distinct solid books are submitted in just three instanced draw calls.
  for (const [kind, items] of Object.entries(bookInstances)) {
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .90 });
    const mesh = new THREE.InstancedMesh(cube, material, items.length);
    mesh.name = `Real 3D book ${kind}`;
    items.forEach((item, index) => { mesh.setMatrixAt(index, item.matrix); mesh.setColorAt(index, new THREE.Color(item.color)); });
    mesh.castShadow = kind === 'covers'; mesh.receiveShadow = true; mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); group.add(mesh);
  }
  const edgeGeometry = new THREE.BufferGeometry();
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgeVertices, 3));
  const fineEdges = new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: C.outline, transparent: true, opacity: .36 }));
  fineEdges.name = 'Fine architectural outlines'; group.add(fineEdges);

  return {
    group,
    roof: { height: 6.27, width: 5.2, depth: 4.7 },
    stats,
    setNight(amount) {
      const night = THREE.MathUtils.clamp(amount, 0, 1);
      bulbMat.emissiveIntensity = night * 3.0;
      glassMat.emissiveIntensity = night * .20;
      frontUpperGlass.emissiveIntensity = night * .24;
      for (const light of lampLights) light.intensity = night * 1.65;
      for (const light of interiorLights) light.intensity = night * 2.8;
    },
    setDoor(amount) {
      const opening = THREE.MathUtils.clamp(amount, 0, 1);
      for (const pivot of doorPivots) pivot.rotation.y = pivot.userData.side * opening * 1.05;
    },
    step(t) {
      for (const sign of animatedSigns) sign.pivot.rotation.x = Math.sin(t * .85 + sign.phase) * .025;
    },
  };
}
