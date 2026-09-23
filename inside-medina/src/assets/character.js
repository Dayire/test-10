import * as THREE from 'three';
import { lathe, gridGeom } from './geom.js';

// Procedural, jointed characters. Local space: facing +Z, up +Y, left = +X.
// Every limb segment is a smooth tapered capsule parented to its joint.

function capsule(r0, r1, len, seg = 12) {
  // tapered capsule from y=0 (radius r0) down to y=-len (radius r1)
  const pts = [];
  const n = 6;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r0 + 1e-4, Math.cos(a) * r0)); }
  for (let i = 0; i <= n; i++) { const a = Math.PI / 2 + (i / n) * Math.PI / 2; pts.push(new THREE.Vector2(Math.sin(a) * r1 + 1e-4, -len + Math.cos(a) * r1)); }
  pts.reverse();
  const g = lathe(pts, seg);
  g.computeVertexNormals();
  return g;
}

function ellipsoid(rx, ry, rz, w = 24, h = 16) {
  const g = new THREE.SphereGeometry(1, w, h);
  g.scale(rx, ry, rz);
  return g;
}

export class Rig {
  constructor(spec, mats) {
    this.spec = spec;
    this.root = new THREE.Group();
    this.root.name = spec.name;
    this.j = {};
    this.meshes = [];
    const S = spec;
    const J = (name, parent, x, y, z) => { const o = new THREE.Group(); o.name = name; o.position.set(x, y, z); (parent ? this.j[parent] : this.root).add(o); this.j[name] = o; o.userData.rest = o.position.clone(); return o; };
    J('pelvis', null, 0, S.hipH, 0);
    J('spine', 'pelvis', 0, S.spine1, 0);
    J('chest', 'spine', 0, S.spine2, 0);
    J('neck', 'chest', 0, S.neckY, 0);
    J('head', 'neck', 0, S.headY, 0);
    for (const side of ['L', 'R']) {
      const sx = side === 'L' ? 1 : -1;
      J('shoulder' + side, 'chest', sx * S.shoulderX, S.shoulderY, 0);
      J('elbow' + side, 'shoulder' + side, 0, -S.upperArm, 0);
      J('wrist' + side, 'elbow' + side, 0, -S.foreArm, 0);
      J('hip' + side, 'pelvis', sx * S.hipX, -0.02, 0);
      J('knee' + side, 'hip' + side, 0, -S.thigh, 0);
      J('ankle' + side, 'knee' + side, 0, -S.shin, 0);
    }
    J('skirt', 'pelvis', 0, 0.02, 0);
    this.build(mats);
  }

  add(joint, geo, mat, cast = true) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast; m.receiveShadow = true;
    this.j[joint].add(m);
    this.meshes.push(m);
    return m;
  }

  build(mats) {
    const S = this.spec;
    const M = (n) => mats.get(n);
    const skin = M(S.skin), top = M(S.top), legs = M(S.legs), shoes = M('leather'), hair = M('hair');
    // torso: lathe with elliptical cross-section
    const tor = lathe([[0.0001, -0.02], [S.waist, 0], [S.waist * 1.02, S.spine2 * 0.5], [S.chestR, S.spine2 + 0.02], [S.chestR * 0.95, S.spine2 + S.neckY * 0.55], [S.neckR * 1.4, S.spine2 + S.neckY * 0.95], [0.0001, S.spine2 + S.neckY]], 20);
    tor.scale(1, 1, S.torsoDepth);
    tor.computeVertexNormals();
    this.add('spine', tor, top);
    // skirt / tunic hem, robe for adults
    const hemR = S.hemR, hemY = -S.hemLen;
    const sk = lathe([[0.0001, S.spine1 + 0.02], [S.waist * 1.03, S.spine1 + 0.01], [S.waist * 1.08, 0], [(S.waist + hemR) / 2 * 1.05, hemY * 0.5], [hemR, hemY], [hemR * 0.97, hemY - 0.012]], 24);
    sk.scale(1, 1, S.torsoDepth * 1.05);
    if (S.folds) {
      // soft vertical folds growing towards the hem
      const sp = sk.attributes.position;
      for (let i = 0; i < sp.count; i++) {
        const px = sp.getX(i), py = sp.getY(i), pz = sp.getZ(i);
        const t = Math.max(0, Math.min(1, -py / S.hemLen));
        const a = Math.atan2(pz, px);
        const k = 1 + S.folds * t * (Math.sin(a * 9) * 0.6 + Math.sin(a * 5 + 1.3) * 0.4);
        sp.setXYZ(i, px * k, py + (t > 0.97 ? Math.sin(a * 7) * 0.012 : 0), pz * k);
      }
      sk.computeVertexNormals();
    }
    this.add('skirt', sk, S.robe ? M(S.robe) : top);
    if (S.belt) {
      const belt = new THREE.TorusGeometry(S.waist * 1.06, 0.022, 6, 24); belt.rotateX(Math.PI / 2); belt.scale(1, 1, S.torsoDepth * 1.05); belt.translate(0, 0.02, 0);
      this.add('spine', belt, M(S.belt));
    }
    // neck + head
    this.add('neck', capsule(S.neckR, S.neckR, S.headY + 0.01, 10), S.hood ? M(S.robe) : skin);
    const head = S.hood ? ellipsoid(S.headR * 0.78, S.headR * 0.92, S.headR * 0.8) : ellipsoid(S.headR * 0.92, S.headR * 1.05, S.headR * 0.98);
    head.translate(0, S.headR * 0.75, S.headR * (S.hood ? -0.06 : 0.05));
    this.add('head', head, S.hood ? M(S.hood) : skin);
    if (!S.hood) {
      // hair shell: covers crown and back down to the nape, hairline high on the
      // forehead, tousled clumps and a jagged fringe along the front edge
      const R = S.headR, C = new THREE.Vector3(0, R * 0.75, R * 0.05);
      const hairG = gridGeom(40, 12, (u, v, p) => {
        const phi = u * Math.PI * 2;
        const front = (1 + Math.cos(phi)) / 2;
        const thMax = Math.PI * (0.72 - 0.36 * front);
        const th = v * thMax;
        const clump = 1 + 0.07 * Math.sin(phi * 9 + th * 5) * Math.sin(th * 3 + 1) + 0.04 * Math.sin(phi * 17 - th * 9);
        const tuck = 1 - 0.07 * Math.pow(v, 6);
        const fringe = v > 0.8 ? (v - 0.8) / 0.2 * front * 0.35 * Math.max(0, Math.sin(phi * 13)) : 0;
        const k = 1.08 * clump * tuck;
        p.set(Math.sin(th + fringe * 0.25) * Math.sin(phi) * R * 0.92 * k, Math.cos(th + fringe * 0.25) * R * 1.05 * k, Math.sin(th + fringe * 0.25) * Math.cos(phi) * R * 0.98 * k).add(C);
      }, { wrapU: true });
      this.add('head', hairG, hair);
      // ears: small flattened bumps so the head reads in profile
      for (const sx of [-1, 1]) { const ear = ellipsoid(R * 0.12, R * 0.2, R * 0.1, 8, 6); ear.translate(sx * R * 0.9, R * 0.72, R * 0.02); this.add('head', ear, skin, false); }
      const nose = ellipsoid(0.012, 0.018, 0.012, 8, 6); nose.translate(0, R * 0.72, R * 0.97);
      this.add('head', nose, skin, false);
    } else {
      // djellaba hood: rises to a peak that falls back behind the head, open
      // around a dark, faceless void
      const R = S.headR;
      const prof = [[1.62, -0.85], [1.38, -0.42], [1.2, 0.3], [1.1, 0.95], [0.86, 1.4], [0.58, 1.75], [0.36, 2.1], [0.2, 2.45], [0.08, 2.8], [0.01, 2.98]];
      const at = (v) => { const f = v * (prof.length - 1), i = Math.min(prof.length - 2, Math.floor(f)), t = f - i; return [prof[i][0] + (prof[i + 1][0] - prof[i][0]) * t, prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t]; };
      const hood = gridGeom(32, 20, (u, v, p) => {
        const [rr, yy] = at(v);
        const gap = v < 0.62 ? 1.25 * Math.sin(Math.min(1, v / 0.62) * Math.PI) ** 0.6 * (v > 0.05 ? 1 : v / 0.05) : 0;
        const phi = gap / 2 + u * (Math.PI * 2 - gap);
        const back = Math.pow(Math.max(0, (yy - 1.1) / 1.88), 1.6);
        const fold = 1 + 0.035 * Math.sin(phi * 7 + v * 4);
        const brim = Math.max(0, Math.cos(phi)) * 0.2 * Math.max(0, Math.sin(Math.min(1, Math.max(0, (yy - 1.0) / 1.0)) * Math.PI));
        p.set(Math.sin(phi) * rr * R * fold * (1 - 0.3 * back), (yy - 0.45 * back * back) * R, (Math.cos(phi) * rr * fold * 1.05 - 0.08 - back * 1.7 + brim) * R);
      });
      this.add('head', hood, M(S.robe));
      const face = ellipsoid(R * 0.7, R * 0.85, R * 0.55); face.translate(0, R * 0.72, R * 0.42);
      this.add('head', face, M('darkInterior'), false);
    }
    for (const side of ['L', 'R']) {
      this.add('shoulder' + side, capsule(S.armR * 1.25, S.armR * 1.05, S.upperArm, 12), S.sleeves ? top : skin);
      this.add('elbow' + side, capsule(S.armR * 1.0, S.armR * 0.8, S.foreArm, 12), S.longSleeves ? top : skin);
      if (S.wideSleeves) {
        const sl = new THREE.CylinderGeometry(S.armR * 1.15, S.armR * 2.1, S.foreArm * 0.55, 14, 1, true);
        sl.translate(0, -S.foreArm * 0.78, 0);
        this.add('elbow' + side, sl, top);
      }
      const hand = ellipsoid(S.armR * 0.95, S.armR * 1.35, S.armR * 0.75, 12, 8); hand.translate(0, -S.armR * 1.1, 0.004);
      this.add('wrist' + side, hand, skin);
      this.add('hip' + side, capsule(S.legR * 1.3, S.legR * 1.05, S.thigh, 12), legs);
      this.add('knee' + side, capsule(S.legR * 1.05, S.legR * 0.8, S.shin, 12), legs);
      const foot = new THREE.CapsuleGeometry(S.legR * 0.78, S.foot, 4, 10);
      foot.rotateX(Math.PI / 2); foot.scale(1, 0.7, 1); foot.translate(0, -S.legR * 0.55, S.foot * 0.35);
      this.add('ankle' + side, foot, shoes);
    }
    if (S.scarf) this.scarf = new Scarf(this, M('clothScarf'), S);
  }

  // Apply an absolute pose: { joints: { name: [x,y,z] }, pelvisY, rootLean }
  apply(p) {
    const j = this.j;
    for (const k in p.joints) {
      const o = j[k]; if (!o) continue;
      const a = p.joints[k];
      o.rotation.set(a[0], a[1], a[2]);
    }
    j.pelvis.position.y = this.spec.hipH + (p.pelvisY || 0);
    j.pelvis.position.z = p.pelvisZ || 0;
  }
}

// Verlet-simulated scarf tail anchored at the back of the neck
class Scarf {
  constructor(rig, mat, S) {
    this.rig = rig;
    this.n = 9;
    this.len = S.scarfLen || 0.42;
    this.seg = this.len / (this.n - 1);
    this.w = S.scarfW || 0.07;
    this.p = []; this.q = [];
    for (let i = 0; i < this.n; i++) { this.p.push(new THREE.Vector3()); this.q.push(new THREE.Vector3()); }
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(this.n * 2 * 3);
    const uv = new Float32Array(this.n * 2 * 2);
    const idx = [];
    for (let i = 0; i < this.n; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i / (this.n - 1); uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / (this.n - 1);
      if (i < this.n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx);
    this.geo = g;
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    this.anchor = new THREE.Object3D();
    this.anchor.position.set(0, S.neckY * 0.2, -S.chestR * S.torsoDepth * 0.9);
    rig.j.chest.add(this.anchor);
    // a wrap around the neck
    const wrap = new THREE.TorusGeometry(S.neckR * 1.9, S.neckR * 0.9, 8, 18);
    wrap.rotateX(Math.PI / 2 - 0.25); wrap.scale(1, 1, S.torsoDepth * 1.1);
    const wm = new THREE.Mesh(wrap, mat); wm.position.set(0, S.neckY * 0.35, 0); wm.castShadow = true;
    rig.j.chest.add(wm);
    this.inited = false;
    this._a = new THREE.Vector3(); this._side = new THREE.Vector3();
  }

  reset() { this.inited = false; }

  update(dt, wind) {
    this.anchor.updateWorldMatrix(true, false);
    const a = this._a.setFromMatrixPosition(this.anchor.matrixWorld);
    if (this.inited && this.p[0].distanceTo(a) > 1.0) this.inited = false;
    if (!this.inited) {
      for (let i = 0; i < this.n; i++) { this.p[i].set(a.x, a.y - i * this.seg, a.z - 0.01 * i); this.q[i].copy(this.p[i]); }
      this.inited = true;
    }
    dt = Math.min(dt, 1 / 30);
    const g = -9.8 * dt * dt;
    for (let i = 1; i < this.n; i++) {
      const p = this.p[i], q = this.q[i];
      const vx = (p.x - q.x) * 0.985, vy = (p.y - q.y) * 0.985, vz = (p.z - q.z) * 0.985;
      q.copy(p);
      const flutter = Math.sin(performance.now() * 0.009 + i * 1.3) * 0.25 + 0.75;
      p.x += vx + wind.x * dt * dt * flutter * (i / this.n);
      p.y += vy + g + wind.y * dt * dt;
      p.z += vz + wind.z * dt * dt * flutter * (i / this.n);
    }
    this.p[0].copy(a); this.q[0].copy(a);
    for (let it = 0; it < 14; it++) {
      for (let i = 0; i < this.n - 1; i++) {
        const p0 = this.p[i], p1 = this.p[i + 1];
        const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
        const diff = (d - this.seg) / d;
        if (i === 0) { p1.x -= dx * diff; p1.y -= dy * diff; p1.z -= dz * diff; }
        else { p0.x += dx * diff * 0.5; p0.y += dy * diff * 0.5; p0.z += dz * diff * 0.5; p1.x -= dx * diff * 0.5; p1.y -= dy * diff * 0.5; p1.z -= dz * diff * 0.5; }
      }
    }
    // ribbon: width faces the camera (cloth strip always shows its face), with a flutter twist
    const view = this._view || (this._view = new THREE.Vector3(0, 0, 1));
    for (let i = 0; i < this.n; i++) {
      const w = this.w * (1 - i / this.n * 0.3);
      const p = this.p[i];
      const q = this.p[Math.min(this.n - 1, i + 1)], o = this.p[Math.max(0, i - 1)];
      const dir = this._a.subVectors(q, o).normalize();
      const side = this._side.crossVectors(dir, view).normalize();
      const tw = Math.sin(performance.now() * 0.006 + i * 0.8) * 0.35 * (i / this.n);
      side.applyAxisAngle(dir, tw);
      this.pos[i * 6] = p.x - side.x * w / 2; this.pos[i * 6 + 1] = p.y - side.y * w / 2; this.pos[i * 6 + 2] = p.z - side.z * w / 2;
      this.pos[i * 6 + 3] = p.x + side.x * w / 2; this.pos[i * 6 + 4] = p.y + side.y * w / 2; this.pos[i * 6 + 5] = p.z + side.z * w / 2;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.computeVertexNormals();
  }
}

export const BOY = {
  name: 'boy', hipH: 0.6, spine1: 0.1, spine2: 0.2, neckY: 0.16, headY: 0.05, headR: 0.105,
  shoulderX: 0.118, shoulderY: 0.13, upperArm: 0.2, foreArm: 0.18, armR: 0.028,
  hipX: 0.066, thigh: 0.29, shin: 0.27, legR: 0.043, foot: 0.1,
  waist: 0.098, chestR: 0.118, neckR: 0.034, torsoDepth: 0.78, hemR: 0.15, hemLen: 0.2,
  skin: 'skin', top: 'clothRed', legs: 'clothTrousers', sleeves: true, longSleeves: false,
  scarf: true, scarfLen: 0.5, scarfW: 0.1, folds: 0.03,
};

export const GUARD = {
  name: 'guard', hipH: 0.92, spine1: 0.16, spine2: 0.3, neckY: 0.22, headY: 0.07, headR: 0.125,
  shoulderX: 0.2, shoulderY: 0.2, upperArm: 0.3, foreArm: 0.27, armR: 0.042,
  hipX: 0.1, thigh: 0.44, shin: 0.43, legR: 0.062, foot: 0.15,
  waist: 0.16, chestR: 0.2, neckR: 0.05, torsoDepth: 0.72, hemR: 0.34, hemLen: 0.78,
  skin: 'skin', top: 'robeGuard', legs: 'robeGuard', robe: 'robeGuard', hood: 'robeGuard', sleeves: true, longSleeves: true,
  scarf: false, folds: 0.06, belt: 'leather', wideSleeves: true,
};

export function createCharacter(spec, mats) {
  return new Rig(spec, mats);
}
// Note: character GLB overrides (boy / guard) must be rigged with the joint names
// listed in docs/ASTRA_ASSET_BRIEF.md; the procedural animator drives those joints.
