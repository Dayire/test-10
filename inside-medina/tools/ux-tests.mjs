// The shell's acceptance tests (FULL_GAME §11.4 U): node tools/ux-tests.mjs [--port 5176] [--only name,...]
//   keyboard   boot → settings → music 4 → back → new journey → play 2 s → Esc → title → continue resumes
//   gamepad    the same with a stubbed standard pad (d-pad, A, B, RB, Start) and its rumble
//   storage    localStorage throwing: playable, settings in memory, the save code round-trips
//   persist    settings survive a reload (and apply); a save of settings alone shows no continue
//   autostart  ?autostart=1 skips every menu
//   menubg     the live title renders at 30 fps and half resolution under the menus (requests/P.md #8), its vignette
//              deepened once (a resting title's redraws never deepen it again)
//   chapters   chapter select by keyboard: the card covers the load, the chapter starts at the picked checkpoint
//   hints      wordless first steps: the jump glyph at the sack pile (none at a wall too high), grab by the crate;
//              a pause holds the glyph out of sight and lists the play controls
//   crawl      crawl set to toggle: menu navigation never latches it, holding a crate (or a lab mirror) never does,
//              a down-press in play does
//   artifact   npm run build:artifact: one page ≤ 3 MB, run in test.html inside a sandboxed iframe, no console
//              errors, no service worker
//   hosted     vite build: an installable manifest (Chrome's own installability check), the service worker
//              takes control, the game reloads offline, and after a deploy the open tab still loads its chunks
//              while an unhashed file the deploy changed (the manifest) comes from the new version
// One headless Chromium at a time; every scenario opens its own context. Exit code 1 when any fails.
import fs from 'fs';
import http from 'http';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { parseArgs, launch, ROOT } from './lib/harness.mjs';

const o = parseArgs(process.argv.slice(2), { port: 5176 });
const BASE = process.env.BASE || `http://127.0.0.1:${o.port}/`;
const Q = 'tex=0.1&tier=low&noauto=1';
const only = o.only ? String(o.only).split(',') : null;
const browser = await launch();
const results = [];
const live = new Set(); // contexts of the running scenario, closed whatever happens

async function open({ url, init = null, w = 960, h = 540, ctxOpts = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...ctxOpts });
  live.add(ctx);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`); });
  if (init) await page.addInitScript(init);
  if (url) await page.goto(url);
  return { ctx, page, errors };
}
const ready = (page, t = 300000) => page.waitForFunction(() => window.__ready === true && window.__medina && window.__medina.game.mode !== 'loading', null, { timeout: t, polling: 100 });
const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { const f0 = window.__frames || 0; const t0 = performance.now(); const tick = () => ((window.__frames || 0) >= f0 + n || performance.now() - t0 > 20000 ? r() : requestAnimationFrame(tick)); tick(); }), n);
const key = async (page, k, n = 1) => { for (let i = 0; i < n; i++) { await page.keyboard.press(k); await frames(page, 2); } };
const focused = (page) => page.evaluate(() => { const e = __ui.focus.current; return e ? (e.dataset.k || e.textContent.trim()) : null; });
const top = (page) => page.evaluate(() => __ui.focus.top?.el?.id || null);
const waitFor = (page, fn, arg, t = 120000) => page.waitForFunction(fn, arg, { timeout: t, polling: 100 });

async function scenario(name, fn) {
  if (only && !only.some((s) => name.includes(s))) return;
  const t0 = Date.now();
  let res = null, verdict;
  try { [verdict, res] = await fn(); } catch (e) { verdict = `threw: ${e.message.split('\n')[0]}`; }
  for (const c of live) await c.close().catch(() => {});
  live.clear();
  const ok = verdict === true;
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(12)} ${((Date.now() - t0) / 1000).toFixed(0).padStart(4)}s  ${JSON.stringify(res)?.slice(0, 600)}${ok ? '' : `\n      -> ${verdict}`}`);
}

// ------------------------------------------------------------------ the journey by keyboard or by pad
async function journey(page, press, { pad = false } = {}) {
  const out = {};
  // the menu answers before the chapter is built (§8.6: interactive ≤ 3 s on SwiftShader)
  await waitFor(page, () => window.__ui && __ui.focus.top?.el.id === 'title' && __ui.focus.current, null, 60000);
  out.menuMs = await page.evaluate(() => window.__boot.menu);
  // …and is on top: the point under the focused entry is that entry (not the splash), while the chapter builds
  out.menuOnTop = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 900));
    const e = __ui.focus.current, b = e.getBoundingClientRect();
    return { building: !window.__ready, hit: document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2)?.closest('.entry') === e };
  });
  await ready(page);
  out.readyMs = await page.evaluate(() => window.__boot.chapter);
  await frames(page, 3);
  out.first = await focused(page);
  // to settings: new journey → chapters → settings
  const go = async (want) => { for (let i = 0; i < 8 && (await focused(page)) !== want; i++) await press('down'); return focused(page); };
  out.toSettings = await go('settings');
  await press('confirm');
  out.settingsTop = await top(page);
  await press('next'); // audio tab
  out.tab = await page.evaluate(() => document.querySelector('#settings .tab.active')?.textContent);
  await press('down'); await press('down'); // master, music
  out.row = await focused(page);
  await press('left', 6);
  out.music = await page.evaluate(() => ({ ui: __ui.S.volumes.music, game: __medina.game.settings.volumes?.music, mixer: __medina.game.audio.mix?.volumes?.music ?? null }));
  await press('back');
  out.backTo = await top(page);
  // new journey (a save may already exist: the glyph confirm takes ✓)
  for (let i = 0; i < 8 && (await focused(page)) !== 'new'; i++) await press('up');
  await press('confirm');
  if ((await top(page)) === 'confirm') { await press('left'); await press('confirm'); }
  await waitFor(page, () => __medina.game.mode === 'play');
  // two seconds of walking right
  const x0 = await page.evaluate(() => __medina.state().x);
  if (pad) await page.evaluate(() => { __pad.axes[0] = 1; }); else await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(2000);
  await page.waitForFunction((x0) => __medina.state().x > x0 + 0.6, x0, { timeout: 20000, polling: 100 }).catch(() => {}); // a slow software frame
  if (pad) await page.evaluate(() => { __pad.axes[0] = 0; }); else await page.keyboard.up('ArrowRight');
  await frames(page, 2);
  out.walked = +(await page.evaluate((x0) => __medina.state().x - x0, x0)).toFixed(2);
  out.place = await page.evaluate(() => ({ chapter: __medina.chapter(), cp: __medina.state().cp }));
  // pause, then the title
  await press('pause');
  await waitFor(page, () => __medina.game.paused && __ui.focus.top?.el.id === 'pause', null, 30000);
  out.pauseTop = await top(page);
  out.touchHidden = await page.evaluate(() => !document.querySelector('#touch') || document.querySelector('#touch').classList.contains('hide'));
  for (let i = 0; i < 8 && (await focused(page)) !== 'title'; i++) await press('down');
  await press('confirm');
  await waitFor(page, () => __medina.game.held && __ui.focus.top?.el.id === 'title' && !__medina.game.suspended);
  await frames(page, 3);
  out.titleFocus = await focused(page);
  out.saved = await page.evaluate(() => ({ chapter: __ui.save.data.chapter, cp: __ui.save.data.cp }));
  // continue resumes the same chapter and checkpoint
  await press('confirm');
  await waitFor(page, () => __medina.game.mode === 'play');
  out.resumed = await page.evaluate(() => ({ chapter: __medina.chapter(), cp: __medina.state().cp, menu: __ui.focus.top?.el.id || null }));
  const ok = out.menuMs <= 3000 && out.menuOnTop.hit && out.toSettings === 'settings' && out.settingsTop === 'settings' && out.tab === 'audio' && out.row === 'volumes.music'
    && out.music.ui === 4 && out.music.game === 4 && out.backTo === 'title' && out.walked > 0.5 && out.pauseTop === 'pause' && out.titleFocus === 'continue'
    && out.saved.chapter === out.place.chapter && out.saved.cp === out.place.cp && out.resumed.chapter === out.place.chapter && out.resumed.cp === out.place.cp && !out.resumed.menu;
  return [ok || `journey ${JSON.stringify(out)}`, out];
}

await scenario('keyboard', async () => {
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}` });
  const map = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', confirm: 'Enter', back: 'Escape', next: 'KeyE', prev: 'KeyQ', pause: 'Escape' };
  const [v, out] = await journey(page, (k, n = 1) => key(page, map[k], n));
  out.errors = errors.length;
  await ctx.close();
  return [v === true && !errors.length ? true : v === true ? `errors: ${errors.slice(0, 3).join(' | ')}` : v, out];
});

await scenario('gamepad', async () => {
  // a standard-mapping Xbox pad whose buttons the test holds; rumble calls are counted
  const init = () => {
    const buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false }));
    window.__pad = { id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)', index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons, rumbles: 0,
      vibrationActuator: { type: 'dual-rumble', playEffect: () => { window.__pad.rumbles++; return Promise.resolve('complete'); } } };
    // a press lasts exactly one poll (window.__tap(b)), however slow the software frames are
    window.__taps = [];
    window.__tap = (b) => window.__taps.push(b);
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => {
      for (const b of window.__pad.buttons) if (b.tap) { b.pressed = false; b.value = 0; b.tap = false; }
      const b = window.__taps.shift(); if (b !== undefined) { const B = window.__pad.buttons[b]; B.pressed = true; B.value = 1; B.tap = true; }
      return [window.__pad, null, null, null];
    } });
  };
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}`, init });
  const B = { up: 12, down: 13, left: 14, right: 15, confirm: 0, back: 1, next: 5, prev: 4, pause: 9 };
  const press = async (k, n = 1) => { for (let i = 0; i < n; i++) { await page.evaluate((b) => __tap(b), B[k]); await page.waitForFunction(() => !__taps.length, null, { polling: 30 }); await frames(page, 2); } };
  await waitFor(page, () => window.__ui && __ui.input, null, 60000);
  const [v, out] = await journey(page, press, { pad: true });
  out.device = await page.evaluate(() => [__ui.input.lastDevice, __ui.input.pad?.kind]);
  out.legend = await page.evaluate(() => document.querySelector('#pause .legend')?.textContent.trim());
  // a hard landing rumbles the pad (haptics: land)
  out.rumble = await page.evaluate(() => { const r0 = __pad.rumbles; __medina.game.emit('land', { hard: true, speed: 9 }); return __pad.rumbles - r0; });
  await ctx.close();
  const ok = v === true && out.device[0] === 'gamepad' && out.device[1] === 'xbox' && out.rumble === 1 && !errors.length;
  return [ok || (v !== true ? v : `pad ${JSON.stringify(out.device)} rumble ${out.rumble} errors ${errors.slice(0, 2).join(' | ')}`), out];
});

await scenario('storage', async () => {
  const init = () => { for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[k] = function () { throw new DOMException('denied', 'SecurityError'); }; };
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}`, init });
  await ready(page); await frames(page, 3);
  const out = await page.evaluate(async () => {
    const r = { available: __ui.storage.available };
    r.glyph = !document.querySelector('#title .store').classList.contains('hidden');
    // settings live in memory and apply
    __ui.setSetting('grain', 30); __ui.setSetting('invertTilt', true);
    r.settings = { grain: __medina.game.settings.grain, invertTilt: __medina.game.settings.invertTilt, saved: __ui.save.data.settings.grain };
    // playable: new journey, walk
    __ui.mainAction('new');
    await new Promise((res) => { const t = () => (__medina.game.mode === 'play' ? res() : setTimeout(t, 50)); t(); });
    r.mode = __medina.game.mode;
    // the save code round-trips through the data tab
    const d = __ui.save.data;
    Object.assign(d, { chapter: 'night', cp: 3, unlocked: ['souk', 'sundown', 'night'], cps: { souk: 6, sundown: 10, night: 3 }, completed: false });
    d.stats.playSec = 1234; d.stats.deaths = 17;
    const { encodeSave, decodeSave } = await import('/src/ui/settings.js');
    const code = encodeSave(d);
    __ui.settings.open(); __ui.settings.setTab(4); __ui.settings.exportCode();
    r.shown = document.querySelector('#settings .code input').value === code;
    __ui.settings.closeCode(true); __ui.save.reset();
    r.afterReset = `${__ui.save.data.chapter}/${__ui.save.data.cp}`;
    __ui.settings.importCode();
    __ui.settings.applyCode(code);
    const s = __ui.save.data;
    r.code = code; r.len = code.length;
    r.back = `${s.chapter}/${s.cp}/${s.unlocked.join(',')}/${s.cps.sundown}/${s.stats.deaths}`;
    r.bad = decodeSave(code.slice(0, -2) + 'xx') === null && decodeSave('nonsense') === null;
    let threw = false; try { localStorage.getItem('x'); } catch { threw = true; }
    r.lsThrows = threw;
    return r;
  });
  await ctx.close();
  const ok = out.available === false && out.glyph && out.settings.grain === 30 && out.settings.invertTilt === true && out.settings.saved === 30 && out.mode === 'play'
    && out.shown && out.afterReset === 'souk/0' && out.back === 'night/3/souk,sundown,night/10/17' && out.bad && out.lsThrows && out.len <= 160 && !errors.length;
  return [ok || `storage ${JSON.stringify(out)} ${errors.slice(0, 2).join(' | ')}`, out];
});

await scenario('persist', async () => {
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}` });
  await ready(page); await frames(page, 2);
  await page.evaluate(() => { localStorage.clear(); __ui.save.load(); });
  // through the settings screen: graphics → film grain left ×4, accessibility → menu text size right, controls → crawl toggle
  await page.evaluate(() => __ui.settings.open());
  await frames(page, 2);
  const row = async (tab, k) => page.evaluate(([t, k]) => { __ui.settings.setTab(t); const r = document.querySelector(`#settings .row[data-k="${k}"]`); __ui.focus.set(r); return !!r; }, [tab, k]);
  await row(0, 'grain'); await key(page, 'ArrowLeft', 4);
  await row(3, 'menuScale'); await key(page, 'ArrowRight');
  await row(2, 'crawlMode'); await key(page, 'Enter');
  await row(1, 'volumes.sfx'); await key(page, 'ArrowLeft', 3);
  await page.waitForTimeout(800); // settings are written 500 ms after the last change
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('medina.save.v1') || 'null')?.settings);
  await page.reload(); await ready(page); await frames(page, 2);
  const after = await page.evaluate(() => ({ S: { grain: __ui.S.grain, menuScale: __ui.S.menuScale, crawlMode: __ui.S.crawlMode, sfx: __ui.S.volumes.sfx },
    applied: { grain: __medina.game.settings.grain, crawl: __ui.input.settings.crawlMode, scale: getComputedStyle(document.getElementById('ui')).getPropertyValue('--menu-scale').trim(), sfx: __medina.game.settings.volumes?.sfx } }));
  // a save holding only settings is no journey: continue stays hidden and new journey has the focus; a checkpoint
  // shows it, reset progress hides it again
  after.cont = await page.evaluate(() => {
    const c = document.querySelector('#title .entry[data-k="continue"]'), r = { exists: __ui.save.exists, hidden: c.hidden, focus: __ui.focus.current?.dataset.k };
    __ui.save.data.cp = 2; __ui.save.write(); __ui.fillMain(); r.withCp = !c.hidden;
    __ui.settings.resetProgress(); r.afterReset = c.hidden; r.focusAfter = __ui.focus.current?.dataset.k;
    return r;
  });
  await page.evaluate(() => localStorage.clear());
  await ctx.close();
  const ok = after.S.grain === 40 && after.S.menuScale === 125 && after.S.crawlMode === 'toggle' && after.S.sfx === 7
    && after.applied.grain === 40 && after.applied.crawl === 'toggle' && after.applied.scale === '1.25' && after.applied.sfx === 7
    && after.cont.exists && after.cont.hidden && after.cont.focus === 'new' && after.cont.withCp && after.cont.afterReset && after.cont.focusAfter === 'new' && !errors.length;
  return [ok || `persist ${JSON.stringify({ before, after })} ${errors.slice(0, 2).join(' | ')}`, { before, after }];
});

await scenario('autostart', async () => {
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}&autostart=1` });
  await ready(page); await frames(page, 3);
  const out = await page.evaluate(() => ({ mode: __medina.game.mode, top: __ui.focus.top?.el.id || null, main: document.getElementById('title').hidden, menuOpen: __medina.game.menuOpen, title: __medina.game.titleShown }));
  await ctx.close();
  return [out.mode === 'play' && !out.top && out.main && !out.menuOpen && !out.title && !errors.length ? true : `autostart ${JSON.stringify(out)}`, out];
});

await scenario('menubg', async () => {
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}` });
  await ready(page); await frames(page, 4);
  const menu = await page.evaluate(() => { const rs = __medina.game.world.rs; return { cap: Math.round(rs.stats.cap), internal: [...rs.post.stats.internal], full: [rs.w, rs.h], vignette: +rs.post.params.vignette.toFixed(2) }; });
  // Esc rests the title (the scene pauses under the menu): its freeze-frame redraws (resizes) keep the same depth
  await key(page, 'Escape'); await frames(page, 3);
  const rest = [await page.evaluate(() => (__medina.game.paused ? +__medina.game.world.rs.post.params.vignette.toFixed(2) : 'not paused'))];
  for (const w of [940, 960]) { await page.setViewportSize({ width: w, height: 540 }); await frames(page, 3); rest.push(await page.evaluate(() => +__medina.game.world.rs.post.params.vignette.toFixed(2))); }
  menu.rest = rest;
  await page.evaluate(() => __ui.mainAction('new'));
  await waitFor(page, () => __medina.game.mode === 'play');
  await frames(page, 4);
  const play = await page.evaluate(() => { const rs = __medina.game.world.rs; return { cap: Math.round(rs.stats.cap), internal: [...rs.post.stats.internal], full: [rs.w, rs.h], vignette: +rs.post.params.vignette.toFixed(2) }; });
  await ctx.close();
  const half = Math.abs(menu.internal[0] - menu.full[0] / 2) <= 2 && Math.abs(menu.internal[1] - menu.full[1] / 2) <= 2;
  const ok = menu.cap === 30 && half && play.cap !== 30 && play.internal[0] > menu.internal[0] && menu.vignette > play.vignette && menu.rest.every((v) => v === menu.vignette) && !errors.length;
  return [ok || `menu background ${JSON.stringify({ menu, play })}`, { menu, play }];
});

await scenario('chapters', async () => {
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}&unlock=1` });
  await ready(page); await frames(page, 3);
  await page.evaluate(() => { const d = __ui.save.data; d.cps = { souk: 6, sundown: 0 }; });
  for (let i = 0; i < 8 && (await focused(page)) !== 'chapters'; i++) await key(page, 'ArrowDown');
  await key(page, 'Enter');
  const cards = await page.evaluate(() => [...document.querySelectorAll('.ccard')].map((c) => `${c.dataset.id}${c.classList.contains('off') ? ':locked' : ''}`));
  // the souk: confirm opens its checkpoints, → twice picks checkpoint 2, confirm starts there behind the card
  for (let i = 0; i < 4 && (await page.evaluate(() => __ui.focus.current?.dataset.id)) !== 'souk'; i++) await key(page, 'ArrowLeft');
  await key(page, 'Enter');
  await key(page, 'ArrowRight', 2);
  const picking = await page.evaluate(() => [__ui.chapters.pickId, __ui.chapters.pickCp]);
  const cards0 = await page.evaluate(() => { window.__cards = []; const h = __medina.game.hooks.card; __medina.game.hooks.card = (m, o) => { window.__cards.push([m.id, o.reason]); return h(m, o); }; });
  await key(page, 'Enter');
  await waitFor(page, () => __medina.game.mode === 'play' || (__medina.game.mode === 'intro' && !__medina.game.held));
  const out = await page.evaluate(() => ({ chapter: __medina.chapter(), cp: __medina.state().cp, cards: window.__cards, top: __ui.focus.top?.el.id || null }));
  await ctx.close();
  const ok = cards.length === 4 && picking[0] === 'souk' && picking[1] === 2 && out.chapter === 'souk' && out.cp === 2 && out.cards.length === 1 && out.cards[0][1] === 'select' && !out.top && !errors.length;
  return [ok || `chapters ${JSON.stringify({ cards, picking, out, errors: errors.slice(0, 2) })}`, { cards, picking, ...out }];
});

await scenario('crawl', async () => {
  // crawl set to toggle: menu navigation never latches it, a down-press in play does, and a down-press while the
  // boy holds something (the souk's crate; a lab mirror when Sunwork is present) tilts or does nothing, never latches
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}&autostart=1&nosave=1&chapter=souk&cp=0` });
  await ready(page); await waitFor(page, () => __medina.game.mode === 'play');
  const st = () => page.evaluate(() => { const G = __medina.game; return { latch: G.input.crawlLatch, y: G.input.state.y, crawling: G.player.crawling, grip: !!G.player.grip, mode: G.mode, top: __ui.focus.top?.el.id || null }; });
  await page.evaluate(() => { __ui.setSetting('crawlMode', 'toggle'); __medina.teleport(4, 0, 1); });
  await frames(page, 4);
  const out = {};
  // the pause menu: one ↓ to "restart checkpoint", confirm; the boy comes back standing
  await key(page, 'Escape');
  await waitFor(page, () => __ui.focus.top?.el.id === 'pause', null, 30000);
  await key(page, 'ArrowDown');
  out.menu = { focus: await focused(page), ...(await st()) };
  await key(page, 'Enter');
  await waitFor(page, () => __medina.game.mode === 'play' && !__medina.game.paused && !__ui.focus.top, null, 60000);
  await frames(page, 8);
  out.respawn = await st();
  // in play the toggle works: ↓ latches the crouch, ↓ again lets it go
  await key(page, 'ArrowDown'); await frames(page, 8);
  out.on = await st();
  await key(page, 'ArrowDown'); await frames(page, 8);
  out.off = await st();
  // holding the crate: ↓ never latches, and letting go leaves him standing
  await page.evaluate(() => __medina.teleport(35.6, 0, 1)); await frames(page, 3);
  await page.keyboard.down('ShiftLeft'); await page.keyboard.down('ArrowRight');
  await waitFor(page, () => !!__medina.game.player.grip, null, 20000).catch(() => {});
  await page.keyboard.up('ArrowRight'); await frames(page, 2);
  await key(page, 'ArrowDown'); await frames(page, 6);
  out.crate = await st();
  await page.keyboard.up('ShiftLeft'); await frames(page, 8);
  out.crateLet = await st();
  // a gripped mirror (only when the Sunwork lab is present): one ↓ tap steps exactly one notch
  await page.goto(`${BASE}?${Q}&autostart=1&nosave=1&chapter=lab&cp=3`); await ready(page); await waitFor(page, () => __medina.game.mode === 'play');
  const lab = await page.evaluate(() => !!__medina.ext?.light?.()?.mirrors?.some((m) => m.id === 'M2'));
  if (lab) {
    await page.evaluate(() => { __ui.setSetting('crawlMode', 'toggle'); const m = __medina.game.level.light.get('M2'); __medina.teleport(m.body.x - (m.body.w / 2 + 0.2), 0, 1); });
    await frames(page, 6);
    await page.keyboard.down('ShiftLeft');
    await waitFor(page, () => !!__medina.game.player.grip?.mirror, null, 20000).catch(() => {});
    await waitFor(page, () => __medina.ext.light().mirrors.find((m) => m.id === 'M2').settled, null, 20000).catch(() => {});
    const n0 = await page.evaluate(() => __medina.ext.light().mirrors.find((m) => m.id === 'M2').notch);
    await key(page, 'ArrowDown'); await page.waitForTimeout(1500); await frames(page, 4);
    const m1 = await page.evaluate(() => __medina.ext.light().mirrors.find((m) => m.id === 'M2'));
    out.mirror = { n0, n1: m1.notch, ...(await st()) };
    await page.keyboard.up('ShiftLeft'); await frames(page, 8);
    out.mirrorLet = await st();
  } else out.mirror = 'no Sunwork mirrors on this tree';
  await ctx.close();
  const ok = out.menu.focus === 'checkpoint' && !out.menu.latch && !out.respawn.latch && !out.respawn.crawling && out.respawn.y === 0
    && out.on.latch && out.on.crawling && !out.off.latch && !out.off.crawling
    && out.crate.grip && !out.crate.latch && !out.crate.crawling && !out.crateLet.latch && !out.crateLet.crawling
    && (!lab || (Math.abs(out.mirror.n1 - out.mirror.n0) === 1 && !out.mirror.latch && !out.mirrorLet.crawling)) && !errors.length;
  return [ok || `crawl ${JSON.stringify(out)} ${errors.slice(0, 2).join(' | ')}`, out];
});

await scenario('hints', async () => {
  // a first journey in the souk: walking into the sack pile shows the jump glyph, a jump ends it and the save keeps
  // it; idling by the crate shows grab; a pause hides the glyph and lists the controls; a wall too high for a jump
  // shows nothing
  const { page, ctx, errors } = await open({ url: `${BASE}?${Q}&autostart=1&nosave=1&chapter=souk&cp=0` });
  await ready(page); await waitFor(page, () => __medina.game.mode === 'play');
  const hint = () => page.evaluate(() => { const h = document.querySelector('#hints .hint:not(.out)'); return h ? { glyph: h.dataset.glyph, opacity: +h.style.opacity, html: h.innerHTML.length } : null; });
  const out = {};
  await page.evaluate(() => __medina.teleport(7.2, 0, 1)); await frames(page, 4);
  await page.keyboard.down('ArrowRight');
  await waitFor(page, () => document.querySelector('#hints .hint:not(.out)')?.dataset.glyph === 'jump', null, 20000).catch(() => {});
  await page.waitForTimeout(700); await frames(page, 3); // it fades in
  out.jump = await hint();
  // a pause holds it out of sight and shows the controls
  await page.keyboard.up('ArrowRight');
  await key(page, 'Escape'); await waitFor(page, () => __ui.focus.top?.el.id === 'pause', null, 30000); await frames(page, 3);
  out.paused = { hint: await hint(), ctl: await page.evaluate(() => [...document.querySelectorAll('#pause .ctl em')].map((e) => e.textContent).join(' ')) };
  await key(page, 'Escape'); await waitFor(page, () => !__medina.game.paused && !__ui.focus.top, null, 30000);
  await page.keyboard.down('ArrowRight'); await frames(page, 4);
  out.resumed = await hint();
  await key(page, 'Space'); await page.keyboard.up('ArrowRight'); await frames(page, 6);
  out.afterJump = { hint: await hint(), seen: await page.evaluate(() => !!__ui.save.data.seenHints['ctx:jump']) };
  // the crate at his side
  await page.evaluate(() => __medina.teleport(36.45, 0, 1)); await frames(page, 2);
  await waitFor(page, () => document.querySelector('#hints .hint:not(.out)')?.dataset.glyph === 'grab', null, 20000).catch(() => {});
  await page.waitForTimeout(700); await frames(page, 3);
  out.grab = await hint();
  // the terrace wall (3.1 m) with no crate: no jump glyph
  await page.evaluate(() => { __medina.game.level.crateA.setState({ x: 30, y: 0 }); __ui.save.data.seenHints['ctx:grab'] = true; delete __ui.save.data.seenHints['ctx:jump']; __ui.hints.hide(); __medina.teleport(41.7, 0, 1); });
  await page.keyboard.down('ArrowRight'); await page.waitForTimeout(2500); await frames(page, 2);
  out.wall = await hint();
  await page.keyboard.up('ArrowRight');
  // the crate pushed to its foot: now a jump reaches the crate's top, and the glyph shows
  await page.evaluate(() => { __medina.game.level.crateA.setState({ x: 41.5, y: 0 }); __medina.teleport(40.3, 0, 1); });
  await page.keyboard.down('ArrowRight');
  await waitFor(page, () => document.querySelector('#hints .hint:not(.out)')?.dataset.glyph === 'jump', null, 15000).catch(() => {});
  out.crateStep = await hint();
  await page.keyboard.up('ArrowRight');
  await ctx.close();
  const ok = out.jump?.glyph === 'jump' && out.jump.opacity > 0.5 && out.jump.html > 20 && out.paused.hint?.opacity === 0 && out.paused.ctl === 'move jump grab climb crawl'
    && out.resumed?.glyph === 'jump' && out.resumed.opacity > 0 && !out.afterJump.hint && out.afterJump.seen && out.grab?.glyph === 'grab' && out.grab.opacity > 0.5 && !out.wall && out.crateStep?.glyph === 'jump' && !errors.length;
  return [ok || `hints ${JSON.stringify(out)} ${errors.slice(0, 2).join(' | ')}`, out];
});

// ------------------------------------------------------------------ builds served from disk
function serve(dir, root = { dir }) {
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root.dir, p);
    if (!f.startsWith(root.dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ port: server.address().port, root, close: () => new Promise((c) => server.close(c)) })));
}

await scenario('artifact', async () => {
  execSync('npm run build:artifact', { cwd: new URL('.', ROOT), stdio: 'pipe' });
  const dir = new URL('dist-artifact/', ROOT).pathname;
  const mb = fs.statSync(path.join(dir, 'medina.html')).size / 1048576;
  // the host page puts test.html in a sandboxed frame (scripts only: an opaque origin, no storage, no workers)
  fs.writeFileSync(path.join(dir, 'host.html'), '<!doctype html><html><body style="margin:0;background:#fff"><iframe id="f" src="test.html" sandbox="allow-scripts" allow="autoplay" style="border:0;width:960px;height:540px"></iframe></body></html>');
  const srv = await serve(dir);
  const { page, ctx } = await open({ w: 980, h: 560 });
  const messages = [];
  page.on('console', (m) => { if (m.type() === 'error') messages.push(m.text()); });
  page.on('pageerror', (e) => messages.push(`pageerror: ${e.message}`));
  try {
    await page.goto(`http://127.0.0.1:${srv.port}/host.html`);
    const frame = () => page.frames().find((f) => f.url().endsWith('/test.html'));
    await page.waitForFunction(() => true);
    let f = null; for (let i = 0; i < 100 && !(f = frame()); i++) await page.waitForTimeout(100);
    await f.waitForFunction(() => window.__ready === true && window.__medina && window.__medina.game.mode !== 'loading', null, { timeout: 300000, polling: 200 });
    const st = await f.evaluate(async () => {
      let sw = 'none';
      try { sw = navigator.serviceWorker ? (await navigator.serviceWorker.getRegistrations()).length : 'none'; } catch { sw = 'refused'; }
      return { chapter: __medina.chapter(), mode: __medina.game.mode, menu: __ui.focus.top?.el.id, origin: self.origin, storage: __ui.storage.available, sw, controller: (() => { try { return !!navigator.serviceWorker?.controller; } catch { return false; } })(), scripts: document.scripts.length, external: [...document.querySelectorAll('script[src],link[href]')].map((e) => e.src || e.href) };
    });
    // a minute of the title and a start, still without errors
    await f.evaluate(() => __ui.mainAction('new'));
    await f.waitForFunction(() => __medina.game.mode === 'play', null, { timeout: 120000 });
    await page.waitForTimeout(1500);
    const out = { mb: +mb.toFixed(2), ...st, errors: messages.slice(0, 4) };
    const ok = mb <= 3 && st.chapter === 'souk' && st.menu === 'title' && st.origin === 'null' && st.storage === false && (st.sw === 'none' || st.sw === 'refused' || st.sw === 0) && !st.controller && !st.external.length && !messages.length;
    return [ok || `artifact ${JSON.stringify(out)}`, out];
  } finally { await ctx.close(); await srv.close(); }
});

await scenario('hosted', async () => {
  execSync('npx vite build --logLevel warn', { cwd: new URL('.', ROOT), stdio: 'pipe' });
  const dir = new URL('dist/', ROOT).pathname;
  const srv = await serve(dir);
  const { page, ctx, errors } = await open({ w: 800, h: 450 });
  try {
    const url = `http://127.0.0.1:${srv.port}/?${Q}&nosave=1`;
    await page.goto(url); await ready(page);
    const cdp = await ctx.newCDPSession(page);
    const manifest = await page.evaluate(async () => { const l = document.querySelector('link[rel=manifest]'); const m = await (await fetch(l.href)).json(); return { name: m.name, display: m.display, start: m.start_url, icons: m.icons.map((i) => `${i.sizes}:${i.purpose}`) }; });
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.ready.then(() => true), null, { timeout: 60000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    let installable = null;
    for (let i = 0; i < 20; i++) { const r = await cdp.send('Page.getInstallabilityErrors'); installable = r.installabilityErrors.map((e) => e.errorId); if (!installable.length) break; await page.waitForTimeout(500); }
    const iconsOk = await page.evaluate(async () => (await Promise.all(['icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png'].map(async (u) => (await fetch(u)).ok))).every(Boolean));
    // the second load is controlled; then the network goes away and the page reloads from the cache
    await page.reload(); await ready(page);
    const controlled = await page.evaluate(() => !!navigator.serviceWorker.controller);
    await ctx.setOffline(true);
    await page.reload(); await ready(page);
    const offline = await page.evaluate(() => ({ online: navigator.onLine, mode: __medina.game.mode, chapter: __medina.chapter(), font: document.fonts.check('300 20px "Cormorant Garamond"') }));
    await ctx.setOffline(false);
    // a deploy while the tab is open: the next build renames a chapter chunk; once its worker takes over, the open
    // tab still gets the chunk it knows (the previous version's cache stays), though the server no longer has it
    const next = fs.mkdtempSync(path.join(os.tmpdir(), 'medina-next-'));
    fs.cpSync(dir, next, { recursive: true });
    const chunk = fs.readdirSync(path.join(next, 'assets')).find((f) => /^sundown-.*\.js$/.test(f));
    fs.renameSync(path.join(next, 'assets', chunk), path.join(next, 'assets', chunk.replace(/-[^-]+\.js$/, '-n3xtbuild.js')));
    const sw = fs.readFileSync(path.join(next, 'sw.js'), 'utf8');
    fs.writeFileSync(path.join(next, 'sw.js'), sw.replace(/medina-[0-9a-f]{12}/, 'medina-0nextbuild00').replace(chunk, chunk.replace(/-[^-]+\.js$/, '-n3xtbuild.js')));
    // …and changes an unhashed file (the manifest): the new version serves the new one, not the previous cache's
    const mf = JSON.parse(fs.readFileSync(path.join(next, 'manifest.webmanifest'), 'utf8'));
    fs.writeFileSync(path.join(next, 'manifest.webmanifest'), JSON.stringify({ ...mf, x_build: 'next' }));
    srv.root.dir = next;
    const deploy = await page.evaluate(async (chunk) => {
      const reg = await navigator.serviceWorker.getRegistration();
      const changed = new Promise((r) => { navigator.serviceWorker.addEventListener('controllerchange', () => r(true), { once: true }); setTimeout(() => r(false), 30000); });
      await reg.update();
      const took = await changed;
      // the tab switches workers when the new one starts activating: its activate step (the cache clean-up) ends later
      const w = navigator.serviceWorker.controller;
      if (w && w.state !== 'activated') await new Promise((r) => { w.addEventListener('statechange', () => w.state === 'activated' && r()); setTimeout(r, 30000); });
      const res = await fetch(`./assets/${chunk}`);
      const mf = await (await fetch('./manifest.webmanifest')).json();
      return { took, caches: (await caches.keys()).filter((k) => k.startsWith('medina-')).length, oldChunk: res.status, manifest: mf.x_build || 'previous' };
    }, chunk);
    srv.root.dir = dir; fs.rmSync(next, { recursive: true, force: true });
    const out = { manifest, installable, iconsOk, controlled, offline, deploy, errors: errors.filter((e) => !/net::ERR_INTERNET_DISCONNECTED/.test(e)).slice(0, 3) };
    const ok = manifest.display === 'standalone' && manifest.icons.includes('512x512:maskable') && iconsOk && !installable.length && controlled && offline.online === false && offline.chapter === 'souk' && offline.font
      && deploy.took && deploy.caches === 2 && deploy.oldChunk === 200 && deploy.manifest === 'next' && !out.errors.length;
    return [ok || `hosted ${JSON.stringify(out)}`, out];
  } finally { await ctx.close(); await srv.close(); }
});

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
