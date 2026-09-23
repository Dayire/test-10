import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUV, shadeByHeight, setColor, setSway, extrude, lathe, mat4, boxMM, box, catenary, tube, rng } from './geom.js';

function latheUV(g, r, swap = false) {
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const u = (a / (Math.PI * 2) + 0.5) * Math.PI * 2 * r, v = pos.getY(i);
    if (swap) uv.setXY(i, v, u); else uv.setXY(i, u, v);
  }
  return g;
}

function prep(g) { if (!g.attributes.color) setColor(g, 0xffffff); return g; }

// ---------------------------------------------------------------- crate
export function crateMesh(mats, size = 1) {
  const s = size, t = 0.085 * s;
  const planks = [], frame = [];
  // side panels (slightly inset)
  const inset = 0.02 * s;
  const faces = [
    [0, s / 2, s / 2 - inset, s - 2 * t, s - 2 * t, 0.03 * s],
    [0, s / 2, -s / 2 + inset, s - 2 * t, s - 2 * t, 0.03 * s],
    [s / 2 - inset, s / 2, 0, 0.03 * s, s - 2 * t, s - 2 * t],
    [-s / 2 + inset, s / 2, 0, 0.03 * s, s - 2 * t, s - 2 * t],
    [0, s - inset, 0, s - 2 * t, 0.03 * s, s - 2 * t],
  ];
  for (const [x, y, z, w, h, d] of faces) { const g = box(w, h, d); g.translate(x, y, z); planks.push(worldUV(g)); }
  // edge beams
  const e = (x0, y0, z0, x1, y1, z1) => frame.push(boxMM(x0, y0, z0, x1, y1, z1, { round: 0.008 * s, seg: 1 }));
  const h = s / 2;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) e(sx * h - (sx > 0 ? t : 0), 0, sz * h - (sz > 0 ? t : 0), sx * h + (sx < 0 ? t : 0), s, sz * h + (sz < 0 ? t : 0));
  for (const y of [0, s - t]) {
    e(-h, y, h - t, h, y + t, h); e(-h, y, -h, h, y + t, -h + t);
    e(-h, y, -h, -h + t, y + t, h); e(h - t, y, -h, h, y + t, h);
  }
  // diagonal brace on the front
  const br = box(s * 1.2, t * 0.8, 0.04 * s); br.rotateZ(Math.PI / 4); br.translate(0, s / 2, h + 0.005 * s); frame.push(worldUV(br));
  const brb = br.clone(); brb.translate(0, 0, -s - 0.01 * s); frame.push(brb);
  const gp = mergeGeometries(planks.map((g) => prep(g.index ? g.toNonIndexed() : g)));
  const gf = mergeGeometries(frame.map((g) => prep(g.index ? g.toNonIndexed() : g)));
  shadeByHeight(gp, { base: 0, grime: 0.3, grimeAmt: 0.25 });
  shadeByHeight(gf, { base: 0, grime: 0.3, grimeAmt: 0.25 });
  const grp = new THREE.Group();
  const m1 = new THREE.Mesh(gp, mats.get('wood')); const m2 = new THREE.Mesh(gf, mats.get('woodDark'));
  for (const m of [m1, m2]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  return grp;
}

// ---------------------------------------------------------------- barrel
export function barrel(K, x, y, z, { r = 0.3, h = 0.86, rot = 0 } = {}) {
  const prof = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; prof.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(t * Math.PI)), t * h)); }
  const g = lathe(prof, 28);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const a = Math.atan2(pos.getZ(i), pos.getX(i));
    const k = 1 - 0.018 * Math.pow(Math.abs(Math.cos(a * 9)), 8);
    pos.setX(i, pos.getX(i) * k); pos.setZ(i, pos.getZ(i) * k);
  }
  g.computeVertexNormals();
  latheUV(g, r, true);
  shadeByHeight(g, { base: 0, grime: 0.25, grimeAmt: 0.3 });
  const m = mat4(x, y, z, 0, rot, 0);
  K.add(g, 'wood', m);
  for (const hy of [0.1, h * 0.35, h * 0.65, h - 0.1]) {
    const rr = r * (0.86 + 0.14 * Math.sin((hy / h) * Math.PI)) + 0.006;
    const tg = new THREE.TorusGeometry(rr, 0.012, 5, 28); tg.rotateX(Math.PI / 2); tg.translate(0, hy, 0);
    K.add(tg, 'iron', m, { cast: false });
  }
  const lid = new THREE.CircleGeometry(r * 0.84, 20); lid.rotateX(-Math.PI / 2); lid.translate(0, h - 0.02, 0);
  K.add(worldUV(lid), 'woodDark', m, { cast: false });
}

// ---------------------------------------------------------------- pots
const POTS = {
  amphora: [[0.001, 0], [0.09, 0], [0.12, 0.05], [0.2, 0.22], [0.24, 0.38], [0.22, 0.52], [0.14, 0.64], [0.085, 0.7], [0.08, 0.78], [0.11, 0.8], [0.1, 0.83], [0.07, 0.82]],
  jar: [[0.001, 0], [0.12, 0], [0.19, 0.08], [0.23, 0.2], [0.22, 0.33], [0.16, 0.42], [0.13, 0.45], [0.15, 0.48], [0.13, 0.5]],
  tall: [[0.001, 0], [0.1, 0], [0.16, 0.1], [0.2, 0.35], [0.19, 0.6], [0.13, 0.8], [0.09, 0.9], [0.1, 0.96], [0.12, 1.0], [0.09, 1.0]],
  planter: [[0.001, 0], [0.16, 0], [0.19, 0.04], [0.24, 0.3], [0.27, 0.34], [0.25, 0.36], [0.001, 0.33]],
  bowl: [[0.001, 0], [0.08, 0], [0.16, 0.06], [0.2, 0.14], [0.19, 0.15], [0.001, 0.08]],
};
export function pot(K, x, y, z, { kind = 'jar', s = 1, rot = 0, mat = 'terracotta', lean = 0 } = {}) {
  const g = lathe(POTS[kind].map(([a, b]) => new THREE.Vector2(a * s, b * s)), 24);
  latheUV(g, 0.2 * s);
  shadeByHeight(g, { base: 0, grime: 0.15 * s, grimeAmt: 0.25 });
  K.add(g, mat, mat4(x, y, z, lean, rot, 0));
}

// ---------------------------------------------------------------- rugs
export function rugRoll(K, x, y, z, { r = 0.16, len = 1.7, upright = true, rot = 0, lean = 0.12, seed = 1 } = {}) {
  const g = new THREE.CylinderGeometry(r, r, len, 20, 1, true);
  const uv = g.attributes.uv;
  const off = rng(seed)();
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.9 + 0.05, (uv.getX(i) * 0.5 + off) % 1);
  g.translate(0, len / 2, 0);
  setColor(g, 0xffffff);
  const cap = new THREE.CircleGeometry(r, 20);
  // spiral end: vertex colour rings
  const cp = cap.attributes.position; const cc = new Float32Array(cp.count * 3);
  for (let i = 0; i < cp.count; i++) { const d = Math.hypot(cp.getX(i), cp.getY(i)) / r; const k = 0.5 + 0.5 * Math.cos(d * 30 + Math.atan2(cp.getY(i), cp.getX(i))); cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = 0.55 + 0.35 * k; }
  cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  cap.rotateX(-Math.PI / 2); cap.translate(0, len, 0);
  const m = upright ? mat4(x, y, z, lean, rot, lean * 0.5) : mat4(x, y + r, z, 0, rot, Math.PI / 2);
  K.add(g, 'rug', m);
  K.add(cap, 'rug', m, { cast: false });
}

export function hangingRug(K, x, y, z, { w = 1.6, h = 2.2, rot = 0 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, 12, 8);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), py = pos.getY(i); pos.setZ(i, Math.sin(px * 4.1) * 0.03 + Math.sin(py * 2.3 + px) * 0.02 * (0.5 - py / h)); }
  g.computeVertexNormals();
  g.translate(0, -h / 2, 0);
  setColor(g, 0xffffff);
  setSway(g, (px, py) => Math.min(1, -py / h) * 0.12);
  const m = mat4(x, y, z, 0, rot, 0);
  K.add(g, 'rug', m);
  const rod = new THREE.CylinderGeometry(0.02, 0.02, w + 0.2, 8); rod.rotateZ(Math.PI / 2); rod.translate(0, 0.02, 0.02);
  K.add(worldUV(rod), 'woodDark', m, { cast: false });
}

export function sack(K, x, y, z, { s = 1, rot = 0, mat = 'fabricTan' } = {}) {
  // burlap sack: slumped body + gathered neck + tie
  const g = new THREE.SphereGeometry(0.25, 18, 14);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    let px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
    const t = (py + 0.25) / 0.5; // 0 bottom .. 1 top
    const bulge = t < 0.35 ? 1.18 : 1.18 - (t - 0.35) * 1.05;
    px *= bulge; pz *= bulge * 0.82;
    py = py < -0.12 ? -0.12 - (py + 0.12) * 0.25 : py * 1.2;
    const wr = Math.sin(Math.atan2(pz, px) * 7 + t * 5) * 0.012 * t;
    px += px * wr * 4; pz += pz * wr * 4;
    pos.setXYZ(i, px, py, pz);
  }
  g.computeVertexNormals(); g.translate(0, 0.14, 0);
  const neck = new THREE.CylinderGeometry(0.035, 0.07, 0.14, 10); neck.translate(0, 0.46, 0);
  const tuft = new THREE.ConeGeometry(0.08, 0.12, 10); tuft.rotateX(Math.PI); tuft.translate(0, 0.58, 0);
  const tie = new THREE.TorusGeometry(0.042, 0.012, 5, 12); tie.rotateX(Math.PI / 2); tie.translate(0, 0.49, 0);
  const m = mat4(x, y, z, 0, rot, 0, s);
  for (const gg of [g, neck, tuft]) { const w = worldUV(gg); shadeByHeight(w, { base: -0.1, grime: 0.25, grimeAmt: 0.3 }); K.add(w, mat, m); }
  K.add(worldUV(tie), 'ropeMat', m, { cast: false });
}

// overhead souk canopy: fabric strips spanning the street between facade and front poles
export function souqCanopy(K, { x0, x1, zBack = -1.6, zFront = 8, y = 6.4, seed = 1, mats = ['fabricTan', 'fabricCream', 'fabricRed', 'fabricTeal', 'fabricTan', 'fabricSaffron'] }) {
  const r = rng(seed);
  let x = x0;
  while (x < x1) {
    const w = r.range(1.3, 2.6);
    if (x + w > x1) break;
    const cx = x + w / 2;
    const yb = y + r.range(-0.3, 0.5), yf = y + r.range(-0.2, 0.6);
    drape(K, new THREE.Vector3(cx + r.range(-0.3, 0.3), yb, zBack + 0.05), new THREE.Vector3(cx + r.range(-0.4, 0.4), yf, zFront), { width: w * 0.94, sag: r.range(0.5, 1.1), mat: r.pick(mats), twist: r.range(-0.12, 0.12) });
    x += w + (r() < 0.45 ? r.range(0.35, 1.3) : 0.05);
  }
  // front rope line and poles
  K.add(worldUV(tube(catenary(new THREE.Vector3(x0, y + 0.4, zFront), new THREE.Vector3(x1, y + 0.4, zFront), 0.3, 30), 0.01, 40, 4)), 'ropeMat', null, { cast: false });
}

export function basket(K, x, y, z, { r = 0.26, h = 0.3, s = 1 } = {}) {
  const g = lathe([[0.001, 0], [r * 0.8, 0], [r, h * 0.5], [r * 1.08, h], [r * 1.02, h * 1.02], [r * 0.94, h * 0.95], [0.001, h * 0.4]].map(([a, b]) => new THREE.Vector2(a, b)), 20);
  latheUV(g, r);
  shadeByHeight(g, { base: 0, grime: 0.1, grimeAmt: 0.2 });
  K.add(g, 'wood', mat4(x, y, z, 0, 0, 0, s));
}

// ---------------------------------------------------------------- cart
export function cart(K, x, y, z, { w = 2.4, rot = 0 } = {}) {
  const m = mat4(x, y, z, 0, rot, 0);
  const bed = boxMM(-w / 2, 0.55, -0.6, w / 2, 0.66, 0.6, { round: 0.01 }); K.add(bed, 'wood', m);
  for (const sz of [-0.6, 0.6]) { const side = boxMM(-w / 2, 0.66, sz - 0.03, w / 2, 1.0, sz + 0.03); K.add(side, 'wood', m); }
  const back = boxMM(-w / 2, 0.66, -0.6, -w / 2 + 0.06, 1.0, 0.6); K.add(back, 'wood', m);
  for (const sz of [-0.72, 0.72]) {
    const wheel = new THREE.TorusGeometry(0.42, 0.045, 6, 20); wheel.translate(0.2, 0.44, sz); K.add(worldUV(wheel), 'woodDark', m);
    for (let i = 0; i < 6; i++) { const sp = box(0.04, 0.8, 0.03); sp.rotateZ(i * Math.PI / 6); sp.translate(0.2, 0.44, sz); K.add(worldUV(sp), 'woodDark', m); }
    const hub = new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10); hub.rotateX(Math.PI / 2); hub.translate(0.2, 0.44, sz); K.add(worldUV(hub), 'iron', m);
  }
  for (const sz of [-0.45, 0.45]) { const sh = box(1.8, 0.06, 0.06); sh.rotateZ(0.18); sh.translate(w / 2 + 0.75, 0.4, sz); K.add(worldUV(sh), 'woodDark', m); }
  // load: sacks and a jar
  sack(K, x - 0.5, y + 0.66, z - 0.2, { s: 1.1 }); sack(K, x + 0.1, y + 0.66, z + 0.15, { s: 1, rot: 1 }); pot(K, x + 0.7, y + 0.66, z - 0.1, { kind: 'jar' });
}

// ---------------------------------------------------------------- awning
// cloth roof sloping from the wall (at z0, height y0) out to (z1, y1), width along x
export function awning(K, { x0, x1, z0, z1, y0, y1, mat = 'fabricTan', sag = 0.12, valance = 0.28, poles = true, poleMat = 'woodDark', scallop = true }) {
  const nx = 16, nz = 8;
  const w = x1 - x0;
  const g = new THREE.PlaneGeometry(1, 1, nx, nz);
  const pos = g.attributes.position; const uv = g.attributes.uv;
  const sway = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i) + 0.5, v = pos.getY(i) + 0.5; // v: 0 wall -> 1 front
    const x = x0 + u * w;
    const z = z0 + (z1 - z0) * v;
    let y = y0 + (y1 - y0) * v - sag * Math.sin(v * Math.PI) * (0.6 + 0.4 * Math.sin(u * Math.PI));
    y -= sag * 0.35 * Math.sin(u * Math.PI * Math.max(1, Math.round(w / 1.6))) * v;
    pos.setXYZ(i, x, y, z);
    uv.setXY(i, u * w, v * Math.abs(z1 - z0));
    sway[i] = v * 0.08;
  }
  g.setAttribute('sway', new THREE.BufferAttribute(sway, 1));
  g.computeVertexNormals();
  setColor(g, 0xffffff);
  K.add(g, mat);
  if (valance > 0) {
    // front valance with scalloped hem
    const s = new THREE.Shape();
    const n = Math.max(2, Math.round(w / 0.32));
    s.moveTo(0, 0); s.lineTo(w, 0);
    for (let i = n; i > 0; i--) {
      const xa = (i / n) * w, xb = ((i - 1) / n) * w;
      if (scallop) s.quadraticCurveTo((xa + xb) / 2, -valance * 1.7, xb, -valance);
      else s.lineTo(xb, -valance);
    }
    s.lineTo(0, 0);
    const vg = new THREE.ShapeGeometry(s, 6);
    const vp = vg.attributes.position; const vu = vg.attributes.uv; const vs = new Float32Array(vp.count);
    for (let i = 0; i < vp.count; i++) { vu.setXY(i, vp.getX(i), vp.getY(i)); vs[i] = Math.min(1, -vp.getY(i) / valance) * 0.12; }
    vg.setAttribute('sway', new THREE.BufferAttribute(vs, 1));
    vg.translate(x0, y1 - sag * 0.2, z1);
    setColor(vg, 0xffffff);
    K.add(vg, mat);
  }
  if (poles) {
    for (const px of [x0 + 0.05, x1 - 0.05]) {
      const pl = new THREE.CylinderGeometry(0.03, 0.035, y1 + 0.05, 8); pl.translate(px, (y1 + 0.05) / 2, z1 - 0.02);
      shadeByHeight(worldUV(pl), { base: 0, grime: 0.4, grimeAmt: 0.3 });
      K.add(pl, poleMat);
    }
  }
}

// a fabric strip hung between two points (drapes, canopies across alleys)
export function drape(K, p0, p1, { width = 1.2, sag = 0.6, mat = 'fabricTeal', twist = 0 } = {}) {
  const n = 24;
  const dir = new THREE.Vector3().subVectors(p1, p0);
  const len = dir.length();
  const side = new THREE.Vector3().crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
  if (side.lengthSq() < 0.5) side.set(0, 0, 1);
  const pos = [], uv = [], sw = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const c = new THREE.Vector3().lerpVectors(p0, p1, t); c.y -= sag * 4 * t * (1 - t);
    for (let j = 0; j <= 4; j++) {
      const s = (j / 4 - 0.5) * width;
      const sag2 = Math.abs(s) * 0.15 * Math.sin(t * Math.PI);
      const p = c.clone().addScaledVector(side, s * Math.cos(twist * Math.sin(t * Math.PI)));
      p.y += sag2 + s * Math.sin(twist * Math.sin(t * Math.PI));
      pos.push(p.x, p.y, p.z); uv.push((j / 4) * width, t * len); sw.push(Math.sin(t * Math.PI) * 0.18);
    }
  }
  for (let i = 0; i < n; i++) for (let j = 0; j < 4; j++) { const a = i * 5 + j, b = a + 5; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('sway', new THREE.Float32BufferAttribute(sw, 1));
  g.setIndex(idx); g.computeVertexNormals();
  setColor(g, 0xffffff);
  K.add(g, mat);
}

// ---------------------------------------------------------------- lantern
export function lanternMesh(mats, { s = 1, lit = true } = {}) {
  const grp = new THREE.Group();
  const brass = mats.get('brass');
  const cage = lathe([[0.001, 0.0], [0.03, 0], [0.05, 0.03], [0.09, 0.06], [0.1, 0.1], [0.08, 0.26], [0.1, 0.28], [0.07, 0.31], [0.04, 0.36], [0.02, 0.42], [0.001, 0.43]].map(([a, b]) => new THREE.Vector2(a * s, b * s)), 8);
  const cm = new THREE.Mesh(cage, brass); cm.castShadow = true; grp.add(cm);
  // glass panes (slightly inset, glowing)
  const glass = new THREE.CylinderGeometry(0.083 * s, 0.083 * s, 0.17 * s, 8, 1, true); glass.translate(0, 0.18 * s, 0);
  const gm = new THREE.Mesh(glass, lit ? mats.get('glassGlow') : mats.get('darkInterior')); grp.add(gm);
  // vertical bars
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
    const bar = new THREE.CylinderGeometry(0.006 * s, 0.006 * s, 0.2 * s, 4); bar.translate(Math.cos(a) * 0.088 * s, 0.18 * s, Math.sin(a) * 0.088 * s);
    const bm = new THREE.Mesh(bar, brass); grp.add(bm);
  }
  const ring = new THREE.TorusGeometry(0.025 * s, 0.006 * s, 6, 12); ring.translate(0, 0.46 * s, 0);
  grp.add(new THREE.Mesh(ring, brass));
  grp.userData.glowY = 0.18 * s;
  return grp;
}

// scrolled iron wall bracket (reference: curly bracket holding the lantern)
export function bracket(K, x, y, z, { len = 0.55, dir = 1 } = {}) {
  const pts = [];
  pts.push(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, len * 0.5), new THREE.Vector3(0, 0.02, len));
  const arm = tube(pts, 0.012, 8, 5);
  // curl: spiral
  const sp = [];
  for (let i = 0; i <= 30; i++) { const t = i / 30; const a = t * Math.PI * 2.4; const r = 0.13 * (1 - t * 0.8); sp.push(new THREE.Vector3(0, -0.02 - r * Math.sin(a) * 0.9 + 0.0, len * 0.35 + r * Math.cos(a) - 0.13 + len * 0.1)); }
  const curl = tube(sp, 0.009, 40, 5);
  const brace = tube([new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(0, -0.15, len * 0.3), new THREE.Vector3(0, -0.01, len * 0.62)], 0.01, 10, 5);
  const plate = boxMM(-0.05, -0.34, -0.02, 0.05, 0.05, 0.01);
  const m = mat4(x, y, z, 0, dir < 0 ? Math.PI : 0, 0);
  for (const g of [arm, curl, brace, plate]) K.add(worldUV(g), 'iron', m, { cast: true });
  return new THREE.Vector3(x, y - 0.02, z + len * dir);
}

// ---------------------------------------------------------------- laundry & wires
export function laundry(K, p0, p1, { sag = 0.35, seed = 3, cloths = 5 } = {}) {
  const pts = catenary(p0, p1, sag, 20);
  K.add(worldUV(tube(pts, 0.006, 24, 4)), 'ropeMat', null, { cast: false });
  const r = rng(seed);
  const mats = ['fabricCream', 'fabricIndigo', 'fabricSaffron', 'fabricPink', 'fabricRed', 'fabricTeal'];
  for (let i = 0; i < cloths; i++) {
    const t = (i + 0.5 + r.range(-0.2, 0.2)) / cloths;
    const p = new THREE.Vector3().lerpVectors(p0, p1, t); p.y -= sag * 4 * t * (1 - t);
    const w = r.range(0.35, 0.8), h = r.range(0.4, 0.9);
    const g = new THREE.PlaneGeometry(w, h, 4, 4);
    const pos = g.attributes.position;
    for (let k = 0; k < pos.count; k++) pos.setZ(k, Math.sin(pos.getX(k) * 7 + i) * 0.02);
    g.computeVertexNormals();
    g.translate(0, -h / 2, 0);
    setSway(g, (px, py) => Math.min(1, -py / h) * 0.25);
    setColor(g, 0xffffff);
    const dir = new THREE.Vector3().subVectors(p1, p0);
    K.add(g, r.pick(mats), mat4(p.x, p.y, p.z, 0, Math.atan2(-dir.z, dir.x), 0));
  }
}

export function wire(K, p0, p1, { sag = 0.4, r = 0.008 } = {}) {
  K.add(worldUV(tube(catenary(p0, p1, sag, 24), r, 32, 4)), 'iron', null, { cast: false });
}

// ---------------------------------------------------------------- eave
// scalloped wooden fascia with terracotta tiles (left side of the reference)
export function eave(K, { x0, x1, y, z, depth = 1.1, drop = 0.35 }) {
  const w = x1 - x0;
  const s = new THREE.Shape();
  const n = Math.max(2, Math.round(w / 0.45));
  s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, -drop * 0.5);
  for (let i = n; i > 0; i--) { const xa = (i / n) * w, xb = ((i - 1) / n) * w; s.quadraticCurveTo((xa + xb) / 2, -drop * 1.6, xb, -drop * 0.5); }
  s.lineTo(0, 0);
  const g = extrude(s, 0.06, { curveSeg: 6 });
  g.translate(x0, y, z + depth);
  const gu = worldUV(g); const uv = gu.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i), uv.getY(i));
  K.add(gu, 'woodDark');
  // rafters
  for (let i = 0; i <= n; i++) { const rx = x0 + (i / n) * w; const rg = boxMM(rx - 0.04, y - 0.12, z, rx + 0.04, y, z + depth + 0.08); K.add(rg, 'woodDark'); }
  // tiled roof slope
  const roof = new THREE.PlaneGeometry(w, depth + 0.3, 1, 1);
  roof.rotateX(-Math.PI / 2 + 0.38); roof.translate(x0 + w / 2, y + 0.18, z + (depth + 0.1) / 2);
  const ru = worldUV(roof); const ruv = ru.attributes.uv;
  for (let i = 0; i < ruv.count; i++) ruv.setXY(i, ruv.getX(i), ruv.getY(i));
  setColor(ru, 0xffffff);
  K.add(ru, 'roofTiles');
  const cap = new THREE.CylinderGeometry(0.07, 0.07, w, 8, 1, false, 0, Math.PI); cap.rotateZ(Math.PI / 2); cap.translate(x0 + w / 2, y + 0.02, z + depth + 0.06);
  K.add(worldUV(cap), 'terracotta');
}

// ---------------------------------------------------------------- stairs
export function stairs(K, { x0, x1, y0, y1, z0, z1, steps, mat = 'limestone', rail = true, railSide = 'front' }) {
  const n = steps || Math.max(2, Math.round((y1 - y0) / 0.18));
  const dx = (x1 - x0) / n, dy = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    const g = boxMM(x0 + i * dx, y0, z0, x0 + (i + 1) * dx + (dx > 0 ? 0.01 : -0.01), y0 + (i + 1) * dy, z1, { round: 0.015, seg: 1 });
    shadeByHeight(g, { base: y0, grime: 0.3, grimeAmt: 0.2 });
    K.add(g, mat);
  }
  if (rail) {
    const rz = railSide === 'front' ? z1 - 0.05 : z0 + 0.05;
    const a = new THREE.Vector3(x0, y0 + 0.9 + dy, rz), b = new THREE.Vector3(x1, y1 + 0.9, rz);
    K.add(worldUV(tube([a, b], 0.022, 4, 8)), 'brass', null, { cast: true });
    for (let i = 0; i <= n; i += 2) {
      const px = x0 + (i + 0.5) * dx, py = y0 + (i + 1) * dy;
      const bl = new THREE.CylinderGeometry(0.011, 0.011, 0.9, 6); bl.translate(px, py + 0.45, rz);
      K.add(worldUV(bl), 'brass', null, { cast: true });
    }
  }
}

// ---------------------------------------------------------------- misc
export function stool(K, x, y, z) {
  const top = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14); top.translate(0, 0.45, 0); K.add(worldUV(top), 'wood', mat4(x, y, z));
  for (let i = 0; i < 3; i++) { const a = i * 2.09; const l = new THREE.CylinderGeometry(0.02, 0.025, 0.46, 6); l.rotateZ(0.12); l.rotateY(a); l.translate(Math.cos(a) * 0.14, 0.22, Math.sin(a) * 0.14); K.add(worldUV(l), 'woodDark', mat4(x, y, z)); }
}

export function pole(K, x, y0, y1, z, r = 0.04, mat = 'woodDark') {
  const g = new THREE.CylinderGeometry(r, r * 1.15, y1 - y0, 8); g.translate(x, (y0 + y1) / 2, z);
  K.add(worldUV(g), mat);
}
