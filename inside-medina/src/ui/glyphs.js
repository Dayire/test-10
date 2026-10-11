// The shell's visual vocabulary, all inline SVG on a 100 × 100 grid: the eight-point star (khatam) that marks
// focus, the brass rosette, the four time-of-day glyphs of the chapters (in layers, so a card can assemble them
// with compositor-only animations), and the small wordless icons of the HUD, the touch controls and the hints.
const f = (n) => +n.toFixed(2);

// eight-point star: two squares, outer radius R (inner vertices at R·cos45/cos22.5), rotated by `rot` degrees
export function star8(cx, cy, R, rot = 0) {
  const r = R * 0.7654, p = [];
  for (let i = 0; i < 16; i++) {
    const a = ((i * 22.5 + rot - 90) * Math.PI) / 180, q = i % 2 ? r : R;
    p.push(`${f(cx + Math.cos(a) * q)} ${f(cy + Math.sin(a) * q)}`);
  }
  return `M${p.join('L')}Z`;
}
const rays = (cx, cy, r0, r1, angles) => angles.map((a) => {
  const t = (a * Math.PI) / 180;
  return `M${f(cx + Math.cos(t) * r0)} ${f(cy + Math.sin(t) * r0)}L${f(cx + Math.cos(t) * r1)} ${f(cy + Math.sin(t) * r1)}`;
}).join('');
const range = (n, step, from = 0) => Array.from({ length: n }, (_, i) => from + i * step);
const P = (d, extra = '') => `<path d="${d}"${extra}/>`;

// the chapters' time of day (FULL_GAME §7.2): sun high, sun on the horizon, crescent, rising sun.
// Each is a list of layers {k, svg}; k names the motion a card gives it (ground, body, rays, stars).
const MERLONS = 'M10 80V70h7v-5h6v5h10v-5h6v5h10v-5h6v5h10v-5h6v5h10v-5h6v5h3v10';
export const TIME_GLYPHS = {
  sunHigh: [
    { k: 'ground', svg: P('M14 82h72M32 90h36') },
    { k: 'body', svg: '<circle cx="50" cy="42" r="12"/>' },
    { k: 'rays', svg: P(range(12, 30).map((a, i) => rays(50, 42, 19, i % 2 ? 25 : 29, [a])).join('')) },
  ],
  sunHorizon: [
    { k: 'ground', svg: P('M12 66h76M24 75h52M36 83h28M46 91h8') },
    { k: 'body', svg: P('M32 66a18 18 0 0 1 36 0') },
    { k: 'rays', svg: P(rays(50, 66, 24, 32, [-165, -135, -105, -75, -45, -15]) + rays(50, 66, 24, 28, [-150, -120, -90, -60, -30])) },
  ],
  crescent: [
    { k: 'ground', svg: P('M18 90h64') },
    { k: 'body', svg: P('M58 23A28.8 28.8 0 1 0 58 77A30 30 0 0 1 58 23Z') },
    { k: 'stars', svg: P(star8(76, 30, 4) + star8(84, 54, 2.6) + star8(70, 72, 2)) },
  ],
  sunRise: [
    { k: 'ground', svg: P(MERLONS) + P('M24 90h52') },
    { k: 'body', svg: P('M34 70a16 16 0 0 1 32 0') },
    { k: 'rays', svg: P(rays(50, 70, 21, 29, [-150, -120, -90, -60, -30])) },
  ],
  rosette: [
    { k: 'ground', svg: P(star8(50, 50, 40)) },
    { k: 'body', svg: P(star8(50, 50, 26, 22.5)) },
    { k: 'rays', svg: '<circle cx="50" cy="50" r="9"/>' },
  ],
};
export const timeGlyph = (name, cls = 'glyph') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${(TIME_GLYPHS[name] || TIME_GLYPHS.rosette).map((l) => l.svg).join('')}</svg>`;

// the brass rosette (splash, save indicator, waiting marks): star, inner star turned 22.5°, a ring and a boss
export const ROSETTE = P(star8(50, 50, 44)) + P(star8(50, 50, 30, 22.5)) + '<circle cx="50" cy="50" r="13"/><circle cx="50" cy="50" r="4.5"/>';
export const STAR = P(star8(50, 50, 46));

export const ICONS = {
  star: STAR,
  rosette: ROSETTE,
  pause: '<rect x="31" y="24" width="12" height="52" rx="3"/><rect x="57" y="24" width="12" height="52" rx="3"/>',
  play: P('M36 24L76 50L36 76Z'),
  back: P('M58 26L34 50L58 74'),
  check: P('M26 52L44 70L76 32'),
  cross: P('M30 30L70 70M70 30L30 70'),
  // a palm: four fingers and a thumb (crate, lever)
  hand: P('M36 58V30a5 5 0 0 1 10 0v20M46 48V24a5 5 0 0 1 10 0v24M56 48V27a5 5 0 0 1 10 0v24M66 52V36a5 5 0 0 1 10 0v24c0 14-9 24-22 24h-4c-8 0-13-4-17-10L22 62a5 5 0 0 1 8-6l6 6'),
  // the sun on a tray (mirrors, cranks, the capstan)
  sun: '<circle cx="50" cy="50" r="13"/>' + P(rays(50, 50, 21, 30, range(8, 45))),
  jump: P('M28 58L50 34L72 58M30 76h40'),
  linkBroken: P('M44 34l6-6a12 12 0 0 1 17 17l-6 6M56 66l-6 6a12 12 0 0 1-17-17l6-6M30 22l6 8M22 32l9 3M70 78l-6-8M78 68l-9-3'),
  rotate: '<rect x="30" y="18" width="40" height="64" rx="6"/>' + P('M80 58a30 30 0 0 1-24 26M84 76l-4 9-9-3'),
  fullscreen: P('M22 40V22h18M60 22h18v18M78 60v18H60M40 78H22V60'),
  lock: P('M32 86V48a18 18 0 0 1 36 0v38ZM50 58v12') + '<circle cx="50" cy="56" r="3"/>',
  // sound cues (visual sound cues): the horn, a shout, the drum, a dart
  horn: P('M18 44h14l22-14v40L32 56H18ZM66 38a16 16 0 0 1 0 24M74 30a28 28 0 0 1 0 40'),
  shout: P('M30 34c10-10 30-10 40 0M24 50h52M30 66c10 10 30 10 40 0'),
  drum: '<ellipse cx="50" cy="40" rx="26" ry="9"/>' + P('M24 40v24c0 5 12 9 26 9s26-4 26-9V40M30 22l8 10M70 22l-8 10'),
  dart: P('M18 50h56M62 38l14 12-14 12M18 44l8 6-8 6'),
  // ghost thumb for touch hints: the thumb seen from above, its nail and the crease of its joint
  thumb: P('M30 97V46c0-12 9-21 20-21s20 9 20 21v51') + P('M40 46c0-7 4.5-11 10-11s10 4 10 11v7c-3 2-6.4 3-10 3s-7-1-10-3Z') + P('M37 77c8 3.5 18 3.5 26 0'),
  ring: '<circle cx="50" cy="50" r="30"/>',
  arrowUp: P('M50 78V24M32 42l18-18 18 18'),
  arrowDown: P('M50 22v54M32 58l18 18 18-18'),
  arrowLR: P('M18 50h64M32 36L18 50l14 14M68 36l14 14-14 14'),
  mouse: '<rect x="32" y="20" width="36" height="60" rx="18"/>' + P('M50 20v20M32 42h36'),
  lantern: P('M50 14v8M38 30h24l-4-8H42ZM36 30h28l-4 40H40ZM40 70h20l-3 10H43ZM44 40v20M50 38v24M56 40v20'),
};
export const icon = (name, cls = 'icon') => `<svg class="${cls}" viewBox="0 0 100 100" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// pad face buttons by position, per family: bottom (confirm / jump), right (back), left (grab), top
const FACE = {
  xbox: { bottom: 'A', right: 'B', left: 'X', top: 'Y' },
  generic: { bottom: 'A', right: 'B', left: 'X', top: 'Y' },
  nintendo: { bottom: 'B', right: 'A', left: 'Y', top: 'X' },
};
const PS = {
  bottom: P('M36 36L64 64M64 36L36 64'),
  right: '<circle cx="50" cy="50" r="15"/>',
  left: '<rect x="36" y="36" width="28" height="28"/>',
  top: P('M50 33L67 63H33Z'),
};
export function padButton(kind, pos) {
  if (kind === 'ps') return `<span class="pad ps" data-pos="${pos}"><svg viewBox="0 0 100 100" aria-hidden="true">${PS[pos]}</svg></span>`;
  return `<span class="pad" data-pos="${pos}">${(FACE[kind] || FACE.xbox)[pos]}</span>`;
}
export function padLabel(kind, which) {
  const m = { start: kind === 'ps' ? 'options' : kind === 'nintendo' ? '+' : 'menu', lb: kind === 'ps' ? 'L1' : kind === 'nintendo' ? 'L' : 'LB', rb: kind === 'ps' ? 'R1' : kind === 'nintendo' ? 'R' : 'RB', rt: kind === 'ps' ? 'R2' : kind === 'nintendo' ? 'ZR' : 'RT' };
  return m[which] || which;
}
export const key = (label, wide = false) => `<kbd class="key${wide ? ' wide' : ''}">${label}</kbd>`;
// a stick: its ring, the nub pushed the way it goes and brass chevrons outside the ring for that way (‹ › for move,
// ˄ for climb, ˅ for crawl, both for tilt), so move, climb and crawl read apart at a glance
const CHEV = { l: 'M11 39L2 50l9 11', r: 'M89 39l9 11-9 11', u: 'M39 11L50 2l11 9', d: 'M39 89l11 9 11-9' };
const DIRS = { lr: 'lr', up: 'u', down: 'd', ud: 'ud' };
export const stick = (dir = '') => `<span class="pad stick" data-dir="${dir}"><svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="30"/><circle class="nub" cx="50" cy="50" r="12"/>${[...(DIRS[dir] || '')].map((k) => `<path class="dir" d="${CHEV[k]}"/>`).join('')}</svg></span>`;

// a zellige lattice as a CSS background (eight-point stars on a square grid, joined by their points)
export function zelligeTile(stroke = 'rgba(233,196,143,.10)', size = 64) {
  const s = size, c = s / 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><g fill="none" stroke="${stroke}" stroke-width="1"><path d="${star8(c, c, s * 0.34)}"/><path d="${star8(c, c, s * 0.2, 22.5)}"/><path d="M0 0L${s * 0.16} ${s * 0.16}M${s} 0L${s - s * 0.16} ${s * 0.16}M0 ${s}L${s * 0.16} ${s - s * 0.16}M${s} ${s}L${s - s * 0.16} ${s - s * 0.16}"/><path d="${star8(0, 0, s * 0.12)}"/><path d="${star8(s, 0, s * 0.12)}"/><path d="${star8(0, s, s * 0.12)}"/><path d="${star8(s, s, s * 0.12)}"/></g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
