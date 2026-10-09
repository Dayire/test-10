// Audio acceptance tests (FULL_GAME §11.4 P). Offline renders (OfflineAudioContext) for levels and
// coverage, a real-time context under a 4× CPU throttle for scheduler timing.
// Usage: node tools/audio-tests.mjs [--port 5173 | BASE=url] [--sec 20] [--only name,name]
import { chromium } from 'playwright';

const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i < 0 ? d : argv[i + 1]; };
const BASE = process.env.BASE || `http://127.0.0.1:${arg('port', '5173')}/`;
const SEC = +arg('sec', 20);
const only = arg('only', '') ? arg('only').split(',') : null;

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--use-angle=swiftshader'] });
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('ERR_') && !m.text().includes('404')) errors.push(m.text()); });
await page.goto(BASE + 'package.json');
await page.evaluate(async (base) => {
  const mod = await import(base + 'src/core/audio.js');
  window.AudioMod = mod;
  // deterministic randomness for comparable renders
  let seed = 99;
  window.seedRandom = (s) => { seed = s; Math.random = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; }; };
  const SR = 48000;
  // render `sec` seconds: onTick(A, t) runs every dt on the audio clock (OfflineAudioContext.suspend)
  window.renderOffline = async ({ sec, setup, onTick, dt = 0.05, seed = 1 }) => {
    window.seedRandom(seed);
    const ctx = new OfflineAudioContext(2, Math.round(SR * sec), SR);
    const A = new mod.Audio(); A.start(ctx);
    if (setup) setup(A, ctx);
    let err = null;
    const step = (t) => ctx.suspend(t).then(() => {
      try { onTick && onTick(A, t); A.update(dt, A._mix || {}); } catch (e) { err = err || e.message; }
      if (t + dt < sec - 0.01) step(+(t + dt).toFixed(4));
      ctx.resume();
    });
    try { onTick && onTick(A, 0); A.update(dt, A._mix || {}); } catch (e) { err = e.message; }
    step(dt);
    const buf = await ctx.startRendering();
    return { buf, A, err };
  };
  window.measure = (buf, t0 = 0, t1 = Infinity) => {
    let peak = 0, sum = 0, n = 0, nan = 0;
    const a = Math.floor(t0 * buf.sampleRate), b = Math.min(buf.length, Math.floor(t1 * buf.sampleRate));
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = a; i < b; i++) { const v = d[i]; if (!Number.isFinite(v)) { nan++; continue; } const av = Math.abs(v); if (av > peak) peak = av; sum += v * v; n++; }
    }
    const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
    return { nan, peakDb: +db(peak).toFixed(2), rmsDb: +db(Math.sqrt(sum / Math.max(1, n))).toFixed(2) };
  };
}, BASE);

const results = {};
const run = async (name, fn) => {
  if (only && !only.includes(name)) return;
  const t0 = Date.now();
  try { results[name] = await fn(); } catch (e) { results[name] = { ok: false, error: e.message }; }
  results[name].sec = +((Date.now() - t0) / 1000).toFixed(1);
  console.log(name.padEnd(14), JSON.stringify(results[name]));
};

// 1. twenty seconds of every theme with a plausible game mix: no NaN, peak ≤ −1 dBFS, RMS −30…−14 dBFS
await run('themes', async () => page.evaluate(async (sec) => {
  const plans = {
    menu: (t) => ({ music: { state: 'explore' } }),
    souk: (t) => ({ tension: t > 9 ? 1 : 0.2, chase: t > 9 && t < 17, birds: t < 9, height: 1, hum: t > 4 && t < 9 ? 0.6 : 0 }),
    sundown: (t) => ({ music: { state: t > 8 ? 'clock' : 'explore', intensity: Math.max(0, (t - 8) / 12) }, tension: 0.3, loops: { mirrorRoll: t > 3 && t < 6 ? 1 : 0, lockCharge: t > 5 && t < 7 ? { level: 0.8, degree: 2 } : 0 } }),
    night: (t) => ({ music: { state: t > 10 ? 'chase' : 'explore' }, tension: t > 10 ? 1 : 0.4, loops: { tripHum: 1 }, zone: t > 15 ? 'cistern' : 'alley' }),
    dawn: (t) => ({ music: { state: t > 12 ? 'finale' : 'explore' }, birds: Math.min(1, t / 10), drummer: t < 10 ? 1 : 0, height: 8 }),
    credits: (t) => ({ music: { state: 'credits' }, birds: 0.5 }),
  };
  const out = {};
  let ok = true;
  for (const [theme, plan] of Object.entries(plans)) {
    const { buf, err } = await window.renderOffline({
      sec, seed: theme.length * 7,
      setup: (A) => A.setChapter({ theme }),
      onTick: (A, t) => {
        A._mix = plan(t);
        A.setListener(t * 3);
        if (Math.round(t * 20) % 6 === 0) A.play('step', t * 3, { speed: 4 });
        if (Math.abs(t - 5) < 0.026) A.play('land', t * 3, { speed: 8, hard: true });
        if (theme === 'dawn' && Math.abs(t - 12) < 0.026) A.finale();
        if (theme === 'souk' && Math.abs(t - 17.5) < 0.026) A.finale();
      },
    });
    const m = window.measure(buf);
    const pass = !err && m.nan === 0 && m.peakDb <= -1 && m.rmsDb >= -30 && m.rmsDb <= -14;
    ok = ok && pass;
    out[theme] = { ...m, err, pass };
  }
  return { ok, ...out };
}, SEC));

// 2. scheduler onset jitter ≤ 5 ms under a 4× CPU throttle (real-time context, onsets detected by an AudioWorklet)
await run('jitter', async () => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const r = await page.evaluate(async () => {
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    // an onset is the first sample above the threshold after 40 ms below it
    const code = `class Onsets extends AudioWorkletProcessor {
      constructor(){ super(); this.since = 1e9; }
      process(inputs){ const ch = inputs[0][0]; if (!ch) return true;
        for (let i = 0; i < ch.length; i++){
          if (Math.abs(ch[i]) > 0.05) { if (this.since > 0.04 * sampleRate) this.port.postMessage((currentFrame + i) / sampleRate); this.since = 0; }
          else this.since++; }
        return true; } }
      registerProcessor('onsets', Onsets);`;
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([code], { type: 'application/javascript' })));
    const A = new window.AudioMod.Audio(); A.start(ctx);
    A.setVolumes({ amb: 0, sfx: 0 }); A.amb.pad.disconnect(); A.mix.sends.music.gain.value = 0;
    A.master.gain.cancelScheduledValues(0); A.master.gain.value = 0.9;
    const node = new AudioWorkletNode(ctx, 'onsets'); A.mix.out.connect(node);
    const sink = ctx.createGain(); sink.gain.value = 0; node.connect(sink); sink.connect(ctx.destination); // keep the detector pulled
    const onsets = [];
    node.port.onmessage = (e) => onsets.push(e.data);
    A.music.trace = [];
    A.update(0.016, { music: { state: 'test' } });
    // keep the main thread as busy as a heavy game frame: ~8 ms of work per animation frame
    let busy = true;
    const work = () => { const e = performance.now() + 8; while (performance.now() < e) { /* frame work */ } if (busy) requestAnimationFrame(work); };
    requestAnimationFrame(work);
    const upd = setInterval(() => A.update(0.016, { music: { state: 'test' } }), 16);
    await new Promise((res) => setTimeout(res, 8000));
    busy = false; clearInterval(upd); A.music.stop();
    await new Promise((res) => setTimeout(res, 300));
    const tr = A.music.trace.slice(4, -4);
    // match each scheduled click to the nearest detected onset
    const errs = [];
    for (const [intended] of tr) {
      let best = Infinity;
      for (const o of onsets) { const d = o - intended; if (Math.abs(d) < Math.abs(best)) best = d; }
      if (Math.abs(best) < 0.06) errs.push(best * 1000);
    }
    const late = tr.map(([i, w]) => (w - i) * 1000);
    const abs = errs.map(Math.abs).sort((a, b) => a - b);
    const lat = ctx.baseLatency || 0;
    ctx.close();
    return {
      scheduled: tr.length, detected: errs.length, maxLateMs: +Math.max(0, ...late).toFixed(2), lateEvents: late.filter((v) => v > 0.5).length,
      chainLatencyMs: abs.length ? +abs[Math.floor(abs.length / 2)].toFixed(2) : null,
      onsetJitterMs: abs.length ? +(abs[abs.length - 1] - abs[0]).toFixed(2) : null, baseLatency: lat,
      debug: { onsets: onsets.length, firstOnsets: onsets.slice(0, 3), firstTrace: tr.slice(0, 3) },
    };
  });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  return { ...r, ok: r.scheduled > 40 && r.detected >= r.scheduled * 0.9 && r.maxLateMs <= 5 && r.onsetJitterMs <= 5 };
});

// 3. mute survives fadeIn (and a full game mix) — output stays digital silence
await run('muteFadeIn', async () => page.evaluate(async () => {
  const { buf } = await window.renderOffline({
    sec: 4, setup: (A) => { A.setChapter({ theme: 'night' }); A.muted = true; A.fadeIn(1); },
    onTick: (A, t) => { A._mix = { music: { state: 'chase' }, tension: 1 }; if (Math.abs(t - 1) < 0.026) A.fadeIn(0.5); },
  });
  const m = window.measure(buf, 0.05);
  return { ...m, ok: m.rmsDb === -Infinity || m.rmsDb < -100 };
}));

// 4. a UI sound plays while paused; the game buses are ducked
await run('uiWhilePaused', async () => page.evaluate(async () => {
  const quietGame = (A) => { A.setVolumes({ music: 0, sfx: 0, amb: 0 }); };
  const ui = await window.renderOffline({ sec: 3, setup: (A) => { quietGame(A); A.setPaused(true); }, onTick: (A, t) => { if (Math.abs(t - 1) < 0.026) A.ui('confirm'); } });
  const none = await window.renderOffline({ sec: 3, setup: (A) => { quietGame(A); A.setPaused(true); } });
  const game = (p) => window.renderOffline({ sec: 4, seed: 5, setup: (A) => { A.setChapter({ theme: 'souk' }); A.setPaused(p); }, onTick: (A) => { A._mix = { birds: false, tension: 0.2 }; } });
  const playing = window.measure((await game(false)).buf, 2, 4), paused = window.measure((await game(true)).buf, 2, 4);
  const u = window.measure(ui.buf, 1, 1.5), n = window.measure(none.buf, 1, 1.5);
  return { uiRmsDb: u.rmsDb, silentRmsDb: n.rmsDb, gamePlayingDb: playing.rmsDb, gamePausedDb: paused.rmsDb, ok: u.rmsDb > -45 && u.rmsDb - n.rmsDb > 30 && playing.rmsDb - paused.rmsDb > 10 };
}));

// 5. 200 rapid steps leave ≤ 32 voices
await run('voiceCap', async () => page.evaluate(async () => {
  const ctx = new OfflineAudioContext(2, 48000, 48000);
  const A = new window.AudioMod.Audio(); A.start(ctx);
  let maxActive = 0;
  for (let i = 0; i < 200; i++) { A.play('step', i * 0.01, { speed: 4 }); maxActive = Math.max(maxActive, A.voices.active); }
  const s = A.stats;
  const buf = await ctx.startRendering();
  const m = window.measure(buf);
  return { maxActive, after: s.voices, pool: A.voices.pool.length, stolen: s.stolen, started: s.started, nan: m.nan, ok: maxActive <= 32 && s.voices <= 32 && m.nan === 0 };
}));

// 6. every sound name (sfx, loops, stingers, ui, finales) renders without error
await run('allNames', async () => page.evaluate(async () => {
  const { SFX_NAMES, STINGERS, UI_SOUNDS } = window.AudioMod;
  const list = [...SFX_NAMES.map((n) => ['play', n]), ...STINGERS.map((n) => ['stinger', n]), ...UI_SOUNDS.map((n) => ['ui', n])];
  const loops = ['mirrorRoll', 'capstan', 'lockCharge', 'ropeSmoulder', 'tripHum', 'lift', 'hum', 'scrape'];
  const dt = 0.25, sec = list.length * dt + loops.length * 0.5 + 4;
  const failed = [];
  const { buf, err } = await window.renderOffline({
    sec, dt: 0.05, setup: (A) => A.setChapter({ theme: 'sundown' }),
    onTick: (A, t) => {
      const i = Math.round(t / dt);
      if (Math.abs(t - i * dt) < 0.026 && i < list.length) {
        const [kind, name] = list[i];
        try { A[kind](name, A.listenerX + 2, { level: 1, degree: 3, value: 0.5, speed: 6, hard: true, count: 6, sec: 1 }); } catch (e) { failed.push(`${kind}:${name}: ${e.message}`); }
      }
      const j = Math.floor((t - list.length * dt) / 0.5);
      A._mix = { loops: j >= 0 && j < loops.length ? { [loops[j]]: { level: 1, degree: 2 } } : {}, tension: 0.3 };
      if (Math.abs(t - (sec - 3.5)) < 0.026) { A.finale(); }
    },
  });
  const m = window.measure(buf);
  return { names: list.length + loops.length + 1, failed, err, ...m, ok: !failed.length && !err && m.nan === 0 && m.peakDb <= -1 };
}));

// 7. Karplus–Strong buffers are cached per pitch
await run('ksCache', async () => page.evaluate(async () => {
  const ctx = new OfflineAudioContext(2, 4800, 48000);
  const A = new window.AudioMod.Audio(); A.start(ctx);
  const t0 = performance.now(); for (let i = 0; i < 40; i++) A.synth.oud(A.mix.music, 146.83); const first = A.synth.ks.size;
  for (let i = 0; i < 40; i++) A.synth.oud(A.mix.music, 220); const ms = performance.now() - t0;
  return { buffers: A.synth.ks.size, firstPitchBuffers: first, ms: +ms.toFixed(1), ok: first === 1 && A.synth.ks.size === 2 };
}));

const ok = Object.values(results).every((r) => r.ok) && !errors.length;
if (errors.length) console.log('errors:', errors.slice(0, 10));
console.log(ok ? 'AUDIO TESTS PASS' : 'AUDIO TESTS FAIL');
await browser.close();
process.exit(ok ? 0 : 1);
