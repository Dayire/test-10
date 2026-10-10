import * as THREE from 'three';

// Shadow-map scheduling, merged static casters and caster culling.
//  - low / medium refresh the sun's map at 30 Hz (time based) and shadowed spots at 15 Hz, on frames the sun
//    skips where the frame rate allows; everything refreshes at once after a camera snap or invalidate();
//  - shadowed spot lights whose lit cone (down to the ground it lights) is off-screen, or dark, keep their old map;
//  - static level batches cast through merged proxies: positions only (16-bit, per tile), one draw per tile of
//    TX metres × depth band instead of one per material and chunk, drawn by the shadow passes only: the same
//    maps. A root's proxies are built when it arrives, later changes a few milliseconds per frame. In the sun's
//    pass a proxy also needs its shadow to land in view (no visible change), and on low / medium to land within
//    `reach` metres behind the play plane along the current sun;
//  - small-caster cull (low / medium): other static casters under 0.4 m tall, or more than 30 m behind the play
//    plane, stop casting, and so do meshes flagged userData.smallCaster (the flock). Moving meshes (characters,
//    crates, levers) are never culled: a caster must keep the same world matrix over two scans to count as static.
// The policy only ever restores the castShadow values it changed itself: a flag another package changes is
// taken as the authored value from then on.
export const SHADOW_PASS = { on: false, sun: null };
const TX = 12, BANDS = [-10, -20, -35, -60];
// scratch for the proxy build: world positions, vertex triples, tiles
let _W = new Float32Array(0), _P = _W, _I = new Uint32Array(0), _K = new Int32Array(0), _side = 1;
const IDENTITY = new THREE.Matrix4();
const bandOf = (z) => { let i = 0; while (i < BANDS.length && z < BANDS[i]) i++; return i; };
const _b = new THREE.Box3(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Vector3();
const SPOT_HZ = 15;
// one material for every proxy: front faces, so the depth pass draws back faces as three does for opaque meshes
const PROXY_MAT = new THREE.MeshBasicMaterial({ colorWrite: false });
PROXY_MAT.name = 'shadowProxy';
// a proxy is invisible to every pass but the shadow pass (both cull through intersectsFrustum); in the sun's pass
// (SHADOW_PASS.sun is its frustum) it also needs userData.sun. Tested against its world box: tiles are tall and
// thin, a bounding sphere would overhang far below the ground into a spot's frustum
function proxyInFrustum(frustum) { return SHADOW_PASS.on && (frustum !== SHADOW_PASS.sun || this.userData.sun) && frustum.intersectsBox(this.userData.box); }

const NO_RAYCAST = () => {};
const isStaticBatch = (o) => o.userData.staticCaster === true || (o.matrixAutoUpdate === false && o.name.startsWith('batch:'));
function proxiable(o) {
  const m = o.material, g = o.geometry;
  if (!m || Array.isArray(m) || !m.visible || m.wireframe || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return false;
  if (o.userData.noProxy || o.customDepthMaterial || !isStaticBatch(o)) return false;
  if (m.alphaTest > 0 || m.alphaToCoverage || m.alphaMap || (m.displacementMap && m.displacementScale) || m.clippingPlanes?.length) return false;
  return !!g?.attributes?.position && !g.morphAttributes?.position;
}
const shownIn = (o, scene) => { for (let p = o; p && p !== scene; p = p.parent) if (!p.visible) return false; return true; };
// the chapter root a caster belongs to (the scene itself for casters added to it directly)
const rootOf = (o, scene) => { let p = o.parent; if (p === scene) return scene; while (p.parent && p.parent !== scene) p = p.parent; return p; };

// the cone from p along unit axis a, length len, base radius rb: outside the camera frustum (_fr) when its apex and
// an octagon around its base (widened to contain the circle) all lie behind one plane
const _u = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Vector3(), OCT = [...Array(8)].map((_, i) => [Math.cos(i * Math.PI / 4), Math.sin(i * Math.PI / 4)]);
function coneInView(p, a, len, rb) {
  _u.set(Math.abs(a.x) < 0.9 ? 1 : 0, Math.abs(a.x) < 0.9 ? 0 : 1, 0).cross(a).normalize(); _w.crossVectors(a, _u);
  const r = rb * 1.0824 + 0.5, b = _e.copy(p).addScaledVector(a, len);
  for (const pl of _fr.planes) {
    if (pl.distanceToPoint(p) >= -0.5) continue;
    let out = true;
    for (const [c, s] of OCT) if (pl.distanceToPoint(_q.copy(b).addScaledVector(_u, c * r).addScaledVector(_w, s * r)) >= 0) { out = false; break; }
    if (out) return false;
  }
  return true;
}

export class ShadowPolicy {
  constructor(renderer) {
    this.r = renderer;
    this.hz = 60; this.cull = false; this.reach = Infinity; this.proxies = true;
    this.force = true; this.lastUpdate = -1e9; this.lastSpot = -1e9; this.lastFrame = -1e9;
    this.camPos = new THREE.Vector3(1e9, 0, 0); this.camDir = new THREE.Vector3();
    this.meta = new WeakMap(); // mesh → { cast (authored), set (last value written here), small, fp, stable, proxied }
    this.tracked = [];
    this.scene = null; this.kids = []; this.nextScan = 0;
    this.spots = new WeakMap(); // spot light → 'off' (cone unseen) | 'sched' (refreshed on this policy's clock)
    this.lights = []; this.suns = [];
    this.roots = new Map(); // chapter root → { sig, sources, meshes }
    this.jobs = new Map(); this.building = false; this.buildBudget = 4; // ms of proxy building per frame
    this.group = new THREE.Group(); this.group.name = 'shadowProxies'; this.group.userData.shadowProxy = true;
    this.stats = { updates: 0, spotUpdates: 0, skipped: 0, culled: 0, spotsSkipped: 0, snaps: 0, proxies: 0, proxyTris: 0, proxied: 0, reachCulled: 0, viewCulled: 0, buildMs: 0, building: 0 };
    this.wrap();
  }
  // the shadow pass is the only one that sees the proxies. A restored context brings a new shadowMap object, so
  // this is checked every frame
  wrap() {
    const sm = this.r.shadowMap;
    if (!sm || sm === this.sm) return;
    const render = sm.render;
    sm.render = function (...a) { SHADOW_PASS.on = true; try { return render.apply(this, a); } finally { SHADOW_PASS.on = false; } };
    this.sm = sm;
  }
  configure({ shadowHz = 60, smallCull = false, shadowReach = Infinity } = {}) {
    this.hz = shadowHz; this.reach = shadowReach;
    if (this.cull !== smallCull) { this.cull = smallCull; this.apply(); }
    this.force = true;
  }
  invalidate() { this.force = true; }
  // after a lost context the proxies' GPU buffers are gone (their arrays were freed after upload): drop them, the
  // next frame merges again
  reset() { for (const R of this.roots.values()) this.dropRoot(R); this.roots.clear(); this.jobs.clear(); this.building = false; this.scene = null; this.force = true; this.countProxies(); }
  // merged static casters on or off (tests, debugging); sync builds them now instead of a few ms per frame
  setProxies(on, { sync = false } = {}) {
    this.proxies = !!on;
    if (!on) { for (const R of this.roots.values()) this.dropRoot(R); this.roots.clear(); this.jobs.clear(); this.building = false; this.countProxies(); }
    if (this.scene) { this.scan(this.scene, performance.now()); if (sync) this.runJobs(Infinity); }
    this.force = true;
  }

  _set(o, m, c) { m.set = c; if (o.castShadow !== c) { o.castShadow = c; this.force = true; } }
  scan(scene, now) {
    const seen = [], lights = [], suns = [], sources = new Map();
    scene.traverse((o) => {
      if (o.userData.shadowProxy) return;
      if (o.isLight) { if (o.castShadow && o.isSpotLight) lights.push(o); else if (o.castShadow && o.isDirectionalLight) suns.push(o); return; }
      if (!o.isMesh || ((o.isInstancedMesh || o.isSkinnedMesh) && !o.userData.smallCaster)) return;
      let m = this.meta.get(o);
      if (!m) {
        if (!o.castShadow) return; // only ever touch meshes that were authored as casters
        m = { cast: true, set: undefined, small: false, fp: NaN, stable: 0, proxied: false };
        this.meta.set(o, m);
      }
      // the flag is authored unless this policy wrote it, and so is any change made since it last wrote it
      if (m.set === undefined || o.castShadow !== m.set) { m.cast = o.castShadow; m.set = undefined; }
      if (this.proxies && m.cast && proxiable(o)) {
        const root = rootOf(o, scene);
        let list = sources.get(root); if (!list) sources.set(root, list = []);
        list.push(o);
        if (m.proxied && o.castShadow) this._set(o, m, false); // its proxy casts for it
        return;
      }
      if (m.proxied) { m.proxied = false; this._set(o, m, m.cast); }
      if (o.userData.smallCaster) { m.small = true; seen.push(o); return; }
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const e = o.matrixWorld.elements, fp = e[12] * 1.31 + e[13] * 7.7 + e[14] * 3.3 + e[0] + e[5] * 2 + e[10] * 3 + e[1] * 5 + e[4] * 7;
      m.stable = fp === m.fp ? m.stable + 1 : 0;
      m.fp = fp;
      _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      m.small = (m.stable >= 1 || !o.matrixAutoUpdate) && (_b.max.y - _b.min.y < 0.4 || _b.max.z < -30);
      seen.push(o);
    });
    this.tracked = seen; this.lights = lights; this.suns = suns;
    this.kids = scene.children.slice(); this.scene = scene;
    this.nextScan = now + 1000;
    this.syncProxies(scene, sources);
    this.apply();
  }
  apply() {
    let n = 0;
    for (const o of this.tracked) {
      const m = this.meta.get(o);
      const c = m.cast && !(this.cull && m.small);
      if (m.cast && !c) n++;
      if (o.castShadow !== c) this._set(o, m, c);
      else if (c === m.cast) m.set = undefined; // nothing of ours left to restore
    }
    this.stats.culled = n;
  }

  // ---- merged static casters (built a few milliseconds per frame; until a root's proxies are ready its batches
  // cast as authored)
  syncProxies(scene, sources) {
    if (this.group.parent !== scene) scene.add(this.group);
    for (const [root, R] of this.roots) if (!sources.has(root)) { this.dropRoot(R); this.roots.delete(root); }
    for (const root of this.jobs.keys()) if (!sources.has(root)) this.jobs.delete(root);
    for (const [root, list] of sources) {
      let h = 0;
      for (const o of list) h = (h * 31 + o.id * (shownIn(o, root) ? 2 : 1)) % 2147483647;
      const sig = `${list.length}:${h}`, R = this.roots.get(root), J = this.jobs.get(root);
      if ((R && R.sig === sig) || (J && J.sig === sig)) continue;
      if (R) { this.dropRoot(R); this.roots.delete(root); }
      this.jobs.set(root, { sig, ms: 0, it: this.buildJob(root, list, sig) });
    }
    this.building = this.jobs.size > 0;
    this.countProxies();
  }
  runJobs(budget) {
    if (!this.jobs.size) return;
    const t0 = performance.now();
    for (const [root, J] of this.jobs) {
      let done = false;
      while (performance.now() - t0 < budget) {
        const s = performance.now(), r = J.it.next();
        J.ms += performance.now() - s;
        if (r.done) { this.roots.set(root, r.value); this.jobs.delete(root); this.stats.buildMs = +J.ms.toFixed(1); done = true; break; }
      }
      if (!done) break;
    }
    this.building = this.jobs.size > 0;
    this.countProxies();
  }
  countProxies() {
    let n = 0, tris = 0, src = 0;
    for (const R of this.roots.values()) { n += R.meshes.length; src += R.sources.length; for (const p of R.meshes) tris += p.userData.tris; }
    this.stats.proxies = n; this.stats.proxyTris = tris; this.stats.proxied = src; this.stats.building = this.jobs.size;
  }
  dropRoot(R) {
    for (const p of R.meshes) { p.removeFromParent(); p.geometry.dispose(); }
    for (const o of R.sources) {
      const m = this.meta.get(o);
      if (m && m.proxied) { m.proxied = false; this._set(o, m, m.cast); }
    }
    R.meshes.length = 0; R.sources.length = 0;
  }
  *buildJob(root, list, sig) {
    const slots = new Array(2048), used = [];
    // pass 1: world positions and a tile per triangle (x / TX and a depth band), triangle counts and bounds per tile
    for (const o of list) {
      if (!shownIn(o, root)) continue;
      used.push(o);
      yield;
      const n = this.prep(o), W = _P, I = _I, K = _K, step = _side === 2 ? 2 : 1;
      for (let t = 0; t < n; t++) {
        let T = slots[K[t]];
        if (!T) T = slots[K[t]] = { n: 0, b: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity], w: 0, a: null, c: null, s: 1 };
        T.n += step;
        const b = T.b;
        for (let j = t * 3; j < t * 3 + 3; j++) {
          const v = I[j] * 3, x = W[v], y = W[v + 1], z = W[v + 2];
          if (x < b[0]) b[0] = x; if (x > b[3]) b[3] = x;
          if (y < b[1]) b[1] = y; if (y > b[4]) b[4] = y;
          if (z < b[2]) b[2] = z; if (z > b[5]) b[5] = z;
        }
      }
    }
    const tiles = new Map();
    slots.forEach((T, k) => {
      const b = T.b;
      T.c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      T.s = Math.max(1e-3, b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 * 1.0001;
      T.a = new Int16Array(T.n * 9);
      tiles.set(k, T);
    });
    // pass 2: 16-bit positions around each tile's centre (one uniform scale, truncated: under a millimetre)
    for (const o of used) {
      yield;
      const n = this.prep(o), side = _side, W = _P, I = _I, K = _K;
      for (let t = 0; t < n; t++) {
        const T = slots[K[t]], a = T.a, cx = T.c[0], cy = T.c[1], cz = T.c[2], f = 32767 / T.s;
        let w = T.w;
        for (let r = 0; r < 2; r++) {
          if (r === 0 ? side === -1 : side === 1) continue;
          for (let k = 0; k < 3; k++) {
            const v = I[t * 3 + (r === 0 ? k : (3 - k) % 3)] * 3;
            a[w] = (W[v] - cx) * f; a[w + 1] = (W[v + 1] - cy) * f; a[w + 2] = (W[v + 2] - cz) * f; // truncated: < 1 mm
            w += 3;
          }
        }
        T.w = w;
      }
    }
    const meshes = [];
    for (const [k, T] of tiles) {
      const g = new THREE.BufferGeometry(), b = T.b;
      const attr = new THREE.BufferAttribute(T.a, 3, true);
      attr.onUpload(function () { this.array = null; }); // the GPU keeps the only copy
      g.setAttribute('position', attr);
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 / T.s);
      g.boundingBox = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
      const p = new THREE.Mesh(g, PROXY_MAT);
      p.name = `shadowProxy:${(k >> 3) - 128}|${k & 7}`;
      p.userData.shadowProxy = true; p.userData.tris = T.n; p.userData.root = root;
      p.userData.box = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
      p.userData.front = b[5]; p.userData.top = b[4]; p.userData.radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2; p.userData.sun = true;
      p.position.set(T.c[0], T.c[1], T.c[2]); p.scale.setScalar(T.s);
      p.castShadow = true; p.receiveShadow = false;
      p.intersectsFrustum = proxyInFrustum; p.raycast = NO_RAYCAST;
      p.updateMatrix(); p.matrixAutoUpdate = false;
      this.group.add(p); p.updateMatrixWorld(true);
      meshes.push(p);
    }
    for (const o of used) { const m = this.meta.get(o); m.proxied = true; this._set(o, m, false); }
    this.force = true;
    return { sig, sources: used, meshes };
  }
  // a source's world-space vertices (_P: its own array, or _W), the vertex triple of each triangle (_I) and its tile
  // (_K); _side: 1 front faces as authored, -1 reversed, 2 both. Returns the triangle count.
  prep(o) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index, e = o.matrixWorld.elements, nv = pos.count;
    const m = o.material, eff = m.shadowSide ?? (m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
    _side = eff === THREE.DoubleSide ? 2 : eff === THREE.BackSide ? 1 : -1;
    const plain = !pos.isInterleavedBufferAttribute && !pos.normalized && pos.itemSize === 3, a = pos.array;
    // batches sit at the origin: their own positions are world positions
    if (plain && o.matrixWorld.equals(IDENTITY)) _P = a;
    else {
      if (_W.length < nv * 3) _W = new Float32Array(Math.ceil(nv * 3 * 1.25));
      for (let v = 0; v < nv; v++) {
        const x = plain ? a[v * 3] : pos.getX(v), y = plain ? a[v * 3 + 1] : pos.getY(v), z = plain ? a[v * 3 + 2] : pos.getZ(v);
        _W[v * 3] = e[0] * x + e[4] * y + e[8] * z + e[12];
        _W[v * 3 + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
        _W[v * 3 + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
      }
      _P = _W;
    }
    const W = _P;
    const total = idx ? idx.count : nv, dr = g.drawRange, s0 = Math.max(0, dr.start), s1 = Math.min(total, dr.start + dr.count);
    const n = Math.max(0, Math.floor((s1 - s0) / 3));
    if (_K.length < n) { _K = new Int32Array(Math.ceil(n * 1.25)); _I = new Uint32Array(_K.length * 3); }
    const ia = idx ? idx.array : null;
    for (let t = 0; t < n; t++) {
      const i = s0 + t * 3, v0 = ia ? ia[i] : i, v1 = ia ? ia[i + 1] : i + 1, v2 = ia ? ia[i + 2] : i + 2;
      _I[t * 3] = v0; _I[t * 3 + 1] = v1; _I[t * 3 + 2] = v2;
      const cx = (W[v0 * 3] + W[v1 * 3] + W[v2 * 3]) / 3, cz = (W[v0 * 3 + 2] + W[v1 * 3 + 2] + W[v2 * 3 + 2]) / 3;
      _K[t] = (Math.min(255, Math.max(0, Math.floor(cx / TX) + 128)) << 3) | bandOf(cz);
    }
    return n;
  }
  // per frame: a proxy casts while its chapter root is shown. Into the sun's map only while its shadow can land in
  // view: its bounding sphere swept along the light down to below the ground must meet the camera's frustum (no
  // visible change on any tier), and on low / medium while that shadow can reach within `reach` metres behind the
  // play plane from the proxy's front top edge
  proxyPolicy(scene) {
    const L = this.suns[0];
    SHADOW_PASS.sun = L ? L.shadow.getFrustum() : null;
    if (!this.roots.size) return;
    let k = 0, len = 0;
    if (L) {
      _d.subVectors(L.position, L.target.position).normalize();
      k = _d.z < 0 ? -_d.z / Math.max(_d.y, 0.05) : 0;
    }
    let reachCulled = 0, viewCulled = 0;
    for (const R of this.roots.values()) {
      for (const p of R.meshes) {
        const root = p.userData.root, shown = root === scene || (root.visible && root.parent === scene);
        if (p.visible !== shown) { p.visible = shown; this.force = true; }
        let sun = shown;
        if (sun && this.reach < Infinity && p.userData.front + Math.max(0, p.userData.top) * k < -this.reach) { sun = false; reachCulled++; }
        if (sun && L) {
          const c = _v.setFromMatrixPosition(p.matrixWorld), r = p.userData.radius + 3;
          len = _d.y > 0.02 ? Math.min(400, (c.y + r + 20) / _d.y) : 400;
          _e.copy(c).addScaledVector(_d, -len);
          for (const pl of _fr.planes) if (pl.distanceToPoint(c) < -r && pl.distanceToPoint(_e) < -r) { sun = false; viewCulled++; break; }
        }
        if (p.userData.sun !== sun) { p.userData.sun = sun; this.force = true; }
      }
    }
    this.stats.reachCulled = reachCulled; this.stats.viewCulled = viewCulled;
  }

  // per frame, before rendering the scene
  update(scene, camera, now) {
    this.wrap();
    const kids = scene.children;
    let changed = scene !== this.scene || kids.length !== this.kids.length;
    for (let i = 0; !changed && i < kids.length; i++) changed = kids[i] !== this.kids[i];
    if (changed || now > this.nextScan) this.scan(scene, now);
    // a chapter root that just arrived is merged at once (its first frame is a loader's warm-up, behind the card);
    // later changes are merged a few milliseconds per frame
    this.runJobs(changed ? Infinity : this.buildBudget);
    // camera snap: jump in position or direction since the last frame
    camera.getWorldDirection(_d);
    if (camera.position.distanceToSquared(this.camPos) > 2.25 || _d.dot(this.camDir) < 0.985) { this.force = true; this.stats.snaps++; }
    this.camPos.copy(camera.position); this.camDir.copy(_d);
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    this.proxyPolicy(scene);
    const sched = this.hz < 60;
    const visible = this.spotPolicy(camera, sched);
    const sm = this.r.shadowMap;
    if (!sched) {
      sm.autoUpdate = true; this.force = false; this.stats.updates++;
      for (const l of this.suns) l.shadow.autoUpdate = true;
      return true;
    }
    sm.autoUpdate = false;
    const force = this.force;
    const sun = force || now - this.lastUpdate >= 1000 / this.hz - 4;
    // spots: on the frames the sun skips; at 30 fps, when they fall due, with it
    // (the sun refreshes every frame once frames are as long as its period; a spot twice overdue goes anyway)
    const dt = now - this.lastFrame, since = now - this.lastSpot;
    this.lastFrame = now;
    const spot = visible.length > 0 && (force || (since >= 1000 / SPOT_HZ - 4 && (!sun || dt >= 1000 / this.hz - 4 || since >= 2000 / SPOT_HZ - 8)));
    for (const l of this.suns) { l.shadow.autoUpdate = false; if (sun) l.shadow.needsUpdate = true; }
    if (spot) { for (const l of visible) l.shadow.needsUpdate = true; this.lastSpot = now; this.stats.spotUpdates++; }
    let pending = sun || spot;
    if (!pending) for (const l of this.lights) if (l.shadow.needsUpdate) { pending = true; break; }
    if (sun) { this.lastUpdate = now; this.force = false; this.stats.updates++; }
    if (pending) { sm.needsUpdate = true; return true; }
    this.stats.skipped++;
    return false;
  }

  // shadowed spots: refreshed only while their lit cone can be seen and they are lit; on scheduled tiers
  // this policy owns their refresh (15 Hz). Returns the spots to refresh on that clock.
  spotPolicy(camera, sched) {
    const out = [];
    if (!this.lights.length) return out;
    let skipped = 0;
    for (const l of this.lights) {
      // the lit cone, up to 40 m and no deeper than 2 m below its aim point (the ground it lights stops it)
      _a.copy(l.target.position).sub(l.position).normalize();
      let len = Math.min(l.distance || 40, 40);
      if (_a.y < -0.05) len = Math.min(len, (l.position.y - l.target.position.y + 2) / -_a.y);
      // a map that was never rendered must render once: an unallocated shadow map would bind an
      // empty colour texture to the material's shadow sampler
      const visible = !l.shadow.map || (l.visible && l.intensity > 0 && coneInView(l.position, _a, len, Math.tan(l.angle) * len));
      const mine = this.spots.get(l);
      if (!visible) {
        if (l.shadow.autoUpdate) { l.shadow.autoUpdate = false; this.spots.set(l, 'off'); }
        if (mine) skipped++;
        continue;
      }
      if (sched) {
        // visible on a scheduled tier: take its refresh over unless it is a free spot nobody updates
        if (l.shadow.autoUpdate || mine) { l.shadow.autoUpdate = false; this.spots.set(l, 'sched'); out.push(l); }
      } else if (mine) { l.shadow.autoUpdate = true; l.shadow.needsUpdate = true; this.spots.delete(l); this.force = true; }
    }
    this.stats.spotsSkipped = skipped;
    return out;
  }
}
