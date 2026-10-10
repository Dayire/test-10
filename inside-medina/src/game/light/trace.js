// Sunwork tracing: pure 2D light in the play plane (x right, y up, metres; FULL_GAME §1.3, §6.1).
// No three.js and no DOM, so tools/light-unit.mjs runs it in Node. Angles are degrees, counter-clockwise
// from +x: a ray at 195° travels left and 15° down. A mirror's surface angle α lives in [-90, 90) and turns
// in 15° notches; a beam arriving at θi leaves at θr = 2α − θi. Trays reflect on both faces (the fixtures
// of §3–5 need it: II-B2 starts on the underside and is solved on the top face); `oneSided` makes the back
// face (against the normal (−sin α, cos α)) block instead.

export const DEG = Math.PI / 180;
export const NOTCH = 15;
export const wrap360 = (a) => ((a % 360) + 360) % 360;
export const wrapAlpha = (a) => ((((a + 90) % 180) + 180) % 180) - 90;
export const reflect = (thetaI, alpha) => wrap360(2 * alpha - thetaI);
export const notchOf = (alpha) => { const n = Math.round(wrapAlpha(alpha) / NOTCH); return n === 6 ? -6 : n; };
// the surface angle that turns a beam travelling at thetaI into thetaR
export const alphaFor = (thetaI, thetaR) => wrapAlpha((wrap360(thetaR) + wrap360(thetaI)) / 2);
export const angleOf = (dx, dy) => wrap360(Math.atan2(dy, dx) / DEG);
// smallest difference between two directions, in degrees
export const angDiff = (a, b) => { const d = Math.abs(wrap360(a) - wrap360(b)); return Math.min(d, 360 - d); };

// hit kinds
export const NONE = 0, SOLID = 1, BODY = 2, OCCLUDER = 4, MIRROR = 8, TARGET = 16;
export const BLOCKERS = SOLID | BODY | OCCLUDER | MIRROR;
export const ALL = BLOCKERS | TARGET;
export const KIND_NAME = { 0: 'none', 1: 'solid', 2: 'body', 4: 'occluder', 8: 'mirror', 16: 'target' };

const EPS = 1e-7;
const live = (b) => b.enabled !== false && b.light !== 'pass';

// ray (px, py) + t (dx, dy) against an axis-aligned box: entry t (origin outside), or -1. Writes the entry normal.
const N = { x: 0, y: 0 };
export function rayBox(px, py, dx, dy, x0, y0, x1, y1, tmax) {
  let tn = -Infinity, tf = Infinity, nx = 0, ny = 0;
  if (Math.abs(dx) < 1e-12) { if (px <= x0 || px >= x1) return -1; }
  else {
    const inv = 1 / dx;
    let a = (x0 - px) * inv, b = (x1 - px) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tn) { tn = a; nx = dx > 0 ? -1 : 1; ny = 0; }
    if (b < tf) tf = b;
  }
  if (Math.abs(dy) < 1e-12) { if (py <= y0 || py >= y1) return -1; }
  else {
    const inv = 1 / dy;
    let a = (y0 - py) * inv, b = (y1 - py) * inv;
    if (a > b) { const t = a; a = b; b = t; }
    if (a > tn) { tn = a; nx = 0; ny = dy > 0 ? -1 : 1; }
    if (b < tf) tf = b;
  }
  if (tn > tf || tn < EPS || tn >= tmax) return -1; // a box that holds the origin lets the ray out
  N.x = nx; N.y = ny;
  return tn;
}

// ray against the tray segment centred at (cx, cy), half-length r, surface angle alpha (deg): t or -1
export function raySeg(px, py, dx, dy, cx, cy, r, alpha, tmax) {
  const ux = Math.cos(alpha * DEG), uy = Math.sin(alpha * DEG);
  const den = dx * uy - dy * ux;
  if (Math.abs(den) < 1e-12) return -1; // parallel: the beam slides past the rim
  const qx = cx - px, qy = cy - py;
  const t = (qx * uy - qy * ux) / den;
  if (t < EPS || t >= tmax) return -1;
  const s = (px + t * dx - cx) * ux + (py + t * dy - cy) * uy;
  if (s < -r - 1e-9 || s > r + 1e-9) return -1;
  N.x = -uy; N.y = ux; if (N.x * dx + N.y * dy > 0) { N.x = -N.x; N.y = -N.y; }
  return t;
}

// ray against a circle: entry t, or -1 (an origin inside never hits)
export function rayCircle(px, py, dx, dy, cx, cy, r, tmax) {
  const fx = px - cx, fy = py - cy;
  const b = fx * dx + fy * dy, c = fx * fx + fy * fy - r * r;
  if (c < 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  if (t < EPS || t >= tmax) return -1;
  N.x = (px + t * dx - cx) / r; N.y = (py + t * dy - cy) / r;
  return t;
}

// The world light sees. Boxes are read live ({x0, y0, x1, y1, enabled?, light?}; bodies with getters work),
// so moving gates, plates and crates need nothing but a fresh trace. Statics are bucketed in a 4 m x-grid
// (their x extent must not change); dynamic boxes, occluders, mirrors and targets are always tested.
export class LightWorld {
  constructor({ cell = 4, maxLen = 160 } = {}) {
    this.cell = cell; this.maxLen = maxLen;
    this.statics = []; this.cells = []; this.c0 = 0; this.stamp = new Uint32Array(0); this.tick = 0;
    this.dynamic = [];   // boxes always tested (crates, mirror stands, the boy, guards)
    this.occluders = []; // light-only boxes
    this.planks = [];    // light-only segments {x, y, r, alpha} (a raised drawbridge, a hatch leaf)
    this.mirrors = [];   // {x, y, r, alpha, enabled?, oneSided?}
    this.targets = [];   // {shape: 'circle', x, y, r} | {shape: 'box', x0, y0, x1, y1}
    this.hit = { t: 0, x: 0, y: 0, nx: 0, ny: 0, kind: NONE, obj: null };
    this.tests = 0;
  }

  setStatic(list) {
    const S = this.statics = list.slice();
    const c = this.cell;
    let lo = Infinity, hi = -Infinity;
    for (const s of S) { lo = Math.min(lo, s.x0); hi = Math.max(hi, s.x1); }
    if (!S.length) { this.cells = []; this.c0 = 0; this.stamp = new Uint32Array(0); return this; }
    this.c0 = Math.floor(lo / c);
    const n = Math.floor(hi / c) - this.c0 + 1;
    const cells = this.cells = Array.from({ length: n }, () => []);
    for (let i = 0; i < S.length; i++) {
      const s = S[i];
      for (let k = Math.floor(s.x0 / c) - this.c0, e = Math.floor(s.x1 / c) - this.c0; k <= e; k++) cells[k].push(i);
    }
    this.stamp = new Uint32Array(S.length);
    return this;
  }

  // nearest hit along (px, py) + t (dx, dy), t in (0, tmax]; mask picks the kinds; skip is an object to ignore
  // (the mirror a beam just left), skip2 another (the boy a lamp is looking at). Returns this.hit (reused).
  cast(px, py, dx, dy, tmax = this.maxLen, mask = ALL, skip = null, skip2 = null) {
    const H = this.hit;
    let best = tmax, kind = NONE, obj = null, nx = 0, ny = 0;
    if (mask & SOLID && this.cells.length) {
      const c = this.cell, S = this.statics, st = this.stamp, cells = this.cells;
      if (++this.tick === 0xffffffff) { st.fill(0); this.tick = 1; }
      const tk = this.tick;
      let ci = Math.floor(px / c) - this.c0;
      const step = dx > 1e-12 ? 1 : dx < -1e-12 ? -1 : 0;
      let tExit = step === 0 ? Infinity : ((this.c0 + ci + (step > 0 ? 1 : 0)) * c - px) / dx;
      const dt = step === 0 ? Infinity : c / Math.abs(dx);
      if (step !== 0 && (ci < 0 || ci >= cells.length)) {
        // start outside the grid: jump to the first cell on the way, if any
        const edge = step > 0 ? this.c0 * c : (this.c0 + cells.length) * c;
        const t0 = (edge - px) / dx;
        if (t0 > 0 && t0 < best) { ci = step > 0 ? 0 : cells.length - 1; tExit = t0 + dt; } else ci = -1;
      }
      while (ci >= 0 && ci < cells.length) {
        for (const i of cells[ci]) {
          if (st[i] === tk) continue;
          st[i] = tk;
          const s = S[i];
          if (s === skip || s === skip2 || !live(s)) continue;
          this.tests++;
          const t = rayBox(px, py, dx, dy, s.x0, s.y0, s.x1, s.y1, best);
          if (t >= 0) { best = t; kind = SOLID; obj = s; nx = N.x; ny = N.y; }
        }
        if (best <= tExit || step === 0) break;
        ci += step; tExit += dt;
      }
    }
    if (mask & BODY) for (const s of this.dynamic) {
      if (s === skip || s === skip2 || !live(s)) continue;
      this.tests++;
      const t = rayBox(px, py, dx, dy, s.x0, s.y0, s.x1, s.y1, best);
      if (t >= 0) { best = t; kind = BODY; obj = s; nx = N.x; ny = N.y; }
    }
    if (mask & OCCLUDER) for (const s of this.occluders) {
      if (s === skip || s === skip2 || s.enabled === false) continue;
      this.tests++;
      const t = rayBox(px, py, dx, dy, s.x0, s.y0, s.x1, s.y1, best);
      if (t >= 0) { best = t; kind = OCCLUDER; obj = s; nx = N.x; ny = N.y; }
    }
    if (mask & OCCLUDER) for (const m of this.planks) {
      if (m === skip || m === skip2 || m.enabled === false) continue;
      this.tests++;
      const t = raySeg(px, py, dx, dy, m.x, m.y, m.r, m.alpha, best);
      if (t >= 0) { best = t; kind = OCCLUDER; obj = m; nx = N.x; ny = N.y; }
    }
    if (mask & MIRROR) for (const m of this.mirrors) {
      if (m === skip || m === skip2 || m.enabled === false) continue;
      this.tests++;
      const t = raySeg(px, py, dx, dy, m.x, m.y, m.r, m.alpha, best);
      if (t >= 0) { best = t; kind = MIRROR; obj = m; nx = N.x; ny = N.y; }
    }
    if (mask & TARGET) for (const g of this.targets) {
      if (g === skip || g === skip2 || g.enabled === false) continue;
      this.tests++;
      const t = g.shape === 'box' ? rayBox(px, py, dx, dy, g.x0, g.y0, g.x1, g.y1, best) : rayCircle(px, py, dx, dy, g.x, g.y, g.r, best);
      if (t >= 0) { best = t; kind = TARGET; obj = g; nx = N.x; ny = N.y; }
    }
    H.kind = kind; H.obj = obj; H.t = kind ? best : tmax; H.nx = nx; H.ny = ny;
    H.x = px + dx * H.t; H.y = py + dy * H.t;
    return H;
  }

  // the same answer without the grid (tests compare the two)
  castBrute(px, py, dx, dy, tmax = this.maxLen, mask = ALL, skip = null, skip2 = null) {
    const h = this.cast(px, py, dx, dy, tmax, mask & ~SOLID, skip, skip2);
    if (!(mask & SOLID)) return h;
    let best = h.kind ? h.t : tmax;
    for (const s of this.statics) {
      if (s === skip || s === skip2 || !live(s)) continue;
      const t = rayBox(px, py, dx, dy, s.x0, s.y0, s.x1, s.y1, best);
      if (t >= 0) { best = t; h.kind = SOLID; h.obj = s; h.nx = N.x; h.ny = N.y; h.t = t; }
    }
    h.x = px + dx * h.t; h.y = py + dy * h.t;
    return h;
  }

  // is the straight line from (x0, y0) to (x1, y1) clear of light blockers? (searchlight line of sight)
  clear(x0, y0, x1, y1, skip = null, skip2 = null, mask = BLOCKERS) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-9) return true;
    return this.cast(x0, y0, dx / L, dy / L, L - 1e-6, mask, skip, skip2).kind === NONE;
  }

  // follow a beam: up to maxSeg segments, reflecting off mirrors (×0.95 each), stopping below minI or on
  // anything else. Returns {pts: [x0, y0, x1, y1, ...], hits: [{kind, obj, x, y, nx, ny, I, seg, theta}], n}
  // (out is reused when given: the hit records are pooled).
  trace(x, y, theta, I = 1, { maxSeg = 6, minI = 0.4, mask = ALL, skip = null, out = null, brute = false } = {}) {
    const R = out || { pts: [], hits: [], pool: [], n: 0, I: 0 };
    R.pts.length = 0; R.hits.length = 0; R.n = 0;
    R.pts.push(x, y);
    let last = skip;
    for (let seg = 0; seg < maxSeg; seg++) {
      const r = theta * DEG, dx = Math.cos(r), dy = Math.sin(r);
      const h = brute ? this.castBrute(x, y, dx, dy, this.maxLen, mask, last) : this.cast(x, y, dx, dy, this.maxLen, mask, last);
      const rec = R.pool[R.hits.length] || (R.pool[R.hits.length] = {});
      rec.kind = h.kind; rec.obj = h.obj; rec.x = h.x; rec.y = h.y; rec.nx = h.nx; rec.ny = h.ny; rec.I = I; rec.seg = seg; rec.theta = theta; rec.t = h.t;
      R.hits.push(rec);
      R.pts.push(h.x, h.y); R.n = seg + 1;
      if (h.kind !== MIRROR) break;
      const m = h.obj;
      if (m.oneSided && (-Math.sin(m.alpha * DEG) * dx + Math.cos(m.alpha * DEG) * dy) > 0) { rec.back = true; break; }
      rec.back = false;
      theta = reflect(theta, m.alpha);
      I *= 0.95;
      if (I < minI) break;
      x = h.x; y = h.y; last = m;
    }
    R.I = I;
    return R;
  }
}
