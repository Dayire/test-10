// Foundation contract checks (FULL_GAME §11.2 acceptance 5, 6, 8, 9, 10):
//   node tools/negative.mjs --suite foundation [--base-port N | --absolute]
// The chain into the next chapter and Continue, a throwing localStorage, the
// title shot's shadow focus, the LookDirector round trip, the boot budget, and
// the flow negatives: a cinematic's look and mix leave with it, the title holds
// the chapter, a dev chapter's end keeps the save, the loader serialises,
// recovers and drops chapter-lived subscriptions, a chain whose import fails
// retries and then titles, restart chapter equals a fresh start, the title's
// lamp sweeps harmlessly, x-keyed looks swap baked env maps.
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import net from 'net';
import { execSync, spawn } from 'child_process';
import { fileURLToPath } from 'url';
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
// The pre-foundation tree (the commit souk.json was recorded on) served by its own Vite on a free port, so the
// boot budget is timed against it under the same machine load. The tree is extracted once into the OS temp dir.
async function startBaseServer() {
  const ref = (baseline.recorded.match(/HEAD ([0-9a-f]{7,40})/) || [])[1];
  if (!ref) throw new Error('souk.json names no base commit');
  const root = fileURLToPath(ROOT);
  const dir = path.join(os.tmpdir(), `medina-base-${ref}`);
  if (!fs.existsSync(path.join(dir, 'index.html'))) {
    const prefix = execSync('git rev-parse --show-prefix', { cwd: root, encoding: 'utf8' }).trim().replace(/\/$/, '');
    const top = execSync('git rev-parse --show-toplevel', { cwd: root, encoding: 'utf8' }).trim();
    fs.mkdirSync(dir, { recursive: true });
    // from the top level: run in a subdirectory, git archive would keep only that subdirectory of the tree
    execSync(`git archive --format=tar ${ref}${prefix ? ':' + prefix : ''} | tar -x -C "${dir}"`, { cwd: top, stdio: 'pipe' });
  }
  if (!fs.existsSync(path.join(dir, 'node_modules'))) fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  const port = await new Promise((res, rej) => { const srv = net.createServer(); srv.on('error', rej); srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); }); });
  // its own dependency cache: the shared node_modules/.vite belongs to the main dev server
  const cfg = path.join(dir, 'vite.base.config.mjs');
  fs.writeFileSync(cfg, `import base from './vite.config.js';\nexport default { ...base, cacheDir: '.vite-base', server: { ...(base.server || {}), host: '127.0.0.1', port: ${port}, strictPort: true, hmr: false } };\n`);
  const child = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--config', cfg, '--clearScreen', 'false'], { cwd: dir, stdio: 'ignore' });
  const stop = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
  process.once('exit', stop);
  const t0 = Date.now();
  while (Date.now() - t0 < 60000) {
    const ok = await new Promise((r) => { http.get(`http://127.0.0.1:${port}/`, (res) => { res.resume(); r(res.statusCode === 200); }).on('error', () => r(false)); });
    if (ok) return { port, ref, stop };
    if (child.exitCode !== null) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  stop();
  throw new Error(`base tree ${ref} did not serve`);
}

const frames = (page, n = 3) => page.evaluate((n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);

export const scenarios = [
  {
    // §11.2 acceptance 5: souk cp 6 + finale -> chapterEnd -> card -> sundown; the save points at sundown; ?continue=1 lands there
    // The finale's letterbox and its faded mix must not follow the boy into the next chapter.
    name: 'chain souk -> sundown and continue', cp: 6, query: { nosave: null },
    run: async ({ page, o }) => {
      await page.mouse.click(4, 4); // a user gesture: the audio context may run
      const r = await page.evaluate(async () => {
        const M = __medina, G = M.game, A = G.audio, P = G.world.rs.post.params;
        A.start(); if (A.ctx?.state === 'suspended') await A.ctx.resume().catch(() => {});
        await new Promise((r) => setTimeout(r, 2700)); // the start ramp
        const gain = () => (A.master ? +A.master.gain.value.toFixed(3) : null);
        const before = gain();
        const cards = [];
        const hook = G.hooks.card;
        G.hooks.card = (m, opts) => { cards.push({ id: m.id, reason: opts.reason, numeral: m.numeral }); return hook(m, opts); };
        M.finale();
        let lbFinale = 0;
        for (let i = 0; i < 40 * 120 && G.mode !== 'chapterEnd' && G.mode !== 'loading'; i++) { M.sim(1 / 120, { x: 0 }); lbFinale = Math.max(lbFinale, G.director.ov.letterbox || 0); }
        const atEnd = { mode: G.mode, z: M.state().z };
        let atReveal = null;
        const off = G.events.on('chapterStart', () => { atReveal = gain(); });
        await G.events.next('chapterStart'); off();
        await new Promise((r) => { const f = () => (G.mode === 'play' ? r() : setTimeout(f, 50)); f(); });
        await new Promise((r) => setTimeout(r, 2500)); // the reveal fades the mix back in over 1.5 s
        const mix = { ctx: A.ctx?.state ?? null, before, atReveal, after: gain(), muted: !!A.muted };
        const look = { lbFinale: +lbFinale.toFixed(3), letterbox: P.letterbox, cur: G.director.cur.letterbox ?? null, ov: Object.keys(G.director.ov) };
        const ev = M.events().filter((e) => ['chapterEnd', 'chapterStart', 'save'].includes(e.name)).map((e) => ({ name: e.name, ...e.data }));
        return { atEnd, cards, chapter: M.chapter(), mode: G.mode, save: M.save(), stored: JSON.parse(localStorage.getItem('medina.save.v1') || 'null'), ev, cardVisible: !document.getElementById('card').classList.contains('hidden'), mix, look };
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
      if (!(r.look.lbFinale > 0.05) || r.look.letterbox !== 0 || r.look.ov.length) return `the finale's letterbox followed into sundown: ${JSON.stringify(r.look)}`;
      if (r.mix.ctx !== 'running') return `the audio context never ran (${r.mix.ctx}): the mix cannot be checked`;
      if (!(r.mix.before > 0.8) || !(r.mix.atReveal < 0.85) || !(r.mix.after > 0.8)) return `the mix after the chain: ${JSON.stringify(r.mix)}`;
      return true;
    },
  },
  {
    // a cinematic stopped early (restart chapter, title) takes its look with it; the title returns to the checkpoint
    name: 'restart and title mid-finale', cp: 6,
    run: async ({ page }) => {
      await page.mouse.click(4, 4);
      return page.evaluate(async () => {
        const M = __medina, G = M.game, A = G.audio, P = G.world.rs.post.params, D = G.director;
        A.start(); if (A.ctx?.state === 'suspended') await A.ctx.resume().catch(() => {});
        const frames = (n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        const gain = () => (A.master ? +A.master.gain.value.toFixed(3) : null);
        const look = () => ({ letterbox: +P.letterbox.toFixed(3), cur: D.cur.letterbox ?? null, ov: Object.keys(D.ov).length, sunY: +D.sunDir.y.toFixed(3) });
        await wait(2700); // the start ramp
        const out = { sunY0: +D.sunDir.y.toFixed(3), gain0: gain() };
        // 1. restart chapter after the walk has faded the mix out
        M.finale();
        for (let i = 0; i < 40 * 120 && !G.cinema?.done; i++) M.sim(1 / 120, { x: 1 });
        await frames(2); await wait(1500);
        out.faded = { mode: G.mode, done: !!G.cinema?.done, gain: gain(), ...look() };
        const cp0 = M.save().cp;
        await G.restartChapter(); await frames(3); await wait(2000);
        out.restart = { mode: G.mode, x: M.state().x, z: M.state().z, gain: gain(), saveCp: [cp0, M.save().cp], ...look() };
        // 2. the title in the middle of the walk
        M.checkpoint(6); M.finale(); M.sim(6, { x: 1 }); await frames(2);
        out.walking = { mode: G.mode, z: M.state().z, ...look() };
        G.params.autostart = undefined;
        await G.toTitle(); await frames(2);
        out.title = { mode: G.mode, x: M.state().x, z: M.state().z, cinema: !!G.cinema, scripted: !!G.player.scripted, title: !document.getElementById('title').classList.contains('hidden'), ...look() };
        G.beginPlay(); M.sim(0.3, { x: 0 });
        out.play = { mode: G.mode, x: M.state().x, cp: M.state().cp };
        G.params.autostart = '1';
        return out;
      });
    },
    check: (r) => {
      if (!r.faded.done || !(r.faded.letterbox > 0.05)) return `the walk never reached its end fade: ${JSON.stringify(r.faded)}`;
      if (r.restart.saveCp[0] !== 6 || r.restart.saveCp[1] !== 0) return `Continue after restart chapter returns to cp ${r.restart.saveCp[1]} (was ${r.restart.saveCp[0]})`;
      if (r.restart.mode !== 'play' || Math.abs(r.restart.x - 1.5) > 0.2 || r.restart.letterbox !== 0 || r.restart.cur || r.restart.ov || r.restart.sunY !== r.sunY0) return `restart chapter kept the finale's look: ${JSON.stringify(r.restart)}`;
      if (r.faded.gain !== null && (!(r.gain0 > 0.8) || !(r.faded.gain < 0.85) || !(r.restart.gain > 0.8))) return `restart chapter left the mix faded: ${r.faded.gain} -> ${r.restart.gain}`;
      if (!(r.walking.letterbox > 0)) return `no letterbox during the walk: ${JSON.stringify(r.walking)}`;
      if (r.title.mode !== 'intro' || r.title.cinema || r.title.scripted || !r.title.title || Math.abs(r.title.x - 186.2) > 0.2 || r.title.z !== 0 || r.title.letterbox !== 0) return `title mid-finale: ${JSON.stringify(r.title)}`;
      if (r.play.mode !== 'play' || r.play.cp !== 6) return `play after the title: ${JSON.stringify(r.play)}`;
      return true;
    },
  },
  {
    // the title over a chase: the chapter goes back to its checkpoint and holds, so the guard never catches the boy
    name: 'title during the chase holds', cp: 5,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game;
      M.sim(1.0, { x: 1 });
      const chase = M.state().extra.guard;
      G.params.autostart = undefined;
      await G.toTitle();
      // exactly what frame() runs under the title
      const Z = { x: 0, y: 0, jump: false, grab: false, pause: false, any: false, pointer: null };
      const modes = new Set();
      for (let i = 0; i < 6 * 120; i++) { G.fixed(1 / 120, Z, true); G.time += 1 / 120; modes.add(G.mode); }
      const out = { chase, guard: M.state().extra.guard, x: M.state().x, modes: [...modes], deaths: G.stats.deaths, title: G.titleShown, visible: !document.getElementById('title').classList.contains('hidden') };
      G.beginPlay(); M.sim(0.5, { x: 0 });
      out.after = { mode: G.mode, title: G.titleShown, fading: G.titleFade !== undefined || document.getElementById('title').classList.contains('hidden') };
      G.params.autostart = '1';
      return out;
    }),
    check: (r) => (r.chase === 'chase' && r.guard === 'hidden' && Math.abs(r.x - 141.5) < 0.2 && r.modes.length === 1 && r.modes[0] === 'intro' && r.deaths === 0 && r.title && r.visible && r.after.mode === 'play' && !r.after.title && r.after.fading ? true : `title during the chase: ${JSON.stringify(r)}`),
  },
  {
    // the dev lab's end neither rolls the credits nor writes the save; it starts over
    name: 'lab end keeps the save', chapter: 'lab', cp: 0,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game;
      const save0 = M.save();
      M.teleport(26, 0);
      for (let i = 0; i < 10 * 120 && G.mode === 'play'; i++) M.sim(1 / 120, { x: 1 });
      const endMode = G.mode;
      await new Promise((r) => { const t0 = performance.now(); const f = () => (G.mode === 'play' || performance.now() - t0 > 15000 ? r() : setTimeout(f, 50)); f(); });
      const ev = M.events().filter((e) => ['chapterEnd', 'credits', 'chapterStart'].includes(e.name)).map((e) => `${e.name}:${e.data.id ?? ''}${e.data.dev ? ':dev' : ''}`);
      const s = M.save();
      return { endMode, mode: G.mode, chapter: M.chapter(), x: M.state().x, ev, save0: { chapter: save0.chapter, completed: save0.completed, unlocked: save0.unlocked }, save: { chapter: s.chapter, cp: s.cp, completed: s.completed, unlocked: s.unlocked }, end: !document.getElementById('end').classList.contains('hidden') };
    }),
    check: (r) => (r.endMode === 'chapterEnd' && r.mode === 'play' && r.chapter === 'lab' && Math.abs(r.x - 1.5) < 0.3 && r.ev.includes('chapterEnd:lab:dev') && !r.ev.some((e) => e.startsWith('credits')) && !r.end
      && !r.save.completed && r.save.chapter === r.save0.chapter && !r.save.unlocked.includes('lab') ? true : `lab end: ${JSON.stringify(r)}`),
  },
  {
    // overlapping loads run one at a time in call order; chapter-lived subscriptions go with the chapter;
    // a failed import uncovers the old chapter; a failed build falls back to the souk under the title
    name: 'loader serialises and recovers', chapter: 'lab', cp: 0,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game, Ld = G.loader;
      const CHAPTERS = M.registry;
      const out = {};
      // 1. three loads at once
      const orig = Ld._load; let active = 0, maxActive = 0;
      Ld._load = async function (...a) { active++; maxActive = Math.max(maxActive, active); try { return await orig.apply(this, a); } finally { active--; } };
      const starts = [];
      const off = G.events.on('chapterStart', (d) => starts.push(d.id));
      await Promise.all(['sundown', 'night', 'lab'].map((id) => G.loadChapter(id, 0, { reason: 'restart' })));
      off(); Ld._load = orig;
      out.serial = { maxActive, starts, chapter: M.chapter(), busy: Ld.busy === null ? null : 'set' };
      // 2. subscriptions through the kit live as long as the chapter
      const counts = () => ({ death: G.events.map.get('death')?.size ?? 0, frame: G.hooks.frame.length, ext: typeof G.ext.scopedProbe });
      const base = { id: 'scoped', n: 9, numeral: 'S', glyph: 'rosette', label: 'scoped', next: null, dev: true, exit: '#000000', tone: '#000000' };
      CHAPTERS.push({ ...base, load: async () => ({ default: { ...base, look: 'goldenHour', needs: ['cobbles'], build: (g, kit) => {
        kit.ground(-20, 40); kit.cp(-100, 1.5, 0, 1);
        kit.on('death', () => {}); kit.onFrame(() => {}); kit.registerExt('scopedProbe', () => 1);
        kit.L.dustRegions.push({ x0: -3, x1: 20, y0: 0.2, y1: 4, z0: -1, z1: 1 });
        return kit.L;
      } } }) });
      const c0 = counts();
      await G.loadChapter('scoped', 0, { reason: 'restart' }); const c1 = counts();
      await G.loadChapter('scoped', 0, { reason: 'restart' }); const c2 = counts();
      await G.loadChapter('lab', 0, { reason: 'restart' }); const c3 = counts();
      out.scoped = { c0, c1, c2, c3 };
      // 3. a module that fails to import: the lab stays, uncovered
      CHAPTERS.push({ ...base, id: 'brokenImport', load: () => Promise.reject(new Error('no such module')) });
      const errs = [];
      const offE = G.events.on('loadError', (d) => errs.push(d.id));
      let e1 = null; try { await G.loadChapter('brokenImport', 0, { reason: 'select' }); } catch (e) { e1 = e.message; }
      const cardEl = document.getElementById('card');
      await new Promise((r) => { const t0 = performance.now(); const f = () => ((cardEl.classList.contains('hidden') && G.fade < 0.05) || performance.now() - t0 > 8000 ? r() : setTimeout(f, 50)); f(); }); // the card keeps 2.5 s
      out.importFail = { e1, chapter: M.chapter(), mode: G.mode, level: !!G.level, card: !document.getElementById('card').classList.contains('hidden'), fadeTarget: G.fadeTarget, suspended: G.suspended };
      // 4. a build that throws after the lab was disposed: the souk loads under the title
      CHAPTERS.push({ ...base, id: 'brokenBuild', load: async () => ({ default: { ...base, id: 'brokenBuild', look: 'goldenHour', needs: [], build: () => { throw new Error('build failed'); } } }) });
      G.params.autostart = undefined; // as without ?autostart: the fallback's title waits for input
      let e2 = null; try { await G.loadChapter('brokenBuild', 0, { reason: 'select' }); } catch (e) { e2 = e.message; }
      await new Promise((r) => { const t0 = performance.now(); const f = () => ((M.chapter() === 'souk' && G.mode === 'intro') || performance.now() - t0 > 120000 ? r() : setTimeout(f, 100)); f(); });
      await new Promise((r) => setTimeout(r, 1500));
      offE();
      out.buildFail = { e2, chapter: M.chapter(), mode: G.mode, title: G.titleShown, card: !document.getElementById('card').classList.contains('hidden'), errs };
      G.params.autostart = '1';
      return out;
    }),
    check: (r) => {
      const s = r.serial, c = r.scoped;
      if (s.maxActive !== 1 || s.starts.join() !== 'sundown,night,lab' || s.chapter !== 'lab' || s.busy !== null) return `overlapping loads: ${JSON.stringify(s)}`;
      if (c.c1.death !== c.c0.death + 1 || c.c2.death !== c.c0.death + 1 || c.c3.death !== c.c0.death || c.c1.frame !== c.c0.frame + 1 || c.c2.frame !== c.c0.frame + 1 || c.c3.frame !== c.c0.frame || c.c1.ext !== 'function' || c.c3.ext !== 'undefined') return `scoped subscriptions: ${JSON.stringify(c)}`;
      const i = r.importFail;
      if (!i.e1 || i.chapter !== 'lab' || i.mode !== 'play' || !i.level || i.card || i.fadeTarget !== 0 || i.suspended) return `failed import: ${JSON.stringify(i)}`;
      const b = r.buildFail;
      if (!b.e2 || b.chapter !== 'souk' || b.mode !== 'intro' || !b.title || b.card || b.errs.join() !== 'brokenImport,brokenBuild') return `failed build: ${JSON.stringify(b)}`;
      return true;
    },
  },
  {
    // a chain whose next chapter cannot be imported (a flaky network, a redeploy) never strands the boy in the ended
    // chapter: the import is retried behind the card, then the title comes up in place over that chapter, where
    // pause, play and the finale work again; replaying the finale chains once the import succeeds
    name: 'chain import fails: retry, then title', cp: 6,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game, D = G.director, P = G.world.rs.post.params;
      const CHAPTERS = M.registry;
      const until = (f, ms) => new Promise((r) => { const t0 = performance.now(); const k = () => (f() || performance.now() - t0 > ms ? r() : setTimeout(k, 50)); k(); });
      const card = () => !document.getElementById('card').classList.contains('hidden');
      const def = CHAPTERS.find((c) => c.id === 'sundown'), load = def.load;
      let fails = Infinity, imports = 0;
      def.load = () => { imports++; return fails-- > 0 ? Promise.reject(new TypeError('Failed to fetch dynamically imported module: /src/chapters/sundown/index.js')) : load(); };
      const errs = [];
      const off = G.events.on('loadError', (d) => errs.push(`${d.id}:${d.attempt}`));
      G.params.autostart = undefined; // the title waits for input, as in a real session
      // 1. the import never succeeds
      M.finale();
      for (let i = 0; i < 40 * 120 && G.mode !== 'chapterEnd'; i++) M.sim(1 / 120, { x: 0 });
      const ended = G.mode;
      await until(() => errs.length >= 1, 20000);
      const during = { mode: G.mode, suspended: G.suspended, card: card() };
      G.setPaused(true); during.paused = G.paused; // refused while the card waits for the retry
      await until(() => G.mode === 'intro' && G.titleShown && !card(), 30000);
      await new Promise((r) => setTimeout(r, 300));
      const t = { errs: [...errs], imports, mode: G.mode, title: G.titleShown, chapter: M.chapter(), x: M.state().x, z: M.state().z, cinema: !!G.cinema, scripted: !!G.player.scripted, suspended: G.suspended, fadeTarget: G.fadeTarget, card: card(), titleEl: !document.getElementById('title').classList.contains('hidden'), letterbox: P.letterbox, ov: Object.keys(D.ov).length, save: { chapter: M.save().chapter, cp: M.save().cp } };
      G.setPaused(true); t.pause = G.paused; G.setPaused(false);
      G.beginPlay(); M.sim(0.6, { x: -1 });
      t.play = { mode: G.mode, x: M.state().x };
      // 2. the player walks into the finale again; the import fails once more, then succeeds on the retry
      fails = 1; errs.length = 0;
      M.finale();
      for (let i = 0; i < 40 * 120 && G.mode !== 'chapterEnd'; i++) M.sim(1 / 120, { x: 0 });
      await until(() => M.chapter() === 'sundown' && G.mode === 'play' && !card(), 60000);
      off(); def.load = load; G.params.autostart = '1';
      const r2 = { errs: [...errs], chapter: M.chapter(), mode: G.mode, card: card(), suspended: G.suspended, save: { chapter: M.save().chapter, cp: M.save().cp } };
      return { ended, during, t, r2 };
    }),
    check: ({ ended, during, t, r2 }) => {
      if (ended !== 'chapterEnd') return `the finale never ended: ${ended}`;
      if (during.mode !== 'chapterEnd' || !during.suspended || !during.card || during.paused) return `while retrying: ${JSON.stringify(during)}`;
      if (t.errs.join() !== 'sundown:0,sundown:1,sundown:2' || t.imports !== 3) return `retries: ${JSON.stringify(t.errs)} (${t.imports} imports)`;
      if (t.mode !== 'intro' || !t.title || !t.titleEl || t.chapter !== 'souk' || Math.abs(t.x - 186.2) > 0.2 || t.z !== 0 || t.cinema || t.scripted || t.suspended || t.fadeTarget !== 0 || t.card || t.letterbox !== 0 || t.ov) return `no title over the ended chapter: ${JSON.stringify(t)}`;
      if (!t.pause) return 'pause refused over the fallback title';
      if (t.play.mode !== 'play' || !(t.play.x < 185.5)) return `the boy takes no input after the fallback: ${JSON.stringify(t.play)}`;
      if (t.save.chapter !== 'sundown' || t.save.cp !== 0) return `the save no longer points at the next chapter: ${JSON.stringify(t.save)}`;
      if (r2.errs.join() !== 'sundown:0' || r2.chapter !== 'sundown' || r2.mode !== 'play' || r2.card || r2.suspended) return `a retry that succeeds: ${JSON.stringify(r2)}`;
      return true;
    },
  },
  {
    // restart chapter is a fresh start: prepare(0) runs again over the initial snapshot (it used to be skipped,
    // so a chapter whose prepare(0) moves anything restarted, and then respawned, in the built state)
    name: 'restart chapter equals a fresh start', chapter: 'lab', cp: 0,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game;
      const CHAPTERS = M.registry;
      const { Crate } = await import('/src/game/entities.js');
      const base = { id: 'prepared', n: 9, numeral: 'P', glyph: 'rosette', label: 'prepared', next: null, dev: true, exit: '#000000', tone: '#000000' };
      CHAPTERS.push({ ...base, load: async () => ({ default: { ...base, look: 'goldenHour', needs: ['cobbles', 'wood'], build: (g, kit) => {
        kit.ground(-20, 40); kit.cp(-100, 1.5, 0, 1); kit.cp(10, 10.5, 0, 1);
        const c = new Crate(g, 20, 0, 1.0, { id: 'c' });
        kit.L.entities.push(c);
        kit.L.prepare = (i) => { c.setState({ x: i === 0 ? 6 : 14, y: 0 }); };
        kit.L.extraState = () => ({ crate: +c.body.x.toFixed(2) });
        kit.L.dustRegions.push({ x0: -3, x1: 20, y0: 0.2, y1: 4, z0: -1, z1: 1 });
        return kit.L;
      } } }) });
      const crate = () => M.state().extra.crate;
      const die = () => { G.player.die('fall'); M.sim(3, { x: 0 }); return { crate: crate(), mode: G.mode, x: M.state().x }; };
      const moved = () => G.level.entities[0].setState({ x: 25, y: 0 }); // play moved it
      await G.loadChapter('prepared', 0, { reason: 'restart' });
      const out = { fresh: crate() };
      moved(); out.freshDeath = die();
      moved(); await G.restartChapter(); out.restart = crate();
      moved(); out.restartDeath = die();
      moved(); M.checkpoint(0); out.checkpoint0 = crate();
      M.checkpoint(1); out.checkpoint1 = crate();
      await G.loadChapter('prepared', 1, { reason: 'restart' }); out.fresh1 = crate();
      await G.loadChapter('lab', 0, { reason: 'restart' });
      return out;
    }),
    check: (r) => (r.fresh === 6 && r.freshDeath.crate === 6 && r.freshDeath.mode === 'play' && r.restart === 6 && r.restartDeath.crate === 6 && r.restartDeath.mode === 'play' && r.checkpoint0 === 6 && r.checkpoint1 === 14 && r.fresh1 === 14 ? true : `restart vs fresh: ${JSON.stringify(r)}`),
  },
  {
    // over the title the searchlight keeps sweeping for show and never detects; play resumes from the checkpoint's
    // aim and the shown beam swings back onto it. Restart from checkpoint over the title resumes.
    name: 'title over the courtyard: live, harmless', cp: 3, query: { autostart: null },
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game, S = G.level.searchlight;
      const frames = (n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const snap = G.cpSnap.ents[S.id];
      const Z = { x: 0, y: 0, jump: false, grab: false, pause: false, any: false, pointer: null };
      const shown = [];
      // exactly what frame() runs under the title (?hold=1 keeps rAF from stepping)
      for (let i = 0; i < 12 * 120; i++) { G.fixed(1 / 120, Z, true); G.time += 1 / 120; if (i % 60 === 0) shown.push(+S.show.aim.x.toFixed(2)); }
      await frames(2);
      const title = { mode: G.mode, held: G.held, aim: +S.aim.x.toFixed(2), snapX: +snap.x.toFixed(2), state: S.state, view: +S.viewAim.x.toFixed(2), show: +S.show.aim.x.toFixed(2), deaths: G.stats.deaths, dead: G.player.dead, x: M.state().x };
      const span = Math.max(...shown) - Math.min(...shown);
      G.setPaused(true);
      const rc = G.restartCheckpoint();
      const resumed = { rc, paused: G.paused, mode: G.mode, title: G.titleShown };
      G.beginPlay();
      const t0 = performance.now();
      while (Math.abs(S.viewAim.x - S.aim.x) > 0.01 && performance.now() - t0 < 20000) await frames(1);
      const play = { mode: G.mode, aim: +S.aim.x.toFixed(2), view: +S.viewAim.x.toFixed(2), sec: +((performance.now() - t0) / 1000).toFixed(1) };
      return { title, span, resumed, play };
    }),
    check: ({ title, span, resumed, play }) => {
      if (title.mode !== 'intro' || !title.held || title.aim !== title.snapX || title.state !== 'sweep' || title.deaths || title.dead) return `the title moved the real lamp or killed: ${JSON.stringify(title)}`;
      if (!(span > 10) || Math.abs(title.view - title.show) > 0.01) return `no live sweep under the title (span ${span}): ${JSON.stringify(title)}`;
      if (!resumed.rc || resumed.paused || resumed.mode !== 'intro' || !resumed.title) return `restart checkpoint over the title: ${JSON.stringify(resumed)}`;
      if (play.mode !== 'play' || Math.abs(play.view - play.aim) > 0.02 || play.aim !== title.snapX) return `play did not resume from the checkpoint's aim: ${JSON.stringify(play)}`;
      return true;
    },
  },
  {
    // render plumbing: an off-screen guard holds no pool light and an on-screen one keeps its own lantern look;
    // presets tint the glow sprites; a sky change hands the new environment to GLB templates and scene materials
    name: 'pool range, glow colour, env handover', cp: 5,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game, pool = G.lightPool;
      const frames = (n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const out = { slice: G.world.bakeSlice, software: G.world.software };
      M.sim(1.0, { x: 1 }); // the chase starts: the guard's lantern is on
      const src = G.level.guard.light;
      const holder = () => pool.lights.find((l) => l.userData.src === src);
      M.photo(147, 0, 1, 0.1); await frames(3);
      const h = holder();
      out.near = { guard: M.state().extra.guard, held: !!h, distance: h?.distance, decay: h?.decay, color: h?.color.getHexString(), enabled: src.enabled };
      M.photo(20, 0, 1, 0); await frames(3);
      out.far = { held: !!holder(), enabled: src.enabled, xs: pool.lights.filter((l) => l.userData.src).map((l) => +l.position.x.toFixed(1)), styles: [...new Set(pool.lights.map((l) => `${l.distance}/${l.decay}`))] };
      // glow colour from the preset
      const lan = G.level.lanterns.find((l) => l.sprite);
      G.director.override({ glowColor: '#4080ff' }); await frames(2);
      const tinted = lan.sprite.material.color.getHexString();
      G.director.restore(); await frames(2);
      out.glow = { tinted, back: lan.sprite.material.color.getHexString(), preset: G.director.glowColor.getHexString() };
      // environment handover
      const { Overrides } = await import('/src/assets/library.js');
      const old = G.world.env;
      const tplMat = G.mats.get('brass').clone(); tplMat.envMap = old; tplMat.userData.medina = true;
      const sceneMat = G.mats.get('brass').clone(); sceneMat.envMap = old;
      let any = null; G.root.traverse((o) => { if (!any && o.isMesh) any = o; });
      const tpl = new G.root.constructor(); tpl.add(new any.constructor(any.geometry, tplMat)); // a GLB template outside the scene
      const sm = G.add(new any.constructor(any.geometry, sceneMat)); // a chapter material outside the cache
      Overrides.models.set('__probe', tpl);
      G.director.apply('night'); await frames(1);
      const nightEnv = G.world.env;
      out.env = { rebuilt: nightEnv !== old, tpl: tplMat.envMap === nightEnv, scene: sceneMat.envMap === nightEnv, overridesEnv: Overrides.envMap === null || Overrides.envMap !== old };
      Overrides.models.delete('__probe'); sm.removeFromParent(); tplMat.dispose(); sceneMat.dispose();
      G.director.apply('goldenHour'); await frames(1);
      return out;
    }),
    check: (r) => {
      if (!r.near.held || r.near.distance !== 7 || r.near.decay !== 1.6) return `on-screen guard lantern: ${JSON.stringify(r.near)}`;
      if (r.far.held || !r.far.enabled || r.far.xs.some((x) => x > 100)) return `off-screen guard still holds a pool light: ${JSON.stringify(r.far)}`;
      if (r.glow.tinted === r.glow.back || r.glow.back !== r.glow.preset) return `glow colour: ${JSON.stringify(r.glow)}`;
      if (!r.env.rebuilt || !r.env.tpl || !r.env.scene) return `environment handover: ${JSON.stringify(r.env)}`;
      if (r.software && r.slice !== 200) return `bake slice on a software rasteriser: ${r.slice}`;
      return true;
    },
  },
  {
    // an x-keyed look bakes every key's environment map behind the card; walking the blend swaps them at the
    // half-way point (reflections follow the sky) with no bake and no new program; restart bakes nothing; a new
    // chapter drops the maps it no longer needs
    name: 'x-keyed look swaps the env map', chapter: 'lab', cp: 0,
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game, D = G.director, W = G.world;
      const frames = (n) => new Promise((r) => { const f = () => (n-- <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
      const base = { id: 'xkeys', n: 9, numeral: 'X', glyph: 'rosette', label: 'xkeys', next: null, dev: true, exit: '#000000', tone: '#000000' };
      M.registry.push({ ...base, load: async () => ({ default: { ...base, look: [{ x: 0, preset: 'dawn' }, { x: 30, preset: 'sunrise' }], needs: ['cobbles'], build: (g, kit) => {
        kit.ground(-20, 60); kit.cp(-100, 1.5, 0, 1);
        kit.L.dustRegions.push({ x0: -3, x1: 40, y0: 0.2, y1: 4, z0: -1, z1: 1 });
        return kit.L;
      } } }) });
      let bakes = 0; const bake = W.bakeEnvironment; W.bakeEnvironment = () => { bakes++; return bake(); };
      await G.loadChapter('xkeys', 0, { reason: 'restart' });
      const out = { loadBakes: bakes, envs: D.envs.size };
      bakes = 0;
      const progs = () => W.rs.renderer.info.programs.length;
      const at = async (x) => { M.photo(x, 0, 1, 0.1); await frames(3); return { x, name: D.name, env: W.env, sunI: +W.light.sun.intensity.toFixed(2), progs: progs() }; };
      const a = await at(4), b = await at(26), c = await at(4);
      const brass = G.mats.get('brass');
      out.walk = { a: a.name, b: b.name, c: c.name, swapped: a.env !== b.env, back: a.env === c.env, brass: brass.envMap === W.env, bakes, progs: [a.progs, b.progs, c.progs], sun: [a.sunI, b.sunI] };
      await at(26); await G.restartChapter(); await frames(3);
      out.restart = { bakes, env: W.env === a.env, name: D.name };
      await G.loadChapter('lab', 0, { reason: 'restart' });
      out.lab = { envs: D.envs.size };
      W.bakeEnvironment = bake;
      return out;
    }),
    check: (r) => {
      if (r.envs !== 2) return `x keys baked ${r.envs} maps: ${JSON.stringify(r)}`;
      const w = r.walk;
      if (w.a !== 'dawn' || w.b !== 'sunrise' || w.c !== 'dawn' || !w.swapped || !w.back || !w.brass || w.bakes || new Set(w.progs).size !== 1 || !(w.sun[1] > w.sun[0])) return `walking the blend: ${JSON.stringify(w)}`;
      if (r.restart.bakes || !r.restart.env || r.restart.name !== 'dawn') return `restart: ${JSON.stringify(r.restart)}`;
      if (r.lab.envs !== 1) return `the maps outlived their chapter: ${JSON.stringify(r.lab)}`;
      return true;
    },
  },
  {
    // the old chapter waits while the screen fades out for a load (it used to keep running in play)
    name: 'sim waits while a load fades out', cp: 0, query: { hold: null },
    run: ({ page }) => page.evaluate(async () => {
      const M = __medina, G = M.game;
      const until = (f, ms = 60000) => new Promise((r) => { const t0 = performance.now(); const k = () => (f() || performance.now() - t0 > ms ? r() : setTimeout(k, 20)); k(); });
      const xa = M.state().x;
      M.setInput({ x: 1 });
      await until(() => M.state().x > xa + 0.05); // frames are slow on a loaded machine: wait for the run itself
      const x0 = M.state().x;
      // frames that start while the load is still fading (before mode loading), and x when loading begins
      let fadeFrames = 0, xLoading = null, fading = false;
      const hook = () => { if (fading) fadeFrames++; };
      G.hooks.frame.push(hook);
      const off = G.events.on('mode', (d) => { if (d.mode === 'loading' && xLoading === null) { xLoading = M.state().x; fading = false; } });
      // the card holds the cover until two frames have run, so the window is observed even at a few frames a second
      const card = G.hooks.card;
      G.hooks.card = async (m, o) => { const c = await card(m, o); const f0 = window.__frames; await until(() => window.__frames >= f0 + 2, 30000); return c; };
      fading = true;
      const p = G.startChapter('lab');
      await Promise.resolve();
      const x1 = M.state().x, susp = G.suspended;
      await p;
      G.hooks.card = card;
      off(); G.hooks.frame.splice(G.hooks.frame.indexOf(hook), 1);
      M.setInput(null);
      return { xa, x0, x1, xLoading, fadeFrames, susp, chapter: M.chapter(), after: G.mode, suspended: G.suspended };
    }),
    check: (r) => (r.x0 > r.xa && r.susp && r.fadeFrames >= 1 && r.xLoading === r.x1 && r.chapter === 'lab' && !r.suspended && ['play', 'intro'].includes(r.after) ? true : `fade before a load: ${JSON.stringify(r)}`),
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
    // §11.2 acceptance 10: boot to __ready within the baseline + 10 %, and the loading bar paints at least 10 values.
    // The machine is shared, so by default the pre-foundation tree is served alongside (or --base-port N names a
    // running server of it) and the two trees boot alternately under the same load, after one warm-up boot each:
    // five rounds, so one slow boot on either side moves neither median; the budget is the base median + 10 %.
    // --absolute times against the recorded baseline instead (an idle machine only).
    name: 'boot budget and loading bar', url: false,
    run: async ({ page, o }) => {
      await page.addInitScript(() => {
        let r; Object.defineProperty(window, '__ready', { configurable: true, set(v) { r = v; window.__readyAt = performance.now(); }, get() { return r; } });
        window.__painted = new Set();
        const tick = () => { const i = document.querySelector('#loading .lbar i'); if (i && i.style.width) window.__painted.add(i.style.width); if (!window.__readyAt) requestAnimationFrame(tick); };
        requestAnimationFrame(tick);
      });
      const boot = async (port) => {
        await page.goto(port ? `http://127.0.0.1:${port}/?autostart=1&tex=0.1&tier=low&noauto=1` : gameUrl({ ...o, chapter: null, cp: undefined }, { hold: null }));
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 300000, polling: 100 });
        return page.evaluate(() => ({ ms: Math.round(window.__readyAt), painted: [...window.__painted] }));
      };
      const med = (a) => { const v = a.map((x) => x.ms).sort((x, y) => x - y); return v[Math.floor(v.length / 2)]; };
      let srv = null, ab = o.basePort ? +o.basePort : 0;
      if (!ab && !o.absolute) { srv = await startBaseServer(); ab = srv.port; }
      try {
        if (ab) { await boot(ab); await boot(0); }
        const cur = [], base = [];
        for (let k = 0; k < (+o.rounds || 5); k++) { if (ab) base.push(await boot(ab)); cur.push(await boot(0)); }
        const budget = Math.round((ab ? med(base) : baseline.boot.readyMs.warm) * 1.1);
        return { readyMs: cur.map((x) => x.ms), median: med(cur), budget, against: ab ? `base tree${srv ? ' ' + srv.ref : ''} on ${ab}: ${base.map((x) => x.ms).join(' ')}` : `recorded warm ${baseline.boot.readyMs.warm}`, painted: cur[1].painted.length, values: cur[1].painted.join(' ') };
      } finally { srv?.stop(); }
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
