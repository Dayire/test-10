import * as THREE from 'three';
import { Body } from '../physics.js';
import { DEG, NOTCH, angleOf, alphaFor, notchOf } from './trace.js';
import { magnet } from './logic.js';
import { trayMesh, mirrorStand, axleMesh, crankBracket, crankHandle } from '../../assets/lightprops.js';

const TILT = 25 * DEG; // trays lean toward the camera so their polished face shows (visual only, §6.1)
const RATE = 100;      // degrees per second: one 15° notch in 0.15 s
const lerp = (a, b, t) => a + (b - a) * t;
// the angle among a + 180k nearest to `ref` (a tray at α and α + 180 is the same line)
const nearestTurn = (a, ref) => a + 180 * Math.round((ref - a) / 180);

// A mirror (FULL_GAME §6.2). kind:
//   wheeled    a 0.7 × 0.8 stand (Body kind 'mirror', pushable, ledges, weight 0.5): crate grip pushes and pulls
//              it unchanged; vertical input or a pointer tilts the tray in 15° notches
//   anchored   the same stand, but it never moves (walk away to let go)
//   crank      a tray on a wall bracket at a fixed pivot, turned by a Crank
//   continuous the heliostat: any angle, turned by a Capstan
// The tray pivots at pivotH above the stand's base (1.2); r is its radius. alpha animates toward target (0.15 s
// a notch); settled once it arrives. A wheeled mirror outside its zone (or below killY) fades and comes back at
// home after 2 s. Snapshot {x, y, alpha}.
export class Mirror {
  constructor(game, { id, kind = 'wheeled', x, y = 0, alpha = 0, r = 0.4, pivotH = 1.2, home = null, zone = null, killY = -4, thetaHint = null, range, oneSided = false, enabled = true, wallZ = -1.6, mesh = true, z = 0 } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.kind = kind; this.r = r; this.pivotH = pivotH; this.oneSided = oneSided; this.enabled = enabled;
    this.isMirror = true;
    this.notchDeg = kind === 'continuous' ? 0.5 : NOTCH;
    this.alpha = alpha; this.target = alpha;
    this.thetaHint = thetaHint; this._inTheta = null;
    this.range = range !== undefined ? range : (kind === 'wheeled' || kind === 'anchored' ? [-90, 90] : null);
    this.zone = zone; this.killY = killY; this.lostT = 0; this.vis = 1;
    this.z = z;
    if (kind === 'wheeled' || kind === 'anchored') {
      const b = this.body = new Body(x, y, 0.7, 0.8, { kind: 'mirror', mass: 2, surface: 'wood', weight: 0.5, anchored: kind === 'anchored', owner: this, ledgeL: true, ledgeR: true });
      b.mirror = this;
      game.phys.addBody(b);
      this.home = home || { x, y, alpha };
    } else { this.px = x; this.py = y; this.home = home || { x, y, alpha }; }
    this.prev = new THREE.Vector2(this.bx, this.by);
    this.rollT = 0; this.aimT = 0; this._aim = null;
    if (mesh) this.build(wallZ);
  }
  get bx() { return this.body ? this.body.x : this.px; }
  get by() { return this.body ? this.body.y : this.py; }
  // the tray's pivot (what the tracer reads)
  get x() { return this.body ? this.body.x : this.px; }
  get y() { return this.body ? this.body.y + this.pivotH : this.py; }
  get notch() { return notchOf(this.alpha); }
  get settled() { return Math.abs(this.alpha - this.target) < 1e-6; }

  build(wallZ) {
    const g = this.game, M = g.mats;
    const root = this.mesh = new THREE.Group();
    const pivot = this.pivotG = new THREE.Group();
    if (this.body) {
      root.add(mirrorStand(M, { kind: this.kind, pivotH: this.pivotH, r: this.r }));
      pivot.position.set(0, this.pivotH, 0);
    } else if (this.kind === 'crank') {
      root.add(crankBracket(M, { len: Math.max(0.3, this.z - wallZ), r: this.r }));
    }
    root.add(pivot);
    const tilt = new THREE.Group(); tilt.rotation.x = TILT;
    this.tray = trayMesh(M, { r: this.r });
    tilt.add(this.tray);
    pivot.add(tilt);
    if (this.kind !== 'continuous') pivot.add(axleMesh(M, { r: this.r }));
    root.position.set(this.bx, this.by, this.z);
    pivot.rotation.z = this.alpha * DEG;
    g.add(root);
  }

  // one notch toward d (+1 / -1); false at the end of the tray's travel
  nudge(d, player = null) {
    let t = this.target + d * this.notchDeg;
    if (this.range) t = Math.max(this.range[0], Math.min(this.range[1], t));
    if (t === this.target) { this.game.sfx('notch', this.x, { notch: notchOf(t), stop: true }); return false; }
    this.target = t;
    this.game.sfx('notch', this.x, { notch: notchOf(t) });
    this.game.emit('notch', { id: this.id, notch: notchOf(t), alpha: t });
    return true;
  }
  set(alpha, { snap = false } = {}) {
    this.target = this.range ? Math.max(this.range[0], Math.min(this.range[1], alpha)) : alpha;
    if (snap) this.alpha = this.target;
  }

  // finger / mouse aim (FULL_GAME §6.3): the beam should leave toward p. α* = (θr* + θi) / 2, θi the beam that
  // lights the tray now (or thetaHint), rounded to a notch; with aim snap, a neighbouring notch that lights a
  // target wins over one that lights nothing
  aimAt(p, player = null) {
    if (!p) return;
    const thI = this._inTheta ?? this.thetaHint;
    if (thI === null || thI === undefined) return;
    if (this._aim && Math.abs(this._aim.x - p.x) < 0.04 && Math.abs(this._aim.y - p.y) < 0.04 && this._aimTh === thI && this.aimT > 0) return;
    this._aim = { x: p.x, y: p.y }; this._aimTh = thI; this.aimT = 0.08;
    const want = alphaFor(thI, angleOf(p.x - this.x, p.y - this.y));
    const st = this.notchDeg;
    let a = Math.round(nearestTurn(want, this.target) / st) * st;
    if (this.range) a = Math.max(this.range[0], Math.min(this.range[1], a));
    const snap = this.game.settings?.aimSnap !== false && this.kind !== 'continuous' && this.system;
    if (snap && !this.system.probe(this, a)) {
      for (const n of [a + st, a - st]) {
        if (this.range && (n < this.range[0] || n > this.range[1])) continue;
        if (this.system.probe(this, n)) { a = n; break; }
      }
    }
    if (a !== this.target) {
      const steps = Math.round(Math.abs(a - this.target) / st);
      this.target = a;
      this.game.sfx('notch', this.x, { notch: notchOf(a), steps });
      this.game.emit('notch', { id: this.id, notch: notchOf(a), alpha: a, aim: true });
    }
  }

  gripped(on) { if (on) this.game.sfx('mirrorGrip', this.x); }
  // the height of the rim the boy holds, above his feet (animator)
  rimHeight(player) {
    const c = Math.cos(this.alpha * DEG) * this.r, s = Math.sin(this.alpha * DEG) * this.r;
    const near = Math.abs(this.x + c - player.x) < Math.abs(this.x - c - player.x) ? this.y + s : this.y - s;
    return Math.max(0.55, Math.min(1.7, near - player.y));
  }

  prestep() { this.prev.set(this.bx, this.by); }
  step(dt) {
    this.aimT -= dt;
    if (this.alpha !== this.target) {
      const d = this.target - this.alpha;
      this.alpha = Math.abs(d) <= RATE * dt ? this.target : this.alpha + Math.sign(d) * RATE * dt;
    }
    const b = this.body;
    if (!b) return;
    if (Math.abs(b.x - this.prev.x) > 1e-4 && b.grounded) {
      this.rollT -= dt;
      if (this.rollT <= 0) { this.rollT = 0.1; this.game.sfx('mirrorRoll', b.x, { speed: Math.abs(b.x - this.prev.x) / dt }); }
    }
    // lost: off its zone or fallen: fades, then returns home after 2 s
    const out = (this.zone && (b.x < this.zone.x0 || b.x > this.zone.x1)) || b.y < this.killY;
    if (out || this.lostT > 0) {
      if (this.lostT === 0) { this.game.emit('mirrorLost', { id: this.id, x: b.x }); if (this.game.player.grip === b) { this.game.player.grip = null; this.game.player.latch = false; } }
      this.lostT += dt;
      if (this.lostT > 0.45) b.enabled = false;
      if (this.lostT >= 2) this.respawn();
    }
  }
  respawn() {
    const b = this.body, h = this.home;
    b.x = h.x; b.y = h.y; b.vx = 0; b.vy = 0; b.enabled = true; b.grounded = false;
    this.alpha = this.target = h.alpha;
    this.prev.set(b.x, b.y);
    this.lostT = 0; this.vis = 0.01;
    this.game.dust?.emit(new THREE.Vector3(b.x, b.y, 0), { count: 10, spread: 0.8, size: 0.6, alpha: 0.3 });
    this.game.emit('mirrorHome', { id: this.id });
  }

  render(alpha, dt) {
    if (!this.mesh) return;
    const x = lerp(this.prev.x, this.bx, alpha), y = lerp(this.prev.y, this.by, alpha);
    this.mesh.position.set(x, y, this.z);
    this.pivotG.rotation.z = this.alpha * DEG;
    // lost: sink and shrink; home again: grow back
    const want = this.lostT > 0 ? Math.max(0, 1 - this.lostT / 0.45) : 1;
    this.vis += (want - this.vis) * (1 - Math.exp(-(this.lostT > 0 ? 30 : 8) * dt));
    const v = Math.max(0.001, this.vis);
    this.mesh.scale.setScalar(v);
    this.mesh.visible = v > 0.01;
  }
  getState() { return this.body ? { x: this.body.x, y: this.body.y, alpha: this.target } : { alpha: this.target, enabled: this.enabled }; }
  setState(s) {
    if (this.body) { const b = this.body; b.x = s.x; b.y = s.y; b.vx = 0; b.vy = 0; b.enabled = true; b.grounded = false; this.prev.set(b.x, b.y); }
    else if (s.enabled !== undefined) this.enabled = s.enabled;
    this.alpha = this.target = s.alpha; this.lostT = 0; this.vis = 1; this._aim = null;
  }
}

// A crank (FULL_GAME §6.3): hold grab beside its handle; ↑/↓ step the mirror's notches (one at once, then every
// 0.22 s), or a pointer aims it; only the jump button jumps from it. dir: the side of the handle the boy stands on
// (-1 left, as a lever). The handle's wheel turns with the tray; a rope runs from the wheel to the bracket.
export class Crank {
  constructor(game, { id, x, y = 0, mirror, dir = -1, z = -0.35, rope = true } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.x = x; this.y = y; this.mirror = mirror; this.dir = dir; this.z = z;
    this.isInteractable = true; this.sunwork = true; this.playerState = 'crank';
    this.faceDir = -dir; this.held = false; this.wheel = 0; this.t = 0;
    const g = this.mesh = crankHandle(game.mats);
    g.position.set(x, y, z);
    game.add(g);
    if (rope && mirror) {
      const a = new THREE.Vector3(x, y + 0.92 + 0.24, z + 0.11), b = new THREE.Vector3(mirror.x, mirror.y + 0.075, -(mirror.r + 0.09));
      const len = a.distanceTo(b);
      const geo = new THREE.CylinderGeometry(0.008, 0.008, len, 5); geo.translate(0, len / 2, 0);
      const rm = new THREE.Mesh(geo, game.mats.get('ropeMat'));
      rm.position.copy(a); rm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      rm.castShadow = true;
      game.add(rm);
    }
  }
  get standX() { return this.x + this.dir * 0.55; }
  near(px, py) { return Math.abs(px - this.standX) < 0.45 && Math.abs(py - this.y) < 0.3; }
  grab(player) { this.held = true; player.facing = this.faceDir; this.game.sfx('crank', this.x, { grab: true }); }
  release() { this.held = false; }
  drive(inp, dt, player) {
    const b = player.body;
    b.x += (this.standX - b.x) * Math.min(1, dt * 14); b.vx = 0;
    const d = player.notchInput(inp, dt, 1); // up raises the tray (+α) whichever side he stands
    if (d) { if (this.mirror.nudge(d, player)) this.game.sfx('crank', this.x); }
    else if (inp.aimTarget && Math.abs(inp.y) < 0.6) this.mirror.aimAt(inp.aimTarget, player);
  }
  step(dt) { this.t = this.held ? Math.min(1, this.t + dt * 4) : Math.max(0, this.t - dt * 4); }
  render() {
    // geared: the wheel turns twice for the tray
    this.wheel = -this.mirror.alpha * DEG * 2;
    this.mesh.userData.wheel.rotation.z = this.wheel;
  }
  getState() { return {}; }
  setState() { this.held = false; }
}

// The capstan (FULL_GAME §5.2 IV-E): hold grab at its bar; ←/→ turn the continuous mirror at `rate` °/s, or a
// pointer sets the angle directly. Within ±window of the solution, with the input released, the magnet eases the
// mirror onto it in 0.4 s (every device gets it: it is not an assist).
export class Capstan {
  constructor(game, { id, x, y = 0, mirror, dir = -1, rate = 6, magnet: mg = null, range = [-20, 60], z = -0.2, mesh = true } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.x = x; this.y = y; this.mirror = mirror; this.dir = dir; this.rate = rate; this.mag = mg; this.range = range; this.z = z;
    this.isInteractable = true; this.sunwork = true; this.playerState = 'capstan';
    this.faceDir = -dir; this.held = false; this.speed = 0; this.input = false; this.loopT = 0;
    if (mesh) {
      const g = this.mesh = crankHandle(game.mats, { h: 1.0, wr: 0.34 });
      g.position.set(x, y, z);
      game.add(g);
    }
  }
  get standX() { return this.x + this.dir * 0.6; }
  near(px, py) { return Math.abs(px - this.standX) < 0.5 && Math.abs(py - this.y) < 0.3; }
  grab(player) { this.held = true; player.facing = this.faceDir; this.game.sfx('capstan', this.x, { grab: true }); }
  release() { this.held = false; this.input = false; this.speed = 0; }
  drive(inp, dt, player) {
    const b = player.body, m = this.mirror;
    b.x += (this.standX - b.x) * Math.min(1, dt * 14); b.vx = 0;
    let v = 0;
    if (Math.abs(inp.x) > 0.2) v = Math.sign(inp.x) * this.rate * Math.min(1, Math.abs(inp.x) / 0.75) * (this.game.settings?.invertTilt ? -1 : 1);
    else if (inp.aimTarget) {
      const thI = m._inTheta ?? m.thetaHint ?? 180;
      const want = nearestTurn(alphaFor(thI, angleOf(inp.aimTarget.x - m.x, inp.aimTarget.y - m.y)), m.alpha);
      v = Math.max(-this.rate * 2, Math.min(this.rate * 2, (want - m.alpha) / Math.max(dt, 1e-3)));
    }
    this.input = v !== 0;
    this.turn(v * dt);
    this.speed = v;
  }
  turn(d) {
    const m = this.mirror;
    const a = Math.max(this.range[0], Math.min(this.range[1], m.alpha + d));
    m.alpha = m.target = a;
  }
  step(dt) {
    const m = this.mirror;
    if (this.mag && !(this.held && this.input)) { const a = magnet(m.alpha, this.mag.alpha, this.mag.window ?? 2, true, dt); m.alpha = m.target = a; }
    if (this.held && this.input) { this.loopT -= dt; if (this.loopT <= 0) { this.loopT = 0.12; this.game.sfx('capstan', this.x, { speed: Math.abs(this.speed) }); } }
  }
  render() { if (this.mesh) this.mesh.userData.wheel.rotation.z = -this.mirror.alpha * DEG * 6; }
  getState() { return {}; }
  setState() { this.held = false; this.input = false; this.speed = 0; }
}
