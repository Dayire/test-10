import * as THREE from 'three';

// A fixed pool of point lights reassigned each frame to the lanterns nearest
// the camera focus. The light count never changes, so shaders never recompile
// mid-game, and each pixel only pays for a handful of lights.
export class LightPool {
  constructor(scene, n = 4, { color = 0xffa550, distance = 6, decay = 1.8 } = {}) {
    this.lights = [];
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(color, 0, distance, decay);
      l.userData.target = 0;
      scene.add(l);
      this.lights.push(l);
    }
    this.sources = []; // { pos: Vector3, intensity, phase }
    this._order = [];
  }
  add(pos, intensity = 2.5, phase = 0) { this.sources.push({ pos: pos.clone(), intensity, phase, slot: -1 }); }
  update(focus, time, dt) {
    const S = this.sources;
    for (const s of S) s.d = s.pos.distanceToSquared(focus);
    const order = this._order; order.length = 0;
    for (let i = 0; i < S.length; i++) order.push(i);
    order.sort((a, b) => S[a].d - S[b].d);
    const want = order.slice(0, this.lights.length);
    // keep lights on sources that are still wanted to avoid popping
    const taken = new Set();
    for (const l of this.lights) { const si = l.userData.src; if (si !== undefined && want.includes(si)) taken.add(si); else l.userData.src = undefined; }
    for (const si of want) {
      if (taken.has(si)) continue;
      const free = this.lights.find((l) => l.userData.src === undefined);
      if (!free) break;
      free.userData.src = si; free.position.copy(S[si].pos); free.intensity = 0; taken.add(si);
    }
    const k = 1 - Math.exp(-6 * dt);
    for (const l of this.lights) {
      const si = l.userData.src;
      if (si === undefined) { l.intensity += (0 - l.intensity) * k; continue; }
      const s = S[si];
      const flick = 0.88 + Math.sin(time * 9 + s.phase) * 0.07 + Math.sin(time * 23 + s.phase * 2) * 0.05;
      l.intensity += (s.intensity * flick - l.intensity) * k;
    }
  }
}
