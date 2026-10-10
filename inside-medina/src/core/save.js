import { storage } from './storage.js';

// Progress and settings, one JSON record (§7.3). Never stores entity
// snapshots: Continue loads {chapter, cp} and the chapter's prepare(cp)
// rebuilds the world state. Checkpoints are debounced 1 s, settings 500 ms;
// chapter ends, pause, hiding the page and pagehide write at once.
export const SAVE_KEY = 'medina.save.v1';
export const THUMB_KEY = (id) => `medina.v1.thumb.${id}`;

const fresh = () => ({
  v: 1, chapter: 'souk', cp: 0, unlocked: ['souk'], cps: { souk: 0 }, completed: false,
  settings: {}, stats: { playSec: 0, deaths: 0, perChapter: {} }, seenHints: {},
});

export class Save {
  constructor(store = storage) {
    this.store = store;
    this.data = fresh();
    this.exists = false;
    this.timers = {};
    this.dirty = false;
    this.onWrite = null;
  }
  load() {
    const d = this.store.getJSON(SAVE_KEY);
    if (d && d.v === 1 && typeof d.chapter === 'string') {
      const f = fresh();
      this.data = { ...f, ...d, stats: { ...f.stats, ...(d.stats || {}) }, cps: { ...f.cps, ...(d.cps || {}) }, unlocked: [...new Set([...(d.unlocked || []), 'souk'])] };
      this.exists = true;
    }
    return this.data;
  }
  write() {
    for (const k of Object.keys(this.timers)) { clearTimeout(this.timers[k]); delete this.timers[k]; }
    this.data.savedAt = Date.now();
    this.store.setJSON(SAVE_KEY, this.data);
    this.exists = true; this.dirty = false;
    this.onWrite?.(this.data);
  }
  later(ms, key = 'progress') { clearTimeout(this.timers[key]); this.timers[key] = setTimeout(() => { delete this.timers[key]; this.write(); }, ms); }
  get pending() { return Object.keys(this.timers).length > 0; }
  // pending debounced writes now; force also writes unsaved play stats (pause, hidden page)
  flush(force = false) { if (this.pending || (force && this.dirty)) this.write(); }
  // a chapter started (load, chain, continue): the place Continue returns to, written with the next save
  begin(chapter, cp) {
    const d = this.data;
    if (d.chapter !== chapter || d.cp !== cp) { d.chapter = chapter; d.cp = cp; this.dirty = true; }
    this.unlock(chapter);
  }
  unlock(id) { if (id && !this.data.unlocked.includes(id)) this.data.unlocked.push(id); }
  checkpoint(chapter, cp) {
    const d = this.data;
    d.chapter = chapter; d.cp = cp;
    this.unlock(chapter);
    d.cps[chapter] = Math.max(d.cps[chapter] ?? 0, cp);
    this.later(1000);
  }
  chapterEnd(id, next) {
    const d = this.data;
    if (next) { d.chapter = next; d.cp = 0; this.unlock(next); d.cps[next] = d.cps[next] ?? 0; } else d.completed = true;
    this.write();
  }
  settings(s) { this.data.settings = { ...this.data.settings, ...s }; this.later(500, 'settings'); }
  death(chapter) { this.dirty = true; const s = this.data.stats; s.deaths++; const p = (s.perChapter[chapter] ||= { deaths: 0, playSec: 0 }); p.deaths++; }
  play(chapter, sec) { this.dirty = true; const s = this.data.stats; s.playSec += sec; const p = (s.perChapter[chapter] ||= { deaths: 0, playSec: 0 }); p.playSec += sec; }
  seenHint(id) { this.data.seenHints[id] = true; this.later(1000); }
  // new journey: progress cleared, settings and unlocks kept
  newJourney() { const { settings, unlocked, cps, completed } = this.data; this.data = { ...fresh(), settings, unlocked, cps, completed }; this.write(); }
  reset() { const settings = this.data.settings; this.data = { ...fresh(), settings }; this.write(); }
}
