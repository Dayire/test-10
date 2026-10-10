// One roving-focus layer over a stack of screens (FULL_GAME §7.5). Each screen declares its focusable items and
// remembers the last one; Input's nav edges (keyboard, pad) move and activate, the pointer focuses on hover and
// acts on click, touch acts on tap. Real DOM focus follows, so :focus-visible, screen readers and Tab agree.
// Hidden screens carry `hidden` and `inert`; showing and hiding animate opacity and transform only.
const OUT_MS = 420;

export class Screen {
  // opts: { el, items() → [elements], back(), modal (the screen under it stays visible), grid (left/right move too),
  //         onOpen(), onClose(), onNav(dir) → handled, tab(dir), initial() → element }
  constructor(ui, opts) {
    Object.assign(this, { modal: false, grid: false }, opts);
    this.ui = ui; this.last = null; this.isOpen = false;
    const el = this.el;
    el.classList.add('screen'); el.hidden = true; el.inert = true;
    // pointer: hover focuses, click acts (touch: tap acts)
    el.addEventListener('pointerover', (e) => {
      if (e.pointerType !== 'mouse' || !this.isOpen || this.ui.focus.top !== this) return;
      const it = e.target.closest?.('.item');
      if (it && el.contains(it) && it !== document.activeElement) this.ui.focus.set(it, { sound: true, scroll: false });
    });
    el.addEventListener('click', (e) => {
      const it = e.target.closest?.('.item');
      if (!it || !el.contains(it) || this.ui.focus.top !== this) return;
      if (e.target.closest('[data-step]')) return; // a stepper arrow handles itself
      e.preventDefault();
      this.ui.focus.set(it, { scroll: false });
      this.ui.focus.activate(it, e);
    });
  }
  list() { return (this.items?.() || [...this.el.querySelectorAll('.item')]).filter((e) => e && !e.hidden && e.offsetParent !== null); }
  show() {
    clearTimeout(this._t);
    const el = this.el;
    el.hidden = false; el.inert = false;
    el.classList.remove('out');
    void el.offsetWidth; // start the transition from the closed pose
    el.classList.add('in');
    this.isOpen = true;
  }
  hide(instant = false) {
    const el = this.el;
    this.isOpen = false;
    el.classList.remove('in');
    el.inert = true;
    if (instant) { el.hidden = true; el.classList.remove('out'); return; }
    el.classList.add('out');
    clearTimeout(this._t);
    this._t = setTimeout(() => { if (!this.isOpen) { el.hidden = true; el.classList.remove('out'); } }, OUT_MS);
  }
}

export class FocusManager {
  constructor(ui) { this.ui = ui; this.stack = []; this.current = null; }
  get top() { return this.stack[this.stack.length - 1] || null; }
  has(s) { return this.stack.includes(s); }

  open(s, { focus = null, sound = true } = {}) {
    if (!s) return;
    const prev = this.top;
    if (prev === s) { if (focus) this.set(focus); return; }
    if (this.has(s)) { while (this.top !== s) this.close(this.top, { sound: false }); return; }
    if (prev) { prev.last = this.current; if (!s.modal) prev.hide(); else prev.el.inert = true; }
    this.stack.push(s);
    s.show();
    s.onOpen?.();
    this.ui.input?.holdNav?.();
    this.set(focus || s.initial?.() || s.last || s.list()[0], { scroll: true });
    if (sound) this.ui.sound('open');
    this.ui.menuChanged();
  }
  close(s = this.top, { sound = true, instant = false } = {}) {
    if (!s || !this.has(s)) return;
    // closing a screen closes what is open above it
    while (this.top !== s) this.close(this.top, { sound: false, instant });
    this.stack.pop();
    s.last = this.current;
    s.hide(instant);
    s.onClose?.();
    const t = this.top;
    if (t) {
      if (!t.isOpen) t.show(); else t.el.inert = false;
      this.set(t.last && t.el.contains(t.last) ? t.last : t.initial?.() || t.list()[0], { scroll: true });
    } else { this.current = null; if (document.activeElement && this.ui.root.contains(document.activeElement)) document.activeElement.blur(); }
    if (sound) this.ui.sound('close');
    this.ui.menuChanged();
  }
  closeAll(opts) { while (this.top) this.close(this.top, { sound: false, ...opts }); }

  set(el, { sound = false, scroll = true } = {}) {
    if (!el) return;
    const prev = this.current;
    if (prev && prev !== el) prev.classList.remove('focused');
    this.current = el;
    el.classList.add('focused');
    if (document.activeElement !== el) { try { el.focus({ preventScroll: true }); } catch { el.focus(); } }
    if (scroll) el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    if (sound && prev !== el) this.ui.sound('hover');
  }
  move(d) {
    const s = this.top; if (!s) return;
    const L = s.list(); if (!L.length) return;
    let i = L.indexOf(this.current);
    if (i < 0) { this.set(L[0], { sound: true }); return; }
    // stop at the ends (inactive items stay reachable: they say why they are inactive)
    const j = i + d;
    if (j >= 0 && j < L.length) this.set(L[j], { sound: true });
  }
  activate(el = this.current, e = null) {
    if (!el) return;
    if (el.classList.contains('off')) { this.ui.sound('back'); return; }
    if (el._act) { el._act(e); return; }
    if (el._adjust) el._adjust(1, true);
  }

  // nav edges from Input.poll(): {up, down, left, right, confirm, back, prev, next}
  update(nav) {
    const s = this.top;
    if (!s || !s.isOpen) return;
    const cur = this.current && s.el.contains(this.current) ? this.current : null;
    if (!cur) { const first = s.initial?.() || s.list()[0]; if (first) this.set(first); }
    const dirs = [['up', 0, -1], ['down', 0, 1], ['left', -1, 0], ['right', 1, 0]];
    for (const [k, dx, dy] of dirs) {
      if (!nav[k]) continue;
      if (s.onNav?.(k, this.current)) continue;
      if (dx && this.current?._adjust) { this.current._adjust(dx); continue; }
      if (dy) this.move(dy);
      else if (s.grid) this.move(dx);
    }
    if (nav.prev) s.tab?.(-1);
    if (nav.next) s.tab?.(1);
    if (nav.confirm) this.activate();
    if (nav.back) { if (s.back) s.back(); else this.close(s); }
  }
}

// a focusable row: act() on confirm / click, adjust(dir) on left / right
export function item(el, { act, adjust, label } = {}) {
  el.classList.add('item');
  if (!el.hasAttribute('tabindex') && el.tagName !== 'BUTTON') el.tabIndex = -1;
  if (el.tagName === 'BUTTON') el.type = 'button';
  if (act) el._act = act;
  if (adjust) el._adjust = adjust;
  if (label) el.setAttribute('aria-label', label);
  return el;
}
