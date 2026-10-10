import { SURFACE_NAMES } from '../../render/textures.js';
import { buildLevel } from './level.js';

// Chapter I: the souk, golden hour. Built exactly as the original level;
// its finale walks the boy into the light and hands over to Chapter II.
export default {
  id: 'souk', n: 1, numeral: 'I', glyph: 'sunHigh', label: 'the souk', next: 'sundown',
  look: 'goldenHour',
  needs: SURFACE_NAMES.slice(), // the souk uses the whole base surface set
  surfaces: {}, materials: {},
  audio: {
    theme: 'hijaz',
    zones: [
      { x0: -100, x1: 70, verb: 'alley', amb: 'souk', music: 'souk', tension: 0.1 },
      { x0: 70, x1: 118, verb: 'courtyard', amb: 'courtyard', music: 'stealth', tension: 0.35, hum: 1 },
      { x0: 118, x1: 300, verb: 'alley', amb: 'souk', music: 'souk', tension: 0.1 },
    ],
  },
  // establishing shot over the souk (title and chapter intro)
  intro: { pos: [5, 4.2, 15.5], look: [7, 6.8, -10], fov: 42, sway: 0.5, dur: 5 },
  menuShot: { pos: [5, 4.2, 15.5], look: [7, 6.8, -10], fov: 42, sway: 0.5, cp: 0 },
  build: (game, kit) => buildLevel(game, kit),
};
