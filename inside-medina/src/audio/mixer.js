// Bus graph, reverb zones, pause ducking, user volumes, mute, mono and the output limiter.
//
//  sfx ─(lowpass)─ sfxUser ─┬─────────────┐
//  music ───────── musicUser ┼─ sends ─ verb ┼─ gameDry ─ pauseLP ─ pauseGain ─┐
//  amb ─────────── ambUser ──┘   (A/B crossfade, pre-delay)                     ├─ userMaster ─ master (fades) ─ glue ─ limiter ─ clip ─ out
//  ui ──────────── uiUser ─────────────────────────────────────────────────────┘
export const VERBS = {
  alley: { sec: 1.2, decay: 3.2, pre: 0.008, wet: 0.24 },
  souk: { sec: 1.2, decay: 3.0, pre: 0.01, wet: 0.26 },
  courtyard: { sec: 2.6, decay: 2.4, pre: 0.018, wet: 0.32 },
  madrasa: { sec: 2.6, decay: 2.2, pre: 0.022, wet: 0.36 },
  cistern: { sec: 5.5, decay: 1.7, pre: 0.06, wet: 0.46 },
  minaret: { sec: 3.5, decay: 2.1, pre: 0.03, wet: 0.38 },
  open: { sec: 0.8, decay: 4.0, pre: 0.0, wet: 0.14 },
  menu: { sec: 2.6, decay: 2.2, pre: 0.02, wet: 0.4 },
};

export class Mixer {
  constructor(ctx) {
    this.ctx = ctx;
    const G = (v = 1) => { const g = ctx.createGain(); g.gain.value = v; return g; };
    // output chain
    this.out = G(1);
    this.clip = ctx.createWaveShaper(); this.clip.curve = softClipCurve(0.891); this.clip.oversample = 'none';
    this.limiter = ctx.createDynamicsCompressor();
    setP(this.limiter.threshold, -4); setP(this.limiter.knee, 0); setP(this.limiter.ratio, 20); setP(this.limiter.attack, 0.002); setP(this.limiter.release, 0.12);
    this.glue = ctx.createDynamicsCompressor();
    setP(this.glue.threshold, -16); setP(this.glue.ratio, 3.5); setP(this.glue.knee, 8); setP(this.glue.attack, 0.01); setP(this.glue.release, 0.25);
    this.makeup = G(1);
    this.master = G(0); // fade in / out
    this.userMaster = G(1); // mute and the master volume
    this.userMaster.connect(this.master); this.master.connect(this.glue); this.glue.connect(this.makeup);
    this.makeup.connect(this.limiter); this.limiter.connect(this.clip); this.clip.connect(this.out); this.out.connect(ctx.destination);
    // game side (ducked and filtered on pause)
    this.pauseGain = G(1); this.pauseLP = ctx.createBiquadFilter(); this.pauseLP.type = 'lowpass'; this.pauseLP.frequency.value = 20000; this.pauseLP.Q.value = 0.5;
    this.gameDry = G(1); this.gameDry.connect(this.pauseLP); this.pauseLP.connect(this.pauseGain); this.pauseGain.connect(this.userMaster);
    // buses
    this.lowpass = ctx.createBiquadFilter(); this.lowpass.type = 'lowpass'; this.lowpass.frequency.value = 20000; // death duck (sfx)
    this.sfx = G(1); this.music = G(0); this.amb = G(1); this.ui = G(1);
    this.sfxUser = G(1); this.musicUser = G(1); this.ambUser = G(1); this.uiUser = G(1);
    this.sfx.connect(this.lowpass); this.lowpass.connect(this.sfxUser);
    this.music.connect(this.musicUser); this.amb.connect(this.ambUser);
    this.ui.connect(this.uiUser); this.uiUser.connect(this.userMaster);
    for (const u of [this.sfxUser, this.musicUser, this.ambUser]) u.connect(this.gameDry);
    // reverb: two convolvers crossfaded on zone changes, shared pre-delay
    this.verbIn = G(1); this.pre = ctx.createDelay(0.2); this.pre.delayTime.value = 0.01;
    this.verbIn.connect(this.pre);
    this.conv = [ctx.createConvolver(), ctx.createConvolver()]; this.convGain = [G(1), G(0)];
    this.verbOut = G(1);
    for (let i = 0; i < 2; i++) { this.pre.connect(this.conv[i]); this.conv[i].connect(this.convGain[i]); this.convGain[i].connect(this.verbOut); }
    this.verbOut.connect(this.gameDry);
    this.sends = { sfx: G(0.3), music: G(0.5), amb: G(0.22) };
    this.sfxUser.connect(this.sends.sfx); this.musicUser.connect(this.sends.music); this.ambUser.connect(this.sends.amb);
    for (const s of Object.values(this.sends)) s.connect(this.verbIn);
    this.irCache = new Map(); this.cur = 0; this.verbName = null;
    this.setVerb('courtyard', 0);
    this.paused = false; this._muted = false; this.volumes = { master: 10, music: 10, sfx: 10, amb: 10, ui: 10 };
    this.flags = { mono: false, reducedRange: false }; this.background = false;
  }

  impulse(sec, decay) {
    const key = `${sec}|${decay}`;
    if (this.irCache.has(key)) return this.irCache.get(key);
    const ctx = this.ctx, n = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    let seed = 12345;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n;
        // darker tail: one-pole lowpass whose cutoff falls with time
        const k = 0.9 - 0.75 * t;
        lp += (rnd() - lp) * k;
        d[i] = lp * Math.pow(1 - t, decay) * (i < 300 ? i / 300 : 1);
      }
    }
    this.irCache.set(key, b);
    return b;
  }

  setVerb(name, fade = 1.5) {
    const v = VERBS[name] || VERBS.courtyard;
    if (name === this.verbName) return;
    this.verbName = name;
    const ctx = this.ctx, t = ctx.currentTime;
    const next = 1 - this.cur;
    this.conv[next].buffer = this.impulse(v.sec, v.decay);
    const g = this.convGain;
    for (const [i, to] of [[next, v.wet / 0.3], [this.cur, 0]]) { g[i].gain.cancelScheduledValues(t); g[i].gain.setValueAtTime(g[i].gain.value, t); g[i].gain.linearRampToValueAtTime(to, t + Math.max(0.01, fade)); }
    this.pre.delayTime.setTargetAtTime(v.pre, t, 0.2);
    this.cur = next;
  }

  setPaused(p, sec = 0.3) {
    if (p === this.paused) return;
    this.paused = p;
    const t = this.ctx.currentTime;
    this.pauseGain.gain.cancelScheduledValues(t); this.pauseGain.gain.setValueAtTime(this.pauseGain.gain.value, t);
    this.pauseGain.gain.linearRampToValueAtTime(p ? 0.18 : 1, t + sec);
    this.pauseLP.frequency.cancelScheduledValues(t); this.pauseLP.frequency.setValueAtTime(this.pauseLP.frequency.value, t);
    this.pauseLP.frequency.exponentialRampToValueAtTime(p ? 650 : 20000, t + sec);
  }

  get muted() { return this._muted; }
  set muted(m) { this._muted = !!m; this.applyMaster(0.02); }
  applyMaster(tc = 0.05) {
    const v = this._muted || this.background ? 0 : Math.pow(this.volumes.master / 10, 2);
    const g = this.userMaster.gain, t = this.ctx.currentTime;
    g.cancelScheduledValues(t);
    if (tc <= 0) g.setValueAtTime(v, t); else g.setTargetAtTime(v, t, tc);
  }

  // volumes 0–10 (perceptual: gain = (v/10)²); flags: mono, reducedRange
  setVolumes(v = {}) {
    const V = this.volumes;
    for (const [k, alias] of [['master', 'master'], ['music', 'music'], ['sfx', 'effects'], ['amb', 'ambience'], ['ui', 'ui']]) {
      const x = v[k] ?? v[alias];
      if (x !== undefined && isFinite(x)) V[k] = Math.max(0, Math.min(10, +x));
    }
    const t = this.ctx.currentTime, g = (x) => Math.pow(x / 10, 2);
    this.sfxUser.gain.setTargetAtTime(g(V.sfx), t, 0.05); this.musicUser.gain.setTargetAtTime(g(V.music), t, 0.05);
    this.ambUser.gain.setTargetAtTime(g(V.amb), t, 0.05); this.uiUser.gain.setTargetAtTime(g(V.ui), t, 0.05);
    this.applyMaster();
    if (v.mono !== undefined) { this.flags.mono = !!v.mono; this.out.channelCount = this.flags.mono ? 1 : 2; this.out.channelCountMode = this.flags.mono ? 'explicit' : 'max'; }
    const rr = v.reducedRange ?? v.reducedDynamicRange;
    if (rr !== undefined) {
      this.flags.reducedRange = !!rr;
      setP(this.glue.threshold, rr ? -32 : -16); setP(this.glue.ratio, rr ? 7 : 3.5); setP(this.glue.knee, rr ? 12 : 8);
      this.makeup.gain.setTargetAtTime(rr ? 2.2 : 1, t, 0.1);
    }
  }
}

function setP(p, v) { if (p) p.value = v; }

export function softClipCurve(ceil = 0.891, n = 2049) {
  const c = new Float32Array(n), k = 0.7, room = ceil - k;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = Math.sign(x) * (a <= k ? a : k + room * Math.tanh((a - k) / room));
  }
  return c;
}
