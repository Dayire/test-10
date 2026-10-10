// Synthesis primitives and instruments, all played through the voice pool.
// oud (Karplus–Strong, buffers cached per pitch), qanun (bright KS + tremolo), ney (breath + vibrato
// sine), darbuka / bendir (doum, tek, ka), singing bowl (partials 1, 2.76, 5.4) and noise / tone hits.
export class Synth {
  constructor(ctx, voices) {
    this.ctx = ctx; this.voices = voices;
    let seed = 7;
    this.rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    this.white = this.noise(2, 'white'); this.pink = this.noise(4, 'pink'); this.brown = this.noise(4, 'brown');
    this.ks = new Map(); this.ksOrder = [];
  }
  noise(sec, kind) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = this.rnd() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    return b;
  }
  src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }
  t(when) { return Math.max(this.ctx.currentTime, when ?? this.ctx.currentTime); }

  // band-limited noise burst
  noiseHit(dest, { f = 1500, q = 1.2, dur = 0.08, gain = 0.3, type = 'bandpass', attack = 0.002, pitchDrop = 0, delay = 0, when, pan = 0, prio = 1, buf } = {}) {
    const t = this.t(when) + delay;
    const v = this.voices.acquire(dest, t, t + dur + 0.05, prio);
    if (!v) return null;
    const s = this.src(buf || this.white); s.playbackRate.value = 0.8 + this.rnd() * 0.4;
    const bf = v.filter; bf.type = type; bf.frequency.setValueAtTime(f, t); bf.Q.setValueAtTime(q, t);
    if (pitchDrop) bf.frequency.exponentialRampToValueAtTime(Math.max(40, f * pitchDrop), t + dur);
    const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(gain, t + attack); g.exponentialRampToValueAtTime(0.0008, t + dur); g.setValueAtTime(0, t + dur + 0.01);
    this.voices.setPan(v, pan);
    this.voices.feed(v, s);
    s.start(t, this.rnd() * 1.5); s.stop(t + dur + 0.05);
    return v;
  }
  tone(dest, { f = 100, f2 = null, dur = 0.2, gain = 0.3, type = 'sine', attack = 0.003, delay = 0, when, pan = 0, prio = 1, lp = 0 } = {}) {
    const t = this.t(when) + delay;
    const v = this.voices.acquire(dest, t, t + dur + 0.05, prio);
    if (!v) return null;
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(gain, t + attack); g.exponentialRampToValueAtTime(0.0008, t + dur); g.setValueAtTime(0, t + dur + 0.01);
    if (lp) { v.filter.type = 'lowpass'; v.filter.frequency.setValueAtTime(lp, t); v.filter.Q.setValueAtTime(0.7, t); }
    this.voices.setPan(v, pan);
    this.voices.feed(v, o, !!lp);
    o.start(t); o.stop(t + dur + 0.05);
    return v;
  }

  // Karplus–Strong string, rendered once per (pitch, brightness) and cached
  ksBuffer(freq, bright = 0.5, dur = 2.4) {
    const key = `${Math.round(freq * 4)}|${Math.round(bright * 20)}|${dur}`;
    let b = this.ks.get(key);
    if (b) return b;
    const ctx = this.ctx, sr = ctx.sampleRate, n = Math.floor(sr * dur);
    b = ctx.createBuffer(1, n, sr); const d = b.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = (this.rnd() * 2 - 1) * (1 - bright * 0.5 + this.rnd() * bright * 0.5);
    let idx = 0, prev = 0;
    const loss = 0.9965 + bright * 0.002;
    for (let i = 0; i < n; i++) {
      const cur = ring[idx], nx = ring[(idx + 1) % period];
      const v = (cur + nx) * 0.5 * loss;
      ring[idx] = v * 0.7 + prev * 0.3 * (1 - bright * 0.2);
      prev = v;
      d[i] = cur * Math.min(1, i / 60);
      idx = (idx + 1) % period;
    }
    this.ks.set(key, b); this.ksOrder.push(key);
    if (this.ksOrder.length > 96) this.ks.delete(this.ksOrder.shift());
    return b;
  }
  pluck(dest, f, { when, gain = 0.25, bright = 0.5, dur = 2.4, pan = 0, body = 900, prio = 2 } = {}) {
    const t = this.t(when);
    const v = this.voices.acquire(dest, t, t + dur, prio);
    if (!v) return null;
    const s = this.src(this.ksBuffer(f, bright));
    v.filter.type = 'peaking'; v.filter.frequency.setValueAtTime(body, t); v.filter.gain.setValueAtTime(5, t); v.filter.Q.setValueAtTime(1.2, t);
    const g = v.env.gain; g.setValueAtTime(gain, t); g.setTargetAtTime(0, t + dur - 0.3, 0.08);
    this.voices.setPan(v, pan);
    this.voices.feed(v, s);
    s.start(t); s.stop(t + dur);
    return v;
  }
  oud(dest, f, o = {}) { return this.pluck(dest, f, { bright: 0.45, body: 900, ...o }); }
  // qanun: bright plucks; a long note is a tremolo of re-plucks of one string, all on one voice
  // (each re-pluck is a buffer source with its own accent and release)
  qanun(dest, f, { when, dur = 0.3, gain = 0.2, pan = 0.2, prio = 2 } = {}) {
    const t = this.t(when);
    if (dur < 0.5) return this.pluck(dest, f, { when: t, gain, bright: 0.85, body: 2400, dur: 1.6, pan, prio });
    const n = Math.min(12, Math.floor(dur * 13)), len = (n - 1) / 13 + 0.9;
    const v = this.voices.acquire(dest, t, t + len, prio);
    if (!v) return null;
    const ctx = this.ctx, buf = this.ksBuffer(f, 0.85);
    v.filter.type = 'peaking'; v.filter.frequency.setValueAtTime(2400, t); v.filter.gain.setValueAtTime(5, t); v.filter.Q.setValueAtTime(1.2, t);
    v.env.gain.setValueAtTime(gain, t); v.env.gain.setValueAtTime(0, t + len);
    for (let i = 0; i < n; i++) {
      const ti = t + i / 13, s = this.src(buf), a = ctx.createGain();
      a.gain.setValueAtTime(i ? 0.55 + 0.1 * Math.sin(i) : 1, ti); a.gain.setTargetAtTime(0, ti + 0.6, 0.08);
      s.connect(a); this.voices.feed(v, a); v.srcs.push(s);
      s.start(ti); s.stop(ti + 0.9);
    }
    this.voices.setPan(v, pan);
    return v;
  }
  // ney: breathy band of noise plus a vibrato sine, soft attack
  ney(dest, f, { when, dur = 1.2, gain = 0.12, pan = -0.1, vib = 5.2 } = {}) {
    const t = this.t(when), ctx = this.ctx;
    const v = this.voices.acquire(dest, t, t + dur + 0.3, 2);
    if (!v) return null;
    const n = this.src(this.white); n.loop = true;
    v.filter.type = 'bandpass'; v.filter.frequency.setValueAtTime(f, t); v.filter.Q.setValueAtTime(14, t);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(f * 0.995, t); o.frequency.linearRampToValueAtTime(f, t + 0.15);
    const lfo = ctx.createOscillator(); lfo.frequency.value = vib; const lg = ctx.createGain();
    lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.008, t + Math.min(0.6, dur * 0.5));
    lfo.connect(lg); lg.connect(o.frequency);
    const og = ctx.createGain(); og.gain.value = 0.55; o.connect(og);
    const g = v.env.gain;
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(gain, t + 0.09); g.setTargetAtTime(gain * 0.8, t + 0.12, 0.3);
    g.setTargetAtTime(0, t + dur, 0.09); g.setValueAtTime(0, t + dur + 0.29);
    this.voices.setPan(v, pan);
    this.voices.feed(v, n); this.voices.feed(v, og, false); v.srcs.push(o, lfo);
    for (const s of [n, o, lfo]) { s.start(t); s.stop(t + dur + 0.3); }
    return v;
  }
  // frame drums. kind: doum (low centre), tek (rim), ka (soft rim), bendir (frame + snare buzz)
  drum(dest, kind, { when, gain = 0.5, pan = 0 } = {}) {
    const t = this.t(when);
    if (kind === 'doum' || kind === 'bendir') {
      const f0 = kind === 'bendir' ? 72 : 95;
      this.tone(dest, { when: t, f: f0, f2: f0 * 0.55, dur: kind === 'bendir' ? 0.45 : 0.3, gain: gain * 0.9, attack: 0.002, pan, prio: 2 });
      this.noiseHit(dest, { when: t, f: 260, q: 0.8, dur: 0.12, gain: gain * 0.35, type: 'lowpass', pan, prio: 2, buf: this.pink });
      if (kind === 'bendir') this.noiseHit(dest, { when: t + 0.004, f: 1800, q: 1.4, dur: 0.22, gain: gain * 0.1, pan, prio: 2 });
    } else {
      const k = kind === 'ka' ? 0.5 : 1;
      this.noiseHit(dest, { when: t, f: 3400, q: 0.9, dur: 0.06, gain: gain * 0.5 * k, type: 'highpass', pan, prio: 2 });
      this.tone(dest, { when: t, f: 1650 + this.rnd() * 80, dur: 0.05, gain: gain * 0.12 * k, pan, prio: 2 });
    }
  }
  // singing bowl: inharmonic partials with slow beating
  bowl(dest, f, { when, gain = 0.2, dur = 5, pan = 0, prio = 2 } = {}) {
    const t = this.t(when), ctx = this.ctx;
    const v = this.voices.acquire(dest, t, t + dur, prio);
    if (!v) return null;
    const g = v.env.gain; g.setValueAtTime(0, t); g.linearRampToValueAtTime(gain, t + 0.006); g.setTargetAtTime(0, t + 0.02, dur / 4.5); g.setValueAtTime(0, t + dur - 0.01);
    for (const [m, a, beat] of [[1, 1, 0.7], [2.76, 0.5, 1.3], [5.4, 0.22, 2.1]]) {
      for (const det of [-1, 1]) {
        const o = ctx.createOscillator(); o.frequency.value = f * m + det * beat * 0.5;
        const og = ctx.createGain(); og.gain.setValueAtTime(a * 0.5, t); og.gain.setTargetAtTime(0, t, dur / (2 + m));
        o.connect(og); this.voices.feed(v, og, false); v.srcs.push(o);
        o.start(t); o.stop(t + dur);
      }
    }
    this.voices.setPan(v, pan);
    return v;
  }
}
