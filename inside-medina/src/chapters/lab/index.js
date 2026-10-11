import { STUB_NEEDS } from '../stub.js';
import { buildLab, LOOK_KEYS } from './rooms.js';
import { PRESETS } from '../../render/look.js';

// The Sunwork lab (dev only, hidden from menus): twelve rooms, one per light verb (FULL_GAME §11.4 L), from
// sunset through the sunset clock and the night to dawn. ?look=<preset> holds one preset for the whole lab
// (goldenHour, sunset, dusk, night, dawn, sunrise), to see every room under each light.
const q = typeof location !== 'undefined' ? new URLSearchParams(location.search) : null;
const held = q?.get('look');
export default {
  id: 'lab', n: 0, numeral: '0', glyph: 'rosette', label: 'lab', next: null, dev: true,
  look: held && PRESETS[held] ? held : LOOK_KEYS,
  needs: [...new Set([...STUB_NEEDS, 'rug', 'fabricRed', 'fabricCream', 'burlap', 'ivyLeaf', 'lattice', 'wicker', 'zellige'])],
  surfaces: {}, materials: {},
  audio: {
    theme: 'lab',
    zones: [
      { x0: -100, x1: 176, verb: 'courtyard', amb: 'sundown', music: 'explore', tension: 0.1 },
      { x0: 176, x1: 206, verb: 'open', amb: 'sundown', music: 'explore', tension: 0.2 },
      { x0: 206, x1: 345, verb: 'alley', amb: 'night', music: 'tension', tension: 0.3 },
      { x0: 345, x1: 600, verb: 'open', amb: 'dawn', music: 'explore', tension: 0.1 },
    ],
  },
  intro: { pos: [4, 4.6, 18], look: [8, 4.4, -4], fov: 40, sway: 0.4, dur: 3 },
  menuShot: { pos: [4, 4.6, 18], look: [8, 4.4, -4], fov: 40, sway: 0.4, cp: 0 },
  chunk: 48,
  build: (game, kit) => buildLab(game, kit),
};
