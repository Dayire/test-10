import { Screen, item } from './focus.js';
import { icon, STAR, ROSETTE, key, padButton, padLabel, stick, star8 } from './glyphs.js';
import { PLAYABLE } from '../chapters/index.js';

// Settings (FULL_GAME §7.4): graphics, audio, controls, accessibility, and the save data. Every option applies
// live through game.applySettings (the engine's, the renderer's, the mixer's and Input's keys) and persists as
// chosen; `auto` values (the camera distance) resolve per device and orientation.
export function defaultSettings(dev = null) {
  const touch = !!dev && dev.name !== 'desktop';
  return {
    quality: 'auto', renderScale: 100, dynres: true, fpsCap: touch ? 60 : 'display', batterySaver: false, dof: true, grain: 60,
    motionBlur: false, brightness: 0, cameraDist: 'auto',
    volumes: { master: 10, music: 10, sfx: 10, amb: 10, ui: 10, muteInBackground: true, mono: false, reducedRange: false },
    touchStick: 'floating', touchSize: 'M', touchOpacity: 45, leftHanded: false, grabMode: 'hold', crawlMode: 'hold',
    invertTilt: false, aimSnap: true, vibration: 'low', hints: 'first',
    shake: 100, reduceMotion: false, reduceFlashing: false, highContrast: false, soundCues: false, generous: false, assist: false,
    timeScale: 100, menuScale: 100,
  };
}
// what the engine receives: the camera's `auto` becomes close on portrait phones, normal elsewhere
export function resolveSettings(patch, ui) {
  const out = { ...patch };
  if (out.cameraDist === 'auto') out.cameraDist = ui?.touch && innerHeight > innerWidth ? 'close' : 'normal';
  if (out.timeScale !== undefined) out.timeScale = +out.timeScale / 100 || 1;
  return out;
}

const fsOK = () => { try { return !!document.fullscreenEnabled; } catch { return false; } };
const isTouch = (ui) => !!ui.touch;

// rows: {k, label, type: choice | slider | toggle | action | info, ...}
function tabs(ui) {
  return [
    { id: 'graphics', label: 'graphics', rows: [
      { k: 'quality', label: 'quality', type: 'choice', values: ['auto', 'low', 'medium', 'high', 'ultra'] },
      { k: 'renderScale', label: 'render scale', type: 'slider', min: 50, max: 100, step: 5, unit: '%' },
      { k: 'dynres', label: 'dynamic resolution', type: 'toggle' },
      { k: 'fpsCap', label: 'frame cap', type: 'choice', values: [30, 60, 'display'] },
      { k: 'batterySaver', label: 'battery saver', type: 'toggle' },
      { k: 'dof', label: 'depth of field', type: 'toggle' },
      { k: 'grain', label: 'film grain', type: 'slider', min: 0, max: 100, step: 5 },
      { k: 'motionBlur', label: 'motion blur', type: 'toggle', enabled: (S) => S.quality === 'ultra' },
      { k: 'brightness', label: 'brightness', type: 'slider', min: -3, max: 3, step: 1, signed: true, calib: true },
      { k: 'cameraDist', label: 'camera', type: 'choice', values: ['auto', 'close', 'normal', 'wide'] },
      ...(fsOK() ? [{ k: 'fullscreen', label: 'fullscreen', type: 'toggle', get: () => !!document.fullscreenElement, set: (on) => ui.setFullscreen(on) }] : []),
    ] },
    { id: 'audio', label: 'audio', rows: [
      { k: 'volumes.master', label: 'master', type: 'slider', min: 0, max: 10, step: 1 },
      { k: 'volumes.music', label: 'music', type: 'slider', min: 0, max: 10, step: 1 },
      { k: 'volumes.sfx', label: 'effects', type: 'slider', min: 0, max: 10, step: 1 },
      { k: 'volumes.amb', label: 'ambience', type: 'slider', min: 0, max: 10, step: 1 },
      { k: 'volumes.muteInBackground', label: 'mute in background', type: 'toggle' },
      { k: 'volumes.mono', label: 'mono', type: 'toggle' },
      { k: 'volumes.reducedRange', label: 'reduced dynamic range', type: 'toggle' },
    ] },
    { id: 'controls', label: 'controls', rows: [
      ...(isTouch(ui) ? [
        { k: 'touchStick', label: 'touch stick', type: 'choice', values: ['floating', 'fixed'] },
        { k: 'touchSize', label: 'touch size', type: 'choice', values: ['S', 'M', 'L'] },
        { k: 'touchOpacity', label: 'touch opacity', type: 'slider', min: 20, max: 80, step: 5, unit: '%' },
        { k: 'leftHanded', label: 'left-handed', type: 'toggle' },
      ] : []),
      { k: 'grabMode', label: 'grab', type: 'choice', values: ['hold', 'toggle'] },
      { k: 'crawlMode', label: 'crawl', type: 'choice', values: ['hold', 'toggle'] },
      { k: 'invertTilt', label: 'invert tilt', type: 'toggle' },
      { k: 'aimSnap', label: 'aim snap', type: 'toggle' },
      { k: 'vibration', label: 'vibration', type: 'choice', values: ['off', 'low', 'full'] },
      { k: 'hints', label: 'control hints', type: 'choice', values: ['always', 'first', 'never'], labels: { first: 'first time' } },
      { k: 'keys', label: 'keys', type: 'info' },
    ] },
    { id: 'access', label: 'accessibility', rows: [
      { k: 'shake', label: 'camera shake', type: 'slider', min: 0, max: 100, step: 10, unit: '%' },
      { k: 'reduceMotion', label: 'reduce motion', type: 'toggle' },
      { k: 'reduceFlashing', label: 'reduce flashing', type: 'toggle' },
      { k: 'highContrast', label: 'high contrast', type: 'toggle' },
      { k: 'soundCues', label: 'visual sound cues', type: 'toggle' },
      { k: 'generous', label: 'generous timing', type: 'toggle' },
      { k: 'assist', label: 'assist', type: 'toggle' },
      { k: 'timeScale', label: 'game speed', type: 'choice', values: [100, 85, 70], unit: '%' },
      { k: 'menuScale', label: 'menu text size', type: 'choice', values: [100, 125, 150], unit: '%' },
    ] },
    { id: 'data', label: 'data', rows: [
      { k: 'store', label: 'progress', type: 'info' },
      { k: 'export', label: 'save code', type: 'action', text: 'copy', act: () => ui.settings.exportCode() },
      { k: 'import', label: 'enter a save code', type: 'action', text: 'enter', act: () => ui.settings.importCode() },
      { k: 'reset', label: 'reset progress', type: 'action', text: 'reset', act: () => ui.confirm({ glyph: 'linkBroken', text: 'forget every chapter reached?', yes: () => ui.settings.resetProgress() }) },
    ] },
  ];
}

const getK = (S, k) => (k.includes('.') ? k.split('.').reduce((o, p) => o?.[p], S) : S[k]);

export class SettingsScreen {
  constructor(ui) {
    this.ui = ui;
    const el = this.el = document.createElement('section');
    el.id = 'settings'; el.className = 'panel-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'settings');
    el.innerHTML = `<div class="sheet"><header><div class="eyebrow"><svg viewBox="0 0 100 100">${STAR}</svg>settings</div><div class="tabs" role="tablist"></div><div class="tabline"><i></i></div></header><div class="rows" role="tabpanel"></div><div class="sbar" aria-hidden="true"><i></i></div><div class="calib hidden" aria-hidden="true"></div><div class="code hidden"><input type="text" spellcheck="false" autocomplete="off" aria-label="save code"><div class="cmsg"></div></div><footer class="legend"></footer></div>`;
    ui.menus.appendChild(el);
    this.tab = 0;
    this.screen = new Screen(ui, {
      el,
      items: () => [...el.querySelectorAll('.tab.item'), ...el.querySelectorAll('.rows .item')].filter((e) => !e.hidden),
      tab: (d) => this.setTab(this.tab + d, true),
      initial: () => el.querySelector('.tab.active'),
      back: () => { if (!el.querySelector('.code').classList.contains('hidden')) { this.closeCode(); return; } ui.focus.close(this.screen); },
      onOpen: () => this.render(),
      onClose: () => this.closeCode(true),
      // the tabs are one row: down leaves it for the first option, up from the first option returns to the active tab
      onNav: (dir, cur) => {
        const isTab = cur?.classList.contains('tab');
        if (isTab && dir === 'down') { const r = el.querySelector('.rows .item'); if (r) { this.ui.focus.set(r, { sound: true }); } return true; }
        if (isTab && dir === 'up') return true;
        if (!isTab && dir === 'up' && cur === el.querySelector('.rows .item')) { this.ui.focus.set(el.querySelector('.tab.active'), { sound: true }); return true; }
        return false;
      },
    });
    // a list that runs on past its edge fades there (the scrollbar stays hidden); a tab strip that scrolls (short
    // landscape screens, large menu text) carries its underline along
    this.rowsEl = el.querySelector('.rows');
    this.rowsEl.addEventListener('scroll', () => this.edges(), { passive: true });
    el.querySelector('.tabs').addEventListener('scroll', () => this.line(), { passive: true });
    window.addEventListener('resize', () => { if (this.isOpen) { this.edges(); this.line(); } });
    el.addEventListener('focusin', () => this.syncCalib());
    el.addEventListener('pointerover', () => queueMicrotask(() => this.syncCalib()));
    const inp = el.querySelector('.code input');
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); this.applyCode(inp.value); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeCode(); }
    });
    document.addEventListener('fullscreenchange', () => this.isOpen && this.render(true));
  }
  get isOpen() { return this.ui.focus.has(this.screen); }
  open() { this.list = tabs(this.ui); this.ui.focus.open(this.screen); }

  setTab(i, sound = false) {
    const n = this.list.length;
    this.tab = ((i % n) + n) % n;
    this.render();
    const t = this.el.querySelectorAll('.tab')[this.tab];
    this.ui.focus.set(t);
    if (sound) this.ui.sound('hover');
  }

  render(keepFocus = false) {
    const ui = this.ui, el = this.el, S = ui.S;
    this.list ||= tabs(ui);
    const T = el.querySelector('.tabs');
    const focusK = keepFocus ? ui.focus.current?.dataset.k : null;
    T.innerHTML = '';
    this.list.forEach((t, i) => {
      const b = document.createElement('button');
      b.className = `tab${i === this.tab ? ' active' : ''}`; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(i === this.tab));
      b.textContent = t.label;
      item(b, { act: () => this.setTab(i, true), adjust: (d) => this.setTab(this.tab + d, true) });
      T.appendChild(b);
    });
    requestAnimationFrame(() => { this.line(); this.edges(); });
    const R = this.rowsEl;
    R.innerHTML = '';
    R.dataset.tab = this.list[this.tab].id;
    this.list[this.tab].rows.forEach((row, i) => R.appendChild(this.row(row, S, i)));
    // a tab (or the screen) opens at its first option; a redraw of the same tab keeps its place
    if (!keepFocus) R.scrollTop = 0;
    el.querySelector('.legend').innerHTML = this.legend();
    if (focusK) { const f = R.querySelector(`[data-k="${focusK}"]`); if (f) ui.focus.set(f, { scroll: false }); }
    this.edges();
    this.syncCalib();
  }
  // the brass underline slides under the active tab (transform only)
  line() {
    const T = this.el.querySelector('.tabs'), a = T.querySelector('.active'), line = this.el.querySelector('.tabline i');
    if (!a || !line) return;
    const r0 = this.el.querySelector('.tabline').getBoundingClientRect(), r = a.getBoundingClientRect();
    line.style.transform = `translateX(${r.left - r0.left}px) scaleX(${Math.max(1, r.width) / 100})`;
  }
  // a list longer than its view fades at the edge it runs on past and shows a brass hairline track at its side
  edges() {
    const R = this.rowsEl, max = R.scrollHeight - R.clientHeight, bar = this.el.querySelector('.sbar'), on = max > 2;
    R.classList.toggle('above', R.scrollTop > 2);
    R.classList.toggle('below', R.scrollTop < max - 2);
    bar.classList.toggle('on', on);
    if (!on) return;
    const h = R.clientHeight, th = Math.max(28, (h * h) / R.scrollHeight);
    bar.style.top = `${R.offsetTop}px`; bar.style.height = `${h}px`; bar.style.setProperty('--th', `${th.toFixed(1)}px`);
    bar.firstChild.style.transform = `translate3d(0, ${(((h - th) * R.scrollTop) / max).toFixed(1)}px, 0)`;
  }

  legend() {
    const d = this.ui.input?.lastDevice;
    if (d === 'gamepad') { const k = this.ui.input.pad?.kind || 'xbox'; return `<span><kbd class="key">${padLabel(k, 'lb')}</kbd><kbd class="key">${padLabel(k, 'rb')}</kbd><em>tabs</em></span><span>${padButton(k, 'right')}<em>back</em></span>`; }
    if (d === 'touch') return '';
    return `<span><kbd class="key">Q</kbd><kbd class="key">E</kbd><em>tabs</em></span><span><kbd class="key">←</kbd><kbd class="key">→</kbd><em>adjust</em></span><span><kbd class="key wide">esc</kbd><em>back</em></span>`;
  }

  row(r, S, i) {
    const ui = this.ui;
    const el = document.createElement('div');
    el.className = `row r-${r.type}`; el.dataset.k = r.k; el.style.setProperty('--i', i);
    const val = r.get ? r.get() : getK(S, r.k);
    const off = r.enabled && !r.enabled(S);
    el.innerHTML = `<span class="rl">${r.label}</span><span class="rc"></span>`;
    const rc = el.querySelector('.rc');
    const set = (v) => {
      if (r.set) r.set(v); else ui.setSetting(r.k, v);
      this.paint(el, r, ui.S);
      if (r.k === 'quality') this.render(true); // motion blur follows the tier
      if (r.k === 'menuScale' || r.k === 'touchStick') requestAnimationFrame(() => this.ui.focus.current?.scrollIntoView?.({ block: 'nearest' }));
    };
    if (r.type === 'choice') {
      rc.innerHTML = `<span class="choice"><i data-step="-1" aria-hidden="true">‹</i><b></b><i data-step="1" aria-hidden="true">›</i></span>`;
      const step = (d) => { const L = r.values, cur = L.indexOf(r.get ? r.get() : getK(ui.S, r.k)); const v = L[((cur < 0 ? 0 : cur) + d + L.length) % L.length]; set(v); ui.sound('slider', { value: L.indexOf(v) / Math.max(1, L.length - 1) }); };
      item(el, { act: () => step(1), adjust: step });
      el.setAttribute('role', 'button');
      rc.querySelectorAll('[data-step]').forEach((a) => a.addEventListener('click', (e) => { e.stopPropagation(); ui.focus.set(el, { scroll: false }); step(+a.dataset.step); }));
    } else if (r.type === 'slider') {
      rc.innerHTML = `<span class="slider"><span class="track"><span class="fill"></span><span class="knob"><svg viewBox="0 0 100 100">${STAR}</svg></span></span><b class="val"></b></span>`;
      const clamp = (v) => Math.max(r.min, Math.min(r.max, Math.round(v / r.step) * r.step));
      const adj = (d) => { const v = clamp((getK(ui.S, r.k) ?? r.min) + d * r.step); if (v !== getK(ui.S, r.k)) { set(v); ui.sound('slider', { value: (v - r.min) / (r.max - r.min) }); } };
      item(el, { adjust: adj, act: () => {} });
      el.setAttribute('role', 'slider'); el.setAttribute('aria-valuemin', r.min); el.setAttribute('aria-valuemax', r.max);
      // drag adjusts (pointer and touch)
      const tr = rc.querySelector('.track');
      const at = (e) => { const b = tr.getBoundingClientRect(); return clamp(r.min + ((e.clientX - b.left) / Math.max(1, b.width)) * (r.max - r.min)); };
      let drag = null;
      tr.addEventListener('pointerdown', (e) => { drag = e.pointerId; try { tr.setPointerCapture(e.pointerId); } catch { /* synthetic */ } ui.focus.set(el, { scroll: false }); const v = at(e); if (v !== getK(ui.S, r.k)) set(v); e.preventDefault(); e.stopPropagation(); });
      tr.addEventListener('pointermove', (e) => { if (drag !== e.pointerId) return; const v = at(e); if (v !== getK(ui.S, r.k)) { set(v); ui.sound('slider', { value: (v - r.min) / (r.max - r.min) }); } });
      const end = (e) => { if (drag === e.pointerId) drag = null; };
      tr.addEventListener('pointerup', end); tr.addEventListener('pointercancel', end);
      tr.addEventListener('click', (e) => e.stopPropagation());
    } else if (r.type === 'toggle') {
      rc.innerHTML = `<span class="toggle"><span class="pill"><span class="dot"></span></span><b></b></span>`;
      const flip = () => { const v = !(r.get ? r.get() : getK(ui.S, r.k)); set(v); ui.sound('toggle', { on: v }); };
      item(el, { act: flip, adjust: () => flip() });
      el.setAttribute('role', 'switch');
    } else if (r.type === 'action') {
      rc.innerHTML = `<span class="act">${r.text}<i>›</i></span>`;
      item(el, { act: () => { ui.sound('confirm'); r.act(); } });
      el.setAttribute('role', 'button');
    } else if (r.type === 'info') {
      rc.innerHTML = r.k === 'keys' ? this.keysHtml() : this.storeHtml();
      item(el, {});
    }
    if (off) { el.classList.add('off'); el.setAttribute('aria-disabled', 'true'); }
    el.setAttribute('aria-label', r.label);
    this.paint(el, r, S, val);
    return el;
  }

  paint(el, r, S, v = r.get ? r.get() : getK(S, r.k)) {
    const fmt = (x) => (r.labels?.[x] ?? (x === 'display' ? 'display' : `${x}${r.unit && typeof x === 'number' ? r.unit : ''}`));
    if (r.type === 'choice') { el.querySelector('b').textContent = fmt(v); el.setAttribute('aria-valuetext', String(fmt(v))); }
    else if (r.type === 'slider') {
      const t = (v - r.min) / (r.max - r.min);
      el.style.setProperty('--t', t.toFixed(3));
      el.querySelector('.val').textContent = r.signed && v > 0 ? `+${v}` : `${v}${r.unit || ''}`;
      el.setAttribute('aria-valuenow', v);
    } else if (r.type === 'toggle') { el.classList.toggle('on', !!v); el.querySelector('b').textContent = v ? 'on' : 'off'; el.setAttribute('aria-checked', String(!!v)); }
    if (r.calib) this.syncCalib();
  }

  // the brightness calibration rosettes: three greys near black lifted as the grade lifts them
  syncCalib() {
    const c = this.el.querySelector('.calib');
    const on = this.ui.focus.current?.dataset.k === 'brightness' && this.isOpen;
    c.classList.toggle('hidden', !on);
    if (!on) return;
    const b = +this.ui.S.brightness || 0, exp = 1 + 0.08 * b, gam = 1 - 0.04 * b;
    const tone = (lin) => { const v = Math.pow(Math.min(1, lin * exp), gam); const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; return Math.round(s * 255); };
    const ros = (lin) => { const g = tone(lin); return `<svg viewBox="0 0 100 100" style="color:rgb(${g},${Math.round(g * 0.94)},${Math.round(g * 0.86)})"><path d="${star8(50, 50, 44)}"/><path d="${star8(50, 50, 30, 22.5)}"/></svg>`; };
    c.innerHTML = `<div class="cr">${ros(0.0045)}${ros(0.012)}${ros(0.03)}</div><p>the faint rosette should be barely visible</p>`;
  }

  keysHtml() {
    const kb = this.ui.input?.keyLabels, kind = this.ui.input?.pad?.kind || 'xbox';
    const L = kb ? `${kb.left} ${kb.right}` : 'A D';
    const pad = !!this.ui.input?.pad;
    const rows = [
      ['move', `${key('←')}${key('→')}<small>${L}</small>`, stick('lr')],
      ['climb · crawl', `${key('↑')}${key('↓')}`, stick('ud')],
      ['jump', key('space', true), padButton(kind, 'bottom')],
      ['grab', key('shift', true), `${padButton(kind, 'left')}<small>${padLabel(kind, 'rt')}</small>`],
      ['tilt · aim', `${key('↑')}${key('↓')}<small>mouse</small>`, stick('ud')],
      ['pause', key('esc', true), `<kbd class="key wide">${padLabel(kind, 'start')}</kbd>`],
    ];
    return `<table class="keys"><tbody>${rows.map(([a, k, p]) => `<tr><th>${a}</th><td>${k}</td>${pad ? `<td>${p}</td>` : ''}</tr>`).join('')}</tbody></table>`;
  }
  storeHtml() {
    const st = this.ui.storage;
    if (st?.available) return `<span class="store ok">${icon('check')}<em>kept on this device</em></span>`;
    return `<span class="store">${icon('linkBroken')}<em>kept only until the page closes: use a save code</em></span>`;
  }

  // ------------------------------------------------------------------ save code (base64url, about 120 characters)
  exportCode() {
    const code = encodeSave(this.ui.save.data);
    this.openCode(code, true);
    const copied = () => this.msg('copied');
    try { navigator.clipboard?.writeText(code).then(copied, () => this.msg('select and copy')); } catch { this.msg('select and copy'); }
  }
  importCode() { this.openCode('', false); this.msg('paste a save code'); }
  openCode(text, ro) {
    const box = this.el.querySelector('.code'), inp = box.querySelector('input');
    box.classList.remove('hidden');
    inp.readOnly = ro; inp.value = text;
    inp.focus(); if (ro) inp.select();
  }
  closeCode(silent = false) {
    const box = this.el.querySelector('.code');
    if (box.classList.contains('hidden')) return;
    box.classList.add('hidden');
    if (!silent) this.ui.focus.set(this.ui.focus.current || this.screen.list()[0]);
  }
  msg(t) { this.el.querySelector('.cmsg').textContent = t; }
  applyCode(text) {
    const inp = this.el.querySelector('.code input');
    if (inp.readOnly) { this.closeCode(); return; }
    const d = decodeSave(text);
    if (!d) { this.msg('that code does not open'); this.ui.sound('back'); return; }
    const save = this.ui.save;
    Object.assign(save.data, d);
    save.write();
    this.msg('opened'); this.ui.sound('confirm');
    this.ui.fillMain(); this.ui.chapters.refresh();
    setTimeout(() => { this.closeCode(); if (this.ui.game?.held) this.ui.game.toTitle().catch(() => {}); }, 600);
  }
  resetProgress() {
    this.ui.save.reset();
    this.ui.fillMain(); this.ui.chapters.refresh();
    if (this.ui.game?.held) this.ui.game.toTitle().catch(() => {});
  }
}

// progress only: chapter, checkpoint, the chapters reached and their furthest checkpoint, completion, play stats
export function encodeSave(d) {
  const ids = PLAYABLE.map((c) => c.id);
  const o = { v: 1, c: Math.max(0, ids.indexOf(d.chapter)), p: d.cp | 0, u: ids.map((id) => (d.unlocked?.includes(id) ? 1 : 0)).join(''), k: ids.map((id) => d.cps?.[id] | 0), d: d.completed ? 1 : 0, t: Math.round(d.stats?.playSec || 0), x: d.stats?.deaths | 0 };
  const json = JSON.stringify(o);
  const b = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  let h = 0; for (const ch of json) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `M1${(h % 1296).toString(36).padStart(2, '0')}${b}`;
}
export function decodeSave(code) {
  try {
    const s = String(code || '').trim();
    if (!/^M1[0-9a-z]{2}[A-Za-z0-9_-]+$/.test(s)) return null;
    const json = atob(s.slice(4).replace(/-/g, '+').replace(/_/g, '/'));
    let h = 0; for (const ch of json) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    if ((h % 1296).toString(36).padStart(2, '0') !== s.slice(2, 4)) return null;
    const o = JSON.parse(json), ids = PLAYABLE.map((c) => c.id);
    if (o.v !== 1 || !ids[o.c]) return null;
    const unlocked = ids.filter((_, i) => o.u[i] === '1');
    if (!unlocked.includes('souk')) unlocked.unshift('souk');
    const cps = Object.fromEntries(ids.map((id, i) => [id, Math.max(0, o.k[i] | 0)]).filter(([id]) => unlocked.includes(id)));
    return { chapter: ids[o.c], cp: Math.max(0, o.p | 0), unlocked, cps, completed: !!o.d, stats: { playSec: +o.t || 0, deaths: +o.x || 0, perChapter: {} } };
  } catch { return null; }
}
export { ROSETTE };
