// 2D physics on the play plane (x right, y up, metres).
// Boxes use x = centre, y = bottom. Colliders: static/kinematic solids and
// dynamic bodies (crates). Integration is done at a fixed 120 Hz.

export const EPS = 1e-4;
export const GRAVITY = 22;

let _id = 1;

export class Solid {
  constructor(x0, y0, x1, y1, o = {}) {
    this.id = _id++;
    this.x0 = x0; this.y0 = y0; this.x1 = x1; this.y1 = y1;
    this.oneWay = !!o.oneWay;
    this.ledgeL = o.ledgeL ?? o.ledges ?? (y1 - y0 >= 0.35);
    this.ledgeR = o.ledgeR ?? o.ledges ?? (y1 - y0 >= 0.35);
    this.surface = o.surface || 'stone';
    this.enabled = true;
    this.kind = o.kind || 'solid';
    this.owner = o.owner || null;
    this.lethalTop = !!o.lethalTop;
  }
}

export class Body {
  constructor(x, y, w, h, o = {}) {
    this.id = _id++;
    this.x = x; this.y = y; this.w = w; this.h = h;
    this.vx = 0; this.vy = 0;
    this.grounded = false; this.groundObj = null;
    this.kind = o.kind || 'body';
    this.mass = o.mass ?? 1;
    this.surface = o.surface || 'wood';
    this.ledgeL = o.ledgeL ?? true; this.ledgeR = o.ledgeR ?? true;
    this.solid = o.solid ?? true;
    this.pushable = o.pushable ?? true;
    this.enabled = true;
    this.fallStartY = y;
    this.lastImpact = 0;
    this.pushedThisStep = 0;
  }
  get x0() { return this.x - this.w / 2; }
  get x1() { return this.x + this.w / 2; }
  get y0() { return this.y; }
  get y1() { return this.y + this.h; }
}

export class PhysicsWorld {
  constructor() {
    this.solids = [];
    this.bodies = [];
    this.onImpact = null; // (body, speed)
  }

  addSolid(x0, y0, x1, y1, o) { const s = new Solid(Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1), o); this.solids.push(s); return s; }
  addBody(b) { this.bodies.push(b); return b; }

  *colliders(ignore) {
    for (const s of this.solids) if (s.enabled && s !== ignore) yield s;
    for (const b of this.bodies) if (b.enabled && b.solid && b !== ignore) yield b;
  }

  // is the box region free of solid colliders?
  free(x0, y0, x1, y1, ignore = null, ignore2 = null) {
    for (const c of this.colliders(ignore)) {
      if (c === ignore2 || c.oneWay) continue;
      if (c.x0 < x1 - EPS && c.x1 > x0 + EPS && c.y0 < y1 - EPS && c.y1 > y0 + EPS) return false;
    }
    return true;
  }

  firstOverlap(x0, y0, x1, y1, ignore = null) {
    for (const c of this.colliders(ignore)) {
      if (c.oneWay) continue;
      if (c.x0 < x1 - EPS && c.x1 > x0 + EPS && c.y0 < y1 - EPS && c.y1 > y0 + EPS) return c;
    }
    return null;
  }

  // Sweep a box horizontally. Returns {dx, hit}
  sweepX(b, dx, ignore2 = null) {
    if (dx === 0) return { dx: 0, hit: null };
    let hit = null;
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2, by0 = b.y, by1 = b.y + b.h;
    for (const c of this.colliders(b)) {
      if (c === ignore2 || c.oneWay) continue;
      if (c.y0 >= by1 - EPS || c.y1 <= by0 + EPS) continue;
      if (dx > 0 && bx1 <= c.x0 + EPS && bx1 + dx > c.x0) { dx = Math.max(0, c.x0 - bx1); hit = c; }
      else if (dx < 0 && bx0 >= c.x1 - EPS && bx0 + dx < c.x1) { dx = Math.min(0, c.x1 - bx0); hit = c; }
    }
    return { dx, hit };
  }

  sweepY(b, dy, ignore2 = null) {
    if (dy === 0) return { dy: 0, hit: null };
    let hit = null;
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2, by0 = b.y, by1 = b.y + b.h;
    for (const c of this.colliders(b)) {
      if (c === ignore2) continue;
      if (c.x0 >= bx1 - EPS || c.x1 <= bx0 + EPS) continue;
      if (dy < 0 && by0 >= c.y1 - EPS && by0 + dy < c.y1) { dy = Math.min(0, c.y1 - by0); hit = c; }
      else if (dy > 0 && !c.oneWay && by1 <= c.y0 + EPS && by1 + dy > c.y0) { dy = Math.max(0, c.y0 - by1); hit = c; }
    }
    return { dy, hit };
  }

  groundUnder(b, probe = 0.03) {
    const bx0 = b.x - b.w / 2, bx1 = b.x + b.w / 2;
    let best = null;
    for (const c of this.colliders(b)) {
      if (c.x0 >= bx1 - EPS || c.x1 <= bx0 + EPS) continue;
      if (c.y1 <= b.y + EPS && c.y1 >= b.y - probe) { if (!best || c.y1 > best.y1) best = c; }
    }
    return best;
  }

  // Try to push body horizontally by dx (used by the player). Carries bodies on top.
  pushBody(body, dx) {
    const r = this.sweepX(body, dx);
    if (r.dx === 0) return 0;
    const riders = this.bodies.filter((o) => o !== body && o.enabled && Math.abs(o.y - body.y1) < 0.02 && o.x1 > body.x0 && o.x0 < body.x1);
    body.x += r.dx;
    for (const o of riders) { const rr = this.sweepX(o, r.dx); o.x += rr.dx; }
    body.pushedThisStep = r.dx;
    return r.dx;
  }

  stepBodies(dt) {
    for (const b of this.bodies) {
      if (!b.enabled || b.kind === 'player' || b.kinematic) continue;
      const wasGrounded = b.grounded;
      b.vy = Math.max(b.vy - GRAVITY * dt, -18);
      const ry = this.sweepY(b, b.vy * dt);
      b.y += ry.dy;
      if (ry.hit && b.vy < 0) {
        if (!wasGrounded && b.vy < -3 && this.onImpact) this.onImpact(b, -b.vy, ry.hit);
        b.vy = 0; b.grounded = true; b.groundObj = ry.hit;
      } else if (ry.hit && b.vy > 0) { b.vy = 0; }
      else {
        const g = this.groundUnder(b, 0.005);
        b.grounded = !!g && b.vy <= 0; b.groundObj = g;
        if (b.grounded) b.vy = 0;
      }
      if (!wasGrounded && b.grounded) b.fallStartY = b.y;
      if (b.grounded) b.vx *= Math.exp(-14 * dt);
      else b.vx *= Math.exp(-0.5 * dt);
      if (Math.abs(b.vx) > 1e-3) { const rx = this.sweepX(b, b.vx * dt); b.x += rx.dx; if (rx.hit) b.vx = 0; }
      // topple off an edge: if less than ~35% supported, slide off
      if (b.grounded && b.groundObj) {
        const g = b.groundObj;
        const sup = Math.min(b.x1, g.x1) - Math.max(b.x0, g.x0);
        if (sup < b.w * 0.35) { const dir = (b.x > (g.x0 + g.x1) / 2) ? 1 : -1; b.vx += dir * 2.5 * dt * 60 * 0.02; }
      }
      b.pushedThisStep = 0;
    }
  }

  // Ray (segment) test against colliders: returns t in [0,1] of first hit or null
  raycast(x0, y0, x1, y1, filter = null) {
    let best = null;
    const dx = x1 - x0, dy = y1 - y0;
    for (const c of this.colliders(null)) {
      if (filter && !filter(c)) continue;
      let tmin = 0, tmax = 1;
      if (Math.abs(dx) < 1e-9) { if (x0 <= c.x0 || x0 >= c.x1) continue; }
      else { let t1 = (c.x0 - x0) / dx, t2 = (c.x1 - x0) / dx; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
      if (Math.abs(dy) < 1e-9) { if (y0 <= c.y0 || y0 >= c.y1) continue; }
      else { let t1 = (c.y0 - y0) / dy, t2 = (c.y1 - y0) / dy; if (t1 > t2) [t1, t2] = [t2, t1]; tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); }
      if (tmin <= tmax && (best === null || tmin < best)) best = tmin;
    }
    return best;
  }
}
