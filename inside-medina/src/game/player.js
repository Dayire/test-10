import * as THREE from 'three';
import { Body, GRAVITY, EPS } from './physics.js';

export const P = {
  run: 4.1, walk: 1.75, crawl: 1.15, push: 1.35, pull: 1.1,
  accel: 17, decel: 24, turn: 34, airAccel: 7.5, airMax: 4.1,
  jumpV: 6.35, coyote: 0.1, buffer: 0.14,
  w: 0.34, h: 1.16, hCrawl: 0.56,
  hangDrop: 1.47, hangFwd: 0.11,
  climbUpTime: 0.62, climbSpeed: 1.25, climbLat: 0.9,
  hardLand: 2.4, lethalFall: 6.6, stepUp: 0.26, mantleMax: 1.12,
  maxFall: 17,
};

const approach = (v, t, d) => (v < t ? Math.min(v + d, t) : Math.max(v - d, t));

export class Player {
  constructor(game) {
    this.game = game;
    this.phys = game.phys;
    this.body = new Body(0, 0, P.w, P.h, { kind: 'player', solid: false, pushable: false });
    this.body.kinematic = true;
    this.phys.addBody(this.body);
    this.state = 'ground';
    this.facing = 1;
    this.grounded = true; this.groundObj = null;
    this.coyote = 0; this.jumpBuf = 0;
    this.fallStartY = 0;
    this.hang = null; this.climbT = 0; this.climbFrom = new THREE.Vector2(); this.climbTo = new THREE.Vector2(); this.climbEndCrawl = false;
    this.vine = null; this.grip = null; this.lever = null;
    this.landLock = 0;
    this.dead = false; this.deathT = 0; this.deathKind = '';
    this.prev = new THREE.Vector2(); this.cur = new THREE.Vector2();
    this.renderPos = new THREE.Vector3();
    this.yaw = Math.PI / 2; this.yawVel = 0;
    this.animState = 'ground';
    this.pushing = 0;
    this.crawling = false;
    this.hidden = false; // in cover (used by stealth)
    this.scripted = null; // cutscene driver
    this.events = [];
  }

  emit(name, data) { this.events.push([name, data]); }

  get x() { return this.body.x; } get y() { return this.body.y; }

  spawn(x, y, facing = 1) {
    const b = this.body;
    b.x = x; b.y = y; b.vx = 0; b.vy = 0; b.h = P.h;
    this.state = 'ground'; this.facing = facing; this.dead = false; this.deathT = 0;
    this.hang = null; this.vine = null; this.grip = null; this.lever = null; this.crawling = false; this.landLock = 0;
    this.fallStartY = y; this.coyote = 0; this.jumpBuf = 0;
    this.prev.set(x, y); this.cur.set(x, y);
    this.yaw = this.targetYaw(); this.yawVel = 0;
    this.scripted = null;
    const g = this.phys.groundUnder(b, 0.05);
    this.grounded = !!g; this.groundObj = g;
    if (!g) this.state = 'air';
  }

  die(kind) {
    if (this.dead) return;
    this.dead = true; this.state = 'dead'; this.deathKind = kind; this.deathT = 0;
    this.grip = null; this.hang = null; this.vine = null;
    this.body.vx = 0;
    this.emit('death', kind);
  }

  // ------------------------------------------------------------------ fixed step
  step(dt, inp) {
    const b = this.body;
    this.prev.set(b.x, b.y);
    this.jumpBuf = inp.jumpPressed || (inp.y > 0.6 && inp.upPressed && !this.nearVine()) ? P.buffer : Math.max(0, this.jumpBuf - dt);
    if (this.scripted) { this.scripted(dt, this); this.cur.set(b.x, b.y); return; }
    switch (this.state) {
      case 'ground': this.stepGround(dt, inp); break;
      case 'air': this.stepAir(dt, inp); break;
      case 'hang': this.stepHang(dt, inp); break;
      case 'climbUp': this.stepClimbUp(dt, inp); break;
      case 'climb': this.stepClimb(dt, inp); break;
      case 'lever': this.stepLever(dt, inp); break;
      case 'dead': this.deathT += dt; this.stepDeadFall(dt); break;
    }
    this.cur.set(b.x, b.y);
  }

  standFree(x = this.body.x, y = this.body.y) {
    return this.phys.free(x - P.w / 2, y, x + P.w / 2, y + P.h, this.body);
  }

  nearVine() {
    const b = this.body;
    for (const v of this.game.vines) if (v.enabled !== false && b.x > v.x0 && b.x < v.x1 && b.y + 0.6 > v.y0 && b.y < v.y1 - 0.2) return v;
    return null;
  }

  stepGround(dt, inp) {
    const b = this.body;
    // ground check
    const g = this.phys.groundUnder(b, 0.04);
    if (!g) {
      this.state = 'air'; this.coyote = P.coyote; this.fallStartY = b.y; this.grip = null; this.setCrawl(false);
      return this.stepAir(dt, inp);
    }
    if (g !== this.groundObj && g.vy !== undefined) { /* standing on a body */ }
    this.groundObj = g; this.grounded = true;
    if (b.y > g.y1 + EPS) b.y = g.y1; // snap down small gaps (kinematic plates)
    if (g.y1 > b.y + EPS && g.y1 - b.y < 0.1) b.y = g.y1; // rising platform

    if (this.landLock > 0) { this.landLock -= dt; b.vx = approach(b.vx, 0, P.decel * dt); this.moveX(b.vx * dt); return; }

    // vines
    if (inp.y > 0.5 && !this.grip) {
      const v = this.nearVine();
      if (v) { this.enterVine(v); return; }
    }
    // levers
    if (inp.grab && !this.grip) {
      const lv = this.game.leverNear(b.x, b.y, this.facing);
      if (lv) { this.lever = lv; this.state = 'lever'; lv.grab(this); b.vx = 0; return; }
    }
    // crawl
    const wantCrawl = inp.y < -0.5;
    if (wantCrawl && !this.crawling && !this.grip) this.setCrawl(true);
    if (!wantCrawl && this.crawling && this.phys.free(b.x - P.w / 2, b.y, b.x + P.w / 2, b.y + P.h, b)) this.setCrawl(false);

    // grip crates
    if (inp.grab && !this.grip && !this.crawling) {
      const c = this.crateAdjacent(this.facing);
      if (c) { this.grip = c; this.emit('grip'); }
    }
    if (this.grip && (!inp.grab || !this.grip.grounded || Math.abs(this.grip.y - b.y) > 0.2)) { this.grip = null; }

    const mag = Math.abs(inp.x);
    let target = 0;
    if (mag > 0.05) target = Math.sign(inp.x) * (this.crawling ? P.crawl : (mag > 0.75 ? P.run : P.walk * (0.45 + 0.55 * mag / 0.75)));
    this.pushing = 0;
    if (this.grip) {
      const toward = Math.sign(inp.x) === this.facing;
      target = inp.x === 0 ? 0 : (toward ? P.push : P.pull) * Math.sign(inp.x);
    } else if (inp.x !== 0) {
      if (Math.sign(inp.x) !== this.facing && Math.abs(b.vx) < 0.6) this.facing = Math.sign(inp.x);
      else if (Math.sign(inp.x) !== this.facing && Math.abs(b.vx) >= 0.6) { /* skid then turn */ }
    }
    const reversing = b.vx !== 0 && target !== 0 && Math.sign(target) !== Math.sign(b.vx);
    const a = target === 0 ? P.decel : (reversing ? P.turn : P.accel);
    b.vx = approach(b.vx, target, a * dt);
    if (!this.grip && inp.x !== 0 && Math.sign(inp.x) !== this.facing && Math.abs(b.vx) < 0.6) this.facing = Math.sign(inp.x);

    // jump
    if (this.jumpBuf > 0 && !this.crawling) {
      if (this.grip) this.grip = null;
      if (this.phys.free(b.x - P.w / 2, b.y + 0.1, b.x + P.w / 2, b.y + P.h + 0.2, b)) { this.jump(); return; }
    }
    this.moveGroundX(b.vx * dt);
  }

  jump() {
    const b = this.body;
    b.vy = P.jumpV; this.state = 'air'; this.grounded = false; this.jumpBuf = 0; this.coyote = 0;
    this.fallStartY = b.y; this.grip = null;
    this.emit('jump');
  }

  setCrawl(on) {
    const b = this.body;
    if (on === this.crawling) return;
    if (!on && !this.phys.free(b.x - P.w / 2, b.y, b.x + P.w / 2, b.y + P.h, b)) return;
    this.crawling = on; b.h = on ? P.hCrawl : P.h;
    this.emit(on ? 'crawl' : 'stand');
  }

  crateAdjacent(dir) {
    const b = this.body;
    const edge = dir > 0 ? b.x + P.w / 2 : b.x - P.w / 2;
    for (const c of this.phys.bodies) {
      if (c === b || !c.pushable || !c.enabled) continue;
      if (c.y0 > b.y + 0.3 || c.y1 < b.y + 0.3) continue;
      const face = dir > 0 ? c.x0 : c.x1;
      if (Math.abs(face - edge) < 0.08) return c;
    }
    return null;
  }

  moveX(dx) {
    const b = this.body;
    const r = this.phys.sweepX(b, dx);
    b.x += r.dx;
    if (r.hit) b.vx = 0;
    return r;
  }

  moveGroundX(dx) {
    const b = this.body;
    if (dx === 0) return;
    const dir = Math.sign(dx);
    if (this.grip) {
      // move together with the gripped crate
      const toward = dir === this.facing;
      if (toward) {
        const moved = this.phys.pushBody(this.grip, dx);
        const r = this.phys.sweepX(b, moved, this.grip);
        b.x += r.dx; this.pushing = moved !== 0 ? 1 : 0.01;
        if (Math.abs(moved) < Math.abs(dx) * 0.5) b.vx = approach(b.vx, 0, 50 * (1 / 120));
      } else {
        const r = this.phys.sweepX(b, dx, this.grip);
        b.x += r.dx;
        const moved = this.phys.pushBody(this.grip, r.dx);
        if (Math.abs(moved - r.dx) > 1e-4) b.x -= r.dx - moved; // crate blocked: stay attached
        this.pushing = -1;
      }
      if (Math.abs(b.vx) > 0.05) this.emit('crateMove', this.grip);
      return;
    }
    let r = this.phys.sweepX(b, dx);
    if (r.hit) {
      const c = r.hit;
      // step up small ledges (stairs, kerbs)
      if (c.y1 - b.y <= P.stepUp && c.y1 > b.y && this.phys.free(b.x - P.w / 2 + dx, c.y1 + EPS, b.x + P.w / 2 + dx, c.y1 + b.h, b)) {
        b.y = c.y1 + EPS * 2;
        r = this.phys.sweepX(b, dx);
      } else if (c.pushable && c.enabled && !this.crawling && Math.sign(dx) === this.facing) {
        // walking into a crate pushes it slowly
        b.vx = Math.sign(b.vx) * Math.min(Math.abs(b.vx), P.push);
        const want = dx - r.dx;
        const moved = this.phys.pushBody(c, Math.sign(want) * Math.min(Math.abs(want), P.push / 120));
        b.x += r.dx;
        r = this.phys.sweepX(b, moved);
        this.pushing = moved !== 0 ? 1 : 0.01;
        if (moved !== 0) this.emit('crateMove', c);
      } else if (!this.crawling && this.phys.free(b.x - P.w / 2 + dx, b.y, b.x + P.w / 2 + dx, b.y + P.hCrawl, b) && !this.phys.free(b.x - P.w / 2 + dx, b.y, b.x + P.w / 2 + dx, b.y + P.h, b)) {
        // auto crawl into low openings
        this.setCrawl(true);
        r = this.phys.sweepX(b, dx);
      }
    }
    b.x += r.dx;
    if (r.hit && r.dx === 0) b.vx = 0;
  }

  stepAir(dt, inp) {
    const b = this.body;
    if (this.coyote > 0) {
      this.coyote -= dt;
      if (this.jumpBuf > 0 && this.coyote > 0 && !this.crawling) { this.jump(); }
    }
    b.vy = Math.max(b.vy - GRAVITY * dt, -P.maxFall);
    const target = inp.x * P.airMax;
    if (inp.x !== 0) b.vx = approach(b.vx, target, P.airAccel * dt);
    if (inp.x !== 0 && Math.abs(b.vx) < 0.5) this.facing = Math.sign(inp.x);
    const rx = this.phys.sweepX(b, b.vx * dt);
    b.x += rx.dx;
    if (rx.hit) b.vx = 0;
    const ry = this.phys.sweepY(b, b.vy * dt);
    b.y += ry.dy;
    if (b.y < -25 && !this.dead) { this.die('fall'); return; }
    if (ry.hit) {
      if (b.vy < 0) { this.onLand(ry.hit); return; }
      b.vy = Math.min(b.vy, 0); // head bump
    }
    // ledge grab
    if (!this.dead && inp.y > -0.5) this.tryGrab(inp);
    // vine catch
    if (inp.y > 0.5 || (this.nearVine() && b.vy < 0 && inp.grab)) { const v = this.nearVine(); if (v) this.enterVine(v); }
  }

  onLand(ground) {
    const b = this.body;
    const fall = this.fallStartY - b.y;
    const speed = -b.vy;
    b.vy = 0; this.state = 'ground'; this.grounded = true; this.groundObj = ground;
    if (fall > P.lethalFall) { this.die('fall'); this.emit('land', { speed, fall, hard: true }); return; }
    if (fall > P.hardLand) { this.landLock = 0.28; b.vx *= 0.3; }
    this.emit('land', { speed, fall, hard: fall > P.hardLand });
  }

  tryGrab(inp) {
    const b = this.body;
    const dir = this.facing;
    if (inp.x !== 0 && Math.sign(inp.x) !== dir) return;
    // must be moving/pressing toward the ledge side
    if (inp.x === 0 && b.vx * dir < 0.2 && b.vy > 0.5) return;
    const front = dir > 0 ? b.x + P.w / 2 : b.x - P.w / 2;
    for (const c of this.phys.colliders(b)) {
      if (c.oneWay) continue;
      const has = dir > 0 ? c.ledgeL : c.ledgeR;
      if (!has) continue;
      const cx = dir > 0 ? c.x0 : c.x1, cy = c.y1;
      const dx = (cx - front) * dir;
      if (dx < -0.06 || dx > 0.26) continue;
      const rel = cy - b.y;
      if (rel < 0.5 || rel > 1.62) continue;
      // space above the ledge for at least a crawl
      if (!this.phys.free(dir > 0 ? cx : cx - 0.5, cy + 0.02, dir > 0 ? cx + 0.5 : cx, cy + P.hCrawl, b)) continue;
      const standX = cx + dir * (P.w / 2 + 0.06);
      const hx = cx - dir * (P.w / 2 + 0.01);
      const hy = cy - P.hangDrop;
      const hangFree = this.phys.free(hx - P.w / 2, hy, hx + P.w / 2, cy - 0.05, b, c);
      if (rel <= P.mantleMax || !hangFree) {
        // low ledge: pull straight up onto it (mantle), no hang
        const canStand = this.phys.free(standX - P.w / 2, cy + EPS, standX + P.w / 2, cy + P.h, b);
        this.climbEndCrawl = !canStand;
        this.climbFrom.set(b.x, b.y); this.climbTo.set(standX, cy + EPS * 2);
        this.hang = { c, cx, cy, dir };
        this.state = 'climbUp'; this.climbT = 0.25; this.climbStart = 0.25; this.climbDur = 0.38 + rel * 0.18;
        b.vx = 0; b.vy = 0;
        this.emit('grab'); this.emit('climbUp');
        return;
      }
      this.hang = { c, cx, cy, dir };
      this.state = 'hang';
      b.vx = 0; b.vy = 0; b.x = hx; b.y = hy;
      this.hangT = 0;
      this.emit('grab');
      return;
    }
  }

  stepHang(dt, inp) {
    const b = this.body, h = this.hang;
    this.hangT += dt;
    // follow the ledge if it is a moving body (crate)
    const cx = h.dir > 0 ? h.c.x0 : h.c.x1, cy = h.c.y1;
    b.x = cx - h.dir * (P.w / 2 + 0.01); b.y = cy - P.hangDrop;
    if (this.hangT < 0.12) return;
    const toward = inp.x * h.dir > 0.3 || inp.y > 0.5 || this.jumpBuf > 0;
    const away = inp.x * h.dir < -0.3;
    if (inp.y < -0.5 || (away && !this.jumpBuf)) { // drop
      this.hang = null; this.state = 'air'; b.vy = 0; b.x -= h.dir * 0.03; this.fallStartY = b.y; this.emit('drop'); return;
    }
    if (away && this.jumpBuf > 0) { // jump off backwards
      this.hang = null; this.facing = -h.dir; b.vx = -h.dir * 2.6; this.jump(); b.vy = P.jumpV * 0.85; return;
    }
    if (toward) {
      const standX = cx + h.dir * (P.w / 2 + 0.06);
      const canStand = this.phys.free(standX - P.w / 2, cy + EPS, standX + P.w / 2, cy + P.h, b);
      const canCrawl = this.phys.free(standX - P.w / 2, cy + EPS, standX + P.w / 2, cy + P.hCrawl, b);
      if (!canStand && !canCrawl) return;
      this.climbEndCrawl = !canStand;
      this.climbFrom.set(b.x, b.y); this.climbTo.set(standX, cy + EPS * 2);
      this.state = 'climbUp'; this.climbT = 0; this.climbStart = 0; this.climbDur = P.climbUpTime; this.jumpBuf = 0;
      this.emit('climbUp');
    }
  }

  stepClimbUp(dt) {
    const b = this.body;
    this.climbT = Math.min(1, this.climbT + dt / (this.climbDur || P.climbUpTime));
    const t = this.climbT;
    const e = (x) => x * x * (3 - 2 * x);
    const t0 = this.climbStart ?? 0;
    const u = (t - t0) / (1 - t0);
    const ty = e(Math.min(1, u / 0.58));
    const tx = e(Math.max(0, (u - 0.32) / 0.68));
    b.x = this.climbFrom.x + (this.climbTo.x - this.climbFrom.x) * tx;
    b.y = this.climbFrom.y + (this.climbTo.y - this.climbFrom.y) * ty;
    if (t >= 1) {
      b.x = this.climbTo.x; b.y = this.climbTo.y;
      this.state = 'ground'; this.hang = null; b.vx = 0; b.vy = 0;
      if (this.climbEndCrawl) { this.crawling = false; this.setCrawl(true); }
      this.fallStartY = b.y;
    }
  }

  enterVine(v) {
    const b = this.body;
    this.vine = v; this.state = 'climb'; b.vx = 0; b.vy = 0; this.grip = null; this.setCrawl(false);
    b.x = Math.max(v.x0 + 0.2, Math.min(v.x1 - 0.2, b.x));
    this.emit('vine');
  }

  stepClimb(dt, inp) {
    const b = this.body, v = this.vine;
    const vy = inp.y * P.climbSpeed, vx = inp.x * P.climbLat;
    this.climbSpeed = Math.abs(vy) + Math.abs(vx) * 0.6;
    if (vy !== 0) { const r = this.phys.sweepY(b, vy * dt); b.y += r.dy; }
    if (vx !== 0) { const r = this.phys.sweepX(b, vx * dt); b.x += r.dx; b.x = Math.max(v.x0 + 0.15, Math.min(v.x1 - 0.15, b.x)); }
    if (inp.x !== 0) this.facing = Math.sign(inp.x);
    // top exit
    if (v.exit && b.y + P.h * 0.55 >= v.y1 && inp.y > 0.3) {
      this.climbFrom.set(b.x, b.y); this.climbTo.set(v.exit.x, v.exit.y);
      this.facing = Math.sign(v.exit.x - b.x) || this.facing;
      this.state = 'climbUp'; this.climbT = 0; this.climbStart = 0; this.climbDur = P.climbUpTime; this.climbEndCrawl = false; this.vine = null;
      this.emit('climbUp');
      return;
    }
    b.y = Math.min(b.y, v.y1 - P.h * 0.55);
    // bottom: step off onto ground
    const g = this.phys.groundUnder(b, 0.03);
    if (g && inp.y < -0.3) { this.state = 'ground'; this.vine = null; return; }
    if (b.y < v.y0 - 0.2 && !g) { this.state = 'air'; this.vine = null; this.fallStartY = b.y; return; }
    if (this.jumpBuf > 0 && inp.x !== 0) { this.vine = null; b.vx = inp.x * 2.4; this.jump(); b.vy = P.jumpV * 0.7; }
  }

  stepLever(dt, inp) {
    const lv = this.lever;
    if (!inp.grab) { lv.release(this); this.lever = null; this.state = 'ground'; return; }
    lv.drive(inp.x * lv.dir, dt, this);
  }

  stepDeadFall(dt) {
    const b = this.body;
    const g = this.phys.groundUnder(b, 0.02);
    if (!g) { b.vy = Math.max(b.vy - GRAVITY * dt, -P.maxFall); const r = this.phys.sweepY(b, b.vy * dt); b.y += r.dy; if (r.hit) b.vy = 0; }
  }

  // ------------------------------------------------------------------ visuals
  targetYaw() {
    const side = Math.PI / 2;
    switch (this.state) {
      case 'hang': case 'climbUp': return this.facing * side;
      case 'climb': return Math.PI * Math.sign(this.yaw || 1);
      case 'lever': return this.lever ? this.lever.dir * side : this.facing * side;
      default: return this.facing * (side - 0.2);
    }
  }
}
