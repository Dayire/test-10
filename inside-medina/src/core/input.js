// Unified input: keyboard (physical key codes, so WASD also works on AZERTY),
// gamepads (standard mapping, with a fallback for raw HID layouts) and the
// on-screen touch controls (src/ui/touch.js writes `touch`). poll() also
// reports the scene pointer (left mouse or a touch on the canvas, in NDC),
// menu navigation edges with repeat (400 ms, then every 120 ms) and the
// device in use, so glyphs and the touch layer follow the player's hands.
const NAV = ['up', 'down', 'left', 'right', 'confirm', 'back', 'prev', 'next', 'pause'];
const GAME_KEYS = ['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
const editable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));

// pad family from its id (vendor ids: 054c Sony, 045e Microsoft, 057e Nintendo), for button glyphs
// ("Wireless Controller" alone is Sony's name, but Xbox pads carry it too: vendors first)
export function padKind(id = '') {
  if (/045e|xbox|xinput|x-box/i.test(id)) return 'xbox';
  if (/054c|playstation|dualshock|dualsense/i.test(id)) return 'ps';
  if (/057e|nintendo|switch|joy-con|pro controller/i.test(id)) return 'nintendo';
  if (/^wireless controller/i.test(id)) return 'ps';
  return 'generic';
}

// buttons and axes of a pad, in the standard layout (A B X Y LB RB LT RT back start LS RS up down left right)
function readPad(gp) {
  const btn = (i) => { const b = gp.buttons[i]; return !!b && (b.pressed || b.value > 0.5); };
  let ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
  const B = new Array(16).fill(false);
  if (gp.mapping === 'standard') for (let i = 0; i < 16; i++) B[i] = btn(i);
  else {
    // raw HID pads: the four face buttons and the shoulders usually sit at 0-7, start at 9; the d-pad is a pair
    // of axes (6, 7) or a hat switch (axis 9: -1 up, then clockwise in steps of 2/7)
    for (let i = 0; i < 10; i++) B[i] = btn(i);
    const hx = gp.axes[6], hy = gp.axes[7], hat = gp.axes[9];
    if (Number.isFinite(hx) && Number.isFinite(hy) && gp.axes.length >= 8) { B[14] = hx < -0.5; B[15] = hx > 0.5; B[12] = hy < -0.5; B[13] = hy > 0.5; }
    if (Number.isFinite(hat) && Math.abs(hat) <= 1.01) {
      const k = Math.round((hat + 1) * 3.5);
      B[12] = k === 0 || k === 1 || k === 7; B[15] = k >= 1 && k <= 3; B[13] = k >= 3 && k <= 5; B[14] = k >= 5 && k <= 7;
    }
  }
  return { B, ax, ay };
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.taps = new Set(); // pressed since the last poll (a tap shorter than a frame still counts once)
    this.state = { x: 0, y: 0, jump: false, grab: false, pause: false, any: false, pointer: null };
    this.prev = { ...this.state };
    this.jumpPressed = false; this.grabPressed = false; this.pausePressed = false; this.anyPressed = false;
    this._raw = { jump: false, grab: false, pause: false, any: false };
    this.override = null; // scripted input for tests / cutscenes
    this.touch = { x: 0, y: 0, jump: false, grab: false };
    this.lastDevice = 'keyboard';
    this.pad = null; // { kind, id, index } of the pad last used
    this.pointer = { x: 0, y: 0, active: false, pressed: false, released: false, kind: 'mouse' };
    this._ptr = { id: null, down: false, pressed: false, released: false };
    this.nav = Object.fromEntries(NAV.map((k) => [k, false]));
    this._navT = {};
    this.menuOpen = false; // a menu is up: Tab moves the browser focus, nothing reaches the boy
    this.settings = { crawlMode: 'hold' };
    this.crawlLatch = false; this._down = false;
    this.context = null; // () => ({ grounded }) from the game, for the crawl toggle
    this.listeners = { device: [], padDisconnect: [] };
    this.touchUI = null; this.haptics = null;
    this._setupPointer();
    window.addEventListener('keydown', (e) => {
      if (editable(e.target)) return;
      if (GAME_KEYS.includes(e.code) || (e.code === 'Tab' && !this.menuOpen)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.taps.add(e.code); this.setDevice('keyboard');
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.clear());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.clear(); });
    window.addEventListener('gamepadconnected', (e) => { this.pad = { kind: padKind(e.gamepad.id), id: e.gamepad.id, index: e.gamepad.index }; });
    window.addEventListener('gamepaddisconnected', (e) => {
      if (this.pad && this.pad.index === e.gamepad.index) {
        this.pad = null;
        for (const f of this.listeners.padDisconnect) f(e.gamepad);
        if (this.lastDevice === 'gamepad') this.setDevice('keyboard');
      }
    });
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      let coarse = false;
      try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* no media queries */ }
      if (coarse) this.lastDevice = 'touch';
    }
    // show the letters the player actually has under the WASD positions (ZQSD on AZERTY)
    this.keyLabels = null;
    try {
      if (navigator.keyboard && navigator.keyboard.getLayoutMap) {
        navigator.keyboard.getLayoutMap().then((m) => {
          const g = (c, d) => (m.get(c) || d).toUpperCase();
          this.keyLabels = { up: g('KeyW', 'W'), left: g('KeyA', 'A'), down: g('KeyS', 'S'), right: g('KeyD', 'D') };
        }).catch(() => {});
      }
    } catch { /* keyboard map not allowed in this frame */ }
  }

  on(ev, fn) { (this.listeners[ev] ||= []).push(fn); return () => { const l = this.listeners[ev]; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); }; }
  setDevice(d) {
    if (d === this.lastDevice) return;
    this.lastDevice = d;
    for (const f of this.listeners.device) f(d);
  }
  get touchCapable() { return !!this.touchUI; }

  // settings: crawl hold / toggle here; the touch layer and haptics take theirs
  applySettings(S = {}) {
    if (S.crawlMode !== undefined) { this.settings.crawlMode = S.crawlMode; if (S.crawlMode !== 'toggle') this.crawlLatch = false; }
    this.touchUI?.applySettings?.(S);
    if (S.vibration !== undefined) this.haptics?.setLevel?.(S.vibration);
  }

  // everything held lets go (blur, hidden page, a menu opening over play)
  clear() {
    this.keys.clear(); this.taps.clear();
    this.touch.x = 0; this.touch.y = 0; this.touch.jump = false; this.touch.grab = false;
    this.touchUI?.release?.();
    const P = this._ptr;
    if (P.down) { P.down = false; P.released = true; P.id = null; }
    this.crawlLatch = false;
  }

  k(...codes) { return codes.some((c) => this.keys.has(c) || this.taps.has(c)); }

  poll() {
    let x = 0, y = 0, jump = false, grab = false, pause = false;
    if (this.k('ArrowLeft', 'KeyA')) x -= 1;
    if (this.k('ArrowRight', 'KeyD')) x += 1;
    if (this.k('ArrowUp', 'KeyW')) y += 1;
    if (this.k('ArrowDown', 'KeyS')) y -= 1;
    if (this.k('Space', 'KeyK')) jump = true;
    if (this.k('ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyE', 'ControlLeft', 'ControlRight', 'KeyF')) grab = true;
    if (this.k('Escape', 'KeyP')) pause = true;
    const nav = {
      up: this.k('ArrowUp', 'KeyW'), down: this.k('ArrowDown', 'KeyS'), left: this.k('ArrowLeft', 'KeyA'), right: this.k('ArrowRight', 'KeyD'),
      confirm: this.k('Enter', 'NumpadEnter', 'Space'), back: this.k('Escape', 'Backspace'), prev: this.k('KeyQ', 'BracketLeft', 'PageUp'), next: this.k('KeyE', 'BracketRight', 'PageDown'), pause,
    };
    let pads = [];
    try { pads = (navigator.getGamepads && navigator.getGamepads()) || []; } catch { pads = []; } // blocked by permissions policy in some frames
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const { B, ax, ay } = readPad(gp);
      const dz = 0.22;
      let gx = Math.abs(ax) > dz ? (ax - Math.sign(ax) * dz) / (1 - dz) : 0;
      let gy = Math.abs(ay) > dz ? -(ay - Math.sign(ay) * dz) / (1 - dz) : 0;
      if (B[14]) gx = -1; if (B[15]) gx = 1; if (B[12]) gy = 1; if (B[13]) gy = -1;
      if (gx || gy || B.some(Boolean)) {
        if (!this.pad || this.pad.index !== gp.index) this.pad = { kind: padKind(gp.id), id: gp.id, index: gp.index };
        this.setDevice('gamepad');
      }
      if (Math.abs(gx) > Math.abs(x)) x = gx;
      if (Math.abs(gy) > Math.abs(y)) y = gy;
      jump = jump || B[0] || B[3];
      grab = grab || B[2] || B[1] || B[7] || B[6] || B[5];
      pause = pause || B[9];
      nav.up ||= gy > 0.5; nav.down ||= gy < -0.5; nav.left ||= gx < -0.5; nav.right ||= gx > 0.5;
      nav.confirm ||= B[0]; nav.back ||= B[1]; nav.prev ||= B[4]; nav.next ||= B[5]; nav.pause ||= B[9];
    }
    const t = this.touch;
    if (t.x) x = t.x; if (t.y) y = t.y; jump = jump || t.jump; grab = grab || t.grab;
    // crawl toggle: a down-press on the ground latches the crouch; up, a jump, another down-press or leaving the
    // ground lets it go
    const down = y < -0.6;
    if (this.settings.crawlMode === 'toggle' && !this.override) {
      const grounded = this.context ? !!this.context().grounded : true;
      if (down && !this._down) this.crawlLatch = grounded ? !this.crawlLatch : false;
      if (y > 0.6 || jump || !grounded) this.crawlLatch = false;
      if (this.crawlLatch) y = Math.min(y, -1);
    }
    this._down = down;
    if (this.override) ({ x, y, jump, grab } = { x: 0, y: 0, jump: false, grab: false, ...this.override });
    this.prev = this.state;
    const any = !!(x || y || jump || grab || this.keys.size || this.taps.size);
    this.taps.clear();
    const P = this._ptr, ptr = this.pointer;
    ptr.active = P.down; ptr.pressed = P.pressed; ptr.released = P.released; P.pressed = false; P.released = false;
    this.navEdges(nav);
    this.state = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), jump, grab, pause, any, pointer: ptr };
    // edges against the raw previous poll: the game zeroes state/prev while a menu is open, which must not turn a
    // held key (Start that resumed, jump that confirmed) into a new press
    const R = this._raw;
    this.jumpPressed = jump && !R.jump;
    this.grabPressed = grab && !R.grab;
    this.pausePressed = pause && !R.pause;
    this.anyPressed = any && !R.any;
    this._raw = { jump, grab, pause, any };
    return this.state;
  }

  // nav edges with repeat: true on the press, then after 400 ms every 120 ms (confirm, back, tabs and pause never
  // repeat). They are kept apart from state/prev, which the game zeroes while a menu is open.
  navEdges(raw) {
    const now = performance.now();
    for (const k of NAV) {
      const t = this._navT[k];
      if (!raw[k]) { this._navT[k] = null; this.nav[k] = false; continue; }
      if (!t) { this._navT[k] = { next: now + 400 }; this.nav[k] = true; continue; }
      const rep = k === 'up' || k === 'down' || k === 'left' || k === 'right';
      this.nav[k] = rep && now >= t.next;
      if (this.nav[k]) t.next = now + 120;
    }
    return this.nav;
  }
  // a menu that opens in the middle of a press must not see that press as a new edge
  holdNav() { const now = performance.now(); for (const k of NAV) if (this._navT[k]) this._navT[k].next = now + 400; }

  // the scene pointer: left mouse or a touch on the canvas (not on the controls)
  _setupPointer() {
    const P = this._ptr;
    const onScene = (e) => e.target && e.target.tagName === 'CANVAS';
    const setPos = (e) => {
      const r = e.target && e.target.tagName === 'CANVAS' ? e.target.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth || 1, height: window.innerHeight || 1 };
      this.pointer.x = ((e.clientX - r.left) / Math.max(1, r.width)) * 2 - 1;
      this.pointer.y = -(((e.clientY - r.top) / Math.max(1, r.height)) * 2 - 1);
    };
    window.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') this.setDevice('touch');
      if (!onScene(e) || (e.pointerType === 'mouse' && e.button !== 0) || P.down) return;
      P.id = e.pointerId; P.down = true; P.pressed = true; this.pointer.kind = e.pointerType || 'mouse';
      setPos(e);
    });
    window.addEventListener('pointermove', (e) => { if (P.down && e.pointerId === P.id) setPos(e); else if (!P.down && e.pointerType === 'mouse' && onScene(e)) setPos(e); });
    const up = (e) => { if (P.down && e.pointerId === P.id) { P.down = false; P.released = true; P.id = null; } };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
  }
}
