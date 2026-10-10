// Unified input: keyboard (physical key codes, so WASD also works on AZERTY),
// gamepad (standard mapping) and on-screen touch controls. poll() also
// reports the scene pointer (left mouse or a touch on the canvas, in NDC) and
// menu navigation edges with key repeat (400 ms, then every 120 ms).
const NAV = ['up', 'down', 'left', 'right', 'confirm', 'back'];
export class Input {
  constructor() {
    this.keys = new Set();
    this.state = { x: 0, y: 0, jump: false, grab: false, pause: false, any: false };
    this.prev = { ...this.state };
    this.jumpPressed = false; this.grabPressed = false; this.pausePressed = false; this.anyPressed = false;
    this.override = null; // scripted input for tests / cutscenes
    this.touch = { x: 0, y: 0, jump: false, grab: false };
    this.lastDevice = 'keyboard';
    this.pointer = { x: 0, y: 0, active: false, pressed: false, released: false, kind: 'mouse' };
    this._ptr = { id: null, down: false, pressed: false, released: false };
    this.nav = Object.fromEntries(NAV.map((k) => [k, false]));
    this._navT = {};
    this._setupPointer();
    window.addEventListener('keydown', (e) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code); this.lastDevice = 'keyboard';
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    this._setupTouch();
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

  k(...codes) { return codes.some((c) => this.keys.has(c)); }

  poll() {
    let x = 0, y = 0, jump = false, grab = false, pause = false;
    if (this.k('ArrowLeft', 'KeyA')) x -= 1;
    if (this.k('ArrowRight', 'KeyD')) x += 1;
    if (this.k('ArrowUp', 'KeyW')) y += 1;
    if (this.k('ArrowDown', 'KeyS')) y -= 1;
    if (this.k('Space', 'KeyK')) jump = true;
    if (this.k('ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyE', 'ControlLeft', 'ControlRight', 'KeyF')) grab = true;
    if (this.k('Escape', 'KeyP')) pause = true;
    const nav = { up: this.k('ArrowUp', 'KeyW'), down: this.k('ArrowDown', 'KeyS'), left: this.k('ArrowLeft', 'KeyA'), right: this.k('ArrowRight', 'KeyD'), confirm: this.k('Enter', 'NumpadEnter', 'Space'), back: this.k('Escape', 'Backspace') };
    let pads = [];
    try { pads = (navigator.getGamepads && navigator.getGamepads()) || []; } catch { pads = []; } // blocked by permissions policy in some frames
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const dz = 0.22;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      let gx = Math.abs(ax) > dz ? (ax - Math.sign(ax) * dz) / (1 - dz) : 0;
      let gy = Math.abs(ay) > dz ? -(ay - Math.sign(ay) * dz) / (1 - dz) : 0;
      if (b(14)) gx = -1; if (b(15)) gx = 1; if (b(12)) gy = 1; if (b(13)) gy = -1;
      if (gx || gy || b(0) || b(2) || b(1) || b(7)) this.lastDevice = 'gamepad';
      if (Math.abs(gx) > Math.abs(x)) x = gx;
      if (Math.abs(gy) > Math.abs(y)) y = gy;
      jump = jump || b(0) || b(3);
      grab = grab || b(2) || b(1) || b(7) || b(6) || b(5);
      pause = pause || b(9);
      nav.up ||= gy > 0.5; nav.down ||= gy < -0.5; nav.left ||= gx < -0.5; nav.right ||= gx > 0.5; nav.confirm ||= !!b(0); nav.back ||= !!b(1);
    }
    const t = this.touch;
    if (t.x) x = t.x; if (t.y) y = t.y; jump = jump || t.jump; grab = grab || t.grab;
    if (this.override) ({ x, y, jump, grab } = { x: 0, y: 0, jump: false, grab: false, ...this.override });
    this.prev = this.state;
    const any = !!(x || y || jump || grab || this.keys.size);
    const P = this._ptr, ptr = this.pointer;
    ptr.active = P.down; ptr.pressed = P.pressed; ptr.released = P.released; P.pressed = false; P.released = false;
    this.navEdges(nav);
    this.state = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), jump, grab, pause, any, pointer: ptr };
    this.jumpPressed = jump && !this.prev.jump;
    this.grabPressed = grab && !this.prev.grab;
    this.pausePressed = pause && !this.prev.pause;
    this.anyPressed = any && !this.prev.any;
    return this.state;
  }

  // nav edges with repeat: true on the press, then after 400 ms every 120 ms
  navEdges(raw) {
    const now = performance.now();
    for (const k of NAV) {
      const t = this._navT[k];
      if (!raw[k]) { this._navT[k] = null; this.nav[k] = false; continue; }
      if (!t) { this._navT[k] = { next: now + 400 }; this.nav[k] = true; continue; }
      this.nav[k] = now >= t.next;
      if (this.nav[k]) t.next = now + 120;
    }
    return this.nav;
  }

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
      if (!onScene(e) || (e.pointerType === 'mouse' && e.button !== 0)) return;
      P.id = e.pointerId; P.down = true; P.pressed = true; this.pointer.kind = e.pointerType || 'mouse';
      setPos(e);
    });
    window.addEventListener('pointermove', (e) => { if (P.down && e.pointerId === P.id) setPos(e); else if (!P.down && e.pointerType === 'mouse' && onScene(e)) setPos(e); });
    const up = (e) => { if (P.down && e.pointerId === P.id) { P.down = false; P.released = true; P.id = null; } };
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
    window.addEventListener('blur', () => { if (P.down) { P.down = false; P.released = true; P.id = null; } });
  }

  _setupTouch() {
    if (!('ontouchstart' in window) && !(navigator.maxTouchPoints > 0)) return;
    const root = document.createElement('div');
    root.id = 'touch';
    root.innerHTML = `<div class="tstick"><div class="tknob"></div></div><div class="tbtn tgrab">✋</div><div class="tbtn tjump">⤒</div>`;
    document.body.appendChild(root);
    const stick = root.querySelector('.tstick'), knob = root.querySelector('.tknob');
    let sid = null, cx = 0, cy = 0;
    stick.addEventListener('touchstart', (e) => { const t = e.changedTouches[0]; sid = t.identifier; const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2; e.preventDefault(); }, { passive: false });
    const move = (e) => {
      for (const t of e.changedTouches) if (t.identifier === sid) {
        const dx = (t.clientX - cx) / 50, dy = (t.clientY - cy) / 50;
        this.touch.x = Math.abs(dx) > 0.25 ? Math.max(-1, Math.min(1, dx)) : 0;
        this.touch.y = Math.abs(dy) > 0.45 ? -Math.max(-1, Math.min(1, dy)) : 0;
        knob.style.transform = `translate(${Math.max(-40, Math.min(40, dx * 50))}px, ${Math.max(-40, Math.min(40, dy * 50))}px)`;
      }
      e.preventDefault();
    };
    const end = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; this.touch.x = 0; this.touch.y = 0; knob.style.transform = ''; } };
    stick.addEventListener('touchmove', move, { passive: false });
    stick.addEventListener('touchend', end); stick.addEventListener('touchcancel', end);
    const btn = (sel, key) => {
      const el = root.querySelector(sel);
      el.addEventListener('touchstart', (e) => { this.touch[key] = true; e.preventDefault(); }, { passive: false });
      el.addEventListener('touchend', () => { this.touch[key] = false; });
      el.addEventListener('touchcancel', () => { this.touch[key] = false; });
    };
    btn('.tjump', 'jump'); btn('.tgrab', 'grab');
    this.lastDevice = 'touch';
  }
}
