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
//    plane, stop casting, and so do meshes flagged userData.smallCaster (the flock); on low (alphaCasters false) so do
//    the alpha-tested static batches (ivy, lattice), whose cut-out shadows a 1024 map cannot resolve. Moving meshes (characters,
//    crates, levers) are never culled: a caster must keep its world matrix (within a 2 cm sway) over two scans to count
//    as static;
//  - settled casters: a plain caster that is not a batch (an unrolled rope ladder, a lowered drawbridge, a crate at
//    rest) and keeps its world matrix within a sway (SWAY) and its vertices over SETTLE scans casts through proxies
//    of its own (one small set per chapter root, rebuilt at once when a member moves again);
//  - in the sun's pass every other caster (characters included) also needs its shadow to land in view, as the
//    proxies do (no visible change);
//  - a shadow map's colour attachment, which three allocates beside the depth texture it samples and never reads, is
//    one byte per texel instead of four (leanMap).
// The policy only ever restores the castShadow values it changed itself: a flag another package changes is
// taken as the authored value from then on.
export const SHADOW_PASS = { on: false, sun: null, policy: null };
const TX = 12, SUB = 4, WIDE = 8, BANDS = [-10, -20, -35, -60];
// scratch for the proxy build: world positions, vertex triples, tiles and the sub-tile (TX / SUB wide) of each triangle
let _W = new Float32Array(0), _P = _W, _I = new Uint32Array(0), _K = new Int32Array(0), _S = new Uint8Array(0), _side = 1;
const IDENTITY = new THREE.Matrix4();
const bandOf = (z) => { let i = 0; while (i < BANDS.length && z < BANDS[i]) i++; return i; };
const box6 = () => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
const _b = new THREE.Box3(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _d = new THREE.Vector3(), _a = new THREE.Vector3(), _v = new THREE.Vector3(), _e = new THREE.Vector3();
const _sd = new THREE.Vector3(), _cb = new THREE.Box3(), _cs = new THREE.Sphere(); // the sun's direction (towards it); a caster's box
const SPOT_HZ = 15;
// settled casters: still for SETTLE scans (doubling after each time one moved again, up to 8×), within SWAY metres
// at every corner of its box (a hanging ladder's sway; the merged shadow keeps one pose of it)
const SETTLE = 2, SWAY = 0.1;
// one material for every proxy: front faces, so the depth pass draws back faces as three does for opaque meshes
const PROXY_MAT = new THREE.MeshBasicMaterial({ colorWrite: false });
PROXY_MAT.name = 'shadowProxy';
// a proxy is invisible to every pass but the shadow pass (both cull through intersectsFrustum); in the sun's pass
// (SHADOW_PASS.sun is its frustum) it also needs userData.sun. Tested against its world box: tiles are tall and
// thin, a bounding sphere would overhang far below the ground into a spot's frustum. A tile's triangles are stored
// by sub-tile along x, so a pass draws only the run of sub-tiles it needs (onBeforeShadow sets the draw range): the
// sun's from proxyPolicy, a spot's from its own frustum (its narrow cone crosses a corner of most tiles it meets)
function proxyInFrustum(frustum) {
  const u = this.userData;
  if (!SHADOW_PASS.on || (frustum === SHADOW_PASS.sun && !u.sun) || !frustum.intersectsBox(u.box)) return false;
  if (frustum === SHADOW_PASS.sun) { u.range[0] = u.sunRange[0]; u.range[1] = u.sunRange[1]; return true; }
  let a = -1, b = -1;
  for (let i = 0; i < u.subs.length; i++) if (frustum.intersectsBox(u.subs[i].box)) { if (a < 0) a = i; b = i; }
  if (a < 0) return false;
  u.range[0] = a; u.range[1] = b;
  return true;
}
function proxyRange(r, o, c, sc, geo) { const S = o.userData.subs, [a, b] = o.userData.range; geo.drawRange.start = S[a].start; geo.drawRange.count = S[b].start + S[b].count - S[a].start; }
function proxyRangeEnd(r, o, c, sc, geo) { geo.drawRange.start = 0; geo.drawRange.count = Infinity; }

// three makes a shadow map as an RGBA8 target with a depth texture and samples only the depth: the same map with an R8
// colour attachment (a quarter of its bytes; 18 MB less on medium) is made the way three makes it, just before it would.
// A fresh map has never been drawn: it is drawn in the frame it is made (ShadowPolicy.update forces it)
const FRESH = new WeakSet();
function leanMap(light, renderer) {
  const s = light.shadow, type = renderer.shadowMap.type;
  if (s.map || light.isPointLight || (type !== THREE.PCFShadowMap && type !== THREE.BasicShadowMap)) return false;
  const ext = s.getFrameExtents(), w = s.mapSize.x * ext.x, h = s.mapSize.y * ext.y;
  const rt = new THREE.WebGLRenderTarget(w, h, { format: THREE.RedFormat, type: THREE.UnsignedByteType, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  const d = rt.depthTexture = new THREE.DepthTexture(w, h, THREE.UnsignedIntType);
  d.name = light.name + '.shadowMap'; d.format = THREE.DepthFormat;
  if (type === THREE.PCFShadowMap) { d.compareFunction = renderer.state.buffers.depth.getReversed() ? THREE.GreaterEqualCompare : THREE.LessEqualCompare; d.minFilter = d.magFilter = THREE.LinearFilter; }
  else { d.compareFunction = null; d.minFilter = d.magFilter = THREE.NearestFilter; }
  FRESH.add(rt); s.map = rt;
  s.camera.updateProjectionMatrix();
  return true;
}

const NO_RAYCAST = () => {};
const isStaticBatch = (o) => o.userData.staticCaster === true || (o.matrixAutoUpdate === false && o.name.startsWith('batch:'));
// a caster whose depth pass is its positions alone (no cut-out, displacement, clipping or depth material of its own)
function plainCaster(o) {
  const m = o.material, g = o.geometry;
  if (!m || Array.isArray(m) || !m.visible || m.wireframe || o.isInstancedMesh || o.isSkinnedMesh || o.isBatchedMesh) return false;
  if (o.userData.noProxy || o.customDepthMaterial) return false;
  if (m.alphaTest > 0 || m.alphaToCoverage || m.alphaMap || (m.displacementMap && m.displacementScale) || m.clippingPlanes?.length) return false;
  return !!g?.attributes?.position && !g.morphAttributes?.position;
}
const proxiable = (o) => isStaticBatch(o) && plainCaster(o);
// settled candidates: small plain casters that are not batches (a settled set is rebuilt in the frame a member moves),
// whose material does not move their vertices (wind)
const settleable = (o) => !isStaticBatch(o) && !o.userData.smallCaster && plainCaster(o) && o.material.defines?.USE_WIND === undefined &&
  (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) <= 3 * 4096;
// how far any corner of a mesh's box moved between the world matrix a (its elements) and the current one
function moved(o, a) {
  const b = o.geometry.boundingBox, e = o.matrixWorld.elements;
  let d = 0;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? b.max.x : b.min.x, y = i & 2 ? b.max.y : b.min.y, z = i & 4 ? b.max.z : b.min.z;
    const dx = (e[0] - a[0]) * x + (e[4] - a[4]) * y + (e[8] - a[8]) * z + e[12] - a[12];
    const dy = (e[1] - a[1]) * x + (e[5] - a[5]) * y + (e[9] - a[9]) * z + e[13] - a[13];
    const dz = (e[2] - a[2]) * x + (e[6] - a[6]) * y + (e[10] - a[10]) * z + e[14] - a[14];
    d = Math.max(d, dx * dx + dy * dy + dz * dz);
  }
  return Math.sqrt(d);
}
// every caster the policy sees culls through this in the shadow passes: its own test, then in the sun's pass its
// shadow must land in view (ShadowPolicy.lands)
const OWN_TEST = new WeakMap(), MESH_TEST = THREE.Mesh.prototype.intersectsFrustum;
function casterInFrustum(frustum) {
  if (!(OWN_TEST.get(this) || MESH_TEST).call(this, frustum)) return false;
  const P = SHADOW_PASS.policy;
  return !SHADOW_PASS.on || frustum !== SHADOW_PASS.sun || !P || P.lands(this);
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
    this.hz = 60; this.cull = false; this.reach = Infinity; this.proxies = true; this.alphaCast = true;
    this.force = true; this.lastUpdate = -1e9; this.lastSpot = -1e9; this.lastFrame = -1e9;
    this.camPos = new THREE.Vector3(1e9, 0, 0); this.camDir = new THREE.Vector3();
    this.meta = new WeakMap(); // mesh → { cast (authored), set (last value written here), small, fp, stable, proxied, pin, loose,
    //                                   wm, gv, calm, settled, wpin, unsettles (settled casters) }
    this.tracked = [];
    this.scene = null; this.kids = []; this.nextScan = 0;
    this.spots = new WeakMap(); // spot light → 'off' (cone unseen) | 'sched' (refreshed on this policy's clock)
    this.lights = []; this.suns = [];
    this.roots = new Map(); // chapter root (or its settled set's key) → { sig, root, settled, sources, meshes, floor, cols }
    this.settledKeys = new WeakMap(); this.sunCull = false; this.sunK = 0;
    this.jobs = new Map(); this.building = false; this.buildBudget = 4; // ms of proxy building per frame
    this.group = new THREE.Group(); this.group.name = 'shadowProxies'; this.group.userData.shadowProxy = true;
    this.stats = { updates: 0, spotUpdates: 0, skipped: 0, culled: 0, spotsSkipped: 0, snaps: 0, proxies: 0, proxyTris: 0, proxied: 0, settled: 0, reachCulled: 0, viewCulled: 0, sunCulled: 0, buildMs: 0, building: 0 };
    SHADOW_PASS.policy = this;
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
  configure({ shadowHz = 60, smallCull = false, shadowReach = Infinity, alphaCasters = true } = {}) {
    this.hz = shadowHz; this.reach = shadowReach;
    if (this.alphaCast !== alphaCasters) { this.alphaCast = alphaCasters; this.nextScan = 0; }
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
  // the key of a chapter root's settled set (its own proxies, rebuilt apart from the root's)
  settledKey(root) { let k = this.settledKeys.get(root); if (!k) this.settledKeys.set(root, k = { settledOf: root }); return k; }
  // a caster culls through casterInFrustum from now on (its own test first)
  cullHook(o) {
    if (OWN_TEST.has(o)) return;
    OWN_TEST.set(o, o.intersectsFrustum); o.intersectsFrustum = casterInFrustum;
  }
  scan(scene, now) {
    const seen = [], lights = [], suns = [], sources = new Map();
    const source = (key, root, o) => { let S = sources.get(key); if (!S) sources.set(key, S = { root, list: [] }); S.list.push(o); };
    scene.traverse((o) => {
      if (o.userData.shadowProxy) return;
      if (o.isLight) { if (o.castShadow && o.isSpotLight) lights.push(o); else if (o.castShadow && o.isDirectionalLight) suns.push(o); return; }
      if (!o.isMesh) return;
      if ((o.isInstancedMesh || o.isSkinnedMesh) && !o.userData.smallCaster) { if (o.isSkinnedMesh && o.castShadow) this.cullHook(o); return; }
      let m = this.meta.get(o);
      if (!m) {
        if (!o.castShadow) return; // only ever touch meshes that were authored as casters
        m = { cast: true, set: undefined, small: false, fp: null, stable: 0, proxied: false, pin: null, loose: false, wm: null, gv: -1, calm: 0, settled: false, wpin: null, unsettles: 0 };
        this.meta.set(o, m);
        this.cullHook(o);
      }
      // the flag is authored unless this policy wrote it, and so is any change made since it last wrote it
      if (m.set === undefined || o.castShadow !== m.set) { m.cast = o.castShadow; m.set = undefined; }
      if (this.proxies && m.cast && !m.loose && proxiable(o)) {
        // a flagged prop (userData.staticCaster) that moved past a sway since it was merged is not static after all:
        // it leaves the proxies (the root's set changes, so they are merged again) and casts on its own from now on
        const e = o.matrixWorld.elements, pin = m.pin;
        if (pin && Math.abs(e[12] - pin[0]) + Math.abs(e[13] - pin[1]) + Math.abs(e[14] - pin[2]) > 0.08) { m.loose = true; m.pin = null; }
        else {
          const root = rootOf(o, scene);
          source(root, root, o);
          if (m.proxied && o.castShadow) this._set(o, m, false); // its proxy casts for it
          return;
        }
      }
      if (o.userData.smallCaster) { if (m.proxied) { m.proxied = false; this._set(o, m, m.cast); } m.small = true; seen.push(o); return; }
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      // static: the world matrix kept since the last scan, within a sway (2 cm, about a degree): a rolled-up rope
      // ladder that sways a little is as static as a pot for its shadow
      const e = o.matrixWorld.elements, fp = m.fp;
      const still = Array.isArray(fp) && Math.abs(e[12] - fp[0]) + Math.abs(e[13] - fp[1]) + Math.abs(e[14] - fp[2]) < 0.02 &&
        Math.abs(e[0] - fp[3]) + Math.abs(e[1] - fp[4]) + Math.abs(e[4] - fp[5]) + Math.abs(e[5] - fp[6]) + Math.abs(e[10] - fp[7]) < 0.02;
      m.stable = still ? m.stable + 1 : 0;
      m.fp = [e[12], e[13], e[14], e[0], e[1], e[4], e[5], e[10]];
      _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      // static alpha-tested batches (ivy, lattice screens) count as small where the tier drops their cut-out shadows
      m.small = (m.stable >= 1 || !o.matrixAutoUpdate) && (_b.max.y - _b.min.y < 0.4 || _b.max.z < -30 || (this.alphaCast === false && isStaticBatch(o) && o.material.alphaTest > 0));
      // settled: its box kept within a sway of where it was merged (or, before that, of the last scan) and its
      // vertices unchanged (a cloth); a small caster the tier culls stays culled
      if (this.proxies && m.cast && !(this.cull && m.small) && settleable(o)) {
        const v = g.attributes.position.version;
        if (m.settled && (v !== m.gv || moved(o, m.wpin || m.wm) > SWAY)) { m.settled = false; m.wpin = null; m.calm = 0; m.unsettles++; }
        if (!m.settled) {
          m.calm = m.wm && v === m.gv && moved(o, m.wm) <= SWAY ? m.calm + 1 : 0;
          m.settled = m.calm >= SETTLE << Math.min(3, m.unsettles);
        }
        if (m.wm) m.wm.set(e); else m.wm = Float64Array.from(e);
        m.gv = v;
        if (m.settled) {
          source(this.settledKey(rootOf(o, scene)), rootOf(o, scene), o);
          if (m.proxied && o.castShadow) this._set(o, m, false);
          return;
        }
      } else if (m.settled) { m.settled = false; m.wpin = null; m.calm = 0; }
      if (m.proxied) { m.proxied = false; this._set(o, m, m.cast); }
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
    for (const [key, R] of this.roots) if (!sources.has(key)) { this.dropRoot(R); this.roots.delete(key); }
    for (const key of this.jobs.keys()) if (!sources.has(key)) this.jobs.delete(key);
    for (const [key, { root, list }] of sources) {
      let h = 0;
      for (const o of list) h = (h * 31 + o.id * (shownIn(o, root) ? 2 : 1)) % 2147483647;
      const sig = `${list.length}:${h}`, R = this.roots.get(key), J = this.jobs.get(key);
      if ((R && R.sig === sig) || (J && J.sig === sig)) continue;
      if (R) { this.dropRoot(R); this.roots.delete(key); }
      const it = this.buildJob(root, list, sig, key !== root);
      // a settled set is small: merged at once, so a member that moves again costs no frames of separate casters
      if (key !== root) { let r; while (!(r = it.next()).done); this.roots.set(key, r.value); this.jobs.delete(key); }
      else this.jobs.set(key, { sig, ms: 0, it });
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
    let n = 0, tris = 0, src = 0, settled = 0;
    for (const R of this.roots.values()) { n += R.meshes.length; src += R.sources.length; if (R.settled) settled += R.sources.length; for (const p of R.meshes) tris += p.userData.tris; }
    this.stats.proxies = n; this.stats.proxyTris = tris; this.stats.proxied = src; this.stats.settled = settled; this.stats.building = this.jobs.size;
  }
  dropRoot(R) {
    for (const p of R.meshes) { p.removeFromParent(); p.geometry.dispose(); }
    for (const o of R.sources) {
      const m = this.meta.get(o);
      if (m && m.proxied) { m.proxied = false; this._set(o, m, m.cast); }
    }
    R.meshes.length = 0; R.sources.length = 0;
  }
  *buildJob(root, list, sig, settled = false) {
    const slots = new Array(4096), used = [], at = new Map();
    // pass 1: world positions and a tile per triangle (x / TX and a depth band), triangle counts and bounds per tile.
    // A source's world matrix is brought up to date first (a root that just arrived has never been rendered) and
    // kept for pass 2, which runs frames later, after a lantern has swayed
    for (const o of list) {
      if (!shownIn(o, root)) continue;
      used.push(o);
      yield;
      o.updateWorldMatrix(true, false); at.set(o, o.matrixWorld.clone());
      const n = this.prep(o, at.get(o)), W = _P, I = _I, K = _K, Sb = _S, step = _side === 2 ? 2 : 1;
      for (let t = 0; t < n; t++) {
        let T = slots[K[t]];
        if (!T) T = slots[K[t]] = { n: 0, b: box6(), ns: new Array(SUB).fill(0), sb: [...Array(SUB)].map(box6), wp: null, a: null, c: null, s: 1 };
        T.n += step; T.ns[Sb[t]] += step;
        const b = T.b, bs = T.sb[Sb[t]];
        for (let j = t * 3; j < t * 3 + 3; j++) {
          const v = I[j] * 3, x = W[v], y = W[v + 1], z = W[v + 2];
          if (x < b[0]) b[0] = x; if (x > b[3]) b[3] = x;
          if (y < b[1]) b[1] = y; if (y > b[4]) b[4] = y;
          if (z < b[2]) b[2] = z; if (z > b[5]) b[5] = z;
          if (x < bs[0]) bs[0] = x; if (x > bs[3]) bs[3] = x;
          if (y < bs[1]) bs[1] = y; if (y > bs[4]) bs[4] = y;
          if (z < bs[2]) bs[2] = z; if (z > bs[5]) bs[5] = z;
        }
      }
    }
    const tiles = new Map();
    slots.forEach((T, k) => {
      const b = T.b;
      T.c = [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2];
      T.s = Math.max(1e-3, b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2 * 1.0001;
      T.a = new Int16Array(T.n * 9);
      // sub-tiles one after the other: write pointers (int16 values) at each one's first triangle
      let o = 0; T.off = T.ns.map((c) => { const at = o; o += c; return at; }); T.wp = T.off.map((t) => t * 9);
      tiles.set(k, T);
    });
    // pass 2: 16-bit positions around each tile's centre (one uniform scale, truncated: under a millimetre)
    for (const o of used) {
      yield;
      const n = this.prep(o, at.get(o)), side = _side, W = _P, I = _I, K = _K, Sb = _S;
      for (let t = 0; t < n; t++) {
        const T = slots[K[t]], a = T.a, cx = T.c[0], cy = T.c[1], cz = T.c[2], f = 32767 / T.s;
        let w = T.wp[Sb[t]];
        for (let r = 0; r < 2; r++) {
          if (r === 0 ? side === -1 : side === 1) continue;
          for (let k = 0; k < 3; k++) {
            const v = I[t * 3 + (r === 0 ? k : (3 - k) % 3)] * 3;
            a[w] = (W[v] - cx) * f; a[w + 1] = (W[v + 1] - cy) * f; a[w + 2] = (W[v + 2] - cz) * f; // truncated: < 1 mm
            w += 3;
          }
        }
        T.wp[Sb[t]] = w;
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
      p.name = `shadowProxy:${k & 2048 ? 'w' : ''}${((k & 2047) >> 3) - 128}|${k & 7}`;
      p.userData.shadowProxy = true; p.userData.tris = T.n; p.userData.root = root;
      p.userData.box = new THREE.Box3(new THREE.Vector3(b[0], b[1], b[2]), new THREE.Vector3(b[3], b[4], b[5]));
      p.userData.front = b[5]; p.userData.top = b[4]; p.userData.radius = Math.hypot(b[3] - b[0], b[4] - b[1], b[5] - b[2]) / 2; p.userData.sun = true;
      p.userData.subs = T.ns.map((c, i) => (c ? { start: T.off[i] * 3, count: c * 3, box: new THREE.Box3(new THREE.Vector3(T.sb[i][0], T.sb[i][1], T.sb[i][2]), new THREE.Vector3(T.sb[i][3], T.sb[i][4], T.sb[i][5])) } : null)).filter(Boolean);
      p.userData.sunRange = [0, p.userData.subs.length - 1]; p.userData.range = [0, p.userData.subs.length - 1];
      p.onBeforeShadow = proxyRange; p.onAfterShadow = proxyRangeEnd;
      p.position.set(T.c[0], T.c[1], T.c[2]); p.scale.setScalar(T.s);
      p.castShadow = true; p.receiveShadow = false;
      p.intersectsFrustum = proxyInFrustum; p.raycast = NO_RAYCAST;
      p.updateMatrix(); p.matrixAutoUpdate = false;
      this.group.add(p); p.updateMatrixWorld(true);
      meshes.push(p);
    }
    for (const o of used) {
      const m = this.meta.get(o), e = at.get(o).elements;
      m.proxied = true; this._set(o, m, false);
      if (o.userData.staticCaster === true) m.pin = [e[12], e[13], e[14]]; // where its merged shadow was cast from
      if (settled) m.wpin = Float64Array.from(e);
    }
    this.force = true;
    // the lowest static geometry: no shadow of this root lands below it; and per TX-wide column of x
    let floor = Infinity; const cols = new Map();
    for (const T of tiles.values()) {
      floor = Math.min(floor, T.b[1]);
      for (let c = Math.floor(T.b[0] / TX); c <= Math.floor(T.b[3] / TX); c++) cols.set(c, Math.min(cols.get(c) ?? Infinity, T.b[1]));
    }
    return { sig, root, settled, sources: used, meshes, floor: Number.isFinite(floor) ? floor : -10, cols };
  }
  // a source's world-space vertices (_P: its own array, or _W), the vertex triple of each triangle (_I) and its tile
  // (_K); _side: 1 front faces as authored, -1 reversed, 2 both. Returns the triangle count.
  prep(o, mw = o.matrixWorld) {
    const g = o.geometry, pos = g.attributes.position, idx = g.index, e = mw.elements, nv = pos.count;
    const m = o.material, eff = m.shadowSide ?? (m.side === THREE.FrontSide ? THREE.BackSide : m.side === THREE.BackSide ? THREE.FrontSide : THREE.DoubleSide);
    _side = eff === THREE.DoubleSide ? 2 : eff === THREE.BackSide ? 1 : -1;
    const plain = !pos.isInterleavedBufferAttribute && !pos.normalized && pos.itemSize === 3, a = pos.array;
    // batches sit at the origin: their own positions are world positions
    if (plain && mw.equals(IDENTITY)) _P = a;
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
    // a batch of casting and non-casting pieces casts only its first castCount vertices (Batcher.build)
    const total = idx ? idx.count : nv, dr = g.drawRange, s0 = Math.max(0, dr.start), s1 = Math.min(total, dr.start + dr.count, o.userData.castCount ?? Infinity);
    const n = Math.max(0, Math.floor((s1 - s0) / 3));
    if (_K.length < n) { _K = new Int32Array(Math.ceil(n * 1.25)); _S = new Uint8Array(_K.length); _I = new Uint32Array(_K.length * 3); }
    const ia = idx ? idx.array : null;
    for (let t = 0; t < n; t++) {
      const i = s0 + t * 3, v0 = ia ? ia[i] : i, v1 = ia ? ia[i + 1] : i + 1, v2 = ia ? ia[i + 2] : i + 2;
      _I[t * 3] = v0; _I[t * 3 + 1] = v1; _I[t * 3 + 2] = v2;
      const x0 = W[v0 * 3], x1 = W[v1 * 3], x2 = W[v2 * 3], cx = (x0 + x1 + x2) / 3, cz = (W[v0 * 3 + 2] + W[v1 * 3 + 2] + W[v2 * 3 + 2]) / 3;
      // a triangle wider than a sub-tile (a long wall face, a cornice) would stretch its tile's box over its whole
      // length: wide ones go to tiles of their own, WIDE tiles across and every depth (they are few)
      const wide = Math.max(x0, x1, x2) - Math.min(x0, x1, x2) > TX / SUB, w = wide ? TX * WIDE : TX;
      const fx = cx / w, tx = Math.floor(fx);
      _K[t] = wide ? 2048 | (Math.min(255, Math.max(0, tx + 128)) << 3) : (Math.min(255, Math.max(0, tx + 128)) << 3) | bandOf(cz);
      _S[t] = Math.min(SUB - 1, Math.floor((fx - tx) * SUB));
    }
    return n;
  }
  // per frame: a proxy casts while its chapter root is shown. Into the sun's map only while its shadow can land in
  // view: its box swept along the light down to the root's lowest geometry (no receiver lies lower), widened by
  // 1.5 m for the frames a 30 Hz map is reused, must meet the camera's frustum (no visible change on any tier; a
  // tile far along the light, high on the rooftops, falls inside the sun's frustum without its shadow reaching the
  // view), and on low / medium while that shadow can reach within `reach` metres behind the play plane from the
  // proxy's front top edge
  proxyPolicy(scene) {
    const L = this.suns[0];
    SHADOW_PASS.sun = L ? L.shadow.getFrustum() : null;
    let k = 0;
    if (L) {
      _sd.subVectors(L.position, L.target.position).normalize();
      k = _sd.z < 0 ? -_sd.z / Math.max(_sd.y, 0.05) : 0;
    }
    // the other casters' test in the sun's pass (lands) reads these
    this.sunCull = !!L && _sd.y > 0.02; this.sunK = k; this.stats.sunCulled = 0;
    if (!this.roots.size) return;
    let reachCulled = 0, viewCulled = 0;
    for (const R of this.roots.values()) {
      // a settled set's shadows reach as low as its root's geometry
      const G = R.settled ? this.roots.get(R.root) || R : R;
      for (const p of R.meshes) {
        const root = p.userData.root, shown = root === scene || (root.visible && root.parent === scene);
        if (p.visible !== shown) { p.visible = shown; this.force = true; }
        const u = p.userData;
        let sun = shown;
        if (sun && this.reach < Infinity && u.front + Math.max(0, u.top) * k < -this.reach) { sun = false; reachCulled++; }
        if (sun && L) {
          if (_sd.y > 0.02) {
            if (!this.sweptInView(u.box, this.floorUnder(G, u.box), k)) { sun = false; viewCulled++; }
          } else {
            const c = _v.setFromMatrixPosition(p.matrixWorld), r = u.radius + 3;
            _e.copy(c).addScaledVector(_sd, -400);
            for (const pl of _fr.planes) if (pl.distanceToPoint(c) < -r && pl.distanceToPoint(_e) < -r) { sun = false; viewCulled++; break; }
          }
        }
        // the same per sub-tile: the run of them the sun's pass draws
        let a = 0, b = u.subs.length - 1;
        if (sun && L && _sd.y > 0.02) {
          a = -1;
          const fl = this.floorUnder(G, u.box);
          for (let i = 0; i < u.subs.length; i++) if (this.sweptInView(u.subs[i].box, fl, k)) { if (a < 0) a = i; b = i; }
          if (a < 0) { sun = false; viewCulled++; a = 0; b = u.subs.length - 1; }
        }
        if (u.sunRange[0] !== a || u.sunRange[1] !== b) { u.sunRange[0] = a; u.sunRange[1] = b; this.force = true; }
        if (u.sun !== sun) { u.sun = sun; this.force = true; }
      }
    }
    this.stats.reachCulled = reachCulled; this.stats.viewCulled = viewCulled;
  }

  // the lowest geometry a box's shadow can reach: over the columns of x the light can carry it across on its way
  // down to the root's lowest geometry (a deep gap lowers the floor only where its shadow could fall into it)
  floorUnder(R, b) {
    if (!R.cols || _sd.y <= 0.02) return R.floor;
    const span = (b.max.y - R.floor) * Math.abs(_sd.x) / _sd.y + 2;
    const x0 = _sd.x > 0 ? b.min.x - span : b.min.x, x1 = _sd.x > 0 ? b.max.x : b.max.x + span;
    let f = Infinity;
    for (let c = Math.floor(x0 / TX); c <= Math.floor(x1 / TX); c++) { const v = R.cols.get(c); if (v !== undefined && v < f) f = v; }
    return Number.isFinite(f) ? Math.min(f, b.min.y) : R.floor;
  }
  // a box's shadow can land in view: the box swept along the light (_sd, from the sun) down to the lowest geometry
  // under it (floor) meets the camera's frustum (_fr), with 1.5 m to spare for the frames a 30 Hz map is reused. The
  // swept box is the box plus a segment, so its reach along a plane's normal is the box's plus the segment's: tested
  // plane by plane, as tight as the swept shape itself (its bounding box reached far over the view). On low / medium
  // its front top edge must also shade within `reach` metres behind the play plane (k: depth per metre of height)
  sweptInView(b, floor, k) {
    if (this.reach < Infinity && b.max.z + Math.max(0, b.max.y) * k < -this.reach) return false;
    const len = Math.min(400, (b.max.y - floor) / _sd.y);
    for (const pl of _fr.planes) {
      const n = pl.normal;
      const h = n.x * (n.x > 0 ? b.max.x : b.min.x) + n.y * (n.y > 0 ? b.max.y : b.min.y) + n.z * (n.z > 0 ? b.max.z : b.min.z) + pl.constant;
      if (h + Math.max(0, -len * n.dot(_sd)) < -1.5) return false;
    }
    return true;
  }
  // in the sun's pass, a caster that is not a proxy (characters, props, entities): its shadow, swept from its box down
  // to its root's geometry, must land in view as a proxy's must (no visible change; an off-screen ladder or bridge
  // stops drawing into the sun's map)
  lands(o) {
    if (!this.sunCull || o.isInstancedMesh || !this.scene) return true;
    if (o.isSkinnedMesh) {
      if (!o.boundingSphere) return true;
      _cs.copy(o.boundingSphere).applyMatrix4(o.matrixWorld); _cb.setFromCenterAndSize(_cs.center, _v.setScalar(_cs.radius * 2));
    } else {
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      _cb.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
    }
    let R = null;
    if (this.roots.size) {
      let p = o; while (p.parent && p.parent !== this.scene) p = p.parent;
      if (p.parent) R = this.roots.get(p === o ? this.scene : p) || null;
    }
    if (this.sweptInView(_cb, R ? this.floorUnder(R, _cb) : _cb.min.y - 400 * _sd.y, this.sunK)) return true;
    this.stats.sunCulled++;
    return false;
  }

  // a settled caster that moved past its sway, changed its vertices, was hidden or left its root: scan now, so its
  // merged shadow never trails it (checked every frame; settled sets are small)
  settledMoved() {
    for (const R of this.roots.values()) {
      if (!R.settled) continue;
      for (const o of R.sources) {
        const m = this.meta.get(o);
        if (!m?.wpin || o.geometry.attributes.position.version !== m.gv || moved(o, m.wpin) > SWAY) return true;
        let p = o;
        while (p && p !== R.root) { if (!p.visible) return true; p = p.parent; }
        if (!p || !R.root.visible || (R.root !== this.scene && R.root.parent !== this.scene)) return true;
      }
    }
    return false;
  }
  // per frame, before rendering the scene
  update(scene, camera, now) {
    this.wrap();
    const kids = scene.children;
    let changed = scene !== this.scene || kids.length !== this.kids.length;
    for (let i = 0; !changed && i < kids.length; i++) changed = kids[i] !== this.kids[i];
    if (changed || now > this.nextScan || this.settledMoved()) this.scan(scene, now);
    // lean shadow maps for the lights that have none yet (a first frame, a tier's new map size): drawn this frame
    let fresh = false;
    for (const l of this.suns) fresh = leanMap(l, this.r) || fresh;
    for (const l of this.lights) fresh = leanMap(l, this.r) || fresh;
    if (fresh) this.force = true;
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
    if (fresh) for (const l of [...this.suns, ...this.lights]) if (FRESH.has(l.shadow.map)) { FRESH.delete(l.shadow.map); l.shadow.needsUpdate = true; }
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
      const visible = !l.shadow.map || FRESH.has(l.shadow.map) || (l.visible && l.intensity > 0 && coneInView(l.position, _a, len, Math.tan(l.angle) * len));
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
