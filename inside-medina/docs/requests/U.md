# Requests from U (the shell) for files U does not own

Everything U ships works without these (fallbacks noted). Each entry: file, change, reason, test.

## 1. `docs/ARCHITECTURE.md` (F / integrator): the shell's contracts

- **Change.** In §3 (Boot) add the order U's `boot.js` now follows (UI and Input first, the main menu interactive
  before the world exists, the loop started before the chapter load, `nextFrame()` waiting for a presented frame),
  the marks `window.__boot.menu`, the URL flags `?unlock=1` (every chapter selectable) and `?nosw=1` (no service
  worker), and `window.__ui` (the shell, for tests). In §9 (Input) add `nav.prev`, `nav.next`, `nav.pause`, that the
  press edges (`jumpPressed`, `grabPressed`, `pausePressed`, `anyPressed`) compare with the raw previous poll (so
  `setMenuOpen` zeroing `state`/`prev` never makes a held key a new press), `padKind(id)`, `input.on('device' |
  'padDisconnect')`, `input.touchUI`, `input.haptics`, the crawl toggle. In §5 (Settings) add the keys the shell adds:
  `touchStick, touchSize, touchOpacity, leftHanded, vibration, soundCues, highContrast, menuScale, batterySaver,
  motionBlur, reduceFlashing`, `cameraDist: 'auto'` (persisted as `auto`, applied resolved), and that `timeScale` is
  stored as 100 / 85 / 70. Point to `docs/systems/ux.md`.
- **Reason.** §11.2 F16 makes ARCHITECTURE.md the contract every package reads.
- **Test.** Documentation only.

## 2. `package.json` (F): scripts

- **Change.** `"test:ux": "node tools/ux-tests.mjs"`, `"test:mobile": "node tools/mobile-tests.mjs"`,
  `"icons": "node tools/make-icons.mjs"`, `"font": "node tools/fetch-font.mjs"`; add both test scripts to `npm test`
  after the foundation suite.
- **Reason.** FULL_GAME §12 step 3 runs `ux-tests` and `mobile-tests` in the full matrix.
- **Test.** `npm run test:ux -- --port 5176` exits 0.

## 3. L and the chapters: high contrast and reduced flashing

- **Change.** Read `game.settings.highContrast` (boolean, live: `applySettings` merges it) to outline beams and lock
  rims (L, `src/game/light/beams.js`, targets), tripwires and searchlight cones (L's `Sensor`, `Searchlight`; C3's
  night chapter); read `game.settings.reduceFlashing` to cap glints, the dazzle flash and lamp flares (L) — P already
  caps bloom, flares, rays and lens dirt.
- **Reason.** FULL_GAME §7.4 accessibility; the shell stores and applies both, but the outlines are drawn by the
  light system.
- **Test.** `?chapter=lab&cp=3`, `__ui.setSetting('highContrast', true)`: the beam and the rosette locks show an
  outline; a screenshot differs from `false` near the beam only.

## 4. C4: the drum for the visual sound cues

- **Change.** When the drummer of Chapter IV strikes, call `game.sfx('drum', x)` (or `audio.play('drum', x)`), so the
  sound reaches every listener of the game's sounds; P's audio ignores the unknown name if it plays the drum itself
  from `mix.drummer`.
- **Reason.** FULL_GAME §7.4 "visual sound cues: edge glyphs for horn, shout, drum": the shell listens to the sounds
  the game plays (`alarm` → horn, `shout`, `dart`/`turret`, `drum`); the drum lives only in the mix today.
- **Test.** `__ui.setSetting('soundCues', true)`, `?chapter=dawn`: a drum beat shows the drum glyph on the drummer's
  side (`#cues .cue.on`).

## 5. F / C4: the epilogue as the title background after completion

- **Change.** FULL_GAME §5.2 P4 step 8 and §7.1: after the credits the title shows the epilogue shot (the Chapter I
  pedestal, no boy) "from then on". Proposal: C2 adds `epilogue: {pos, look, fov, sway}` to the souk's definition and
  C4 marks the save (`save.data.completed`, already set by `chapterEnd`); F's `toTitle()` loads the souk when the
  save is completed and the title over it uses `def.epilogue` (hiding the boy) instead of `menuShot`. U's boot then
  needs one line: when `save.data.completed` and no `?chapter=`, start at the souk (Continue still loads the save's
  place).
- **Reason.** The shell shows whatever place the engine puts under the title; the shot and the boy's visibility are
  the engine's and the chapter's.
- **Test.** A completed save (`completed: true, chapter: 'dawn'`): the title shows the pedestal without the boy;
  the chapter select lists all four chapters.

## 6. `src/chapters/index.js` (F): checkpoint counts in the registry

- **Change.** Add `cps: n` (the number of checkpoints) to each `CHAPTERS` entry (souk 7, sundown 11, night 8, dawn 7,
  as FULL_GAME §2–5).
- **Reason.** The chapter select draws a pip per checkpoint without loading the chapter; it uses those numbers from
  FULL_GAME and corrects them with the counts it sees when a chapter loads (`medina.v1.ui`), which is only right after
  a chapter has been played once on this device.
- **Test.** `__ui.chapters.render()` with an empty `medina.v1.ui`: the sundown card has 11 pips.

## 7. C2: the souk's own hint zones (`src/chapters/souk/level.js`)

- **Change.** Declare `L.hints` (FULL_GAME §7.6) at the souk's first uses of each verb:
  ```js
  L.hints = [
    { x0: 6.4, x1: 8.15, after: 0.6, glyph: 'jump', unless: (g) => g.player.x > 8.9 || g.player.y > 0.3 },           // the sack pile
    { x0: 35.4, x1: 37.0, after: 1.5, glyph: 'grab', unless: (g) => L.crateA.body.x > 38.5 || !!g.player.grip },     // crate A
    { x0: 40.2, x1: 41.0, y1: 0.2, after: 0.8, glyph: 'jump', unless: (g) => L.crateA.body.x < 40.9 },                // onto the crate at the terrace
    { x0: 109.6, x1: 111.4, after: 1.0, glyph: 'grab', unless: () => L.lever.pulled },                               // the lever
    { x0: 121.2, x1: 124.0, y1: 0.5, after: 0.8, glyph: 'up', unless: (g) => g.player.state === 'climb' },          // the ivy wall
    { x0: 181.2, x1: 182.6, after: 1.0, glyph: 'crawl', unless: (g) => g.player.crawling },                          // the rubble tunnel
  ];
  ```
- **Reason.** The chapter knows where each verb is first needed; the zones are puzzle-honest (no grab glyph once the
  crate has moved, no jump glyph at the terrace until the crate is at its foot). Until they exist the shell teaches
  the same verbs from context in every chapter (`src/ui/hints.js` `CONTEXT`: a vine's foot, a ledge he hangs from, a
  crate or lever at hand, an obstacle a jump clears — never a wall too high), and the pause screen lists the play
  controls for the device in hand. A chapter's zones take precedence over the context hints.
- **Test.** `node tools/ux-tests.mjs --only hints` (already passes with the context hints); with the zones, the same
  scenario with `__ui.save.data.seenHints = {}` shows `souk:0` (jump) at x 7.4 and `souk:1` (grab) at x 36.

## 8. `src/render/renderer.js` (P): a tier change keeps the menu background

- **Change.** In `setTier` (or `_configureTier`), when `this.menuBackground` is on, keep the dynamic-resolution range
  at 0.5 / 0.5 and the scale at 0.5 (as `setMenuBackground(true)` sets them) instead of resetting them to the new
  tier's range and 1.
- **Reason.** requests/P.md #8: the title renders at half resolution under the menus. A quality change in settings
  over the title (or auto quality) went back to full resolution until the menu closed. The shell now re-asserts the
  menu background when `rs.tier` changes (`ui.syncMenuBackground`), which works; this would make the renderer honour
  its own flag.
- **Test.** `node tools/ux-tests.mjs --only menubg` (it sets quality medium over the title and expects internal =
  half of full and cap 30); it passes either way.

## Notes (no change requested)

- A pad alone cannot start the audio: browsers do not count gamepad buttons as a user activation, so the music
  starts on the first key, click or touch (P resumes on those).
- Finger aim is tested against the lab stub on this branch (the touch reaches `pin.aimTarget` at the touched world
  point, within 5 cm); with L's Sunwork lab merged, `tools/mobile-tests.mjs --only aim` grips `M2` (room "tilt",
  checkpoint 3), touches the lock `L4` and expects the mirror at −45°.
