import { createWorld } from '../render/world.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { Haptics } from '../core/haptics.js';
import { UI } from '../ui/ui.js';
import { Game, SESSION_SURFACES } from './game.js';
import { Overrides } from '../assets/library.js';
import { storage } from '../core/storage.js';
import { Save } from '../core/save.js';
import { meta } from '../chapters/index.js';

// the single-file artifact build (tools/vite.artifact.config.js): no service worker, no reloads, no GLB fetch
const ARTIFACT = !!import.meta.env.VITE_ARTIFACT;
// resolves after a frame has been presented (rAF callbacks run before the frame paints), so the menu and the
// splash reach the compositor before the next long synchronous step; a hidden page falls back to a timeout
const nextFrame = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 120); });

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
// ?hold=1 only __medina.sim advances the simulation; ?nosave=1 keeps saves in memory; ?nosw=1 no service worker;
// ?unlock=1 every chapter selectable; ?tier= ?tex= ?pool= ?noauto=1 rendering overrides
export async function boot(canvas, params) {
  const marks = window.__boot = { start: Math.round(performance.now()) };
  const mark = (k) => { marks[k] = Math.round(performance.now()); };
  const P = Object.fromEntries(params.entries());
  const flag = (k) => P[k] !== undefined && P[k] !== '0' && P[k] !== 'false';
  P.autostart = flag('autostart') ? '1' : undefined; P.hold = flag('hold') ? '1' : undefined; P.unlock = flag('unlock') ? '1' : undefined;
  storage.init({ disabled: flag('nosave') });
  const save = new Save(storage);
  save.load();
  const dev = deviceClass();
  const ui = window.__ui = new UI(document.getElementById('ui'), { params: P, save, storage, dev, artifact: ARTIFACT });
  const input = new Input();
  ui.attachInput(input);
  const haptics = input.haptics = new Haptics(input);
  haptics.setLevel(ui.S.vibration);
  ui.layoutChanged();
  // the menu is interactive before the world exists (§8.6): continue, new journey and chapters wait for the chapter
  if (!P.autostart) ui.openMain();
  let pre = true, preT = performance.now();
  const preLoop = (now) => { if (!pre) return; input.poll(); ui.update(Math.min(0.1, (now - preT) / 1000)); preT = now; requestAnimationFrame(preLoop); };
  requestAnimationFrame(preLoop);
  mark('menu');
  const S = save.data.settings || {};
  const tier = P.tier || (S.quality && S.quality !== 'auto' ? S.quality : dev.tier);
  ui.progress(0.03, 'mixing the plaster…');
  await nextFrame();
  let world;
  try { world = createWorld(canvas, { tier, texScale: +(P.tex || dev.tex), bake: false }); }
  catch (e) { console.warn(e); pre = false; ui.fatal('webgl'); window.__fatal = 'webgl'; return null; }
  if (P.noauto || (S.quality && S.quality !== 'auto')) world.rs.autoQuality = false;
  mark('world');
  ui.progress(0.06, 'sweeping the alleys…');
  await nextFrame();
  const nOverrides = P.procedural !== undefined || ARTIFACT ? 0 : await Overrides.load('./assets/models/', world.env, world.mats);
  if (nOverrides) ui.progress(0.07, `${nOverrides} crafted assets loaded`);
  mark('overrides');
  const audio = new Audio();
  // the sounds the game plays reach the haptics (slams) and the visual sound cues
  const soundFns = [];
  const play = audio.play.bind(audio);
  audio.play = (name, x, data) => { for (const f of soundFns) f(name, x, data); return play(name, x, data); };
  await world.bake(SESSION_SURFACES);
  const game = new Game(world, input, audio, ui, P, { save });
  game.device = dev;
  game.initOnce({ pool: +(P.pool || dev.pool) });
  input.context = () => ({ grounded: game.player.state === 'ground' });
  haptics.attach(game, (fn) => soundFns.push(fn));
  soundFns.push((name, x) => ui.hints.cue(name, x));
  ui.attach({ game, audio, world });
  mark('init');
  // the loop runs from here: menus and the loading progress keep moving while the chapter builds
  pre = false;
  let last = performance.now();
  const loop = (now) => {
    if (world.rs.beginFrame && world.rs.beginFrame(now) === false) { requestAnimationFrame(loop); return; }
    const dt = Math.max(0, (now - last) / 1000); last = now;
    if (game.mode !== 'loading' && game.mode !== 'boot') world.rs.trackFrame(dt * 1000, { paused: game.paused, hidden: document.hidden });
    game.frame(dt);
    ui.afterFrame(canvas);
    window.__frames = (window.__frames || 0) + 1;
    if (P.debug) ui.debug(debugText(game, world));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  // where to start: ?chapter= / ?cp= (alone: the souk), else the save's place (the title shows it, §7.1; Continue
  // starts there), else the souk. Booting never writes the save: only starting somewhere does.
  let id = 'souk', cp = 0;
  if (P.chapter !== undefined || P.cp !== undefined) { if (P.chapter && meta(P.chapter)) id = P.chapter; cp = +P.cp || 0; }
  else if (save.exists) { id = save.data.chapter; cp = save.data.cp; }
  if (!meta(id) || (meta(id).dev && !P.chapter)) { id = 'souk'; cp = 0; }
  try { await game.loadChapter(id, cp, { reason: 'boot', onProgress: (p, msg) => ui.progress(0.08 + p * 0.9, msg) }); }
  catch (e) { console.error(e); ui.fatal('build'); window.__fatal = 'build'; return game; }
  mark('chapter');
  ui.progress(1, 'lighting the lanterns…');
  await nextFrame();
  ui.setReady();
  ui.hideLoading();
  ui.on('assets', () => { if (import.meta.env.DEV && !ARTIFACT) { location.hash = 'assets'; location.reload(); } });
  ui.on('reload', () => {
    // a lost picture: the browser normally hands the context back (game.recoverContext reloads the chapter);
    // the hosted page may also start over, the artifact never reloads itself
    try { world.rs.renderer.getContext().getExtension('WEBGL_lose_context')?.restoreContext(); } catch { /* not lost through the extension */ }
    if (!ARTIFACT) setTimeout(() => { if (game.contextLost) location.reload(); }, 1500);
  });
  canvas.addEventListener('pointerdown', () => { if (game.mode === 'intro' && !game.held) game.introInput(); if (!ui.focus.top) canvas.focus({ preventScroll: true }); });
  // unlock audio inside a real user gesture (Safari requires it in the handler itself)
  const unlockAudio = () => { try { audio.start(); if (audio.ctx && audio.ctx.state === 'suspended' && !game.paused) audio.ctx.resume(); } catch { /* no audio */ } };
  for (const ev of ['keydown', 'pointerdown', 'touchstart']) window.addEventListener(ev, unlockAudio, { passive: true });
  // lifecycle: hiding the page pauses (the player comes back to the pause menu) and saves
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { wake.sync(); return; }
    if (['play', 'intro', 'dying', 'finale', 'cutscene'].includes(game.mode)) game.setPaused(true);
    save.flush(true);
    wake.release();
  });
  window.addEventListener('pagehide', () => save.flush(true));
  window.addEventListener('blur', () => { if (game.mode === 'play' && !P.hold) ui.requestPause(); });
  window.addEventListener('resize', () => { game.redraw(); ui.layoutChanged(); });
  input.on('padDisconnect', () => ui.requestPause());
  // a lost GL context pauses; when it comes back the surfaces are re-baked and the chapter reloads at its checkpoint
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); game.contextLost = true; game.emit('contextLost', {}); if (game.mode === 'play') game.setPaused(true); });
  canvas.addEventListener('webglcontextrestored', () => { game.contextLost = false; game.recoverContext().catch((err) => console.error(err)); });
  // the screen stays awake while the boy walks
  const wake = wakeLock(game);
  game.events.on('mode', () => wake.sync());
  game.events.on('pause', () => wake.sync());
  // the wordless save indicator
  game.events.on('save', () => ui.saved?.());
  registerServiceWorker(P);
  window.__ready = true;
  window.__info = () => ({ ...window.__medina.info(), state: window.__medina.state() });
  return game;
}

// navigator.wakeLock during play (guarded: iframes and older browsers refuse it)
function wakeLock(game) {
  let lock = null, want = false;
  // a frame without the permission (the artifact's sandbox) must not even ask: Chrome logs the refusal as an error
  let allowed = !!navigator.wakeLock;
  try { const pp = document.permissionsPolicy || document.featurePolicy; if (pp?.allowsFeature && !pp.allowsFeature('screen-wake-lock')) allowed = false; } catch { allowed = false; }
  const release = () => { want = false; const l = lock; lock = null; try { l?.release?.()?.catch?.(() => {}); } catch { /* gone */ } };
  const sync = () => {
    const on = allowed && game.mode === 'play' && !game.paused && !document.hidden;
    if (!on) { if (lock || want) release(); return; }
    if (lock || want) return;
    want = true;
    try {
      navigator.wakeLock?.request?.('screen').then((l) => { if (!want) { l.release().catch(() => {}); return; } lock = l; l.addEventListener?.('release', () => { if (lock === l) { lock = null; want = false; } }); }).catch(() => { want = false; });
    } catch { want = false; }
  };
  return { sync, release };
}

// the hosted build only: cache-first for hashed assets, network-first for the page (public/sw.js is generated)
function registerServiceWorker(P) {
  if (!import.meta.env.PROD || ARTIFACT || P.nosw) return;
  try {
    if (window.top !== window || !window.isSecureContext || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch { /* opaque origins refuse service workers */ }
}

function debugText(game, world) {
  const s = window.__medina.state();
  const i = world.rs.renderer.info.render;
  const e = s.extra || {};
  return `${s.chapter} x ${s.x} y ${s.y} ${s.st}${s.crawl ? '/crawl' : ''} cp ${s.cp} mode ${s.mode}\ncalls ${i.calls} tris ${(i.triangles / 1000).toFixed(0)}k tier ${world.rs.tier}\n${Object.entries(e).slice(0, 4).map(([k, v]) => `${k} ${JSON.stringify(v)}`).join(' ')}`;
}
