// Chapter registry. Menus read the metadata here without loading a chapter;
// getChapter(id) imports the chapter module on demand and merges the two.
// dev: hidden from menus and from the chain (the Sunwork test chapter). cps: checkpoints (FULL_GAME §2–5), for menus
// that draw them before the chapter is built.
export const CHAPTERS = [
  { id: 'souk', cps: 7, n: 1, numeral: 'I', glyph: 'sunHigh', label: 'the souk', next: 'sundown', exit: '#f8e6c7', tone: '#c98a4a', load: () => import('./souk/index.js') },
  { id: 'sundown', cps: 11, n: 2, numeral: 'II', glyph: 'sunHorizon', label: 'brass at sundown', next: 'night', exit: '#0b1026', tone: '#b4532a', load: () => import('./sundown/index.js') },
  { id: 'night', cps: 8, n: 3, numeral: 'III', glyph: 'crescent', label: 'the lamp-keepers', next: 'dawn', exit: '#9fb0d8', tone: '#22305a', load: () => import('./night/index.js') },
  { id: 'dawn', cps: 7, n: 4, numeral: 'IV', glyph: 'sunRise', label: "the timekeeper's mirror", next: null, exit: '#fff3dc', tone: '#d9906e', load: () => import('./dawn/index.js') },
  { id: 'lab', n: 0, numeral: '0', glyph: 'rosette', label: 'lab', next: null, dev: true, exit: '#000000', tone: '#6d6a60', load: () => import('./lab/index.js') },
];
export const CHAPTER_IDS = CHAPTERS.map((c) => c.id);
export const PLAYABLE = CHAPTERS.filter((c) => !c.dev);
export const meta = (id) => CHAPTERS.find((c) => c.id === id) || null;

const loaded = new Map();
export async function getChapter(id) {
  const m = meta(id);
  if (!m) throw new Error(`unknown chapter ${id}`);
  if (!loaded.has(id)) {
    const mod = await m.load();
    const { load, ...info } = m;
    loaded.set(id, { ...info, ...mod.default, id });
  }
  return loaded.get(id);
}
