// Voice pool: at most MAX transient sounds at once. Each voice is a pooled strip
// (filter → envelope → panner → bus) reused for every note; only the sources are new.
// When the pool is full the oldest voice of equal or lower priority is stolen with a 10 ms fade.
export const MAX_VOICES = 32;

export class Voices {
  constructor(ctx, n = MAX_VOICES) {
    this.ctx = ctx;
    this.pool = [];
    for (let i = 0; i < n; i++) {
      const filter = ctx.createBiquadFilter(), env = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      env.gain.value = 0;
      filter.connect(env); if (pan) env.connect(pan);
      this.pool.push({ i, filter, env, pan, out: pan || env, dest: null, end: 0, start: 0, prio: 0, srcs: [] });
    }
    this.stolen = 0; this.dropped = 0; this.started = 0;
  }
  get active() { const t = this.ctx.currentTime; let n = 0; for (const v of this.pool) if (v.end > t) n++; return n; }

  // reserve a voice from `start` to `end` (seconds, context time); returns null when nothing can be stolen
  acquire(dest, start, end, prio = 1) {
    const now = this.ctx.currentTime;
    let v = null;
    for (const c of this.pool) if (c.end <= now) { v = c; break; }
    if (!v) {
      let best = null;
      for (const c of this.pool) if (c.prio <= prio && (!best || c.start < best.start)) best = c;
      if (!best) { this.dropped++; return null; }
      this.kill(best, now); v = best; this.stolen++;
    }
    for (const s of v.srcs) { try { s.disconnect(); } catch { /* already gone */ } }
    v.srcs.length = 0;
    if (v.dest !== dest) { v.out.disconnect(); v.out.connect(dest); v.dest = dest; }
    const g = v.env.gain; g.cancelScheduledValues(now); g.setValueAtTime(0, Math.max(now, start - 0.001));
    const f = v.filter; f.frequency.cancelScheduledValues(now); f.Q.cancelScheduledValues(now); f.gain.cancelScheduledValues(now);
    v.start = start; v.end = end; v.prio = prio;
    this.started++;
    return v;
  }
  kill(v, now = this.ctx.currentTime) {
    const g = v.env.gain;
    g.cancelScheduledValues(now);
    if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now); else g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0, now + 0.01);
    for (const s of v.srcs) { try { s.stop(now + 0.012); } catch { /* not started */ } }
    v.end = now + 0.012;
  }
  stopAll() { for (const v of this.pool) if (v.end > this.ctx.currentTime) this.kill(v); }
  // attach a source to the voice (src → filter by default, or straight to the envelope)
  feed(v, src, viaFilter = true) { src.connect(viaFilter ? v.filter : v.env); v.srcs.push(src); }
  setPan(v, p) { if (v.pan) v.pan.pan.setValueAtTime(Math.max(-1, Math.min(1, p)), this.ctx.currentTime); }
}
