import { Screen, item } from './focus.js';
import { timeGlyph, icon, STAR } from './glyphs.js';
import { PLAYABLE } from '../chapters/index.js';

// Chapter select (FULL_GAME §7.2): four arched cards with the numeral, the time-of-day glyph, a thumbnail
// (320 × 180 JPEG captured on first reaching the chapter, or the chapter's palette) and checkpoint pips:
// any reached checkpoint can be picked. Locked chapters are dark arches.
const CP_COUNT = { souk: 7, sundown: 11, night: 8, dawn: 7 }; // FULL_GAME §2–5; learned counts win
const ARCH = 'M0 1V0.42C0 0.2 0.22 0.05 0.5 0C0.78 0.05 1 0.2 1 0.42V1Z';

export function captureThumb(canvas) {
  try {
    const W = 320, H = 180, c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const sw = canvas.width, sh = canvas.height, s = Math.max(W / sw, H / sh);
    const w = W / s, h = H / s;
    x.drawImage(canvas, (sw - w) / 2, (sh - h) / 2, w, h, 0, 0, W, H);
    const px = x.getImageData(W / 2, H / 2, 1, 1).data;
    if (px[0] + px[1] + px[2] < 6) return null; // nothing drawn yet
    return c.toDataURL('image/jpeg', 0.7);
  } catch { return null; }
}

export class ChaptersScreen {
  constructor(ui) {
    this.ui = ui;
    const el = this.el = document.createElement('section');
    el.id = 'chapters'; el.className = 'panel-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'chapters');
    el.innerHTML = `<svg class="defs" width="0" height="0" aria-hidden="true"><clipPath id="arch" clipPathUnits="objectBoundingBox"><path d="${ARCH}"/></clipPath></svg><header><div class="eyebrow"><svg viewBox="0 0 100 100">${STAR}</svg>chapters</div></header><div class="cards"></div><footer class="legend"></footer>`;
    ui.menus.appendChild(el);
    this.picking = null; // the card whose checkpoints are being chosen
    this.screen = new Screen(ui, {
      el, grid: true,
      items: () => [...el.querySelectorAll('.ccard')],
      initial: () => el.querySelector('.ccard.current') || el.querySelector('.ccard:not(.locked)'),
      onOpen: () => this.render(),
      onClose: () => this.unpick(),
      onNav: (dir) => {
        const c = this.picking;
        if (!c) return false;
        if (dir === 'left' || dir === 'right') { this.pickStep(dir === 'left' ? -1 : 1); return true; }
        if (dir === 'up') { this.unpick(); return true; }
        return true;
      },
      back: () => { if (this.picking) { this.unpick(); ui.sound('back'); } else ui.focus.close(this.screen); },
    });
  }
  refresh() { if (this.ui.focus.has(this.screen)) this.render(); }

  reached(id) {
    const d = this.ui.save?.data || {};
    return !!(d.completed || d.unlocked?.includes(id) || this.ui.params?.unlock);
  }
  render() {
    const ui = this.ui, d = ui.save?.data || {}, cards = this.el.querySelector('.cards');
    const counts = { ...CP_COUNT, ...(ui.local.cps || {}) };
    cards.innerHTML = '';
    PLAYABLE.forEach((m, i) => {
      const open = this.reached(m.id), max = open ? Math.max(0, d.cps?.[m.id] ?? 0) : -1;
      const n = Math.max(counts[m.id] || 1, max + 1);
      const b = document.createElement('button');
      b.className = `ccard${open ? '' : ' locked'}${d.chapter === m.id ? ' current' : ''}`;
      b.dataset.id = m.id; b.style.setProperty('--tone', m.tone); b.style.setProperty('--exit', m.exit); b.style.setProperty('--i', i);
      const th = open ? ui.thumb(m.id) : null;
      b.innerHTML = `
        <span class="arch">${th ? `<span class="thumb" style="background-image:url(${th})"></span>` : '<span class="thumb pal"></span>'}${timeGlyph(m.glyph, 'cgl')}${open ? '' : `<span class="lock">${icon('lock')}</span>`}<svg class="frame" viewBox="0 0 1 1" preserveAspectRatio="none"><path d="${ARCH}"/></svg></span>
        <span class="num">${m.numeral}</span>
        <span class="lab">${open ? m.label : ''}</span>
        <span class="pips">${open ? Array.from({ length: n }, (_, k) => `<i data-cp="${k}" class="${k <= max ? 'ok' : ''}${k === 0 ? ' sel' : ''}"></i>`).join('') : ''}</span>`;
      item(b, { act: () => this.choose(b, m, max), label: open ? `chapter ${m.n}, ${m.label}` : `chapter ${m.n}, not reached yet` });
      if (!open) { b.classList.add('off'); b.setAttribute('aria-disabled', 'true'); }
      b.querySelectorAll('.pips i.ok').forEach((p) => p.addEventListener('click', (e) => { e.stopPropagation(); this.start(m.id, +p.dataset.cp); }));
      cards.appendChild(b);
    });
    this.el.querySelector('.legend').innerHTML = this.ui.mainEl.querySelector('.legend')?.innerHTML || '';
  }
  choose(b, m, max) {
    if (this.picking === b) { this.start(m.id, this.pickCp); return; }
    if (max <= 0) { this.start(m.id, 0); return; }
    this.unpick();
    this.picking = b; this.pickMax = max; this.pickId = m.id;
    this.pickCp = this.ui.save?.data?.chapter === m.id ? Math.min(max, this.ui.save.data.cp) : 0;
    b.classList.add('picking');
    this.paintPick();
    this.ui.sound('open');
  }
  pickStep(d) {
    const v = Math.max(0, Math.min(this.pickMax, this.pickCp + d));
    if (v !== this.pickCp) { this.pickCp = v; this.paintPick(); this.ui.sound('slider', { value: v / Math.max(1, this.pickMax) }); }
  }
  paintPick() { this.picking?.querySelectorAll('.pips i').forEach((p) => p.classList.toggle('sel', +p.dataset.cp === this.pickCp)); }
  unpick() { if (this.picking) { this.picking.classList.remove('picking'); this.picking = null; } }
  start(id, cp) { this.unpick(); this.ui.sound('confirm'); this.ui.startChapter(id, cp); }
}
