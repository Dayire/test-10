import { Crate, Trigger } from '../game/entities.js';

// A 30 m placeholder chapter: a street with a floor, a start wall, lanterns,
// a crate, one checkpoint and an end trigger that completes the chapter.
// Chapter packages replace their stub's index.js; nothing else imports this.
export const STUB_NEEDS = ['cobbles', 'sandstone', 'limestone', 'plasterBlue', 'plasterPeach', 'plasterCream', 'plasterOchre', 'plasterWhite', 'iron', 'brass', 'wood', 'woodDark'];

export function buildStub(game, kit, { tint = 'peach', lanterns = 4, styles = ['peach', 'cream', 'blue', 'ochre', 'white'] } = {}) {
  const { L, r, FZ, ground, block, vbox, lantern, cp, cam, shaft, farBuilding } = kit;
  ground(-20, 52);
  // start wall and the far end (a gate into the next street)
  block(-4, -3, 0, 9, { ledges: false });
  block(31, 32.5, 2.6, 9, { ledges: false });
  vbox(31, 0, FZ, 32.5, 0.15, 1.3, 'limestone', { base: 0 });
  // the street facade: plaster houses with windows, a low step to hop
  for (let x = -3, i = 0; x < 31; i++) {
    const w = 5 + r() * 3;
    farBuilding(x, Math.min(31, x + w), FZ, 6 + r() * 4, styles[i % styles.length], { depth: 4 });
    x += w;
  }
  block(12, 13.2, 0, 0.5, { mat: 'sandstone' });
  // a crate to push
  L.entities.push(new Crate(game, 18.5, 0, 1.0));
  for (let i = 0; i < lanterns; i++) lantern(2 + i * 7.5, 3.0, FZ + 0.02, { bracketDir: 1, light: true, intensity: 2.5 });
  // far city
  for (let x = -40; x < 80;) { const w = 6 + r() * 8; farBuilding(x, x + w, -16 - r() * 10, 7 + r() * 6, styles[Math.floor(r() * styles.length)], { depth: 6, cast: false }); x += w + r() * 3; }
  cp(-100, 1.5, 0, 1);
  cam(-10, { dist: 12.5, height: 1.4, lookY: 1.3, fov: 34 });
  cam(40, { dist: 12.5, height: 1.4, lookY: 1.3, fov: 34 });
  shaft(9, 0, 0.5, { w: 1.6, len: 12, intensity: 0.1 });
  L.dustRegions.push({ x0: -3, x1: 31, y0: 0.2, y1: 5, z0: -1.4, z1: 1.4 });
  L.flockSpots.push({ x: 24, y: 0, z: 1.4, w: 2.5, n: 3 });
  L.triggers.push(new Trigger({ id: 'end', x0: 28, x1: 40, fn: (g) => g.completeChapter() }));
  L.bounds = { x0: -20, x1: 52, y0: -5, y1: 20 };
  L.mix = () => ({ zone: 'alley', birds: tint !== 'night', tension: 0.1 });
  L.extraState = () => ({ crate: +L.entities[0].body.x.toFixed(2) });
  return L;
}

export const stubIntro = { pos: [6, 3.2, 14], look: [12, 3.6, -6], fov: 40, sway: 0.4, dur: 3 };
export const stubAudio = (theme) => ({ theme, zones: [{ x0: -100, x1: 100, verb: 'alley', amb: 'souk', music: 'none', tension: 0.1 }] });
