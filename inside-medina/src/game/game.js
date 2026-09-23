import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { Player } from './player.js';
import { Animator } from './animator.js';
import { CameraRig } from './camera.js';
import { buildLevel } from './level1.js';
import { createCharacter, BOY } from '../assets/character.js';
import { G } from '../render/atmosphere.js';
import { LOOK } from '../render/look.js';
import { Shafts } from '../render/shafts.js';
import { updateAtmosphere } from '../render/world.js';
import { LightPool } from '../render/lightpool.js';

const STEP = 1 / 120;
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

export class Game {
  constructor(world, input, audio, ui, params) {
    this.world = world; this.input = input; this.audio = audio; this.ui = ui; this.params = params;
    this.scene = world.scene; this.mats = world.mats; this.globals = G;
    this.time = 0; this.acc = 0;
    this.paused = false;
    this.vines = [];
    this.fade = 1; this.fadeTarget = 0; this.fadeSpeed = 0.6; this.fadeColor = new THREE.Color(0, 0, 0);
    this.mode = 'intro'; // intro | play | dying | finale | end
    this.cpIndex = 0;
    this.stats = { deaths: 0, t0: 0 };
  }

  init(progress = () => {}) {
    const rs = this.world.rs;
    this.phys = new PhysicsWorld();
    this.camera = new THREE.PerspectiveCamera(34, rs.cssW / rs.cssH, 0.1, 1500);
    rs.camera = this.camera;
    this.camRig = new CameraRig(this.camera);
    this.player = new Player(this);
    this.rig = createCharacter(BOY, this.mats);
    this.rig.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(this.rig.root);
    if (this.rig.scarf) this.scene.add(this.rig.scarf.mesh);
    this.anim = new Animator(this.rig);
    this.anim.onFootstep = (speed, st) => {
      const g = this.player.groundObj;
      this.audio.play('step', this.player.x, { surface: g?.surface || 'stone', speed: st === 'crawl' ? 1 : speed });
    };
    progress(0.1, 'raising walls…');
    this.level = buildLevel(this);
    const L = this.level;
    progress(0.8, 'hanging the lanterns…');
    this.entities = [L.crateA, L.crateB, L.plate, L.bridge, L.lever, L.ladder, L.searchlight, L.guard].filter(Boolean);
    this.crates = [L.crateA, L.crateB];
    this.camRig.setKeys(L.cameraKeys);
    this.phys.onImpact = (b, speed) => {
      if (b.kind === 'crate') { this.sfx('crateImpact', b.x); if (speed > 6) this.camRig.addShake(0.5); }
    };
    // light shafts & dust
    this.shafts = new Shafts(this.scene, LOOK.sunDir, G);
    for (const s of L.shaftSpots) this.shafts.add(s.p, s.o);
    this.shafts.addDust(L.dustRegions, 1400);
    // lantern lights: fixed pool reassigned to the nearest lanterns (no shader recompiles)
    this.lightPool = new LightPool(this.scene, 4);
    for (const s of L.lightSources) this.lightPool.add(s.pos, s.intensity, s.phase);
    // subtle character fill light so the boy reads in deep shade
    this.charLight = new THREE.PointLight(0xffd2a0, 1.2, 4.5, 1.5);
    this.scene.add(this.charLight);
    // lantern glow sprites
    this.glowTex = makeGlowTexture();
    for (const l of L.lanterns) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, color: 0xffa860, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 }));
      sp.scale.setScalar(0.9);
      sp.position.set(0, 0.2, 0);
      l.mesh.add(sp);
      l.sprite = sp;
    }
    // checkpoints & spawn
    this.checkpoints = L.checkpoints.sort((a, b) => a.x - b.x);
    this.triggers = L.triggers;
    this.initialSnap = this.snapshot();
    const startCp = this.params.cp !== undefined ? Math.min(+this.params.cp, this.checkpoints.length - 1) : 0;
    this.cpIndex = startCp;
    this.cpSnap = this.initialSnap;
    const s = this.checkpoints[startCp].spawn;
    if (startCp > 0) this.prepareForCheckpoint(startCp);
    this.player.spawn(s.x, s.y, s.facing);
    this.camRig.groundY = s.y;
    this.camRig.snapNext = true;
    this.installTestApi();
    progress(1, 'ready');
  }

  // skip puzzles that precede a checkpoint when starting there (dev/testing)
  prepareForCheckpoint(i) {
    const L = this.level;
    const x = this.checkpoints[i].x;
    if (x > 118) { L.lever.pulled = true; L.lever.t = 1; L.ladder.t = 1; L.ladder.target = 1; L.ladder.vine.enabled = true; }
    if (x > 140) { L.crateB.setState({ x: 128.15, y: 0 }); L.bridge.setState({ angle: 0 }); }
    if (x > 42) { L.crateA.setState({ x: 41.5, y: 0 }); }
    if (x > 186) { this.triggers.find((t) => t.id === 'chase').fired = true; }
    this.cpSnap = this.snapshot();
  }

  snapshot() {
    return {
      ents: this.entities.map((e) => e.getState()),
      trig: this.triggers.map((t) => t.getState()),
    };
  }
  restore(s) {
    this.entities.forEach((e, i) => e.setState(s.ents[i]));
    this.triggers.forEach((t, i) => t.setState(s.trig[i]));
  }

  sfx(name, x, data) { this.audio.play(name, x, data); }
  safeZone(x) { return x > 182.95; }
  leverNear(px, py, facing) { const lv = this.level.lever; return lv && !lv.pulled && lv.near(px, py) ? lv : null; }

  // ------------------------------------------------------------------ loop
  frame(dt) {
    dt = Math.min(dt, 0.1);
    const inp = this.input.poll();
    if (this.input.pausePressed && (this.mode === 'play' || this.mode === 'intro' || this.paused)) this.setPaused(!this.paused);
    if (this.mode === 'intro' && (this.input.anyPressed || this.params.autostart)) this.beginPlay();
    this.ui.update(dt);
    if (!this.paused) {
      this.acc += dt;
      let first = true;
      let n = 0;
      while (this.acc >= STEP && n < 12) {
        this.fixed(STEP, inp, first);
        first = false; this.acc -= STEP; n++;
      }
      if (n >= 12) this.acc = 0;
      this.time += dt;
    }
    this.render(dt, this.acc / STEP);
  }

  fixed(dt, st, first) {
    const pin = {
      x: this.mode === 'play' || this.mode === 'finale' ? st.x : 0,
      y: this.mode === 'play' || this.mode === 'finale' ? st.y : 0,
      jump: st.jump, grab: st.grab,
      jumpPressed: first && this.input.jumpPressed && this.mode === 'play',
      upPressed: first && st.y > 0.6 && !(this.input.prev.y > 0.6) && this.mode === 'play',
      grabPressed: first && this.input.grabPressed,
    };
    if (this.mode !== 'play' && this.mode !== 'finale') { pin.jump = false; pin.grab = false; }
    for (const c of this.crates) c.prestep();
    this.level.guard.prestep();
    const pl = this.player;
    pl.step(dt, pin);
    for (const e of this.entities) if (e.step) e.step(dt);
    this.phys.stepBodies(dt);
    // crates falling onto the boy
    for (const c of this.crates) {
      const b = c.body, p = pl.body;
      if (!pl.dead && b.vy < -3 && b.x1 > p.x0 + 0.05 && b.x0 < p.x1 - 0.05 && b.y < p.y + p.h && b.y > p.y + p.h - 0.4) { pl.die('crushed'); this.sfx('crateImpact', b.x); }
    }
    if (this.mode === 'play') {
      for (const t of this.triggers) t.test(this);
      // checkpoints
      const cps = this.checkpoints;
      for (let i = this.cpIndex + 1; i < cps.length; i++) {
        if (pl.x >= cps[i].x && (pl.state === 'ground') && !pl.dead) { this.cpIndex = i; this.cpSnap = this.snapshot(); }
      }
    }
    // player events -> sound / feedback
    for (const [name, data] of pl.events) {
      if (name === 'land') { this.sfx('land', pl.x, data); this.anim.land(Math.min(1, data.speed / 11) * (data.hard ? 1.3 : 0.8)); if (data.hard) this.camRig.addShake(0.35); }
      else if (name === 'death') this.onDeath(data);
      else if (name === 'crateMove') { this._crateMoving = 0.1; }
      else this.sfx(name, pl.x, data);
    }
    pl.events.length = 0;
    this._crateMoving = Math.max(0, (this._crateMoving || 0) - dt);
    if (this.mode === 'dying') this.updateDying(dt);
    if (this.mode === 'finale') this.updateFinale(dt, st);
  }

  // ------------------------------------------------------------------ flow
  beginPlay() {
    this.mode = 'play';
    this.audio.start();
    this.ui.showHint(this.input.lastDevice, 9);
    this.titleFade = 1;
    this.camRig.clearOverride(2.8);
    this.stats.t0 = this.time;
  }

  setPaused(p) {
    this.paused = p;
    this.ui.showPause(p, this.input.lastDevice, this.world.rs.tier, this.audio.muted);
    if (this.audio.ctx) { if (p) this.audio.ctx.suspend(); else this.audio.ctx.resume(); }
  }

  onDeath(kind) {
    this.mode = 'dying'; this.dieT = 0; this.deathKind = kind; this.stats.deaths++;
    this.sfx('death', this.player.x);
    if (kind === 'fall' || kind === 'crushed') this.camRig.addShake(0.6);
  }

  updateDying(dt) {
    this.dieT += dt;
    if (this.dieT > 1.6 && this.fadeTarget !== 1) { this.fadeTarget = 1; this.fadeSpeed = 1.8; this.fadeColor.set(0, 0, 0); }
    if (this.dieT > 2.35) this.respawn();
  }

  respawn() {
    const cp = this.checkpoints[this.cpIndex];
    this.restore(this.cpSnap);
    this.player.spawn(cp.spawn.x, cp.spawn.y, cp.spawn.facing);
    this.player.z = 0;
    this.anim.setState('ground', 0.01);
    if (this.rig.scarf) this.rig.scarf.reset();
    this.camRig.groundY = cp.spawn.y; this.camRig.snapNext = true;
    this.mode = 'play';
    this.fadeTarget = 0; this.fadeSpeed = 1.2;
    this.audio.lowpass && this.audio.lowpass.frequency.setTargetAtTime(20000, this.audio.ctx.currentTime, 0.3);
  }

  restartLevel() {
    G.uFogParams.value.x = LOOK.fogDensity;
    this.world.rs.post.params.contrast = LOOK.post.contrast; this.world.rs.post.params.saturation = LOOK.post.saturation;
    if (this.sunFrom) { LOOK.sunDir.copy(this.sunFrom); this.world.light.sunDir.copy(this.sunFrom); this.world.sky.uniforms.uSunDir.value.copy(this.sunFrom); this.world.light.sun.color.set(LOOK.sunColor); this.sunFrom = null; }
    this.cpIndex = 0; this.cpSnap = this.initialSnap;
    this.respawn();
    this.finaleT = 0;
    this.world.rs.post.params.letterbox = 0;
    this.camRig.clearOverride(0.01);
    this.ui.showEnd(false);
  }

  startFinale() {
    if (this.mode === 'finale') return;
    const F = this.level.finale;
    this.mode = 'finale'; this.finaleT = 0; this.finaleS = 0; this.finaleDone = false;
    const pl = this.player;
    pl.grip = null;
    const curve = new THREE.CatmullRomCurve3(F.path, false, 'centripetal');
    this.finaleCurve = curve; this.finaleLen = curve.getLength();
    // start the path from the boy's current position
    this.finaleS = 0;
    pl.scripted = (dt, p) => {
      p.state = 'ground';
      const inp = this.input.state;
      const want = Math.max(inp.x, inp.y, this.finaleT > 6 ? 0.55 : 0, this.params.autostart ? 1 : 0);
      const v = 1.55 * Math.min(1, want);
      p.fvx = (p.fvx || 0) + (v - (p.fvx || 0)) * (1 - Math.exp(-3 * dt));
      this.finaleS = Math.min(this.finaleLen, this.finaleS + p.fvx * dt);
      const t = this.finaleS / this.finaleLen;
      const pos = curve.getPointAt(t);
      const tan = curve.getTangentAt(Math.min(0.999, t + 0.01));
      p.body.x = pos.x; p.body.y = 0; p.z = pos.z;
      p.finaleYaw = Math.atan2(tan.x, tan.z);
      p.body.vx = p.fvx;
    };
    this.camRig.setOverride(() => {
      const k = smooth(this.finaleT / 14);
      // portrait screens get the tall reference framing, landscape a narrower lens looking less steeply up
      const aspect = this.camera.aspect;
      const w = THREE.MathUtils.clamp((aspect - 0.7) / 1.1, 0, 1);
      const pos = F.camPos.clone().add(new THREE.Vector3(0.25 * w, -0.05 * k + 0.25 * w, -2.2 * k + 0.5 * w));
      const look = F.camLook.clone().add(new THREE.Vector3(-0.3 * w, -0.4 * k - 2.6 * w, 0));
      return { pos, look, fov: THREE.MathUtils.lerp(F.fov, 47, w) - 3 * k };
    }, 3.2);
    this.audio.finale();
    this.ui.el('hint').classList.add('hidden'); this.ui.hintTimer = 0;
  }

  updateFinale(dt) {
    this.finaleT += dt;
    const F = this.level.finale;
    if (!this.sunFrom) this.sunFrom = LOOK.sunDir.clone();
    const ks = smooth(this.finaleT / 7);
    LOOK.sunDir.copy(this.sunFrom).lerp(F.sunDir, ks).normalize();
    this.world.light.sunDir.copy(LOOK.sunDir);
    this.world.sky.uniforms.uSunDir.value.copy(LOOK.sunDir);
    this.world.light.sun.color.set(LOOK.sunColor).lerp(new THREE.Color('#ffb46e'), ks * 0.6);
    G.uFogParams.value.x = LOOK.fogDensity * (1 - 0.45 * ks);
    const P2 = this.world.rs.post.params;
    P2.contrast = LOOK.post.contrast + 0.08 * ks; P2.saturation = LOOK.post.saturation + 0.1 * ks;
    const P = this.world.rs.post.params;
    const k = smooth(this.finaleT / 4);
    P.letterbox = 0.075 * k;
    const pl = this.player;
    if (!this.finaleDone && pl.z < -13.2) {
      this.finaleDone = true; this.endT = 0;
      this.fadeColor.set(0.97, 0.9, 0.78); this.fadeTarget = 1; this.fadeSpeed = 0.28;
      this.audio.fadeOut(6);
    }
    if (this.finaleDone) {
      this.endT += dt;
      if (this.endT > 4.2 && this.mode !== 'end') { this.mode = 'end'; this.ui.showEnd(true); }
    }
  }

  // ------------------------------------------------------------------ render
  render(dt, alpha) {
    const rs = this.world.rs;
    const pl = this.player;
    const P = rs.post.params;
    if (!this.paused) {
      // player visuals
      const x = pl.prev.x + (pl.cur.x - pl.prev.x) * alpha;
      const y = pl.prev.y + (pl.cur.y - pl.prev.y) * alpha;
      const z = pl.z || 0;
      const root = this.rig.root;
      // smooth vertical steps (stairs/kerbs)
      this._vy = this._vy === undefined ? y : this._vy;
      if (pl.state === 'ground' && Math.abs(y - this._vy) < 0.3) this._vy += (y - this._vy) * (1 - Math.exp(-25 * dt)); else this._vy = y;
      root.position.set(x, this._vy, z);
      let targetYaw = pl.scripted ? pl.finaleYaw : pl.targetYaw();
      if (pl.state === 'climb') targetYaw = Math.PI * (root.rotation.y >= 0 ? 1 : -1);
      if (pl.dead && pl.deathKind !== 'fall') targetYaw = root.rotation.y;
      // critically damped yaw
      const w = 16;
      let d = targetYaw - root.rotation.y;
      const a = w * w * d - 2 * w * (pl.yawVel || 0);
      pl.yawVel = (pl.yawVel || 0) + a * dt;
      root.rotation.y += pl.yawVel * dt;
      // animation state
      let st = 'ground';
      switch (pl.state) {
        case 'air': st = 'air'; break;
        case 'hang': st = 'hang'; break;
        case 'climbUp': st = 'climbUp'; break;
        case 'climb': st = 'climb'; break;
        case 'lever': st = 'lever'; break;
        case 'dead': st = 'dead'; break;
        default:
          if (pl.crawling) st = 'crawl';
          else if (pl.grip) st = (Math.sign(pl.body.vx) === pl.facing || Math.abs(pl.body.vx) < 0.05) ? 'push' : 'pull';
          else if (pl.pushing > 0) st = 'push';
      }
      const fade = { ground: 0.12, air: 0.1, hang: 0.08, climbUp: 0.06, climb: 0.15, crawl: 0.2, push: 0.2, pull: 0.2, lever: 0.2, dead: 0.1 }[st] || 0.15;
      if (this.debugPose) {
        const D = this.debugPose;
        st = { run: 'ground', walk: 'ground', idle: 'ground' }[D.pose] || D.pose;
        this.anim.phase = D.phase; this.anim.climbPhase = D.phase;
        this.anim.state = st; this.anim.fade = 1;
        pl.body.vx = D.pose === 'run' ? 4.1 * pl.facing : D.pose === 'walk' ? 1.6 * pl.facing : (D.pose === 'push' || D.pose === 'pull') ? 1.0 : 0;
        pl.body.vy = D.pose === 'air' ? (D.phase > 0.5 ? -4 : 3) : 0;
        pl.climbT = D.phase; pl.deathT = 2; pl.deathKind = 'caught';
      }
      this.anim.setState(st, fade);
      const speed = pl.scripted ? pl.body.vx : (pl.state === 'climb' ? 0 : pl.body.vx);
      if (this.debugPose) { this.anim.prevVx = pl.body.vx; }
      this.anim.update(dt, {
        speed: Math.abs(speed), vx: pl.body.vx, vy: pl.body.vy, grounded: pl.state === 'ground', facing: pl.facing,
        climbT: pl.climbT, hangSwing: pl.state === 'hang' ? Math.sin(pl.hangT * 3) * Math.exp(-pl.hangT * 2) : 0,
        climbSpeed: pl.climbSpeed || 0, deathT: pl.deathT, deathKind: pl.deathKind, leverT: this.level.lever.t,
        lookYaw: this.lookTarget(pl),
      });
      root.updateMatrixWorld(true);
      if (this.debugPose) { root.rotation.y = targetYaw + this.debugPose.yawOff; pl.yawVel = 0; if (this.debugPose.pose === 'climb') root.rotation.y = Math.PI + this.debugPose.yawOff; }
      if (this.rig.scarf) {
        const wind = new THREE.Vector3(-pl.body.vx * 6 - 1.5, 0.6, -0.8 + Math.sin(this.time * 0.7) * 1.2);
        this.rig.scarf.update(dt, wind);
      }
      // entities
      for (const c of this.crates) c.render(alpha, dt);
      for (const e of this.entities) if (e.render && !e.body) e.render(dt);
      this.level.guard.render(alpha, dt);
      // lanterns flicker
      for (const l of this.level.lanterns) {
        const f = 0.85 + Math.sin(this.time * 9 + l.phase) * 0.08 + Math.sin(this.time * 23 + l.phase * 2) * 0.05;
        if (l.light) l.light.intensity = (l.baseI ?? (l.baseI = l.light.intensity)) * f;
        if (l.sprite) l.sprite.material.opacity = 0.5 * f;
        l.mesh.rotation.z = Math.sin(this.time * 0.8 + l.phase) * 0.03;
      }
      this.charLight.position.set(x + 0.6, this._vy + 1.5, z + 1.6);
      this.lightPool.update(this.camRig.look, this.time, dt);
      // camera
      const ppos = new THREE.Vector3(x, this._vy, z);
      if (this.mode === 'intro' && !this.camRig.override) this.introCamera();
      const cp = this.camRig.update(dt, pl, ppos, pl.facing, pl.state === 'ground');
      // depth of field follows the boy
      const fd = this.camera.position.distanceTo(new THREE.Vector3(x, this._vy + 0.7, z));
      P.focus = fd; P.nearRange = Math.max(2.5, fd * 0.28); P.farStart = fd * 1.1; P.farRamp = 40;
      P.nearBlur = this.mode === 'finale' ? 4 : cp.dofNear; P.farBlur = this.mode === 'finale' ? 1.5 : cp.dofFar;
      // fades
      this.fade += Math.sign(this.fadeTarget - this.fade) * Math.min(Math.abs(this.fadeTarget - this.fade), dt * this.fadeSpeed);
      P.fade = smooth(this.fade); P.fadeColor.copy(this.fadeColor);
      // title
      if (this.titleFade !== undefined) { this.titleFade = Math.max(0, this.titleFade - dt * 0.35); this.ui.titleOpacity(this.titleFade); if (this.titleFade <= 0) { this.ui.showTitle(false); this.titleFade = undefined; } }
      // god rays: strong in the finale
      P.rays = this.mode === 'finale' || this.mode === 'end' ? 1.6 : 0.35;
      P.bloom = this.mode === 'finale' || this.mode === 'end' ? 0.42 : 0.28;
      // shadow frustum follows the view
      const focus = new THREE.Vector3(this.camRig.look.x, this.camRig.look.y, this.mode === 'finale' ? -8 : -2);
      if (this.camRig.override) focus.set(188, 3, -9);
      this.world.light.update(focus);
      // audio listener & mix
      this.audio.setListener(x);
      const L = this.level;
      const hum = L.searchlight && x > 66 && x < 120 ? 0.9 * (1 - Math.min(1, Math.abs(x - 93) / 40)) : 0;
      const crateSpeed = this._crateMoving > 0 ? Math.abs(pl.body.vx) : 0;
      this.audio.update(dt, { crateSpeed, hum, tension: L.searchlight?.state === 'alarm' || L.guard.state === 'chase' ? 1 : (x > 70 && x < 118 ? 0.35 : 0.1), height: this._vy, birds: x < 70 || x > 118, chase: L.guard.state === 'chase' && !pl.dead, finale: this.mode === 'finale' || this.mode === 'end' });
    }
    updateAtmosphere(this.world, this.camera, this.time);
    rs.render(this.scene, this.camera, this.time);
  }

  lookTarget(pl) {
    const L = this.level;
    if (L.guard.state === 'chase' && L.guard.body.x < pl.x) return pl.facing > 0 ? -0.8 : 0.8;
    return null;
  }

  introCamera() {
    // establishing shot over the souk until the first input
    const t = this.time;
    this.camRig.setOverride(() => ({
      pos: new THREE.Vector3(5 + Math.sin(t * 0.05) * 0.5, 4.2, 15.5),
      look: new THREE.Vector3(7, 6.8, -10),
      fov: 42,
    }), 0.001);
    this.camRig.overrideW = 1;
  }

  // ------------------------------------------------------------------ test hooks
  installTestApi() {
    const g = this;
    window.__medina = {
      game: g,
      state: () => ({ x: +g.player.x.toFixed(3), y: +g.player.y.toFixed(3), z: +(g.player.z || 0).toFixed(3), st: g.player.state, crawl: g.player.crawling, dead: g.player.dead, mode: g.mode, cp: g.cpIndex, t: +g.time.toFixed(2), deaths: g.stats.deaths, guard: g.level.guard.state, gx: +g.level.guard.body.x.toFixed(2), beam: +g.level.searchlight.aim.x.toFixed(2), plate: +g.level.plate.load.toFixed(2), bridge: +g.level.bridge.angle.toFixed(2), crateA: [+g.level.crateA.body.x.toFixed(2), +g.level.crateA.body.y.toFixed(2)], crateB: [+g.level.crateB.body.x.toFixed(2), +g.level.crateB.body.y.toFixed(2)], lever: g.level.lever.pulled, ladder: g.level.ladder.vine.enabled }),
      // run the simulation without rendering: seconds, input object or fn(state)->input
      sim: (seconds, input) => {
        const n = Math.round(seconds / STEP);
        for (let i = 0; i < n; i++) {
          const st = typeof input === 'function' ? input(window.__medina.state()) : input;
          const prevState = g.input.state;
          const s = { x: 0, y: 0, jump: false, grab: false, pause: false, any: true, ...st };
          g.input.prev = prevState; g.input.state = s;
          g.input.jumpPressed = s.jump && !prevState.jump; g.input.grabPressed = s.grab && !prevState.grab;
          if (g.mode === 'intro') g.beginPlay();
          g.fixed(STEP, s, true);
          g.time += STEP;
          if (g.mode === 'dying' && g.dieT > 2.35) g.respawn();
        }
        g.player.prev.set(g.player.x, g.player.y);
        return window.__medina.state();
      },
      teleport: (x, y = 0) => { g.player.spawn(x, y, 1); g.camRig.snapNext = true; },
      checkpoint: (i) => { g.cpIndex = i; g.prepareForCheckpoint(i); g.respawn(); },
      finale: () => { g.player.spawn(187.6, 0, 1); g.mode = 'play'; g.startFinale(); },
      setInput: (o) => { g.input.override = o; },
      // close camera on the boy; pose: run|walk|idle|air|hang|climb|push|pull|crawl|dead
      closeup: (pose = 'idle', dist = 3.2, phase = 0.2, yawOff = 0) => {
        const pl = g.player;
        g.camRig.setOverride(() => ({ pos: new THREE.Vector3(pl.x + 0.2, pl.y + 0.9, (pl.z || 0) + dist), look: new THREE.Vector3(pl.x, pl.y + 0.62, pl.z || 0), fov: 35 }), 0.001);
        g.camRig.overrideW = 1; g.camRig.overrideTarget = 1;
        g.debugPose = { pose, phase, yawOff };
      },
      // put the boy somewhere and settle the camera instantly (for screenshots)
      photo: (x, y = 0, facing = 1, simSec = 0.4) => {
        g.fade = 0; g.fadeTarget = 0; g.titleFade = undefined; g.ui.showTitle(false);
        if (g.mode === 'intro') g.beginPlay();
        g.mode = 'play'; g.dieT = 0;
        g.player.spawn(x, y, facing);
        if (g.rig.scarf) g.rig.scarf.reset();
        if (simSec > 0) window.__medina.sim(simSec, { x: 0 });
        g.camRig.override = null; g.camRig.overrideW = 0; g.camRig.overrideTarget = 0;
        g.camRig.groundY = g.player.y; g.camRig.snapNext = true; g.camRig.aheadX = facing * g.camRig.paramsAt(x).ahead;
        g.ui.el('hint').classList.add('hidden'); g.ui.hintTimer = 0;
        return window.__medina.state();
      },
      pause: (p) => g.setPaused(p),
    };
  }
}

function makeGlowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d');
  const gr = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,220,170,1)'); gr.addColorStop(0.25, 'rgba(255,170,90,.45)'); gr.addColorStop(1, 'rgba(255,140,60,0)');
  x.fillStyle = gr; x.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
