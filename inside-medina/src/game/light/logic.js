// Sunwork rules that need no scene: lock charge, rope heat, terminator keys, the capstan magnet, the
// photocell lift clamp. Pure, so tools/light-unit.mjs tests them in Node (FULL_GAME §5.2, §6.2).

// a sun-lock's level after dt: rises at 1/chargeT while lit with I ≥ need and latches at 1; a weaker light
// shows I/need (petals half open) and never charges past it; darkness decays at 1/decayT
export function chargeLevel(level, I, need, dt, chargeT = 0.6, decayT = 0.5) {
  if (I >= need - 1e-9) return Math.min(1, level + dt / chargeT);
  const cap = I > 0 ? Math.min(1, I / need) : 0;
  if (level < cap) return Math.min(cap, level + dt / chargeT);
  return Math.max(cap, level - dt / decayT);
}

// a hemp rope: heat rises at 1/burnT while the summed light reaches `need`, cools at `cool`/s otherwise;
// burnt at 1 (smoulders whenever any light touches it)
export function heatStep(heat, I, need, dt, burnT = 1.5, cool = 0.5) {
  if (I >= need - 1e-9) return Math.min(1, heat + dt / burnT);
  return Math.max(0, heat - cool * dt);
}

// piecewise-linear keys [[x, v], ...] (a Terminator keyed on the boy's x)
export function keyed(keys, x) {
  if (!keys.length) return 0;
  if (x <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [x1, v1] = keys[i];
    if (x <= x1) { const [x0, v0] = keys[i - 1]; return v0 + (v1 - v0) * (x - x0) / Math.max(1e-9, x1 - x0); }
  }
  return keys[keys.length - 1][1];
}

// the sunset clock: terminator height after t seconds, and when a ray at height y dies (y ≤ T + 0.3)
export const clockT = (t, T0, rate) => T0 + rate * t;
export const clockDeath = (y, T0, rate) => (y - 0.3 - T0) / rate;

// the capstan's magnet: within `window` degrees of the solution and with the input released, ease onto it
// over easeT seconds (FULL_GAME §5.2: every device gets it, it is not an assist)
export function magnet(alpha, target, window, released, dt, easeT = 0.4) {
  if (!released || Math.abs(alpha - target) > window) return alpha;
  const k = 1 - Math.exp(-dt * 5 / easeT);
  const a = alpha + (target - alpha) * k;
  return Math.abs(a - target) < 1e-3 ? target : a;
}

// the photocell lift (IV-B): where the photocell (offset oy above the platform) meets a beam crossing x;
// returns the platform height it clamps to, or null when no beam crosses inside [lo, hi]
export function liftClamp(beamYs, oy, lo, hi, yNow) {
  let best = null;
  for (const y of beamYs) {
    const yp = y - oy;
    if (yp < lo - 1e-9 || yp > hi + 1e-9) continue;
    if (yp >= yNow - 1e-6 && (best === null || yp < best)) best = yp;
  }
  return best;
}

// the height at which the beam leaving (x, y) at theta (deg) crosses the vertical line X, or null
export function crossAt(x, y, theta, X) {
  const c = Math.cos(theta * Math.PI / 180), s = Math.sin(theta * Math.PI / 180);
  if (Math.abs(c) < 1e-9 || (X - x) / c <= 0) return null;
  return y + (X - x) * s / c;
}
