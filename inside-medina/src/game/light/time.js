import * as THREE from 'three';
import { keyed } from './logic.js';

const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// The Terminator (FULL_GAME §6.2): the height T below which the low sun no longer reaches.
// (a) Gameplay: sources with clipByTerminator die while their y ≤ T + 0.3.
// (b) Visual: an invisible shadow caster (no colour, no depth) parallel to the play plane, placed toward the sun
//     at 0.4 × the sun shadow camera's distance from the view's focus, its top edge at T + D·sunDir.y: its shadow
//     edge on the play plane sits at T, level across the view. It is drawn into the sun's shadow map only: every
//     camera pass (and any other light's shadow map) skips its draw, so it costs no rasterisation on screen.
// T follows `keys` ([[x, T], ...], on the boy's x: Chapter IV) unless a SunClock drives it. range [x0, x1]: the stretch
// of the play plane it shades (a chapter may have several): the slab is cut to it in light space, so its ends are
// fixed in the world (a shadow edge on the facades, never a pop as the view moves); without a range it follows the
// view. Snapshot {T}.
export class Terminator {
  constructor(game, { id, T = 0, keys = null, visual = true, range = null } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.T = keys ? keyed(keys, game.player?.x ?? 0) : T; this.keys = keys; this.range = range;
    this.isTerminator = true; this.liveUnderTitle = true;
    this.driven = false;
    if (visual) {
      const m = this.mesh = new THREE.Mesh(new THREE.BoxGeometry(140, 80, 0.6), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }));
      m.castShadow = true; m.receiveShadow = false; m.frustumCulled = false;
      m.userData.noProxy = true; m.userData.terminator = true;
      m.renderOrder = -10;
      const geo = m.geometry, all = geo.drawRange.count;
      // an empty draw range (count -1) makes the renderer return before drawing
      m.onBeforeRender = () => { geo.drawRange.count = -1; };
      m.onAfterRender = () => { geo.drawRange.count = all; };
      m.onBeforeShadow = (r, o, cam, shadowCam) => { geo.drawRange.count = shadowCam === game.world.light?.sun?.shadow?.camera ? all : -1; };
      m.onAfterShadow = () => { geo.drawRange.count = all; };
      game.add(m);
    }
    this._f = new THREE.Vector3();
  }
  step() { if (this.keys && !this.driven) this.T = keyed(this.keys, this.game.player.x); }
  render() {
    const m = this.mesh; if (!m) return;
    const g = this.game, d = g.director.sunDir, cr = g.camRig;
    const lk = cr.override ? cr.curLook : cr.look;
    const D = 0.4 * 80; // Lighting puts the sun 80 m from the focus along sunDir
    const fz = -2;
    // a sun under the horizon or straight above has no terminator line to draw
    const R = this.range, half = (g.viewHalfW || 12) + 30;
    m.visible = d.y > -0.2 && Math.abs(d.z) > 0.15 && (!R || (lk.x + half > R[0] && lk.x - half < R[1]));
    const zs = fz + D * d.z, s = (zs - fz) / d.z;
    const top = this.T + s * d.y;
    // a play-plane point (x, y, fz) meets the slab at x + s·d.x
    if (R) { m.scale.x = (R[1] - R[0]) / 140; m.position.set((R[0] + R[1]) / 2 + s * d.x, top - 40, zs); }
    else { m.scale.x = 1; m.position.set(lk.x, top - 40, zs); }
    m.updateMatrixWorld();
  }
  getState() { return { T: this.T }; }
  setState(s) { this.T = s.T; }
}

// The sunset clock (FULL_GAME §3.2 II-E2): once started, the terminator rises from T0 at `rate` m/s (assist:
// +50 % time) and the look blends `from` → `to` over the first `sec` seconds (the sun swings to the horizon, so
// shadows lengthen diegetically). When T + 0.3 reaches `y` (the last ray's height) the light is gone: onExpire,
// or the boy kneels into the dark (death 'sunset'). finish(sec): the race is won and the sun sets over `sec` (the
// terminator climbs past the last ray; nobody dies). A respawn restores {t, running, expired, setT}.
export class SunClock {
  constructor(game, { id, T0 = 4, rate = 0.16, y = 12, terminator = null, look = null, onExpire = null, onReset = null } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.T0 = T0; this.rate = rate; this.y = y; this.terminator = terminator; this.look = look; this.onExpire = onExpire; this.onReset = onReset;
    this.t = 0; this.running = false; this.expired = false; this.tickT = 0;
    this.setT = -1; this.setSec = 6; // the sunset after a win: seconds into it (-1: not set)
  }
  get speed() { return this.rate / (this.game.assist ? 1.5 : 1); }
  get duration() { return (this.y - 0.3 - this.T0) / this.speed; }
  get T() { return this.T0 + this.speed * this.t; }
  get left() { return Math.max(0, this.duration - this.t); }
  start() {
    if (this.running || this.expired || this.setT >= 0) return;
    this.running = true; this.t = 0;
    if (this.terminator) this.terminator.driven = true;
    this.game.emit('clock', { id: this.id, on: true, duration: this.duration });
  }
  stop() { this.running = false; this.game.emit('clock', { id: this.id, on: false }); }
  // won: the sun sets over sec seconds from wherever the clock stands
  finish(sec = 6) {
    if (this.setT >= 0) return;
    const was = this.running;
    this.running = false; this.setT = 0; this.setSec = sec;
    if (was) this.game.emit('clock', { id: this.id, on: false, won: true });
    this.applySet();
  }
  // the terminator from the clock's height up past the ray (+0.6 m) as the sun sets
  applySet() {
    const tm = this.terminator; if (!tm) return;
    tm.driven = true;
    tm.T = this.T + (this.y + 0.6 - this.T) * smooth(this.setT / this.setSec);
  }
  apply() {
    if (this.terminator && (this.running || this.t > 0)) { this.terminator.T = this.T; this.terminator.driven = true; }
    if (this.look) this.game.director.blendAt(this.look.from, this.look.to, smooth(this.t / (this.look.sec ?? 8)));
  }
  step(dt) {
    if (this.setT >= 0) { if (this.setT < this.setSec) { this.setT = Math.min(this.setSec, this.setT + dt); this.applySet(); } return; }
    if (!this.running) return;
    this.t += dt;
    this.apply();
    // the tick hurries as the light climbs
    const u = this.t / this.duration;
    this.tickT -= dt;
    if (this.tickT <= 0) { this.tickT = 1.0 - 0.6 * u; this.game.sfx('sunsetTick', this.game.player.x, { urgency: u }); }
    if (this.T + 0.3 >= this.y - 1e-9) {
      this.running = false; this.expired = true;
      this.game.emit('clock', { id: this.id, on: false, expired: true });
      if (this.onExpire) this.onExpire(this); else this.game.player.die('sunset');
    }
  }
  getState() { return { t: this.t, running: this.running, expired: this.expired, setT: this.setT }; }
  setState(s) {
    this.t = s.t; this.running = s.running; this.expired = s.expired; this.setT = s.setT ?? -1;
    if (this.terminator) { this.terminator.driven = this.running || this.t > 0; if (this.terminator.driven) this.terminator.T = this.T; else this.terminator.T = this.T0; }
    if (this.running || this.t > 0) this.apply();
    else this.onReset?.(this);
    if (this.setT >= 0) { this.setT = Math.min(this.setT, this.setSec); this.applySet(); }
  }
}

// A hatch (FULL_GAME §5.2 IV-D): a solid with a hinged leaf; opens over 0.8 s while its source is > 0.5, and its
// solid is gone once it swings past half way. Snapshot {open}.
export class Hatch {
  constructor(game, { id, x0, x1, y0, y1, source = null, hinge = 'right', mat = 'woodDark', z0 = -1.2, z1 = 1.2 } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.x0 = x0; this.x1 = x1; this.y0 = y0; this.y1 = y1; this.source = source; this.hinge = hinge;
    this.solid = game.phys.addSolid(x0, y0, x1, y1, { ledges: false, surface: 'wood', kind: 'hatch' });
    this.open = 0; this.moving = false;
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), game.mats.get(mat));
    leaf.castShadow = true; leaf.receiveShadow = true;
    const s = hinge === 'right' ? 1 : -1;
    leaf.position.set(-s * (x1 - x0) / 2, (y1 - y0) / 2, (z0 + z1) / 2);
    if (!leaf.geometry.attributes.color) { const n = leaf.geometry.attributes.position.count; leaf.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3)); }
    const g = this.mesh = new THREE.Group();
    g.position.set(hinge === 'right' ? x1 : x0, y0, 0);
    g.add(leaf);
    game.add(g);
  }
  step(dt) {
    const want = this.source ? (this.source() > 0.5 ? 1 : 0) : this.open;
    const prev = this.open;
    this.open += Math.sign(want - this.open) * Math.min(Math.abs(want - this.open), dt / 0.8);
    this.solid.enabled = this.open < 0.5;
    const moving = this.open !== prev;
    if (moving && !this.moving) this.game.sfx('hatch', (this.x0 + this.x1) / 2);
    this.moving = moving;
  }
  render() { this.mesh.rotation.z = (this.hinge === 'right' ? 1 : -1) * smooth(this.open) * 1.75; }
  getState() { return { open: this.open }; }
  setState(s) { this.open = s.open; this.solid.enabled = this.open < 0.5; }
}
