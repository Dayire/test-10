import * as THREE from 'three';
import { worldUV, shadeByHeight, setColor, extrude, lathe, pointedArchPoints, mat4, boxMM, rng, tube } from './geom.js';
import { Overrides } from './library.js';

// ---------------------------------------------------------------------------
// Arch outlines (points from left springing, over the crown, to right springing)
// ---------------------------------------------------------------------------
export function archOutline(kind, w, hs, rise, grow = 0, n = 20) {
  const a = w / 2;
  if (kind === 'pointed') return pointedArchPoints(w, hs, rise, n, grow);
  if (kind === 'horseshoe') {
    const e = 0.38;
    const R0 = a / Math.cos(e);
    const cy = hs + R0 * Math.sin(e);
    const R = R0 + grow;
    const ee = Math.acos(Math.min(1, (a + grow) / R));
    const pts = [];
    for (let i = 0; i <= n * 2; i++) {
      const t = i / (n * 2);
      const ang = Math.PI + ee - t * (Math.PI + 2 * ee);
      pts.push(new THREE.Vector2(Math.cos(ang) * R, cy + Math.sin(ang) * R));
    }
    return pts;
  }
  if (kind === 'round') {
    const R = a + grow; const pts = [];
    for (let i = 0; i <= n * 2; i++) { const ang = Math.PI - (i / (n * 2)) * Math.PI; pts.push(new THREE.Vector2(Math.cos(ang) * R, hs + Math.sin(ang) * R)); }
    return pts;
  }
  // rect
  return [new THREE.Vector2(-a - grow, hs + grow), new THREE.Vector2(a + grow, hs + grow)];
}

function holePath(kind, cx, sill, w, hs, rise, grow = 0) {
  const pts = archOutline(kind, w, hs, rise, grow);
  const p = new THREE.Path();
  const a = w / 2 + grow;
  p.moveTo(cx - a, sill);
  for (const v of pts) p.lineTo(cx + v.x, sill + v.y);
  p.lineTo(cx + a, sill);
  p.lineTo(cx - a, sill);
  return p;
}

// frame band around an arch opening (jambs + arch), as extrudable Shape
function frameShape(kind, w, hs, rise, band, sillExt = 0) {
  const inner = archOutline(kind, w, hs, rise, 0);
  const outer = archOutline(kind, w, hs, rise, band);
  const s = new THREE.Shape();
  const a = w / 2, A = w / 2 + band;
  s.moveTo(-A, -sillExt);
  for (const v of outer) s.lineTo(v.x, v.y);
  s.lineTo(A, -sillExt);
  s.lineTo(a, -sillExt);
  for (let i = inner.length - 1; i >= 0; i--) s.lineTo(inner[i].x, inner[i].y);
  s.lineTo(-a, -sillExt);
  s.lineTo(-A, -sillExt);
  return s;
}

// ---------------------------------------------------------------------------
// A wall slab with arched openings, facing +z, front face at z.
// ---------------------------------------------------------------------------
export function wallWithOpenings(K, o) {
  const { x0, x1, y0, y1, z, depth = 0.4, mat = 'plasterBlue', openings = [], interior = true, grime = 1.4, cast = true } = o;
  const s = new THREE.Shape();
  s.moveTo(x0, y0); s.lineTo(x1, y0); s.lineTo(x1, y1); s.lineTo(x0, y1); s.lineTo(x0, y0);
  for (const op of openings) {
    const sill = Math.max(op.sill, y0 + 0.002);
    s.holes.push(holePath(op.kind, op.cx, sill, op.w, op.hs, op.rise ?? op.w * 0.6));
  }
  const g = extrude(s, depth, { curveSeg: 16 });
  g.translate(0, 0, z - depth);
  const gu = worldUV(g, { offset: (x0 * 0.37) % 3 });
  shadeByHeight(gu, { base: o.groundY ?? y0, grime, grimeAmt: 0.32, seed: x0 });
  K.add(gu, mat, null, { cast });
  if (interior) {
    for (const op of openings) {
      if (op.noInterior) continue;
      const top = op.sill + op.hs + (op.rise ?? op.w * 0.6) + 0.2;
      const back = boxMM(op.cx - op.w / 2 - 0.1, Math.max(op.sill, y0) - 0.02, z - depth - (op.recess ?? 1.2), op.cx + op.w / 2 + 0.1, top, z - depth - (op.recess ?? 1.2) + 0.05);
      setColor(back, 0xffffff);
      K.add(back, op.interiorMat || 'darkInterior', null, { cast: false });
    }
  }
  return g;
}

export function archFrame(K, o) {
  const { kind = 'pointed', cx, sill, w, hs, rise = w * 0.6, band = 0.18, depth = 0.12, z, mat = 'limestone', sillExt = 0, steps = 1 } = o;
  for (let i = 0; i < steps; i++) {
    const b = band * (1 - i * 0.35);
    const shp = frameShape(kind, w, hs, rise, b, sillExt);
    const g = extrude(shp, depth * (1 + i * 0.4), { curveSeg: 12 });
    g.translate(cx, sill, z - depth * 0.5 + i * 0.001);
    const gu = worldUV(g);
    shadeByHeight(gu, { base: sill, grime: 0.8, grimeAmt: 0.2 });
    K.add(gu, mat);
  }
}

// zellige spandrels: fills the corners between an arch (grown by `band`) and
// the rectangle [x0, x1] x [springing, yTop], optionally boxed by a limestone alfiz
export function spandrels(K, { kind = 'pointed', cx, sill, w, hs, rise = w * 0.6, band = 0.2, x0, x1, yTop, z, alfiz = 0 }) {
  const outer = archOutline(kind, w, hs, rise, band, 24);
  const ys = sill + hs;
  const sh = new THREE.Shape();
  sh.moveTo(x0, ys); sh.lineTo(x0, yTop); sh.lineTo(x1, yTop); sh.lineTo(x1, ys);
  for (let i = outer.length - 1; i >= 0; i--) { const p = outer[i]; if (sill + p.y >= ys - 1e-4) sh.lineTo(cx + p.x, sill + p.y); }
  sh.lineTo(x0, ys);
  const g = new THREE.ShapeGeometry(sh, 1); g.translate(0, 0, z);
  K.add(setColor(worldUV(g), 0xffffff), 'zellige', null, { cast: false });
  if (alfiz > 0) {
    const d = z + 0.05, b = alfiz;
    for (const bb of [boxMM(x0 - b, sill, z - 0.02, x0, yTop + b, d), boxMM(x1, sill, z - 0.02, x1 + b, yTop + b, d), boxMM(x0, yTop, z - 0.02, x1, yTop + b, d)]) {
      shadeByHeight(bb, { base: sill, grime: 0.6, grimeAmt: 0.2 });
      K.add(bb, 'limestone');
    }
  }
}

// carved bead (half-round moulding) following an arch outline and its jambs
export function archBead(K, { kind = 'pointed', cx, sill, w, hs, rise = w * 0.6, grow = 0, z, r = 0.03, mat = 'limestone', jambs = true }) {
  const pts = archOutline(kind, w, hs, rise, grow, 20).map((p) => new THREE.Vector3(cx + p.x, sill + p.y, z));
  if (jambs) { pts.unshift(new THREE.Vector3(pts[0].x, sill, z)); pts.push(new THREE.Vector3(pts[pts.length - 1].x, sill, z)); }
  const g = tube(pts, r, pts.length * 3, 6);
  shadeByHeight(g, { base: sill, grime: 0.6, grimeAmt: 0.2 });
  K.add(worldUV(g), mat);
}

// alternating red / cream voussoirs (Cordoba style), as separate wedges
export function voussoirs(K, o) {
  const { kind = 'horseshoe', cx, sill, w, hs, rise = w * 0.6, band = 0.32, depth = 0.5, z, n = 17, colors = [0x9a3524, 0xe2cdb0] } = o;
  const inner = archOutline(kind, w, hs, rise, 0, n * 3);
  const outer = archOutline(kind, w, hs, rise, band, n * 3);
  const per = Math.floor((inner.length - 1) / n);
  for (let i = 0; i < n; i++) {
    const s = new THREE.Shape();
    const i0 = i * per, i1 = i === n - 1 ? inner.length - 1 : (i + 1) * per;
    s.moveTo(inner[i0].x, inner[i0].y);
    for (let k = i0; k <= i1; k++) s.lineTo(outer[k].x, outer[k].y);
    for (let k = i1; k >= i0; k--) s.lineTo(inner[k].x, inner[k].y);
    const g = extrude(s, depth, { bevel: 0.012, bevelSeg: 1 });
    g.translate(cx, sill, z - depth);
    const gu = worldUV(g);
    const c = new THREE.Color(colors[i % 2]);
    setColor(gu, c);
    K.add(gu, 'limestone');
  }
}

// moulded cornice running along x, profile given as [z, y] steps
export function cornice(K, { x0, x1, y, z, profile = 'classic', mat = 'limestone', scale = 1 }) {
  const P = {
    classic: [[0, 0], [0.06, 0], [0.06, 0.05], [0.12, 0.08], [0.18, 0.16], [0.24, 0.2], [0.24, 0.28], [0, 0.28]],
    band: [[0, 0], [0.08, 0], [0.08, 0.16], [0, 0.16]],
    heavy: [[0, 0], [0.1, 0], [0.1, 0.08], [0.2, 0.14], [0.3, 0.3], [0.36, 0.34], [0.36, 0.44], [0, 0.44]],
  }[profile];
  const s = new THREE.Shape();
  s.moveTo(0, P[0][1] * scale);
  for (const [pz, py] of P) s.lineTo(pz * scale, py * scale);
  const g = extrude(s, x1 - x0, { curveSeg: 4 });
  // shape is in (z,y) plane; extrusion along +z -> rotate so extrusion goes along +x
  g.rotateY(Math.PI / 2);
  g.translate(x0, y, z);
  const gu = worldUV(g);
  shadeByHeight(gu, { base: y, grime: 0.2, grimeAmt: 0.25 });
  K.add(gu, mat);
}

// stepped merlons (crenellation) along a roof edge
export function merlons(K, { x0, x1, y, z, depth = 0.3, h = 0.5, w = 0.34, gap = 0.26, mat = 'plasterCream' }) {
  const n = Math.floor((x1 - x0 + gap) / (w + gap));
  const start = x0 + ((x1 - x0) - (n * w + (n - 1) * gap)) / 2;
  for (let i = 0; i < n; i++) {
    const x = start + i * (w + gap);
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(w, 0); s.lineTo(w, h * 0.55); s.lineTo(w * 0.78, h * 0.55); s.lineTo(w * 0.78, h * 0.8); s.lineTo(w * 0.62, h * 0.8); s.lineTo(w * 0.5, h); s.lineTo(w * 0.38, h * 0.8); s.lineTo(w * 0.22, h * 0.8); s.lineTo(w * 0.22, h * 0.55); s.lineTo(0, h * 0.55); s.lineTo(0, 0);
    const g = extrude(s, depth);
    g.translate(x, y, z - depth);
    K.add(worldUV(g), mat);
  }
}

// wooden door with iron studs, inside an opening
export function door(K, { cx, sill, w, hs, rise, z, kind = 'pointed', studs = true, open = 0 }) {
  const pts = archOutline(kind, w, hs, rise, -0.02);
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + 0.02, 0);
  for (const v of pts) s.lineTo(v.x, v.y);
  s.lineTo(w / 2 - 0.02, 0); s.lineTo(-w / 2 + 0.02, 0);
  const g = extrude(s, 0.08, { bevel: 0.01, bevelSeg: 1 });
  g.translate(cx, sill, z - 0.12);
  const gu = worldUV(g);
  // rotate uvs so planks run vertically
  const uv = gu.attributes.uv; for (let i = 0; i < uv.count; i++) { const u = uv.getX(i), v = uv.getY(i); uv.setXY(i, v, u); }
  shadeByHeight(gu, { base: sill, grime: 0.6, grimeAmt: 0.25 });
  K.add(gu, 'woodDark');
  if (studs) {
    const st = new THREE.SphereGeometry(0.018, 6, 4);
    const rows = Math.floor(hs / 0.32);
    for (let r = 1; r <= rows; r++) for (const fx of [-0.33, -0.1, 0.1, 0.33]) {
      const g2 = st.clone(); g2.translate(cx + fx * w, sill + r * 0.32, z - 0.03);
      K.add(g2, 'iron', null, { cast: false });
    }
  }
  // iron ring handle
  const ring = new THREE.TorusGeometry(0.05, 0.008, 6, 12);
  ring.translate(cx + w * 0.22, sill + hs * 0.55, z - 0.02);
  K.add(ring, 'iron', null, { cast: false });
}

// zellige tiled panel (thin slab) with a limestone border
export function zellige(K, { x0, x1, y0, y1, z, border = 0.05 }) {
  const g = boxMM(x0, y0, z - 0.02, x1, y1, z + 0.015);
  setColor(g, 0xffffff);
  K.add(g, 'zellige', null, { cast: false });
  if (border > 0) {
    const b = [
      boxMM(x0 - border, y1, z - 0.02, x1 + border, y1 + border, z + 0.03),
      boxMM(x0 - border, y0 - border, z - 0.02, x1 + border, y0, z + 0.03),
      boxMM(x0 - border, y0, z - 0.02, x0, y1, z + 0.03),
      boxMM(x1, y0, z - 0.02, x1 + border, y1, z + 0.03),
    ];
    b.forEach((bg) => { setColor(bg, 0xe8e0d0); K.add(bg, 'limestone', null, { cast: false }); });
  }
}

// ---------------------------------------------------------------------------
// Building facade block: wall with openings + volume behind + roof dressing
// ---------------------------------------------------------------------------
const STYLE = {
  blue: { wall: 'plasterBlue', trim: 'limestone', base: 'sandstone' },
  peach: { wall: 'plasterPeach', trim: 'plasterCream', base: 'sandstone' },
  cream: { wall: 'plasterCream', trim: 'limestone', base: 'sandstone' },
  ochre: { wall: 'plasterOchre', trim: 'plasterCream', base: 'sandstone' },
  white: { wall: 'plasterWhite', trim: 'limestone', base: 'sandstone' },
  stone: { wall: 'sandstone', trim: 'limestone', base: 'sandstone' },
};

export function building(K, o) {
  const r = rng(o.seed || Math.floor(o.x0 * 13 + 7));
  const st = STYLE[o.style || 'blue'];
  const { x0, x1, z, y0 = 0, height, depth = 7, floors = Math.max(1, Math.round(height / 3.4)) } = o;
  const top = y0 + height;
  const openings = [];
  const fh = height / floors;
  const width = x1 - x0;
  // ground floor: door(s) + windows, upper floors: windows
  const doorAt = o.door !== undefined ? o.door : (width > 3 ? x0 + width * r.range(0.3, 0.7) : null);
  const kinds = o.kinds || ['pointed', 'horseshoe', 'round', 'pointed'];
  if (doorAt !== null && doorAt !== false) {
    const dk = o.doorKind || r.pick(kinds);
    const dw = o.doorW || r.range(1.1, 1.5);
    openings.push({ kind: dk, cx: doorAt, sill: y0, w: dw, hs: o.doorH || 1.9, rise: dk === 'pointed' ? dw * 0.62 : dw * 0.5, isDoor: true, noInterior: false, recess: 0.35 });
  }
  for (let f = 0; f < floors; f++) {
    const sill = y0 + f * fh + (f === 0 ? 1.2 : 0.9);
    if (f === 0 && o.noGroundWindows) continue;
    const n = Math.max(1, Math.floor(width / (o.winSpacing || 2.6)));
    for (let i = 0; i < n; i++) {
      const cx = x0 + (i + 0.5) * (width / n) + r.range(-0.15, 0.15);
      if (doorAt !== null && doorAt !== false && f === 0 && Math.abs(cx - doorAt) < 1.4) continue;
      if (r() < (o.winSkip ?? 0.25)) continue;
      const k = o.winKind || r.pick(kinds);
      const w = r.range(0.55, 0.85) * (o.winScale || 1);
      const hs = Math.min(fh - 1.6, r.range(0.8, 1.2));
      if (sill + hs + w * 0.7 > top - 0.5) continue;
      openings.push({ kind: k, cx, sill, w, hs, rise: k === 'pointed' ? w * 0.65 : w * 0.5, deco: r() });
    }
  }
  wallWithOpenings(K, { x0, x1, y0, y1: top, z, depth: 0.4, mat: st.wall, openings, groundY: o.groundY ?? y0 });
  // body behind (gives rooftops and shadow casters)
  if (depth > 0.5) {
    const body = boxMM(x0 + 0.02, y0, z - depth, x1 - 0.02, top - 0.02, z - 0.4);
    shadeByHeight(body, { base: o.groundY ?? y0, grime: 1.4, grimeAmt: 0.3 });
    K.add(body, st.wall);
  }
  // plinth
  const pl = boxMM(x0, y0, z - 0.05, x1, y0 + 0.35, z + 0.06);
  shadeByHeight(pl, { base: y0, grime: 0.35, grimeAmt: 0.35 });
  K.add(pl, st.base);
  // floor bands + cornice + parapet
  for (let f = 1; f < floors; f++) cornice(K, { x0, x1, y: y0 + f * fh - 0.08, z, profile: 'band', mat: st.trim, scale: 0.8 });
  cornice(K, { x0: x0 - 0.05, x1: x1 + 0.05, y: top - 0.3, z, profile: o.corniceProfile || 'classic', mat: st.trim, scale: 1.1 });
  if (o.merlons !== false) merlons(K, { x0, x1, y: top, z: z + 0.02, mat: st.trim === 'limestone' ? 'plasterCream' : st.trim, h: 0.45 });
  // frames, doors, screens
  for (const op of openings) {
    if (op.isDoor) {
      archFrame(K, { kind: op.kind, cx: op.cx, sill: op.sill, w: op.w, hs: op.hs, rise: op.rise, band: 0.2, depth: 0.14, z: z + 0.05, mat: st.trim, steps: 2 });
      if (o.openDoor !== true) door(K, { cx: op.cx, sill: op.sill, w: op.w, hs: op.hs, rise: op.rise, z: z - 0.25, kind: op.kind });
      if (o.doorZellige !== false && r() < 0.5) zellige(K, { x0: op.cx - op.w / 2 - 0.55, x1: op.cx + op.w / 2 + 0.55, y0: op.sill + 0.02, y1: op.sill + 0.9, z: z + 0.02 });
      const step = boxMM(op.cx - op.w / 2 - 0.25, y0, z - 0.1, op.cx + op.w / 2 + 0.25, y0 + 0.14, z + 0.35);
      shadeByHeight(step, { base: y0, grime: 0.2, grimeAmt: 0.2 });
      K.add(step, 'limestone');
    } else {
      archFrame(K, { kind: op.kind, cx: op.cx, sill: op.sill - 0.08, w: op.w, hs: op.hs + 0.08, rise: op.rise, band: 0.1, depth: 0.1, z: z + 0.04, mat: st.trim, sillExt: 0.06 });
      if (op.deco < 0.45) {
        // mashrabiya screen
        const pts = archOutline(op.kind, op.w, op.hs, op.rise, -0.01);
        const s = new THREE.Shape(); s.moveTo(-op.w / 2, 0); for (const v of pts) s.lineTo(v.x, v.y); s.lineTo(op.w / 2, 0);
        const g = new THREE.ShapeGeometry(s, 8); g.translate(op.cx, op.sill, z - 0.2);
        K.add(worldUV(g), 'lattice', null, { cast: true });
      } else if (op.deco < 0.75) {
        // half-open wooden shutters
        const sh = boxMM(op.cx - op.w / 2 - 0.02, op.sill, z - 0.3, op.cx - op.w * 0.05, op.sill + op.hs, z - 0.26);
        K.add(sh, 'woodDark');
      }
    }
  }
  return { top, openings };
}

// ---------------------------------------------------------------------------
// Horseshoe arcade with red/cream voussoirs on piers (right side of reference)
// ---------------------------------------------------------------------------
export function arcade(K, o) {
  const { x0, x1, z, y0 = 0, span = 2.4, pierW = 0.7, pierD = 0.7, hs = 2.6, upper = 2.2, mat = 'plasterPeach', galleryDepth = 3.2 } = o;
  const bays = Math.max(1, Math.round((x1 - x0 - pierW) / (span + pierW)));
  const step = (x1 - x0 - pierW) / bays;
  const sp = step - pierW;
  const archTop = y0 + hs + sp * 0.62;
  const top = archTop + upper;
  // spandrel wall with arched holes
  const openings = [];
  for (let i = 0; i < bays; i++) openings.push({ kind: 'horseshoe', cx: x0 + pierW + i * step + sp / 2, sill: y0, w: sp, hs, rise: sp * 0.5, noInterior: true });
  wallWithOpenings(K, { x0, x1, y0, y1: top, z, depth: pierD, mat, openings, interior: false });
  for (const op of openings) {
    voussoirs(K, { kind: 'horseshoe', cx: op.cx, sill: y0, w: sp, hs, band: 0.34, depth: pierD + 0.08, z: z + 0.04, n: 15 });
  }
  // capitals & bases on piers
  for (let i = 0; i <= bays; i++) {
    const px = x0 + i * step + pierW / 2;
    const cap = boxMM(px - pierW / 2 - 0.08, y0 + hs - 0.05, z - pierD - 0.05, px + pierW / 2 + 0.08, y0 + hs + 0.18, z + 0.1, { round: 0.02 });
    K.add(cap, 'limestone');
    const cap2 = boxMM(px - pierW / 2 - 0.03, y0 + hs - 0.22, z - pierD, px + pierW / 2 + 0.03, y0 + hs - 0.05, z + 0.05);
    K.add(cap2, 'limestone');
    const base = boxMM(px - pierW / 2 - 0.06, y0, z - pierD - 0.04, px + pierW / 2 + 0.06, y0 + 0.3, z + 0.08);
    shadeByHeight(base, { base: y0, grime: 0.3, grimeAmt: 0.3 });
    K.add(base, 'sandstone');
  }
  cornice(K, { x0: x0 - 0.1, x1: x1 + 0.1, y: top - 0.32, z: z + 0.02, profile: 'heavy', mat: 'limestone', scale: 0.8 });
  // gallery behind: dark back wall with doors, ceiling
  const back = boxMM(x0, y0, z - pierD - galleryDepth - 0.3, x1, top, z - pierD - galleryDepth);
  shadeByHeight(back, { base: y0, grime: 1.2, grimeAmt: 0.45, tint: 0x9a9a9a });
  K.add(back, 'plasterOchre');
  const ceil = boxMM(x0, archTop + 0.15, z - pierD - galleryDepth, x1, archTop + 0.3, z - pierD);
  setColor(ceil, 0x777777);
  K.add(ceil, 'woodDark');
  const floor = boxMM(x0, y0 - 0.1, z - pierD - galleryDepth, x1, y0 + 0.02, z - pierD);
  K.add(floor, 'limestone', null, { cast: false });
  return { top, bays, step, sp };
}

// ---------------------------------------------------------------------------
// Dome with drum, glazed onion cap and golden finial
// ---------------------------------------------------------------------------
export function dome(K, { x, y, z, r = 5, drumH = 3, onion = 0.25, windows = 8 }) {
  if (Overrides.has('dome')) return Overrides.place(K, 'dome', mat4(x, y, z, 0, 0, 0, r / 5));
  // drum
  const drumG = new THREE.CylinderGeometry(r * 1.02, r * 1.05, drumH, 40, 1, true);
  drumG.translate(x, y + drumH / 2, z);
  const du = worldUV(drumG); shadeByHeight(du, { base: y, grime: 1.5, grimeAmt: 0.35 });
  K.add(du, 'plasterWhite');
  // drum windows (dark pointed slits as slabs) + pilasters
  const wk = Math.min(1, drumH / 3.2), ww = Math.min(0.7, (Math.PI * 2 * r / windows) * 0.32);
  for (let i = 0; i < windows; i++) {
    const a = (i / windows) * Math.PI * 2;
    const wx = x + Math.cos(a) * r * 1.03, wz = z + Math.sin(a) * r * 1.03;
    const pts = archOutline('pointed', ww, 1.2 * wk, 0.5 * wk * ww / 0.7);
    const s = new THREE.Shape(); s.moveTo(-ww / 2, 0); pts.forEach((v) => s.lineTo(v.x, v.y)); s.lineTo(ww / 2, 0);
    const g = extrude(s, 0.08); g.translate(0, y + 0.6 * wk, 0);
    g.applyMatrix4(mat4(wx, 0, wz, 0, -a + Math.PI / 2, 0));
    setColor(g, 0xffffff);
    K.add(g, 'darkInterior', null, { cast: false });
    const pil = boxMM(-0.12, y, -0.1, 0.12, y + drumH, 0.12);
    const a2 = a + Math.PI / windows;
    pil.applyMatrix4(mat4(x + Math.cos(a2) * r * 1.04, 0, z + Math.sin(a2) * r * 1.04, 0, -a2 + Math.PI / 2, 0));
    K.add(pil, 'limestone');
  }
  // ring cornice
  const ring = new THREE.TorusGeometry(r * 1.07, 0.18, 8, 48); ring.rotateX(Math.PI / 2); ring.translate(x, y + drumH, z);
  K.add(worldUV(ring), 'limestone');
  // onion profile
  const prof = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const ang = t * Math.PI / 2;
    let rr = Math.cos(ang) * r * (1 + onion * Math.sin(t * Math.PI) * 0.9);
    let hh = Math.sin(ang) * r * (1 + onion * 0.8);
    if (t > 0.8) { const k = (t - 0.8) / 0.2; rr *= 1 - k * 0.15; hh += k * r * onion * 0.6; }
    prof.push(new THREE.Vector2(Math.max(rr, 0.02), hh));
  }
  const dg = lathe(prof, 48);
  dg.translate(x, y + drumH, z);
  // uvs: u around, v up (metres)
  const pos = dg.attributes.position; const uv = dg.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const ang = Math.atan2(pos.getZ(i) - z, pos.getX(i) - x);
    uv.setXY(i, (ang / (Math.PI * 2)) * r * 6.28 / 1.0, (pos.getY(i) - y - drumH) * 1.2);
  }
  dg.computeVertexNormals();
  shadeByHeight(dg, { base: y + drumH, grime: r * 0.5, grimeAmt: 0.15 });
  K.add(dg, 'domeGlaze');
  // gilded ribs running up the onion and a band at its base
  const ribs = 12;
  for (let i = 0; i < ribs; i++) {
    const a = (i / ribs) * Math.PI * 2 + Math.PI / ribs;
    const pts = [];
    for (let k = 2; k <= N - 2; k += 2) pts.push(new THREE.Vector3(x + Math.cos(a) * (prof[k].x + r * 0.008), y + drumH + prof[k].y, z + Math.sin(a) * (prof[k].x + r * 0.008)));
    K.add(worldUV(tube(pts, r * 0.011, 28, 5)), 'goldLeaf', null, { cast: false });
  }
  const bandK = 3, bandG = new THREE.TorusGeometry(prof[bandK].x + r * 0.01, r * 0.022, 6, 64); bandG.rotateX(Math.PI / 2); bandG.translate(x, y + drumH + prof[bandK].y, z);
  K.add(worldUV(bandG), 'goldLeaf', null, { cast: false });
  // finial
  const topY = y + drumH + prof[N].y;
  finial(K, { x, y: topY - 0.05, z, s: r * 0.22 });
}

export function finial(K, { x, y, z, s = 1 }) {
  if (Overrides.has('finial')) return Overrides.place(K, 'finial', mat4(x, y, z, 0, 0, 0, s));
  const p = [[0.001, 0], [0.12, 0], [0.12, 0.3], [0.06, 0.35], [0.06, 0.5], [0.22, 0.62], [0.24, 0.72], [0.2, 0.82], [0.05, 0.9], [0.05, 1.0], [0.16, 1.1], [0.17, 1.2], [0.13, 1.28], [0.04, 1.34], [0.04, 1.45], [0.1, 1.52], [0.1, 1.6], [0.03, 1.66], [0.01, 2.1], [0.001, 2.2]];
  const g = lathe(p.map(([a, b]) => new THREE.Vector2(a * s, b * s)), 20);
  g.translate(x, y, z);
  K.add(worldUV(g), 'goldLeaf');
}

// ---------------------------------------------------------------------------
// Minaret: square shaft, balcony with merlons, lantern stage, small dome, finial
// ---------------------------------------------------------------------------
export function minaret(K, { x, z, y = 0, w = 3.2, h = 22, mat = 'sandstone', top = 'dome' }) {
  const hw = w / 2;
  const shaft = boxMM(x - hw, y, z - hw, x + hw, y + h, z + hw);
  shadeByHeight(shaft, { base: y, grime: 3, grimeAmt: 0.25 });
  K.add(shaft, mat);
  // decorative blind arches on the shaft faces (front & sides)
  for (const [nx, nz, rot] of [[0, 1, 0], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
    for (const [yy, kw] of [[h * 0.45, 0.9], [h * 0.68, 0.7]]) {
      const pts = archOutline('horseshoe', kw * w * 0.5, 1.4, 0.6);
      const s = new THREE.Shape(); s.moveTo(-kw * w * 0.25, 0); pts.forEach((v) => s.lineTo(v.x, v.y)); s.lineTo(kw * w * 0.25, 0);
      const g = extrude(s, 0.06); g.translate(0, y + yy, 0);
      g.applyMatrix4(mat4(x + nx * (hw + 0.01), 0, z + nz * (hw + 0.01), 0, rot, 0));
      setColor(g, 0x9aa4a8);
      K.add(worldUV(g), 'zellige', null, { cast: false });
      const fr = extrude(frameShape('horseshoe', kw * w * 0.5, 1.4, 0.6, 0.12), 0.1); fr.translate(0, y + yy, 0);
      fr.applyMatrix4(mat4(x + nx * (hw + 0.03), 0, z + nz * (hw + 0.03), 0, rot, 0));
      K.add(worldUV(fr), 'limestone');
    }
  }
  for (const yy of [h * 0.33, h * 0.62, h * 0.9]) {
    const band = boxMM(x - hw - 0.08, y + yy, z - hw - 0.08, x + hw + 0.08, y + yy + 0.22, z + hw + 0.08);
    K.add(band, 'limestone');
  }
  // balcony
  const by = y + h;
  const bal = boxMM(x - hw - 0.55, by, z - hw - 0.55, x + hw + 0.55, by + 0.35, z + hw + 0.55);
  K.add(bal, 'limestone');
  for (const [ax, az, ro] of [[0, hw + 0.55, 0], [0, -hw - 0.55, Math.PI], [hw + 0.55, 0, Math.PI / 2], [-hw - 0.55, 0, -Math.PI / 2]]) {
    const n = 5; const segW = (w + 1.1) / n;
    for (let i = 0; i < n; i++) {
      const s = new THREE.Shape(); const mw = segW * 0.6, mh = 0.6;
      s.moveTo(0, 0); s.lineTo(mw, 0); s.lineTo(mw, mh * 0.6); s.lineTo(mw * 0.5, mh); s.lineTo(0, mh * 0.6); s.lineTo(0, 0);
      const g = extrude(s, 0.18); g.translate(-(w + 1.1) / 2 + i * segW + (segW - mw) / 2, by + 0.35, -0.09);
      g.applyMatrix4(mat4(x + ax, 0, z + az, 0, ro, 0));
      K.add(worldUV(g), 'plasterCream');
    }
  }
  // lantern stage
  const lw = w * 0.62, lh = h * 0.2;
  const stage = boxMM(x - lw / 2, by + 0.35, z - lw / 2, x + lw / 2, by + 0.35 + lh, z + lw / 2);
  K.add(stage, mat);
  for (const [nx, nz, rot] of [[0, 1, 0], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2], [0, -1, Math.PI]]) {
    const pts = archOutline('pointed', lw * 0.45, lh * 0.45, lw * 0.3);
    const s = new THREE.Shape(); s.moveTo(-lw * 0.225, 0); pts.forEach((v) => s.lineTo(v.x, v.y)); s.lineTo(lw * 0.225, 0);
    const g = extrude(s, 0.05); g.translate(0, by + 0.35 + lh * 0.15, 0);
    g.applyMatrix4(mat4(x + nx * (lw / 2 + 0.01), 0, z + nz * (lw / 2 + 0.01), 0, rot, 0));
    setColor(g, 0xffffff);
    K.add(g, 'darkInterior', null, { cast: false });
  }
  const cap = boxMM(x - lw / 2 - 0.2, by + 0.35 + lh, z - lw / 2 - 0.2, x + lw / 2 + 0.2, by + 0.6 + lh, z + lw / 2 + 0.2);
  K.add(cap, 'limestone');
  const topY = by + 0.6 + lh;
  if (top === 'dome') {
    const prof = []; const R = lw * 0.5;
    for (let i = 0; i <= 16; i++) { const t = i / 16; const a = t * Math.PI / 2; prof.push(new THREE.Vector2(Math.max(0.02, Math.cos(a) * R * (1 + 0.2 * Math.sin(t * Math.PI))), Math.sin(a) * R * 1.25)); }
    const dg = lathe(prof, 24); dg.translate(x, topY, z);
    K.add(worldUV(dg), 'domeGlaze');
    finial(K, { x, y: topY + R * 1.2, z, s: 1.1 });
  } else {
    const pyr = new THREE.ConeGeometry(lw * 0.72, lh * 0.9, 4); pyr.rotateY(Math.PI / 4); pyr.translate(x, topY + lh * 0.45, z);
    K.add(worldUV(pyr), 'domeGlaze');
    finial(K, { x, y: topY + lh * 0.85, z, s: 1.0 });
  }
  return { top: topY, lampY: by + 0.35 + lh * 0.4 };
}
