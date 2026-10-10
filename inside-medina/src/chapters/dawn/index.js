import { buildStub, STUB_NEEDS, stubIntro, stubAudio } from '../stub.js';

// Chapter IV: the timekeeper's mirror (stub until the chapter package lands).
// The look blends from dawn to sunrise along x.
export default {
  id: 'dawn', n: 4, numeral: 'IV', glyph: 'sunRise', label: "the timekeeper's mirror", next: null,
  look: [{ x: 0, preset: 'dawn' }, { x: 30, preset: 'sunrise' }],
  needs: STUB_NEEDS, surfaces: {}, materials: {},
  audio: stubAudio('rast'),
  intro: stubIntro, menuShot: { ...stubIntro, cp: 0 },
  credits: ['made entirely of code', 'three.js'],
  build: (game, kit) => buildStub(game, kit, { styles: ['cream', 'white', 'peach', 'ochre', 'stone'] }),
};
