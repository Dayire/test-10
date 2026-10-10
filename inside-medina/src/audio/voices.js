// Voice pool: at most MAX_VOICES transient sounds at once. Each voice is a pooled strip
// (filter → envelope → panner → bus) reused for every note; only the sources are new.
// Priorities: ui 3 > music 2 > sfx 1 > ambience 0. When the pool is full a note steals a voice of
// equal or lower priority (the lowest priority first, then the one nearest its end). A steal is a real
// fade: the stolen strip fades out over FADE with its own filter, pan and bus untouched while the new
// note starts at once on one of SPARE extra strips, so a steal never cuts and never delays. Music may
// hold at most MUSIC_VOICES voices and steals from itself beyond that, so effects and menu sounds always
// find a voice even under the densest cue.
export const MAX_VOICES = 32, SPARE = 8, MUSIC_VOICES = 24, FADE = 0.012;

export class Voices {
  constructor(ctx, n = MAX_VOICES) {
    this.ctx = ctx;
    this.max = n;
    this.limit = { 2: Math.min(MUSIC_VOICES, n - 4) };
    this.pool = [];
    for (let i = 0; i < n + SPARE; i++) {
      const filter = ctx.createBiquadFilter(), env = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      env.gain.value = 0;
      filter.connect(env); if (pan) env.connect(pan);
      this.pool.push({ i, filter, env, pan, out: pan || env, dest: null, end: 0, start: 0, prio: 0, fading: false, srcs: [] });
    }
    this.stolen = 0; this.dropped = 0; this.started = 0;
  }
  // sounding voices (a strip fading out after a steal no longer counts)
  get active() { const t = this.ctx.currentTime; let n = 0; for (const v of this.pool) if (v.end > t && !v.fading) n++; return n; }

  // reserve a voice from `start` to `end` (seconds, context time); null when nothing can be stolen
  acquire(dest, start, end, prio = 1) {
    const now = this.ctx.currentTime, lim = this.limit[prio] ?? Infinity;
    let live = 0, own = 0, free = null;
    for (const c of this.pool) {
      if (c.end > now) { if (!c.fading) { live++; if (c.prio === prio) own++; } }
      else if (!free) free = c;
    }
    if (!free) { this.dropped++; return null; } // every spare is still fading (a burst of steals)
    if (live >= this.max || own >= lim) {
      const self = own >= lim;
      let best = null;
      for (const c of this.pool) {
        if (c.end <= now || c.fading || (self ? c.prio !== prio : c.prio > prio)) continue;
        if (!best || c.prio < best.prio || (c.prio === best.prio && c.end < best.end)) best = c;
      }
      if (!best) { this.dropped++; return null; }
      this.kill(best);
      this.stolen++;
    }
    const v = free;
    for (const s of v.srcs) { try { s.disconnect(); } catch { /* already gone */ } }
    v.srcs.length = 0;
    if (v.dest !== dest) { v.out.disconnect(); v.out.connect(dest); v.dest = dest; }
    const t0 = Math.max(now, start - 0.001), g = v.env.gain, f = v.filter;
    g.cancelScheduledValues(t0); g.setValueAtTime(0, t0);
    f.frequency.cancelScheduledValues(t0); f.Q.cancelScheduledValues(t0); f.gain.cancelScheduledValues(t0);
    v.start = start; v.end = end; v.prio = prio; v.fading = false;
    this.started++;
    return v;
  }
  // fade a voice out from now over FADE; its sources stop when the fade ends. (The current value is
  // pinned and ramped from: cancelAndHoldAtTime followed by a ramp does not fade reliably in Chromium.)
  kill(v) {
    const now = this.ctx.currentTime, g = v.env.gain;
    g.cancelScheduledValues(now); g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + FADE - 0.002);
    for (const s of v.srcs) { if (s.stop) try { s.stop(now + FADE); } catch { /* not started */ } }
    v.end = Math.min(v.end, now + FADE); v.fading = true;
  }
  stopAll() { const t = this.ctx.currentTime; for (const v of this.pool) if (v.end > t && !v.fading) this.kill(v); }
  // attach a source to the voice (src → filter by default, or straight to the envelope)
  feed(v, src, viaFilter = true) { src.connect(viaFilter ? v.filter : v.env); v.srcs.push(src); }
  setPan(v, p) { if (v.pan) v.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, p)), Math.max(this.ctx.currentTime, v.start - 0.001)); }
}
