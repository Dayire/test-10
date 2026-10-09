// Frame pacing and adaptive quality.
//  FrameCap     – gates requestAnimationFrame callbacks to 30 / 60 fps (or the display rate).
//  DynRes       – scales the internal resolution (a viewport sub-rect, no reallocation) to hold the budget.
//  AutoQuality  – changes the tier from p90 frame times over 10 s windows, both ways, ≤ 1 change per 30 s.

export class FrameCap {
  constructor() { this.interval = 0; this.last = -1; this.skipped = false; }
  set(fps) { const f = +fps; this.interval = f > 0 ? 1000 / f : 0; this.last = -1; }
  get fps() { return this.interval ? 1000 / this.interval : 0; }
  // true when this rAF callback should run a frame
  begin(now) {
    const iv = this.interval;
    if (!iv || this.last < 0) { this.last = now; this.skipped = false; return true; }
    const slack = Math.min(4, iv * 0.25), el = now - this.last;
    if (el < iv - slack) { this.skipped = true; return false; }
    // keep the phase so the average rate is exact on 90/120/144 Hz displays; resync after a stall
    this.last += iv * Math.max(1, Math.floor((el + slack) / iv));
    if (now - this.last > iv) this.last = now;
    this.skipped = false;
    return true;
  }
}

export class DynRes {
  constructor() {
    this.enabled = true; this.scale = 1; this.min = 0.7; this.max = 1;
    this.ema = 0; this.lastAdjust = -1e9; this.headroomSince = -1; this.atBudgetSince = -1;
    this.probeT = -1e9; this.backoff = 10000; this.lastNow = 0;
  }
  setRange(min, max = 1) { this.min = min; this.max = max; this.scale = Math.min(this.max, Math.max(this.lo, this.scale)); }
  get lo() { return this.min; }
  reset(scale = this.max) { this.scale = Math.min(this.max, Math.max(this.lo, scale)); this.ema = 0; this.headroomSince = this.atBudgetSince = -1; }
  get atMin() { return !this.enabled || this.scale <= this.lo + 1e-3; }
  get atMax() { return !this.enabled || this.scale >= this.max - 1e-3; }
  // cost: frame cost in ms; quantized: cost is a vsync-locked frame interval (no headroom information)
  update(cost, now, budget, quantized) {
    if (!this.enabled) { this.scale = this.max; return false; }
    // smoothing over ~0.2 s of real time, whatever the frame rate
    const a = this.ema && this.lastNow ? 1 - Math.exp(-Math.min(now - this.lastNow, 500) / 200) : 1;
    this.lastNow = now;
    this.ema += (cost - this.ema) * a;
    const since = now - this.lastAdjust, e = this.ema;
    if (e > budget * 1.1) {
      this.headroomSince = this.atBudgetSince = -1;
      if (now - this.probeT < 2500) { this.backoff = Math.min(120000, this.backoff * 2); this.probeT = -1e9; }
      if (since < 250 || this.scale <= this.lo + 1e-4) return false;
      // pixel cost goes with scale², aim a little under budget
      const f = Math.min(0.97, Math.max(0.85, Math.sqrt(budget * 0.92 / e)));
      this.scale = Math.max(this.lo, this.scale * f); this.lastAdjust = now;
      return true;
    }
    if (!quantized && e < budget * 0.8) {
      this.atBudgetSince = -1;
      if (this.headroomSince < 0) this.headroomSince = now;
      if (this.scale < this.max && now - this.headroomSince >= 5000 && since >= 500) { this.scale = Math.min(this.max, this.scale + 0.05); this.lastAdjust = now; return true; }
      return false;
    }
    this.headroomSince = -1;
    // vsync-bound with no timing information: probe one step up now and then, back off when it fails
    if (quantized && e <= budget * 1.05 && this.scale < this.max) {
      if (this.atBudgetSince < 0) this.atBudgetSince = now;
      if (now - this.atBudgetSince >= this.backoff && since >= 500) { this.scale = Math.min(this.max, this.scale + 0.05); this.lastAdjust = this.probeT = this.atBudgetSince = now; return true; }
    } else this.atBudgetSince = -1;
    return false;
  }
}

export class AutoQuality {
  constructor() { this.win = []; this.winStart = -1; this.lastChange = -1e9; this.lastUp = -1e9; this.headroomSince = -1; this.upWait = 30000; this.p90 = 0; }
  restart(now) { this.win.length = 0; this.winStart = now + 2000; this.headroomSince = -1; }
  // → -1 step down, +1 step up, 0 stay
  update(ms, now, budget, { dynAtMin, dynAtMax, canUp, work }) {
    if (now < this.winStart) return 0;
    if (this.winStart < 0) this.winStart = now;
    this.win.push(Math.min(ms, 250));
    if (now - this.winStart < 10000) return 0;
    const s = this.win.sort((a, b) => a - b);
    const p90 = this.p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    const windowStart = this.winStart;
    this.win.length = 0; this.winStart = now;
    if (p90 > budget * 1.3 && dynAtMin) {
      this.headroomSince = -1;
      if (now - this.lastChange < 30000) return 0;
      if (now - this.lastUp < 45000) this.upWait = Math.min(240000, this.upWait * 2); // the last upgrade did not hold
      this.lastChange = now;
      return -1;
    }
    const headroom = p90 <= budget * 1.05 && dynAtMax && !(work > budget * 0.55);
    if (!headroom || !canUp) { this.headroomSince = -1; return 0; }
    if (this.headroomSince < 0) this.headroomSince = windowStart;
    if (now - this.headroomSince < this.upWait || now - this.lastChange < 30000) return 0;
    this.headroomSince = -1; this.lastChange = this.lastUp = now;
    return 1;
  }
}
