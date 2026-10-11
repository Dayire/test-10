import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { farEligible } from '../render/materials.js';

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

// Geometric detail of the builders. The chapter loader sets `lite` for the build on the low tier (its triangle
// budget, FULL_GAME §8.5): curves take about half the segments, bevels under 3 cm become plain edges, tubes and
// lathes go coarser. Colliders are separate, so nothing about play changes; a tier change mid-chapter keeps the
// geometry the chapter was built with (like the texture scale).
export const DETAIL = { lite: false };
export function setDetail(lite) { DETAIL.lite = !!lite; }
const lite = (n, min) => (DETAIL.lite ? Math.max(min, Math.round(n / 2)) : n);

// Sizes are taken as magnitudes: a reversed extent (boxMM with x1 < x0) would mirror the box and wind every face inward.
export function box(w, h, d, { round = 0, seg = 2 } = {}) {
  w = Math.abs(w); h = Math.abs(h); d = Math.abs(d);
  if (DETAIL.lite && round > 0 && round < 0.03) round = 0;
  const g = round > 0 ? new RoundedBoxGeometry(w, h, d, DETAIL.lite ? 1 : seg, round) : new THREE.BoxGeometry(w, h, d);
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
  n = lite(n, 6);
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
  n = lite(n, 8);
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
  if (DETAIL.lite) { curveSeg = lite(curveSeg, 4); bevelSeg = 1; if (bevel < 0.03) bevel = 0; }
  const g = new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: bevelSeg, curveSegments: curveSeg, steps: 1,
  });
  return g;
}

export function lathe(profile, seg = 32, phiStart = 0, phiLength = Math.PI * 2) {
  const pts = profile.map((p) => (p.isVector2 ? p : new THREE.Vector2(p[0], p[1])));
  const g = new THREE.LatheGeometry(pts, DETAIL.lite ? Math.max(8, Math.round(seg * 0.6)) : seg, phiStart, phiLength);
  return g;
}

// Parametric surface: fn(u, v, out) with u, v in [0,1]. `wrapU` welds the
// normals along the u=0 / u=1 seam of closed surfaces.
export function gridGeom(nu, nv, fn, { wrapU = false } = {}) {
  const pos = [], uv = [], idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    fn(i / nu, j / nv, p);
    pos.push(p.x, p.y, p.z); uv.push(i / nu, j / nv);
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (wrapU) {
    const n = g.attributes.normal, t = new THREE.Vector3();
    for (let j = 0; j <= nv; j++) {
      const a = j * row, b = a + nu;
      t.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, t.x, t.y, t.z); n.setXYZ(b, t.x, t.y, t.z);
    }
  }
  return g;
}

// Dense Catmull-Rom resampling of a sparse [r, y] lathe profile (each control
// segment gets the same number of samples, so short lips stay crisp).
export function smoothProfile(pts, perSeg = 4) {
  const c = new THREE.SplineCurve(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  return c.getPoints((pts.length - 1) * perSeg);
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
  return new THREE.TubeGeometry(c, lite(seg, 3), radius, DETAIL.lite ? Math.min(radial, 4) : radial, closed);
}

// ---------------------------------------------------------------------------
// Static batcher: merges geometry per material (and per x-chunk for culling)
// ---------------------------------------------------------------------------
// the main pass culls a batch by its world box, not its bounding sphere: a chunk is long, tall and deep, and its
// sphere would reach far outside the view
const _bx = new THREE.Box3();
function batchInFrustum(frustum) { return frustum.intersectsBox(_bx.copy(this.geometry.boundingBox).applyMatrix4(this.matrixWorld)); }
function castersOnly(r, o, c, sc, geo) { geo.drawRange.count = o.userData.castCount; }
function allPieces(r, o, c, sc, geo) { geo.drawRange.count = Infinity; }

export const BANDS = [[-4, 0.6], [-15, 1], [-Infinity, 2]];
// the low tier spends triangles to save draws: the street and the play plane share 1 × chunk wide batches (and a
// material's casting and non-casting pieces share one: Batcher castMerge)
export const LITE_BANDS = [[-15, 1], [-Infinity, 2]];
// Merges static geometry by material into chunks along x. The chunk width follows depth: pieces near the play
// plane (centre z > -4) merge in 0.6 × chunk wide strips, the street behind (to -15) in `chunk`, the far city in
// 2 × chunk. The view is narrow at the play plane and wide in the distance, so this draws what the camera sees with
// few extra triangles: about 30 % fewer per frame in Chapter I for some ten more draws.
// far: the low tier's far set. Geometry added with set: 'far' (the distant city) of a plain opaque material joins
// one palette material (Materials.farSet): one draw per chunk instead of one per material, its own colours kept.
export class Batcher {
  // bands: [z limit, chunk width factor] from the play plane back (a piece's band is the first whose limit its
  // centre lies in front of)
  // castMerge: casting and non-casting pieces of a material share a batch (low: fewer draws for a few more triangles)
  constructor(materials, { chunk = 36, far = false, bands = BANDS, castMerge = false } = {}) {
    this.mats = materials;
    this.chunk = chunk;
    this.bands = bands;
    this.castMerge = castMerge;
    this.far = far && typeof materials.farSet === 'function';
    this.groups = new Map();
  }

  add(geo, matName, matrix = null, { cast = true, receive = true, chunkX = null, set = null } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    if (!g.attributes.uv) worldUV(g);
    let mat = typeof matName === 'string' ? this.mats.get(matName) : matName;
    if (!g.attributes.color || mat.vertexColors === false) setColor(g, 0xffffff);
    const pal = set === 'far' && this.far && farEligible(mat) ? this.mats.paletteIndex(mat) : -1;
    if (pal >= 0) {
      mat = this.mats.farSet(); cast = false; // the low tier's shadow reach culls the far city's shadows anyway
      g.setAttribute('pal', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(pal), 1));
    }
    const needsSway = mat.defines && mat.defines.USE_WIND !== undefined;
    if (needsSway && !g.attributes.sway) setSway(g, () => 0);
    // strip attributes not shared by all
    for (const k of Object.keys(g.attributes)) {
      if (!['position', 'normal', 'uv', 'color', 'sway', 'pal'].includes(k)) g.deleteAttribute(k);
    }
    if (!needsSway && g.attributes.sway) g.deleteAttribute('sway');
    g.morphAttributes = {};
    g.clearGroups();
    g.computeBoundingBox();
    const cx = chunkX ?? (g.boundingBox.min.x + g.boundingBox.max.x) / 2, cz = (g.boundingBox.min.z + g.boundingBox.max.z) / 2;
    let band = 0;
    while (band < this.bands.length - 1 && cz <= this.bands[band][0]) band++;
    const ck = Math.floor(cx / (this.chunk * this.bands[band][1]));
    // with castMerge, casting and non-casting pieces share a batch (casters first; see build)
    const key = `${mat.uuid}|${this.castMerge ? '' : cast ? 1 : 0}${receive ? 1 : 0}|${band}|${ck}`;
    if (!this.groups.has(key)) this.groups.set(key, { mat, receive, band, geos: [], cast: [] });
    const grp = this.groups.get(key);
    grp.geos.push(g); grp.cast.push(!!cast);
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
      // the casting pieces first: a batch with both (castMerge) casts only its first castCount vertices (its own
      // shadow draws and the merged shadow proxies), one draw in the main pass instead of two
      const casters = grp.geos.filter((_, i) => grp.cast[i]), others = grp.geos.filter((_, i) => !grp.cast[i]);
      const merged = mergeGeometries([...casters, ...others], false);
      if (!merged) { console.warn('merge failed', grp.mat.name); continue; }
      merged.computeBoundingSphere(); merged.computeBoundingBox();
      const mesh = new THREE.Mesh(merged, grp.mat);
      mesh.castShadow = casters.length > 0; mesh.receiveShadow = grp.receive;
      if (casters.length && others.length) {
        mesh.userData.castCount = casters.reduce((n, g) => n + g.attributes.position.count, 0);
        mesh.onBeforeShadow = castersOnly; mesh.onAfterShadow = allPieces;
      }
      mesh.matrixAutoUpdate = false;
      mesh.intersectsFrustum = batchInFrustum;
      mesh.name = `batch:${grp.mat.name}`; mesh.userData.band = grp.band;
      parent.add(mesh);
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}

// One mesh per material for the pieces of a moving prop: a group's direct child meshes that keep their place in it
// (an entity that animates only the group: a rope ladder's ropes and rungs, a drawbridge's planks) merge into one
// draw per material and shadow flags, in the group's own space, so the group's animation moves them as before.
// Returns the number of draws saved.
export function mergeChildren(group) {
  const sets = new Map();
  for (const o of group.children) {
    if (!o.isMesh || o.isSkinnedMesh || o.isInstancedMesh || o.isBatchedMesh || Array.isArray(o.material) || o.children.length || o.morphTargetInfluences || o.customDepthMaterial) continue;
    const g = o.geometry;
    const key = [o.material.uuid, o.castShadow, o.receiveShadow, o.layers.mask, o.renderOrder, o.visible, o.frustumCulled, !!g.index, Object.keys(g.attributes).sort().join()].join('|');
    if (!sets.has(key)) sets.set(key, []);
    sets.get(key).push(o);
  }
  let saved = 0;
  for (const list of sets.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => { if (o.matrixAutoUpdate) o.updateMatrix(); return o.geometry.clone().applyMatrix4(o.matrix); });
    const merged = mergeGeometries(geos, false);
    for (const g of geos) g.dispose();
    if (!merged) continue;
    const a = list[0], m = new THREE.Mesh(merged, a.material);
    m.name = `${group.name || 'group'}:${a.material.name || 'part'}`;
    m.castShadow = a.castShadow; m.receiveShadow = a.receiveShadow; m.layers.mask = a.layers.mask; m.renderOrder = a.renderOrder; m.frustumCulled = a.frustumCulled;
    group.add(m);
    for (const o of list) { o.removeFromParent(); o.geometry.dispose(); }
    saved += list.length - 1;
  }
  return saved;
}
