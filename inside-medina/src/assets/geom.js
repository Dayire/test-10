import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

export const V3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _e = new THREE.Euler();

export function mat4(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _p.set(x, y, z); _s.set(sx, sy, sz);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// Deterministic PRNG so the level looks identical every run
export function rng(seed = 1) {
  let s = seed >>> 0 || 1;
  const f = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1000000) / 1000000; };
  f.range = (a, b) => a + (b - a) * f();
  f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
  return f;
}

// Box-projected UVs in metres (after the geometry has been transformed).
export function worldUV(geo, { offset = 0 } = {}) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const pos = g.attributes.position, nor = g.attributes.normal;
  if (!nor) g.computeVertexNormals();
  const n = g.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  // choose projection per triangle (dominant axis of face normal) to avoid seams inside a face
  for (let i = 0; i < pos.count; i += 3) {
    let ax = 0, ay = 0, az = 0;
    for (let k = 0; k < 3; k++) { ax += Math.abs(n.getX(i + k)); ay += Math.abs(n.getY(i + k)); az += Math.abs(n.getZ(i + k)); }
    for (let k = 0; k < 3; k++) {
      const x = pos.getX(i + k), y = pos.getY(i + k), z = pos.getZ(i + k);
      let u, v;
      if (ay >= ax && ay >= az) { u = x; v = z; }
      else if (ax >= az) { u = z; v = y; }
      else { u = x; v = y; }
      uv[(i + k) * 2] = u + offset; uv[(i + k) * 2 + 1] = v + offset * 0.7;
    }
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// Vertex colour = ambient occlusion / grime estimate from height above a base
// and optional darkening near the ground (street dirt, moisture).
export function shadeByHeight(geo, { base = 0, grime = 1.2, grimeAmt = 0.3, top = null, topAmt = 0, tint = null, seed = 0 } = {}) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const t = tint ? new THREE.Color(tint) : new THREE.Color(1, 1, 1);
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) - base;
    let k = 1 - grimeAmt * (1 - THREE.MathUtils.smoothstep(y, 0, grime));
    if (top !== null) k *= 1 - topAmt * THREE.MathUtils.smoothstep(pos.getY(i), top - 0.6, top);
    const n = seed ? 0.92 + 0.08 * Math.sin(pos.getX(i) * 1.3 + seed) * Math.sin(pos.getZ(i) * 1.7 + seed * 2.1) : 1;
    col[i * 3] = k * n * t.r; col[i * 3 + 1] = k * n * t.g; col[i * 3 + 2] = k * n * t.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}

export function setColor(geo, c) {
  const col = new THREE.Color(c);
  const n = geo.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
}

export function setSway(geo, fn) {
  const pos = geo.attributes.position;
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) a[i] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
  geo.setAttribute('sway', new THREE.BufferAttribute(a, 1));
  return geo;
}

export function box(w, h, d, { round = 0, seg = 2 } = {}) {
  const g = round > 0 ? new RoundedBoxGeometry(w, h, d, seg, round) : new THREE.BoxGeometry(w, h, d);
  return g;
}

// Box given min/max corners, UVs in world metres
export function boxMM(x0, y0, z0, x1, y1, z1, opts = {}) {
  const g = box(x1 - x0, y1 - y0, z1 - z0, opts);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  return worldUV(g, opts);
}

// Pointed (two-centred) arch outline: span w, springing height hs, apex at hs+rise.
// `grow` offsets both arcs concentrically (for frames / mouldings).
export function pointedArchPoints(w, hs, rise, n = 24, grow = 0) {
  const c = (rise * rise - (w * w) / 4) / w; // arc centre offset from the middle
  const r = c + w / 2 + grow;
  const apexY = Math.sqrt(Math.max(r * r - c * c, 1e-6));
  const pts = [];
  const aL0 = Math.PI, aL1 = Math.atan2(apexY, -c);
  for (let i = 0; i <= n; i++) {
    const a = aL0 + (aL1 - aL0) * (i / n);
    pts.push(new THREE.Vector2(c + Math.cos(a) * r, hs + Math.sin(a) * r));
  }
  const aR0 = Math.atan2(apexY, c);
  for (let i = 1; i <= n; i++) {
    const a = aR0 * (1 - i / n);
    pts.push(new THREE.Vector2(-c + Math.cos(a) * r, hs + Math.sin(a) * r));
  }
  return pts;
}

// Horseshoe arch: circle that continues below its diameter
export function horseshoePoints(w, hs, n = 32, extra = 0.35) {
  const r = w / 2;
  const pts = [];
  const a0 = Math.PI + extra, a1 = -extra;
  const cy = hs + 0; // centre height
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push(new THREE.Vector2(Math.cos(a) * r, cy + Math.sin(a) * r));
  }
  return pts;
}

// Shape of a rectangle with an arch-shaped opening (points from archPoints)
export function archOpeningShape(outerW, outerH, archPts, { baseY = 0 } = {}) {
  const s = new THREE.Shape();
  s.moveTo(-outerW / 2, baseY); s.lineTo(outerW / 2, baseY); s.lineTo(outerW / 2, outerH); s.lineTo(-outerW / 2, outerH); s.lineTo(-outerW / 2, baseY);
  const h = new THREE.Path();
  const first = archPts[0], last = archPts[archPts.length - 1];
  h.moveTo(first.x, baseY);
  archPts.forEach((p) => h.lineTo(p.x, p.y));
  h.lineTo(last.x, baseY);
  h.lineTo(first.x, baseY);
  s.holes.push(h);
  return s;
}

// Frame (ring) following an arch outline with given band width
export function archFrameShape(archPts, band, baseY = 0) {
  const outer = offsetPolyline(archPts, band);
  const s = new THREE.Shape();
  s.moveTo(outer[0].x, baseY);
  outer.forEach((p) => s.lineTo(p.x, p.y));
  s.lineTo(outer[outer.length - 1].x, baseY);
  const last = archPts[archPts.length - 1];
  s.lineTo(last.x, baseY);
  for (let i = archPts.length - 1; i >= 0; i--) s.lineTo(archPts[i].x, archPts[i].y);
  s.lineTo(archPts[0].x, baseY);
  s.lineTo(outer[0].x, baseY);
  return s;
}

export function offsetPolyline(pts, d) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    const n = new THREE.Vector2(-t.y, t.x); // left normal (outwards for our CCW-over-apex order)
    out.push(new THREE.Vector2(pts[i].x + n.x * d, pts[i].y + n.y * d));
  }
  return out;
}

export function extrude(shape, depth, { bevel = 0, bevelSeg = 2, curveSeg = 24 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg, curveSegments: curveSeg, steps: 1,
  });
  return g;
}

export function lathe(profile, seg = 32, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map((p) => (p.isVector2 ? p : new THREE.Vector2(p[0], p[1])));
  const g = new THREE.LatheGeometry(pts, seg, phiStart, phiLength);
  return g;
}

export function catenary(p0, p1, sag, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const p = new THREE.Vector3().lerpVectors(p0, p1, t);
    p.y -= sag * 4 * t * (1 - t);
    pts.push(p);
  }
  return pts;
}

export function tube(points, radius, seg = 32, radial = 6, closed = false) {
  const c = new THREE.CatmullRomCurve3(points, closed, 'centripetal');
  return new THREE.TubeGeometry(c, seg, radius, radial, closed);
}

// ---------------------------------------------------------------------------
// Static batcher: merges geometry per material (and per x-chunk for culling)
// ---------------------------------------------------------------------------
export class Batcher {
  constructor(materials, { chunk = 36 } = {}) {
    this.mats = materials;
    this.chunk = chunk;
    this.groups = new Map();
  }

  add(geo, matName, matrix = null, { cast = true, receive = true, chunkX = null } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) worldUV(g);
    if (!g.attributes.color) setColor(g, 0xffffff);
    const mat = typeof matName === 'string' ? this.mats.get(matName) : matName;
    const needsSway = mat.defines && mat.defines.USE_WIND !== undefined;
    if (needsSway && !g.attributes.sway) setSway(g, () => 0);
    // strip attributes not shared by all
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color', 'sway'].includes(k)) g.deleteAttribute(k);
    }
    if (!needsSway && g.attributes.sway) g.deleteAttribute('sway');
    g.morphAttributes = {};
    g.clearGroups();
    let cx = chunkX;
    if (cx === null) {
      g.computeBoundingBox();
      cx = (g.boundingBox.min.x + g.boundingBox.max.x) / 2;
    }
    const ck = Math.floor(cx / this.chunk);
    const key = `${mat.uuid}|${cast ? 1 : 0}${receive ? 1 : 0}|${ck}`;
    if (!this.groups.has(key)) this.groups.set(key, { mat, cast, receive, geos: [] });
    this.groups.get(key).geos.push(g);
  }

  // a kit wrapper that pre-transforms everything added through it
  kit(matrix = null) {
    const self = this;
    return {
      matrix,
      add(geo, mat, m = null, opts = {}) {
        let mm = m;
        if (matrix) mm = m ? new THREE.Matrix4().multiplyMatrices(matrix, m) : matrix;
        self.add(geo, mat, mm, opts);
      },
      with(m2) { return self.kit(matrix ? new THREE.Matrix4().multiplyMatrices(matrix, m2) : m2); },
    };
  }

  build(parent) {
    const meshes = [];
    for (const [, grp] of this.groups) {
      const merged = mergeGeometries(grp.geos, false);
      if (!merged) { console.warn('merge failed', grp.mat.name); continue; }
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, grp.mat);
      mesh.castShadow = grp.cast; mesh.receiveShadow = grp.receive;
      mesh.matrixAutoUpdate = false;
      mesh.name = `batch:${grp.mat.name}`;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}
