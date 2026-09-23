import * as THREE from 'three';

// Side-scrolling rail camera. Shot parameters are key-framed along x and
// blended with smoothstep; the focus follows the player with look-ahead and
// a vertical dead-zone, and everything is smoothed by critically damped springs.

const KEYS = ['dist', 'height', 'lookY', 'fov', 'ahead', 'side', 'yBias', 'focusBias', 'dofNear', 'dofFar', 'pitchBias'];
const DEF = { dist: 12.5, height: 1.4, lookY: 1.3, fov: 34, ahead: 1.6, side: 0, yBias: 0, focusBias: 0, dofNear: 10, dofFar: 5, pitchBias: 0 };

function spring(cur, vel, target, omega, dt) {
  // critically damped spring (exact integration)
  const x = cur - target;
  const e = Math.exp(-omega * dt);
  const nx = (x + (vel + omega * x) * dt) * e;
  const nv = (vel - omega * (vel + omega * x) * dt) * e;
  return [target + nx, nv];
}

export class CameraRig {
  constructor(camera) {
    this.cam = camera;
    this.keys = [];
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.look = new THREE.Vector3(); this.lvel = new THREE.Vector3();
    this.fov = DEF.fov; this.fovVel = 0;
    this.groundY = 0;
    this.aheadX = 0;
    this.shake = 0; this.shakeT = 0;
    this.override = null; this.overrideW = 0; this.overrideTarget = 0;
    this.ovPos = new THREE.Vector3(); this.ovLook = new THREE.Vector3(); this.ovFov = 40;
    this.params = { ...DEF };
    this.snapNext = true;
  }

  setKeys(keys) { this.keys = keys.slice().sort((a, b) => a.x - b.x); }

  paramsAt(x) {
    const k = this.keys; const out = this.params;
    if (!k.length) return Object.assign(out, DEF);
    if (x <= k[0].x) return Object.assign(out, DEF, k[0]);
    if (x >= k[k.length - 1].x) return Object.assign(out, DEF, k[k.length - 1]);
    let i = 0; while (k[i + 1].x < x) i++;
    const a = { ...DEF, ...k[i] }, b = { ...DEF, ...k[i + 1] };
    let t = (x - a.x) / (b.x - a.x); t = t * t * (3 - 2 * t);
    for (const n of KEYS) out[n] = a[n] + (b[n] - a[n]) * t;
    return out;
  }

  addShake(a) { this.shake = Math.min(1, this.shake + a); }

  // scripted shot: fn(dt) -> {pos, look, fov}; weight blends in over `blend` seconds
  setOverride(fn, blend = 1.5) { this.override = fn; this.overrideTarget = 1; this.blendRate = 1 / blend; }
  clearOverride(blend = 1.0) { this.overrideTarget = 0; this.blendRate = 1 / blend; }

  update(dt, player, ppos, facing, grounded) {
    const p = this.paramsAt(ppos.x);
    // vertical focus: follow the ground level of the player, not every jump
    const st = player.state;
    const settle = grounded || st === 'hang' || st === 'climb' || st === 'climbUp' || st === 'lever';
    if (settle) this.groundY += (ppos.y - this.groundY) * (1 - Math.exp(-3.2 * dt));
    else if (ppos.y < this.groundY - 0.4) this.groundY += (ppos.y + 0.4 - this.groundY) * (1 - Math.exp(-5 * dt));
    else if (ppos.y > this.groundY + 1.6) this.groundY += (ppos.y - 1.6 - this.groundY) * (1 - Math.exp(-5 * dt));
    const aheadT = facing * p.ahead * (st === 'climb' ? 0.2 : 1);
    this.aheadX += (aheadT - this.aheadX) * (1 - Math.exp(-1.1 * dt));
    const fx = ppos.x + this.aheadX + p.focusBias;
    const fy = this.groundY + p.yBias;
    const tp = new THREE.Vector3(fx + p.side, fy + p.height, p.dist);
    const tl = new THREE.Vector3(fx, fy + p.lookY + p.pitchBias, 0);
    if (this.snapNext) { this.pos.copy(tp); this.look.copy(tl); this.vel.set(0, 0, 0); this.lvel.set(0, 0, 0); this.fov = p.fov; this.snapNext = false; }
    const wx = 3.2, wy = 2.4, wz = 1.6;
    [this.pos.x, this.vel.x] = spring(this.pos.x, this.vel.x, tp.x, wx, dt);
    [this.pos.y, this.vel.y] = spring(this.pos.y, this.vel.y, tp.y, wy, dt);
    [this.pos.z, this.vel.z] = spring(this.pos.z, this.vel.z, tp.z, wz, dt);
    [this.look.x, this.lvel.x] = spring(this.look.x, this.lvel.x, tl.x, wx, dt);
    [this.look.y, this.lvel.y] = spring(this.look.y, this.lvel.y, tl.y, wy, dt);
    [this.look.z, this.lvel.z] = spring(this.look.z, this.lvel.z, tl.z, wz, dt);
    [this.fov, this.fovVel] = spring(this.fov, this.fovVel, p.fov, 1.5, dt);

    let pos = this.pos, look = this.look, fov = this.fov;
    // scripted override blending
    if (this.override || this.overrideW > 0) {
      this.overrideW += Math.sign(this.overrideTarget - this.overrideW) * Math.min(Math.abs(this.overrideTarget - this.overrideW), dt * (this.blendRate || 1));
      if (this.override) {
        const o = this.override(dt);
        this.ovPos.copy(o.pos); this.ovLook.copy(o.look); this.ovFov = o.fov;
      }
      const w = this.overrideW * this.overrideW * (3 - 2 * this.overrideW);
      pos = this.pos.clone().lerp(this.ovPos, w);
      look = this.look.clone().lerp(this.ovLook, w);
      fov = this.fov + (this.ovFov - this.fov) * w;
      if (this.overrideW <= 0 && this.overrideTarget === 0) this.override = null;
    }
    // shake
    this.shakeT += dt;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const s = this.shake * this.shake * 0.12;
    const cam = this.cam;
    cam.position.set(pos.x + Math.sin(this.shakeT * 37) * s, pos.y + Math.sin(this.shakeT * 43 + 1) * s, pos.z);
    // subtle handheld drift for life
    const drift = 0.025;
    cam.position.x += Math.sin(this.shakeT * 0.31) * drift;
    cam.position.y += Math.sin(this.shakeT * 0.23 + 2) * drift;
    cam.lookAt(look.x, look.y, look.z);
    if (Math.abs(cam.fov - fov) > 1e-3) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.focusDist = cam.position.distanceTo(new THREE.Vector3(ppos.x, ppos.y + 0.8, 0));
    this.dofNear = p.dofNear; this.dofFar = p.dofFar;
    return p;
  }
}
