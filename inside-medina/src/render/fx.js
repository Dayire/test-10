import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Particles } from './particles.js';
import { patchMaterial } from './atmosphere.js';

// Small pooled effects: dust puffs (landings, crate impacts, footfalls) and pigeons that scatter
// when the boy runs close. Both are GPU-batched: puffs are GPU particles (one draw), the whole
// flock is three instanced draws (body, head, wings) however many birds there are.

export class Dust {
  constructor(scene, n = 48) {
    this.sys = new Particles({ capacity: Math.max(32, n * 2) });
    this.sys.group.name = 'dust';
    scene.add(this.sys.group);
    this.time = 0;
  }
  emit(pos, { count = 8, spread = 0.5, up = 0.6, life = 0.9, size = 0.5, alpha = 0.35, color = 0xc7a882 } = {}) {
    this.sys.emit('dust', pos, { count, spread: spread * 0.9, speed: 1, dir: { x: 0, y: up, z: 0 }, life: [life * 0.7, life * 1.3], size: [size * 0.8, size * 1.6], alpha, color });
  }
  update(dt) { this.time += Math.min(dt, 0.1); this.sys.update(this.time); }
  dispose() { this.sys.dispose(); }
}

// --- pigeons -----------------------------------------------------------------
function pigeonParts() {
  const body = new THREE.SphereGeometry(0.1, 10, 8); body.scale(0.8, 0.75, 1.6);
  const tail = new THREE.ConeGeometry(0.05, 0.14, 6); tail.rotateX(-Math.PI / 2 - 0.3); tail.translate(0, 0.02, -0.19);
  const head = new THREE.SphereGeometry(0.055, 8, 6); head.translate(0, 0.07, 0.14);
  const strip = (g) => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k); return g; };
  const wing = new THREE.BufferGeometry();
  wing.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.08, 0.32, 0, -0.02, 0, 0, -0.1], 3));
  wing.computeVertexNormals();
  return { body: mergeGeometries([strip(body), strip(tail)]), head: strip(head), wing };
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1);
const _e = new THREE.Euler(), _w = new THREE.Matrix4(), _h = new THREE.Matrix4(), _mir = new THREE.Matrix4().makeScale(-1, 1, 1), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);

export class Flock {
  constructor(scene, mats, spots) {
    this.birds = [];
    for (const s of spots) {
      for (let i = 0; i < s.n; i++) {
        const home = new THREE.Vector3(s.x + (Math.random() - 0.5) * s.w, s.y, s.z + (Math.random() - 0.5) * 0.8);
        this.birds.push({ pos: home.clone(), home, yaw: Math.random() * Math.PI * 2, head: 0, flap: 0.05, state: 'idle', t: Math.random() * 5, v: new THREE.Vector3(), peck: Math.random() * 3 });
      }
    }
    const n = Math.max(1, this.birds.length);
    const parts = pigeonParts();
    this.mat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
    this.wingMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }));
    this.body = new THREE.InstancedMesh(parts.body, this.mat, n);
    this.head = new THREE.InstancedMesh(parts.head, this.mat, n);
    this.wings = new THREE.InstancedMesh(parts.wing, this.wingMat, n * 2);
    this.geos = [parts.body, parts.head, parts.wing];
    this.group = new THREE.Group(); this.group.name = 'flock';
    const c = new THREE.Color();
    for (const [k, im] of [['body', this.body], ['head', this.head], ['wings', this.wings]]) {
      im.frustumCulled = false; // birds fly far from their spots; three draws whatever the view
      im.castShadow = k !== 'wings'; im.receiveShadow = true;
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    }
    this.birds.forEach((b, i) => {
      // grey to warm grey, darker wings
      const v = 0.85 + Math.random() * 0.3, warm = Math.random() * 0.06;
      c.setHex(0x7c7a82).multiplyScalar(v); c.r += warm; this.body.setColorAt(i, c); this.head.setColorAt(i, c);
      c.setHex(0x5f5c66).multiplyScalar(v); this.wings.setColorAt(i * 2, c); this.wings.setColorAt(i * 2 + 1, c);
    });
    if (!this.birds.length) { this.body.count = this.head.count = this.wings.count = 0; }
    scene.add(this.group);
    this.write();
  }
  reset() { for (const b of this.birds) { b.state = 'idle'; b.pos.copy(b.home); b.head = 0; b.flap = 0.05; } this.write(); }
  update(dt, px, py, speed, onScatter) {
    for (const b of this.birds) {
      b.t += dt;
      if (b.state === 'idle') {
        // peck and shuffle
        b.peck -= dt;
        if (b.peck < 0) { b.peck = 0.6 + Math.random() * 2.5; b.yaw += (Math.random() - 0.5) * 1.2; }
        b.head = Math.max(0, Math.sin(b.t * 9) * 0.03) * (b.peck < 0.3 ? 1 : 0);
        b.flap = 0.05;
        const d = Math.hypot(b.home.x - px, b.home.y - py);
        if (d < (speed > 2.5 ? 3.2 : 1.6)) {
          b.state = 'fly'; b.t = 0;
          const dir = Math.sign(b.home.x - px) || 1;
          b.v.set(dir * (2.2 + Math.random() * 1.5), 3.2 + Math.random() * 1.5, -1.5 - Math.random() * 2.5);
          b.yaw = Math.atan2(b.v.x, b.v.z);
          onScatter && onScatter(b.home.x);
        }
      } else if (b.state === 'fly') {
        b.v.y += 0.8 * dt;
        b.pos.addScaledVector(b.v, dt);
        b.flap = Math.sin(b.t * 38) * 1.1;
        if (b.t > 5) b.state = 'gone';
      }
    }
    this.write();
  }
  write() {
    this.birds.forEach((b, i) => {
      if (b.state === 'gone') { this.body.setMatrixAt(i, _zero); this.head.setMatrixAt(i, _zero); this.wings.setMatrixAt(i * 2, _zero); this.wings.setMatrixAt(i * 2 + 1, _zero); return; }
      _q.setFromAxisAngle(Y, b.yaw);
      _m.compose(b.pos, _q, _s);
      this.body.setMatrixAt(i, _m);
      _h.makeTranslation(0, b.head, 0); this.head.setMatrixAt(i, _w.multiplyMatrices(_m, _h));
      _h.makeRotationFromEuler(_e.set(0, 0, b.flap));
      this.wings.setMatrixAt(i * 2, _w.multiplyMatrices(_m, _h));
      this.wings.setMatrixAt(i * 2 + 1, _w.multiplyMatrices(_m, _mir).multiply(_h));
    });
    this.body.instanceMatrix.needsUpdate = this.head.instanceMatrix.needsUpdate = this.wings.instanceMatrix.needsUpdate = true;
  }
  dispose() {
    for (const g of this.geos) g.dispose();
    this.mat.dispose(); this.wingMat.dispose();
    for (const im of [this.body, this.head, this.wings]) im.dispose();
    this.group.removeFromParent();
  }
}
