// Game event bus: on/off/once/emit, plus a ring buffer of recent events that
// tests read through __medina.events(). Payloads are copied shallowly (plain
// values only) so the log never pins entities. A throwing listener does not
// stop the game; its error is rethrown asynchronously so it still surfaces.
const plain = (d) => {
  if (d === null || typeof d !== 'object') return d;
  const o = {};
  for (const [k, v] of Object.entries(d)) if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) o[k] = v;
  return o;
};

export class Events {
  constructor(cap = 256) {
    this.map = new Map();
    this.log = [];
    this.cap = cap;
    this.clock = () => 0;
  }
  on(name, fn) { if (!this.map.has(name)) this.map.set(name, new Set()); this.map.get(name).add(fn); return () => this.off(name, fn); }
  off(name, fn) { this.map.get(name)?.delete(fn); }
  once(name, fn) { const off = this.on(name, (d) => { off(); fn(d); }); return off; }
  emit(name, data) {
    this.log.push({ name, t: Math.round(this.clock() * 1000) / 1000, data: plain(data) });
    if (this.log.length > this.cap) this.log.shift();
    for (const key of [name, '*']) {
      const set = this.map.get(key);
      if (!set) continue;
      for (const fn of [...set]) {
        try { key === '*' ? fn(name, data) : fn(data); } catch (e) { setTimeout(() => { throw e; }); }
      }
    }
  }
  // resolves with the payload of the next `name` event (tests, loaders)
  next(name) { return new Promise((r) => this.once(name, r)); }
  recent(n = 0) { return n ? this.log.slice(-n) : this.log.slice(); }
}

// Names emitted by the engine (chapters and entities may add their own through game.emit)
export const EVENT_NAMES = ['chapterStart', 'checkpoint', 'death', 'respawn', 'chapterEnd', 'credits', 'title', 'pause', 'mode', 'land', 'impact', 'save', 'loadError', 'contextLost', 'contextRestored'];
