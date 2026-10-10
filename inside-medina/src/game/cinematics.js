import * as THREE from 'three';

// Scripted camera work and walks. Every look change goes through the
// LookDirector's overrides, so ending or restarting restores the preset.
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const v3 = (a) => (a && a.isVector3 ? a.clone() : new THREE.Vector3(...a));

// DepthWalk: the boy leaves the play plane and walks a Catmull-Rom path into
// depth while the camera, sun and grade follow a script (Chapter I's finale).
// cfg: { path: [{p, pause?, pose?, onArrive?}], walkSpeed, autoWalkAfter,
//   camera(t, game) -> {pos, look, fov, shadowFocus?}, cameraBlend,
//   sunTo?: {dir, color?, colorAmt?, sec}, fogMul?, grade?: {contrast, saturation},
//   letterbox?, rays?, bloom?, dof?: {near, far}, zEnd, endHold, fade, onEnd(game) }
export class DepthWalk {
  constructor(game, cfg) {
    this.game = game;
    this.cfg = { walkSpeed: 1.55, autoWalkAfter: 2, cameraBlend: 3.2, endHold: 4.2, fade: { color: [0.97, 0.9, 0.78], speed: 0.28 }, ...cfg };
    this.path = cfg.path.map((w) => (w.isVector3 ? { p: w } : { ...w, p: v3(w.p) }));
    this.curve = new THREE.CatmullRomCurve3(this.path.map((w) => w.p), false, 'centripetal');
    this.len = this.curve.getLength();
    // arc length at each waypoint (pauses and arrivals)
    const div = 400, L = this.curve.getLengths(div), n = this.path.length;
    this.path.forEach((w, i) => { w.s = L[Math.round((i / Math.max(1, n - 1)) * div)]; });
    this.t = 0; this.s = 0; this.next = 1; this.pauseT = 0; this.pose = null;
    this.done = false; this.endT = 0; this.ended = false;
    this.sunFrom = null;
  }
  get dof() { return this.cfg.dof; }

  start() {
    const g = this.game, pl = g.player;
    g.setMode('finale');
    pl.grip = null; pl.fvx = 0;
    pl.scripted = (dt, p) => this.drive(dt, p);
    if (this.cfg.camera) g.camRig.setOverride(() => this.cfg.camera(this.t, g, this), this.cfg.cameraBlend);
    if (this.cfg.music !== false) g.audio.finale?.();
  }

  // scripted player driver, called from Player.step
  drive(dt, p) {
    const g = this.game, c = this.cfg;
    p.state = 'ground';
    const inp = g.input.state;
    const want = Math.max(inp.x, inp.y, this.t > c.autoWalkAfter ? 0.55 : 0, g.params.autostart ? 1 : 0);
    const v = c.walkSpeed * Math.min(1, want);
    if (this.pauseT > 0) { this.pauseT -= dt; p.fvx = 0; }
    else {
      p.fvx = (p.fvx || 0) + (v - (p.fvx || 0)) * (1 - Math.exp(-3 * dt));
      this.s = Math.min(this.len, this.s + p.fvx * dt);
    }
    // waypoint arrivals
    while (this.next < this.path.length && this.s >= this.path[this.next].s) {
      const w = this.path[this.next++];
      if (w.pause) { this.pauseT = w.pause; this.s = w.s; }
      this.pose = w.pose || null;
      w.onArrive?.(g, this);
    }
    const t = this.s / this.len;
    const pos = this.curve.getPointAt(t);
    const tan = this.curve.getTangentAt(Math.min(0.999, t + 0.01));
    p.body.x = pos.x; p.body.y = 0; p.z = pos.z;
    p.finaleYaw = Math.atan2(tan.x, tan.z);
    p.body.vx = p.fvx;
  }

  // per fixed step, after the player
  update(dt) {
    const g = this.game, c = this.cfg, D = g.director, B = D.base;
    this.t += dt;
    const ov = {};
    if (c.sunTo) {
      if (!this.sunFrom) this.sunFrom = B.sunDir.clone();
      const ks = smooth(this.t / (c.sunTo.sec ?? 7));
      ov.sunDir = this.sunFrom.clone().lerp(v3(c.sunTo.dir), ks).normalize();
      if (c.sunTo.color) ov.sunColor = B.sunColor.clone().lerp(new THREE.Color(c.sunTo.color), ks * (c.sunTo.colorAmt ?? 1));
      if (c.fogMul !== undefined) ov.fogDensity = B.fogDensity * (1 - (1 - c.fogMul) * ks);
      if (c.grade) { ov.contrast = B.contrast + (c.grade.contrast || 0) * ks; ov.saturation = B.saturation + (c.grade.saturation || 0) * ks; }
    }
    if (c.letterbox) ov.letterbox = c.letterbox * smooth(this.t / 4);
    if (c.rays !== undefined) ov.rays = c.rays;
    if (c.bloom !== undefined) ov.bloom = c.bloom;
    D.override(ov);
    const pl = g.player;
    if (!this.done && pl.z < c.zEnd) {
      this.done = true; this.endT = 0;
      g.fadeColor.setRGB(...c.fade.color); g.fadeTarget = 1; g.fadeSpeed = c.fade.speed;
      g.audio.fadeOut?.(6);
    }
    if (this.done) {
      this.endT += dt;
      if (this.endT > c.endHold && !this.ended) { this.ended = true; c.onEnd ? c.onEnd(g, this) : g.completeChapter(); }
    }
  }

  stop() {
    const g = this.game;
    if (g.player.scripted) g.player.scripted = null;
    g.director.restore();
  }
}

// establishing shot with a live, slow sway (the title / chapter intro)
export function introShot(game, shot) {
  const pos = v3(shot.pos), look = v3(shot.look), fov = shot.fov ?? 42, sway = shot.sway ?? 0.5;
  const focus = shot.shadowFocus ? v3(shot.shadowFocus) : null;
  const p = new THREE.Vector3();
  return () => ({ pos: p.set(pos.x + Math.sin(game.time * 0.05) * sway, pos.y, pos.z), look, fov, shadowFocus: focus });
}

// main-menu background shot (same contract; menus may add pointer parallax)
export function menuShot(game, shot) { return introShot(game, shot); }
