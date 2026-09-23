// Procedural sound design (WebAudio): ambience, foley, mechanisms and music.
export class Audio {
  constructor() {
    this.ctx = null; this.started = false; this.muted = false;
    this.listenerX = 0;
    this.loops = {};
    this.section = 'souk';
  }

  start() {
    if (this.started) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = this.ctx = new AC();
    this.master = ctx.createGain(); this.master.gain.value = 0.0;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3.5;
    this.master.connect(comp); comp.connect(ctx.destination);
    this.master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2.5);
    // reverb
    this.verb = ctx.createConvolver(); this.verb.buffer = this.impulse(2.6, 2.4);
    this.verbGain = ctx.createGain(); this.verbGain.gain.value = 0.32;
    this.verb.connect(this.verbGain); this.verbGain.connect(this.master);
    this.dry = ctx.createGain(); this.dry.connect(this.master);
    this.sfxBus = ctx.createGain(); this.sfxBus.connect(this.dry); this.sfxBus.connect(this.verb);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.0; this.musicBus.connect(this.dry); this.musicBus.connect(this.verb);
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000;
    this.sfxBus.disconnect(); this.sfxBus.connect(this.lowpass); this.lowpass.connect(this.dry); this.lowpass.connect(this.verb);
    this.noiseBuf = this.makeNoise(2, 'white');
    this.brownBuf = this.makeNoise(4, 'brown');
    this.pinkBuf = this.makeNoise(4, 'pink');
    this.ambience();
    this.started = true;
  }

  impulse(sec, decay) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay) * (i < 400 ? i / 400 : 1); }
    return b;
  }

  makeNoise(sec, kind) {
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, n, ctx.sampleRate); const d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
      else if (kind === 'pink') { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
      else d[i] = w;
    }
    return b;
  }

  src(buf, loop = false) { const s = this.ctx.createBufferSource(); s.buffer = buf; s.loop = loop; return s; }

  ambience() {
    const ctx = this.ctx;
    // wind
    const w = this.src(this.brownBuf, true);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.16;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.08; lfo.connect(lg); lg.connect(g.gain);
    const lfo2 = ctx.createOscillator(); lfo2.frequency.value = 0.043; const lg2 = ctx.createGain(); lg2.gain.value = 240; lfo2.connect(lg2); lg2.connect(bp.frequency);
    w.connect(bp); bp.connect(g); g.connect(this.dry); g.connect(this.verb);
    w.start(); lfo.start(); lfo2.start();
    this.windGain = g;
    // distant city murmur
    const m = this.src(this.pinkBuf, true);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 280;
    const mg = ctx.createGain(); mg.gain.value = 0.06;
    m.connect(lp); lp.connect(mg); mg.connect(this.dry); m.start();
    // drone pad
    const pad = ctx.createGain(); pad.gain.value = 0.0;
    const plp = ctx.createBiquadFilter(); plp.type = 'lowpass'; plp.frequency.value = 520; plp.Q.value = 0.7;
    for (const f of [73.42, 110, 146.83 * 1.003]) { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; const og = ctx.createGain(); og.gain.value = 0.05; o.connect(og); og.connect(plp); o.start(); }
    plp.connect(pad); pad.connect(this.dry); pad.connect(this.verb);
    this.pad = pad; this.padFilter = plp;
    // searchlight hum
    const hum = ctx.createGain(); hum.gain.value = 0;
    for (const [f, a] of [[55, 0.5], [110, 0.25], [165, 0.12], [331, 0.05]]) { const o = ctx.createOscillator(); o.frequency.value = f; const og = ctx.createGain(); og.gain.value = a * 0.12; o.connect(og); og.connect(hum); o.start(); }
    hum.connect(this.dry); this.hum = hum;
    // crate scrape loop
    const sc = this.src(this.noiseBuf, true);
    const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass'; sbp.frequency.value = 420; sbp.Q.value = 3;
    const sg = ctx.createGain(); sg.gain.value = 0;
    sc.connect(sbp); sbp.connect(sg); sg.connect(this.sfxBus); sc.start();
    this.scrape = sg; this.scrapeF = sbp;
    // chase pulse
    const pulse = ctx.createGain(); pulse.gain.value = 0; pulse.connect(this.musicBus);
    this.pulse = pulse;
    this.nextBird = ctx.currentTime + 3;
    this.nextPulse = 0; this.pulseStep = 0;
  }

  setListener(x) { this.listenerX = x; }

  pan(x) { return Math.max(-1, Math.min(1, (x - this.listenerX) / 9)); }

  out(x, gain = 1) {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = gain * Math.max(0.15, 1 - Math.abs((x ?? this.listenerX) - this.listenerX) / 30);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) { p.pan.value = this.pan(x ?? this.listenerX); g.connect(p); p.connect(this.sfxBus); } else g.connect(this.sfxBus);
    return g;
  }

  noiseHit(x, { f = 1500, q = 1.2, dur = 0.08, gain = 0.3, type = 'bandpass', attack = 0.002, pitchDrop = 0, delay = 0 } = {}) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const s = this.src(this.noiseBuf); s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const bf = ctx.createBiquadFilter(); bf.type = type; bf.frequency.setValueAtTime(f, t); bf.Q.value = q;
    if (pitchDrop) bf.frequency.exponentialRampToValueAtTime(Math.max(40, f * pitchDrop), t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    s.connect(bf); bf.connect(g); g.connect(this.out(x));
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
  }

  tone(x, { f = 100, f2 = null, dur = 0.2, gain = 0.3, type = 'sine', attack = 0.003, delay = 0 } = {}) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + attack); g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g); g.connect(this.out(x)); o.start(t); o.stop(t + dur + 0.05);
  }

  // Karplus-Strong plucked string (oud-like)
  pluck(freq, when = 0, gain = 0.25, bright = 0.5, dest = null) {
    if (!this.started) return;
    const ctx = this.ctx, sr = ctx.sampleRate;
    const dur = 2.4, n = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, n, sr); const d = buf.getChannelData(0);
    const period = Math.max(2, Math.round(sr / freq));
    const ring = new Float32Array(period);
    for (let i = 0; i < period; i++) ring[i] = (Math.random() * 2 - 1) * (1 - bright * 0.5 + Math.random() * bright * 0.5);
    let idx = 0, prev = 0;
    for (let i = 0; i < n; i++) {
      const cur = ring[idx];
      const nx = ring[(idx + 1) % period];
      const v = (cur + nx) * 0.5 * 0.9965;
      ring[idx] = v * 0.7 + prev * 0.3 * (1 - bright * 0.2);
      prev = v;
      d[i] = cur * Math.min(1, i / 60);
      idx = (idx + 1) % period;
    }
    const s = this.src(buf);
    const bp = ctx.createBiquadFilter(); bp.type = 'peaking'; bp.frequency.value = 900; bp.gain.value = 5; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(bp); bp.connect(g); g.connect(dest || this.musicBus);
    s.start(ctx.currentTime + when);
  }

  // ------------------------------------------------------------------ events
  play(name, x, data) {
    if (!this.started || this.muted) return;
    const r = Math.random;
    switch (name) {
      case 'step': {
        const surf = data?.surface || 'stone';
        const sp = data?.speed || 3;
        const k = Math.min(1, 0.35 + sp / 5);
        if (surf === 'wood') { this.noiseHit(x, { f: 700 + r() * 200, q: 2.5, dur: 0.09, gain: 0.22 * k }); this.tone(x, { f: 160, f2: 90, dur: 0.08, gain: 0.12 * k }); }
        else if (surf === 'cloth') this.noiseHit(x, { f: 500, q: 0.7, dur: 0.12, gain: 0.12 * k, type: 'lowpass' });
        else { this.noiseHit(x, { f: 2200 + r() * 900, q: 1.4, dur: 0.05, gain: 0.16 * k }); this.noiseHit(x, { f: 380, q: 0.9, dur: 0.07, gain: 0.14 * k, type: 'lowpass' }); }
        break;
      }
      case 'guardStep': this.noiseHit(x, { f: 300, q: 0.8, dur: 0.12, gain: 0.3, type: 'lowpass' }); this.noiseHit(x, { f: 1600, q: 1.2, dur: 0.05, gain: 0.12 }); break;
      case 'jump': this.noiseHit(x, { f: 900, q: 0.6, dur: 0.18, gain: 0.08, attack: 0.04 }); break;
      case 'land': {
        const s = Math.min(1, (data?.speed || 4) / 12);
        this.tone(x, { f: 110, f2: 45, dur: 0.18, gain: 0.25 * s + 0.08 });
        this.noiseHit(x, { f: 700, q: 0.7, dur: 0.14, gain: 0.2 * s + 0.06, type: 'lowpass' });
        break;
      }
      case 'grab': this.noiseHit(x, { f: 1400, q: 1.5, dur: 0.06, gain: 0.16 }); this.noiseHit(x, { f: 400, q: 0.6, dur: 0.1, gain: 0.08, type: 'lowpass' }); break;
      case 'climbUp': this.noiseHit(x, { f: 1100, q: 0.8, dur: 0.35, gain: 0.08, attack: 0.08, pitchDrop: 0.6 }); break;
      case 'vine': this.noiseHit(x, { f: 2600, q: 0.6, dur: 0.22, gain: 0.08, attack: 0.02 }); break;
      case 'crateImpact': this.tone(x, { f: 90, f2: 40, dur: 0.35, gain: 0.5 }); this.noiseHit(x, { f: 500, q: 0.8, dur: 0.25, gain: 0.35, type: 'lowpass' }); this.noiseHit(x, { f: 1800, q: 3, dur: 0.12, gain: 0.12, delay: 0.02 }); break;
      case 'plateDown': this.tone(x, { f: 180, f2: 120, dur: 0.12, gain: 0.25 }); this.noiseHit(x, { f: 2500, q: 5, dur: 0.05, gain: 0.2 }); this.tone(x, { f: 520, dur: 0.4, gain: 0.05, type: 'triangle', delay: 0.05 }); break;
      case 'plateUp': this.tone(x, { f: 140, f2: 190, dur: 0.1, gain: 0.15 }); break;
      case 'gateStart': case 'bridgeStart': this.creak(x, 1.6); this.chains(x, 1.4); break;
      case 'gateStop': this.noiseHit(x, { f: 300, q: 1, dur: 0.2, gain: 0.2, type: 'lowpass' }); break;
      case 'gateSlam': case 'bridgeSlam': this.tone(x, { f: 70, f2: 35, dur: 0.6, gain: 0.55 }); this.noiseHit(x, { f: 400, q: 0.7, dur: 0.4, gain: 0.35, type: 'lowpass' }); break;
      case 'grip': this.noiseHit(x, { f: 1200, q: 1.2, dur: 0.06, gain: 0.12 }); break;
      case 'lever': [523, 1244, 1861, 2873].forEach((f, i) => this.tone(x, { f, dur: 0.9 - i * 0.15, gain: 0.08 / (i + 1), type: 'sine' })); this.tone(x, { f: 120, f2: 60, dur: 0.2, gain: 0.3 }); break;
      case 'ladder': this.noiseHit(x, { f: 1500, q: 0.5, dur: 1.2, gain: 0.1, attack: 0.1, pitchDrop: 0.3 }); for (let i = 0; i < 8; i++) this.tone(x, { f: 300 + r() * 200, dur: 0.05, gain: 0.12, type: 'triangle', delay: 0.1 + i * 0.12 }); break;
      case 'alarm': this.horn(); break;
      case 'dart': this.noiseHit(x, { f: 3000, q: 0.8, dur: 0.25, gain: 0.25, attack: 0.2, pitchDrop: 0.4 }); this.tone(x, { f: 900, f2: 300, dur: 0.06, gain: 0.2, delay: 0.25 }); break;
      case 'shout': this.voice(x, 150, 0.7); break;
      case 'guardVault': this.noiseHit(x, { f: 600, q: 0.6, dur: 0.2, gain: 0.2, type: 'lowpass' }); break;
      case 'guardFrustrated': this.voice(x, 120, 0.9); this.tone(x, { f: 80, f2: 50, dur: 0.3, gain: 0.35, delay: 0.3 }); break;
      case 'grabbed': this.tone(x, { f: 60, f2: 30, dur: 0.8, gain: 0.6 }); break;
      case 'death': this.tone(x, { f: 55, f2: 28, dur: 1.6, gain: 0.5 }); this.duck(); break;
      case 'crawl': this.noiseHit(x, { f: 800, q: 0.6, dur: 0.2, gain: 0.08, type: 'lowpass' }); break;
      default: break;
    }
  }

  creak(x, dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(70, t);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 9; const lg = ctx.createGain(); lg.gain.value = 18; lfo.connect(lg); lg.connect(o.frequency);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.1); g.gain.linearRampToValueAtTime(0.0, t + dur);
    o.connect(bp); bp.connect(g); g.connect(this.out(x)); o.start(t); lfo.start(t); o.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
  }
  chains(x, dur) { for (let i = 0; i < 14; i++) this.tone(x, { f: 1800 + Math.random() * 2400, dur: 0.05, gain: 0.05, type: 'square', delay: Math.random() * dur }); }
  horn() {
    const ctx = this.ctx, t = ctx.currentTime;
    for (const f of [98, 98.8, 146.8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f * 0.9, t); o.frequency.linearRampToValueAtTime(f, t + 0.3);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.12, t + 0.2); g.gain.linearRampToValueAtTime(0.0, t + 1.6);
      o.connect(lp); lp.connect(g); g.connect(this.dry); g.connect(this.verb); o.start(t); o.stop(t + 1.7);
    }
    for (let i = 0; i < 3; i++) this.tone(this.listenerX, { f: 80, f2: 45, dur: 0.3, gain: 0.5, delay: 0.15 + i * 0.28 });
  }
  voice(x, f0, dur) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f0 * 1.3, t); o.frequency.exponentialRampToValueAtTime(f0 * 0.8, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const o2 = this.out(x);
    for (const [f, q, a] of [[700, 6, 1], [1150, 8, 0.6], [2500, 10, 0.3]]) { const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; const ga = ctx.createGain(); ga.gain.value = a; o.connect(bp); bp.connect(ga); ga.connect(g); }
    g.connect(o2); o.start(t); o.stop(t + dur + 0.1);
  }
  duck() { const t = this.ctx.currentTime; this.lowpass.frequency.cancelScheduledValues(t); this.lowpass.frequency.setValueAtTime(20000, t); this.lowpass.frequency.exponentialRampToValueAtTime(400, t + 0.6); this.lowpass.frequency.exponentialRampToValueAtTime(20000, t + 3.2); }

  // ------------------------------------------------------------------ per-frame
  update(dt, st) {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    // crate scrape
    const sv = Math.min(1, st.crateSpeed / 1.2);
    this.scrape.gain.setTargetAtTime(sv * 0.22, t, 0.05);
    this.scrapeF.frequency.setTargetAtTime(350 + sv * 250 + Math.random() * 80, t, 0.05);
    // searchlight hum by distance
    this.hum.gain.setTargetAtTime(st.hum, t, 0.3);
    // pad tension
    this.pad.gain.setTargetAtTime(st.tension * 0.35 + 0.05, t, 1.2);
    this.padFilter.frequency.setTargetAtTime(420 + st.tension * 900, t, 1.0);
    this.windGain.gain.setTargetAtTime(0.14 + st.height * 0.02, t, 1.5);
    // birds in open areas
    if (t > this.nextBird && st.birds) {
      const n = 2 + Math.floor(Math.random() * 4); const base = 2400 + Math.random() * 1500;
      const bx = this.listenerX + (Math.random() - 0.5) * 20;
      for (let i = 0; i < n; i++) this.tone(bx, { f: base * (1 + Math.random() * 0.2), f2: base * (1.3 + Math.random() * 0.4), dur: 0.08, gain: 0.03, delay: i * 0.11 });
      this.nextBird = t + 4 + Math.random() * 9;
    }
    // chase pulse
    if (st.chase) {
      this.musicBus.gain.setTargetAtTime(0.9, t, 0.5);
      if (t > this.nextPulse) {
        const step = this.pulseStep++ % 8;
        const beat = 0.21;
        if (step % 2 === 0) this.drum(0.55); else if (step === 3 || step === 7) this.drum(0.3, 140);
        if (step === 0 || step === 3 || step === 6) this.pluck([146.83, 155.56, 185.0, 196.0][Math.floor(Math.random() * 4)], 0, 0.18, 0.7);
        this.nextPulse = t + beat;
      }
    } else if (!st.finale) this.musicBus.gain.setTargetAtTime(0.0, t, 1.5);
  }
  drum(g, f = 90) { const ctx = this.ctx, t = ctx.currentTime; const o = ctx.createOscillator(); o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.45, t + 0.18); const ga = ctx.createGain(); ga.gain.setValueAtTime(g * 0.5, t); ga.gain.exponentialRampToValueAtTime(0.001, t + 0.3); o.connect(ga); ga.connect(this.musicBus); o.start(t); o.stop(t + 0.35); }

  // finale: slow oud melody in D hijaz over a warm pad
  finale() {
    if (!this.started) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(t);
    this.musicBus.gain.setValueAtTime(this.musicBus.gain.value, t);
    this.musicBus.gain.linearRampToValueAtTime(1.0, t + 3);
    const D = 146.83; const scale = [1, 16 / 15, 5 / 4, 4 / 3, 3 / 2, 8 / 5, 16 / 9, 2];
    const mel = [0, 1, 2, 3, 2, 1, 0, -1, 0, 2, 4, 3, 2, 1, 2, 0];
    let when = 0.8;
    mel.forEach((d, i) => {
      const deg = ((d % 7) + 7) % 7, oct = Math.floor(d / 7);
      const f = D * scale[deg] * Math.pow(2, oct);
      this.pluck(f, when, 0.26, 0.45);
      if (i % 4 === 0) this.pluck(D / 2, when, 0.18, 0.2);
      when += i % 4 === 3 ? 0.9 : 0.45;
    });
    this.pad.gain.cancelScheduledValues(t);
    this.pad.gain.setTargetAtTime(0.5, t, 2.0);
    this.padFilter.frequency.setTargetAtTime(1400, t, 3.0);
  }
  fadeOut(sec = 3) { if (!this.started) return; const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(this.master.gain.value, t); this.master.gain.linearRampToValueAtTime(0.0, t + sec); }
  fadeIn(sec = 2) { if (!this.started) return; const t = this.ctx.currentTime; this.master.gain.cancelScheduledValues(t); this.master.gain.setValueAtTime(this.master.gain.value, t); this.master.gain.linearRampToValueAtTime(0.9, t + sec); }
}
