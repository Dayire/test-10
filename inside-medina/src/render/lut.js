import * as THREE from 'three';

// Colour look-up tables for the final grade. A LUT is a 32³ 3D texture baked on the CPU from a grade
// function of display-space RGB; PostFX applies it after the analytic grade (tone map, tints, S-curve),
// crossfading two of them: params.lutA, params.lutB, params.lutMix, blended in by params.lut (0 = off,
// the default, so the look is unchanged until a preset asks for one). LUTs are shared and never
// disposed by the post chain.
export const LUT_SIZE = 32;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 1e-6) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, mx > 1e-6 ? d / mx : 0, mx];
}
function hsv2rgb(h, s, v) {
  h = ((h % 1) + 1) % 1 * 6;
  const i = Math.floor(h), f = h - i, p = v * (1 - s), q = v * (1 - s * f), t = v * (1 - s * (1 - f));
  return [[v, t, p], [q, v, p], [p, v, t], [p, q, v], [t, p, v], [v, p, q]][i % 6];
}

// bake fn(r, g, b) → [r, g, b] (all 0–1, display space) into a 3D texture
export function makeLut(fn, size = LUT_SIZE) {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = fn(r / (size - 1), g / (size - 1), b / (size - 1));
    data[i++] = Math.round(clamp01(o[0]) * 255); data[i++] = Math.round(clamp01(o[1]) * 255); data[i++] = Math.round(clamp01(o[2]) * 255); data[i++] = 255;
  }
  const t = new THREE.Data3DTexture(data, size, size, size);
  t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType; t.colorSpace = THREE.NoColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter; t.wrapS = t.wrapT = t.wrapR = THREE.ClampToEdgeWrapping;
  t.generateMipmaps = false; t.unpackAlignment = 1; t.needsUpdate = true;
  t.name = 'lut';
  return t;
}

// A grade in the colourist's terms, all optional:
//   lift / gamma / gain [r, g, b] (ASC-style), sat (global), shadows / highlights [r, g, b] split toning
//   with balance, bands [{ hue 0–1, width, sat, shift, value }] for hue-selective saturation, hue shift
//   and brightness (reds, skies, foliage…), contrast around 0.5.
export function grade(o = {}) {
  const lift = o.lift || [0, 0, 0], gam = o.gamma || [1, 1, 1], gain = o.gain || [1, 1, 1];
  const sat = o.sat ?? 1, con = o.contrast ?? 0, bands = o.bands || [];
  const sh = o.shadows, hi = o.highlights, bal = o.balance ?? 0.5;
  return (r, g, b) => {
    let c = [r, g, b];
    for (let k = 0; k < 3; k++) c[k] = Math.pow(clamp01(c[k] * gain[k] + lift[k] * (1 - c[k])), 1 / gam[k]);
    if (bands.length) {
      let [h, s, v] = rgb2hsv(c[0], c[1], c[2]);
      let ks = 1, dh = 0, kv = 1;
      for (const B of bands) {
        let d = Math.abs(h - B.hue); d = Math.min(d, 1 - d);
        const w = Math.max(0, 1 - d / (B.width ?? 0.08)) * Math.min(1, s * 4);
        const ww = w * w * (3 - 2 * w);
        ks *= 1 + ((B.sat ?? 1) - 1) * ww; dh += (B.shift ?? 0) * ww; kv *= 1 + ((B.value ?? 1) - 1) * ww;
      }
      c = hsv2rgb(h + dh, clamp01(s * ks), clamp01(v * kv));
    }
    const L = luma(c[0], c[1], c[2]);
    if (sat !== 1) for (let k = 0; k < 3; k++) c[k] = L + (c[k] - L) * sat;
    if (sh || hi) {
      const ws = 1 - Math.min(1, L / Math.max(1e-3, bal)), wh = Math.max(0, (L - bal) / Math.max(1e-3, 1 - bal));
      for (let k = 0; k < 3; k++) c[k] = c[k] * (1 + ((sh ? sh[k] : 1) - 1) * ws) * (1 + ((hi ? hi[k] : 1) - 1) * wh);
    }
    if (con) for (let k = 0; k < 3; k++) { const x = clamp01(c[k]); c[k] = x + (x * x * (3 - 2 * x) - x) * con; }
    return c;
  };
}

// Looks per lighting preset (FULL_GAME §9.3). goldenHour is the identity: the souk keeps the analytic
// grade it was tuned with. The others push the hue relationships the analytic grade cannot reach.
export const LUT_LOOKS = {
  identity: {},
  goldenHour: {},
  sunset: { bands: [{ hue: 0.07, width: 0.1, sat: 1.12, shift: -0.006 }, { hue: 0.6, width: 0.12, sat: 0.9, shift: 0.03 }], highlights: [1.03, 1.0, 0.95], shadows: [0.97, 0.95, 1.04] },
  dusk: { bands: [{ hue: 0.06, width: 0.1, sat: 1.05 }, { hue: 0.33, width: 0.12, sat: 0.7 }], shadows: [1.02, 0.95, 1.08], sat: 0.95 },
  night: { bands: [{ hue: 0.0, width: 0.09, sat: 0.72 }, { hue: 0.6, width: 0.14, sat: 1.12, shift: -0.02 }, { hue: 0.33, width: 0.12, sat: 0.6 }], shadows: [0.92, 0.98, 1.1], lift: [0.004, 0.008, 0.02], sat: 0.92 },
  dawn: { bands: [{ hue: 0.95, width: 0.1, sat: 1.1 }, { hue: 0.6, width: 0.12, shift: 0.025 }], highlights: [1.04, 0.98, 0.98], shadows: [0.98, 0.96, 1.05] },
  sunrise: { bands: [{ hue: 0.09, width: 0.1, sat: 1.1 }], highlights: [1.03, 1.0, 0.94], contrast: 0.04 },
};

const cache = new Map();
// shared LUT for a look name (or a grade object), baked once
export function lut(look = 'identity') {
  if (typeof look !== 'string') return makeLut(grade(look));
  if (!cache.has(look)) cache.set(look, makeLut(grade(LUT_LOOKS[look] || {})));
  return cache.get(look);
}
