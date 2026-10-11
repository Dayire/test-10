import { FocusManager, Screen, item } from './focus.js';
import { ICONS, icon, timeGlyph, TIME_GLYPHS, ROSETTE, STAR, zelligeTile, key, stick, padButton } from './glyphs.js';
import { SettingsScreen, defaultSettings, resolveSettings } from './settings.js';
import { ChaptersScreen, captureThumb } from './chapters.js';
import { HintDirector } from './hints.js';
import { TouchControls } from './touch.js';
import { PLAYABLE, meta } from '../chapters/index.js';

// The shell (FULL_GAME §7, §8): splash, main menu over the live title shot, pause, settings, chapters, the
// chapter card, credits, glyph confirms, the wordless HUD (save rosette, hints, sound cues, the touch layer)
// and the lifecycle cards. Wordless in play; short lowercase labels in menus. game.js calls the small
// compatibility surface at the top (showTitle, showPause, card, credits, ...); everything else is driven
// from the game's events and Input's nav edges.
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s ?? '').replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const editable = (t) => !!t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || ''));
export const TAGLINE = 'one evening, one night, one dawn';
export const CREDITS_TAIL = 'thank you for walking with us';
const UI_KEY = 'medina.v1.ui';

export class UI {
  constructor(root, { params = {}, save = null, storage = null, dev = null, artifact = false } = {}) {
    this.root = root; this.params = params; this.save = save; this.storage = storage; this.dev = dev; this.artifact = artifact;
    this.game = null; this.input = null; this.audio = null; this.world = null;
    this.handlers = {};
    this.ready = false; this.queued = null; this.frameNo = 0;
    this.local = (storage?.getJSON?.(UI_KEY)) || {};
    this.bootCompleted = !!save?.data?.completed; // the credits are skippable once the journey has been finished
    this.S = { ...defaultSettings(dev), ...(save?.data?.settings || {}) };
    root.classList.add('shell');
    root.insertAdjacentHTML('beforeend', `
      <div id="hud" aria-hidden="true">
        <div id="hints"></div>
        <div id="cues"><div class="cue l"></div><div class="cue r"></div></div>
        <div id="saveind" class="hidden"><svg viewBox="0 0 100 100">${ROSETTE}</svg></div>
        <div id="rotate" class="hidden">${icon('rotate')}</div>
      </div>
      <div id="menus"></div>
      <section id="card" class="hidden" aria-hidden="true">
        <div class="cbg"></div><div class="cpat"></div>
        <div class="cglyph"></div>
        <div class="cn"></div><div class="crule"><i></i><svg viewBox="0 0 100 100">${STAR}</svg><i></i></div><div class="cl"></div>
        <div class="cwait"><svg viewBox="0 0 100 100">${ROSETTE}</svg></div>
      </section>
      <section id="lost" class="hidden" role="alert" aria-label="the picture was lost: tap to reload">
        <div class="lglyph">${icon('lantern')}</div><div class="lring"><svg viewBox="0 0 100 100">${ROSETTE}</svg></div><div class="lmsg">tap to reload</div>
      </section>
      <div id="dbg" class="hidden"></div>`);
    this.el = (id) => root.querySelector('#' + id);
    this.menus = this.el('menus');
    // the splash is in index.html (it paints before any script); older pages get one here
    if (!this.el('loading')) root.insertAdjacentHTML('afterbegin', `<div id="loading"><div class="lmark"><svg viewBox="0 0 100 100">${ROSETTE}</svg></div><div class="lt">MEDINA</div><div class="lbar"><i></i></div><div class="lmsg">weaving the alleys…</div></div>`);
    this.el('card').querySelector('.cpat').style.backgroundImage = zelligeTile('rgba(255,243,220,.07)', 96);
    root.style.setProperty('--zellige-faint', zelligeTile('rgba(233,196,143,.07)', 72));
    this.focus = new FocusManager(this);
    this.buildMain(); this.buildPause(); this.buildConfirm(); this.buildCredits();
    this.settings = new SettingsScreen(this);
    this.chapters = new ChaptersScreen(this);
    this.hints = new HintDirector(this);
    this.applyLocal(this.S);
    // Enter and Space act through the nav edges, never as a second native click; Tab stays inside the open screen
    window.addEventListener('keydown', (e) => {
      if (!this.focus.top || editable(e.target)) return;
      if (e.code === 'Enter' || e.code === 'NumpadEnter' || e.code === 'Space') e.preventDefault();
      if (e.code === 'Tab') { e.preventDefault(); this.focus.move(e.shiftKey ? -1 : 1); }
    }, true);
    root.addEventListener('focusin', (e) => { const t = this.focus.top; const it = e.target.closest?.('.item'); if (t && it && t.el.contains(it) && it !== this.focus.current) this.focus.set(it, { scroll: false }); });
    for (const ev of ['contextmenu', 'dblclick', 'gesturestart', 'selectstart']) document.addEventListener(ev, (e) => { if (!editable(e.target)) e.preventDefault(); }, { passive: false });
    this.el('lost').addEventListener('click', () => this.handlers.reload?.());
    // the browser's back (Android's back gesture, a desktop back button) closes the open screen, and pauses play on
    // touch: one history entry stands guard while there is somewhere to go back from. A top-level page only: the
    // artifact's host keeps its own history
    this.histOK = !artifact && (() => { try { return window.top === window && typeof history.pushState === 'function'; } catch { return false; } })();
    if (this.histOK) { try { if (history.state?.medina) history.replaceState(null, ''); } catch { this.histOK = false; } }
    window.addEventListener('popstate', () => this.onPopState());
  }

  // ?autostart=1 skips every menu (read live: tests turn it off to see the title)
  get autostart() { return !!this.params.autostart; }

  // ------------------------------------------------------------------ compatibility surface (game.js, boot.js)
  on(a, fn) { this.handlers[a] = fn; }
  progress(p, msg) {
    const l = this.el('loading');
    if (l) { const i = l.querySelector('.lbar i'); i.style.width = `${Math.round(p * 100)}%`; i.style.transform = `scaleX(${Math.max(0, Math.min(1, p)).toFixed(3)})`; if (msg) l.querySelector('.lmsg').textContent = msg; }
    this.mainEl?.style.setProperty('--load', Math.max(0, Math.min(1, p)).toFixed(3));
  }
  hideLoading() {
    const l = this.el('loading');
    if (!l) return;
    l.classList.add('fade');
    setTimeout(() => l.remove(), 1500);
  }
  showTitle(on) {
    if (on) { if (!this.autostart) this.openMain(); }
    else this.closeMain();
  }
  // the game fades the title out as play begins
  titleOpacity(a) { if (a < 0.999 && this.focus.has(this.main)) this.closeMain(); }
  showHint(device, sec, labels) { this.hints.request('controls'); }
  hideHint() { this.hints.hideAll(); }
  showEnd() {}
  showPause(on) {
    const g = this.game;
    if (on) {
      if (g?.held || this.focus.has(this.main)) { this.mainEl.classList.add('resting'); return; } // paused on the title: the scene rests
      if (!this.focus.has(this.pause)) { this.fillPause(); this.focus.open(this.pause); }
    } else {
      this.mainEl.classList.remove('resting');
      if (this.focus.has(this.pause)) this.focus.close(this.pause);
    }
  }
  saved() { const e = this.el('saveind'); e.classList.remove('hidden'); clearTimeout(this._saveT); this._saveT = setTimeout(() => e.classList.add('hidden'), 1400); }
  debug(text) { const d = this.el('dbg'); d.classList.remove('hidden'); d.textContent = text; }

  // ------------------------------------------------------------------ wiring
  attachInput(input) {
    this.input = input;
    // the touch layer lives in #ui's stacking context, under every overlay
    if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
      this.touch = new TouchControls(this, input);
      this.root.prepend(this.touch.el);
      input.touchUI = this.touch;
      this.touch.applySettings(this.S);
      this.root.classList.add('has-touch');
    }
    input.on('device', (d) => this.deviceChanged(d));
    this.deviceChanged(input.lastDevice);
    input.applySettings({ crawlMode: this.S.crawlMode, vibration: this.S.vibration });
  }
  attach({ game, audio, world }) {
    this.game = game; this.audio = audio; this.world = world;
    game.hooks.card = (m, o) => this.card(m, o);
    game.hooks.credits = (lines) => this.credits(lines);
    game.hooks.hint = (id) => this.hints.request(id);
    game.hooks.frame.push((dt) => this.frameHook(dt));
    this.hints.attach(game);
    const E = game.events;
    E.on('chapterStart', (d) => {
      if (d.reason !== 'boot' && d.reason !== 'title') this.closeMain();
      this.hideLost();
      this.thumbWanted = !this.thumb(d.id) && !meta(d.id)?.dev ? performance.now() + 1600 : 0;
      if (game.checkpoints?.length) { (this.local.cps ||= {})[d.id] = game.checkpoints.length; this.writeLocal(); }
      this.fillMain();
    });
    E.on('mode', ({ mode }) => {
      if (mode === 'play' && this.menuTheme) { this.menuTheme = false; this.audio?.setChapter?.(game.def?.audio, game.def); }
      if (mode === 'play') this.maybeRotateHint();
      this.syncHistory();
    });
    E.on('pause', () => this.syncHistory());
    E.on('save', () => this.fillMain());
    E.on('credits', () => { this.wasCompleted = !!(this.local.completed || this.bootCompleted); this.local.completed = true; this.writeLocal(); });
    E.on('contextLost', () => this.showLost());
    game.applySettings(resolveSettings(this.S, this), { persist: false });
    this.menuChanged();
  }
  // the chapter is built: the live title shot replaces the splash and what waited on it runs
  setReady() {
    this.ready = true;
    this.mainEl.classList.remove('pending');
    this.fillMain();
    const q = this.queued; this.queued = null;
    if (q) setTimeout(() => this.mainAction(q), 50);
  }

  sound(name, data) { try { this.audio?.ui?.(name, data); } catch { /* audio not started */ } }
  writeLocal() { this.storage?.setJSON?.(UI_KEY, this.local); }
  thumb(id) { return this.storage?.get?.(`medina.v1.thumb.${id}`) || null; }

  // what the stack implies: game input zeroed, the touch layer hidden, the 30 fps menu background, the menu look
  menuChanged() {
    const open = !!this.focus.top, g = this.game;
    if (this.input) this.input.menuOpen = open;
    if (g && g.menuOpen !== open) g.setMenuOpen(open);
    this.root.classList.toggle('menu-open', open);
    this.touch?.setVisible(!open && !this.cardUp);
    this.syncMenuBackground();
    this.syncHistory();
  }
  syncMenuBackground() {
    const g = this.game, rs = this.world?.rs;
    const on = !!(g && this.ready && g.held && this.focus.top && !g.suspended);
    // the renderer keeps it through a tier change (the quality setting, or auto quality)
    if (rs && on !== this._menuBg) { this._menuBg = on; rs.setMenuBackground?.(on); }
    this._dim = on;
  }
  // a deeper post vignette behind the menus over the title (never a backdrop filter): applied to the post
  // parameters after the look director has written them, so the look itself carries no override. The base is the
  // look's last written value: a paused frame (the director rests) or a redraw never deepens it twice.
  beforeRender(P) {
    if (!P) return;
    if (P.vignette !== this._vigOut) this._vigBase = P.vignette;
    P.vignette = this._dim ? Math.max(0.62, this._vigBase + 0.2) : this._vigBase;
    this._vigOut = P.vignette;
  }

  deviceChanged(d) {
    this.root.dataset.device = d;
    this.touch?.deviceChanged(d);
    this.fillLegends();
    this.syncHistory();
  }

  // ------------------------------------------------------------------ the browser's back
  wantGuard() {
    const g = this.game, t = this.focus.top;
    if (t) return t !== this.main;
    return !!(this.touch && g && this.input?.lastDevice === 'touch' && !g.held && !g.paused && !g.suspended && ['play', 'intro', 'dying', 'finale', 'cutscene'].includes(g.mode));
  }
  syncHistory() {
    if (!this.histOK || this._unguard) return;
    const want = this.wantGuard();
    try {
      if (want && !this.guarded) { history.pushState({ medina: 1 }, ''); this.guarded = true; }
      else if (!want && this.guarded) {
        // step off the guard; its popstate is ours, not a back press
        this.guarded = false; this._unguard = true;
        clearTimeout(this._unguardT); this._unguardT = setTimeout(() => { this._unguard = false; this.syncHistory(); }, 1500);
        history.back();
      }
    } catch { this.histOK = false; }
  }
  onPopState() {
    if (!this.histOK) return;
    if (this._unguard) { this._unguard = false; clearTimeout(this._unguardT); this.syncHistory(); return; }
    if (!this.guarded) return; // an entry left by an earlier load of the page
    this.guarded = false;
    const t = this.focus.top;
    if (t && t !== this.main) { if (t.back) t.back(); else this.focus.close(t); }
    else if (!t) this.requestPause();
    this.syncHistory();
  }

  applyLocal(S) {
    this.root.style.setProperty('--menu-scale', String((+S.menuScale || 100) / 100));
    this.root.classList.toggle('high-contrast', !!S.highContrast);
    this.root.classList.toggle('reduce-motion', !!S.reduceMotion);
    this.hints.soundCues = !!S.soundCues;
    this.hints.mode = S.hints || 'first';
  }
  // one setting from the settings screen: persisted as chosen, applied resolved (auto camera, device defaults)
  setSetting(k, v) {
    const S = this.S;
    let patch;
    if (k.startsWith('volumes.')) { const sub = k.slice(8); S.volumes = { ...S.volumes, [sub]: v }; patch = { volumes: S.volumes }; }
    else { S[k] = v; patch = { [k]: v }; }
    this.save?.settings(patch);
    if (this.game) { this.game.applySettings(resolveSettings(patch, this), { persist: false }); this.game.redraw(); } // a paused frame shows it too
    else this.input?.applySettings(patch);
    this.applyLocal(S);
    return S;
  }
  // a resize or a rotation re-resolves the automatic camera distance
  layoutChanged() {
    this.root.classList.toggle('portrait', innerHeight > innerWidth);
    if (this.game && this.S.cameraDist === 'auto') this.game.applySettings(resolveSettings({ cameraDist: 'auto' }, this), { persist: false });
    this.touch?.layout();
  }

  // ------------------------------------------------------------------ per frame
  // game.frame calls this after Input.poll (the nav edges of this frame) and before the simulation
  update(dt) {
    this.frameNo++;
    const n = this.input?.nav;
    if (n && this.focus.top) {
      // a screen opened by this frame's key press does not see that press
      if (this._skipNav) this._skipNav = false;
      else {
        const anyNav = n.up || n.down || n.left || n.right || n.confirm || n.back || n.prev || n.next;
        // any key wakes the resting title (the scene paused under the menu); Esc only wakes it
        if (anyNav && this.game?.paused && this.game.held) { this.game.setPaused(false); if (n.back) return this.afterUpdate(dt); }
        if (this.focus.top === this.pause && n.pause && !n.back) this.resume();
        else this.focus.update(n);
      }
    }
    this.afterUpdate(dt);
  }
  afterUpdate(dt) {
    this.hints.update(dt);
    this.touch?.update(dt);
    if (this.cardWaitAt && performance.now() > this.cardWaitAt) { this.el('card').classList.add('waiting'); this.cardWaitAt = 0; }
  }
  frameHook(dt) {
    const g = this.game;
    this.syncMenuBackground();
    // pointer parallax on the title shot (desktop, ±0.6 m)
    const R = g.camRig, held = g.held && this.focus.has(this.main);
    const tx = held && this.mouse ? this.mouse.x * 0.6 : 0, ty = held && this.mouse ? this.mouse.y * 0.3 : 0;
    const k = 1 - Math.exp(-3 * dt);
    this.px = (this.px || 0) + (tx - (this.px || 0)) * k; this.py = (this.py || 0) + (ty - (this.py || 0)) * k;
    if (R.override && !R.override._parallax && (Math.abs(this.px) > 1e-3 || held)) {
      const f = R.override, out = { pos: null, look: null, fov: 40 };
      const w = (d) => { const o = f(d); out.pos = (out._p ||= o.pos.clone()).copy(o.pos); out.pos.x += this.px; out.pos.y += this.py; out.look = o.look; out.fov = o.fov; out.shadowFocus = o.shadowFocus; return out; };
      w._parallax = true; R.override = w;
    }
    this.touch?.frame(g);
    this.updateSafeRect(dt);
  }
  // after the frame rendered (boot's loop): thumbnails read the canvas while its picture is still there
  afterFrame(canvas) {
    const g = this.game;
    if (!this.thumbWanted || performance.now() < this.thumbWanted || !g) return;
    // under the title (half resolution, the deeper vignette) or a menu: wait until play has run a moment
    if (g.held || this._dim || this.focus.top) { this.thumbWanted = performance.now() + 1600; return; }
    if (g.fade > 0.02 || g.paused || g.suspended || !['intro', 'play'].includes(g.mode)) return;
    this.thumbWanted = 0;
    const url = captureThumb(canvas);
    if (url) { this.storage?.set?.(`medina.v1.thumb.${g.chapterId}`, url); this.chapters.refresh(); }
  }

  // lens shift (FULL_GAME §8.2): on touch, the boy stays centred in the play rect above the control band
  safeInsets() {
    const p = this._probe ||= Object.assign(document.createElement('div'), { style: 'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)' });
    if (!p.isConnected) document.body.appendChild(p);
    const s = getComputedStyle(p);
    return { t: parseFloat(s.paddingTop) || 0, r: parseFloat(s.paddingRight) || 0, b: parseFloat(s.paddingBottom) || 0, l: parseFloat(s.paddingLeft) || 0 };
  }
  playRect() {
    const W = innerWidth, H = innerHeight, s = this.safeInsets();
    if (H > W) { const band = Math.max(160, 0.24 * H) + s.b; return { x: s.l, y: s.t, w: W - s.l - s.r, h: Math.max(1, H - band - s.t) }; }
    return { x: s.l, y: s.t, w: W - s.l - s.r, h: H - s.t - s.b };
  }
  updateSafeRect(dt) {
    const g = this.game, R = g?.camRig;
    if (!R?.setSafeRect) return;
    const want = this.touch && this.input?.lastDevice === 'touch' && ['play', 'dying', 'finale', 'cutscene'].includes(g.mode) && !g.held;
    const target = want ? this.playRect() : null;
    const W = innerWidth, H = innerHeight, full = { x: 0, y: 0, w: W, h: H };
    const k = this.safeK = Math.max(0, Math.min(1, (this.safeK || 0) + (want ? dt : -dt) / 0.8));
    if (k <= 0) { if (R.safeRect) R.setSafeRect(null); this._rect = null; return; }
    const t = target || this._rect || full, e = k * k * (3 - 2 * k);
    if (target) this._rect = target;
    const r = { x: full.x + (t.x - full.x) * e, y: full.y + (t.y - full.y) * e, w: full.w + (t.w - full.w) * e, h: full.h + (t.h - full.h) * e };
    const q = (v) => Math.round(v * 2) / 2;
    R.setSafeRect({ x: q(r.x), y: q(r.y), w: q(r.w), h: q(r.h) });
  }

  // ------------------------------------------------------------------ main menu
  buildMain() {
    const el = this.mainEl = document.createElement('section');
    el.id = 'title'; el.className = 'menu pending'; el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'main menu');
    el.innerHTML = `
      <header class="brand">
        <h1 class="wordmark" aria-label="Medina">MEDINA</h1>
        <div class="tagline">${TAGLINE}</div>
        <div class="rule"><i></i><svg viewBox="0 0 100 100">${STAR}</svg><i class="load"></i></div>
      </header>
      <nav class="entries"></nav>
      <footer class="legend"></footer>
      <div class="store hidden" role="img" aria-label="progress is kept only until the page closes">${icon('linkBroken')}</div>`;
    this.menus.appendChild(el);
    const entries = [
      ['continue', 'continue'], ['new', 'new journey'], ['chapters', 'chapters'], ['settings', 'settings'], ['credits', 'credits'],
      ...(import.meta.env.DEV && !this.artifact ? [['assets', 'asset sheet']] : []),
    ];
    const nav = el.querySelector('.entries');
    entries.forEach(([k, label], i) => {
      const b = document.createElement('button');
      b.className = 'entry'; b.dataset.k = k; b.style.setProperty('--i', i);
      b.innerHTML = `<span class="lbl"><span class="mark"><svg viewBox="0 0 100 100">${STAR}</svg></span>${label}</span>${k === 'continue' ? '<span class="sub"></span>' : ''}<span class="wait"><svg viewBox="0 0 100 100">${ROSETTE}</svg></span>`;
      item(b, { act: () => this.mainAction(k), label });
      nav.appendChild(b);
    });
    this.main = new Screen(this, {
      el,
      items: () => [...nav.querySelectorAll('.entry')].filter((b) => !b.hidden),
      initial: () => [...nav.querySelectorAll('.entry')].find((b) => !b.hidden),
      back: () => { if (this.game && this.ready) { this.sound('back'); this.game.setPaused(!this.game.paused); } },
      onOpen: () => { if (this.game?.held && this.audio && !this.menuTheme) { this.menuTheme = true; this.audio.setChapter?.({ theme: 'menu', verb: 'menu' }); } },
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse') this.mouse = { x: e.clientX / innerWidth * 2 - 1, y: -(e.clientY / innerHeight * 2 - 1) }; });
    // a resting title (Esc, or the page was hidden) wakes on any touch or click, not only on an entry
    el.addEventListener('pointerdown', () => { const g = this.game; if (g?.paused && g.held && this.focus.top === this.main) g.setPaused(false); });
    window.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' && this.focus.has(this.main)) this.mouse = { x: e.clientX / innerWidth * 2 - 1, y: -(e.clientY / innerHeight * 2 - 1) }; }, { passive: true });
    this.fillMain();
  }
  // a journey to continue (§7.1: continue only with a save): a checkpoint passed, a later chapter or time in play;
  // a save that holds only settings (or progress just reset) is not one
  hasJourney() {
    const d = this.save?.data;
    return !!(this.save?.exists && d && (d.cp > 0 || d.chapter !== 'souk' || d.stats?.playSec > 0));
  }
  fillMain() {
    const el = this.mainEl; if (!el) return;
    const d = this.save?.data, has = this.hasJourney();
    const c = el.querySelector('[data-k="continue"]');
    c.hidden = !has;
    if (!has && this.focus?.current === c) this.focus.set(this.main.initial());
    if (has) {
      const m = meta(d.chapter);
      c.querySelector('.sub').innerHTML = m ? `${timeGlyph(m.glyph, 'sg')}<span>${esc(m.numeral)}</span><em>${esc(m.label)}</em>` : '';
      c.setAttribute('aria-label', m ? `continue: chapter ${m.n}, ${m.label}` : 'continue');
    }
    for (const k of ['continue', 'new', 'chapters']) el.querySelector(`[data-k="${k}"]`).classList.toggle('waiting', !this.ready && this.queued === k);
    el.querySelector('.store').classList.toggle('hidden', !!this.storage?.available || !!this.storage?.disabled);
    this.fillLegends();
  }
  fillLegends() {
    const d = this.input?.lastDevice || 'keyboard', kind = this.input?.pad?.kind || 'xbox';
    const html = d === 'touch' ? '' : d === 'gamepad'
      ? `<span>${padBtn(kind, 'bottom')}<em>select</em></span><span>${padBtn(kind, 'right')}<em>back</em></span>`
      : '<span><kbd class="key wide">enter</kbd><em>select</em></span><span><kbd class="key wide">esc</kbd><em>back</em></span>';
    for (const f of this.root.querySelectorAll('.legend')) f.innerHTML = html;
    this.chapters?.legend();
    this.fillControls(d, kind);
  }
  // the pause screen keeps the play controls in view (the verbs the hints teach), for the hands in use
  fillControls(d = this.input?.lastDevice || 'keyboard', kind = this.input?.pad?.kind || 'xbox') {
    const el = this.pause?.el.querySelector('.ctl'); if (!el) return;
    const kl = this.input?.keyLabels, pad = (name) => `<span class="pad">${icon(name)}</span>`;
    const G = d === 'touch' ? { move: stick('lr'), jump: pad('jump'), grab: pad('hand'), climb: stick('up'), crawl: stick('down') }
      : d === 'gamepad' ? { move: stick('lr'), jump: padButton(kind, 'bottom'), grab: padButton(kind, 'left'), climb: stick('up'), crawl: stick('down') }
        : { move: `${key(kl?.left || 'a')}${key(kl?.right || 'd')}`, jump: key('space', true), grab: key('shift', true), climb: key(kl?.up || 'w'), crawl: key(kl?.down || 's') };
    el.innerHTML = Object.entries(G).map(([k, g]) => `<span>${g}<em>${k}</em></span>`).join('');
  }
  openMain() {
    if (this.autostart) return;
    this.fillMain();
    if (!this.focus.has(this.main)) {
      this.focus.closeAll({ instant: true });
      this.focus.open(this.main, { sound: false });
      this._skipNav = true;
    }
    this.main.onOpen();
  }
  closeMain() { if (this.focus.has(this.main)) this.focus.close(this.main, { sound: false }); }

  mainAction(k) {
    const g = this.game;
    if (['continue', 'new', 'chapters'].includes(k) && (!this.ready || !g)) {
      // the live background is still being built: remember the choice and take it when it is ready
      this.queued = k; this.sound('confirm'); this.fillMain(); return;
    }
    if (g?.paused) g.setPaused(false);
    this.sound('confirm');
    if (k === 'continue') this.continueJourney();
    else if (k === 'new') {
      if (this.hasJourney()) this.confirm({ glyph: 'rosette', text: 'begin a new journey?', yes: () => this.newJourney() });
      else this.newJourney();
    } else if (k === 'chapters') this.focus.open(this.chapters.screen);
    else if (k === 'settings') this.settings.open();
    else if (k === 'credits') this.rollMenuCredits();
    else if (k === 'assets') this.handlers.assets?.();
  }
  // Continue: the title already shows the save's place, so play begins in place (the camera blends to the rail)
  continueJourney() {
    const g = this.game, d = this.save.data;
    this.focus.closeAll();
    if (g.held && g.chapterId === d.chapter && g.cpIndex === d.cp) g.introInput();
    else g.continueGame().catch(() => {});
  }
  newJourney() {
    const g = this.game;
    this.focus.closeAll();
    if (g.held && g.chapterId === 'souk' && g.cpIndex === 0) { this.save.newJourney(); g.introInput(); }
    else g.newGame().catch(() => {});
  }
  startChapter(id, cp) {
    const g = this.game;
    this.focus.closeAll();
    if (g.paused) g.setPaused(false);
    if (g.held && g.chapterId === id && g.cpIndex === cp && this.save.data.chapter === id) g.introInput();
    else g.startChapter(id, cp).catch(() => {});
  }

  // ------------------------------------------------------------------ pause
  buildPause() {
    const el = document.createElement('section');
    el.id = 'pause'; el.className = 'menu'; el.setAttribute('role', 'menu'); el.setAttribute('aria-label', 'paused');
    el.innerHTML = `<header class="where"><div class="pg"></div><div class="pt"><span class="pn"></span><em class="pl"></em></div><div class="pips"></div></header><nav class="entries"></nav><aside class="ctl" aria-label="controls"></aside><footer class="legend"></footer>`;
    this.menus.appendChild(el);
    const nav = el.querySelector('.entries');
    const acts = [
      ['resume', 'resume', () => this.resume()],
      ['checkpoint', 'restart checkpoint', () => { this.focus.closeAll(); this.game.restartCheckpoint(); }],
      ['restart', 'restart chapter', () => this.confirm({ glyph: meta(this.game?.chapterId)?.glyph || 'rosette', text: 'begin the chapter again?', yes: () => { this.focus.closeAll(); this.game.restartChapter()?.catch?.(() => {}); } })],
      ['chapters', 'chapters', () => this.focus.open(this.chapters.screen)],
      ['settings', 'settings', () => this.settings.open()],
      ['title', 'title', () => { this.focus.closeAll(); this.game.toTitle().catch(() => {}); }],
    ];
    acts.forEach(([k, label, fn], i) => {
      const b = document.createElement('button');
      b.className = 'entry'; b.dataset.k = k; b.style.setProperty('--i', i);
      b.innerHTML = `<span class="lbl"><span class="mark"><svg viewBox="0 0 100 100">${STAR}</svg></span>${label}</span>`;
      item(b, { act: () => { this.sound('confirm'); fn(); }, label });
      nav.appendChild(b);
    });
    // every pause opens on resume (a reflex confirm never restarts or leaves)
    this.pause = new Screen(this, { el, initial: () => nav.querySelector('[data-k="resume"]'), back: () => this.resume(), onOpen: () => { this._skipNav = true; } });
  }
  fillPause() {
    const g = this.game, el = this.pause.el, m = meta(g?.chapterId);
    el.querySelector('.pg').innerHTML = m ? timeGlyph(m.glyph, 'glyph') : '';
    el.querySelector('.pn').textContent = m?.numeral || '';
    el.querySelector('.pl').textContent = m?.label || '';
    const n = g?.checkpoints?.length || 0;
    el.querySelector('.pips').innerHTML = n > 1 ? Array.from({ length: n }, (_, i) => `<i class="${i < g.cpIndex ? 'past' : i === g.cpIndex ? 'here' : ''}"></i>`).join('') : '';
    el.querySelector('[data-k="checkpoint"]').hidden = !!g?.held;
    this.fillLegends();
  }
  resume() { this.sound('back'); this.game?.setPaused(false); }
  // ⏸ on the touch layer (and a pad that went away)
  requestPause() {
    const g = this.game;
    if (!g || g.paused || g.suspended || this.focus.top) return;
    if (['play', 'intro', 'dying', 'finale', 'cutscene'].includes(g.mode)) g.setPaused(true);
  }
  // fullscreen; once granted, a phone also tries to hold landscape
  setFullscreen(on) {
    try {
      if (on && !document.fullscreenElement) {
        document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })?.then(() => { try { screen.orientation?.lock?.('landscape')?.catch?.(() => {}); } catch { /* not allowed */ } }).catch(() => {});
      } else if (!on && document.fullscreenElement) document.exitFullscreen?.()?.catch?.(() => {});
    } catch { /* not allowed in this frame */ }
  }

  // ------------------------------------------------------------------ glyph confirm (✓ / ✕)
  buildConfirm() {
    const el = document.createElement('section');
    el.id = 'confirm'; el.setAttribute('role', 'alertdialog'); el.setAttribute('aria-modal', 'true');
    el.innerHTML = `<div class="panel"><div class="cfg"></div><p class="q"></p><div class="row"></div></div>`;
    this.menus.appendChild(el);
    const row = el.querySelector('.row');
    const yes = item(document.createElement('button'), { act: () => { const f = this._yes; this.focus.close(this.confirmS, { sound: false }); this.sound('confirm'); f?.(); }, label: 'yes' });
    const no = item(document.createElement('button'), { act: () => this.focus.close(this.confirmS), label: 'no' });
    yes.className += ' yes'; no.className += ' no';
    yes.innerHTML = icon('check'); no.innerHTML = icon('cross');
    row.append(yes, no);
    this.confirmS = new Screen(this, { el, modal: true, grid: true, initial: () => no });
  }
  confirm({ glyph = 'rosette', text = '', yes }) {
    const el = this.confirmS.el;
    el.querySelector('.cfg').innerHTML = TIME_GLYPHS[glyph] ? timeGlyph(glyph, 'glyph') : icon(glyph);
    el.querySelector('.q').textContent = text;
    el.setAttribute('aria-label', text);
    this._yes = yes;
    this.focus.open(this.confirmS);
  }

  // ------------------------------------------------------------------ chapter card (game.hooks.card)
  // resolves once the card covers the screen; hide() keeps it up at least 2.5 s, then fades it out
  async card(m, { minSec = 2.5 } = {}) {
    const c = this.el('card');
    c.style.setProperty('--tone', m.tone || '#20140c');
    c.style.setProperty('--exit', m.exit || '#000');
    // ink follows the glow behind the text (the tone lifted toward ivory at the centre): cedar on a pale dawn or
    // noon, ivory on sundown and night
    c.classList.toggle('light', cardGlowLum(m.tone || '#20140c') > 0.3);
    c.querySelector('.cn').textContent = m.numeral || '';
    c.querySelector('.cl').textContent = m.label || '';
    c.querySelector('.cglyph').innerHTML = (TIME_GLYPHS[m.glyph] || TIME_GLYPHS.rosette).map((l, i) => `<svg class="l ${l.k}" style="--i:${i}" viewBox="0 0 100 100" aria-hidden="true">${l.svg}</svg>`).join('');
    c.classList.remove('out', 'waiting', 'draw');
    c.classList.remove('hidden');
    void c.offsetWidth;
    c.classList.add('draw');
    this.cardUp = true; this.menuChanged();
    this.sound('card');
    const shown = performance.now();
    this.cardWaitAt = shown + minSec * 1000;
    await wait(650);
    return {
      hide: async () => {
        const left = minSec * 1000 - (performance.now() - shown);
        if (left > 0) await wait(left);
        this.cardWaitAt = 0;
        c.classList.add('out', 'hidden'); c.classList.remove('waiting');
        this.cardUp = false; this.menuChanged();
        await wait(900);
        c.classList.remove('draw', 'out');
      },
    };
  }

  // ------------------------------------------------------------------ credits
  buildCredits() {
    const el = document.createElement('section');
    el.id = 'end'; el.setAttribute('aria-label', 'credits');
    el.innerHTML = `<div class="scrim"></div><div class="roll"><div class="track"></div></div><button class="skip" aria-label="skip">${icon('back')}</button>`;
    this.menus.appendChild(el);
    const skip = el.querySelector('.skip');
    item(skip, { act: () => this._creditsDone?.(), label: 'skip' });
    this.creditsS = new Screen(this, { el, items: () => (el.classList.contains('skippable') ? [skip] : []), back: () => { if (el.classList.contains('skippable')) this._creditsDone?.(); } });
  }
  // the lines over the exit colour (or the live scene), a slow vertical roll on the right
  credits(lines, { menu = false } = {}) {
    const el = this.creditsS.el, g = this.game;
    const body = (lines || []).map((l) => {
      if (l && typeof l === 'object') return `<div class="cr"><small>${esc(l.role)}</small><span>${esc(l.name)}</span></div>`;
      return `<div class="cr"><span>${esc(l)}</span></div>`;
    }).join('');
    el.querySelector('.track').innerHTML = `<div class="cw">MEDINA</div><div class="cs"><svg viewBox="0 0 100 100">${ROSETTE}</svg></div>${body}<div class="ct">${CREDITS_TAIL}</div>`;
    // ink follows what is behind: dark on a pale exit colour, pale on the night or the live city
    const covered = g && g.fade > 0.5, c = g?.fadeColor;
    const lum = covered && c ? 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b : 0;
    el.classList.toggle('light', lum > 0.45);
    el.classList.toggle('skippable', menu || !!this.wasCompleted);
    const n = (lines || []).length;
    const sec = menu ? 16 + n * 1.2 : 22 + n * 1.8;
    el.style.setProperty('--roll', `${sec}s`);
    const track = el.querySelector('.track');
    track.style.animation = 'none'; void track.offsetWidth; track.style.animation = '';
    this.focus.open(this.creditsS, { sound: false });
    return new Promise((res) => {
      let t = 0;
      const done = () => { clearTimeout(t); this._creditsDone = null; if (this.focus.has(this.creditsS)) this.focus.close(this.creditsS, { sound: false }); res(); };
      this._creditsDone = done;
      t = setTimeout(done, (sec + 3.5) * 1000);
    });
  }
  rollMenuCredits() {
    const lines = this.game?.def?.credits || ['made entirely of code', 'three.js'];
    this.credits(lines, { menu: true });
  }

  // ------------------------------------------------------------------ lifecycle cards
  showLost() { this.el('lost').classList.remove('hidden'); this.el('lost').classList.toggle('auto', !!this.artifact); }
  hideLost() { this.el('lost').classList.add('hidden'); }
  fatal(kind = 'webgl') {
    this.root.insertAdjacentHTML('beforeend', `<section id="fatal" role="alert"><div class="fg">${icon('lantern')}</div><div class="fw">MEDINA</div><p>${kind === 'webgl' ? 'this browser cannot light the city: webgl 2 is needed' : 'the city could not be built here'}</p></section>`);
    this.el('loading')?.classList.add('fade');
    this.focus.closeAll({ instant: true });
  }
  maybeRotateHint() {
    if (!this.touch || innerHeight <= innerWidth || this.local.rotateSeen) return;
    this.local.rotateSeen = true; this.writeLocal();
    const r = this.el('rotate');
    r.classList.remove('hidden');
    setTimeout(() => r.classList.add('hidden'), 3000);
  }
}

// relative luminance of the card's centre: 74 % tone, 26 % ivory (#fff3dc), as style.css mixes it
function cardGlowLum(hex) {
  const v = parseInt(String(hex).replace('#', '').padEnd(6, '0').slice(0, 6), 16), iv = [255, 243, 220];
  const ch = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c, i) => (c * 0.74 + iv[i] * 0.26) / 255).map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}

function padBtn(kind, pos) {
  const PS = { bottom: '✕', right: '○', left: '□', top: '△' }, NX = { bottom: 'B', right: 'A', left: 'Y', top: 'X' }, XB = { bottom: 'A', right: 'B', left: 'X', top: 'Y' };
  return `<span class="pad">${(kind === 'ps' ? PS : kind === 'nintendo' ? NX : XB)[pos]}</span>`;
}
export { PLAYABLE, ICONS };
