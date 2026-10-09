import * as THREE from 'three';

// A fixed pool of point lights reassigned each frame to the sources nearest
// the camera focus. The light count never changes, so shaders never recompile
// mid-game, and each pixel only pays for a handful of lights.
// Static sources (lanterns) flicker here; dynamic sources (a guard's lantern,
// a beam's hit spot) are moved and dimmed by their owner and win a slot ahead
// of static ones by priority. The pool size is fixed at boot by device class.
export class LightPool {
  constructor(scene, n = 4, { color = 0xffa550, distance = 6, decay = 1.8 } = {}) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(color, 0, distance, decay);
      l.name = 'pool';
      scene.add(l);
      this.lights.push(l);
    }
    this.sources = []; // { pos: Vector3, intensity, phase, priority, dynamic, enabled }
    this.mul = 1;
    this._order = [];
  }
  get size() { return this.lights.length; }
  add(pos, intensity = 2.5, phase = 0) { const s = { pos: pos.clone(), intensity, phase, priority: 0, dynamic: false, enabled: true }; this.sources.push(s); return s; }
  // owner-driven source: the owner updates pos/intensity/enabled every frame
  addDynamic(owner, priority = 1, { intensity = 2.5 } = {}) {
    const s = { owner, pos: new THREE.Vector3(), intensity, phase: 0, priority, dynamic: true, enabled: false };
    this.sources.push(s);
    return s;
  }
  remove(src) { const i = this.sources.indexOf(src); if (i < 0) return; this.sources.splice(i, 1); for (const l of this.lights) { if (l.userData.src === src) l.userData.src = undefined; } }
  clear() { this.sources.length = 0; for (const l of this.lights) { l.userData.src = undefined; l.intensity = 0; } }
  setColor(c) { for (const l of this.lights) l.color.set(c); }
  setMul(m) { this.mul = m; }

  update(focus, time, dt) {
    const S = this.sources;
    const order = this._order; order.length = 0;
    for (const s of S) { if (!s.enabled) continue; s.d = s.pos.distanceToSquared(focus); order.push(s); }
    order.sort((a, b) => (b.priority - a.priority) || (a.d - b.d));
    const n = this.lights.length;
    const want = order.length > n ? order.slice(0, n) : order;
    // keep lights on sources that are still wanted to avoid popping
    const taken = new Set();
    for (const l of this.lights) { const s = l.userData.src; if (s && want.includes(s)) taken.add(s); else l.userData.src = undefined; }
    for (const s of want) {
      if (taken.has(s)) continue;
      const free = this.lights.find((l) => l.userData.src === undefined);
      if (!free) break;
      free.userData.src = s; free.position.copy(s.pos); free.intensity = 0; taken.add(s);
    }
    const k = 1 - Math.exp(-6 * dt);
    for (const l of this.lights) {
      const s = l.userData.src;
      if (s === undefined) { l.intensity += (0 - l.intensity) * k; continue; }
      if (s.dynamic) { l.position.copy(s.pos); l.intensity = s.intensity * this.mul; continue; }
      const flick = 0.88 + Math.sin(time * 9 + s.phase) * 0.07 + Math.sin(time * 23 + s.phase * 2) * 0.05;
      l.intensity += (s.intensity * this.mul * flick - l.intensity) * k;
    }
  }
}
