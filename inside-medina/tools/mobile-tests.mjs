// Touch and mobile acceptance (FULL_GAME §8, §11.4 U): node tools/mobile-tests.mjs [--port 5176] [--only name] [--device name]
// Devices: iPhone 13 portrait and landscape (safe areas of the notch and the home bar), Pixel 7 (a punch-hole
// inset). Touches are real CDP touch events (Input.dispatchTouchEvent), so pointer and touch events, multi-touch
// identifiers and the browser's own hit testing are all exercised. Checks per device:
//   menus      the touch layer is hidden under the menus; every menu target is ≥ 44 px and inside the safe area
//              (the chapter select's checkpoint stepper included: a tap opens it, its arrows step); a tap acts
//              (new journey starts play)
//   controls   jump, grab and ⏸ are ≥ 44 px and inside the safe area; ⏸ opens the pause menu (layer hidden)
//   stick      floating stick: 0.5 of its radius walks, 1.0 runs (the boy's speed); it spawns under the thumb, and
//              stays whole inside the safe area when the thumb lands by the notch or the home bar
//   jump       a tap on jump leaves the ground
//   grab       grab held with the stick pushes the souk's first crate (two fingers at once)
//   lens       the lens shift keeps the boy's projected position inside the play rect above the control band
//   aim        finger aim: a touch on the scene reaches the boy as pin.aimTarget at the touched world point; with the
//              Sunwork lab present (a gripped mirror) the mirror tilts to the touched notch
//   settings   (phones) the tabs sit on one line; a tab opens at its first option (after the previous one was
//              scrolled to its end), with enough rows in view; a list that runs on fades at its edge
// A touch-screen laptop (touch events, a fine mouse pointer, 1280 × 720) runs one check:
//   hybrid     the mouse never drives the hidden touch layer: a drag on the left reaches the scene as the pointer
//              (no stick, no walk, no lens shift, the device stays keyboard), a click in the top-left corner does not
//              pause; the first real touch brings the layer back and grips the stick under it (the boy walks, the
//              scene pointer stays free); a mouse move sends the layer away again; a jump tap whose press and lift
//              land between two frames still jumps
import { devices } from 'playwright';
import { parseArgs, launch } from './lib/harness.mjs';

const o = parseArgs(process.argv.slice(2), { port: 5176 });
const BASE = process.env.BASE || `http://127.0.0.1:${o.port}/`;
const Q = 'tex=0.1&tier=low&noauto=1&nosave=1';
const DEVICES = [
  { name: 'iPhone 13 portrait', d: devices['iPhone 13'], viewport: { width: 390, height: 844 }, insets: { top: 47, bottom: 34, left: 0, right: 0 } },
  { name: 'iPhone 13 landscape', d: devices['iPhone 13 landscape'], viewport: { width: 844, height: 390 }, insets: { top: 0, bottom: 21, left: 47, right: 47 } },
  { name: 'Pixel 7', d: devices['Pixel 7'], viewport: { width: 412, height: 915 }, insets: { top: 26, bottom: 0, left: 0, right: 0 } },
  { name: 'touch laptop', hybrid: true, d: {}, viewport: { width: 1280, height: 720 }, insets: { top: 0, bottom: 0, left: 0, right: 0 } },
].filter((x) => !o.device || x.name.toLowerCase().includes(String(o.device).toLowerCase()));
const only = o.only ? String(o.only).split(',') : null;
const browser = await launch();
const results = [];

const frames = (page, n = 2) => page.evaluate((n) => new Promise((r) => { const f0 = window.__frames || 0, t0 = performance.now(); const t = () => ((window.__frames || 0) >= f0 + n || performance.now() - t0 > 20000 ? r() : requestAnimationFrame(t)); t(); }), n);
const ready = (page) => page.waitForFunction(() => window.__ready === true && window.__medina && window.__medina.game.mode !== 'loading', null, { timeout: 300000, polling: 100 });

async function device(dev) {
  const ctx = await browser.newContext({ ...dev.d, viewport: dev.viewport, screen: dev.viewport, hasTouch: true, isMobile: !dev.hybrid });
  const page = await ctx.newPage();
  // a touch laptop's primary pointer is its fine mouse (emulated touch alone would report a coarse one)
  if (dev.hybrid) await page.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => (/\(pointer:\s*coarse\)/.test(q) ? { matches: false, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } : mm(q)); });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: dev.insets });
  // touches: each call lists every finger still down (CDP semantics); end lifts them all
  const fingers = new Map();
  const touch = async (type, id, x, y) => {
    if (type === 'end') fingers.clear(); else fingers.set(id, { x, y, id, radiusX: 8, radiusY: 8, force: 1 });
    await cdp.send('Input.dispatchTouchEvent', { type: type === 'start' ? 'touchStart' : type === 'move' ? 'touchMove' : 'touchEnd', touchPoints: type === 'end' ? [] : [...fingers.values()] });
  };
  const tap = async (x, y) => { await touch('start', 1, x, y); await frames(page, 1); await touch('end'); await frames(page, 2); };
  const centre = (r) => [r.x + r.w / 2, r.y + r.h / 2];
  const W = dev.viewport.width, H = dev.viewport.height, I = dev.insets;
  const safe = { x0: I.left, y0: I.top, x1: W - I.right, y1: H - I.bottom };
  // visible interactive targets of the open screen (and the touch layer): size and safe-area containment
  const targets = (sel) => page.evaluate((sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null && !e.hidden && getComputedStyle(e).visibility !== 'hidden').map((e) => {
    const b = e.getBoundingClientRect(); const s = e.closest('.rows'); const sb = s?.getBoundingClientRect();
    return { k: e.dataset.k || e.dataset.id || e.className.split(' ')[0] || e.tagName, x: b.x, y: b.y, w: b.width, h: b.height, clipped: sb ? (b.bottom > sb.bottom + 1 || b.top < sb.top - 1) : false };
  }), sel);
  const judge = (list) => {
    const bad = [];
    for (const t of list) {
      if (t.clipped) continue; // scrolled out of its list (it scrolls into view when focused)
      if (t.w < 44 || t.h < 44) bad.push(`${t.k} ${Math.round(t.w)}x${Math.round(t.h)}`);
      if (t.x < safe.x0 - 0.5 || t.y < safe.y0 - 0.5 || t.x + t.w > safe.x1 + 0.5 || t.y + t.h > safe.y1 + 0.5) bad.push(`${t.k} outside safe area @${Math.round(t.x)},${Math.round(t.y)} ${Math.round(t.w)}x${Math.round(t.h)}`);
    }
    return bad;
  };
  const check = (name, ok, evidence) => {
    if (only && !only.some((s) => name.includes(s))) return;
    results.push({ name: `${dev.name}: ${name}`, ok });
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${`${dev.name}: ${name}`.padEnd(34)} ${JSON.stringify(evidence)?.slice(0, 900)}`);
  };
  const want = (n) => (dev.hybrid ? n === 'hybrid' : n !== 'hybrid') && (!only || only.some((s) => n.includes(s)));

  // ------------------------------------------------------------------ menus over the title, then play by a tap
  if (want('menus') || want('controls')) {
    await page.goto(`${BASE}?${Q}`); await ready(page); await frames(page, 4);
    const hidden = await page.evaluate(() => { const t = document.getElementById('touch'); return { exists: !!t, hide: t?.classList.contains('hide'), vis: t && getComputedStyle(t).visibility }; });
    const menuBad = judge(await targets('#title .entry'));
    await page.evaluate(() => __ui.settings.open()); await frames(page, 3); await page.waitForTimeout(600);
    const setBad = [];
    for (let t = 0; t < 5; t++) { await page.evaluate((t) => __ui.settings.setTab(t), t); await frames(page, 2); setBad.push(...judge(await targets('#settings .tab, #settings .rows .item'))); }
    await page.evaluate(() => __ui.focus.close(__ui.settings.screen));
    await page.evaluate(() => __ui.focus.open(__ui.chapters.screen)); await frames(page, 3); await page.waitForTimeout(600);
    const chBad = judge(await targets('#chapters .ccard'));
    // a card with reached checkpoints: a tap opens its stepper, whose arrows are 44 px targets in the safe area and
    // step the checkpoint; the small pips are no touch targets (the card itself starts)
    await page.evaluate(() => { __ui.save.data.cps = { souk: 3 }; __ui.chapters.render(); }); await frames(page, 2); await page.waitForTimeout(500);
    const arch = await page.evaluate(() => { const b = document.querySelector('#chapters .ccard[data-id="souk"] .arch').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await tap(arch.x + arch.w / 2, arch.y + arch.h * 0.35); await page.waitForTimeout(500);
    const stepBad = judge(await targets('#chapters .ccard.picking .cstep .st'));
    const fwd = await page.evaluate(() => { const b = document.querySelector('#chapters .ccard.picking .cstep .st.fwd')?.getBoundingClientRect(); return b && { x: b.x, y: b.y, w: b.width, h: b.height }; });
    if (fwd) await tap(...centre(fwd));
    const step = await page.evaluate(() => {
      const p = document.querySelector('#chapters .ccard.picking .pips i.ok'), b = p?.getBoundingClientRect();
      return { picking: __ui.chapters.pickId, cp: __ui.chapters.pickCp, n: document.querySelectorAll('#chapters .ccard.picking .cstep .st').length, pipInert: !!b && document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2) !== p };
    });
    if (step.n === 2 && (stepBad.length || step.cp !== 1 || !step.pipInert)) chBad.push(`stepper ${JSON.stringify({ stepBad, step })}`);
    else if (step.n !== 2) chBad.push('no checkpoint stepper');
    await page.evaluate(() => __ui.focus.close(__ui.chapters.screen));
    await page.evaluate(() => __ui.confirm({ text: 'begin a new journey?', yes: () => {} })); await frames(page, 2); await page.waitForTimeout(500);
    const cfBad = judge(await targets('#confirm .item'));
    await page.evaluate(() => __ui.focus.close(__ui.confirmS)); await frames(page, 2); await page.waitForTimeout(500);
    // a tap on "new journey" acts
    const nj = await page.evaluate(() => { const b = document.querySelector('#title .entry[data-k="new"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await tap(...centre(nj));
    await page.waitForFunction(() => __medina.game.mode === 'play', null, { timeout: 60000 });
    await frames(page, 4); await page.waitForTimeout(400);
    const shown = await page.evaluate(() => { const t = document.getElementById('touch'); return { hide: t.classList.contains('hide'), vis: getComputedStyle(t).visibility, device: __ui.input.lastDevice }; });
    check('menus', hidden.exists && hidden.hide && hidden.vis === 'hidden' && !menuBad.length && !setBad.length && !chBad.length && !cfBad.length && !shown.hide && shown.vis === 'visible' && shown.device === 'touch',
      { hiddenInMenu: hidden, menuBad, setBad: setBad.slice(0, 4), chBad, cfBad, inPlay: shown });
    // the controls, then ⏸
    const ctl = await page.evaluate(() => { const r = __ui.touch.rects(); return { jump: r.jump, grab: r.grab, pause: r.pause }; });
    const ctlBad = judge(Object.entries(ctl).map(([k, r]) => ({ k, ...r })));
    await tap(...centre(ctl.pause));
    await page.waitForFunction(() => __medina.game.paused && __ui.focus.top?.el.id === 'pause', null, { timeout: 30000 }).catch(() => {});
    await frames(page, 2); await page.waitForTimeout(500);
    const paused = await page.evaluate(() => ({ paused: __medina.game.paused, top: __ui.focus.top?.el.id, hide: document.getElementById('touch').classList.contains('hide') }));
    const pauseBad = judge(await targets('#pause .entry'));
    check('controls', !ctlBad.length && paused.paused && paused.top === 'pause' && paused.hide && !pauseBad.length, { sizes: Object.fromEntries(Object.entries(ctl).map(([k, r]) => [k, [Math.round(r.x), Math.round(r.y), Math.round(r.w)]])), ctlBad, paused, pauseBad });
  }

  // ------------------------------------------------------------------ settings: tabs by real taps
  if (want('settings')) {
    await page.goto(`${BASE}?${Q}`); await ready(page); await frames(page, 4);
    const sb = await page.evaluate(() => { const b = document.querySelector('#title .entry[data-k="settings"]').getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });
    await tap(...centre(sb));
    await page.waitForFunction(() => __ui.focus.top?.el.id === 'settings', null, { timeout: 30000 }); await page.waitForTimeout(700);
    const land = W > H;
    const look = () => page.evaluate(() => {
      const R = document.querySelector('#settings .rows'), rb = R.getBoundingClientRect(), rows = [...R.querySelectorAll('.row')];
      const full = rows.filter((r) => { const b = r.getBoundingClientRect(); return b.top >= rb.top - 1 && b.bottom <= rb.bottom + 1; }).map((r) => r.dataset.k);
      const max = R.scrollHeight - R.clientHeight;
      return { tab: document.querySelector('#settings .tab.active')?.textContent, st: Math.round(R.scrollTop), max, n: rows.length, full: full.length, first: full[0] === rows[0]?.dataset.k,
        lines: new Set([...document.querySelectorAll('#settings .tab')].map((t) => Math.round(t.getBoundingClientRect().top))).size,
        fade: R.classList.contains('below'), track: document.querySelector('#settings .sbar').classList.contains('on') };
    });
    const tabs = [await look()];
    for (let t = 1; t < 5; t++) {
      // the list scrolled to its end, then the next tab by a tap
      await page.evaluate(() => { const R = document.querySelector('#settings .rows'); R.scrollTop = R.scrollHeight; }); await frames(page, 2); await page.waitForTimeout(250);
      const end = await page.evaluate(() => { const R = document.querySelector('#settings .rows'); return { st: Math.round(R.scrollTop), above: R.classList.contains('above'), below: R.classList.contains('below') }; });
      const tb = await page.evaluate((t) => { const b = document.querySelectorAll('#settings .tab')[t].getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; }, t);
      await tap(...centre(tb)); await page.waitForTimeout(400);
      tabs.push({ ...(await look()), prevEnd: end });
    }
    const bad = [];
    tabs.forEach((v, i) => {
      if (v.st !== 0 || !v.first) bad.push(`${v.tab} opens at ${v.st}`);
      if (v.full < Math.min(v.n, land ? 5 : 7)) bad.push(`${v.tab}: ${v.full} rows in view`);
      if (v.lines > (land ? 1 : 2)) bad.push(`${v.tab}: tabs on ${v.lines} lines`);
      if ((v.max > 2) !== v.fade || (v.max > 2) !== v.track) bad.push(`${v.tab}: edge ${JSON.stringify(v)}`);
      if (v.prevEnd && tabs[i - 1].max > 2 && (!v.prevEnd.above || v.prevEnd.below)) bad.push(`${tabs[i - 1].tab} end ${JSON.stringify(v.prevEnd)}`);
    });
    // large menu text on a short screen: the strip scrolls sideways and keeps the chosen tab and its underline in view
    let strip = null;
    if (land) {
      strip = await page.evaluate(async () => {
        __ui.setSetting('menuScale', 150); __ui.settings.setTab(4);
        // the strip scrolls the tab into view, then the underline slides after it (wait for both)
        const raf = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => setTimeout(r, 300)); await raf();
        await Promise.all(document.querySelector('#settings .tabline i').getAnimations().map((x) => x.finished));
        const T = document.querySelector('#settings .tabs').getBoundingClientRect(), a = document.querySelector('#settings .tab.active').getBoundingClientRect();
        const l = document.querySelector('#settings .tabline i').getBoundingClientRect();
        const r = { a: [Math.round(a.left), Math.round(a.width)], l: [Math.round(l.left), Math.round(l.width)], T: [Math.round(T.left), Math.round(T.right)], sl: document.querySelector('#settings .tabs').scrollLeft, inStrip: a.left >= T.left - 1 && a.right <= T.right + 1, line: Math.abs(l.left - a.left) < 2 && Math.abs(l.width - a.width) < 2, lines: new Set([...document.querySelectorAll('#settings .tab')].map((t) => Math.round(t.getBoundingClientRect().top))).size };
        __ui.setSetting('menuScale', 100);
        return r;
      });
      if (!strip.inStrip || !strip.line || strip.lines !== 1) bad.push(`strip ${JSON.stringify(strip)}`);
    }
    check('settings', !bad.length, { bad, tabs: tabs.map((v) => `${v.tab} st${v.st} ${v.full}/${v.n}${v.fade ? ' fade' : ''}${v.track ? ' track' : ''} lines${v.lines}`), strip });
  }

  // ------------------------------------------------------------------ gameplay (deterministic: the sim reads the live touch input)
  if (want('stick') || want('jump') || want('grab') || want('lens')) {
    await page.goto(`${BASE}?${Q}&autostart=1&hold=1&chapter=souk&cp=0`); await ready(page); await frames(page, 3);
    // the sim reads the live input: poll() each step; the sim's own press edges compare with the state of its
    // previous step (the page's frames poll too under ?hold=1, which must not swallow a press)
    const run = (sec) => page.evaluate((sec) => { const G = __medina.game; let vmax = 0, ymax = 0; const n = Math.round(sec * 120); for (let i = 0; i < n; i++) { __medina.sim(1 / 120, () => { const s = G.input.poll(); G.input.state = window.__simPrev || { ...s, jump: false, grab: false, y: 0 }; window.__simPrev = s; return s; }); vmax = Math.max(vmax, Math.abs(G.player.body.vx)); ymax = Math.max(ymax, G.player.y); } return { vx: +G.player.body.vx.toFixed(2), vmax: +vmax.toFixed(2), ymax: +ymax.toFixed(2), x: +G.player.x.toFixed(2), st: G.player.state, inX: +G.input.state.x.toFixed(2) }; }, sec);
    const R = await page.evaluate(() => __ui.touch.radius());
    // jump: a tap on the button, standing in the open street
    await page.evaluate(() => { __medina.teleport(3, 0, 1); }); await run(0.3);
    const jr = await page.evaluate(() => __ui.touch.rects().jump);
    const y0 = await page.evaluate(() => __medina.state().y);
    await touch('start', 2, ...centre(jr)); await frames(page, 1);
    const jumped = await run(0.25);
    await touch('end'); await frames(page, 1);
    await run(0.8);
    check('jump', jumped.ymax > y0 + 0.4, { y0, ymax: jumped.ymax, st: jumped.st });
    // stick: the thumb lands in the left zone, the base appears under it
    const sx = dev.viewport.width > dev.viewport.height ? 140 : 90, sy = H - I.bottom - 150;
    await page.evaluate(() => { __medina.teleport(4, 0, 1); });
    await touch('start', 1, sx, sy); await frames(page, 2);
    const base = await page.evaluate(() => { const b = __ui.touch.base.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]; });
    await touch('move', 1, sx + 0.5 * R, sy); await frames(page, 1);
    const walk = await run(0.8);
    await touch('move', 1, sx + 1.0 * R, sy); await frames(page, 1);
    const runS = await run(0.8);
    await touch('end'); await frames(page, 1);
    const stop = await run(0.4);
    // a thumb by the screen's edge (under the notch in landscape): the base stays whole inside the safe area
    await touch('start', 1, 6, H - 8); await frames(page, 2);
    const edge = await page.evaluate(() => { const b = __ui.touch.base.getBoundingClientRect(); return { x0: b.x, y1: b.y + b.height }; });
    await touch('end'); await frames(page, 1);
    const edgeOK = edge.x0 >= I.left - 0.5 && edge.y1 <= H - I.bottom + 0.5;
    check('stick', Math.abs(base[0] - sx) < 3 && Math.abs(base[1] - sy) < 3 && walk.inX === 0.5 && walk.vx > 0.4 && walk.vx < 2.5 && runS.vmax > 3.9 && runS.inX === 1 && stop.inX === 0 && edgeOK,
      { R, base: base.map(Math.round), walk, run: runS, released: stop.inX, edge: [Math.round(edge.x0), Math.round(edge.y1)] });
    // grab + push: the souk's first crate (36.7–37.7); stick right and grab held together
    await page.evaluate(() => { __medina.teleport(35.6, 0, 1); });
    await run(0.2);
    const cx0 = await page.evaluate(() => __medina.game.level.crateA.body.x);
    const gr = await page.evaluate(() => __ui.touch.rects().grab);
    await touch('start', 1, sx, sy); await touch('move', 1, sx + 0.6 * R, sy); await touch('start', 3, ...centre(gr)); await frames(page, 1);
    const pushing = await run(1.6);
    const grip = await page.evaluate(() => ({ grip: !!__medina.game.player.grip, st: __medina.game.player.animState?.().st, crate: +__medina.game.level.crateA.body.x.toFixed(2), ctx: __ui.touch.el.dataset.ctx, grab: __ui.input.touch.grab }));
    await touch('end'); await frames(page, 1);
    check('grab', grip.crate > cx0 + 0.3 && grip.grab, { cx0, ...grip, x: pushing.x });
    // lens shift: in play the boy's projection sits inside the play rect (portrait: above the control band)
    await page.waitForTimeout(1200); await frames(page, 6);
    const lens = await page.evaluate(() => {
      const G = __medina.game, p = G.player, v = { x: p.x, y: p.y + 0.6, z: 0 };
      const V = new (G.camera.position.constructor)(v.x, v.y, v.z).project(G.camera);
      const px = (V.x * 0.5 + 0.5) * innerWidth, py = (-V.y * 0.5 + 0.5) * innerHeight, r = __ui.playRect();
      return { px: Math.round(px), py: Math.round(py), rect: Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Math.round(v)])), view: !!G.camera.view?.enabled, safeRect: G.camRig.safeRect };
    });
    const inside = lens.px >= lens.rect.x && lens.px <= lens.rect.x + lens.rect.w && lens.py >= lens.rect.y && lens.py <= lens.rect.y + lens.rect.h;
    const centred = Math.abs(lens.py - (lens.rect.y + lens.rect.h / 2)) < lens.rect.h * 0.3;
    check('lens', inside && centred && lens.view, lens);
  }

  // ------------------------------------------------------------------ finger aim
  if (want('aim')) {
    await page.goto(`${BASE}?${Q}&autostart=1&hold=1&chapter=lab&cp=0`); await ready(page); await frames(page, 3);
    const lab = await page.evaluate(() => ({ light: typeof __medina.ext.light === 'function', mirrors: __medina.ext.light?.().mirrors?.length || 0 }));
    let res;
    if (!lab.mirrors) {
      // the stub lab: a touch on the scene must reach the boy as the world point under the finger
      // a point right of the controls' zone, a third of the way down: its world point on the play plane
      const pt = await page.evaluate(() => {
        const G = __medina.game, C = G.camera, V3 = C.position.constructor, sx = innerWidth * 0.62, sy = innerHeight * 0.34;
        const d = new V3((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(C).sub(C.position).normalize();
        const t = -C.position.z / d.z;
        return { want: [+(C.position.x + d.x * t).toFixed(3), +(C.position.y + d.y * t).toFixed(3)], sx, sy, hit: document.elementFromPoint(sx, sy)?.tagName };
      });
      await touch('start', 4, pt.sx, pt.sy); await frames(page, 2);
      // the world point under the finger with the camera of this moment, and the boy's pin from the live input
      const got = await page.evaluate(({ sx, sy }) => {
        const G = __medina.game, C = G.camera, V3 = C.position.constructor;
        const d = new V3((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0.5).unproject(C).sub(C.position).normalize();
        const t = -C.position.z / d.z, want = [C.position.x + d.x * t, C.position.y + d.y * t];
        const prev = G.input.state, st = G.input.poll(); G.input.state = prev;
        const pin = G.makePin(st, true);
        return { want: want.map((v) => +v.toFixed(3)), aim: pin.aimTarget && [+pin.aimTarget.x.toFixed(3), +pin.aimTarget.y.toFixed(3)], kind: st.pointer?.kind, active: st.pointer?.active };
      }, pt);
      await touch('end'); await frames(page, 2);
      const err = got.aim ? Math.hypot(got.aim[0] - got.want[0], got.aim[1] - got.want[1]) : 99;
      res = [got.active && got.kind === 'touch' && err < 0.05 && pt.hit === 'CANVAS', { stub: true, hit: pt.hit, ...got, err: +err.toFixed(4), note: 'lab stub: no mirror on this branch; aimTarget checked' }];
    } else {
      // the Sunwork lab: grip M2 (room "tilt", checkpoint 3), touch the lock L4: the mirror settles on −45°
      await page.evaluate(() => { __medina.checkpoint(3); const m = __medina.game.level.light.get('M2'); __medina.teleport(m.body.x - (m.body.w / 2 + 0.17 + 0.03), 0, 1); });
      const step = (n) => page.evaluate((n) => { const G = __medina.game; for (let i = 0; i < n; i++) __medina.sim(1 / 120, () => { const s = G.input.poll(); G.input.state = window.__simPrev || { ...s, jump: false, grab: false, y: 0 }; window.__simPrev = s; return s; }); }, n);
      await step(60);
      const gr = await page.evaluate(() => __ui.touch.rects().grab);
      await touch('start', 3, ...centre(gr)); await frames(page, 1); await step(6); await touch('end'); await frames(page, 1); await step(30);
      const pt = await page.evaluate(() => { const G = __medina.game; const V = new (G.camera.position.constructor)(56.23, 5.8, 0).project(G.camera); return { sx: (V.x * 0.5 + 0.5) * innerWidth, sy: (-V.y * 0.5 + 0.5) * innerHeight }; });
      await touch('start', 4, pt.sx, pt.sy); await frames(page, 2);
      await step(120);
      const got = await page.evaluate(() => { const G = __medina.game; const m = __medina.ext.light().mirrors.find((q) => q.id === 'M2'); return { alpha: m.alpha, notch: m.notch, settled: m.settled, grip: !!G.player.grip, aim: G.player.aimAt, aiming: __ui.touch.aiming, hit: null }; });
      await touch('end'); await frames(page, 2);
      res = [got.grip && Math.round(got.alpha) === -45, { lab: true, ...got }];
    }
    check('aim', res[0], res[1]);
  }
  // ------------------------------------------------------------------ a touch-screen laptop: a mouse and fingers
  if (want('hybrid')) {
    await page.goto(`${BASE}?${Q}&autostart=1&chapter=souk&cp=0`); await ready(page);
    await page.waitForFunction(() => __medina.game.mode === 'play', null, { timeout: 60000 }); await frames(page, 4);
    const hit = (x, y) => page.evaluate(([x, y]) => { const e = document.elementFromPoint(x, y); return e?.tagName === 'CANVAS' ? 'canvas' : (e?.className?.baseVal ?? e?.className) || e?.tagName; }, [x, y]);
    const ctl = await page.evaluate(() => __ui.touch.rects());
    const st = () => page.evaluate(() => ({ dev: __ui.input.lastDevice, away: __ui.touch.el.classList.contains('away'), stick: !!__ui.touch.stick, tx: __ui.input.touch.x, ptr: __ui.input.pointer.active, kind: __ui.input.pointer.kind, safe: !!__medina.game.camRig.safeRect, paused: __medina.game.paused, top: __ui.focus.top?.el.id || null }));
    const out = { fine: await page.evaluate(() => !!window.__ui?.touch && !matchMedia('(pointer: coarse)').matches) };
    out.before = { ...(await st()), zone: await hit(300, 400), jump: await hit(...centre(ctl.jump)), pause: await hit(...centre(ctl.pause)) };
    // the mouse: a drag on the left of the scene, then a click where the hidden ⏸ sits
    await page.evaluate(() => __medina.teleport(4, 0, 1)); await frames(page, 3);
    const x0 = await page.evaluate(() => __medina.state().x);
    await page.mouse.move(300, 400); await page.mouse.down(); await page.mouse.move(380, 400, { steps: 4 }); await frames(page, 3);
    out.drag = await st();
    await page.waitForTimeout(800); await frames(page, 2);
    out.drag.dx = +(await page.evaluate((x0) => Math.abs(__medina.state().x - x0), x0)).toFixed(2);
    await page.mouse.up(); await frames(page, 2);
    await page.mouse.click(...centre(ctl.pause)); await frames(page, 4);
    out.click = await st();
    // the first touch: the layer comes back and the stick spawns under the thumb
    const x1 = await page.evaluate(() => __medina.state().x);
    await touch('start', 1, 300, 450); await frames(page, 1); await touch('move', 1, 360, 450); await frames(page, 3);
    out.touch = { ...(await st()), base: await page.evaluate(() => { const b = __ui.touch.base.getBoundingClientRect(); return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)]; }) };
    await page.waitForTimeout(800); await frames(page, 2);
    out.touch.dx = +(await page.evaluate((x1) => __medina.state().x - x1, x1)).toFixed(2);
    await touch('end'); await frames(page, 3);
    // a mouse move: the layer steps away and the scene takes the pointer again
    await page.mouse.move(600, 300); await page.mouse.move(640, 320, { steps: 4 }); await frames(page, 2);
    out.mouseBack = { ...(await st()), zone: await hit(300, 400) };
    // a jump tap whose press and lift land between two frames (also the first touch after the mouse)
    await page.evaluate(() => __medina.teleport(4, 0, 1)); await frames(page, 6);
    await page.evaluate(() => { const G = __medina.game; window.__y0 = window.__ymax = G.player.y; G.hooks.frame.push(() => { window.__ymax = Math.max(window.__ymax, G.player.y); }); });
    await touch('start', 2, ...centre(ctl.jump)); await touch('end');
    await page.waitForTimeout(600); await frames(page, 6);
    out.tap = await page.evaluate(() => ({ dy: +(window.__ymax - window.__y0).toFixed(2), dev: __ui.input.lastDevice }));
    const ok = out.fine && out.before.dev === 'keyboard' && out.before.away && out.before.zone === 'canvas' && out.before.jump === 'canvas' && out.before.pause === 'canvas'
      && out.drag.dev === 'keyboard' && !out.drag.stick && out.drag.tx === 0 && out.drag.ptr && out.drag.kind === 'mouse' && out.drag.dx < 0.2 && !out.drag.safe
      && !out.click.paused && !out.click.top
      && out.touch.dev === 'touch' && !out.touch.away && out.touch.stick && out.touch.tx > 0.5 && !out.touch.ptr && Math.abs(out.touch.base[0] - 300) < 3 && Math.abs(out.touch.base[1] - 450) < 3 && out.touch.dx > 0.5
      && out.mouseBack.dev === 'keyboard' && out.mouseBack.away && out.mouseBack.zone === 'canvas' && out.tap.dy > 0.4 && out.tap.dev === 'touch';
    check('hybrid', ok, out);
  }
  if (errors.length) check('no page errors', false, errors.slice(0, 4));
  await ctx.close();
}

for (const dev of DEVICES) await device(dev);
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
