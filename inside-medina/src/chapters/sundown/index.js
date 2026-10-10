import { buildStub, STUB_NEEDS, stubIntro, stubAudio } from '../stub.js';

// Chapter II: brass at sundown (stub until the chapter package lands).
export default {
  id: 'sundown', n: 2, numeral: 'II', glyph: 'sunHorizon', label: 'brass at sundown', next: 'night',
  look: 'sunset',
  needs: STUB_NEEDS, surfaces: {}, materials: {},
  audio: stubAudio('bayati'),
  intro: stubIntro, menuShot: { ...stubIntro, cp: 0 },
  build: (game, kit) => buildStub(game, kit, { styles: ['peach', 'ochre', 'cream', 'peach', 'stone'] }),
};
