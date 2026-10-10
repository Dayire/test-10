import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUV, setColor, lathe, smoothProfile, boxMM, tube, extrude, shadeByHeight } from './geom.js';
import { patchMaterial } from '../render/atmosphere.js';

// Sunwork props: the polished brass tray (the game's bookend object), mirror stands, crank brackets and
// handles, the 12-petal rosette lock, the iron sun-bolt, tripwire lamps and sensor turrets, the hemp rope,
// the brass star inlay at a kerb stop, and the sprite textures of glints and sunspots. Builders return groups
// (entities move them); everything is procedural.

// mirror and lock materials (registered once on the session's material library)
export const LIGHT_MATERIALS = {
  mirrorBrass: { surf: 'brass', tile: 0.35, metal: 1, rough: 0.22, color: 0xfff1cf, envInt: 2.6 },
  brassAged: { surf: 'brass', tile: 0.45, metal: 1, rough: 1, color: 0xc29a62, envInt: 1.1 },
  silverPlate: { surf: null, color: 0xdde3ec, metal: 1, rough: 0.3, envInt: 2.2 },
  ironDark: { surf: 'iron', tile: 0.5, metal: 1, rough: 1, color: 0x8a8580 },
  hemp: { surf: 'burlap', tile: 0.25, color: 0xc9b083, translucency: 0.15 },
};
export function lightMaterials(mats) { mats.register(LIGHT_MATERIALS); return mats; }

const prep = (g) => {
  let n = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) n.deleteAttribute(k);
  if (!n.attributes.normal) n.computeVertexNormals();
  if (!n.attributes.uv) worldUV(n);
  if (!n.attributes.color) setColor(n, 0xffffff);
  return n;
};
const merged = (list) => mergeGeometries(list.map(prep));
const mesh = (geos, mat, { cast = true, receive = true } = {}) => {
  const m = new THREE.Mesh(Array.isArray(geos) ? merged(geos) : prep(geos), mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
};
const V2 = (a, b) => new THREE.Vector2(a, b);

// ---------------------------------------------------------------- the tray
// A hammered brass tray: a shallow dish with a raised boss, a rolled rim and two engraved rings, face up
// (+y), centred at the origin. r is the radius. Used on every mirror and as the boy's tray.
export function trayMesh(mats, { r = 0.4 } = {}) {
  lightMaterials(mats);
  const grp = new THREE.Group();
  const prof = smoothProfile([[0.001, 0.016], [0.07, 0.015], [0.11, 0.008], [0.16, 0.002], [0.78, 0.0], [0.86, 0.006], [0.93, 0.03], [0.985, 0.05], [1.0, 0.04], [0.99, 0.02], [0.94, 0.004], [0.86, -0.012], [0.4, -0.022], [0.001, -0.024]], 3)
    .map((p) => V2(p.x * r, p.y * r * 1.4));
  const dish = lathe(prof, 48);
  // hammered: tiny facets on the face catch the light in sparkles
  const pos = dish.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), rr = Math.hypot(x, z);
    if (y > -0.002 * r && rr < 0.84 * r) pos.setY(i, y + 0.0035 * r * Math.sin(x * 61 / r) * Math.sin(z * 57 / r));
  }
  dish.computeVertexNormals();
  grp.add(mesh(dish, mats.get('mirrorBrass')));
  // engraved rings and an eight-point star around the boss (aged brass, barely raised)
  const deco = [];
  for (const k of [0.36, 0.64]) { const t = new THREE.TorusGeometry(k * r, 0.006 * r, 4, 48); t.rotateX(Math.PI / 2); t.translate(0, 0.004 * r, 0); deco.push(t); }
  const star = new THREE.Shape();
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2, rr = (i % 2 ? 0.13 : 0.26) * r; i ? star.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : star.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const hole = new THREE.Path(); hole.absarc(0, 0, 0.09 * r, 0, Math.PI * 2, true); star.holes.push(hole);
  const sg = extrude(star, 0.004 * r, { curveSeg: 12 }); sg.rotateX(-Math.PI / 2); sg.translate(0, 0.008 * r, 0); deco.push(sg);
  grp.add(mesh(deco, mats.get('brassAged'), { cast: false }));
  grp.userData.r = r;
  return grp;
}

// ---------------------------------------------------------------- mirror stands
// The 0.7 × 0.8 stand of a wheeled mirror (a wooden cart with iron-tyred wheels and brass corner plates) or of
// an anchored one (a moulded stone plinth), with the brass yoke that holds the tray's axle at pivotH.
export function mirrorStand(mats, { kind = 'wheeled', pivotH = 1.2, r = 0.4 } = {}) {
  lightMaterials(mats);
  const grp = new THREE.Group();
  const wood = [], brass = [], iron = [], stone = [];
  if (kind === 'wheeled') {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(0.13, 0.13, 0.06, 14); w.rotateX(Math.PI / 2); w.translate(sx * 0.22, 0.13, sz * 0.31); wood.push(w);
      const t = new THREE.TorusGeometry(0.13, 0.014, 5, 18); t.translate(sx * 0.22, 0.13, sz * 0.31 + sz * 0.012); iron.push(t);
      const hub = new THREE.CylinderGeometry(0.035, 0.035, 0.09, 8); hub.rotateX(Math.PI / 2); hub.translate(sx * 0.22, 0.13, sz * 0.31); iron.push(hub);
    }
    for (const sx of [-1, 1]) { const ax = new THREE.CylinderGeometry(0.022, 0.022, 0.62, 6); ax.rotateX(Math.PI / 2); ax.translate(sx * 0.22, 0.13, 0); iron.push(ax); }
    wood.push(shadeByHeight(boxMM(-0.35, 0.2, -0.27, 0.35, 0.27, 0.27, { round: 0.01 }), { base: 0.2, grime: 0.2, grimeAmt: 0.2 }));
    wood.push(shadeByHeight(boxMM(-0.3, 0.27, -0.24, 0.3, 0.74, 0.24, { round: 0.012 }), { base: 0.27, grime: 0.4, grimeAmt: 0.25 }));
    wood.push(boxMM(-0.34, 0.74, -0.27, 0.34, 0.8, 0.27, { round: 0.01 }));
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) brass.push(boxMM(sx * 0.3 - 0.03, 0.27, sz * 0.24 - 0.03, sx * 0.3 + 0.03, 0.74, sz * 0.24 + 0.03));
    // a push bar on each side so the grip reads
    for (const sx of [-1, 1]) brass.push(tube([new THREE.Vector3(sx * 0.35, 0.55, -0.18), new THREE.Vector3(sx * 0.4, 0.58, -0.1), new THREE.Vector3(sx * 0.4, 0.58, 0.1), new THREE.Vector3(sx * 0.35, 0.55, 0.18)], 0.016, 12, 6));
  } else {
    stone.push(shadeByHeight(boxMM(-0.35, 0, -0.32, 0.35, 0.12, 0.32, { round: 0.015 }), { base: 0, grime: 0.3, grimeAmt: 0.3 }));
    stone.push(shadeByHeight(lathe(smoothProfile([[0.001, 0.12], [0.27, 0.12], [0.24, 0.2], [0.21, 0.5], [0.24, 0.66], [0.3, 0.72], [0.31, 0.8], [0.001, 0.8]], 3), 8, Math.PI / 8), { base: 0, grime: 0.6, grimeAmt: 0.3 }));
    const ring = new THREE.TorusGeometry(0.25, 0.018, 6, 24); ring.rotateX(Math.PI / 2); ring.translate(0, 0.14, 0); iron.push(ring);
  }
  // the yoke: a base plate and two uprights carrying the axle (z) at pivotH
  const zy = r + 0.07;
  brass.push(boxMM(-0.1, 0.8, -zy - 0.03, 0.1, 0.83, zy + 0.03));
  for (const sz of [-1, 1]) {
    brass.push(tube([new THREE.Vector3(0, 0.82, sz * (zy - 0.06)), new THREE.Vector3(0, 0.98, sz * zy), new THREE.Vector3(0, pivotH - 0.02, sz * zy)], 0.022, 10, 6));
    const cap = new THREE.SphereGeometry(0.038, 10, 8); cap.translate(0, pivotH, sz * zy); brass.push(cap);
  }
  if (wood.length) grp.add(mesh(wood, mats.get('wood')));
  if (stone.length) grp.add(mesh(stone, mats.get('limestone')));
  grp.add(mesh(brass, mats.get('brassAged')));
  if (iron.length) grp.add(mesh(iron, mats.get('iron')));
  return grp;
}

// the axle across the yoke (turns with the tray)
export function axleMesh(mats, { r = 0.4 } = {}) {
  lightMaterials(mats);
  const g = new THREE.CylinderGeometry(0.018, 0.018, 2 * (r + 0.07), 8); g.rotateX(Math.PI / 2);
  return mesh(g, mats.get('brassAged'), { cast: false });
}

// ---------------------------------------------------------------- crank mirrors
// A forged arm from the wall (at z = -len) to the pivot, ending in a fork behind the tray with a grooved pulley
// the crank rope turns. The tray hangs on the pulley's axle.
export function crankBracket(mats, { len = 1.6, r = 0.4 } = {}) {
  lightMaterials(mats);
  const iron = [], brass = [];
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  const zb = -(r + 0.09);
  const plate = boxMM(-0.09, -0.16, -len, 0.09, 0.16, -len + 0.03, { round: 0.01 }); iron.push(plate);
  iron.push(tube([V(0, 0, -len + 0.02), V(0, -0.02, (zb - len) / 2), V(0, 0, zb - 0.05)], 0.028, 16, 6));
  iron.push(tube([V(0, -0.14, -len + 0.03), V(0, -0.12, -len * 0.6), V(0, -0.05, zb - 0.2)], 0.016, 14, 5));
  const pul = new THREE.CylinderGeometry(0.075, 0.075, 0.05, 18); pul.rotateX(Math.PI / 2); pul.translate(0, 0, zb); brass.push(pul);
  const groove = new THREE.TorusGeometry(0.075, 0.012, 5, 18); groove.translate(0, 0, zb); iron.push(groove);
  const ax = new THREE.CylinderGeometry(0.02, 0.02, r + 0.12, 8); ax.rotateX(Math.PI / 2); ax.translate(0, 0, zb / 2); brass.push(ax);
  const grp = new THREE.Group();
  grp.add(mesh(iron, mats.get('iron')), mesh(brass, mats.get('brassAged')));
  return grp;
}

// the crank handle on its post: a spoked brass wheel facing the camera (`wheel` turns)
export function crankHandle(mats, { h = 0.92, wr = 0.24 } = {}) {
  lightMaterials(mats);
  const grp = new THREE.Group();
  const iron = [];
  iron.push(lathe(smoothProfile([[0.001, 0], [0.11, 0], [0.11, 0.05], [0.06, 0.08], [0.045, 0.2], [0.04, h - 0.1], [0.06, h - 0.04], [0.001, h - 0.02]], 2), 10));
  const hub = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 10); hub.rotateX(Math.PI / 2); hub.translate(0, h, 0.05); iron.push(hub);
  grp.add(mesh(iron, mats.get('iron')));
  const wheel = new THREE.Group(); wheel.position.set(0, h, 0.11);
  const wb = [];
  const rim = new THREE.TorusGeometry(wr, 0.018, 6, 28); wb.push(rim);
  for (let i = 0; i < 6; i++) { const s = new THREE.CylinderGeometry(0.011, 0.011, wr, 5); s.translate(0, wr / 2, 0); s.rotateZ((i / 6) * Math.PI * 2); wb.push(s); }
  const knob = new THREE.CylinderGeometry(0.022, 0.026, 0.12, 8); knob.rotateX(Math.PI / 2); knob.translate(0, wr, 0.06); wb.push(knob);
  wheel.add(mesh(wb, mats.get('brassAged')));
  grp.add(wheel);
  grp.userData.wheel = wheel;
  return grp;
}

// ---------------------------------------------------------------- the rosette lock
// Twelve brass petals hinged at the rim close over a glass lens; light opens them (level 0..1). Gold locks
// glow amber, silver moon-locks pale blue, the iron sun-bolt red-orange and its petals close while lit.
const PETAL = (() => {
  const s = new THREE.Shape();
  s.moveTo(0, 0); s.quadraticCurveTo(0.2, 0.32, 0, 1); s.quadraticCurveTo(-0.2, 0.32, 0, 0);
  return s;
})();
export const LOCK_TONES = {
  gold: { plate: 'brassAged', petal: 'mirrorBrass', glass: 0xffd9a0, glow: 0xffa040 },
  silver: { plate: 'silverPlate', petal: 'silverPlate', glass: 0xe6eeff, glow: 0x9cc2ff },
  iron: { plate: 'ironDark', petal: 'ironDark', glass: 0xffb48a, glow: 0xff5a1e },
};
export function rosetteLock(mats, { r = 0.35, metal = 'gold', mount = 1.6 } = {}) {
  lightMaterials(mats);
  const T = LOCK_TONES[metal] || LOCK_TONES.gold;
  const grp = new THREE.Group();
  const plate = [];
  const back = lathe(smoothProfile([[0.001, -0.05], [1.0, -0.05], [1.12, -0.03], [1.16, 0.0], [1.1, 0.02], [0.98, 0.0], [0.001, 0.0]], 2).map((p) => V2(p.x * r, p.y * r)), 36);
  back.rotateX(Math.PI / 2); plate.push(back);
  for (let i = 0; i < 12; i++) { const k = new THREE.SphereGeometry(0.03 * r, 6, 4); const a = (i / 12) * Math.PI * 2 + Math.PI / 12; k.translate(Math.cos(a) * 1.06 * r, Math.sin(a) * 1.06 * r, 0.02 * r); plate.push(k); }
  if (mount > 0.05) { const st = new THREE.CylinderGeometry(0.06, 0.08, mount, 8); st.rotateX(Math.PI / 2); st.translate(0, 0, -mount / 2 - 0.04 * r); plate.push(st); const fl = new THREE.CylinderGeometry(0.16, 0.16, 0.03, 12); fl.rotateX(Math.PI / 2); fl.translate(0, 0, -mount); plate.push(fl); }
  grp.add(mesh(plate, mats.get(T.plate)));
  // petals: one instanced draw, hinged on the rim, pointing at the centre
  const pg = extrude(PETAL, 0.05, { curveSeg: 8 });
  pg.translate(0, 0, -0.025); pg.scale(0.62 * r, 0.9 * r, 0.24 * r);
  const petals = new THREE.InstancedMesh(prep(pg), mats.get(T.petal), 12);
  petals.castShadow = true; petals.receiveShadow = true;
  grp.add(petals);
  // the lens: its own material so its glow follows the level
  const lensMat = patchMaterial(new THREE.MeshStandardMaterial({ color: T.glass, emissive: T.glow, emissiveIntensity: 0.05, roughness: 0.15, metalness: 0, envMap: mats.envMap, envMapIntensity: 1.4 }));
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.34 * r, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), lensMat);
  lens.rotation.x = Math.PI / 2; lens.position.z = -0.01 * r;
  grp.add(lens);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s1 = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  // open 0..1: petals fold back from the centre about their rim hinge
  const setOpen = (open) => {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const hinge = 1.0 * r;
      p.set(Math.cos(a) * hinge, Math.sin(a) * hinge, 0.012 * r);
      // the petal points inward (local +y toward the centre), then tips back by `open`
      e.set(-open * 1.25, 0, a + Math.PI / 2, 'ZXY');
      q.setFromEuler(e);
      m4.compose(p, q, s1);
      petals.setMatrixAt(i, m4);
    }
    petals.instanceMatrix.needsUpdate = true;
  };
  setOpen(0);
  grp.userData = { petals, lens, lensMat, setOpen, tone: T, r };
  return grp;
}

// ---------------------------------------------------------------- tripwires
// the beam lamp a tripwire starts from: a small brass box lantern with a lens (faces +x; rotate to aim)
export function beamLampMesh(mats) {
  lightMaterials(mats);
  const grp = new THREE.Group();
  const b = [];
  b.push(boxMM(-0.11, -0.07, -0.07, 0.05, 0.07, 0.07, { round: 0.015 }));
  const hood = new THREE.CylinderGeometry(0.055, 0.07, 0.07, 12); hood.rotateZ(-Math.PI / 2); hood.translate(0.08, 0, 0); b.push(hood);
  const stem = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 6); stem.translate(-0.03, -0.17, 0); b.push(stem);
  grp.add(mesh(b, mats.get('brassAged')));
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.05, 14), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2.6, 1.1) }));
  lens.rotation.y = Math.PI / 2; lens.position.x = 0.116;
  grp.add(lens);
  grp.userData.lens = lens;
  return grp;
}
// the sensor at the end of a tripwire with its dart turret (a brass eye that turns to the occluder: `eye`)
export function sensorMesh(mats) {
  lightMaterials(mats);
  const grp = new THREE.Group();
  const b = [];
  b.push(lathe(smoothProfile([[0.001, -0.09], [0.07, -0.09], [0.09, -0.05], [0.09, 0.05], [0.07, 0.08], [0.001, 0.08]], 2), 14));
  const stem = new THREE.CylinderGeometry(0.016, 0.016, 0.22, 6); stem.translate(0, -0.2, 0); b.push(stem);
  grp.add(mesh(b, mats.get('brassAged')));
  const cellMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.5, 0.2) });
  const cell = new THREE.Mesh(new THREE.CircleGeometry(0.045, 14), cellMat);
  cell.position.z = 0.092; grp.add(cell);
  const eye = new THREE.Group(); eye.position.set(0, 0.13, 0);
  const ball = [];
  ball.push(new THREE.SphereGeometry(0.055, 14, 10));
  const brow = new THREE.TorusGeometry(0.058, 0.009, 5, 16, Math.PI); brow.rotateY(Math.PI / 2); ball.push(brow);
  eye.add(mesh(ball, mats.get('mirrorBrass')));
  const irisMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.03, 0.02) });
  const iris = new THREE.Mesh(new THREE.CircleGeometry(0.026, 12), irisMat);
  iris.position.x = 0.056; iris.rotation.y = Math.PI / 2; eye.add(iris);
  grp.add(eye);
  grp.userData = { eye, iris, irisMat, cell, cellMat };
  return grp;
}

// ---------------------------------------------------------------- the rope
// a twisted hemp rope hanging from (0, 0) down `len` metres, with an iron hook at the top
export function ropeMesh(mats, { len = 1.2, r = 0.035 } = {}) {
  lightMaterials(mats);
  const grp = new THREE.Group();
  const strands = [];
  for (let k = 0; k < 3; k++) {
    const pts = [];
    for (let i = 0; i <= 24; i++) { const t = i / 24, a = t * len * 18 + (k / 3) * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r * 0.45, -t * len, Math.sin(a) * r * 0.45)); }
    strands.push(tube(pts, r * 0.55, 48, 5));
  }
  grp.add(mesh(strands, mats.get('hemp')));
  const hook = new THREE.TorusGeometry(0.05, 0.012, 6, 14, Math.PI * 1.4); hook.rotateZ(-Math.PI * 0.2); hook.translate(0, 0.04, 0);
  grp.add(mesh([hook], mats.get('iron')));
  return grp;
}

// ---------------------------------------------------------------- the brass star inlay (a kerb's stop mark)
export function starInlay(mats, { r = 0.32 } = {}) {
  lightMaterials(mats);
  const s = new THREE.Shape();
  for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2 + Math.PI / 16, rr = i % 2 ? r * 0.48 : r; i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
  const g = extrude(s, 0.012, { curveSeg: 4 }); g.rotateX(-Math.PI / 2);
  return mesh(g, mats.get('mirrorBrass'), { cast: false });
}

// ---------------------------------------------------------------- sprite textures (session-wide, never disposed)
let _tex = null;
export function lightTextures() {
  if (_tex) return _tex;
  const mk = (draw, n = 128) => { const c = document.createElement('canvas'); c.width = c.height = n; draw(c.getContext('2d'), n); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.userData.shared = true; return t; };
  const glint = mk((x, n) => {
    const h = n / 2;
    const g = x.createRadialGradient(h, h, 0, h, h, h);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.08, 'rgba(255,245,220,.9)'); g.addColorStop(0.3, 'rgba(255,210,150,.18)'); g.addColorStop(1, 'rgba(255,200,140,0)');
    x.fillStyle = g; x.fillRect(0, 0, n, n);
    x.globalCompositeOperation = 'lighter';
    for (const [a, w, l] of [[0, 2.2, 1], [Math.PI / 2, 2.2, 1], [Math.PI / 4, 1.2, 0.55], [-Math.PI / 4, 1.2, 0.55]]) {
      x.save(); x.translate(h, h); x.rotate(a);
      const lg = x.createLinearGradient(-h * l, 0, h * l, 0);
      lg.addColorStop(0, 'rgba(255,230,190,0)'); lg.addColorStop(0.5, 'rgba(255,250,235,.95)'); lg.addColorStop(1, 'rgba(255,230,190,0)');
      x.fillStyle = lg; x.fillRect(-h * l, -w, 2 * h * l, 2 * w);
      x.restore();
    }
  });
  _tex = { glint };
  return _tex;
}
