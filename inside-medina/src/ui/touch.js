import { icon } from './glyphs.js';

// Touch controls (FULL_GAME §8.1). A floating stick: a touch anywhere in the left 45 % (not the top 18 %, not ⏸)
// puts the base under the thumb; radius 56 px × size, dead zone 12 %, run at 75 % (the boy runs past |x| 0.75);
// vertical at 0.55 with hysteresis and a 200 ms dominant-axis lock; inside a vine's reach a diagonal of 35° or
// more counts as up. Jump (84 px, hit zone 1.4×) bottom right, grab (72 px) up-left of it with a context icon
// (✋ crate or lever, ☼ mirror, crank or capstan), ⏸ in the top corner. Every control follows its own pointer,
// everything lets go on blur and when the page hides, and the layer fades out when a keyboard or a pad is used
// and to 25 % after 5 s idle. Left-handed mirrors the layout. A touch anywhere else reaches the scene (finger aim).
const SIZE = { S: 0.85, M: 1, L: 1.2 };
const SUN_KINDS = new Set(['mirror', 'crank', 'capstan']);

export class TouchControls {
  constructor(ui, input) {
    this.ui = ui; this.input = input;
    const el = this.el = document.createElement('div');
    el.id = 'touch'; el.className = 'touch'; el.setAttribute('aria-hidden', 'false');
    el.innerHTML = `
      <div class="tzone" aria-hidden="true"></div>
      <div class="tstick" aria-hidden="true"><div class="tbase"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="48"/><circle cx="50" cy="50" r="31" class="run"/></svg></div><div class="tknob"></div></div>
      <button class="tbtn tgrab" aria-label="grab"><span class="ico hand">${icon('hand')}</span><span class="ico sun">${icon('sun')}</span></button>
      <button class="tbtn tjump" aria-label="jump">${icon('jump')}</button>
      <button class="tbtn tpause" aria-label="pause">${icon('pause')}</button>`;
    this.zone = el.querySelector('.tzone'); this.stickEl = el.querySelector('.tstick');
    this.base = el.querySelector('.tbase'); this.knob = el.querySelector('.tknob');
    this.S = { touchStick: 'floating', touchSize: 'M', touchOpacity: 45, leftHanded: false };
    this.stick = null; // { id, cx, cy, nx, ny, yOn, axis, axisT }
    this.btn = { jump: null, grab: null };
    this.idle = 0; this.visible = true; this.ctx = null;
    const T = input.touch;
    const capture = (node, e) => { try { node.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ } };
    // the stick
    const down = (e) => {
      if (this.stick || !this.visible) return;
      e.preventDefault();
      capture(e.currentTarget, e);
      const R = this.radius();
      let cx = e.clientX, cy = e.clientY;
      if (this.S.touchStick === 'fixed') { const c = this.fixedCentre(); if (Math.hypot(cx - c.x, cy - c.y) > R * 1.8) return; cx = c.x; cy = c.y; }
      else { cx = Math.max(R + 8, Math.min(innerWidth - R - 8, cx)); cy = Math.max(R + 8, Math.min(innerHeight - R - 8, cy)); }
      this.stick = { id: e.pointerId, cx, cy, nx: 0, ny: 0, yOn: false, axis: 'x', axisT: 0 };
      this.stickEl.style.transform = `translate3d(${cx}px, ${cy}px, 0)`;
      this.el.classList.add('sticking');
      this.move(e);
      this.touched();
    };
    this.zone.addEventListener('pointerdown', down);
    this.stickEl.addEventListener('pointerdown', down);
    const mv = (e) => { if (this.stick && e.pointerId === this.stick.id) { e.preventDefault(); this.move(e); } };
    const up = (e) => { if (this.stick && e.pointerId === this.stick.id) this.releaseStick(); };
    for (const n of [this.zone, this.stickEl]) { n.addEventListener('pointermove', mv); n.addEventListener('pointerup', up); n.addEventListener('pointercancel', up); n.addEventListener('lostpointercapture', up); }
    window.addEventListener('pointermove', mv, { passive: false });
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    // the buttons: each holds while its own pointer is down
    const hold = (sel, k) => {
      const b = el.querySelector(sel);
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); capture(b, e); this.btn[k] = e.pointerId; T[k] = true; b.classList.add('down'); this.touched(); });
      const rel = (e) => { if (this.btn[k] === e.pointerId) { this.btn[k] = null; T[k] = false; b.classList.remove('down'); } };
      b.addEventListener('pointerup', rel); b.addEventListener('pointercancel', rel); b.addEventListener('lostpointercapture', rel);
      b.addEventListener('click', (e) => e.preventDefault());
    };
    hold('.tjump', 'jump'); hold('.tgrab', 'grab');
    const pz = el.querySelector('.tpause');
    pz.addEventListener('pointerdown', (e) => { e.preventDefault(); this.touched(); });
    pz.addEventListener('click', (e) => { e.preventDefault(); ui.requestPause(); });
    this.layout();
    window.addEventListener('resize', () => this.layout());
  }

  radius() { return 56 * (SIZE[this.S.touchSize] || 1); }
  fixedCentre() {
    const s = this.ui.safeInsets(), R = this.radius(), left = !this.S.leftHanded;
    return { x: left ? s.l + 34 + R : innerWidth - s.r - 34 - R, y: innerHeight - s.b - 34 - R };
  }
  applySettings(S) {
    for (const k of ['touchStick', 'touchSize', 'touchOpacity', 'leftHanded']) if (S[k] !== undefined) this.S[k] = S[k];
    const el = this.el;
    el.style.setProperty('--ts', SIZE[this.S.touchSize] || 1);
    el.style.setProperty('--top', String(Math.max(0.2, Math.min(0.8, (+this.S.touchOpacity || 45) / 100))));
    el.dataset.hand = this.S.leftHanded ? 'left' : 'right';
    el.dataset.stick = this.S.touchStick;
    this.layout();
  }
  // without a thumb on it the base rests where a fixed stick sits (a faint ghost for the floating one)
  layout() {
    if (!this.stick) { const c = this.fixedCentre(); this.stickEl.style.transform = `translate3d(${c.x}px, ${c.y}px, 0)`; }
    this.el.classList.toggle('portrait', innerHeight > innerWidth);
  }

  move(e) {
    const s = this.stick, R = this.radius();
    let dx = e.clientX - s.cx, dy = e.clientY - s.cy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx *= R / len; dy *= R / len; }
    s.nx = dx / R; s.ny = -dy / R;
    this.knob.style.transform = `translate3d(${dx.toFixed(1)}px, ${dy.toFixed(1)}px, 0)`;
    this.solve();
  }
  // stick vector → input: dead zone, run threshold, vertical hysteresis, dominant-axis lock, climb assist
  solve(now = performance.now()) {
    const s = this.stick, T = this.input.touch;
    if (!s) return;
    const mag = Math.hypot(s.nx, s.ny);
    if (mag < 0.12) { T.x = 0; T.y = 0; s.yOn = false; this.el.classList.remove('running'); return; }
    const want = Math.abs(s.ny) > Math.abs(s.nx) ? 'y' : 'x';
    if (want !== s.axis && now - s.axisT > 200) { s.axis = want; s.axisT = now; }
    const thr = s.yOn ? 0.4 : 0.55;
    const climb = this.nearVine && s.ny > 0 && Math.atan2(s.ny, Math.abs(s.nx)) >= (35 * Math.PI) / 180 && mag > 0.35;
    s.yOn = (Math.abs(s.ny) > thr && (s.axis === 'y' || Math.abs(s.ny) > 0.8)) || climb;
    T.x = Math.max(-1, Math.min(1, s.nx));
    T.y = s.yOn ? (climb ? 1 : Math.sign(s.ny)) : 0;
    this.el.classList.toggle('running', Math.abs(T.x) >= 0.75);
  }
  releaseStick() {
    const T = this.input.touch;
    this.stick = null; T.x = 0; T.y = 0;
    this.knob.style.transform = '';
    this.el.classList.remove('sticking', 'running');
    this.layout();
  }
  // everything lets go (blur, hidden page, menus)
  release() {
    if (this.stick) this.releaseStick();
    for (const k of ['jump', 'grab']) { this.btn[k] = null; this.input.touch[k] = false; }
    this.el.querySelectorAll('.down').forEach((b) => b.classList.remove('down'));
  }
  touched() { this.idle = 0; this.el.classList.remove('idle'); this.input.setDevice('touch'); }
  deviceChanged(d) { this.el.classList.toggle('away', d !== 'touch'); }
  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.classList.toggle('hide', !v);
    if (!v) this.release();
  }
  // a hint glyph pulses its control (jump, grab) or the stick zone (move, up, down)
  pulse(glyph) {
    this.el.querySelectorAll('.pulse').forEach((n) => n.classList.remove('pulse'));
    if (!glyph) return;
    const t = glyph === 'jump' ? '.tjump' : glyph === 'grab' ? '.tgrab' : ['move', 'up', 'down', 'crawl'].includes(glyph) ? '.tzone' : null;
    if (t) this.el.querySelector(t)?.classList.add('pulse');
  }
  update(dt) {
    if (!this.visible) return;
    this.idle += dt;
    if (this.idle > 5 && !this.stick && !this.btn.jump && !this.btn.grab) this.el.classList.add('idle');
    if (this.stick) this.solve();
  }
  // per frame from the game: the grab icon follows what is in reach; the climb assist knows the vines
  frame(g) {
    const p = g.player;
    let k = null;
    if (p?.reachable) k = p.reachable();
    else if (p) k = p.grip ? 'crate' : p.lever ? 'lever' : g.interactNear?.(p.x, p.y, p.facing) ? 'lever' : null;
    if (k !== this.ctx) {
      this.ctx = k;
      this.el.dataset.ctx = k ? (SUN_KINDS.has(k) ? 'sun' : 'hand') : '';
    }
    this.nearVine = !!p && (g.vines || []).some((v) => v.enabled !== false && p.x > v.x0 - 0.3 && p.x < v.x1 + 0.3 && p.y + 0.6 > v.y0 && p.y < v.y1);
  }
  // control rectangles (tests, docs)
  rects() {
    const r = (sel) => { const b = this.el.querySelector(sel).getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; };
    return { jump: r('.tjump'), grab: r('.tgrab'), pause: r('.tpause'), zone: r('.tzone'), base: r('.tbase') };
  }
}
