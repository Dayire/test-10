import * as THREE from 'three';
import { icon, key, padButton, stick } from './glyphs.js';

// Wordless onboarding (FULL_GAME §7.6). Chapters declare L.hints = [{x0, x1, y0?, y1?, after, glyph, unless(game)}];
// when the boy stays in a zone past `after` seconds and `unless` is false, a glyph for the device in hand pulses
// above him (a keycap, a pad button, a ghost thumb on the control) and fades once the action happens. Seen hints
// go to the save (setting: always / first time / never). Also the visual sound cues: edge glyphs for the horn,
// shouts, darts and the drum, on the side the sound came from.
const DONE = {
  move: (g, h) => Math.abs(g.player.x - h.x0) > 1.5,
  jump: (g) => g.player.state === 'air' || g.input.jumpPressed,
  grab: (g) => !!(g.player.grip || g.player.lever || g.input.state.grab),
  up: (g) => g.input.state.y > 0.6,
  down: (g) => g.input.state.y < -0.6 || g.player.crawling,
  crawl: (g) => g.player.crawling,
  tilt: (g) => Math.abs(g.input.state.y) > 0.6 || !!g.input.pointer?.active,
  crank: (g) => Math.abs(g.input.state.y) > 0.6 || !!g.input.pointer?.active,
  aim: (g) => !!g.input.pointer?.active,
  turn: (g) => Math.abs(g.input.state.x) > 0.5 || !!g.input.pointer?.active,
};
// the verbs every chapter leans on, taught where the boy meets them (any chapter; a chapter's own L.hints come
// first): a vine's foot, a ledge he hangs from, a crate or a lever at hand, something he walks into that a jump
// clears. `when` must hold for `after` seconds; the glyph stays while `keep` (else `when`) holds, with a second's
// grace, and fades once the action happens. Puzzle-honest: a wall too high for a jump never shows the jump.
const P_W = 0.34, STEP = 0.26, HOP = 0.92, REACH = 2.54; // width; kerb step; a jump's rise; a ledge a jump reaches
function jumpable(p) {
  const b = p.body, dir = p.facing || 1, front = b.x + dir * P_W / 2;
  if (!p.phys?.colliders) return false;
  for (const c of p.phys.colliders(b)) {
    if (c.oneWay) continue;
    const near = dir > 0 ? c.x0 - front : front - c.x1;
    if (near < -0.06 || near > 0.3 || c.y0 > b.y + 0.5 || c.y1 <= b.y + STEP) continue;
    const rel = c.y1 - b.y;
    if (rel <= HOP || ((dir > 0 ? c.ledgeL : c.ledgeR) && rel <= REACH)) return true;
  }
  return false;
}
const free = (g, p) => p.state === 'ground' && !p.grip && !p.lever && !p.dead;
const CONTEXT = [
  { id: 'ctx:climb', glyph: 'up', after: 0.8, when: (g, p) => free(g, p) && !!p.nearVine?.() },
  { id: 'ctx:ledge', glyph: 'up', after: 1.2, when: (g, p) => p.state === 'hang' },
  { id: 'ctx:grab', glyph: 'grab', after: 1.4, when: (g, p) => free(g, p) && !p.crawling && !!(p.crateAdjacent?.(p.facing) || p.crateAdjacent?.(-p.facing) || g.interactNear?.(p.x, p.y, p.facing)) },
  // shown once he has pushed against it a moment (0.01: a crate that will not move); it stays while he faces it
  { id: 'ctx:jump', glyph: 'jump', after: 0.7, when: (g, p) => free(g, p) && !p.crawling && Math.abs(g.input.state.x) > 0.5 && Math.sign(g.input.state.x) === p.facing && (Math.abs(p.body.vx) < 0.05 || p.pushing === 0.01) && jumpable(p), keep: (g, p) => free(g, p) && !p.crawling && jumpable(p) },
  // Sunwork (L): a gripped mirror tilts (on touch: the finger aims it), a crank steps its tray, the capstan turns;
  // a desktop player who has tilted with the keys is shown the mouse once
  { id: 'ctx:tilt', glyph: 'tilt', after: 1.2, when: (g, p) => !!p.grip?.mirror && !p.dead },
  { id: 'ctx:crank', glyph: 'crank', after: 1.0, when: (g, p) => p.state === 'crank' },
  { id: 'ctx:turn', glyph: 'turn', after: 1.0, when: (g, p) => p.state === 'capstan' },
  { id: 'ctx:aim', glyph: 'aim', after: 2.5, when: (g, p) => g.input.lastDevice === 'keyboard' && !!(p.grip?.mirror || p.state === 'crank') && !!g.ui?.hints?.seen('ctx:tilt') },
];
const CUES = { alarm: 'horn', horn: 'horn', shout: 'shout', guardFrustrated: 'shout', dart: 'dart', turret: 'dart', dartGuard: 'dart', drum: 'drum' };

export class HintDirector {
  constructor(ui) {
    this.ui = ui; this.game = null;
    this.mode = 'first'; this.soundCues = false;
    this.el = ui.root.querySelector('#hints');
    this.zoneT = new Map(); this.ctxT = new Map(); this.active = null; this.cueT = { l: 0, r: 0 };
    this.devSeen = new Set(); // hints learnt in a dev chapter (the lab): remembered in memory, never saved
    this._v = new THREE.Vector3();
  }
  attach(game) {
    this.game = game;
    game.events.on('chapterStart', () => { this.zoneT.clear(); this.ctxT.clear(); this.hide(); });
    game.events.on('death', () => this.hide());
  }
  seen(id) { return !!this.ui.save?.data?.seenHints?.[id] || this.devSeen.has(id); }

  // game.hooks.hint('controls'): the first steps of a journey
  request(id) {
    if (id !== 'controls' || this.mode === 'never') return;
    if (this.mode === 'first' && this.seen('move')) return;
    const g = this.game;
    this.show({ id: 'move', glyph: 'move', x0: g.player.x, after: 0 }, 0.6);
  }

  glyphHtml(glyph) {
    const I = this.ui.input, dev = I?.lastDevice || 'keyboard', kind = I?.pad?.kind || 'xbox', kl = I?.keyLabels;
    if (dev === 'touch') {
      const t = (cls, extra = '') => `<span class="ghost ${cls}">${icon('thumb', 'thumb')}${extra}</span>`;
      return {
        move: t('lr', icon('arrowLR', 'arr')), jump: t('tap'), grab: t('tap'), up: t('up', icon('arrowUp', 'arr')), down: t('down', icon('arrowDown', 'arr')),
        crawl: t('down', icon('arrowDown', 'arr')), tilt: t('aim', icon('sun', 'arr')), crank: t('aim', icon('sun', 'arr')), aim: t('aim', icon('sun', 'arr')), turn: t('aim', icon('sun', 'arr')),
      }[glyph] || '';
    }
    if (dev === 'gamepad') {
      return { move: stick('lr'), jump: padButton(kind, 'bottom'), grab: padButton(kind, 'left'), up: stick('up'), down: stick('down'), crawl: stick('down'), tilt: stick('ud'), crank: stick('ud'), aim: stick('ud'), turn: stick('lr') }[glyph] || '';
    }
    return {
      move: `${key(kl?.left || '←')}${key(kl?.right || '→')}`, jump: key('space', true), grab: key('shift', true), up: key('↑'), down: key('↓'), crawl: key('↓'),
      tilt: `${key('↑')}${key('↓')}`, crank: `${key('↑')}${key('↓')}`, aim: icon('mouse', 'mouse'), turn: `${key(kl?.left || '←')}${key(kl?.right || '→')}`,
    }[glyph] || '';
  }

  show(h, delay = 0) {
    this.active = { ...h, t: 0, delay, out: false };
    const el = this.el;
    el.innerHTML = `<div class="hint" data-glyph="${h.glyph}">${this.glyphHtml(h.glyph)}</div>`;
    el.firstChild.style.opacity = '0';
    // on touch the control itself pulses too
    this.ui.touch?.pulse(h.glyph);
  }
  hide() {
    if (!this.active) return;
    const h = this.active; this.active = null;
    const n = this.el.firstChild;
    if (n) { n.classList.add('out'); setTimeout(() => { if (n.parentNode && !this.active) n.remove(); }, 700); }
    this.ui.touch?.pulse(null);
    return h;
  }
  hideAll() { this.hide(); }
  done(h) {
    this.hide();
    const g = this.game, mark = (id) => (g.saving ? g.save?.seenHint?.(id) : this.devSeen.add(id)); // dev chapters never write the save
    if (h.id) mark(h.id);
    // a verb learnt from a chapter's zone is not taught again from context
    for (const c of CONTEXT) if (c.glyph === h.glyph && c.id !== h.id) mark(c.id);
  }

  update(dt) {
    const g = this.game;
    this.updateCues(dt);
    if (!g || !g.level) return;
    const playing = g.mode === 'play' && !g.paused && !g.menuOpen;
    const h = this.active;
    if (h) {
      if (!playing) {
        // a pause or a menu holds the glyph out of sight; leaving play ends it
        if (g.mode !== 'play') this.hide(); else if (this.el.firstChild) this.el.firstChild.style.opacity = '0';
        return;
      }
      h.t += dt;
      if (DONE[h.glyph]?.(g, h)) { this.done(h); return; }
      const keep = h.keep || h.when;
      if (keep) h.off = keep(g, g.player) ? 0 : (h.off || 0) + dt;
      const zoneOK = h.glyph === 'move' || (keep ? h.off < 1 : this.inZone(h) && !h.unless?.(g));
      if (!zoneOK || h.t > 14) { this.hide(); return; }
      this.place(h);
      return;
    }
    if (!playing || this.mode === 'never') return;
    const L = g.level.hints || [], pending = new Set();
    for (let i = 0; i < L.length; i++) {
      const z = L[i], id = `${g.chapterId}:${i}`;
      if (this.mode === 'first' && this.seen(id)) continue;
      if (!this.inZone(z)) { this.zoneT.delete(i); continue; }
      const t = (this.zoneT.get(i) || 0) + dt;
      this.zoneT.set(i, t);
      if (z.unless?.(g)) continue;
      if (t >= (z.after ?? 0)) { this.show({ ...z, id }); this.zoneT.delete(i); return; }
      pending.add(z.glyph);
    }
    // a chapter's zone comes first: the same verb is not taught from context while its zone counts down
    for (const c of CONTEXT) {
      if (pending.has(c.glyph) || (this.mode === 'first' && this.seen(c.id))) continue;
      if (!c.when(g, g.player)) { this.ctxT.delete(c.id); continue; }
      const t = (this.ctxT.get(c.id) || 0) + dt;
      this.ctxT.set(c.id, t);
      if (t >= c.after) { this.show({ ...c, x0: g.player.x }); this.ctxT.delete(c.id); return; }
    }
  }
  inZone(z) {
    const p = this.game.player;
    return p.x >= z.x0 && p.x <= z.x1 && (z.y0 === undefined || p.y >= z.y0) && (z.y1 === undefined || p.y <= z.y1);
  }
  // above the boy's head, projected through the live camera (lens shift included)
  place(h) {
    const g = this.game, n = this.el.firstChild;
    if (!n) return;
    const v = this._v.set(g.player.x, g.player.y + (g.player.crawling ? 1.15 : 1.75), g.player.z || 0).project(g.camera);
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const a = Math.min(1, Math.max(0, (h.t - (h.delay || 0)) / 0.45));
    n.style.transform = `translate3d(${x.toFixed(1)}px, ${(y - 18).toFixed(1)}px, 0) translate(-50%, -100%)`;
    n.style.opacity = String(a);
  }

  // visual sound cues: a glyph on the screen edge the sound came from
  cue(name, x) {
    if (!this.soundCues || !this.game) return;
    const k = CUES[name]; if (!k) return;
    const side = Number.isFinite(x) && x < (this.game.camRig?.curLook?.x ?? this.game.player.x) ? 'l' : 'r';
    const el = this.ui.root.querySelector(`#cues .cue.${side}`);
    el.innerHTML = icon(k);
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    this.cueT[side] = 1.6;
  }
  updateCues(dt) {
    for (const s of ['l', 'r']) if (this.cueT[s] > 0) { this.cueT[s] -= dt; if (this.cueT[s] <= 0) this.ui.root.querySelector(`#cues .cue.${s}`)?.classList.remove('on'); }
  }
}
