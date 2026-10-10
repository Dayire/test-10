import { buildStub, STUB_NEEDS, stubIntro, stubAudio } from '../stub.js';

// The Sunwork test chapter (dev only, hidden from menus; stub until the light package lands).
export default {
  id: 'lab', n: 0, numeral: '0', glyph: 'rosette', label: 'lab', next: null, dev: true,
  look: 'goldenHour',
  needs: STUB_NEEDS, surfaces: {}, materials: {},
  audio: stubAudio('hijaz'),
  intro: stubIntro, menuShot: { ...stubIntro, cp: 0 },
  build: (game, kit) => buildStub(game, kit, { lanterns: 3, styles: ['white', 'cream', 'white', 'stone'] }),
};
