// Sunwork unit tests in plain Node: node tools/light-unit.mjs [--only name] [--verbose]
// Reflection and notch maths, ray against box / segment / circle, 100 random traces against an independent
// brute force, the pure rules (charge, heat, clock, magnet, lift), and every traced hit of FULL_GAME §3–5 as a
// fixture (II-A1 … IV-E). Exit code 1 if anything fails.
import { LightWorld, reflect, wrapAlpha, notchOf, alphaFor, angleOf, angDiff, rayBox, raySeg, rayCircle, NONE, SOLID, BODY, OCCLUDER, MIRROR, TARGET, KIND_NAME, DEG } from '../src/game/light/trace.js';
import { chargeLevel, heatStep, keyed, clockT, clockDeath, magnet, liftClamp, crossAt } from '../src/game/light/logic.js';
import { Mirror } from '../src/game/light/mirror.js';

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const verbose = args.includes('--verbose');
let pass = 0, fail = 0;
const notes = [];
const results = [];
function test(name, fn) {
  if (only && !name.includes(only)) return;
  try {
    const r = fn();
    pass++; results.push(['PASS', name, r]);
    console.log(`PASS  ${name}${r ? `  ${r}` : ''}`);
  } catch (e) { fail++; results.push(['FAIL', name, e.message]); console.log(`FAIL  ${name}\n      -> ${e.message}`); }
}
const ok = (c, msg) => { if (!c) throw new Error(msg); };
const near = (a, b, e = 0.02) => Math.abs(a - b) <= e;
const f2 = (v) => +v.toFixed(2);
const pt = (h) => `(${f2(h.x)}, ${f2(h.y)})`;

// ------------------------------------------------------------------ a fixture world
// boxes: [x0, y0, x1, y1] statics; bodies: dynamic boxes; mirrors {id, x, y, r, alpha}; targets {id, x, y, r} or box
function world({ solids = [], bodies = [], occluders = [], planks = [], mirrors = [], targets = [] } = {}) {
  const W = new LightWorld();
  W.setStatic(solids.map((s) => (Array.isArray(s) ? { x0: s[0], y0: s[1], x1: s[2], y1: s[3] } : s)));
  W.dynamic = bodies.map((b) => (Array.isArray(b) ? { x0: b[0], y0: b[1], x1: b[2], y1: b[3], id: b[4] } : b));
  W.occluders = occluders.map((b) => (Array.isArray(b) ? { x0: b[0], y0: b[1], x1: b[2], y1: b[3], id: b[4] } : b));
  W.planks = planks.slice();
  W.mirrors = mirrors.map((m) => ({ r: 0.4, ...m }));
  W.targets = targets.map((t) => ({ shape: t.x0 !== undefined ? 'box' : 'circle', r: 0.35, ...t }));
  W.by = (id) => [...W.mirrors, ...W.targets, ...W.dynamic, ...W.occluders].find((o) => o.id === id);
  return W;
}
// a wheeled or anchored mirror: the 0.7 × 0.8 stand (a body) and the tray at pivot height 1.2 (r 0.4)
const stand = (id, x, alpha, floor = 0) => ({ body: { x0: x - 0.35, y0: floor, x1: x + 0.35, y1: floor + 0.8, id: id + '.stand' }, mirror: { id, x, y: floor + 1.2, r: 0.4, alpha } });
const last = (r) => r.hits[r.hits.length - 1];
const hitsOf = (r) => r.hits.map((h) => `${KIND_NAME[h.kind]}${h.obj?.id ? ':' + h.obj.id : ''}@${pt(h)}`).join(' → ');
function expectEnd(r, { kind, id, x, y, e = 0.02 }) {
  const h = last(r);
  ok(h.kind === kind, `ends on ${KIND_NAME[h.kind]}${h.obj?.id ? ' ' + h.obj.id : ''} not ${KIND_NAME[kind]} ${id || ''}: ${hitsOf(r)}`);
  if (id) ok(h.obj?.id === id, `ends on ${h.obj?.id} not ${id}: ${hitsOf(r)}`);
  if (x !== undefined) ok(near(h.x, x, e) && near(h.y, y, e), `end ${pt(h)} not (${x}, ${y}) ±${e}: ${hitsOf(r)}`);
  return h;
}
const litBy = (r, id) => r.hits.some((h) => h.kind === TARGET && h.obj.id === id);
// scan a parameter, return the [lo, hi] range where pred holds (contiguous around the first hit)
function scan(a, b, step, pred) {
  let lo = null, hi = null;
  for (let v = a; v <= b + 1e-9; v += step) { if (pred(+v.toFixed(6))) { if (lo === null) lo = v; hi = v; } else if (lo !== null) break; }
  return lo === null ? null : [+lo.toFixed(3), +hi.toFixed(3)];
}

// ------------------------------------------------------------------ maths
test('reflection θr = 2α − θi', () => {
  const cases = [[195, -15, 135], [195, -45, 75], [195, 30, 225], [195, 0, 165], [195, -30, 105], [180, 30, 240], [180, -30, 120], [180, 15, 210], [180, 60, 300], [270, -45, 0], [270, 45, 180], [270, 15, 120], [90, -45, 180], [105, -15, 225], [105, 45, 345], [105, 15, 285], [180, 3.2, 186.4], [180, 75, 330], [180, 45, 270]];
  for (const [ti, a, tr] of cases) ok(near(reflect(ti, a), tr, 1e-9), `reflect(${ti}, ${a}) = ${reflect(ti, a)} not ${tr}`);
  // the time of day changes the geometry (§1.3): a 195° sun only ever leaves at 15° (mod 30°); a 180° sun at multiples of 30°
  for (let n = -6; n < 6; n++) { ok(near(((reflect(195, n * 15) % 30) + 30) % 30, 15, 1e-9), `195° sun, notch ${n}`); ok(near(((reflect(180, n * 15) % 30) + 30) % 30, 0, 1e-9) || near(((reflect(180, n * 15) % 30) + 30) % 30, 30, 1e-9), `180° sun, notch ${n}`); }
  return `${cases.length} cases, 24 notch parities`;
});
test('notch and α maths', () => {
  ok(wrapAlpha(90) === -90 && wrapAlpha(-90) === -90 && wrapAlpha(135) === -45 && wrapAlpha(-105) === 75 && wrapAlpha(30) === 30, 'wrapAlpha');
  ok(notchOf(-45) === -3 && notchOf(75) === 5 && notchOf(90) === -6 && notchOf(-90) === -6 && notchOf(7.4) === 0 && notchOf(7.6) === 1, 'notchOf');
  ok(near(alphaFor(195, 135), -15, 1e-9) && near(alphaFor(180, 240), 30, 1e-9) && near(alphaFor(270, 0), -45, 1e-9) && near(alphaFor(105, 345), 45, 1e-9) && near(alphaFor(180, 186.4), 3.2, 1e-9), 'alphaFor');
  for (let i = 0; i < 200; i++) { const ti = Math.random() * 360, a = wrapAlpha(Math.random() * 360); ok(near(alphaFor(ti, reflect(ti, a)), a, 1e-6), `alphaFor inverts reflect (${ti}, ${a})`); }
  ok(near(angleOf(-1, -Math.tan(15 * DEG)), 195, 1e-9) && near(angDiff(359, 1), 2, 1e-9), 'angles');
  return 'wrap, notch, inverse over 200 random pairs';
});
test('ray against box', () => {
  ok(near(rayBox(0, 0.5, 1, 0, 2, 0, 3, 1, 99), 2, 1e-12), 'front face');
  ok(rayBox(0, 0.5, -1, 0, 2, 0, 3, 1, 99) === -1, 'behind');
  ok(rayBox(2.5, 0.5, 1, 0, 2, 0, 3, 1, 99) === -1, 'origin inside escapes');
  ok(rayBox(0, 1, 1, 0, 2, 0, 3, 1, 99) === -1, 'grazing the top face passes');
  ok(rayBox(0, 0.5, 1, 0, 2, 0, 3, 1, 1.5) === -1, 'beyond tmax');
  const s = Math.SQRT1_2; ok(near(rayBox(0, 0, s, s, 1, 1, 2, 2, 99), Math.SQRT2, 1e-12), 'corner diagonal');
  ok(near(rayBox(5, 5, 0, -1, 4, 0, 6, 1, 99), 4, 1e-12), 'vertical');
});
test('ray against segment (tray)', () => {
  ok(near(raySeg(0, 1, 1, 0, 2, 1, 0.4, 90, 99), 2, 1e-12), 'vertical tray');
  ok(raySeg(0, 1, 1, 0, 2, 1, 0.4, 0, 99) === -1, 'parallel slides past');
  ok(raySeg(0, 1.5, 1, 0, 2, 1, 0.4, 90, 99) === -1, 'above the rim');
  ok(near(raySeg(0, 1.4, 1, 0, 2, 1, 0.4, 90, 99), 2, 1e-12), 'exactly on the rim');
  ok(near(raySeg(0, 1 + 0.2, 1, 0, 2, 1, 0.4, 30, 99), 2 + 0.2 / Math.tan(30 * DEG), 1e-9), 'oblique');
});
test('ray against circle (lock)', () => {
  ok(near(rayCircle(0, 0, 1, 0, 5, 0, 0.35, 99), 4.65, 1e-12), 'head on');
  ok(rayCircle(5, 0, 1, 0, 5, 0, 0.35, 99) === -1, 'origin inside never hits');
  ok(rayCircle(0, 0.36, 1, 0, 5, 0, 0.35, 99) === -1, 'miss');
  ok(near(rayCircle(0, 0.35, 1, 0, 5, 0, 0.35, 99), 5, 1e-6), 'tangent');
});

// ------------------------------------------------------------------ 100 random traces against an independent brute force
// The brute force shares nothing with LightWorld: boxes are four edges intersected parametrically, trays are
// segments, circles solve a·t² + b·t + c = 0; it walks every primitive at every bounce.
function bruteTrace(B, x, y, theta, I, maxSeg = 6, minI = 0.4) {
  const out = [];
  let lastM = null;
  for (let seg = 0; seg < maxSeg; seg++) {
    const dx = Math.cos(theta * DEG), dy = Math.sin(theta * DEG);
    let best = 160, hit = null;
    const segX = (ax, ay, bx, by) => { // ray vs segment a-b: t
      const ex = bx - ax, ey = by - ay, den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) return -1;
      const t = ((ax - x) * ey - (ay - y) * ex) / den, u = ((ax - x) * dy - (ay - y) * dx) / den;
      return t > 1e-7 && u >= -1e-9 && u <= 1 + 1e-9 ? t : -1;
    };
    for (const b of B.boxes) {
      if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) continue; // origin inside: the ray escapes
      for (const [ax, ay, bx, by] of [[b[0], b[1], b[2], b[1]], [b[2], b[1], b[2], b[3]], [b[2], b[3], b[0], b[3]], [b[0], b[3], b[0], b[1]]]) {
        const t = segX(ax, ay, bx, by);
        if (t >= 0 && t < best) { best = t; hit = { kind: b[4] || 'box', o: b }; }
      }
    }
    for (const m of B.mirrors) {
      if (m === lastM) continue;
      const ux = Math.cos(m.alpha * DEG) * m.r, uy = Math.sin(m.alpha * DEG) * m.r;
      const t = segX(m.x - ux, m.y - uy, m.x + ux, m.y + uy);
      if (t >= 0 && t < best) { best = t; hit = { kind: 'mirror', o: m }; }
    }
    for (const c of B.circles) {
      const fx = x - c.x, fy = y - c.y, qa = 1, qb = 2 * (fx * dx + fy * dy), qc = fx * fx + fy * fy - c.r * c.r;
      if (qc < 0) continue;
      const D = qb * qb - 4 * qa * qc;
      if (D < 0) continue;
      const t = (-qb - Math.sqrt(D)) / (2 * qa);
      if (t > 1e-7 && t < best) { best = t; hit = { kind: 'target', o: c }; }
    }
    const hx = x + dx * best, hy = y + dy * best;
    out.push({ kind: hit ? hit.kind : 'none', x: hx, y: hy, o: hit?.o });
    if (!hit || hit.kind !== 'mirror') break;
    theta = reflect(theta, hit.o.alpha); I *= 0.95;
    if (I < minI) break;
    x = hx; y = hy; lastM = hit.o;
  }
  return out;
}
test('100 random traces against brute force', () => {
  let rnd = 12345;
  const R = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  let segs = 0, bounces = 0, worst = 0;
  for (let k = 0; k < 100; k++) {
    const statics = [], bodies = [], mirrors = [], circles = [], occ = [];
    for (let i = 0; i < 70; i++) { const x = R() * 80 - 20, y = R() * 20 - 4, w = 0.2 + R() * 4, h = 0.2 + R() * 3; statics.push([x, y, x + w, y + h, 'solid']); }
    for (let i = 0; i < 6; i++) { const x = R() * 80 - 20, y = R() * 16; bodies.push([x, y, x + 0.7, y + 0.8, 'body']); }
    for (let i = 0; i < 4; i++) { const x = R() * 80 - 20, y = R() * 16; occ.push([x, y, x + 1.2, y + 1.5, 'occluder']); }
    for (let i = 0; i < 14; i++) mirrors.push({ id: 'm' + i, x: R() * 80 - 20, y: R() * 18 - 2, r: 0.3 + R() * 1.2, alpha: wrapAlpha(Math.round(R() * 24) * 15 + (R() < 0.3 ? R() * 10 : 0)) });
    for (let i = 0; i < 10; i++) circles.push({ id: 't' + i, x: R() * 80 - 20, y: R() * 18 - 2, r: 0.15 + R() * 0.6 });
    const W = world({ solids: statics, bodies: bodies.map((b) => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] })), occluders: occ.map((b) => ({ x0: b[0], y0: b[1], x1: b[2], y1: b[3] })), mirrors, targets: circles });
    // a source outside every box, aimed at a random mirror half the time so bounces are common
    let x, y;
    do { x = R() * 80 - 20; y = R() * 18 - 2; } while ([...statics, ...bodies, ...occ].some((b) => x > b[0] && x < b[2] && y > b[1] && y < b[3]));
    const m = mirrors[Math.floor(R() * mirrors.length)];
    const theta = R() < 0.6 ? angleOf(m.x + (R() - 0.5) * m.r - x, m.y - y) : R() * 360;
    const r = W.trace(x, y, theta, 1, { maxSeg: 6 });
    const rb = W.trace(x, y, theta, 1, { maxSeg: 6, brute: true });
    const b = bruteTrace({ boxes: [...statics, ...bodies, ...occ], mirrors, circles }, x, y, theta, 1);
    ok(r.hits.length === b.length && rb.hits.length === b.length, `trace ${k}: ${r.hits.length} segments, grid-free ${rb.hits.length}, brute ${b.length}`);
    for (let i = 0; i < b.length; i++) {
      const h = r.hits[i], g = b[i];
      const kind = { [SOLID]: 'solid', [BODY]: 'body', [OCCLUDER]: 'occluder', [MIRROR]: 'mirror', [TARGET]: 'target', [NONE]: 'none' }[h.kind];
      ok(kind === g.kind, `trace ${k} seg ${i}: ${kind} vs brute ${g.kind}`);
      const d = Math.hypot(h.x - g.x, h.y - g.y);
      worst = Math.max(worst, d);
      ok(d < 1e-6, `trace ${k} seg ${i}: (${h.x}, ${h.y}) vs brute (${g.x}, ${g.y})`);
      if (g.o?.id) ok(h.obj.id === g.o.id, `trace ${k} seg ${i}: ${h.obj.id} vs ${g.o.id}`);
    }
    segs += b.length; bounces += b.filter((h) => h.kind === 'mirror').length;
  }
  return `${segs} segments, ${bounces} reflections, worst point error ${worst.toExponential(1)} m`;
});
test('grid trace is cheap', () => {
  const statics = [];
  for (let x = -40; x < 260; x += 2.5) { statics.push([x, -3, x + 2.5, 0]); if (Math.random() < 0.5) statics.push([x, 0, x + 0.8, 2 + Math.random() * 8]); }
  const W = world({ solids: statics, mirrors: Array.from({ length: 16 }, (_, i) => ({ id: 'm' + i, x: i * 14, y: 1.2, alpha: -30 })), targets: Array.from({ length: 24 }, (_, i) => ({ id: 't' + i, x: i * 9, y: 4 })) });
  const t0 = performance.now(); let n = 0;
  for (let k = 0; k < 2000; k++) for (let s = 0; s < 8; s++) { W.trace(10 + s * 25 + (k % 7), 9, 195 + (k % 5), 1); n++; }
  const ms = (performance.now() - t0) / 2000;
  return `8 traces in ${ms.toFixed(4)} ms on Node (the in-game p95 gate is 0.35 ms per pass)`;
});

// ------------------------------------------------------------------ the pure rules
test('sun-lock charge, moon on a gold lock, bolt', () => {
  let L = 0; for (let i = 0; i < 36; i++) L = chargeLevel(L, 1.0, 0.8, 1 / 60); ok(near(L, 1, 1e-9), `0.6 s of sun latches (${L})`);
  L = 0; for (let i = 0; i < 600; i++) L = chargeLevel(L, 0.475, 0.8, 1 / 60); ok(near(L, 0.475 / 0.8, 1e-9) && L < 1, `moon on gold stops at ${L}`);
  ok(near(0.475 / 0.8, 0.59, 0.01), 'III-E: 0.59');
  L = 0; for (let i = 0; i < 600; i++) L = chargeLevel(L, 0.475, 0.4, 1 / 60); ok(L === 1, 'moon on silver latches');
  L = 1; for (let i = 0; i < 30; i++) L = chargeLevel(L, 0, 0.8, 1 / 60); ok(near(L, 0, 1e-9), 'decays in 0.5 s');
  return 'latch in 0.6 s, gold under the moon at 0.594, decay in 0.5 s';
});
test('rope: one beam smoulders, two burn in 1.5 s', () => {
  let h = 0; for (let i = 0; i < 600; i++) h = heatStep(h, 1.0, 1.6, 1 / 60); ok(h === 0, 'one beam (1.0) never burns');
  h = 0; let t = 0; while (h < 1 && t < 5) { h = heatStep(h, 1.95, 1.6, 1 / 60); t += 1 / 60; } ok(near(t, 1.5, 0.02), `1.95 burns in ${t.toFixed(2)} s`);
  h = 0.5; for (let i = 0; i < 60; i++) h = heatStep(h, 0, 1.6, 1 / 60); ok(near(h, 0, 1e-9), 'cools 0.5/s');
});
test('II-E2 clock and IV terminator keys', () => {
  ok(near(clockDeath(12, 4, 0.16), 48.1, 0.05), `the last ray dies at ${clockDeath(12, 4, 0.16)} s`);
  ok(near(clockT(48.125, 4, 0.16), 11.7, 1e-9), 'T 11.7');
  ok(near(clockDeath(12, 4, 0.16 / 1.5), 72.2, 0.1), 'assist +50 %');
  const K = [[0, 14], [16, 8], [40, 6], [86, 3], [150, 0]];
  ok(near(keyed(K, 20), 7.667, 0.001) && keyed(K, -5) === 14 && keyed(K, 200) === 0, `T(20) = ${keyed(K, 20)}`);
  return 'last ray dies at 48.1 s (assist 72.2 s); T(20) = 7.67';
});
test('capstan magnet', () => {
  let a = 4.9; for (let i = 0; i < 48; i++) a = magnet(a, 3.2, 2, true, 1 / 120); ok(near(a, 3.2, 0.05), `eases to 3.2 in 0.4 s (${a})`);
  ok(magnet(5.3, 3.2, 2, true, 1 / 120) === 5.3, 'outside the window: no pull');
  ok(magnet(4.0, 3.2, 2, false, 1 / 120) === 4.0, 'held input: no pull');
});

// finger aim (§6.3): the wanted reflection picks the notch, on whichever turn of the tray's line (α, α ± 180) lies
// inside its travel nearest the current notch; a crank tray has no travel limit and takes the nearer turn
test('finger aim picks the notch inside the travel', () => {
  const game = { phys: { addBody() {} }, settings: { aimSnap: false }, sfx() {}, emit() {} };
  const m = new Mirror(game, { kind: 'anchored', x: 55, alpha: 30, thetaHint: 195, mesh: false });
  const at = (thR) => ({ x: m.x + Math.cos(thR * DEG) * 5, y: m.y + Math.sin(thR * DEG) * 5 });
  const got = [];
  for (const a0 of [90, 75, 60, 0, -60, -75, -90]) for (const [thR, want] of [[15, -75], [75, -45], [195, 15], [315, 75]]) {
    m.setState({ x: 55, y: 0, alpha: a0 }); m.aimAt(at(thR));
    ok(m.target === want || (Math.abs(want) === 90 && Math.abs(m.target) === 90), `from α ${a0} aiming θr ${thR}: α ${m.target}, want ${want}`);
    ok(near(reflect(195, m.target), thR % 360, 1e-9), `from α ${a0}: the beam leaves at ${reflect(195, m.target)}, not ${thR}`);
    got.push(m.target);
  }
  // θr 345 needs α 90 ≡ −90: either end of the travel, the nearer one
  for (const [a0, want] of [[75, 90], [-75, -90]]) { m.setState({ x: 55, y: 0, alpha: a0 }); m.aimAt(at(345)); ok(m.target === want, `θr 345 from ${a0}: ${m.target}`); }
  const c = new Mirror(game, { kind: 'crank', x: 118.4, y: 6.8, alpha: 75, thetaHint: 105, mesh: false });
  c.aimAt({ x: 118.4 + Math.cos(DEG * 255) * 4, y: 6.8 + Math.sin(DEG * 255) * 4 });
  ok(c.target === 0 || c.target === 180, `crank θr 255 from 75: ${c.target}`);
  return `${got.length} aims from the ends of the travel and the middle`;
});

// ------------------------------------------------------------------ Chapter II (195° sun)
const GROUND = (x0, x1) => [x0, -3, x1, 0];
test('II-A1 laundry gust', () => {
  const cloth = { x0: 7.0, y0: 2.9, x1: 8.2, y1: 4.4, id: 'cloth' };
  const W = world({ solids: [GROUND(-10, 40), [-4, 0, -3, 12], [12.6, 2.6, 13.4, 5.0], [12.6, 5.8, 13.4, 9], [12.8, 0, 13.2, 2.6]], occluders: [cloth], targets: [{ id: 'L1', x: -2.75, y: 1.06 }] });
  expectEnd(W.trace(13.45, 5.4, 195), { kind: OCCLUDER, id: 'cloth', x: 8.2, y: 3.99 });
  cloth.y0 = 4.4; cloth.y1 = 5.0;
  expectEnd(W.trace(13.45, 5.4, 195), { kind: TARGET, id: 'L1', x: -2.41, y: 1.15 });
  return 'cloth at (8.2, 3.99); lifted, L1 at (-2.41, 1.15)';
});
test('II-A2 crate on the shelf', () => {
  const crate = { x0: 18, y0: 2, x1: 19, y1: 3, id: 'CR1' };
  const W = world({ solids: [GROUND(0, 40), [17, 0, 21, 2], [29.8, 2.6, 30.6, 5.6], [29.8, 6.4, 30.6, 12], [30.0, 0, 30.4, 2.6]], bodies: [crate], targets: [{ id: 'L2', x: 17.4, y: 2.5 }] });
  expectEnd(W.trace(30.65, 6.05, 195), { kind: BODY, id: 'CR1', x: 19, y: 2.93 });
  Object.assign(crate, { x0: 21.3, y0: 0, x1: 22.3, y1: 1 });
  expectEnd(W.trace(30.65, 6.05, 195), { kind: TARGET, id: 'L2', x: 17.74, y: 2.59 });
  return 'crate at (19, 2.93); fallen, L2 at (17.74, 2.59)';
});
function b1World(mx, alpha = -15) {
  const M = stand('M1', mx, alpha);
  return world({ solids: [GROUND(25, 60), [45.6, 0, 46.4, 2.2], [45.6, 2.2, 46.4, 2.4], [45.6, 3.2, 46.4, 10], [40.35, 0, 40.5, 0.15]], bodies: [M.body], mirrors: [M.mirror], targets: [{ id: 'L3', x: 37.0, y: 4.2 }] });
}
test('II-B1 first mirror: push', () => {
  const W0 = world({ solids: [GROUND(25, 60), [45.6, 0, 46.4, 2.2], [45.6, 2.2, 46.4, 2.4], [45.6, 3.2, 46.4, 10]], targets: [{ id: 'L3', x: 37.0, y: 4.2 }] });
  expectEnd(W0.trace(46.45, 2.93, 195), { kind: SOLID, x: 35.51, y: 0 });
  // M1 at its start (33.0) leaves the spot on the floor
  expectEnd(b1World(33.0).trace(46.45, 2.93, 195), { kind: SOLID, x: 35.51, y: 0 });
  const r = b1World(40.0).trace(46.45, 2.93, 195);
  ok(r.hits[0].kind === MIRROR && near(r.hits[0].x, 40.0, 0.02) && near(r.hits[0].y, 1.2, 0.01), `tray hit ${hitsOf(r)}`);
  expectEnd(r, { kind: TARGET, id: 'L3', x: 37.25, y: 3.95 });
  ok(near(r.hits[1].theta, 135, 1e-9), 'leaves at 135°');
  const tol = scan(38.5, 41.5, 0.01, (x) => litBy(b1World(x).trace(46.45, 2.93, 195), 'L3'));
  ok(tol && tol[0] <= 39.4 + 0.02 && tol[1] >= 40.6 - 0.02, `traced tolerance ${tol} must cover 39.4–40.6`);
  // invariant: L3 has no 0-bounce solution (the bare ray never reaches it from any of its windows)
  let zero = false; for (let y = 2.4; y <= 3.2; y += 0.05) if (litBy(W0.trace(46.45, y, 195), 'L3')) zero = true;
  ok(!zero, 'L3 reachable without a mirror');
  return `floor spot (35.51, 0); kerb 40.0 → L3 at ${pt(last(r))}; tolerance ${tol[0]}–${tol[1]}`;
});
function b2World(alpha) {
  const M = stand('M2', 55.0, alpha);
  return world({ solids: [GROUND(40, 70), [61.6, 0, 62.4, 2.4], [61.6, 2.4, 62.4, 2.6], [61.6, 3.4, 62.4, 10]], bodies: [M.body], mirrors: [M.mirror], targets: [{ id: 'L4', x: 56.23, y: 5.8 }] });
}
test('II-B2 tilt', () => {
  const r0 = b2World(30).trace(62.45, 3.20, 195);
  ok(r0.hits[0].kind === MIRROR && near(r0.hits[1].theta, 225, 1e-9), 'starts at +30°: 225°');
  expectEnd(r0, { kind: SOLID, x: 53.8, y: 0 });
  const sweep = [];
  for (const a of [15, 0, -15, -30, -45]) {
    const r = b2World(a).trace(62.45, 3.20, 195);
    sweep.push(a === 15 ? (r.hits[0].kind === MIRROR ? 'hit' : 'passes') : r.hits[1]?.theta);
  }
  ok(sweep[0] === 'passes', '+15° must slide past the tray');
  ok(sweep[1] === 165 && sweep[2] === 135 && sweep[3] === 105 && sweep[4] === 75, `sweep ${sweep}`);
  const r = b2World(-45).trace(62.45, 3.20, 195);
  expectEnd(r, { kind: TARGET, id: 'L4', x: 56.14, y: 5.46 });
  // invariant: L4 is hit only at M2 α −45°
  const lit = []; for (let n = -6; n < 6; n++) if (litBy(b2World(n * 15).trace(62.45, 3.20, 195), 'L4')) lit.push(n * 15);
  ok(lit.length === 1 && lit[0] === -45, `L4 lit at ${lit}`);
  return `225° → floor (53.8, 0); sweep ${sweep.join(' → ')}; −45° → L4 at ${pt(last(r))}; lit only at ${lit}`;
});
function c2World({ boy = null, crate = [99.5, 0, 100.5, 1] } = {}) {
  const bodies = [{ x0: crate[0], y0: crate[1], x1: crate[2], y1: crate[3], id: 'CR3' }];
  if (boy !== null) { const f = Math.abs(boy - 94.7) < 0.2 + 0.17 ? 0.4 : 0; bodies.push({ x0: boy - 0.17, y0: f, x1: boy + 0.17, y1: f + 1.16, id: 'boy' }); }
  return world({ solids: [GROUND(85, 110), [103.6, 0, 104.4, 2.4], [103.6, 2.4, 104.4, 2.8], [103.6, 3.6, 104.4, 10], [94.5, 0, 94.9, 0.4]], bodies, targets: [{ id: 'B1', x: 94.7, y: 0.6, r: 0.3 }] });
}
test('II-C2 sun-bolt', () => {
  const r = c2World().trace(104.45, 3.21, 195);
  ok(litBy(r, 'B1'), `bare ray lights B1: ${hitsOf(r)}`);
  ok(near(3.21 + (100.5 - 104.45) * Math.tan(15 * DEG), 2.15, 0.01), 'ray at 2.15 over CR3');
  const shade = scan(93, 98, 0.01, (x) => !litBy(c2World({ boy: x }).trace(104.45, 3.21, 195), 'B1'));
  ok(shade && near(shade[1], 96.96, 0.02) && shade[0] >= 94.5 && shade[0] <= 94.9, `own shadow ${shade}`);
  notes.push(`II-C2: the boy's own shadow covers x ${shade[0]}–${shade[1]} (spec 94.53–96.96): a lock is lit where the ray enters its circle (the hit points the spec lists), so the left end is where the bolt is entered`);
  expectEnd(c2World({ crate: [94.9, 0, 95.9, 1] }).trace(104.45, 3.21, 195), { kind: BODY, id: 'CR3', x: 95.9, y: 0.92 });
  ok(!litBy(c2World({ crate: [95.2, 0, 96.2, 1] }).trace(104.45, 3.21, 195), 'B1'), 'right face 96.2 still blocks');
  return `own shadow x ${shade[0]}–${shade[1]}; crate at the bollard blocks at (95.9, 0.92)`;
});
function d1World(m7x, a7, aF2, boy = null) {
  const M = stand('M7', m7x, a7);
  const bodies = [M.body];
  if (boy) bodies.push({ x0: boy[0] - 0.17, y0: boy[1], x1: boy[0] + 0.17, y1: boy[1] + 1.16, id: 'boy' });
  return world({ solids: [GROUND(100, 135), [112.0, 3.7, 118.9, 4.0], [125.6, 0, 126.4, 2.4], [125.6, 2.4, 126.4, 2.6], [125.6, 3.4, 126.4, 12], [120.25, 0, 120.4, 0.15]], bodies, mirrors: [M.mirror, { id: 'F2', x: 118.4, y: 6.8, r: 0.4, alpha: aF2 }], targets: [{ id: 'L7', x: 125.3, y: 4.95 }] });
}
test('II-D1 chain', () => {
  const r0 = d1World(119.9, -30, -15).trace(126.45, 2.96, 195);
  ok(r0.hits[0].obj.id === 'M7' && near(r0.hits[1].theta, 105, 1e-9) && r0.hits[1].obj?.id === 'F2', `M7 −30° sends 105° to F2: ${hitsOf(r0)}`);
  expectEnd(r0, { kind: SOLID, x: 115.6, y: 4.0 });
  const r = d1World(119.9, -30, 45).trace(126.45, 2.96, 195);
  expectEnd(r, { kind: TARGET, id: 'L7', x: 124.96, y: 5.04 });
  const back = d1World(119.9, -30, 15).trace(126.45, 2.96, 195);
  ok(back.hits[2]?.obj?.id === 'M7', `F2 at +15° bounces back onto M7: ${hitsOf(back)}`);
  const tol = scan(119.0, 121, 0.01, (x) => litBy(d1World(x, -30, 45).trace(126.45, 2.96, 195), 'L7'));
  ok(tol && tol[0] <= 119.62 && tol[1] >= 119.9, `M7 tolerance ${tol}`);
  notes.push(`II-D1: M7 lights L7 for centres ${tol[0]}–${tol[1]} (spec 119.6–120.2; the kerb holds it at 119.9)`);
  ok(litBy(d1World(119.9, -30, 45, [117.65, 4.0]).trace(126.45, 2.96, 195), 'L7'), 'the boy at the crank blocks the beam');
  ok(!litBy(d1World(115, 0, 45).trace(126.45, 2.96, 195), 'L7'), 'L7 has no solution with M7 off the kerb (115)');
  let off = false; for (let x = 112.5; x <= 119.0; x += 0.1) for (let n = -6; n < 6; n++) if (Math.abs(x - 119.9) > 0.45 && litBy(d1World(x, n * 15, 45).trace(126.45, 2.96, 195), 'L7')) off = true;
  ok(!off, 'L7 lit with M7 off the kerb');
  const combos = []; for (let a = -6; a < 6; a++) for (let b = -6; b < 6; b++) if (litBy(d1World(119.9, a * 15, b * 15).trace(126.45, 2.96, 195), 'L7')) combos.push([a * 15, b * 15]);
  ok(combos.length === 1 && combos[0][0] === -30 && combos[0][1] === 45, `L7 settings on the kerb: ${JSON.stringify(combos)}`);
  return `F2 −15° spot (115.6, 4.0); +45° → L7 at ${pt(last(r))}; M7 tolerance ${tol[0]}–${tol[1]}`;
});
function d2World(m5x, a5, raised = true) {
  const M = stand('M5', m5x, a5);
  return world({ solids: [GROUND(100, 140.5), [140.5, -9, 144, -8], GROUND(144, 160)], bodies: [M.body], planks: raised ? [{ id: 'bridge', x: 144, y: 1.75, r: 1.75, alpha: -90 }] : [], mirrors: [M.mirror], targets: [{ id: 'rope', x0: 134.85, y0: 6.8, x1: 135.15, y1: 8.0 }] });
}
test('II-D2 burn', () => {
  const W = d2World(133.34, -45);
  const w7 = W.trace(146.0, 10.35, 195);
  expectEnd(w7, { kind: TARGET, id: 'rope', x: 135.15, y: 7.44 });
  ok(near(4.59 + (144 - 146) * Math.tan(15 * DEG), 4.05, 0.01), 'W8 at 4.05 over the raised bridge');
  const w8 = W.trace(146.0, 4.59, 195);
  ok(w8.hits[0].kind === MIRROR && near(w8.hits[1].theta, 75, 1e-9), `W8 off M5 at 75°: ${hitsOf(w8)}`);
  expectEnd(w8, { kind: TARGET, id: 'rope', x: 134.85, y: 6.84 });
  const sum = w7.I + w8.I;
  ok(near(sum, 1.95, 1e-9) && sum >= 1.6, `sum ${sum}`);
  ok(w7.I < 1.6, 'one beam never burns the rope');
  const start = d2World(132.6, 0).trace(146.0, 4.59, 195);
  ok(!litBy(start, 'rope'), `M5 at its start lights the rope: ${hitsOf(start)}`);
  notes.push(`II-D2: with M5 at its start (132.6, 0°) W8 passes under the tray and lands at ${pt(last(start))} (spec: "its stand blocks W8 at (131.35, 0.67)", which would need the stand centred near 131.0)`);
  const notches = []; for (let n = -6; n < 6; n++) if (litBy(d2World(133.34, n * 15).trace(146.0, 4.59, 195), 'rope')) notches.push(n * 15);
  ok(notches.length === 1 && notches[0] === -45, `M5 notches reaching the rope: ${notches}`);
  const tol = scan(131.5, 134.5, 0.01, (x) => litBy(d2World(x, -45).trace(146.0, 4.59, 195), 'rope'));
  ok(tol && near(tol[0], 132.94, 0.03) && near(tol[1], 133.74, 0.03), `M5 tolerance ${tol} (spec 132.94–133.74)`);
  return `W7 at ${pt(last(w7))}, W8 via M5 at ${pt(last(w8))}, sum ${sum.toFixed(2)}; tolerance ${tol[0]}–${tol[1]}`;
});
function e2World(aF3, boy = null) {
  const bodies = boy ? [{ x0: boy - 0.17, y0: 10.6, x1: boy + 0.17, y1: 11.76, id: 'boy' }] : [];
  return world({ solids: [GROUND(170, 240), [186, 0, 194.5, 4.6], [189, 4.6, 194.5, 9.2], [190.5, 9.2, 194.5, 10.6], [199.5, 0, 203.5, 11]], bodies, mirrors: [{ id: 'F3', x: 194.6, y: 12.0, r: 0.6, alpha: aF3 }], targets: [{ id: 'L8', x: 199.2, y: 4.0 }] });
}
test('II-E2 the last ray', () => {
  const r0 = e2World(-30).trace(240, 12, 180);
  ok(r0.hits[0].kind === MIRROR && near(r0.hits[1].theta, 120, 1e-9) && r0.hits[1].kind === NONE, `−30° sends the ray to the sky: ${hitsOf(r0)}`);
  const r = e2World(60).trace(240, 12, 180);
  expectEnd(r, { kind: TARGET, id: 'L8', x: 199.04, y: 4.31 });
  expectEnd(e2World(30).trace(240, 12, 180), { kind: SOLID, x: 193.79, y: 10.6 });
  expectEnd(e2World(45).trace(240, 12, 180), { kind: SOLID, x: 194.6, y: 0 });
  ok(litBy(e2World(60, 194.1).trace(240, 12, 180), 'L8'), 'the boy on tier 3 (head 11.76) blocks the horizontal ray');
  const lit = []; for (let n = -6; n < 6; n++) if (litBy(e2World(n * 15).trace(240, 12, 180), 'L8')) lit.push(n * 15);
  ok(lit.length === 1 && lit[0] === 60, `L8 lit at ${lit}`);
  return `+60° → L8 at ${pt(last(r))}; +30° tower (193.79, 10.6); +45° ground (194.6, 0); lit only at ${lit}`;
});

// ------------------------------------------------------------------ Chapter III
function wire(from, to, bodies = []) {
  const W = world({ solids: [GROUND(0, 200)], bodies, targets: [{ id: 'sensor', x: to[0], y: to[1], r: 0.08 }] });
  return W.trace(from[0], from[1], angleOf(to[0] - from[0], to[1] - from[1]), 1);
}
const boyAt = (x, y = 0, h = 1.16) => ({ x0: x - 0.17, y0: y, x1: x + 0.17, y1: y + h, id: 'boy' });
test('III tripwires: hurdle, crawl line, walk-under, the guard', () => {
  ok(litBy(wire([11.0, 0.3], [12.4, 0.3]), 'sensor'), 'T1 clear');
  ok(!litBy(wire([11.0, 0.3], [12.4, 0.3], [boyAt(11.7)]), 'sensor'), 'walking T1 breaks it');
  ok(litBy(wire([11.0, 0.3], [12.4, 0.3], [boyAt(11.7, 0.31)]), 'sensor'), 'a jump over T1 clears it');
  ok(!litBy(wire([24.2, 0.8], [31.0, 0.8], [boyAt(27)]), 'sensor'), 'standing in T2 breaks it (head 1.16 > 0.8)');
  ok(litBy(wire([24.2, 0.8], [31.0, 0.8], [boyAt(27, 0, 0.56)]), 'sensor'), 'crawling under T2 clears it (0.56)');
  ok(litBy(wire([122.5, 1.8], [127.5, 1.8], [boyAt(125.5, 0.5)]), 'sensor'), 'T7: the top step puts the head at 1.66 < 1.8');
  ok(!litBy(wire([122.5, 1.8], [127.5, 1.8], [boyAt(125.5, 0.5 + 0.89)]), 'sensor'), 'T7: a jump (head 2.55) breaks it');
  const g = { x0: 160.45, y0: 0, x1: 160.95, y1: 1.8, id: 'guard' };
  const rg = wire([160, 0.3], [161.4, 0.3], [g]);
  ok(last(rg).obj.id === 'guard', 'T4: the guard is the occluder');
  ok(near((1.4 + 0.5) / 3.95, 0.48, 0.01), 'the guard keeps T4 dark for 0.48 s > 0.2 s');
  return 'T1, T2, T7, T4 as §4';
});
function b1nWorld(mx, alpha = 0) {
  const M = stand('M1', mx, alpha);
  return world({ solids: [GROUND(30, 70), [53.8, 0, 53.95, 0.15]], bodies: [M.body], mirrors: [M.mirror], targets: [{ id: 'L1', x: 55.5, y: 4.1 }] });
}
const unit = (dx, dy) => { const L = Math.hypot(dx, dy); return [dx / L, dy / L]; };
const lampRay = (W, o, aim, I = 1.5) => W.trace(o[0], o[1], angleOf(aim[0] - o[0], aim[1] - o[1]), I);
test('III-B1 lamp bounce', () => {
  const r = lampRay(b1nWorld(53.45), [45, 13], [54, 0.4]);
  ok(r.hits[0].obj?.id === 'M1' && near(r.hits[1].theta, 54.46, 0.05), `the flat tray reflects at 54°: ${hitsOf(r)}`);
  expectEnd(r, { kind: TARGET, id: 'L1', x: 55.3, y: 3.82 });
  ok(near(last(r).I, 1.425, 1e-9) && last(r).I >= 0.8, 'I = 1.5 × 0.95');
  const tol = scan(52.5, 54.5, 0.01, (x) => litBy(lampRay(b1nWorld(x), [45, 13], [54, 0.4]), 'L1'));
  ok(tol && tol[0] <= 53.2 + 0.02 && tol[1] >= 53.7 - 0.02, `tolerance ${tol} (spec 53.2–53.7)`);
  const fl = lampRay(b1nWorld(53.45), [45, 13], [53.25, 0.4]);
  expectEnd(fl, { kind: BODY, id: 'M1.stand', x: 53.1, y: 0.63 });
  ok(!litBy(lampRay(b1nWorld(40), [45, 13], [54, 0.4]), 'L1'), 'M1 off the kerb never charges L1');
  return `L1 at ${pt(last(r))}, I 1.43; tolerance ${tol[0]}–${tol[1]}; aim 53.25 flickers on the stand`;
});
function b2nWorld(alpha, boy = null) {
  const M = stand('M2', 59.25, alpha);
  const bodies = [M.body]; if (boy) bodies.push(boyAt(boy));
  return world({ solids: [GROUND(50, 80)], bodies, mirrors: [M.mirror], targets: [{ id: 'eye', x: 70, y: 12, r: 0.8 }] });
}
test('III-B2 dazzle and the tray shield', () => {
  const r0 = lampRay(b2nWorld(-30), [70, 12], [58.5, 0.4]);
  ok(r0.hits[0].obj?.id === 'M2' && near(r0.hits[1].theta, 74.75, 0.05) && !litBy(r0, 'eye'), `−30°: up at 75°, "almost": ${hitsOf(r0)}`);
  const r = lampRay(b2nWorld(-45), [70, 12], [58.5, 0.4]);
  expectEnd(r, { kind: TARGET, id: 'eye', x: 69.53, y: 11.35 });
  ok(r.hits.length === 2, 'the eye is hit by the reflection (bounce 1)');
  const ys = []; for (let y = 0.15; y <= 0.65 + 1e-9; y += 0.05) ys.push([+y.toFixed(2), litBy(lampRay(b2nWorld(-45), [70, 12], [58.5, y]), 'eye')]);
  ok(ys.every(([, l]) => l), `aim y 0.15–0.65: ${JSON.stringify(ys.filter(([, l]) => !l))}`);
  for (const [a, th] of [[-15, 104.75], [-60, 14.75]]) { const q = lampRay(b2nWorld(a), [70, 12], [58.5, 0.4]); ok(near(q.hits[1].theta, th, 0.05) && !litBy(q, 'eye'), `${a}° misses at ${th}°`); }
  // shield: the boy tucked against M2's left side; the lamp's lines to his head and chest cross the tray
  const W = b2nWorld(-45, 58.73);
  const head = W.cast(70, 12, ...unit(58.73 - 70, 0.986 - 12), Math.hypot(58.73 - 70, 0.986 - 12), MIRROR | BODY | SOLID, null, W.by('boy'));
  ok(head.kind === MIRROR && near(head.x, 59.08, 0.04) && near(head.y, 1.37, 0.04), `head line blocked at ${pt(head)}`);
  const hx = head.x, hy = head.y;
  ok(!W.clear(70, 12, 58.73, 0.58, W.by('boy')), 'the chest line is blocked');
  ok(near(21.8 / 4.1, 5.3, 0.05), 'the 21.8 m sprint takes 5.3 s < 7 s');
  return `eye at ${pt(last(r))}; aim y 0.15–0.65 all dazzle; shield at (${f2(hx)}, ${f2(hy)})`;
});
test('III-C1 decoy: balcony and alcove', () => {
  const crate = { x0: 96.2, y0: 7.0, x1: 97.2, y1: 8.0, id: 'crate' };
  const W = world({ solids: [GROUND(80, 110), [94.5, 3.7, 99.0, 4.0], [84, 2.2, 86.5, 6]], bodies: [crate], targets: [{ id: 'T3', x: 97.4, y: 4.3, r: 0.08 }] });
  ok(litBy(W.trace(96.0, 4.3, 0), 'T3'), 'T3 clear with the crate hanging');
  crate.y0 = 4.0; crate.y1 = 5.0;
  ok(last(W.trace(96.0, 4.3, 0)).obj?.id === 'crate', 'the fallen crate breaks T3');
  ok(!W.clear(95, 14, 85, 0.99) && !W.clear(95, 14, 85, 0.58), 'the alcove hides the lever spot from S3');
  ok(!W.clear(95, 14, 96.7, 0.99), 'the balcony throws real shadow under it');
});
function moonWorld(mx, alpha, boy = null) {
  const M = stand('M', mx, alpha);
  const bodies = [M.body]; if (boy) bodies.push(boyAt(boy));
  return world({ solids: [GROUND(165, 215), [171.6, 0, 172, 14], [190.35, 0, 190.5, 0.15], [199.6, 0, 200.4, 2.6]], bodies, mirrors: [M.mirror], targets: [{ id: 'ML', x: 196.0, y: 1.2 }, { id: 'GL', x: 174.0, y: 1.2 }] });
}
test('III-E moon well', () => {
  expectEnd(moonWorld(186, 15).trace(190, 14, 270, 0.5), { kind: SOLID, x: 190, y: 0 });
  const r = moonWorld(190, -45).trace(190, 14, 270, 0.5);
  expectEnd(r, { kind: TARGET, id: 'ML', x: 195.65, y: 1.2 });
  ok(near(last(r).I, 0.475, 1e-9) && last(r).I >= 0.4, 'I 0.475 ≥ 0.4');
  const g = moonWorld(190, 45).trace(190, 14, 270, 0.5);
  expectEnd(g, { kind: TARGET, id: 'GL', x: 174.35, y: 1.2 });
  ok(near(last(g).I / 0.8, 0.594, 0.001), 'GL at 0.59');
  const lit = []; for (let n = -6; n < 6; n++) if (litBy(moonWorld(190, n * 15).trace(190, 14, 270, 0.5), 'ML')) lit.push(n * 15);
  ok(lit.length === 1 && lit[0] === -45, `ML lit at ${lit}`);
  ok(litBy(moonWorld(190, -45, 189.48).trace(190, 14, 270, 0.5), 'ML'), 'the boy at 189.48 blocks it');
  const tol = scan(189, 191, 0.005, (x) => litBy(moonWorld(x, -45).trace(190, 14, 270, 0.5), 'ML'));
  ok(tol && near(tol[0], 189.72, 0.02) && near(tol[1], 190.28, 0.02), `±0.28: ${tol}`);
  return `ML at ${pt(last(r))} (I 0.475); GL at ${pt(last(g))} → 0.59; tolerance ${tol[0]}–${tol[1]}`;
});

// ------------------------------------------------------------------ Chapter IV (180° sun)
function a1World(alpha) {
  return world({ solids: [GROUND(-5, 60), [23.6, 0, 24.4, 2.6]], mirrors: [{ id: 'F1', x: 22, y: 9.0, r: 0.5, alpha }], targets: [{ id: 'L1', x: 17.5, y: 1.25 }] });
}
test('IV-A1 bring the light down', () => {
  ok(9.0 > keyed([[0, 14], [16, 8], [40, 6], [86, 3], [150, 0]], 20) + 0.3, 'the ray at y 9 is live at x 20 (T 7.67)');
  const r = a1World(30).trace(60, 9, 180);
  ok(r.hits[0].obj?.id === 'F1' && near(r.hits[1].theta, 240, 1e-9), 'F1 at +30° sends 240°');
  const h = expectEnd(r, { kind: TARGET, id: 'L1' });
  ok(near(crossAt(22, 9, 240, 17.56), 1.31, 0.01), 'the 240° leg passes (17.56, 1.31)');
  notes.push(`IV-A1: L1 (r 0.35) is entered at ${pt(h)}; the spec's (17.56, 1.31) lies on the same leg 0.09 m from the centre`);
  expectEnd(a1World(15).trace(60, 9, 180), { kind: SOLID, x: 6.41, y: 0 });
  ok(a1World(0).trace(60, 9, 180).hits[0].kind !== MIRROR, '0° lets the ray pass');
  ok(near(crossAt(22, 9, 240, 20.5), 6.4, 0.01), 'the leg passes 6.4 m over the crank at 20.5');
  const lit = []; for (let n = -6; n < 6; n++) if (litBy(a1World(n * 15).trace(60, 9, 180), 'L1')) lit.push(n * 15);
  ok(lit.length === 1 && lit[0] === 30, `L1 lit at ${lit}`);
  return `+30° → L1 at ${pt(h)}; +15° ground (6.41, 0); lit only at ${lit}`;
});
test('IV-B photocell lift', () => {
  const at = (a) => crossAt(54, 10.73, reflect(180, a), 59.95);
  ok(at(45) === null, '45°: straight down, never at the photocell');
  ok(near(at(60), 0.42, 0.01) && near(at(75), 7.295, 0.002) && near(at(90), 10.73, 1e-6), `beam at PC ${at(60)} ${at(75)} ${at(90)}`);
  ok(near(liftClamp([at(75)], 0.8, 0, 9, 0), 6.495, 0.002), 'clamps at 6.495');
  ok(liftClamp([at(90)], 0.8, 0, 9, 0) === null, '90°: PC would need 9.93 > 9');
  ok(liftClamp([at(60)], 0.8, 0, 9, 0) === null, '60°: below the platform');
  const W = world({ solids: [GROUND(40, 90), [62, 0, 75, 6.5], [62, 7.8, 63.2, 10.3], [60, -0.3, 62, 0]], mirrors: [{ id: 'F', x: 54, y: 10.73, r: 0.5, alpha: 75 }], targets: [{ id: 'PC', x: 59.95, y: 0.8, r: 0.15 }] });
  expectEnd(W.trace(86, 10.73, 180), { kind: SOLID, x: 62, y: 6.11 });
  W.targets[0].y = 6.495 + 0.8;
  expectEnd(W.trace(86, 10.73, 180), { kind: TARGET, id: 'PC' });
  return 'beam at PC 0.42 / 7.295 / 10.73; clamp 6.495; E2 face (62, 6.11)';
});
test('IV-C sun shafts stun a guard', () => {
  const g = { x0: 109.75, y0: 0, x1: 110.25, y1: 1.8, id: 'guard' };
  const W = world({ solids: [GROUND(90, 140)], bodies: [g] });
  const r = W.trace(110, 12, 270, 1.0);
  ok(last(r).obj?.id === 'guard' && last(r).I >= 0.8, 'the shaft lands on the guard with I 1.0');
});
function dWorld(aM, aC1, aC2, boy = null, rafter = false) {
  const M = stand('M', 170.8, aM);
  const bodies = [M.body]; if (boy) bodies.push(boyAt(boy[0], boy[1]));
  const solids = [GROUND(130, 190), [172, 0, 172.4, 0.6], [172, 1.8, 172.4, 16], [160, 3.7, 169.5, 4.0], [159.6, 2.0, 160, 16], [158, 11.7, 160, 12], [162, 11.7, 174, 12], [160, 11.7, 162, 12], [171.15, 0, 171.3, 0.15]];
  if (rafter) solids.push([162.5, 9.0, 169.0, 9.3]);
  return world({ solids, bodies, mirrors: [M.mirror, { id: 'C1', x: 170.8, y: 6.0, r: 0.4, alpha: aC1 }, { id: 'C2', x: 161.2, y: 6.0, r: 0.4, alpha: aC2 }], targets: [{ id: 'L_TOP', x: 161.2, y: 11.4 }] });
}
test('IV-D minaret chain', () => {
  const r = dWorld(-45, -45, -45).trace(180, 1.2, 180);
  ok(r.hits.map((h) => h.obj?.id).slice(0, 3).join() === 'M,C1,C2', `M → C1 → C2: ${hitsOf(r)}`);
  ok(near(r.hits[1].theta, 90, 1e-9) && near(r.hits[2].theta, 180, 1e-9) && near(r.hits[3].theta, 90, 1e-9), 'up, left, up');
  expectEnd(r, { kind: TARGET, id: 'L_TOP', x: 161.2, y: 11.05 });
  ok(dWorld(0, -45, -45).trace(180, 1.2, 180).hits[0].kind !== MIRROR, 'M edge-on lets the ray pass');
  for (const y of [0, 1, 2, 2.8]) ok(litBy(dWorld(-45, -45, -45, [169.9, y]).trace(180, 1.2, 180), 'L_TOP'), `the boy on ladder 1 at y ${y} blocks`);
  for (let x = 160.3; x <= 169.3; x += 0.5) ok(litBy(dWorld(-45, -45, -45, [x, 4.0]).trace(180, 1.2, 180), 'L_TOP'), `the boy on floor 1 at ${x} blocks`);
  const wrongs = (rafter) => {
    const w = [];
    for (let a = -6; a < 6; a++) for (let b = -6; b < 6; b++) for (let c = -6; c < 6; c++) {
      if (a === -3 && b === -3 && c === -3) continue;
      if (litBy(dWorld(a * 15, b * 15, c * 15, null, rafter).trace(180, 1.2, 180), 'L_TOP')) w.push([a * 15, b * 15, c * 15]);
    }
    return w;
  };
  // as written, C1 at −60° sends a 150° leg straight into L_TOP over C2 (12 combinations, any C2): a
  // two-mirror shortcut. A rafter (x 162.5–169.0, y 9.0–9.3) blocks it and leaves the three legs clear.
  const w0 = wrongs(false), w1 = wrongs(true);
  ok(w0.length === 12 && w0.every(([a, b]) => a === -45 && b === -60), `shortcut as found: ${JSON.stringify(w0.slice(0, 3))}`);
  ok(w1.length === 0, `${w1.length} wrong combinations with the rafter`);
  ok(litBy(dWorld(-45, -45, -45, null, true).trace(180, 1.2, 180), 'L_TOP'), 'the rafter blocks the solution');
  notes.push('IV-D: as specified, C1 at −60° alone lights L_TOP (a 150° leg from (170.8, 6.0) enters it at (161.55, 11.34), whatever C2 does): 12 of 1727 wrong settings. A rafter solid x 162.5–169.0, y 9.0–9.3 removes the shortcut and keeps every leg of the solution clear (all 1727 wrong settings dark).');
  return `L_TOP at ${pt(last(r))}; the C1 −60° shortcut found (12 settings), none with the rafter; the boy never blocks a leg`;
});
function eWorld(alpha) {
  return world({ solids: [GROUND(100, 180), [158, 11.7, 174, 12], [158, 12, 158.4, 12.8], [173.6, 12, 174, 12.8]], mirrors: [{ id: 'H', x: 168, y: 14.5, r: 1.5, alpha }], targets: [{ id: 'fortress', x: 110, y: 8.0, r: 1.5 }] });
}
test('IV-E heliostat', () => {
  const r = eWorld(3.2).trace(240, 14.5, 180);
  ok(r.hits[0].obj?.id === 'H' && near(r.hits[1].theta, 186.4, 1e-9), '3.2° sends 186.4°');
  expectEnd(r, { kind: TARGET, id: 'fortress' });
  ok(near(crossAt(168, 14.5, 186.4, 110), 8.0, 0.01), 'the line meets the lamp centre');
  const win = scan(0, 8, 0.01, (a) => litBy(eWorld(a).trace(240, 14.5, 180), 'fortress'));
  ok(win && win[0] <= 2.5 && win[1] >= 3.6, `window ${win} (spec 2.5–3.6)`);
  notes.push(`IV-E: the fortress lamp (r 1.5, 58 m away) is hit for α ${win[0]}–${win[1]}° (spec 2.5–3.6°); the magnet still pulls to 3.2° within ±2°`);
  expectEnd(eWorld(20).trace(240, 14.5, 180), { kind: SOLID, x: 165.0, y: 12.0, e: 0.05 });
  return `α 3.2 hits; window ${win[0]}–${win[1]}°; α 20 spot on the roof at (165.0, 12.0)`;
});

console.log(`\n${pass} passed, ${fail} failed`);
if (notes.length) console.log('\nnotes (where the spec rounds differently):\n- ' + notes.join('\n- '));
if (args.includes('--json')) { const fs = await import('fs'); fs.writeFileSync(args[args.indexOf('--json') + 1], JSON.stringify({ pass, fail, results, notes }, null, 1)); }
process.exit(fail ? 1 : 0);
