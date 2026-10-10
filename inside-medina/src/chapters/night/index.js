import { buildStub, STUB_NEEDS, stubIntro, stubAudio } from '../stub.js';

// Chapter III: the lamp-keepers (stub until the chapter package lands).
export default {
  id: 'night', n: 3, numeral: 'III', glyph: 'crescent', label: 'the lamp-keepers', next: 'dawn',
  look: 'night',
  needs: STUB_NEEDS, surfaces: {}, materials: {},
  audio: stubAudio('saba'),
  intro: stubIntro, menuShot: { ...stubIntro, cp: 0 },
  build: (game, kit) => buildStub(game, kit, { tint: 'night', lanterns: 5, styles: ['blue', 'white', 'cream', 'blue', 'stone'] }),
};
