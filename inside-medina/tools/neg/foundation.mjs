// Foundation contract checks (FULL_GAME §11.2 acceptance 5, 6, 8, 9, 10):
//   node tools/negative.mjs --suite foundation
// The chain into the next chapter and Continue, a throwing localStorage, the
// title shot's shadow focus, the LookDirector round trip and the boot budget.
import fs from 'fs';
import http from 'http';
import { execSync } from 'child_process';
import { gameUrl, waitReady, ROOT } from '../lib/harness.mjs';

const baseline = JSON.parse(fs.readFileSync(new URL('docs/baselines/souk.json', ROOT), 'utf8'));
// seeded Math.random (the baselines were shot with it) and, once the test sets
// __fixedRaf, rAF timestamps that advance exactly 1/60 s per frame
const FIXED = () => {
  let s = 12345; Math.random = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  let t = null; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((now) => { t = window.__fixedRaf && t !== null ? t + 1000 / 60 : now; cb(t); });
};

// fraction of differing pixels between two PNGs (base64), decoded in the page
async function diff(page, a, b, thr = 24) {
  return page.evaluate(async ([a, b, thr]) => {
    const load = async (d) => { const bm = await createImageBitmap(await (await fetch('data:image/png;base64,' + d)).blob()); const c = new OffscreenCanvas(bm.width, bm.height); const x = c.getContext('2d'); x.drawImage(bm, 0, 0); return x.getImageData(0, 0, bm.width, bm.height); };
    const A = await load(a), B = await load(b);
    if (A.width !== B.width || A.height !== B.height) return { error: 'size' };
    let n = 0, sum = 0;
    for (let i = 0; i < A.data.length; i += 4) {
      const d = Math.max(Math.abs(A.data[i] - B.data[i]), Math.abs(A.data[i + 1] - B.data[i + 1]), Math.abs(A.data[i + 2] - B.data[i + 2]));
      sum += d; if (d > thr) n++;
    }
    const px = A.data.length / 4;
    return { differing: +(n / px * 100).toFixed(3), meanAbs: +(sum / px / 255 * 100).toFixed(3) };
  }, [a, b, thr]);
}
const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

export const scenarios = [
  {
    // §11.2 acceptance 5: souk cp 6 + finale -> chapterEnd -> card -> sundown; the save points at sundown; ?continue=1 lands there
    name: 'chain souk -> sundown and continue', cp: 6, query: { nosave: null },
    run: async ({ page, o }) => {
      const r = await page.evaluate(async () => {
        const M = __medina, G = M.game;
        const cards = [];
        const hook = G.hooks.card;
        G.hooks.card = (m, opts) => { cards.push({ id: m.id, reason: opts.reason, numeral: m.numeral }); return hook(m, opts); };
        M.finale();
        for (let i = 0; i < 40 * 120 && G.mode !== 'chapterEnd' && G.mode !== 'loading'; i++) M.sim(1 / 120, { x: 0 });
        const atEnd = { mode: G.mode, z: M.state().z };
        await G.events.next('chapterStart');
        await new Promise((r) => { const f = () => (G.mode === 'play' ? r() : setTimeout(f, 50)); f(); });
        const ev = M.events().filter((e) => ['chapterEnd', 'chapterStart', 'save'].includes(e.name)).map((e) => ({ name: e.name, ...e.data }));
        return { atEnd, cards, chapter: M.chapter(), mode: G.mode, save: M.save(), stored: JSON.parse(localStorage.getItem('medina.save.v1') || 'null'), ev, cardVisible: !document.getElementById('card').classList.contains('hidden') };
      });
      await page.goto(gameUrl({ ...o, chapter: null, cp: undefined }, { continue: 1, nosave: null }));
      await waitReady(page);
      r.continued = await page.evaluate(() => ({ chapter: __medina.chapter(), cp: __medina.state().cp, mode: __medina.game.mode }));
      return { ...r, stored: r.stored && { chapter: r.stored.chapter, cp: r.stored.cp, unlocked: r.stored.unlocked } };
    },
    check: (r) => {
      const end = r.ev.find((e) => e.name === 'chapterEnd');
      if (!end || end.id !== 'souk' || end.next !== 'sundown') return `no chapterEnd souk -> sundown: ${JSON.stringify(r.ev)}`;
      if (!r.cards.length || r.cards[0].id !== 'sundown' || r.cards[0].reason !== 'chain') return `no card for sundown: ${JSON.stringify(r.cards)}`;
      if (r.chapter !== 'sundown' || r.mode !== 'play') return `sundown not playing: ${r.chapter} ${r.mode}`;
      if (r.save.chapter !== 'sundown' || r.save.cp !== 0) return `save is ${r.save.chapter}/${r.save.cp}`;
      if (!r.stored || r.stored.chapter !== 'sundown' || r.stored.cp !== 0) return `localStorage holds ${JSON.stringify(r.stored)}`;
      if (r.continued.chapter !== 'sundown') return `continue landed in ${r.continued.chapter}`;
      return true;
    },
  },
  {
    // §11.2 acceptance 6: localStorage throwing: boots, plays to a checkpoint, saves in memory, no errors
    name: 'storage throwing: plays, saves in memory', cp: 0, query: { nosave: null },
    init: () => { for (const k of ['getItem', 'setItem', 'removeItem', 'clear', 'key']) Storage.prototype[k] = function () { throw new DOMException('denied', 'SecurityError'); }; },
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game;
      M.sim(1, { x: 0 });
      M.teleport(31.6, 0);
      for (let i = 0; i < 10 * 120 && M.state().cp < 1; i++) M.sim(1 / 120, { x: 1 });
      G.save.flush(true);
      const mem = G.save.store.get('medina.save.v1');
      let lsThrows = false; try { localStorage.getItem('x'); } catch { lsThrows = true; }
      return { cp: M.state().cp, x: M.state().x, available: G.save.store.available, saved: mem && JSON.parse(mem).cp, lsThrows, save: M.save().cp };
    }),
    check: (r) => (r.lsThrows && r.available === false && r.cp >= 1 && r.saved === r.cp && r.save === r.cp ? true : `storage fallback ${JSON.stringify(r)}`),
  },
  {
    // §11.2 acceptance 8: on the title shot the sun's shadow camera follows the camera's look (it was pinned to x 188)
    name: 'title shot shadow focus', query: { autostart: null, hold: null }, fresh: true,
    run: async ({ page }) => {
      await frames(page, 6);
      return page.evaluate(() => { const G = __medina.game; const t = G.world.light.sun.target.position; const look = G.camRig.curLook; return { mode: G.mode, title: G.titleShown, target: [+t.x.toFixed(2), +t.y.toFixed(2), +t.z.toFixed(2)], lookX: +look.x.toFixed(2) }; });
    },
    check: (r) => (r.mode === 'intro' && r.title && Math.abs(r.target[0] - r.lookX) <= 10 && Math.abs(r.target[0] - 188) > 50 ? true : `shadow focus ${JSON.stringify(r)}`),
  },
  {
    // §11.2 acceptance 9: apply('night') then apply('goldenHour') returns to the pre-refactor picture.
    // Animation time is pinned (rAF steps of exactly 1/60 s once ready, game time 20 -> 20.4) as for look480-fixed.png.
    name: 'look round trip night -> golden', w: 480, h: 270, query: { tex: 0.5, tier: 'high', hold: null }, init: FIXED,
    run: async ({ page }) => {
      await frames(page, 2);
      await page.evaluate(() => { window.__fixedRaf = true; });
      await frames(page, 2);
      await page.evaluate(() => { const G = __medina.game; G.time = 20; __medina.photo(20, 1.5, 1, 0.4); G.time = 20.4; });
      await frames(page, 3);
      const before = (await page.screenshot()).toString('base64');
      await page.evaluate(() => __medina.game.director.apply('night'));
      await frames(page, 3);
      const night = (await page.screenshot()).toString('base64');
      await page.evaluate(() => { __medina.game.director.apply('goldenHour'); __medina.game.time = 20.4; });
      await frames(page, 3);
      const after = (await page.screenshot()).toString('base64');
      const ref = fs.readFileSync(new URL('docs/baselines/souk/look480-fixed.png', ROOT)).toString('base64');
      return { roundTrip: await diff(page, before, after), nightChanged: await diff(page, before, night), vsBaseline: await diff(page, ref, after), beforeVsBaseline: await diff(page, ref, before) };
    },
    check: (r) => (r.roundTrip.differing < 1 && r.nightChanged.differing > 20 && r.vsBaseline.differing < 1 ? true : `round trip ${JSON.stringify(r)}`),
  },
  {
    // §11.2 acceptance 10: boot to __ready within the baseline + 10 %, and the loading bar paints at least 10 values
    name: 'boot budget and loading bar', url: false,
    run: async ({ page, o }) => {
      await page.addInitScript(() => {
        let r; Object.defineProperty(window, '__ready', { configurable: true, set(v) { r = v; window.__readyAt = performance.now(); }, get() { return r; } });
        window.__painted = new Set();
        const tick = () => { const i = document.querySelector('#loading .lbar i'); if (i && i.style.width) window.__painted.add(i.style.width); if (!window.__readyAt) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      const runs = [];
      for (let k = 0; k < 3; k++) {
        await page.goto(gameUrl({ ...o, chapter: null, cp: undefined }, { hold: null }));
        await waitReady(page);
        runs.push(await page.evaluate(() => ({ ms: Math.round(window.__readyAt), painted: [...window.__painted] })));
      }
      const ms = runs.map((x) => x.ms).sort((a, b) => a - b);
      return { readyMs: ms, median: ms[1], budget: Math.round(baseline.boot.readyMs.warm * 1.1), baselineWarm: baseline.boot.readyMs.warm, painted: runs[1].painted.length, values: runs[1].painted.join(' ') };
    },
    check: (r) => (r.median <= r.budget && r.painted >= 10 ? true : `boot ${r.median} ms (budget ${r.budget}), ${r.painted} painted values`),
  },
  {
    // §8.2: a lost and restored GL context re-bakes the surfaces and reloads the chapter at its checkpoint
    name: 'context loss and restore', cp: 1, w: 480, h: 270,
    run: async ({ page }) => {
      const settle = () => page.waitForFunction(() => __medina.game.mode === 'play' && __medina.game.fade < 0.001, null, { timeout: 120000, polling: 100 });
      await page.evaluate(() => __medina.photo(34, 0, 1, 0.2));
      await settle(); await frames(page, 3);
      const before = (await page.screenshot()).toString('base64');
      await page.evaluate(async () => {
        const ext = __medina.game.world.rs.renderer.getContext().getExtension('WEBGL_lose_context');
        ext.loseContext();
        await new Promise((r) => setTimeout(r, 400));
        const started = __medina.game.events.next('chapterStart');
        ext.restoreContext();
        await started;
      });
      await settle();
      await page.evaluate(() => __medina.photo(34, 0, 1, 0.2));
      await frames(page, 3);
      const after = (await page.screenshot()).toString('base64');
      const ev = await page.evaluate(() => __medina.events().filter((e) => /context|chapterStart/.test(e.name)).map((e) => e.name));
      return { ev, cp: await page.evaluate(() => __medina.state().cp), diff: await diff(page, before, after) };
    },
    check: (r) => (r.ev.includes('contextLost') && r.ev.includes('contextRestored') && r.cp === 1 && r.diff.differing < 3 ? true : `context recovery ${JSON.stringify(r)}`),
  },
  {
    // §11.2 acceptance 11 (only with --artifact: it rebuilds dist-artifact): the single-file build boots in its test page
    name: 'artifact build reaches __ready', url: false, optIn: 'artifact', w: 640, h: 360,
    run: async ({ page }) => {
      execSync('npm run build:artifact', { cwd: new URL('.', ROOT), stdio: 'pipe' });
      const dir = new URL('dist-artifact/', ROOT);
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
      const server = http.createServer((req, res) => {
        const f = new URL('.' + decodeURIComponent(req.url.split('?')[0]), dir);
        if (!f.href.startsWith(dir.href) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'content-type': types[f.pathname.slice(f.pathname.lastIndexOf('.'))] || 'application/octet-stream' });
        fs.createReadStream(f).pipe(res);
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', r));
      try {
        const t0 = Date.now();
        await page.goto(`http://127.0.0.1:${server.address().port}/test.html`);
        await waitReady(page);
        const st = await page.evaluate(() => ({ chapter: __medina.chapter(), mode: __medina.game.mode, lights: __medina.lights() }));
        const kb = Math.round((fs.statSync(new URL('game.js', dir)).size + fs.statSync(new URL('medina.html', dir)).size) / 1024);
        return { ...st, readySec: +((Date.now() - t0) / 1000).toFixed(1), kb };
      } finally { server.close(); }
    },
    check: (r) => (r.chapter === 'souk' && r.mode === 'intro' ? true : `artifact ${JSON.stringify(r)}`),
  },
];
