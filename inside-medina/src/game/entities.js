import * as THREE from 'three';
import { Body, GRAVITY, EPS } from './physics.js';
import { crateMesh, lanternMesh } from '../assets/props.js';
import { createCharacter, GUARD } from '../assets/character.js';
import { Animator } from './animator.js';
import { archOutline } from '../assets/architecture.js';
import { extrude, worldUV, setColor } from '../assets/geom.js';

const lerp = (a, b, t) => a + (b - a) * t;

// ------------------------------------------------------------------ crate
export class Crate {
  constructor(game, x, y, size = 1) {
    this.game = game;
    this.body = new Body(x, y, size, size, { kind: 'crate', mass: 3, surface: 'wood' });
    game.phys.addBody(this.body);
    this.mesh = crateMesh(game.mats, size);
    this.mesh.position.set(x, y, 0);
    game.scene.add(this.mesh);
    this.prev = new THREE.Vector2(x, y);
    this.moveSnd = 0;
    this.tilt = 0;
  }
  prestep() { this.prev.set(this.body.x, this.body.y); }
  getState() { const b = this.body; return { x: b.x, y: b.y }; }
  setState(s) { const b = this.body; b.x = s.x; b.y = s.y; b.vx = 0; b.vy = 0; b.grounded = false; this.prev.set(s.x, s.y); }
  render(alpha, dt) {
    const b = this.body;
    const x = lerp(this.prev.x, b.x, alpha), y = lerp(this.prev.y, b.y, alpha);
    // topple visual when not fully supported while falling
    const target = !b.grounded ? THREE.MathUtils.clamp(b.vx * 0.15, -0.3, 0.3) : 0;
    this.tilt += (target - this.tilt) * (1 - Math.exp(-8 * dt));
    this.mesh.position.set(x, y, 0);
    this.mesh.rotation.z = -this.tilt;
  }
}

// ------------------------------------------------------------------ plate
export class Plate {
  constructor(game, x0, x1, y) {
    this.game = game;
    this.x0 = x0; this.x1 = x1; this.y = y;
    this.solid = game.phys.addSolid(x0, y - 0.3, x1, y, { ledges: false, surface: 'stone', kind: 'plate' });
    this.depress = 0; this.load = 0;
    const g = new THREE.BoxGeometry(x1 - x0 - 0.04, 0.12, 1.4);
    worldUV(g); setColor(g, 0xffffff);
    const gg = worldUV(new THREE.BoxGeometry(x1 - x0 - 0.04, 0.12, 1.4));
    setColor(gg, 0xd8d0c0);
    this.mesh = new THREE.Mesh(gg, game.mats.get('limestone'));
    this.mesh.receiveShadow = true; this.mesh.castShadow = true;
    this.mesh.position.set((x0 + x1) / 2, y - 0.06, 0.2);
    game.scene.add(this.mesh);
    // brass rim so the plate reads as a mechanism
    const rim = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0 + 0.06, 0.03, 1.46), game.mats.get('brass'));
    rim.position.set((x0 + x1) / 2, y - 0.09, 0.2); game.scene.add(rim);
    this.wasPressed = false;
  }
  step(dt) {
    const s = this.solid;
    let load = 0;
    for (const b of this.game.phys.bodies) {
      if (!b.enabled) continue;
      if (b.x1 > s.x0 + 0.05 && b.x0 < s.x1 - 0.05 && Math.abs(b.y - s.y1) < 0.05) load += b.kind === 'player' ? 0.35 : 1;
    }
    this.load = Math.min(1, load);
    const target = this.load > 0 ? 0.07 * Math.min(1, this.load + 0.4) : 0;
    const prevY1 = s.y1;
    this.depress += (target - this.depress) * (1 - Math.exp(-10 * dt));
    s.y1 = this.y - this.depress;
    // carry bodies standing on it down
    const dy = s.y1 - prevY1;
    if (dy < 0) for (const b of this.game.phys.bodies) if (b.x1 > s.x0 && b.x0 < s.x1 && Math.abs(b.y - prevY1) < 0.03) b.y += dy;
    const pressed = this.load > 0.9;
    if (pressed !== this.wasPressed) { this.game.sfx(pressed ? 'plateDown' : 'plateUp', (s.x0 + s.x1) / 2); this.wasPressed = pressed; }
  }
  render() { this.mesh.position.y = this.y - this.depress - 0.06; }
  getState() { return {}; } setState() {}
}

// ------------------------------------------------------------------ gate (portcullis)
export class Gate {
  constructor(game, { x, y0, h, w = 2.2, thick = 0.4, lift = 2.4, kind = 'pointed', z = 0 }) {
    this.game = game;
    this.x = x; this.y0 = y0; this.h = h; this.lift = lift;
    this.solid = game.phys.addSolid(x - thick / 2, y0, x + thick / 2, y0 + h, { ledges: false, surface: 'wood', kind: 'gate' });
    this.open = 0; this.target = 0; this.vel = 0;
    this.source = null;
    // lattice portcullis mesh
    const grp = new THREE.Group();
    const pts = archOutline(kind, w, h - w * 0.62, w * 0.62, -0.02);
    const s = new THREE.Shape(); s.moveTo(-w / 2, 0); pts.forEach((v) => s.lineTo(v.x, v.y)); s.lineTo(w / 2, 0); s.lineTo(-w / 2, 0);
    const lat = new THREE.ShapeGeometry(s, 16); worldUV(lat); setColor(lat, 0xffffff);
    const lm = new THREE.Mesh(lat, game.mats.get('lattice')); lm.castShadow = true; lm.receiveShadow = true;
    grp.add(lm);
    const bars = [];
    for (let i = -3; i <= 3; i++) { const b = new THREE.BoxGeometry(0.07, h - 0.05, 0.07); b.translate(i * w / 7, (h - 0.05) / 2, 0.03); bars.push(b); }
    for (let j = 0; j < 5; j++) { const b = new THREE.BoxGeometry(w - 0.1, 0.07, 0.07); b.translate(0, 0.15 + j * (h - w * 0.62) / 5, 0.04); bars.push(b); }
    for (const b of bars) { worldUV(b); setColor(b, 0xffffff); const m = new THREE.Mesh(b, game.mats.get('woodDark')); m.castShadow = true; grp.add(m); }
    grp.position.set(x, y0, z);
    grp.rotation.y = Math.PI / 2 * 0; // faces the camera; the arch opening is in the wall plane behind
    game.scene.add(grp);
    this.mesh = grp;
    this.moving = 0;
  }
  step(dt) {
    const tgt = this.source ? this.source() : this.target;
    const prev = this.open;
    const speed = tgt > this.open ? 0.9 : 1.4;
    let next = this.open + Math.sign(tgt - this.open) * Math.min(Math.abs(tgt - this.open), speed * dt);
    // never crush: if lowering into a body, stop
    const y0 = this.y0 + next * this.lift;
    if (next < this.open) {
      for (const b of this.game.phys.bodies) {
        if (!b.enabled) continue;
        if (b.x1 > this.solid.x0 && b.x0 < this.solid.x1 && b.y < y0 + 0.0 && b.y1 > y0 - 0.001 && b.y1 <= this.solid.y1) { next = this.open; break; }
      }
    }
    this.open = next;
    this.solid.y0 = this.y0 + this.open * this.lift;
    this.solid.y1 = this.y0 + this.h + this.open * this.lift;
    const moving = Math.abs(this.open - prev) > 1e-5;
    if (moving && !this.moving) this.game.sfx('gateStart', this.x);
    if (!moving && this.moving) this.game.sfx(this.open < 0.02 ? 'gateSlam' : 'gateStop', this.x);
    this.moving = moving;
  }
  render() { this.mesh.position.y = this.solid.y0; }
  getState() { return { open: this.open }; }
  setState(s) { this.open = s.open; this.solid.y0 = this.y0 + this.open * this.lift; this.solid.y1 = this.solid.y0 + this.h; }
}

// ------------------------------------------------------------------ lever
export class Lever {
  constructor(game, { x, y, dir = -1, onPulled }) {
    this.game = game; this.x = x; this.y = y; this.dir = dir; // dir: side the boy stands relative to lever (-1 = boy on the left, pulls left)
    this.t = 0; this.pulled = false; this.onPulled = onPulled; this.held = false;
    const grp = new THREE.Group();
    const base = new THREE.Mesh(worldUV(new THREE.BoxGeometry(0.34, 0.22, 0.34)), game.mats.get('iron')); base.position.y = 0.11; grp.add(base);
    const arm = new THREE.Group(); arm.position.y = 0.2;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.05, 8), game.mats.get('iron')); shaft.position.y = 0.52; arm.add(shaft);
    const knob = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), game.mats.get('brass')); knob.position.y = 1.06; arm.add(knob);
    grp.add(arm);
    grp.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!o.geometry.attributes.color) setColor(o.geometry, 0xffffff); } });
    grp.position.set(x, y, 0.25);
    game.scene.add(grp);
    this.arm = arm; this.mesh = grp;
  }
  grab(player) { this.held = true; player.facing = -this.dir; this.game.sfx('grip', this.x); }
  release() { this.held = false; }
  drive(pull, dt, player) {
    // pull > 0 means moving away from the lever
    if (this.pulled) return;
    if (pull > 0.3) this.t = Math.min(1, this.t + dt * 1.6);
    player.body.x = this.x + this.dir * (0.55 + this.t * 0.25);
    if (this.t >= 1 && !this.pulled) { this.pulled = true; this.game.sfx('lever', this.x); this.onPulled && this.onPulled(); }
  }
  step(dt) { if (!this.held && !this.pulled) this.t = Math.max(0, this.t - dt * 2); }
  render() { this.arm.rotation.z = 0.6 * this.dir * (1 - 2 * this.t); }
  near(px, py) { return Math.abs(px - (this.x + this.dir * 0.55)) < 0.45 && Math.abs(py - this.y) < 0.3; }
  getState() { return { t: this.t, pulled: this.pulled }; }
  setState(s) { this.t = s.t; this.pulled = s.pulled; }
}

// ------------------------------------------------------------------ searchlight
const BEAM_VS = /* glsl */ `
varying vec3 vPos; varying vec3 vN; varying vec3 vW;
void main(){ vPos = position; vN = normalize(normalMatrix * normal); vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const BEAM_FS = /* glsl */ `
uniform vec3 uColor; uniform float uIntensity; uniform float uTime; uniform float uLen;
varying vec3 vPos; varying vec3 vN; varying vec3 vW;
float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
float n3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+vec3(1,1,1)),f.x),f.y),f.z); }
void main(){
  vec3 V = normalize(cameraPosition - vW);
  float rim = pow(abs(dot(normalize(vN), vec3(0.,0.,1.)) ), 1.0);
  float edge = pow(1. - abs(dot(vN, normalize((viewMatrix * vec4(V,0.)).xyz))), 1.5);
  float core = 1. - edge;
  float along = clamp(-vPos.y / uLen, 0., 1.);
  float fall = (1. - along * .75) * smoothstep(0., .04, along);
  float dust = .75 + .5 * n3(vW * 1.3 + vec3(0., -uTime * .3, uTime * .2));
  float a = pow(core, 3.5) * fall * dust * uIntensity;
  gl_FragColor = vec4(uColor * a, 1.);
}`;

export class Searchlight {
  constructor(game, { origin, x0, x1, aimY = 0.6, speed = 3.2, pause = 1.1, covers = [], color = 0xfff0d0, startX }) {
    this.game = game;
    this.origin = origin.clone();
    this.x0 = x0; this.x1 = x1; this.aimY = aimY; this.speed = speed; this.pauseT = pause;
    this.covers = covers; // THREE.Box3[]
    this.aim = new THREE.Vector3(startX ?? x0, aimY, 0);
    this.dir = 1; this.pause = 0.5;
    this.state = 'sweep'; this.seen = 0; this.alarmT = 0;
    this.enabled = true;
    const spot = new THREE.SpotLight(color, 520, 60, 0.11, 0.35, 1.5);
    spot.castShadow = true; spot.shadow.mapSize.set(1024, 1024); spot.shadow.bias = -0.0004; spot.shadow.normalBias = 0.03;
    spot.shadow.camera.near = 5; spot.shadow.camera.far = 80;
    spot.position.copy(this.origin);
    spot.target.position.copy(this.aim);
    game.scene.add(spot, spot.target);
    this.spot = spot;
    this.baseColor = new THREE.Color(color);
    // volumetric beam cone (additive)
    const len = 18;
    const cone = new THREE.CylinderGeometry(0.22, Math.tan(0.11) * len * 1.05, len, 32, 1, true);
    cone.translate(0, -len / 2, 0);
    this.beamMat = new THREE.ShaderMaterial({
      vertexShader: BEAM_VS, fragmentShader: BEAM_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: new THREE.Color(1.0, 0.86, 0.62) }, uIntensity: { value: 0.35 }, uTime: game.globals.uTime, uLen: { value: len } },
    });
    this.beam = new THREE.Mesh(cone, this.beamMat);
    this.beam.frustumCulled = false;
    game.scene.add(this.beam);
    // lamp housing
    const lamp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 0.8, 16), game.mats.get('brass'));
    body.rotation.x = Math.PI / 2; lamp.add(body);
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.4, 20), new THREE.MeshBasicMaterial({ color: new THREE.Color(8, 7, 5) }));
    lens.position.z = 0.41; lamp.add(lens);
    lamp.position.copy(this.origin);
    game.scene.add(lamp);
    this.lamp = lamp;
    this._v = new THREE.Vector3(); this._d = new THREE.Vector3(); this._ray = new THREE.Ray();
    this.hum = 0;
  }

  visible(p) {
    // within cone?
    const d = this._d.subVectors(this.aim, this.origin).normalize();
    const v = this._v.subVectors(p, this.origin);
    const dist = v.length(); v.divideScalar(dist);
    const ang = Math.acos(THREE.MathUtils.clamp(d.dot(v), -1, 1));
    if (ang > this.spot.angle * 0.92) return false;
    this._ray.set(this.origin, v);
    const hit = new THREE.Vector3();
    for (const b of this.covers) { if (this._ray.intersectBox(b, hit) && hit.distanceTo(this.origin) < dist - 0.05) return false; }
    return true;
  }

  step(dt) {
    if (!this.enabled) return;
    const pl = this.game.player;
    if (this.state === 'sweep') {
      if (this.pause > 0) this.pause -= dt;
      else {
        this.aim.x += this.dir * this.speed * dt;
        if (this.aim.x > this.x1) { this.aim.x = this.x1; this.dir = -1; this.pause = this.pauseT; }
        if (this.aim.x < this.x0) { this.aim.x = this.x0; this.dir = 1; this.pause = this.pauseT; }
      }
      this.aim.y = this.aimY + Math.sin(this.game.time * 0.9) * 0.25;
      if (!pl.dead && pl.body.x > this.x0 - 3 && pl.body.x < this.x1 + 3) {
        const head = new THREE.Vector3(pl.body.x, pl.body.y + pl.body.h * 0.85, 0);
        const chest = new THREE.Vector3(pl.body.x, pl.body.y + pl.body.h * 0.5, 0);
        const seen = this.visible(head) || this.visible(chest);
        this.seen = seen ? this.seen + dt : Math.max(0, this.seen - dt * 2);
        if (this.seen > 0.18) { this.state = 'alarm'; this.alarmT = 0; this.game.sfx('alarm', pl.body.x); this.game.onSpotted && this.game.onSpotted(); }
      }
    } else if (this.state === 'alarm') {
      this.alarmT += dt;
      const target = new THREE.Vector3(pl.body.x, pl.body.y + 0.6, 0);
      this.aim.lerp(target, 1 - Math.exp(-10 * dt));
      if (this.alarmT > 1.05 && !pl.dead) { this.game.sfx('dart', pl.body.x); pl.die('shot'); }
      if (this.alarmT > 4) { this.state = 'sweep'; this.seen = 0; }
    }
  }

  render(dt) {
    const alarm = this.state === 'alarm' ? Math.min(1, this.alarmT * 3) : 0;
    this.spot.target.position.copy(this.aim);
    this.spot.target.updateMatrixWorld();
    const col = this.baseColor.clone().lerp(new THREE.Color(1.0, 0.45, 0.3), alarm);
    this.spot.color.copy(col);
    this.spot.intensity = this.enabled ? 520 * (1 + alarm * 0.4) : 0;
    this.beamMat.uniforms.uColor.value.set(1.0, 0.86, 0.62).lerp(new THREE.Color(1.0, 0.45, 0.3), alarm);
    this.beamMat.uniforms.uIntensity.value = this.enabled ? 0.55 + alarm * 0.3 : 0;
    // orient beam cone from origin to aim
    const d = new THREE.Vector3().subVectors(this.aim, this.origin).normalize();
    this.beam.position.copy(this.origin);
    this.beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
    this.lamp.lookAt(this.aim);
  }
  getState() { return { x: this.aim.x, dir: this.dir, pause: this.pause }; }
  setState(s) { this.aim.x = s.x; this.dir = s.dir; this.pause = 1.5; this.state = 'sweep'; this.seen = 0; this.alarmT = 0; }
}

// ------------------------------------------------------------------ guard
export class Guard {
  constructor(game, { x, y = 0, speed = 3.85, blockX = Infinity }) {
    this.game = game;
    this.rig = createCharacter(GUARD, game.mats);
    this.anim = new Animator(this.rig, { scale: 1.5 });
    this.rig.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    game.scene.add(this.rig.root);
    this.body = new Body(x, y, 0.5, 1.8, { kind: 'guard', solid: false, pushable: false });
    this.body.kinematic = true;
    game.phys.addBody(this.body);
    this.home = { x, y };
    this.speed = speed; this.blockX = blockX;
    this.state = 'hidden'; this.t = 0; this.vault = null;
    this.prev = new THREE.Vector2(x, y);
    this.facing = 1;
    // lantern in right hand + light
    this.lantern = lanternMesh(game.mats, { s: 1.1 });
    this.lantern.position.set(0, -0.12, 0.02);
    this.lantern.rotation.x = Math.PI;
    this.rig.j.wristR.add(this.lantern);
    this.light = new THREE.PointLight(0xffa860, 6, 7, 1.6);
    this.light.position.set(0, -0.35, 0);
    this.rig.j.wristR.add(this.light);
    this.rig.root.visible = false; this.light.visible = false;
    this.body.enabled = false;
    this.steps = 0;
    this.anim.onFootstep = () => this.game.sfx('guardStep', this.body.x);
  }
  activate(x) {
    const b = this.body; b.x = x ?? this.home.x; b.y = this.home.y; b.vx = 0; b.vy = 0; this.prev.set(b.x, b.y);
    this.state = 'chase'; this.t = 0; this.rig.root.visible = true; this.light.visible = true; b.enabled = true;
    this.anim.setState('ground', 0.01);
    this.game.sfx('shout', b.x);
  }
  deactivate() { this.state = 'hidden'; this.rig.root.visible = false; this.light.visible = false; this.body.enabled = false; }
  prestep() { this.prev.set(this.body.x, this.body.y); }
  step(dt) {
    if (this.state === 'hidden') return;
    const b = this.body, pl = this.game.player, ph = this.game.phys;
    this.t += dt;
    if (this.state === 'chase') {
      if (this.vault) {
        const v = this.vault; v.t += dt / v.dur;
        const k = Math.min(1, v.t);
        b.x = lerp(v.x0, v.x1, k); b.y = lerp(v.y0, v.y1, Math.min(1, k * 1.6)) + Math.sin(k * Math.PI) * 0.25;
        if (k >= 1) { this.vault = null; b.vy = 0; }
        return;
      }
      const tgtV = this.speed * Math.sign(pl.body.x - b.x || 1);
      b.vx = lerp(b.vx, tgtV, 1 - Math.exp(-4 * dt));
      this.facing = Math.sign(b.vx) || 1;
      // gravity
      b.vy = Math.max(b.vy - GRAVITY * dt, -16);
      const ry = ph.sweepY(b, b.vy * dt); b.y += ry.dy; if (ry.hit) b.vy = 0;
      if (b.x + b.w / 2 + b.vx * dt > this.blockX) { b.x = this.blockX - b.w / 2; b.vx = 0; this.state = 'blocked'; this.t = 0; this.game.sfx('guardFrustrated', b.x); return; }
      const rx = ph.sweepX(b, b.vx * dt);
      if (rx.hit) {
        const c = rx.hit; const hgt = c.y1 - b.y;
        if (hgt <= 2.3 && hgt > 0 && ph.free(c.x0, c.y1, c.x1, c.y1 + 1.8, b)) {
          const dir = Math.sign(b.vx);
          const landX = dir > 0 ? c.x0 + 0.45 : c.x1 - 0.45;
          this.vault = { x0: b.x, x1: landX, y0: b.y, y1: c.y1 + EPS, t: 0, dur: hgt > 1.4 ? 0.62 : 0.34 };
          this.game.sfx('guardVault', b.x);
        } else { b.vx = 0; }
      } else b.x += rx.dx;
      // catch
      if (!pl.dead && !this.game.safeZone(pl.body.x) && Math.abs(pl.body.x - b.x) < 0.72 && Math.abs(pl.body.y - b.y) < 1.3) {
        pl.die('caught'); this.state = 'grab'; this.t = 0; this.game.sfx('grabbed', b.x);
      }
    } else if (this.state === 'blocked') {
      b.vx = 0;
    }
  }
  render(alpha, dt) {
    if (this.state === 'hidden') return;
    const b = this.body;
    const x = lerp(this.prev.x, b.x, alpha), y = lerp(this.prev.y, b.y, alpha);
    this.rig.root.position.set(x, y, 0.15);
    const yaw = this.facing * (Math.PI / 2 - 0.15);
    this.rig.root.rotation.y += (yaw - this.rig.root.rotation.y) * (1 - Math.exp(-10 * dt));
    let st = 'ground';
    if (this.vault) st = 'air';
    if (this.state === 'blocked' || this.state === 'grab') st = 'reach';
    if (st === 'reach') {
      this.anim.setState('push', 0.3);
      this.anim.update(dt, { speed: 0, vx: 0, vy: 0, grounded: true, facing: this.facing });
      // crouch & reach through the gap
      const J = this.rig.j;
      const k = this.state === 'blocked' ? Math.min(1, this.t * 2) : 0.4;
      J.spine.rotation.x = 0.4 + 0.7 * k; J.hipL.rotation.x = -0.6 * k - 0.2; J.hipR.rotation.x = -0.2 * k; J.kneeL.rotation.x = 1.4 * k; J.kneeR.rotation.x = 1.6 * k;
      J.pelvis.position.y = this.rig.spec.hipH - 0.45 * k;
      J.shoulderR.rotation.set(-1.5 - Math.sin(this.t * 5) * 0.15 * k, 0, 0); J.elbowR.rotation.x = -0.05;
    } else {
      this.anim.setState(st === 'air' ? 'air' : 'ground', 0.12);
      this.anim.update(dt, { speed: Math.abs(b.vx), vx: b.vx, vy: this.vault ? 2 : 0, grounded: !this.vault, facing: this.facing });
      // lantern arm held forward
      this.rig.j.shoulderR.rotation.x = -0.5 + Math.sin(this.t * 9) * 0.1; this.rig.j.elbowR.rotation.x = -0.9;
    }
    this.light.intensity = 6 + Math.sin(this.t * 17) * 0.6 + Math.sin(this.t * 7.3) * 0.4;
  }
  getState() { return { state: this.state === 'hidden' ? 'hidden' : 'hidden' }; }
  setState() { this.deactivate(); this.vault = null; }
}

// ------------------------------------------------------------------ triggers
export class Trigger {
  constructor({ x0, x1, y0 = -10, y1 = 50, once = true, fn, id }) { Object.assign(this, { x0, x1, y0, y1, once, fn, id }); this.fired = false; }
  test(game) {
    if (this.fired && this.once) return;
    const b = game.player.body;
    if (b.x >= this.x0 && b.x <= this.x1 && b.y >= this.y0 && b.y <= this.y1) { this.fired = true; this.fn(game); }
  }
  getState() { return { fired: this.fired }; } setState(s) { this.fired = s.fired; }
}
