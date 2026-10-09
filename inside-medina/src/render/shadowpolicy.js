import * as THREE from 'three';

// Shadow-map scheduling and caster culling.
//  - low / medium refresh shadow maps at 30 Hz (time based), immediately after a camera snap
//    or an explicit invalidate();
//  - shadowed spot lights whose lit cone is off-screen (or dark) keep their old map;
//  - small-caster cull (low / medium): static casters under 0.4 m tall, or more than 30 m
//    behind the play plane, stop casting. Moving meshes (characters, crates, levers) are never
//    culled: a caster must keep the same world matrix over two scans before it counts as static.
const _b = new THREE.Box3(), _s = new THREE.Sphere(), _fr = new THREE.Frustum(), _pm = new THREE.Matrix4();
const _d = new THREE.Vector3(), _a = new THREE.Vector3();

export class ShadowPolicy {
  constructor(renderer) {
    this.r = renderer;
    this.hz = 60; this.cull = false;
    this.force = true; this.lastUpdate = -1e9;
    this.camPos = new THREE.Vector3(1e9, 0, 0); this.camDir = new THREE.Vector3();
    this.meta = new WeakMap(); // mesh → { cast, small, me (matrix fingerprint), stable }
    this.tracked = [];
    this.scene = null; this.children = -1; this.nextScan = 0;
    this.spots = new Map(); // light → we disabled its autoUpdate
    this.lights = [];
    this.stats = { updates: 0, skipped: 0, culled: 0, spotsSkipped: 0, snaps: 0 };
  }
  configure({ shadowHz = 60, smallCull = false } = {}) {
    this.hz = shadowHz;
    if (this.cull !== smallCull) { this.cull = smallCull; this.apply(); }
    this.force = true;
  }
  invalidate() { this.force = true; }

  scan(scene, now) {
    const seen = [], lights = [];
    scene.traverse((o) => {
      if (o.isSpotLight && o.castShadow) { lights.push(o); return; }
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      let m = this.meta.get(o);
      if (!m) {
        if (!o.castShadow) return; // only ever touch meshes that were authored as casters
        m = { cast: true, small: false, fp: NaN, stable: 0 };
        this.meta.set(o, m);
      }
      const g = o.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      const e = o.matrixWorld.elements, fp = e[12] * 1.31 + e[13] * 7.7 + e[14] * 3.3 + e[0] + e[5] * 2 + e[10] * 3 + e[1] * 5 + e[4] * 7;
      m.stable = fp === m.fp ? m.stable + 1 : 0;
      m.fp = fp;
      _b.copy(g.boundingBox).applyMatrix4(o.matrixWorld);
      m.small = (m.stable >= 1 || !o.matrixAutoUpdate) && (_b.max.y - _b.min.y < 0.4 || _b.max.z < -30);
      seen.push(o);
    });
    this.tracked = seen; this.lights = lights;
    this.children = scene.children.length; this.scene = scene;
    this.nextScan = now + 1000;
    this.apply();
  }
  apply() {
    let n = 0;
    for (const o of this.tracked) {
      const m = this.meta.get(o);
      const c = m.cast && !(this.cull && m.small);
      if (!c) n++;
      if (o.castShadow !== c) { o.castShadow = c; this.force = true; }
    }
    this.stats.culled = n;
  }

  // per frame, before rendering the scene
  update(scene, camera, now) {
    if (scene !== this.scene || scene.children.length !== this.children || now > this.nextScan) this.scan(scene, now);
    // camera snap: jump in position or direction since the last frame
    camera.getWorldDirection(_d);
    if (camera.position.distanceToSquared(this.camPos) > 2.25 || _d.dot(this.camDir) < 0.985) { this.force = true; this.stats.snaps++; }
    this.camPos.copy(camera.position); this.camDir.copy(_d);
    this.spotPolicy(camera);
    const sm = this.r.shadowMap;
    if (this.hz >= 60) { sm.autoUpdate = true; this.force = false; this.stats.updates++; return true; }
    sm.autoUpdate = false;
    if (this.force || now - this.lastUpdate >= 1000 / this.hz - 4) {
      sm.needsUpdate = true; this.lastUpdate = now; this.force = false; this.stats.updates++;
      return true;
    }
    this.stats.skipped++;
    return false;
  }

  // shadowed spots: refresh only while their cone (up to 40 m) can be seen and they are lit
  spotPolicy(camera) {
    if (!this.lights.length) return;
    _pm.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); _fr.setFromProjectionMatrix(_pm);
    let skipped = 0;
    for (const l of this.lights) {
      const len = Math.min(l.distance || 40, 40);
      _a.copy(l.target.position).sub(l.position).normalize();
      _s.center.copy(l.position).addScaledVector(_a, len * 0.5);
      _s.radius = Math.hypot(len * 0.5, Math.tan(l.angle) * len);
      // a map that was never rendered must render once: an unallocated shadow map would bind an
      // empty colour texture to the material's shadow sampler
      const visible = !l.shadow.map || (l.visible && l.intensity > 0 && _fr.intersectsSphere(_s));
      const mine = this.spots.get(l);
      if (!visible && l.shadow.autoUpdate) { l.shadow.autoUpdate = false; this.spots.set(l, true); skipped++; }
      else if (visible && mine) { l.shadow.autoUpdate = true; l.shadow.needsUpdate = true; this.spots.delete(l); this.force = true; }
      else if (!visible && mine) skipped++;
    }
    this.stats.spotsSkipped = skipped;
  }
}
