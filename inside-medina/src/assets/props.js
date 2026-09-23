import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { worldUV, shadeByHeight, setColor, setSway, extrude, lathe, mat4, boxMM, box, catenary, tube, rng, gridGeom, smoothProfile, pointedArchPoints } from './geom.js';
import { Overrides } from './library.js';

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
// Framed crate: corner posts and rails, gapped boards, a diagonal brace on the
// two faces the camera sees, iron corner plates and nail heads.
export function crateMesh(mats, size = 1) {
  if (Overrides.has('crate')) { const o = Overrides.instance('crate'); o.scale.multiplyScalar(size); return o; }
  const s = size, h = s / 2;
  const post = 0.075 * s, rail = 0.075 * s, pt = 0.024 * s, gap = 0.009 * s, proud = pt * 1.7;
  const rnd = rng(Math.round(s * 977) + 3);
  const wood = [], metal = [];
  const tone = (g, k) => {
    shadeByHeight(g, { base: 0, grime: 0.3 * s, grimeAmt: 0.25 });
    const c = g.attributes.color;
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * k, c.getY(i) * k * 0.97, c.getZ(i) * k * 0.93);
    return g;
  };
  const board = (x0, y0, z0, x1, y1, z1, k) => wood.push(tone(boxMM(x0, y0, z0, x1, y1, z1, { round: 0.004 * s, seg: 1, offset: rnd() * 5 }), k));
  const frameK = () => 0.78 + rnd() * 0.12, boardK = () => 1.05 + rnd() * 0.28;
  // corner posts
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x0 = sx < 0 ? -h : h - post, z0 = sz < 0 ? -h : h - post;
    board(x0, 0, z0, x0 + post, s, z0 + post, frameK());
  }
  // top and bottom rails, proud of the boards
  for (const y0 of [0, s - rail]) {
    for (const z0 of [-h, h - proud]) board(-h + post, y0, z0, h - post, y0 + rail, z0 + proud, frameK());
    for (const x0 of [-h, h - proud]) board(x0, y0, -h + post, x0 + proud, y0 + rail, h - post, frameK());
  }
  // side boards (three per face, with gaps) and the lid
  const nb = 3, span = s - 2 * rail, bh = (span - gap * (nb - 1)) / nb;
  for (let i = 0; i < nb; i++) {
    const y0 = rail + i * (bh + gap), y1 = y0 + bh;
    for (const z0 of [-h + 0.006 * s, h - 0.006 * s - pt]) board(-h + post, y0, z0, h - post, y1, z0 + pt, boardK());
    for (const x0 of [-h + 0.006 * s, h - 0.006 * s - pt]) board(x0, y0, -h + post, x0 + pt, y1, h - post, boardK());
  }
  const nl = 4, lw = (s - 2 * proud - gap * (nl - 1)) / nl;
  for (let i = 0; i < nl; i++) { const z0 = -h + proud + i * (lw + gap); board(-h + post, s - pt - 0.004 * s, z0, h - post, s - 0.004 * s, z0 + lw, boardK()); }
  // diagonal braces on front and back
  const bw = s - 2 * post, bhh = s - 2 * rail, blen = Math.hypot(bw, bhh), ang = Math.atan2(bhh, bw);
  for (const sz of [1, -1]) {
    const br = box(blen, 0.07 * s, pt); br.rotateZ(sz > 0 ? ang : -ang); br.translate(0, h, sz * (h - 0.006 * s + pt / 2));
    wood.push(tone(worldUV(br, { offset: rnd() * 5 }), frameK() + 0.08));
  }
  // iron corner plates and nail heads
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) for (const y0 of [0.012 * s, s - 0.1 * s]) {
    metal.push(boxMM(sx * h - (sx > 0 ? 0.004 * s : 0) - (sx < 0 ? 0 : 0.085 * s) * 0, y0, sz > 0 ? h - 0.002 * s : -h - 0.002 * s, sx * h + (sx > 0 ? 0 : 0.085 * s) - (sx > 0 ? 0.085 * s : 0), y0 + 0.088 * s, sz > 0 ? h + 0.004 * s : -h + 0.004 * s));
    metal.push(boxMM(sx > 0 ? h - 0.002 * s : -h - 0.004 * s, y0, sz * h - (sz > 0 ? 0.085 * s : 0), sx > 0 ? h + 0.004 * s : -h + 0.002 * s, y0 + 0.088 * s, sz * h + (sz > 0 ? 0 : 0.085 * s)));
  }
  const nail = new THREE.CylinderGeometry(0.007 * s, 0.007 * s, 0.006 * s, 6); nail.rotateX(Math.PI / 2);
  for (let i = 0; i < nb; i++) {
    const yc = rail + i * (bh + gap) + bh / 2;
    for (const sz of [1, -1]) for (const xx of [-h + post + 0.03 * s, h - post - 0.03 * s]) for (const dy of [-bh * 0.25, bh * 0.25]) {
      const g = nail.clone(); g.translate(xx, yc + dy, sz * (h - 0.006 * s + (sz > 0 ? 0.003 * s : -0.003 * s))); metal.push(worldUV(g));
    }
  }
  const gw = mergeGeometries(wood.map((g) => prep(g.index ? g.toNonIndexed() : g)));
  const gm = mergeGeometries(metal.map((g) => prep(g.index ? g.toNonIndexed() : g)));
  const grp = new THREE.Group();
  const m1 = new THREE.Mesh(gw, mats.get('woodPlank')); const m2 = new THREE.Mesh(gm, mats.get('iron'));
  for (const m of [m1, m2]) { m.castShadow = true; m.receiveShadow = true; grp.add(m); }
  return grp;
}

// ---------------------------------------------------------------- barrel
// Coopered barrel: individual staves (with a visible chime at the top), flat
// iron hoops following the bilge, a recessed plank head and a bung.
export function barrel(K, x, y, z, { r = 0.3, h = 0.86, rot = 0 } = {}) {
  if (Overrides.has('barrel')) return Overrides.place(K, 'barrel', mat4(x, y, z, 0, rot, 0, r / 0.3, h / 0.86, r / 0.3));
  const m = mat4(x, y, z, 0, rot, 0);
  const R = (t) => r * (0.85 + 0.15 * Math.sin(t * Math.PI));
  const rnd = rng(Math.floor(Math.abs(x * 131 + z * 71)) + 5);
  const staves = Math.max(12, Math.round(r * 54)), gap = 0.006, lip = 0.022, chime = 0.04;
  for (let i = 0; i < staves; i++) {
    const phi0 = (i / staves) * Math.PI * 2 + gap / 2, dphi = (Math.PI * 2) / staves - gap;
    const k = 1 + (rnd() - 0.5) * 0.016;
    const prof = [new THREE.Vector2(R(0) * k - lip, 0)];
    for (let j = 0; j <= 16; j++) { const t = j / 16; prof.push(new THREE.Vector2(R(t) * k, t * h)); }
    prof.push(new THREE.Vector2(R(1) * k - lip, h), new THREE.Vector2(R(1) * k - lip, h - chime));
    const g = new THREE.LatheGeometry(prof, 2, phi0, dphi);
    const pos = g.attributes.position, uv = g.attributes.uv, off = rnd() * 4;
    for (let q = 0; q < pos.count; q++) {
      let a = Math.atan2(pos.getX(q), pos.getZ(q)); if (a < 0) a += Math.PI * 2;
      uv.setXY(q, pos.getY(q) + off, a * r + off * 0.7);
    }
    shadeByHeight(g, { base: 0, grime: 0.25, grimeAmt: 0.3 });
    const tn = 0.8 + rnd() * 0.3, c = g.attributes.color;
    for (let q = 0; q < c.count; q++) c.setXYZ(q, c.getX(q) * tn, c.getY(q) * tn, c.getZ(q) * tn);
    K.add(g, 'woodPlank', m);
  }
  // dark core so the joints between staves read as seams, not see-through slits
  const core = new THREE.LatheGeometry([0.02, 0.25, 0.5, 0.75, 0.98].map((t) => new THREE.Vector2(R(t) - lip * 0.6, t * h)), 24);
  K.add(setColor(core, 0x000000), 'darkInterior', m, { cast: false });
  for (const t0 of [0.075, 0.26, 0.74, 0.925]) {
    const bw = 0.022, y0 = t0 * h;
    const rA = R((y0 - bw) / h), rB = R((y0 + bw) / h);
    const hg = new THREE.LatheGeometry([new THREE.Vector2(rA + 0.001, y0 - bw), new THREE.Vector2(rA + 0.006, y0 - bw), new THREE.Vector2(rB + 0.006, y0 + bw), new THREE.Vector2(rB + 0.001, y0 + bw)], 40);
    latheUV(hg, r);
    K.add(hg, 'iron', m, { cast: false });
  }
  const head = new THREE.CircleGeometry(R(1) - lip + 0.002, 28); head.rotateX(-Math.PI / 2); head.translate(0, h - chime + 0.004, 0);
  const hu = worldUV(head); const huv = hu.attributes.uv; for (let q = 0; q < huv.count; q++) huv.setXY(q, huv.getX(q) * 2.5, huv.getY(q) * 2.5);
  shadeByHeight(hu, { base: h - 0.1, grime: 0.1, grimeAmt: 0 });
  K.add(hu, 'wood', m, { cast: false });
  const bung = new THREE.CylinderGeometry(0.022, 0.024, 0.02, 10); bung.rotateX(Math.PI / 2); bung.translate(0, h * 0.5, R(0.5) + 0.004);
  K.add(worldUV(bung), 'woodDark', m, { cast: false });
}

// ---------------------------------------------------------------- pots
// Sparse [r, y] silhouettes, smoothed with a spline; every pot gets a rolled
// lip, an inner wall that darkens into the mouth, optional handles and glaze.
const POTS = {
  amphora: { prof: [[0.001, 0], [0.07, 0], [0.1, 0.02], [0.17, 0.12], [0.215, 0.3], [0.205, 0.46], [0.15, 0.6], [0.092, 0.68], [0.078, 0.76], [0.098, 0.8]], lip: 0.012, depth: 0.22, handles: [0.7, 0.52] },
  jar: { prof: [[0.001, 0], [0.11, 0], [0.16, 0.045], [0.215, 0.17], [0.225, 0.28], [0.18, 0.385], [0.132, 0.438], [0.132, 0.468], [0.148, 0.5]], lip: 0.014, depth: 0.16 },
  tall: { prof: [[0.001, 0], [0.09, 0], [0.14, 0.08], [0.19, 0.3], [0.188, 0.58], [0.14, 0.8], [0.092, 0.9], [0.098, 0.965], [0.118, 1.0]], lip: 0.012, depth: 0.22 },
  planter: { prof: [[0.001, 0], [0.155, 0], [0.18, 0.03], [0.225, 0.27], [0.262, 0.3], [0.268, 0.35]], lip: 0.026, depth: 0.05 },
  bowl: { prof: [[0.001, 0], [0.07, 0], [0.12, 0.03], [0.178, 0.1], [0.205, 0.15]], lip: 0.01, depth: 0.1 },
};
const GLAZE = { green: 'glazeGreen', cobalt: 'glazeCobalt', fez: 'glazeWhite', white: 'glazeWhite' };
export function pot(K, x, y, z, { kind = 'jar', s = 1, rot = 0, mat = 'terracotta', lean = 0, glaze = null } = {}) {
  if (Overrides.has('pot_' + kind)) return Overrides.place(K, 'pot_' + kind, mat4(x, y, z, lean, rot, 0, s));
  const P = POTS[kind];
  const outer = smoothProfile(P.prof, 3);
  const top = outer[outer.length - 1];
  const nOuter = outer.length;
  const pts = outer.slice();
  pts.push(new THREE.Vector2(top.x - P.lip * 0.35, top.y + P.lip * 0.45), new THREE.Vector2(top.x - P.lip, top.y + P.lip * 0.1));
  pts.push(new THREE.Vector2(top.x - P.lip * 1.05, top.y - 0.03), new THREE.Vector2(top.x - P.lip * 1.2, top.y - P.depth), new THREE.Vector2(0.001, top.y - P.depth - 0.01));
  const g = lathe(pts.map((p) => new THREE.Vector2(p.x * s, p.y * s)), 32);
  latheUV(g, 0.2 * s);
  shadeByHeight(g, { base: 0, grime: 0.15 * s, grimeAmt: glaze ? 0.12 : 0.25 });
  // interior falls into shadow; fez pots get painted cobalt bands
  const pos = g.attributes.position, col = g.attributes.color, rows = pts.length;
  for (let i = 0; i < pos.count; i++) {
    const row = i % rows;
    if (row >= nOuter + 2) { const k = row === nOuter + 2 ? 0.55 : 0.28; col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k); continue; }
    if (glaze === 'fez') {
      const t = pos.getY(i) / (top.y * s);
      const band = (t > 0.5 && t < 0.56) || (t > 0.62 && t < 0.64) || (t > 0.82 && t < 0.86) || row >= nOuter - 1;
      if (band) col.setXYZ(i, col.getX(i) * 0.24, col.getY(i) * 0.36, col.getZ(i) * 0.82);
    }
  }
  const material = glaze ? GLAZE[glaze] : mat;
  const mm = mat4(x, y, z, lean, rot, 0);
  K.add(g, material, mm);
  if (P.handles) {
    const [yTop, yLow] = P.handles;
    const rAt = (yy) => { let best = outer[0]; for (const p of outer) if (Math.abs(p.y - yy) < Math.abs(best.y - yy)) best = p; return best.x; };
    for (const side of [1, -1]) {
      const a = [[rAt(yTop) - 0.004, yTop], [rAt(yTop) + 0.06, yTop + 0.03], [rAt(yLow) + 0.05, (yTop + yLow) / 2 + 0.03], [rAt(yLow) - 0.004, yLow]]
        .map(([rr, yy]) => new THREE.Vector3(side * rr * s, yy * s, 0));
      const hg = tube(a, 0.013 * s, 14, 6);
      shadeByHeight(hg, { base: 0, grime: 0.15 * s, grimeAmt: 0 });
      K.add(worldUV(hg), material, mm);
    }
  }
}

// ---------------------------------------------------------------- rugs
// woven fringe: `place(t, rnd)` returns [position, direction] for strand t in [0,1)
function fringe(K, m, { n, place, len = 0.07, mat = 'fabricCream', seed = 1 }) {
  const r = rng(seed);
  const strand = new THREE.BoxGeometry(0.007, 1, 0.003); strand.translate(0, 0.5, 0);
  const q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const [p, d] = place(i / n, r);
    q.setFromUnitVectors(Y, d.normalize());
    const g = strand.clone();
    g.applyMatrix4(new THREE.Matrix4().compose(p, q, sc.set(1, len * (0.75 + r() * 0.5), 1)));
    K.add(worldUV(g), mat, m, { cast: false });
  }
}

export function rugRoll(K, x, y, z, { r = 0.16, len = 1.7, upright = true, rot = 0, lean = 0.12, seed = 1 } = {}) {
  if (Overrides.has('rug_roll')) return Overrides.place(K, 'rug_roll', upright ? mat4(x, y, z, lean, rot, lean * 0.5, r / 0.16, len / 1.7, r / 0.16) : mat4(x, y + r, z, 0, rot, Math.PI / 2, r / 0.16, len / 1.7, r / 0.16));
  // slightly squashed, softly lumpy roll with the loose outer edge standing proud
  const off = rng(seed)();
  const g = gridGeom(28, 6, (u, v, p) => {
    const a = u * Math.PI * 2;
    const rr = r * (1 + 0.035 * Math.sin(v * 7 + seed) * Math.sin(a * 2 + seed)) * (1 + 0.03 * Math.max(0, Math.cos(a - off * 6)));
    p.set(Math.cos(a) * rr, v * len, Math.sin(a) * rr * 0.93);
  }, { wrapU: true });
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i) * 0.9 + 0.05, (uv.getX(i) * 0.5 + off) % 1);
  setColor(g, 0xffffff);
  const cap = new THREE.CircleGeometry(r * 0.99, 24);
  // spiral end: vertex colour rings
  const cp = cap.attributes.position; const cc = new Float32Array(cp.count * 3);
  for (let i = 0; i < cp.count; i++) { const d = Math.hypot(cp.getX(i), cp.getY(i)) / r; const k = 0.5 + 0.5 * Math.cos(d * 30 + Math.atan2(cp.getY(i), cp.getX(i))); cc[i * 3] = cc[i * 3 + 1] = cc[i * 3 + 2] = 0.55 + 0.35 * k; }
  cap.setAttribute('color', new THREE.BufferAttribute(cc, 3));
  cap.scale(1, 0.93, 1);
  const capTop = cap.clone(); capTop.rotateX(-Math.PI / 2); capTop.translate(0, len, 0);
  const capBot = cap.clone(); capBot.rotateX(Math.PI / 2);
  const m = upright ? mat4(x, y, z, lean, rot, lean * 0.5) : mat4(x, y + r, z, 0, rot, Math.PI / 2);
  K.add(g, 'rug', m);
  K.add(capTop, 'rug', m, { cast: false });
  if (!upright) K.add(capBot, 'rug', m, { cast: false });
  // cord ties
  for (const t of upright ? [0.32, 0.72] : [0.25, 0.75]) {
    const tg = new THREE.TorusGeometry(r * 1.02, 0.008, 5, 24); tg.rotateX(Math.PI / 2); tg.scale(1, 1, 0.93); tg.translate(0, t * len, 0);
    K.add(worldUV(tg), 'ropeMat', m, { cast: false });
  }
  // fringe: flops over the top of an upright roll, droops out of both ends of a lying one
  const ends = upright ? [len] : [0, len];
  ends.forEach((ey, k) => fringe(K, m, {
    n: 22, seed: seed * 7 + k, len: 0.07,
    place: (t, rr) => {
      const a = t * Math.PI * 2 + rr() * 0.1, ax = ey === 0 ? -1 : 1;
      const radial = new THREE.Vector3(Math.cos(a), 0, Math.sin(a) * 0.93);
      const tilt = upright ? 1.2 + rr() * 0.5 : 0.35 + rr() * 0.3;
      const d = new THREE.Vector3(0, ax * Math.cos(tilt), 0).addScaledVector(radial, Math.sin(tilt));
      if (!upright) d.x -= 0.9; else d.y -= 0.35;
      return [new THREE.Vector3(Math.cos(a) * r * 0.86, ey, Math.sin(a) * r * 0.8), d];
    },
  }));
}

export function hangingRug(K, x, y, z, { w = 1.6, h = 2.2, rot = 0 } = {}) {
  const g = new THREE.PlaneGeometry(w, h, 12, 8);
  const pos = g.attributes.position;
  const zAt = (px, py) => Math.sin(px * 4.1) * 0.03 + Math.sin(py * 2.3 + px) * 0.02 * (0.5 - py / h);
  for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), py = pos.getY(i); pos.setZ(i, zAt(px, py)); }
  g.computeVertexNormals();
  g.translate(0, -h / 2, 0);
  setColor(g, 0xffffff);
  setSway(g, (px, py) => Math.min(1, -py / h) * 0.12);
  const m = mat4(x, y, z, 0, rot, 0);
  K.add(g, 'rug', m);
  const rod = new THREE.CylinderGeometry(0.02, 0.02, w + 0.2, 8); rod.rotateZ(Math.PI / 2); rod.translate(0, 0.02, 0.02);
  K.add(worldUV(rod), 'woodDark', m, { cast: false });
  for (const sx of [-1, 1]) { const knob = new THREE.SphereGeometry(0.032, 10, 8); knob.translate(sx * (w / 2 + 0.1), 0.02, 0.02); K.add(worldUV(knob), 'brass', m, { cast: false }); }
  // bottom fringe
  const n = Math.round(w / 0.028);
  fringe(K, m, { n, seed: Math.round(Math.abs(x) * 10) + 1, len: 0.09, place: (t, rr) => { const px = -w / 2 + (t + 0.5 / n) * w; return [new THREE.Vector3(px, -h + 0.004, zAt(px, -h / 2) + 0.004), new THREE.Vector3((rr() - 0.5) * 0.25, -1, (rr() - 0.5) * 0.1)]; } });
}

// Market sacks. kind: 'open' (rolled-down burlap with a heap of spice),
// 'tied' (gathered neck with a cord and a ruffled flare) or 'lying' (filled
// grain sack resting on its side, used for stacks).
const SACK_TIE = [[0.2, 0], [0.245, 0.06], [0.268, 0.18], [0.248, 0.3], [0.17, 0.39], [0.075, 0.445], [0.052, 0.475], [0.064, 0.5], [0.1, 0.55], [0.125, 0.57]];
export function sack(K, x, y, z, { s = 1, rot = 0, mat = 'burlap', kind = 'tied', spice = 'spicePaprika', len = 0.8, hgt = 0.34, wid = 0.46 } = {}) {
  if (Overrides.has('sack')) return Overrides.place(K, 'sack', mat4(x, y, z, 0, rot, 0, s));
  const m = mat4(x, y, z, 0, rot, 0, s);
  const rnd = rng(Math.floor(Math.abs(x * 97 + z * 53 + y * 11)) + 7);
  const ph = rnd() * 6;
  const finish = (g, base = 0) => { const w = worldUV(g); shadeByHeight(w, { base, grime: 0.2, grimeAmt: 0.3 }); return w; };
  if (kind === 'lying') {
    const L = len / 2, W = wid / 2;
    const g = gridGeom(30, 24, (u, v, p) => {
      const a = u * Math.PI * 2, t = v * 2 - 1;
      const end = Math.pow(Math.abs(t), 5);
      const ry = hgt * 0.5 * Math.sqrt(Math.max(0, 1 - end));
      const rz = W * Math.pow(Math.max(0, 1 - end * 0.92), 0.35);
      let py = Math.sin(a) * ry;
      const floor = -ry * 0.55;
      if (py < floor) py = floor - (py - floor) * -0.12;
      const fold = Math.sin(a * 5 + t * 3 + ph) * 0.009 + Math.sin(t * 9 + a * 2 + ph) * 0.007;
      p.set(t * L * (1 + 0.03 * Math.cos(a)), py + hgt * 0.5 * 0.56 + fold, Math.cos(a) * rz * (1 + fold * 2));
    }, { wrapU: true });
    K.add(finish(g), mat, m);
    return;
  }
  if (kind === 'open') {
    const R0 = 0.24, Ht = 0.4;
    const body = gridGeom(40, 14, (u, v, p) => {
      const a = u * Math.PI * 2;
      let r = R0 * (0.9 + 0.12 * Math.sin(Math.min(1, v * 1.3) * Math.PI * 0.85)) * (1 + 0.035 * Math.sin(a * 6 + v * 4 + ph) + 0.02 * Math.sin(a * 11 - v * 7));
      if (v < 0.08) r *= 0.86 + (v / 0.08) * 0.14;
      p.set(Math.cos(a) * r, v * Ht, Math.sin(a) * r);
    }, { wrapU: true });
    K.add(finish(body), mat, m);
    const rimR = R0 * 0.95 + 0.02;
    const rim = gridGeom(40, 8, (u, v, p) => {
      const a = u * Math.PI * 2, b = v * Math.PI * 2 - Math.PI / 2;
      const rt = 0.034 * (1 + 0.18 * Math.sin(a * 9 + ph));
      const rr = rimR * (1 + 0.03 * Math.sin(a * 6 + ph)) + Math.cos(b) * rt;
      p.set(Math.cos(a) * rr, Ht + 0.01 + Math.sin(b) * rt, Math.sin(a) * rr);
    }, { wrapU: true });
    K.add(finish(rim), mat, m);
    const hh = 0.09 + rnd() * 0.05, Rh = rimR - 0.02;
    const heap = gridGeom(32, 8, (u, v, p) => {
      const a = u * Math.PI * 2, rr = Rh * (1 - v) * (1 + 0.04 * Math.sin(a * 5 + ph));
      p.set(Math.cos(a) * rr, Ht - 0.01 + hh * (1 - Math.pow(1 - v, 1.7)) + 0.006 * Math.sin(a * 13) * (1 - v), Math.sin(a) * rr);
    }, { wrapU: true });
    K.add(worldUV(heap), spice, m, { cast: false });
    return;
  }
  const prof = smoothProfile(SACK_TIE, 3);
  const nv = prof.length - 1;
  const body = gridGeom(36, nv, (u, v, p) => {
    const a = u * Math.PI * 2, q = prof[Math.round(v * nv)];
    const gather = 0.02 + 0.14 * Math.pow(Math.max(0, (q.y - 0.3) / 0.27), 1.5);
    const r = q.x * (1 + gather * Math.sin(a * 7 + q.y * 5 + ph) + 0.03 * Math.sin(a * 3 + ph));
    const flare = q.y > 0.5 ? 0.02 * Math.sin(a * 5 + ph) : 0;
    p.set(Math.cos(a) * r, q.y + flare, Math.sin(a) * r);
  }, { wrapU: true });
  K.add(finish(body), mat, m);
  const tie = new THREE.TorusGeometry(0.058, 0.011, 6, 16); tie.rotateX(Math.PI / 2); tie.translate(0, 0.472, 0);
  K.add(worldUV(tie), 'ropeMat', m, { cast: false });
  const tail = tube([new THREE.Vector3(0.05, 0.47, 0.03), new THREE.Vector3(0.09, 0.42, 0.07), new THREE.Vector3(0.1, 0.34, 0.1)], 0.007, 8, 4);
  K.add(worldUV(tail), 'ropeMat', m, { cast: false });
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

// Woven basket: stake ridges in the silhouette, wicker weave texture, a rope
// rim, a shaded inner wall and two small loop handles.
export function basket(K, x, y, z, { r = 0.26, h = 0.3, s = 1, handles = true } = {}) {
  if (Overrides.has('basket')) return Overrides.place(K, 'basket', mat4(x, y, z, 0, 0, 0, s * r / 0.26));
  const m = mat4(x, y, z, 0, 0, 0, s);
  const Rr = (t) => r * (0.8 + 0.2 * Math.sin(Math.min(1, t) * Math.PI * 0.5));
  const circ = Math.PI * 2 * r;
  const toMetres = (g, rs = 1) => { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * circ * rs, uv.getY(i) * h); return g; };
  const wall = gridGeom(64, 10, (u, v, p) => {
    const a = u * Math.PI * 2, rr = Rr(v) * (1 + 0.01 * Math.sin(a * 28));
    p.set(Math.cos(a) * rr, v * h, Math.sin(a) * rr);
  }, { wrapU: true });
  toMetres(wall);
  shadeByHeight(wall, { base: 0, grime: 0.1, grimeAmt: 0.25 });
  K.add(wall, 'wicker', m);
  const inner = gridGeom(48, 4, (u, v, p) => {
    const a = -u * Math.PI * 2, rr = Rr(v) - 0.014;
    p.set(Math.cos(a) * rr, 0.03 + v * (h - 0.03), Math.sin(a) * rr);
  }, { wrapU: true });
  toMetres(inner);
  const ic = setColor(inner, 0x6a6a6a).attributes.color;
  const ip = inner.attributes.position;
  for (let i = 0; i < ic.count; i++) { const k = 0.35 + 0.65 * (ip.getY(i) / h); ic.setXYZ(i, ic.getX(i) * k, ic.getY(i) * k, ic.getZ(i) * k); }
  K.add(inner, 'wicker', m, { cast: false });
  const base = new THREE.CircleGeometry(Rr(0.1) - 0.012, 32); base.rotateX(-Math.PI / 2); base.translate(0, 0.03, 0);
  K.add(setColor(worldUV(base), 0x444444), 'wicker', m, { cast: false });
  const rimR = Rr(1) - 0.004;
  const rim = gridGeom(72, 6, (u, v, p) => {
    const a = u * Math.PI * 2, b = v * Math.PI * 2 - Math.PI / 2;
    const rt = 0.017 * (1 + 0.16 * Math.sin(a * 44 + b));
    p.set(Math.cos(a) * (rimR + Math.cos(b) * rt), h + Math.sin(b) * rt, Math.sin(a) * (rimR + Math.cos(b) * rt));
  }, { wrapU: true });
  K.add(toMetres(rim, 1.5), 'wicker', m);
  if (handles) {
    for (const a of [0, Math.PI]) {
      const c = new THREE.Vector3(Math.cos(a) * rimR, h, Math.sin(a) * rimR), t = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
      const pts = [];
      for (let i = 0; i <= 8; i++) { const th = (i / 8) * Math.PI; pts.push(c.clone().addScaledVector(t, Math.cos(th) * 0.075).add(new THREE.Vector3(0, Math.sin(th) * 0.07, 0))); }
      K.add(worldUV(tube(pts, 0.011, 16, 6)), 'wicker', m);
    }
  }
}

// ---------------------------------------------------------------- cart
export function cart(K, x, y, z, { w = 2.4, rot = 0 } = {}) {
  if (Overrides.has('cart')) return Overrides.place(K, 'cart', mat4(x, y, z, 0, rot, 0, w / 2.4, 1, 1));
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
// Moroccan pierced brass lantern. The group's origin is the hanging point (top
// of the chain) so a rotation swings it like a pendulum; the body hangs below.
// Light escapes through arched cut-outs in eight panels and pinholes in the
// faceted roof.
export function lanternMesh(mats, { s = 1, lit = true, chain = 0.06 } = {}) {
  const grp = new THREE.Group();
  if (Overrides.has('lantern')) {
    const o = Overrides.instance('lantern'); o.scale.multiplyScalar(s);
    const bb = new THREE.Box3().setFromObject(o); o.position.y = -bb.max.y;
    grp.add(o); grp.userData.glowY = -bb.max.y * 0.6; grp.userData.hangH = bb.max.y;
    return grp;
  }
  const brass = mats.get('brass'), glow = lit ? mats.get('glassGlow') : mats.get('darkInterior');
  const metal = [], light = [];
  const N = 8, R = 0.09, y0 = 0.1, y1 = 0.29, hF = y1 - y0;
  const faceW = 2 * R * Math.tan(Math.PI / N);
  const facet = (g) => { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; };
  // bowl with drop finial underneath
  metal.push(lathe(smoothProfile([[0.001, -0.075], [0.007, -0.066], [0.014, -0.045], [0.009, -0.025], [0.018, -0.01], [0.045, 0.03], [0.08, 0.07], [0.098, 0.092], [0.094, 0.1], [0.001, 0.1]], 2), 16));
  // pierced panels: a pointed-arch window, a star above, a drop below
  const panelShape = () => {
    const sh = new THREE.Shape();
    sh.moveTo(-faceW / 2, 0); sh.lineTo(faceW / 2, 0); sh.lineTo(faceW / 2, hF); sh.lineTo(-faceW / 2, hF); sh.lineTo(-faceW / 2, 0);
    const aw = faceW * 0.56, spring = 0.12, rise = 0.035;
    const arch = pointedArchPoints(aw, spring, rise, 8);
    const hole = new THREE.Path();
    hole.moveTo(-aw / 2, 0.035);
    for (const p of arch) hole.lineTo(p.x, p.y);
    hole.lineTo(aw / 2, 0.035); hole.lineTo(-aw / 2, 0.035);
    sh.holes.push(hole);
    const star = new THREE.Path(); const sy = 0.172, sr = 0.011;
    for (let i = 0; i <= 8; i++) { const a = (i / 8) * Math.PI * 2 + Math.PI / 2, rr = i % 2 ? sr * 0.45 : sr; const px = Math.cos(a) * rr, py = sy + Math.sin(a) * rr; i ? star.lineTo(px, py) : star.moveTo(px, py); }
    sh.holes.push(star);
    const dot = new THREE.Path(); dot.absellipse(0, 0.018, 0.005, 0.008, 0, Math.PI * 2, true); sh.holes.push(dot);
    return sh;
  };
  const panel = extrude(panelShape(), 0.003, { curveSeg: 4 });
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const g = panel.clone(); g.translate(0, y0, R - 0.0015); g.rotateY(a); metal.push(g);
    const post = boxMM(-0.005, y0 - 0.004, R / Math.cos(Math.PI / N) - 0.006, 0.005, y1 + 0.004, R / Math.cos(Math.PI / N) + 0.003); post.rotateY(a + Math.PI / N); metal.push(post);
  }
  // amber glass inside the panels
  const glass = new THREE.CylinderGeometry(R * 0.93, R * 0.93, hF, N, 1, true); glass.rotateY(Math.PI / N); glass.translate(0, (y0 + y1) / 2, 0);
  light.push(glass);
  // rings, flared cornice and a faceted ogee roof
  const ring = (ya, yb, ra, rb) => metal.push(facet(new THREE.LatheGeometry([new THREE.Vector2(ra, ya), new THREE.Vector2(rb, ya), new THREE.Vector2(rb, yb), new THREE.Vector2(ra, yb)], N, Math.PI / N)));
  ring(y0 - 0.008, y0 + 0.006, R * 0.9, R * 1.07);
  ring(y1 - 0.006, y1 + 0.008, R * 0.9, R * 1.07);
  const roofProf = [[R * 1.18, y1 + 0.008], [R * 1.18, y1 + 0.02], [R * 1.08, y1 + 0.034], [R * 0.98, y1 + 0.05], [R * 0.8, y1 + 0.085], [R * 0.5, y1 + 0.12], [R * 0.26, y1 + 0.145], [R * 0.13, y1 + 0.16], [0.012, y1 + 0.172], [0.001, y1 + 0.175]];
  metal.push(facet(new THREE.LatheGeometry(roofProf.map(([a, b]) => new THREE.Vector2(a, b)), N, Math.PI / N)));
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    for (const [rr, yy, d] of [[R * 0.9, y1 + 0.068, 0.006], [R * 0.52, y1 + 0.118, 0.0045]]) {
      const hole = new THREE.SphereGeometry(d, 5, 3); hole.translate(Math.sin(a) * rr, yy, Math.cos(a) * rr); light.push(hole);
    }
  }
  // finial, hanging ring and chain up to the hook
  const fy = y1 + 0.17;
  metal.push(lathe(smoothProfile([[0.001, fy], [0.012, fy + 0.004], [0.016, fy + 0.018], [0.008, fy + 0.03], [0.012, fy + 0.042], [0.004, fy + 0.055], [0.001, fy + 0.06]], 3), 12));
  const ringY = fy + 0.072;
  const tr = new THREE.TorusGeometry(0.012, 0.0028, 5, 12); tr.translate(0, ringY, 0); metal.push(tr);
  const links = Math.max(0, Math.round(chain / 0.022));
  for (let i = 0; i < links; i++) {
    const l = new THREE.TorusGeometry(0.009, 0.0022, 4, 10); l.scale(1, 1.35, 1); if (i % 2 === 0) l.rotateY(Math.PI / 2);
    l.translate(0, ringY + 0.018 + i * 0.022, 0); metal.push(l);
  }
  const hangH = ringY + 0.012 + links * 0.022;
  const prepG = (g) => { const n = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(n.attributes)) if (!['position', 'normal', 'uv'].includes(k)) n.deleteAttribute(k); if (!n.attributes.uv) worldUV(n); return n; };
  const gm = mergeGeometries(metal.map((g) => prepG(worldUV(g.index ? g.toNonIndexed() : g))));
  const gl = mergeGeometries(light.map(prepG));
  gm.scale(s, s, s); gl.scale(s, s, s);
  gm.translate(0, -hangH * s, 0); gl.translate(0, -hangH * s, 0);
  const mm = new THREE.Mesh(prep(gm), brass); mm.castShadow = true; mm.receiveShadow = true;
  const ml = new THREE.Mesh(gl, glow);
  grp.add(mm, ml);
  grp.userData.glowY = (-hangH + (y0 + y1) / 2) * s;
  grp.userData.hangH = hangH * s;
  return grp;
}

// Forged iron wall bracket: arched wall plate with rivets, an arm ending in an
// upturned scroll, a curved brace and two C-scrolls filling the triangle.
// `yaw` turns the arm (default +z, out of a wall facing the camera). Returns
// the world position of the hook the lantern chain hangs from.
export function bracket(K, x, y, z, { len = 0.55, dir = 1, yaw = dir < 0 ? Math.PI : 0 } = {}) {
  const V = (a, b, c) => new THREE.Vector3(a, b, c);
  const parts = [];
  const ps = new THREE.Shape();
  ps.moveTo(-0.045, -0.36); ps.lineTo(0.045, -0.36); ps.lineTo(0.045, 0.02); ps.quadraticCurveTo(0.045, 0.085, 0, 0.1); ps.quadraticCurveTo(-0.045, 0.085, -0.045, 0.02); ps.lineTo(-0.045, -0.36);
  parts.push(extrude(ps, 0.01, { bevel: 0.003, bevelSeg: 1, curveSeg: 6 }));
  for (const ry of [0.035, -0.31]) { const rv = new THREE.SphereGeometry(0.01, 8, 6); rv.scale(1, 1, 0.6); rv.translate(0, ry, 0.014); parts.push(rv); }
  const zE = len - 0.055, rc = 0.034;
  const arm = [];
  for (let i = 0; i <= 6; i++) arm.push(V(0, 0, 0.012 + (i / 6) * (zE - 0.012)));
  for (let i = 1; i <= 18; i++) { const t = i / 18, a = t * Math.PI * 1.75, r = rc * (1 - t * 0.6); arm.push(V(0, rc - Math.cos(a) * r, zE + Math.sin(a) * r)); }
  parts.push(tube(arm, 0.0095, 60, 6));
  parts.push(tube([V(0, -0.3, 0.012), V(0, -0.2, 0.045), V(0, -0.1, len * 0.3), V(0, -0.035, len * 0.5), V(0, -0.006, len * 0.64)], 0.0085, 24, 6));
  const scroll = (cy, cz, r0, turns, flip) => {
    const pts = [];
    for (let i = 0; i <= 28; i++) { const t = i / 28, a = t * Math.PI * 2 * turns, r = r0 * (1 - t * 0.72); pts.push(V(0, cy + Math.sin(a) * r * flip, cz + Math.cos(a) * r)); }
    parts.push(tube(pts, 0.0065, 48, 5));
  };
  scroll(-0.105, 0.085, 0.062, 1.1, 1);
  scroll(-0.045, len * 0.4, 0.038, 1.05, -1);
  const hook = new THREE.TorusGeometry(0.012, 0.0035, 5, 12, Math.PI * 1.5); hook.rotateY(Math.PI / 2); hook.translate(0, -0.012, zE); parts.push(hook);
  const m = mat4(x, y, z, 0, yaw, 0);
  for (const g of parts) K.add(worldUV(g), 'iron', m, { cast: true });
  return V(0, -0.024, zE).applyMatrix4(m);
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
// Scalloped timber eave: carved corbels against the wall, plank soffit, a
// scalloped fascia and a skin of green glazed barrel tiles (pans and covers).
export function eave(K, { x0, x1, y, z, depth = 1.1, drop = 0.35, soffit = 'woodDark' }) {
  const w = x1 - x0;
  const s = new THREE.Shape();
  const n = Math.max(2, Math.round(w / 0.45));
  s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, -drop * 0.5);
  for (let i = n; i > 0; i--) { const xa = (i / n) * w, xb = ((i - 1) / n) * w; s.quadraticCurveTo((xa + xb) / 2, -drop * 1.6, xb, -drop * 0.5); }
  s.lineTo(0, 0);
  const g = extrude(s, 0.06, { curveSeg: 6, bevel: 0.008, bevelSeg: 1 });
  g.translate(x0, y, z + depth);
  K.add(worldUV(g), 'woodDark');
  // painted bead along the top of the fascia
  const bead = new THREE.CylinderGeometry(0.03, 0.03, w, 8); bead.rotateZ(Math.PI / 2); bead.translate(x0 + w / 2, y - 0.02, z + depth + 0.07);
  K.add(worldUV(bead), 'wood');
  // plank soffit and carved corbels under it
  const sof = boxMM(x0, y - 0.16, z, x1, y - 0.12, z + depth + 0.02); K.add(sof, soffit);
  const cor = new THREE.Shape();
  cor.moveTo(0, 0); cor.lineTo(0.62, 0); cor.lineTo(0.62, -0.08); cor.quadraticCurveTo(0.5, -0.1, 0.44, -0.16); cor.lineTo(0.3, -0.16); cor.quadraticCurveTo(0.2, -0.2, 0.16, -0.3); cor.lineTo(0, -0.34); cor.lineTo(0, 0);
  const nc = Math.max(2, Math.round(w / 0.9));
  for (let i = 0; i <= nc; i++) {
    const cx = x0 + 0.1 + (i / nc) * (w - 0.2);
    const cg = extrude(cor, 0.09, { curveSeg: 5 });
    cg.rotateY(-Math.PI / 2); cg.translate(cx - 0.045, y - 0.16, z);
    K.add(worldUV(cg), 'woodDark');
  }
  // glazed barrel tiles: rows of concave pans with convex covers over the joints
  const yw = y + 0.44, yf = y + 0.06, zf = z + depth + 0.12;
  const slope = new THREE.Vector3(0, yf - yw, zf - z);
  const L = slope.length(); slope.normalize();
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(slope, -slope.y).normalize();
  const pitch = 0.2, nt = Math.max(2, Math.floor(w / pitch));
  const course = 0.34, courses = Math.max(1, Math.round(L / course));
  const r = rng(Math.floor(x0 * 17 + z * 3) + 9);
  const tileRow = (xc, cover) => {
    const rw = cover ? 0.062 : 0.078, rh = cover ? 0.05 : 0.03;
    const shade = 0.8 + r() * 0.35;
    const tg = gridGeom(6, courses * 4, (u, v, p) => {
      const th = u * Math.PI, along = v * L;
      const k = (along / course) % 1;
      const flare = 1 + 0.12 * Math.pow(k, 3);
      const side = Math.cos(th) * rw * flare;
      const lift = Math.sin(th) * rh * flare * (cover ? 1 : -1) + (cover ? 0.045 : 0.02) + 0.03 * Math.pow(k, 3);
      p.set(xc + (cover ? side : -side), yw, z).addScaledVector(slope, along).addScaledVector(up, lift);
    });
    tg.computeVertexNormals();
    const uv = tg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25 + xc * 0.37, uv.getY(i) * L);
    setColor(tg, new THREE.Color(shade, shade, shade));
    K.add(tg, 'glazeTile', null, { cast: cover });
  };
  for (let i = 0; i < nt; i++) tileRow(x0 + (i + 0.5) * (w / nt), false);
  for (let i = 0; i <= nt; i++) tileRow(x0 + i * (w / nt), true);
  // ridge against the wall
  const ridge = boxMM(x0, yw - 0.02, z - 0.02, x1, yw + 0.12, z + 0.1, { round: 0.02 }); K.add(ridge, 'limestone');
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
  if (Overrides.has('stool')) return Overrides.place(K, 'stool', mat4(x, y, z));
  const top = new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14); top.translate(0, 0.45, 0); K.add(worldUV(top), 'wood', mat4(x, y, z));
  for (let i = 0; i < 3; i++) { const a = i * 2.09; const l = new THREE.CylinderGeometry(0.02, 0.025, 0.46, 6); l.rotateZ(0.12); l.rotateY(a); l.translate(Math.cos(a) * 0.14, 0.22, Math.sin(a) * 0.14); K.add(worldUV(l), 'woodDark', mat4(x, y, z)); }
}

export function pole(K, x, y0, y1, z, r = 0.04, mat = 'woodDark') {
  const g = new THREE.CylinderGeometry(r, r * 1.15, y1 - y0, 8); g.translate(x, (y0 + y1) / 2, z);
  K.add(worldUV(g), mat);
}
