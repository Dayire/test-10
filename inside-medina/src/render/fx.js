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
const _e = new THREE.Euler(), _w = new THREE.Matrix4(), _h = new THREE.Matrix4(), _mir = new THREE.Matrix4().makeScale(-1, 1, 1);
const Y = new THREE.Vector3(0, 1, 0);

// The camera's view on the play plane (z = 0), written by the renderer every frame: the x it looks at and
// the half-width it sees there. Systems that draw only what is near use it, so menu, intro and cinematic
// shots far from the boy still show what is in frame.
const _vd = new THREE.Vector3();
export const VIEW = {
  x: 0, half: 0, valid: false,
  from(camera) {
    camera.getWorldDirection(_vd);
    const p = camera.position, t = _vd.z < -0.05 ? -p.z / _vd.z : 0;
    this.x = p.x + _vd.x * Math.min(t, 400);
    const depth = Math.max(Math.abs(p.z), Math.hypot(this.x - p.x, p.z));
    this.half = camera.isPerspectiveCamera ? depth * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect : 30;
    this.valid = true;
  },
};

// Pigeons: three instanced draws (body, head, wings) for the whole flock. Each frame the birds within
// RANGE metres of the boy, or inside the camera's view, are packed at the front of the instance buffers
// and the draw count is cut to them, with bounds around just those, so a stretch of the level without
// birds costs no draw at all.
const RANGE = 30;
export class Flock {
  constructor(scene, mats, spots) {
    this.birds = [];
    for (const s of spots) {
      for (let i = 0; i < s.n; i++) {
        const home = new THREE.Vector3(s.x + (Math.random() - 0.5) * s.w, s.y, s.z + (Math.random() - 0.5) * 0.8);
        // grey to warm grey, darker wings
        const v = 0.85 + Math.random() * 0.3, warm = Math.random() * 0.06;
        const color = new THREE.Color(0x7c7a82).multiplyScalar(v); color.r += warm;
        const wing = new THREE.Color(0x5f5c66).multiplyScalar(v);
        this.birds.push({ pos: home.clone(), home, yaw: Math.random() * Math.PI * 2, head: 0, flap: 0.05, state: 'idle', t: Math.random() * 5, v: new THREE.Vector3(), peck: Math.random() * 3, color, wing });
      }
    }
    const n = Math.max(1, this.birds.length);
    const parts = pigeonParts();
    this.geos = [parts.body, parts.head, parts.wing];
    this.mat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }));
    this.wingMat = patchMaterial(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide }));
    this.body = new THREE.InstancedMesh(parts.body, this.mat, n);
    this.head = new THREE.InstancedMesh(parts.head, this.mat, n);
    this.wings = new THREE.InstancedMesh(parts.wing, this.wingMat, n * 2);
    this.meshes = [this.body, this.head, this.wings];
    this.group = new THREE.Group(); this.group.name = 'flock';
    this.meshes.forEach((im, k) => {
      im.castShadow = k !== 2; im.receiveShadow = true; im.userData.smallCaster = true; // no pigeon shadows on low / medium
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.setColorAt(0, this.birds[0]?.color || new THREE.Color()); // allocate the colour buffer
      im.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this.group.add(im);
    });
    this.focusX = this.birds.length ? this.birds[0].home.x : 0;
    this.drawn = 0;
    scene.add(this.group);
    this.write();
  }
  reset() { for (const b of this.birds) { b.state = 'idle'; b.pos.copy(b.home); b.head = 0; b.flap = 0.05; } this.write(); }
  update(dt, px, py, speed, onScatter) {
    this.focusX = px;
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
    const { body, head, wings } = this;
    let k = 0;
    const vx = VIEW.x, vh = VIEW.valid ? VIEW.half + 4 : -1;
    for (const b of this.birds) {
      if (b.state === 'gone' || (Math.abs(b.pos.x - this.focusX) > RANGE && Math.abs(b.pos.x - vx) > vh)) continue;
      _q.setFromAxisAngle(Y, b.yaw);
      _m.compose(b.pos, _q, _s);
      body.setMatrixAt(k, _m); body.setColorAt(k, b.color);
      _h.makeTranslation(0, b.head, 0); head.setMatrixAt(k, _w.multiplyMatrices(_m, _h)); head.setColorAt(k, b.color);
      _h.makeRotationFromEuler(_e.set(0, 0, b.flap));
      wings.setMatrixAt(k * 2, _w.multiplyMatrices(_m, _h));
      wings.setMatrixAt(k * 2 + 1, _w.multiplyMatrices(_m, _mir).multiply(_h));
      wings.setColorAt(k * 2, b.wing); wings.setColorAt(k * 2 + 1, b.wing);
      k++;
    }
    this.drawn = k;
    body.count = head.count = k; wings.count = k * 2;
    for (const im of this.meshes) {
      im.visible = k > 0;
      if (!k) continue;
      im.instanceMatrix.clearUpdateRanges(); im.instanceMatrix.addUpdateRange(0, im.count * 16); im.instanceMatrix.needsUpdate = true;
      im.instanceColor.clearUpdateRanges(); im.instanceColor.addUpdateRange(0, im.count * 3); im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
    }
  }
  dispose() {
    for (const g of this.geos) g.dispose();
    this.mat.dispose(); this.wingMat.dispose();
    for (const im of this.meshes) im.dispose();
    this.group.removeFromParent();
  }
}
