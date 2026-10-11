// Frame pacing and adaptive quality.
//  FrameCap     – gates requestAnimationFrame callbacks to 30 / 60 fps (or the display rate).
//  DynRes       – scales the internal resolution (a viewport sub-rect, no reallocation) to hold the budget.
//  AutoQuality  – changes the tier from p90 frame times over 10 s windows, both ways, ≤ 1 change per 30 s.
// Times are on the caller's clock (RenderSystem sums the frame intervals it tracks), so a stubbed
// requestAnimationFrame or a synthetic feed drives them exactly like a real display.

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

// a decision needs frames rendered at the current scale covering at least half of WIN ms: at least WIN_N of them
// (at 60 fps about 25, and a single hitch among them never reaches the 75th percentile), or any number on a slow
// clock (frames averaging SLOW ms or more, where one frame already covers that time)
const WIN = 800, WIN_N = 3, SLOW = 150, CAP = 256, PROBE = 4000;
const _s = new Float64Array(CAP), _c = new Float64Array(CAP);
const at = (a, n, p) => a[Math.min(n - 1, Math.round((n - 1) * p))];

export class DynRes {
  constructor() {
    this.enabled = true; this.scale = 1; this.min = 0.7; this.max = 1;
    // frames since the last change: time, cost, cpu, interval (ring buffers)
    this.t = new Float64Array(CAP); this.c = new Float64Array(CAP); this.u = new Float64Array(CAP); this.iv = new Float64Array(CAP);
    this.n = 0; this.head = 0; this.lastNow = -1; this.ivAvg = 0;
    this.lastAdjust = -1e9; this.headroomSince = -1; this.atBudgetSince = -1;
    this.probeT = -1e9; this.probeFrom = 1; this.backoff = PROBE;
    // the delivered frame period (ms) once a trial showed that lower resolutions do not change it: a throttled
    // requestAnimationFrame (iOS Low Power Mode, browser battery saving) or a cost pixels do not drive. It becomes
    // the budget, so such a device keeps its resolution. limitedCpu: CPU share of that period; limitedPixel: lower
    // resolutions did make frames faster earlier in the trial (the GPU is busy, a lower tier may help). 0: none.
    this.limited = 0; this.limitedCpu = 0; this.limitedPixel = false; this.trial = null;
    this.p50 = 0; this.p75 = 0; this.drops = 0; this.trials = 0;
  }
  setRange(min, max = 1) { this.min = min; this.max = max; this.scale = Math.min(this.max, Math.max(this.lo, this.scale)); }
  get lo() { return this.min; }
  reset(scale = this.max) { this.scale = Math.min(this.max, Math.max(this.lo, scale)); this.restart(); }
  // a discontinuity (scene change, teleport, tier change, pause): forget the frames and any trial in progress
  restart() { this.n = 0; this.headroomSince = this.atBudgetSince = -1; this.trial = null; }
  get atMin() { return !this.enabled || this.scale <= this.lo + 1e-3; }
  get atMax() { return !this.enabled || this.scale >= this.max - 1e-3; }
  // the budget the frame rate is held to: the cap's, or the delivered period when nothing here can beat it
  budget(base) { return Math.max(base, this.limited); }
  // the limit is display-side (a throttled rAF): the resolution never helped and the CPU is idle
  get displayLimited() { return this.limited > 0 && !this.limitedPixel && this.limitedCpu < 0.6; }
  clearLimit() { this.limited = this.limitedCpu = 0; this.limitedPixel = false; }
  _set(scale, now) { this.scale = scale; this.lastAdjust = now; this.n = 0; }

  // cost: frame cost in ms; quantized: cost is a vsync-locked frame interval (no headroom information); cpu: the
  // CPU time of the frame. Drops need sustained overload (the window's 75th percentile), so a single hitch never
  // moves the scale.
  update(cost, now, budget, quantized, cpu = 0) {
    if (!this.enabled) { this.scale = this.max; return false; }
    const i = this.head, iv = this.lastNow < 0 ? 0 : now - this.lastNow;
    this.t[i] = now; this.c[i] = cost; this.u[i] = cpu; this.iv[i] = iv;
    this.lastNow = now; this.ivAvg = this.ivAvg ? this.ivAvg + (Math.min(iv, 2000) - this.ivAvg) * 0.2 : iv;
    this.head = (i + 1) % CAP; this.n = Math.min(CAP, this.n + 1);
    // the window: the last WIN ms, at least WIN_N frames; span is the time its frames cover
    let k = 0, span = 0;
    for (let j = 0; j < this.n; j++) {
      const q = (this.head - 1 - j + CAP) % CAP;
      if (j >= WIN_N && now - this.t[q] > WIN) break;
      _s[k] = this.c[q]; _c[k] = this.u[q]; span += this.iv[q]; k++;
    }
    if (span < WIN * 0.5 || (k < WIN_N && this.ivAvg < SLOW)) return false;
    const s = _s.subarray(0, k).sort(), p50 = this.p50 = at(s, k, 0.5), p75 = this.p75 = at(s, k, 0.75);
    // the limit is gone (frames come faster than it now): back to the cap's budget
    if (this.limited && p50 < this.limited * 0.8) this.clearLimit();
    const B = this.budget(budget);
    // a trial of lower resolutions on a vsync-locked clock: does the delivered period change? tr.scale is the
    // highest scale that reached tr.period
    const tr = this.trial;
    if (tr) {
      if (p50 < tr.period * 0.85) {
        // it does: resolution is what costs; done once the frames are within budget
        if (p75 <= B * 1.12) this.trial = null; else { tr.period = p50; tr.scale = this.scale; tr.pixel = true; }
      } else if (this.scale <= this.lo + 1e-3) {
        // at the floor and no faster: the period is set by something else; keep the highest scale that reached it
        this.trial = null; this.trials++;
        this.limited = tr.period; this.limitedPixel = !!tr.pixel; this.limitedCpu = at(_c.subarray(0, k).sort(), k, 0.75) / tr.period;
        this._set(Math.max(this.lo, tr.scale), now);
        return true;
      }
    }
    if (p75 > B * 1.12) {
      this.headroomSince = this.atBudgetSince = -1;
      // a probe that did not hold: back to the scale it left, and wait twice as long before the next one
      if (now - this.probeT < 2500) { this.backoff = Math.min(120000, this.backoff * 2); this.probeT = -1e9; this.trial = null; this._set(this.probeFrom, now); return true; }
      if (this.scale <= this.lo + 1e-4) return false;
      if (quantized && !this.trial) this.trial = { scale: this.scale, period: p50, pixel: false };
      // pixel cost goes with scale², aim a little under budget
      const f = Math.min(0.97, Math.max(0.85, Math.sqrt(B * 0.92 / p75)));
      this._set(Math.max(this.lo, this.scale * f), now); this.drops++;
      return true;
    }
    if (!quantized && p75 < B * 0.8) {
      this.atBudgetSince = -1;
      if (this.headroomSince < 0) this.headroomSince = now;
      if (this.scale < this.max && now - this.headroomSince >= 5000 && now - this.lastAdjust >= 500) { this._set(Math.min(this.max, this.scale + 0.05), now); return true; }
      return false;
    }
    this.headroomSince = -1;
    // vsync-bound with no timing information: probe one step up now and then, back off when it fails
    if (quantized && p75 <= B * 1.05 && this.scale < this.max) {
      if (this.atBudgetSince < 0) this.atBudgetSince = now;
      if (now - this.atBudgetSince >= this.backoff && now - this.lastAdjust >= 500) {
        this.probeFrom = this.scale; this._set(Math.min(this.max, this.scale + 0.05), now); this.probeT = now; this.atBudgetSince = now; this.trial = null;
        return true;
      }
    } else this.atBudgetSince = -1;
    return false;
  }
}

export class AutoQuality {
  constructor() {
    this.win = []; this.winStart = -1; this.lastChange = -1e9; this.lastUp = -1e9; this.headroomSince = -1; this.upWait = 30000;
    this.p90 = 0; this.p50 = 0; this.pending = null; this.ineffective = 0; this.undos = 0;
  }
  restart(now) { this.win.length = 0; this.winStart = now + 2000; this.headroomSince = -1; }
  // → -1 step down, +1 step up, 0 stay. dynAtMin: the resolution can give no more (at its floor, or shown not to
  // change the frame period). canDown false: already on the lowest tier, so an overload asks for nothing (a step
  // that cannot happen must never be undone by a step up). A step down that does not make frames faster (the next window's median) is undone
  // once 30 s have passed, also where upgrades are off (an undo, not an upgrade), and is not tried again at that
  // frame time: a throttled display, for one, gets nothing from a lower tier.
  update(ms, now, budget, { dynAtMin, dynAtMax, canUp, canDown = true, work }) {
    if (now < this.winStart) return 0;
    if (this.winStart < 0) this.winStart = now;
    this.win.push(Math.min(ms, 250));
    const pd = this.pending;
    if (pd && pd.helped === false && now - this.lastChange >= 30000) {
      this.pending = null; this.ineffective = pd.p90; this.lastChange = now; this.undos++; this.win.length = 0; this.winStart = now;
      return 1;
    }
    if (now - this.winStart < 10000) return 0;
    const s = this.win.sort((a, b) => a - b);
    const p90 = this.p90 = s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
    const p50 = this.p50 = s[s.length >> 1];
    const windowStart = this.winStart;
    this.win.length = 0; this.winStart = now;
    if (pd && pd.helped === undefined) { pd.helped = p50 < pd.p50 * 0.9; if (pd.helped) this.pending = null; }
    if (this.ineffective && p90 < this.ineffective * 0.8) this.ineffective = 0;
    if (p90 > budget * 1.3 && dynAtMin && !(this.ineffective && p90 <= this.ineffective * 1.1)) {
      this.headroomSince = -1;
      if (!canDown || now - this.lastChange < 30000 || this.pending) return 0;
      if (now - this.lastUp < 45000) this.upWait = Math.min(240000, this.upWait * 2); // the last upgrade did not hold
      this.lastChange = now; this.pending = { p90, p50 };
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
