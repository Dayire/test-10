import * as THREE from 'three';
import { DEG, angleOf, TARGET, BODY, MIRROR, OCCLUDER } from './trace.js';
import { chargeLevel, heatStep } from './logic.js';
import { BeamLamp } from './sources.js';
import { rosetteLock, sensorMesh, ropeMesh, lightTextures, lightMaterials } from '../../assets/lightprops.js';
import { particles } from '../../render/particles.js';
import { tube } from '../../assets/geom.js';

const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const glintSprite = (game, scale = 0.6) => {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightTextures().glint, color: new THREE.Color(3, 2.4, 1.6), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  s.scale.setScalar(scale); s.renderOrder = 7;
  return s;
};

// A sun-lock (FULL_GAME §6.2, §6.5): a light-only circle (r 0.35) that charges at 1/chargeT while lit with
// I ≥ need and decays at 1/decayT; below need it shows I/need (petals half open) and never charges past it.
// mode latch: done at 1 for good; hold: done while full; bolt: the iron inverse lock (its petals close while lit,
// a gate driven by 1 − level opens in the dark). metal gold | silver (moon-locks, need 0.4) | iron (bolts).
// degree: the step of the chapter's maqam its singing bowl sounds. rod: a brass rod polyline [[x, y, z], ...]
// along which a glint travels to the mechanism when it latches. Snapshot {level, done}.
export class SunLock {
  constructor(game, { id, x, y, z = 0, r = 0.35, need, mode = 'latch', chargeT = 0.6, decayT = 0.5, metal, degree = 0, mount = 1.6, rod = null, onOpen = null, rides = null, mesh = true } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.mode = mode; this.metal = metal || (mode === 'bolt' ? 'iron' : 'gold');
    this.need = need ?? (this.metal === 'silver' ? 0.4 : 0.8);
    this.px = x; this.py = y; this.z = z; this.r = r; this.rides = rides;
    this.chargeT = chargeT; this.decayT = decayT; this.degree = degree; this.onOpen = onOpen;
    this.isTarget = true; this.shape = 'circle'; this.kind = mode === 'bolt' ? 'bolt' : 'lock';
    this.level = 0; this.done = false; this.lit = false; this.I = 0;
    this.shown = 0; this.glow = 0; this.sndT = 0; this.rodT = -1;
    if (mesh) {
      this.mesh = rosetteLock(game.mats, { r, metal: this.metal, mount });
      this.mesh.position.set(this.x, this.y, z);
      game.add(this.mesh);
      if (rod) this.buildRod(rod);
    }
  }
  get x() { return this.rides ? this.rides.body.x + (this.rides.ox || 0) : this.px; }
  get y() { return this.rides ? this.rides.body.y + (this.rides.oy || 0) : this.py; }
  buildRod(pts) {
    const g = this.game;
    lightMaterials(g.mats);
    const V = pts.map((p) => new THREE.Vector3(...p));
    this.rodCurve = new THREE.CatmullRomCurve3(V, false, 'centripetal', 0.1);
    const m = new THREE.Mesh(tube(V, 0.022, Math.max(8, V.length * 6), 6), g.mats.get('brassAged'));
    m.castShadow = true;
    g.add(m);
    this.rodGlint = glintSprite(g, 0.9);
    g.add(this.rodGlint);
  }
  onLight(I, dt) {
    this.I = I; this.lit = I >= this.need - 1e-9;
    if (this.mode === 'latch' && this.done) return;
    const was = this.level;
    this.level = chargeLevel(this.level, I, this.need, dt, this.chargeT, this.decayT);
    if (this.mode === 'latch' && this.level >= 1) this.open();
    else if (this.mode !== 'latch') {
      const full = this.level >= 1;
      if (full !== this.done) {
        this.done = full;
        if (this.mode === 'bolt') this.game.sfx(full ? 'boltShut' : 'lockOpen', this.x, { degree: this.degree, bolt: true });
        else if (full) this.game.sfx('lockOpen', this.x, { degree: this.degree, hold: true });
      }
    }
    // the singing bowl follows the level while light touches it
    this.sndT -= dt;
    if (I > 0 && this.level > 0.02 && this.level !== was && this.sndT <= 0) { this.sndT = 0.1; this.game.sfx('lockCharge', this.x, { level: this.level, degree: this.degree }); }
  }
  open() {
    if (this.done) return;
    this.done = true; this.level = 1;
    this.game.sfx('lockOpen', this.x, { degree: this.degree });
    this.game.audio?.stinger?.('lockOpen', { degree: this.degree });
    this.game.emit('lockOpen', { id: this.id, degree: this.degree });
    this.rodT = 0;
    this.onOpen?.(this);
  }
  // gate sources: 1 when open (latched, full), for bolts 1 when dark
  get value() { return this.mode === 'bolt' ? 1 - this.level : this.mode === 'latch' ? (this.done ? 1 : 0) : (this.level >= 1 ? 1 : 0); }
  render(alpha, dt) {
    if (!this.mesh) return;
    if (this.rides) this.mesh.position.set(this.x, this.y, this.z);
    const U = this.mesh.userData;
    const want = this.mode === 'bolt' ? 1 - this.level : this.level;
    this.shown += (want - this.shown) * (1 - Math.exp(-10 * dt));
    U.setOpen(smooth(this.shown)); // re-composes the petals only when they move
    // the lens: an ember while charging, a steady warm glow when open, hot iron on a lit bolt; it stays under the
    // bloom threshold so the petals keep their silhouette against it (the light touching the lock is the halo
    // the beam renderer draws around the rim)
    const flick = this.lit ? 0.9 + 0.1 * Math.sin(this.game.time * 23 + this.px) : 1;
    const g = (this.mode === 'bolt' ? this.level * 1.3 : this.level * 0.9 + (this.done ? 0.35 : 0)) * flick + (this.I > 0 ? 0.15 : 0);
    this.glow += (g - this.glow) * (1 - Math.exp(-8 * dt));
    U.lensMat.emissiveIntensity = 0.05 + this.glow;
    const hc = !!this.game.settings?.highContrast;
    if (U.rim && U.rim.visible !== hc) U.rim.visible = hc;
    if (this.rodGlint) {
      if (this.rodT >= 0) {
        this.rodT += dt;
        const k = Math.min(1, this.rodT / 1.3);
        this.rodGlint.position.copy(this.rodCurve.getPointAt(smooth(k)));
        this.rodGlint.material.opacity = (k < 1 ? 1 : Math.max(0, 1 - (this.rodT - 1.3) / 0.8)) * (this.game.settings?.reduceFlashing ? 0.55 : 1);
        this.rodGlint.scale.setScalar(k < 1 ? 0.9 : 0.9 + (this.rodT - 1.3) * 2);
        if (this.rodT > 2.2) this.rodT = -1;
      } else this.rodGlint.material.opacity = 0;
    }
  }
  getState() { return { level: this.level, done: this.done }; }
  setState(s) { this.level = s.level; this.done = s.done; this.shown = this.mode === 'bolt' ? 1 - s.level : s.level; this.rodT = -1; this.I = 0; this.lit = false; }
}

// a photocell: a hold-mode sun-lock, r 0.15, charging in 0.08 s, that may ride a body (C4's lift)
export class Photocell extends SunLock {
  constructor(game, o = {}) { super(game, { r: 0.15, mode: 'hold', chargeT: 0.08, decayT: 0.08, mount: 0.3, ...o }); this.kind = 'photocell'; }
}

// A lamp's eye (FULL_GAME §6.2): a circle at the lamp; reflected light (not the lamp's own beam, and not a
// direct ray) held on it for 0.1 s dazzles the lamp (7 s, +50 % with assist) or calls onHit. It re-arms once
// the lamp sees again and the reflection has left it for half a second. `face` (deg): an eye behind a window that
// looks that way only sees light travelling toward it (the fortress lamp looks east, so a ray sent back
// west-to-east never counts).
export class LampEye {
  constructor(game, { id, x, y, z = -8, r = 0.8, lamp = null, onHit = null, hold = 0.1, dazzle = 7, face = null } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.x = x; this.y = y; this.z = z; this.r = r; this.lamp = lamp; this.onHit = onHit; this.hold = hold; this.dazzle = dazzle; this.face = face;
    this.isTarget = true; this.shape = 'circle'; this.kind = 'eye';
    this.t = 0; this.off = 0; this.fired = false; this.I = 0; this.lit = false; this.level = 0;
    this.wantsLight = !!(lamp || onHit);
  }
  onLight(I, dt, sys) {
    const Ir = this._Ir || 0; // reflected light only
    this.I = Ir; this.lit = Ir > 0;
    // refractory: a blind lamp (dazzled, or its beam still settling) neither re-arms nor fires; once it sees
    // again the eye re-arms after half a second without a reflection (the sweep has carried the beam away)
    const blind = !!this.lamp?.blind;
    if (Ir > 0) { this.t += dt; this.off = 0; } else { this.t = 0; if (!blind) { this.off += dt; if (this.off > 0.5) this.fired = false; } }
    this.level = Math.min(1, this.t / this.hold);
    if (!this.fired && !blind && this.t >= this.hold - 1e-9) {
      this.fired = true;
      const sec = this.dazzle * (this.game.assist ? 1.5 : 1);
      this.lamp?.dazzle?.(sec);
      this.onHit?.(this);
      this.game.emit('dazzle', { id: this.id, sec });
    }
  }
  getState() { return { fired: this.fired }; }
  setState(s) { this.fired = !!s.fired; this.t = 0; this.off = 0; this.I = 0; this.lit = false; }
}

// what broke a beam, as the thing a turret darts: the boy, a guard, a crate's body, a mirror...
function occluderOf(game, h) {
  if (!h || !h.obj) return null;
  if (h.kind === BODY) { const b = h.obj; if (b === game.player.body) return game.player; return b.owner || b; }
  return h.obj;
}
const posOf = (o, out) => {
  if (!o) return null;
  const b = o.body || o;
  if (b.x !== undefined && b.y !== undefined && b.h !== undefined) return out.set(b.x, b.y + b.h * 0.55, 0);
  if (o.x0 !== undefined) return out.set((o.x0 + o.x1) / 2, (o.y0 + o.y1) / 2, 0);
  return out.set(o.x ?? 0, o.y ?? 0, 0);
};

// A tripwire (FULL_GAME §4, §6.2): a beam lamp at `from` throws a thin beam to the sensor at `to`. Dark for more
// than 0.2 s → the alarm: the horn, the dart turret fixes on whatever broke the beam (it needs no line of sight),
// a slaved searchlight fixates it, and 1.05 s later the turret darts it: the boy dies ('shot'), a guard sleeps
// (stun(Infinity)), anything else takes a harmless dart. The alarm clears 4 s after the line is restored.
// Snapshot {state}.
export class Sensor {
  constructor(game, { id, from, to, darkT = 0.2, turret = true, lamp = null, I = 1, z = 0, mesh = true } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.from = from; this.to = to; this.darkT = darkT; this.turret = turret; this.lamp = lamp; this.z = z;
    this.x = to[0]; this.y = to[1]; this.r = 0.07;
    this.isTarget = true; this.shape = 'circle'; this.kind = 'sensor';
    this.state = 'clear'; this.dark = 0; this.alarmT = 0; this.clearT = 0; this.darted = false; this.target = null;
    this.lit = true; this.I = 0; this.level = 1;
    this._p = new THREE.Vector3(); this._q = new THREE.Vector3();
    this.source = new BeamLamp(game, { id: (id || 'sensor') + '.lamp', x: from[0], y: from[1], angle: angleOf(to[0] - from[0], to[1] - from[1]), I, z, mesh });
    this.source.sensor = this;
    this.dartFx = null;
    if (mesh) {
      const m = this.mesh = sensorMesh(game.mats);
      m.position.set(to[0] + Math.cos(this.source.angle * DEG) * 0.09, to[1], z);
      m.rotation.y = 0;
      game.add(m);
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.002, 0.18, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 2.2, 1.4) }));
      d.visible = false; game.add(d); this.dartMesh = d;
    }
  }
  attach(sys) { sys.add(this.source); }
  onLight(I, dt, sys) {
    const R = sys.results.get(this.source);
    const end = R && R.on ? R.hits[R.hits.length - 1] : null;
    this.lit = !!(end && end.kind === TARGET && end.obj === this);
    this.I = this.lit ? end.I : 0;
    if (this.lit) {
      this.dark = 0;
      if (this.state === 'alarm') { this.clearT += dt; if (this.clearT >= 4) this.clear(); }
      return;
    }
    if (!R || !R.on) return; // a lamp switched off is no alarm
    this.dark += dt; this.clearT = 0;
    const occ = occluderOf(this.game, end);
    if (this.dark > this.darkT) {
      if (this.state !== 'alarm') this.alarm(occ);
      else if (occ && occ !== this.target && this.darted) this.alarm(occ); // a new body in a line still broken
    }
  }
  alarm(occ) {
    this.state = 'alarm'; this.target = occ; this.alarmT = 0; this.darted = false; this.clearT = 0;
    this.game.sfx('alarm', this.x, { tripwire: true });
    this.game.emit('alarm', { id: this.id, by: occ === this.game.player ? 'boy' : occ?.constructor?.name || 'thing' });
    this.lamp?.fixate?.(occ, { while: () => this.state === 'alarm' && this.target === occ });
  }
  clear() { this.state = 'clear'; this.target = null; this.alarmT = 0; this.darted = false; this.clearT = 0; }
  step(dt) {
    // the line hums while the boy is within 3 m of it: a cue to look for it at night
    if ((this.humT = (this.humT ?? 0) - dt) <= 0) {
      this.humT = 0.1;
      const p = this.game.player, [ax, ay] = this.from, [bx, by] = this.to;
      const dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y + 0.6 - ay) * dy) / (dx * dx + dy * dy || 1)));
      const qx = ax + dx * u, d = Math.hypot(p.x - qx, p.y + 0.6 - (ay + dy * u));
      if (d < 3 && this.source.enabled !== false && !p.dead) this.game.sfx('tripHum', qx, { level: (1 - d / 3) * 0.6 });
    }
    if (this.state !== 'alarm') return;
    this.alarmT += dt;
    if (!this.darted && this.alarmT >= 1.05) this.dart();
  }
  dart() {
    this.darted = true;
    const o = this.target, g = this.game, pl = g.player;
    this.dartT = 0;
    if (o === pl) { if (!pl.dead) { g.sfx('dart', pl.x); pl.die('shot'); } }
    else if (o?.stun) { g.sfx('dartGuard', o.body?.x ?? this.x); o.stun(Infinity); }
    else g.sfx('turret', this.x);
    g.emit('dart', { id: this.id, at: o === pl ? 'boy' : o?.constructor?.name || 'thing' });
  }
  render(alpha, dt) {
    if (!this.mesh) return;
    const U = this.mesh.userData;
    // the eye watches the beam's far end, and snaps onto whatever broke it
    const tgt = this.state === 'alarm' && this.target ? posOf(this.target, this._q) : this._q.set(this.from[0], this.from[1], 0);
    const e = U.eye;
    e.getWorldPosition(this._p);
    const yaw = Math.atan2(-(tgt.z - this._p.z), tgt.x - this._p.x), pitch = Math.atan2(tgt.y - this._p.y, Math.hypot(tgt.x - this._p.x, tgt.z - this._p.z));
    const k = 1 - Math.exp(-(this.state === 'alarm' ? 18 : 4) * dt);
    e.rotation.y += (yaw - e.rotation.y) * k; e.rotation.z += (pitch - e.rotation.z) * k;
    const a = this.state === 'alarm' ? 0.5 + 0.5 * Math.sin(this.game.time * 30) : 0;
    U.cellMat.color.setRGB(0.9 + a * 4, 0.5 + a, 0.2).multiplyScalar(this.lit ? 1.6 : 0.4);
    U.irisMat.color.setRGB(0.05 + a * 3, 0.03, 0.02);
    if (this.dartMesh) {
      if (this.darted && this.dartT !== undefined && this.dartT < 0.16) {
        this.dartT += dt;
        const k2 = Math.min(1, this.dartT / 0.14);
        const p0 = this._p, p1 = posOf(this.target, this._q) || p0;
        const d = this.dartMesh;
        d.visible = k2 < 1; d.position.lerpVectors(p0, p1, k2);
        d.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
      } else this.dartMesh.visible = false;
    }
  }
  getState() { return { state: this.state }; }
  setState(s) { this.clear(); this.dark = 0; if (s?.state === 'alarm') this.state = 'clear'; }
}

// A hemp rope (FULL_GAME §3.2 II-D2): sums the light of every beam on it; at `need` it heats to burnt in burnT,
// cooling at `cool`/s otherwise; any light makes it smoulder (smoke, then embers). Burnt: it snaps and onBurnt
// runs (the counterweight falls). Snapshot {heat, burnt}.
export class BurnRope {
  constructor(game, { id, x0, y0, x1, y1, need = 1.6, burnT = 1.5, cool = 0.5, onBurnt = null, mesh = true } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.need = need; this.burnT = burnT; this.cool = cool; this.onBurnt = onBurnt;
    this.isTarget = true; this.shape = 'box'; this.kind = 'rope';
    this.heat = 0; this.burnt = false; this.I = 0; this.lit = false; this.fxT = 0; this.fallT = -1;
    if (mesh) {
      const len = y1 - y0 + 0.6;
      this.mesh = ropeMesh(game.mats, { len });
      this.mesh.position.set((x0 + x1) / 2, y1 + 0.3, 0);
      game.add(this.mesh);
    }
  }
  get enabled() { return !this.burnt; }
  get level() { return this.heat; }
  onLight(I, dt) {
    this.I = I; this.lit = I >= this.need - 1e-9;
    if (this.burnt) return;
    this.heat = heatStep(this.heat, I, this.need, dt, this.burnT, this.cool);
    if (I > 0) {
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = this.lit ? 0.12 : 0.3;
        const p = { x: (this.x0 + this.x1) / 2, y: this.y0 + (this.y1 - this.y0) * 0.5, z: 0.05 };
        particles.emit('smoke', p, { count: this.lit ? 2 : 1, spread: 0.15, size: [0.2, 0.45], alpha: 0.35 });
        if (this.heat > 0.2 || this.lit) particles.emit('embers', p, { count: this.lit ? 4 : 1, spread: 0.12, speed: 0.6 });
        this.game.sfx('ropeSmoulder', p.x, { heat: this.heat });
      }
    }
    if (this.heat >= 1) this.snap();
  }
  snap() {
    if (this.burnt) return;
    this.burnt = true; this.heat = 1; this.fallT = 0;
    const p = { x: (this.x0 + this.x1) / 2, y: (this.y0 + this.y1) / 2, z: 0.05 };
    particles.emit('embers', p, { count: 26, spread: 0.4, speed: 1.6 });
    particles.emit('smoke', p, { count: 6, spread: 0.3 });
    this.game.sfx('ropeSnap', p.x);
    this.game.audio?.stinger?.('ropeSnap');
    this.game.emit('ropeSnap', { id: this.id });
    this.onBurnt?.(this);
  }
  render(alpha, dt) {
    if (!this.mesh) return;
    if (this.fallT >= 0 && this.fallT < 1.4) {
      this.fallT += dt;
      this.mesh.position.y = this.y1 + 0.3 - 0.5 * 9.8 * this.fallT * this.fallT * 0.3;
      this.mesh.rotation.z = this.fallT * 0.8;
      this.mesh.visible = this.fallT < 1.3;
    } else if (!this.burnt) { this.mesh.visible = true; this.mesh.position.y = this.y1 + 0.3; this.mesh.rotation.z = Math.sin(this.game.time * 1.3) * 0.015 + (this.I > 0 ? Math.sin(this.game.time * 9) * 0.01 : 0); }
    else this.mesh.visible = false;
  }
  getState() { return { heat: this.heat, burnt: this.burnt }; }
  setState(s) { this.heat = s.heat; this.burnt = s.burnt; this.fallT = -1; this.I = 0; }
}

// A box that blocks only light (FULL_GAME §6.2): laundry lifted by a gust, a shutter. to({y0, y1}, sec) animates
// it. mesh: an optional object that follows the box's centre. Snapshot {y0, y1}.
export class Occluder {
  constructor(game, { id, x0, y0, x1, y1, mesh = null } = {}) {
    this.game = game; if (id !== undefined) this.id = id;
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1; this.enabled = true;
    this.isOccluder = true; this.anim = null; this.mesh = mesh;
    this.base = { y0, y1 };
    if (mesh) { this.meshOff = mesh.position.y - (y0 + y1) / 2; }
  }
  to({ y0 = this.y0, y1 = this.y1, x0 = this.x0, x1 = this.x1 }, sec = 1) { this.anim = { from: { x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1 }, to: { x0, y0, x1, y1 }, t: 0, sec }; }
  step(dt) {
    const a = this.anim; if (!a) return;
    a.t = Math.min(1, a.t + dt / a.sec);
    const k = smooth(a.t);
    for (const f of ['x0', 'y0', 'x1', 'y1']) this[f] = a.from[f] + (a.to[f] - a.from[f]) * k;
    if (a.t >= 1) this.anim = null;
  }
  render() { if (this.mesh) { this.mesh.position.y = (this.y0 + this.y1) / 2 + this.meshOff; this.mesh.position.x = (this.x0 + this.x1) / 2; } }
  getState() { return { x0: this.x0, y0: this.y0, x1: this.x1, y1: this.y1 }; }
  setState(s) { Object.assign(this, { x0: s.x0, y0: s.y0, x1: s.x1, y1: s.y1 }); this.anim = null; }
}
