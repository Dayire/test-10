import * as THREE from 'three';
import { PhysicsWorld } from './physics.js';
import { Player } from './player.js';
import { Animator } from './animator.js';
import { CameraRig } from './camera.js';
import { createCharacter, BOY } from '../assets/character.js';
import { G } from '../render/atmosphere.js';
import { updateAtmosphere } from '../render/world.js';
import { LightRig } from '../render/lightrig.js';
import { LookDirector } from '../render/lookdirector.js';
import { Events } from './events.js';
import { ChapterLoader, makeGlowTexture, buildChapterFX } from './chapterloader.js';
import { DepthWalk, introShot } from './cinematics.js';
import { installTestApi } from './testapi.js';
import { Save } from '../core/save.js';
import { storage } from '../core/storage.js';

// The engine: one Game for the session (camera, light rig, boy, test API)
// and one chapter at a time (game.level = L, built by the ChapterLoader).
// Fixed 120 Hz simulation, interpolated rendering, a generic entity/system
// loop, the flow API (new / continue / chapters / restart / title), saves,
// settings, events and hooks. Chapters never edit this file: they declare
// what they need through the chapter contract (docs/ARCHITECTURE.md).

export const STEP = 1 / 120;
export const MODES = ['boot', 'menu', 'loading', 'intro', 'play', 'dying', 'cutscene', 'finale', 'chapterEnd', 'credits'];
const INPUT_MODES = new Set(['play', 'finale']);
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const ZERO_INPUT = { x: 0, y: 0, jump: false, grab: false, pause: false, any: false, pointer: null };
// surfaces the session objects (the boy) need before any chapter loads
export const SESSION_SURFACES = ['fabricCream'];
export const DEFAULT_CREDITS = ['made entirely of code', 'three.js'];
export const DEFAULT_SETTINGS = {
  shake: 100, reduceMotion: false, cameraDist: 'normal', timeScale: 1, generous: false, coyote: null, buffer: null, assist: false,
  hints: 'first', invertTilt: false, aimSnap: true, grabMode: 'hold', crawlMode: 'hold',
  fpsCap: null, renderScale: 100, dynres: true, dof: true, grain: 60, brightness: 0, quality: 'auto', volumes: {},
};

export class Game {
  constructor(world, input, audio, ui, params = {}, { save } = {}) {
    this.world = world; this.input = input; this.audio = audio; this.ui = ui; this.params = params;
    this.scene = world.scene; this.mats = world.mats; this.globals = G;
    this.save = save || new Save(storage);
    this.time = 0; this.acc = 0; this.timeScale = 1;
    this.mode = 'boot'; this.paused = false; this.menuOpen = false; this.suspended = false;
    this.fade = 1; this.fadeTarget = 0; this.fadeSpeed = 0.6; this.fadeColor = new THREE.Color(0, 0, 0);
    this.stats = { deaths: 0, t0: 0 };
    this.events = new Events(); this.events.clock = () => this.time;
    this.hooks = { frame: [], card: null, credits: null, hint: null };
    this.ext = {};
    this.settings = { ...DEFAULT_SETTINGS };
    this.assist = false; this.guardSpeedMul = 1;
    this.mix = {};
    this.tracked = new Set();
    this.def = null; this.chapterId = null; this.level = null; this.root = null;
    this.vines = [];
    this.resetChapterState();
    this._focus = new THREE.Vector3(); this._v = new THREE.Vector3(); this._wind = new THREE.Vector3(); this._ndc = new THREE.Vector3();
    this.save.onWrite = (d) => this.emit('save', { chapter: d.chapter, cp: d.cp });
  }

  // ------------------------------------------------------------------ lifetimes
  // session objects: camera, rig, light rig, look director, boy, FX textures, test API
  initOnce({ pool = 6 } = {}) {
    const rs = this.world.rs;
    this.phys = new PhysicsWorld();
    this.camera = new THREE.PerspectiveCamera(34, rs.cssW / rs.cssH, 0.1, 1500);
    rs.camera = this.camera;
    this.camRig = new CameraRig(this.camera);
    // fixed light rig (sun, hemi, fill, pool, two spots) before anything compiles
    this.lightRig = new LightRig(this.scene, this.world, { pool, tier: rs.tier });
    this.lightPool = this.lightRig.pool;
    this.charLight = this.lightRig.charLight;
    const tierCb = rs.onTierChange;
    rs.onTierChange = (t, q) => { tierCb?.(t, q); this.lightRig.setTier(t); };
    this.director = new LookDirector(this.world);
    this.director.pool = this.lightPool;
    this.director.apply('goldenHour');
    this.player = new Player(this);
    this.rig = createCharacter(BOY, this.mats);
    this.rig.root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.scene.add(this.rig.root);
    if (this.rig.scarf) this.scene.add(this.rig.scarf.mesh);
    this.anim = new Animator(this.rig);
    this.anim.onFootstep = (speed, st) => {
      const g = this.player.groundObj;
      if (speed > 3.2 && this.dust && Math.random() < 0.5) this.dust.emit(new THREE.Vector3(this.player.x - this.player.facing * 0.15, this.player.y, (this.player.z || 0) + 0.1), { count: 1, spread: 0.3, up: 0.25, size: 0.3, alpha: 0.18, life: 0.7 });
      this.audio.play('step', this.player.x, { surface: g?.surface || 'stone', speed: st === 'crawl' ? 1 : speed });
    };
    this.phys.onImpact = (b, speed, hit) => {
      this.emit('impact', { x: b.x, speed, kind: b.kind });
      if (b.onImpact) b.onImpact(speed, hit);
      else if (b.kind === 'crate') { this.sfx('crateImpact', b.x); if (speed > 6) this.camRig.addShake(0.5); this.dust && this.dust.emit(new THREE.Vector3(b.x, b.y, 0), { count: 14, spread: 1.4, up: 0.5, size: 0.9, alpha: 0.35 }); }
    };
    this.glowTex = makeGlowTexture();
    this.loader = new ChapterLoader(this);
    this.applySettings(this.settings, { persist: false });
    installTestApi(this);
    return this;
  }

  // per-chapter fields (the loader calls this between unload and build)
  resetChapterState() {
    this.level = null;
    this.entities = []; this.systems = []; this.interactables = []; this.triggers = []; this.checkpoints = [];
    this.vines.length = 0;
    this.cpIndex = 0; this.cpSnap = null; this.initialSnap = null;
    this.cinema = null; this.dieT = 0; this.deathKind = null;
    this.titleShown = false; this.introT = 0;
    this._crateMoving = 0; this._vy = undefined; this._zone = undefined;
    this.shafts = null; this.dust = null; this.flock = null;
    if (this.camRig) this.camRig.reset();
  }

  // the loader hands over a built level: generic lists, FX, camera keys, first snapshot
  wireChapter(L) {
    this.entities = L.entities.filter(Boolean);
    this.systems = L.systems.filter(Boolean);
    this.interactables = L.interactables.filter(Boolean);
    this.triggers = L.triggers.filter(Boolean);
    // snapshot keys: explicit id, else Kind#i in build order
    const n = {};
    for (const list of [this.entities, this.systems, this.triggers]) for (const e of list) {
      if (e.id !== undefined && e.id !== null) continue;
      const k = e.constructor?.name || 'Entity';
      e.id = `${k}#${n[k] = (n[k] ?? -1) + 1}`;
    }
    const fx = buildChapterFX(this, L);
    this.shafts = fx.shafts; this.dust = fx.dust; this.flock = fx.flock;
    this.director.shafts = this.shafts;
    this.camRig.setKeys(L.cameraKeys);
    this.checkpoints = L.checkpoints.sort((a, b) => a.x - b.x);
    if (!this.checkpoints.length) this.checkpoints.push({ x: -100, spawn: { x: 0, y: 0, facing: 1 } });
    this.world.light.setExtent?.(L.shadowExtent || 22); // 22 m: the world's default sun shadow extent
    this.initialSnap = this.snapshot();
  }

  // starting at checkpoint i: the chapter solves what precedes it, then the boy spawns
  placeAt(i) {
    this.cpIndex = i;
    this.level.prepare?.(i, this);
    this.cpSnap = this.snapshot();
    const s = this.checkpoints[i].spawn;
    this.player.spawn(s.x, s.y, s.facing ?? 1);
    this.anim.setState('ground', 0.01);
    if (this.rig.scarf) this.rig.scarf.reset();
    this.camRig.reset(); this.camRig.groundY = s.y; this.camRig.snapNext = true;
    this._vy = undefined;
  }

  // the chapter is built and warm: intro shot or straight to play, then reveal
  enterChapter({ reason = 'start', card = null } = {}) {
    const def = this.def;
    this.suspended = false;
    if (this.saving) this.save.begin?.(def.id, this.cpIndex, reason);
    this.audio.setChapter?.(def.audio, def);
    this.emit('chapterStart', { id: def.id, cp: this.cpIndex, reason });
    this.setMode('intro');
    this.introT = 0;
    this.titleShown = (reason === 'boot' && !this.params.autostart) || reason === 'title';
    const shot = this.openingShot();
    if (shot) { this.camRig.setOverride(introShot(this, shot), 0.001); this.camRig.overrideW = 1; }
    else if (!this.titleShown) this.beginPlay(); // started at a later checkpoint: no establishing shot, straight to play
    if (this.titleShown) { this.titleFade = undefined; this.ui.showTitle(true); this.ui.titleOpacity?.(1); }
    if (reason !== 'boot') { this.fade = 1; this.fadeTarget = 0; this.fadeSpeed = 0.8; this.audioIn(1.5); }
    if (this.params.autostart && reason !== 'title') this.beginPlay();
    if (card) Promise.resolve(card.hide?.()).catch(() => {});
  }

  snapshot() {
    const s = { ents: {}, sys: {}, trig: {} };
    for (const e of this.entities) s.ents[e.id] = e.getState();
    for (const y of this.systems) if (y.getState) s.sys[y.id] = y.getState();
    for (const t of this.triggers) s.trig[t.id] = t.getState();
    return s;
  }
  restore(s) {
    for (const e of this.entities) if (e.id in s.ents) e.setState(s.ents[e.id]);
    for (const y of this.systems) if (y.setState && y.id in s.sys) y.setState(s.sys[y.id]);
    for (const t of this.triggers) if (t.id in s.trig) t.setState(s.trig[t.id]);
  }

  sfx(name, x, data) { this.audio.play(name, x, data); }
  emit(name, data) { this.events.emit(name, data); }
  add(o) { (this.root || this.scene).add(o); return o; }
  // disposed with the chapter (objects outside the root, chapter textures and materials)
  track(o) { this.tracked.add(o); return o; }
  registerExt(name, fn) { this.ext[name] = fn; return fn; }
  safeZone(x) { return !!this.level?.safeZone?.(x); }
  interactNear(px, py, facing) { for (const it of this.interactables) if (it.near(px, py, facing)) return it; return null; }
  setMode(m) { if (this.mode === m) return; this.mode = m; this.emit('mode', { mode: m }); }
  // dev chapters (the lab) never touch the save
  get saving() { return !!this.def && !this.def.dev; }
  // the title holds the chapter at its checkpoint: no entity or system steps, so nothing threatens the boy
  get held() { return this.mode === 'intro' && this.titleShown; }
  // the mix comes back after a cinematic faded it out; a mute the player set stays
  audioIn(sec = 1.5) { const a = this.audio; if (!a.muted || a.setMuted) a.fadeIn?.(sec); }

  // ------------------------------------------------------------------ loop
  frame(dt) {
    dt = Math.min(dt, 0.1);
    for (const f of this.hooks.frame) f(dt, this);
    let inp = this.input.poll();
    if (this.menuOpen) inp = this.input.state = { ...ZERO_INPUT };
    if (this.input.pausePressed && !this.menuOpen && !this.suspended && (this.mode === 'play' || this.mode === 'intro' || this.paused)) this.setPaused(!this.paused);
    if (this.mode === 'intro' && !this.paused) {
      this.introT += dt;
      if (this.params.autostart) this.beginPlay();
      else if (this.input.anyPressed && !this.menuOpen) this.introInput();
      else if (!this.titleShown && this.def?.intro && this.introT > (this.def.intro.dur ?? 5)) this.beginPlay();
    }
    this.ui.update(dt);
    if (this.mode === 'loading' || this.mode === 'boot') return;
    if (this.paused) {
      // freeze-frame: one dimmed frame, then nothing until resume
      if (this._pauseFrames > 0) { this._pauseFrames--; this.render(0, this.acc / STEP); }
      return;
    }
    if (!this.params.hold && !this.suspended) {
      const sdt = dt * this.timeScale;
      this.acc += sdt;
      let first = true;
      let n = 0;
      while (this.acc >= STEP && n < 12) {
        this.fixed(STEP, inp, first);
        first = false; this.acc -= STEP; n++;
      }
      if (n >= 12) this.acc = 0;
      this.time += sdt;
      if (this.mode === 'play' && this.saving) this.save.play(this.chapterId, sdt);
    }
    this.render(dt, this.acc / STEP);
  }

  // the boy's input for one fixed step
  makePin(st, first) {
    const I = this.input, play = INPUT_MODES.has(this.mode);
    return {
      x: play ? st.x : 0, y: play ? st.y : 0,
      jump: play && !!st.jump, grab: play && !!st.grab,
      jumpPressed: first && I.jumpPressed && this.mode === 'play',
      upPressed: first && st.y > 0.6 && !(I.prev.y > 0.6) && this.mode === 'play',
      downPressed: first && st.y < -0.6 && !(I.prev.y < -0.6) && this.mode === 'play',
      grabPressed: first && I.grabPressed,
      pointerPressed: first && play && !!st.pointer?.pressed,
      aimTarget: play ? this.aimTarget(st) : null,
    };
  }

  // the world point under the pointer on the play plane (z = 0), or a scripted one
  aimTarget(st) {
    if (st.aimTarget) return st.aimTarget;
    const p = st.pointer;
    if (!p || !p.active) return null;
    const cam = this.camera;
    const d = this._ndc.set(p.x, p.y, 0.5).unproject(cam).sub(cam.position).normalize();
    if (Math.abs(d.z) < 1e-6) return null;
    const t = -cam.position.z / d.z;
    if (t <= 0) return null;
    return { x: cam.position.x + d.x * t, y: cam.position.y + d.y * t };
  }

  fixed(dt, st, first) {
    const pin = this.makePin(st, first);
    // under the title only what declares liveUnderTitle (it can never threaten the boy) keeps stepping
    const pl = this.player, L = this.level, live = !this.held;
    for (const e of this.entities) if (live || e.liveUnderTitle) e.prestep?.();
    for (const s of this.systems) if (live || s.liveUnderTitle) s.prestep?.();
    pl.step(dt, pin);
    for (const e of this.entities) if (live || e.liveUnderTitle) e.step?.(dt);
    this.phys.stepBodies(dt);
    // bodies falling onto the boy
    if (live) for (const b of this.phys.bodies) {
      if (!b.crushes || !b.enabled) continue;
      const p = pl.body;
      if (!pl.dead && b.vy < -3 && b.x1 > p.x0 + 0.05 && b.x0 < p.x1 - 0.05 && b.y < p.y + p.h && b.y > p.y + p.h - 0.4) { pl.die('crushed'); this.sfx('crateImpact', b.x); }
    }
    for (const s of this.systems) if (live || s.liveUnderTitle) s.step?.(dt);
    // kill zones: the boy's feet inside
    const kz = L?.killZones;
    if (live && kz && kz.length && !pl.dead) for (const z of kz) if (pl.x >= z.x0 && pl.x <= z.x1 && pl.y >= z.y0 && pl.y <= z.y1) { pl.die(z.kind || 'fall'); break; }
    if (this.mode === 'play') {
      for (const t of this.triggers) t.test(this);
      // checkpoints: grounded, x >= cp.x and y >= minY
      const cps = this.checkpoints;
      let moved = false;
      for (let i = this.cpIndex + 1; i < cps.length; i++) {
        const c = cps[i];
        if (pl.x >= c.x && (c.minY === undefined || pl.y >= c.minY) && pl.state === 'ground' && !pl.dead) { this.cpIndex = i; this.cpSnap = this.snapshot(); moved = true; }
      }
      if (moved) { this.emit('checkpoint', { id: this.chapterId, cp: this.cpIndex }); if (this.saving) this.save.checkpoint(this.chapterId, this.cpIndex); }
    }
    // player events -> sound / feedback
    for (const [name, data] of pl.events) {
      if (name === 'land') {
        this.sfx('land', pl.x, data); this.anim.land(Math.min(1, data.speed / 11) * (data.hard ? 1.3 : 0.8));
        if (data.hard) this.camRig.addShake(0.35);
        if (data.speed > 5) this.dust.emit(new THREE.Vector3(pl.x, pl.y, pl.z || 0), { count: data.hard ? 12 : 6, spread: data.hard ? 1.2 : 0.7, size: data.hard ? 0.7 : 0.45, alpha: 0.3 });
        this.emit('land', data);
      }
      else if (name === 'death') this.onDeath(data);
      else if (name === 'crateMove') { this._crateMoving = 0.1; }
      else this.sfx(name, pl.x, data);
    }
    pl.events.length = 0;
    this._crateMoving = Math.max(0, (this._crateMoving || 0) - dt);
    if (this.mode === 'dying') this.updateDying(dt);
    if (this.mode === 'finale' || this.mode === 'cutscene') this.cinema?.update(dt);
  }

  // ------------------------------------------------------------------ flow
  loadChapter(id, cp = 0, opts = {}) { return this.loader.load(id, cp, opts); }
  newGame() { this.save.newJourney(); return this.loadChapter('souk', 0, { reason: 'start' }); }
  continueGame() { const d = this.save.data; return this.loadChapter(d.chapter, d.cp, { reason: 'continue' }); }
  startChapter(id, cp = 0) { return this.loadChapter(id, cp, { reason: 'select' }); }

  // the establishing shot fits the chapter's start only; under the title a menuShot naming this checkpoint wins.
  // Elsewhere the title shows the rail camera on the boy at his checkpoint (a far shot would frame the wrong place).
  openingShot() {
    const d = this.def, m = d?.menuShot;
    if (this.titleShown && m && (m.cp ?? 0) === this.cpIndex) return m;
    return this.cpIndex === 0 ? d?.intro || null : null;
  }

  // the intro shot: the title waits for input; a chapter intro takes input after 1.5 s
  introInput() {
    if (this.mode !== 'intro') return;
    if (this.titleShown || this.introT > 1.5) this.beginPlay();
  }

  beginPlay() {
    if (this.mode !== 'intro' && this.mode !== 'menu') return;
    this.setMode('play');
    this.audio.start();
    if (!this._hinted) {
      this._hinted = true;
      if (this.hooks.hint) this.hooks.hint('controls', this); else this.ui.showHint(this.input.lastDevice, 9, this.input.keyLabels);
    }
    this.titleFade = 1; this.titleShown = false;
    this.camRig.clearOverride(2.8);
    this.stats.t0 = this.time;
  }

  // freeze-frame pause; audio ducks (or the context suspends on older audio engines)
  setPaused(p) {
    p = !!p;
    if (p === this.paused) return;
    if (p && (this.mode === 'loading' || this.mode === 'boot' || this.suspended)) return;
    this.paused = p; this._pauseFrames = p ? 1 : 0;
    this.ui.showPause(p, this.input.lastDevice, this.world.rs.tier, this.audio.muted, this.input.keyLabels);
    if (this.audio.setPaused) this.audio.setPaused(p);
    else if (this.audio.ctx) { if (p) this.audio.ctx.suspend(); else this.audio.ctx.resume(); }
    this.emit('pause', { on: p });
    if (p) this.save.flush(true);
  }
  // a menu is open over the game: input never reaches the boy
  setMenuOpen(b) { this.menuOpen = !!b; if (b) { this.input.state = { ...ZERO_INPUT }; this.input.prev = { ...ZERO_INPUT }; } }
  // ask for one more freeze-frame (resize while paused)
  redraw() { if (this.paused) this._pauseFrames = 1; }

  onDeath(kind) {
    this.setMode('dying'); this.dieT = 0; this.deathKind = kind; this.stats.deaths++;
    if (this.saving) this.save.death(this.chapterId);
    this.emit('death', { kind, x: this.player.x, y: this.player.y });
    this.sfx('death', this.player.x);
    if (kind === 'fall' || kind === 'crushed') this.camRig.addShake(0.6);
  }

  updateDying(dt) {
    this.dieT += dt;
    if (this.deathKind === 'restart') { if (this.dieT > 0.26) this.respawn(); return; }
    if (this.dieT > 1.6 && this.fadeTarget !== 1) { this.fadeTarget = 1; this.fadeSpeed = 1.8; this.fadeColor.set(0, 0, 0); }
    if (this.dieT > 2.35) this.respawn();
  }

  respawn() {
    const restart = this.deathKind === 'restart';
    this.resetToCheckpoint();
    // a death under the title (it should not happen: the title holds the chapter) returns to the title
    this.setMode(this.titleShown ? 'intro' : 'play');
    this.fadeTarget = 0; this.fadeSpeed = restart ? 3.4 : 1.2;
    this.audio.lowpass && this.audio.ctx && this.audio.lowpass.frequency.setTargetAtTime(20000, this.audio.ctx.currentTime, 0.3);
    this.emit('respawn', { cp: this.cpIndex, restart });
  }

  // the chapter back at its checkpoint snapshot and the boy at its spawn (cinematic stopped, look restored)
  resetToCheckpoint() {
    if (this.cinema) { this.cinema.stop(); this.cinema = null; this.camRig.clearOverride(0.01); }
    const cp = this.checkpoints[this.cpIndex];
    this.restore(this.cpSnap);
    this.player.spawn(cp.spawn.x, cp.spawn.y, cp.spawn.facing ?? 1);
    this.player.events.length = 0;
    this.anim.setState('ground', 0.01);
    if (this.rig.scarf) this.rig.scarf.reset();
    this.camRig.groundY = cp.spawn.y; this.camRig.snapNext = true;
    this._vy = undefined;
    this.deathKind = null; this.dieT = 0;
  }

  // back to the last checkpoint without counting a death (fade out and in, under 0.6 s)
  restartCheckpoint() {
    if (!['play', 'dying', 'finale', 'cutscene'].includes(this.mode) || this.deathKind === 'restart') return false;
    if (this.paused) this.setPaused(false);
    if (this.player.dead) { this.player.dead = false; this.player.state = 'ground'; }
    this.player.scripted = null;
    this.setMode('dying'); this.dieT = 0; this.deathKind = 'restart';
    this.fadeColor.set(0, 0, 0); this.fadeTarget = 1; this.fadeSpeed = 4;
    return true;
  }

  // the chapter from its start, in place (initial snapshot, preset, flock)
  restartChapter() {
    if (this.paused) this.setPaused(false);
    if (!this.level || !this.initialSnap || this.mode === 'loading') return this.loadChapter(this.chapterId || 'souk', 0, { reason: 'restart' });
    this.cinema?.stop(); this.cinema = null;
    this.flock?.reset();
    const look = this.def.look;
    if (Array.isArray(look)) this.director.apply(look[0].preset).keys(look); else this.director.apply(look || 'goldenHour');
    this.director.restore();
    this.cpIndex = 0; this.cpSnap = this.initialSnap;
    this.deathKind = null;
    // chosen from the pause menu over the title: the title gives way to play
    if (this.titleShown) { this.titleShown = false; this.titleFade = undefined; this.ui.showTitle(false); }
    this.respawn();
    this.camRig.clearOverride(0.01);
    this.ui.showEnd(false);
    return Promise.resolve(this.level);
  }

  // the title over the save's chapter at its checkpoint: a dip to black (the sim waits), the chapter back at its
  // checkpoint (the state Continue loads), the establishing shot, and the chapter held until play begins
  async toTitle() {
    if (this.paused) this.setPaused(false);
    if (this.mode === 'loading' || this.mode === 'boot') return this.loader.busy || this.level;
    const d = this.save.exists ? this.save.data : null;
    if (d && d.chapter !== this.chapterId && this.saving) return this.loadChapter(d.chapter, d.cp, { reason: 'title' });
    if (!this.level || !this.saving) return this.loadChapter(d?.chapter || 'souk', d?.cp ?? 0, { reason: 'title' });
    this.suspended = true;
    try { await this.fadeTo(1, { color: '#000000', sec: 0.4 }); } finally { this.suspended = false; }
    if (!this.level || this.mode === 'loading') return this.level;
    this.resetToCheckpoint();
    this.restartChapterLook(); this.director.restore();
    this.setMode('intro'); this.introT = 0; this.titleShown = true; this.titleFade = undefined;
    this.ui.showEnd(false); this.ui.hideHint?.(); this.ui.showTitle(true); this.ui.titleOpacity?.(1);
    const shot = this.openingShot();
    if (shot) { this.camRig.setOverride(introShot(this, shot), 0.001); this.camRig.overrideW = 1; }
    else { this.camRig.clearOverride(0.01); this.camRig.snapNext = true; }
    this.fadeTarget = 0; this.fadeSpeed = 0.8;
    this.audioIn(1.5);
    this.emit('title', { id: this.chapterId, cp: this.cpIndex });
    return this.level;
  }
  restartChapterLook() { const look = this.def?.look; if (Array.isArray(look)) this.director.apply(look[0].preset).keys(look); else this.director.apply(look || 'goldenHour'); }

  // the chapter's finale or exit: save, event, then the next chapter behind a card (or the credits)
  completeChapter() {
    if (this.mode === 'chapterEnd' || this.mode === 'loading' || this.mode === 'credits' || !this.def) return null;
    const id = this.def.id, next = this.def.next ?? null;
    if (this.def.dev) return this.endDevChapter();
    this.setMode('chapterEnd');
    this.save.chapterEnd(id, next);
    this.emit('chapterEnd', { id, next });
    this.level?.onComplete?.(this);
    if (next) return this.loadChapter(next, 0, { reason: 'chain' });
    return this.rollCredits();
  }

  // a dev chapter's end (the lab): no save, no credits; it starts over behind a short dip to black
  async endDevChapter() {
    this.setMode('chapterEnd');
    this.emit('chapterEnd', { id: this.def.id, next: null, dev: true });
    this.level?.onComplete?.(this);
    this.suspended = true;
    try { await this.fadeTo(1, { color: '#000000', sec: 0.6 }); } finally { this.suspended = false; }
    if (this.mode !== 'chapterEnd') return this.level;
    return this.restartChapter();
  }

  async rollCredits() {
    this.setMode('credits');
    const lines = this.level?.credits || this.def?.credits || DEFAULT_CREDITS;
    this.emit('credits', { lines });
    try { if (this.hooks.credits) await this.hooks.credits(lines, this); } catch (e) { console.error(e); }
    return this.toTitle();
  }

  // start the chapter's scripted walk (L.finale, a DepthWalk config)
  startFinale() {
    if (this.mode === 'finale' || !this.level?.finale) return;
    this.cinema = new DepthWalk(this, { onEnd: () => this.completeChapter(), ...this.level.finale });
    this.cinema.start();
    this.ui.hideHint?.();
  }

  // after a lost GL context comes back: baked surfaces and the env map only lived on the GPU,
  // so bake them again in place, then reload the chapter at its checkpoint
  async recoverContext() {
    this.world.baker?.rebakeAll?.();
    this.world.rebuildEnvironment?.();
    for (const s of this.lightRig.spots) s.shadow.needsUpdate = true;
    this.emit('contextRestored', { id: this.chapterId, cp: this.cpIndex });
    if (this.chapterId && this.mode !== 'loading') return this.loadChapter(this.chapterId, this.cpIndex, { reason: 'restart' });
    return this.level;
  }

  // promise: fade the canvas to `target` (1 = covered) in `sec`
  fadeTo(target, { color, sec = 0.8 } = {}) {
    if (color !== undefined && color !== null) this.fadeColor.set(color);
    this.fadeTarget = target; this.fadeSpeed = 1 / Math.max(0.05, sec);
    const t0 = performance.now();
    return new Promise((res) => {
      const check = () => {
        if (Math.abs(this.fade - target) < 1e-3 || performance.now() - t0 > sec * 1000 + 700) { this.fade = target; res(); }
        else setTimeout(check, 30);
      };
      check();
    });
  }

  // ------------------------------------------------------------------ settings
  // engine settings apply here; the rest are forwarded (render, audio, input)
  applySettings(s = {}, { persist = true } = {}) {
    const S = this.settings = { ...this.settings, ...s };
    const cr = this.camRig;
    if (cr) {
      cr.shakeScale = Math.max(0, +S.shake) / 100;
      cr.reduceMotion = !!S.reduceMotion;
      cr.distMul = typeof S.cameraDist === 'number' ? S.cameraDist : ({ close: 0.85, normal: 1, wide: 1.12 }[S.cameraDist] ?? 1);
    }
    const ts = +S.timeScale || 1;
    this.timeScale = ts > 2 ? ts / 100 : ts;
    if (this.player) {
      const T = this.player.tune;
      T.coyote = S.coyote ?? (S.generous ? 0.18 : 0.1);
      T.buffer = S.buffer ?? (S.generous ? 0.2 : 0.14);
    }
    this.guardSpeedMul = S.generous ? 0.95 : 1;
    this.assist = !!S.assist;
    this.dofOn = S.dof !== false;
    this.director?.setUser({ brightness: +S.brightness || 0, grain: S.grain ?? 60 });
    const rs = this.world.rs;
    if (s.quality !== undefined && rs) {
      if (S.quality === 'auto') rs.autoQuality = !this.params.noauto;
      else if (rs.tier !== S.quality) { rs.autoQuality = false; rs.setTier(S.quality); }
      else rs.autoQuality = false;
    }
    rs?.applySettings?.(S);
    if (S.volumes) this.audio.setVolumes?.(S.volumes);
    this.input.applySettings?.(S);
    if (persist) this.save.settings(s);
    return S;
  }

  // ------------------------------------------------------------------ render
  render(dt, alpha) {
    const rs = this.world.rs;
    const pl = this.player;
    const P = rs.post.params;
    const L = this.level;
    if (!this.paused && L) {
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
      const d = targetYaw - root.rotation.y;
      const a = w * w * d - 2 * w * (pl.yawVel || 0);
      pl.yawVel = (pl.yawVel || 0) + a * dt;
      root.rotation.y += pl.yawVel * dt;
      // animation state
      let { st, fade } = pl.animState();
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
      if (this.debugPose) { this.anim.prevVx = pl.body.vx; }
      this.anim.update(dt, pl.animContext(L.lookTarget?.(pl) ?? null));
      root.updateMatrixWorld(true);
      if (this.debugPose) { root.rotation.y = targetYaw + this.debugPose.yawOff; pl.yawVel = 0; if (this.debugPose.pose === 'climb') root.rotation.y = Math.PI + this.debugPose.yawOff; }
      if (this.rig.scarf) {
        const wind = this._wind.set(-pl.body.vx * 6 - 1.5, 0.6, -0.8 + Math.sin(this.time * 0.7) * 1.2);
        this.rig.scarf.update(dt, wind);
      }
      // entities and systems
      for (const e of this.entities) e.render?.(alpha, dt);
      for (const s of this.systems) s.render?.(alpha, dt);
      // lanterns flicker
      for (const l of L.lanterns) {
        const f = 0.85 + Math.sin(this.time * 9 + l.phase) * 0.08 + Math.sin(this.time * 23 + l.phase * 2) * 0.05;
        if (l.sprite) { l.sprite.material.opacity = 0.5 * f * this.director.glowMul; l.sprite.material.color.copy(this.director.glowColor); }
        l.mesh.rotation.z = Math.sin(this.time * 0.8 + l.phase) * 0.03;
      }
      this.charLight.position.set(x + 0.6, this._vy + 1.5, z + 1.6);
      // priority sources (a guard's lantern, a beam's hit spot) win a light only near the view
      this.lightPool.update(this.camRig.look, this.time, dt, { range: (this.viewHalfW || 12) + 6 });
      this.dust?.update(dt);
      this.flock?.update(dt, x, this._vy, Math.abs(pl.body.vx) + (pl.state === 'air' ? 2 : 0), (bx) => this.sfx('wings', bx));
      // camera
      const ppos = this._v.set(x, this._vy, z);
      const cp = this.camRig.update(dt, pl, ppos, pl.facing, pl.state === 'ground');
      // depth of field follows the boy
      const fd = this.camera.position.distanceTo(this._focus.set(x, this._vy + 0.7, z));
      P.focus = fd; P.nearRange = Math.max(2.5, fd * 0.28); P.farStart = fd * 1.1; P.farRamp = 40;
      const dof = this.mode === 'finale' && this.cinema?.dof;
      P.nearBlur = dof ? dof.near : cp.dofNear; P.farBlur = dof ? dof.far : cp.dofFar;
      if (!this.dofOn) { P.nearBlur = 0; P.farBlur = 0; }
      // fades
      this.fade += Math.sign(this.fadeTarget - this.fade) * Math.min(Math.abs(this.fadeTarget - this.fade), dt * this.fadeSpeed);
      P.fade = smooth(this.fade); P.fadeColor.copy(this.fadeColor);
      // title
      if (this.titleFade !== undefined) { this.titleFade = Math.max(0, this.titleFade - dt * 0.35); this.ui.titleOpacity(this.titleFade); if (this.titleFade <= 0) { this.ui.showTitle(false); this.titleFade = undefined; } }
      // view half-width at the play plane (lamps acquire rig spots near the view)
      this.viewHalfW = Math.abs(this.camera.position.z) * Math.tan(THREE.MathUtils.degToRad(this.camera.fov) / 2) * this.camera.aspect;
      // time of day (writes sun, sky, fog, post and the lantern pool)
      this.director.update(x, dt);
      // shadow frustum follows the view: the override's shadowFocus, else the camera's look
      const sf = this.camRig.shadowFocus;
      if (sf) this._focus.copy(sf);
      else { const lk = this.camRig.override ? this.camRig.curLook : this.camRig.look; this._focus.set(lk.x, lk.y, this.mode === 'finale' ? -8 : -2); }
      this.world.light.update(this._focus);
      // audio listener & mix (generic fields + the chapter's)
      this.audio.setListener(x);
      const m = this.mix = {
        crateSpeed: this._crateMoving > 0 ? Math.abs(pl.body.vx) : 0, hum: 0, tension: 0.1, height: this._vy, birds: true, chase: false,
        finale: this.mode === 'finale' || this.mode === 'chapterEnd' || this.mode === 'credits', zone: null, music: null, loops: {},
        ...L.mix?.(x, this),
      };
      this.audio.update(dt, m);
      if (m.zone !== this._zone) { this._zone = m.zone; this.audio.setZone?.(m.zone); }
    } else if (this.paused) {
      // the freeze-frame is dimmed
      P.fade = Math.max(smooth(this.fade), 0.42); P.fadeColor.set(0, 0, 0);
    }
    updateAtmosphere(this.world, this.camera, this.time);
    rs.render(this.scene, this.camera, this.time);
  }
}
