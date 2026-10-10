import * as THREE from 'three';

// A fixed pool of point lights reassigned each frame to the sources nearest
// the camera focus. The light count never changes, so shaders never recompile
// mid-game, and each pixel only pays for a handful of lights.
// Static sources (lanterns) flicker here; dynamic sources (a guard's lantern,
// a beam's hit spot) are moved and dimmed by their owner and win a slot ahead
// of static ones by priority, but only near the view (update's `range`), so an
// off-screen guard never holds a light. A dynamic source may carry its own
// colour, distance and decay (uniforms only: no recompile). The pool size is
// fixed at boot by device class.
export class LightPool {
  constructor(scene, n = 4, { color = 0xffa550, distance = 6, decay = 1.8 } = {}) {
    this.color = new THREE.Color(color); this.distance = distance; this.decay = decay;
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
  addDynamic(owner, priority = 1, { intensity = 2.5, color = null, distance, decay } = {}) {
    const s = { owner, pos: new THREE.Vector3(), intensity, phase: 0, priority, dynamic: true, enabled: false, color: color === null ? null : new THREE.Color(color), distance, decay };
    this.sources.push(s);
    return s;
  }
  remove(src) { const i = this.sources.indexOf(src); if (i < 0) return; this.sources.splice(i, 1); for (const l of this.lights) { if (l.userData.src === src) { l.userData.src = undefined; l.userData.was = src; } } }
  clear() { this.sources.length = 0; for (const l of this.lights) { l.userData.src = undefined; l.userData.was = undefined; l.intensity = 0; this.style(l, null); } }
  setColor(c) { this.color.set(c); for (const l of this.lights) if (!(l.userData.src || l.userData.was)?.color) l.color.copy(this.color); }
  // a light takes its source's own look, or the pool's
  style(l, s) { l.color.copy(s?.color || this.color); l.distance = s?.distance ?? this.distance; l.decay = s?.decay ?? this.decay; }
  setMul(m) { this.mul = m; }

  // range: priority counts only for sources within this x distance of the focus (view half-width + margin)
  update(focus, time, dt, { range = Infinity } = {}) {
    const S = this.sources;
    const order = this._order; order.length = 0;
    for (const s of S) {
      if (!s.enabled) continue;
      s.d = s.pos.distanceToSquared(focus);
      s.rank = s.priority > 0 && Math.abs(s.pos.x - focus.x) <= range ? s.priority : 0;
      order.push(s);
    }
    order.sort((a, b) => (b.rank - a.rank) || (a.d - b.d));
    const n = this.lights.length;
    const want = order.length > n ? order.slice(0, n) : order;
    // keep lights on sources that are still wanted to avoid popping; a released light keeps its source's look
    // (colour, reach) where it was until it has faded out
    const taken = new Set();
    for (const l of this.lights) {
      const s = l.userData.src;
      if (s && want.includes(s)) taken.add(s);
      else if (s) { l.userData.src = undefined; l.userData.was = s; }
    }
    for (const s of want) {
      if (taken.has(s)) continue;
      // the dimmest free light: a static source waits until one has faded out (no cut); a priority one takes it now
      let free = null;
      for (const l of this.lights) if (l.userData.src === undefined && (!free || l.intensity < free.intensity)) free = l;
      if (!free) break;
      if (!s.dynamic && free.intensity > 0.05) continue;
      free.userData.src = s; free.userData.was = undefined; free.position.copy(s.pos); free.intensity = 0; taken.add(s);
      this.style(free, s);
    }
    const k = 1 - Math.exp(-6 * dt);
    for (const l of this.lights) {
      const s = l.userData.src;
      if (s === undefined) {
        l.intensity += (0 - l.intensity) * k;
        if (l.userData.was && l.intensity < 0.01) { l.intensity = 0; l.userData.was = undefined; this.style(l, null); }
        continue;
      }
      if (s.dynamic) { l.position.copy(s.pos); l.intensity = s.intensity * this.mul; continue; }
      const flick = 0.88 + Math.sin(time * 9 + s.phase) * 0.07 + Math.sin(time * 23 + s.phase * 2) * 0.05;
      l.intensity += (s.intensity * this.mul * flick - l.intensity) * k;
    }
  }
}
