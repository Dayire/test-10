import { createWorld } from '../render/world.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { UI } from '../ui/ui.js';
import { Game, SESSION_SURFACES } from './game.js';
import { Overrides } from '../assets/library.js';
import { storage } from '../core/storage.js';
import { Save } from '../core/save.js';
import { meta } from '../chapters/index.js';

const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(go); setTimeout(go, 100); });

// Defaults by device class (FULL_GAME §8.4). The light pool is sized here,
// once, by device class and never by tier, so tier changes never recompile.
export function deviceClass() {
  let coarse = false;
  try { coarse = matchMedia('(pointer: coarse)').matches; } catch { /* no media queries */ }
  const mem = navigator.deviceMemory ?? 8, cores = navigator.hardwareConcurrency ?? 8;
  if (coarse && (mem <= 4 || cores <= 4)) return { name: 'lowTouch', tier: 'low', tex: 0.5, pool: 4 };
  if (coarse) return { name: 'touch', tier: 'medium', tex: 0.5, pool: 4 };
  return { name: 'desktop', tier: 'high', tex: 1, pool: 6 };
}

// URL: ?chapter=id&cp=n start there; ?continue=1 the save's place (also the default with a save); ?autostart=1 skips menus;
// ?hold=1 only __medina.sim advances the simulation; ?nosave=1 keeps saves in memory;
// ?tier= ?tex= ?pool= ?noauto=1 rendering overrides
export async function boot(canvas, params) {
  const marks = window.__boot = { start: Math.round(performance.now()) };
  const mark = (k) => { marks[k] = Math.round(performance.now()); };
  const ui = new UI(document.getElementById('ui'));
  const P = Object.fromEntries(params.entries());
  const flag = (k) => P[k] !== undefined && P[k] !== '0' && P[k] !== 'false';
  P.autostart = flag('autostart') ? '1' : undefined; P.hold = flag('hold') ? '1' : undefined;
  storage.init({ disabled: flag('nosave') });
  const save = new Save(storage);
  save.load();
  const dev = deviceClass();
  const S = save.data.settings || {};
  const tier = P.tier || (S.quality && S.quality !== 'auto' ? S.quality : dev.tier);
  ui.progress(0.03, 'mixing the plaster…');
  await nextFrame();
  const world = createWorld(canvas, { tier, texScale: +(P.tex || dev.tex), bake: false });
  if (P.noauto || (S.quality && S.quality !== 'auto')) world.rs.autoQuality = false;
  mark('world');
  ui.progress(0.06, 'sweeping the alleys…');
  await nextFrame();
  const nOverrides = P.procedural !== undefined ? 0 : await Overrides.load('./assets/models/', world.env, world.mats);
  if (nOverrides) ui.progress(0.07, `${nOverrides} crafted assets loaded`);
  mark('overrides');
  const input = new Input();
  const audio = new Audio();
  await world.bake(SESSION_SURFACES);
  const game = new Game(world, input, audio, ui, P, { save });
  game.device = dev;
  game.initOnce({ pool: +(P.pool || dev.pool) });
  game.hooks.card = (m, o) => ui.card(m, o);
  game.hooks.credits = (lines) => ui.credits(lines);
  game.applySettings(S, { persist: false });
  mark('init');
  // where to start: ?chapter= / ?cp= (alone: the souk), else the save's place (the title shows it, §7.1; Continue
  // starts there), else the souk. Booting never writes the save: only starting somewhere does.
  let id = 'souk', cp = 0;
  if (P.chapter !== undefined || P.cp !== undefined) { if (P.chapter && meta(P.chapter)) id = P.chapter; cp = +P.cp || 0; }
  else if (save.exists) { id = save.data.chapter; cp = save.data.cp; }
  if (!meta(id) || (meta(id).dev && !P.chapter)) { id = 'souk'; cp = 0; }
  await game.loadChapter(id, cp, { reason: 'boot', onProgress: (p, msg) => ui.progress(0.08 + p * 0.9, msg) });
  mark('chapter');
  ui.progress(1, 'lighting the lanterns…');
  await nextFrame();
  ui.hideLoading();
  ui.on('resume', () => game.setPaused(false));
  ui.on('checkpoint', () => game.restartCheckpoint());
  // a failed load already reports itself (loadError, console) and recovers in the loader
  ui.on('restart', () => game.restartChapter()?.catch?.(() => {}));
  ui.on('title', () => game.toTitle().catch(() => {}));
  ui.on('quality', () => { const order = ['low', 'medium', 'high', 'ultra']; const i = order.indexOf(world.rs.tier); game.applySettings({ quality: order[(i + 1) % order.length] }); ui.showPause(true, input.lastDevice, world.rs.tier, audio.muted, input.keyLabels); game.redraw(); });
  ui.on('mute', () => { audio.muted = !audio.muted; if (audio.setMuted) audio.setMuted(audio.muted); else if (audio.master) audio.master.gain.value = audio.muted ? 0 : 0.9; ui.showPause(true, input.lastDevice, world.rs.tier, audio.muted, input.keyLabels); });
  ui.on('assets', () => { location.hash = 'assets'; location.reload(); });
  canvas.addEventListener('pointerdown', () => { if (game.mode === 'intro') game.introInput(); canvas.focus(); });
  // unlock audio inside a real user gesture (Safari requires it in the handler itself)
  const unlockAudio = () => { try { audio.start(); if (audio.ctx && audio.ctx.state === 'suspended' && !game.paused) audio.ctx.resume(); } catch { /* no audio */ } };
  for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, unlockAudio, { passive: true });
  // lifecycle: hiding the page pauses and saves
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    if (['play', 'intro', 'dying', 'finale', 'cutscene'].includes(game.mode)) game.setPaused(true);
    save.flush(true);
  });
  window.addEventListener('pagehide', () => save.flush(true));
  window.addEventListener('resize', () => game.redraw());
  // a lost GL context pauses; when it comes back the surfaces are re-baked and the chapter reloads at its checkpoint
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); game.contextLost = true; game.emit('contextLost', {}); if (game.mode === 'play') game.setPaused(true); });
  canvas.addEventListener('webglcontextrestored', () => { game.contextLost = false; game.recoverContext().catch((err) => console.error(err)); });
  // the wordless save indicator
  game.events.on('save', () => ui.saved?.());
  let last = performance.now();
  window.__ready = true;
  const loop = (now) => {
    if (world.rs.beginFrame && world.rs.beginFrame(now) === false) { requestAnimationFrame(loop); return; }
    const dt = Math.max(0, (now - last) / 1000); last = now;
    if (game.mode !== 'loading') world.rs.trackFrame(dt * 1000, { paused: game.paused, hidden: document.hidden });
    game.frame(dt);
    window.__frames = (window.__frames || 0) + 1;
    if (P.debug) ui.debug(debugText(game, world));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  window.__info = () => ({ ...window.__medina.info(), state: window.__medina.state() });
  return game;
}

function debugText(game, world) {
  const s = window.__medina.state();
  const i = world.rs.renderer.info.render;
  const e = s.extra || {};
  return `${s.chapter} x ${s.x} y ${s.y} ${s.st}${s.crawl ? '/crawl' : ''} cp ${s.cp} mode ${s.mode}\ncalls ${i.calls} tris ${(i.triangles / 1000).toFixed(0)}k tier ${world.rs.tier}\n${Object.entries(e).slice(0, 4).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' ')}`;
}
