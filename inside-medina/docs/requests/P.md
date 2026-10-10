# Requests from P (presentation) for files P does not own

Everything below already works through optional chaining or default arguments, so nothing breaks
before these land. Each entry: file, change, reason, test. "Landed" marks what the foundation
(b5fb61d) already does; it stays here because P's tests depend on it.

## 1. `src/game/boot.js` (F12, then U): frame cap and paused frames (landed)

- **Change.** The rAF loop calls `world.rs.beginFrame?.(now)` first and skips the callback when it
  returns false; `world.rs.trackFrame(dt * 1000, { paused: game.paused, hidden: document.hidden })`
  with `last` advanced only on rendered frames.
- **Test.** `node tools/perf.mjs --only checks --check capLoop`: the real loop under a stubbed 120 Hz
  `requestAnimationFrame` (installed before boot) renders 60 frames per stub second with `fpsCap: 60`.
  On a tree whose loop never calls `beginFrame` the check reports `pending` instead of passing.

## 2. `src/game/boot.js`: mute (landed)

- **Change.** `audio.setMuted?.(m)`; the direct `audio.master.gain` write is only the fallback.
  P provides `setMuted(on)` (F's request 2): the mute acts on the user master, so `fadeIn` never undoes it.
- **Test.** `node tools/audio-tests.mjs --only muteFadeIn`.

## 3. `src/game/game.js` (F4): pause, chapter and zone (landed)

- **Change.** `setPaused(p)` → `audio.setPaused?.(p)` (ducks the game buses; the ui bus keeps playing);
  `enterChapter` → `audio.setChapter?.(def.audio, def)`; a changed `mix.zone` → `audio.setZone?.(zone)`.
- **Schema P accepts** (FULL_GAME §11.2 F1, `docs/systems/audio.md`):
  - `audio.theme`: a chapter id (`souk, sundown, night, dawn, lab`), `menu`, `credits`, or a maqam name
    (`hijaz, bayati, saba, rast`). A maqam name keeps the theme of the chapter passed as the second
    argument (`def.id`) and sets that maqam.
  - `zones[].amb`: a number (bed level, 1 = as is), a place (`alley, souk, courtyard, madrasa, cistern,
    minaret, open, roof`) that colours the chapter's bed, or another theme's bed name.
  - `zones[].music`: a music state (`silent, explore, tension, chase, clock, credits, finale`) or one of
    the aliases `none → silent`, `stealth → tension`, `souk → explore`; anything else is ignored. The
    game's `chase` / `finale` flags win over a zone's music, an explicit `mix.music.state` wins over both.
  - `mix.zone` (string reverb place or object) overrides fields of the chapter zone under the listener.
  - `zones[].verb`: a reverb place (`alley, souk, courtyard, madrasa, cistern, minaret, open`).
  Non-finite numbers are ignored, so `update` never throws (a throw would end the boot loop).
- **Test.** `node tools/audio-tests.mjs --only schema`.

## 4. `src/render/lookdirector.js` (F7): night sky, LUT looks, user brightness and grain

- **Night sky (landed, no change).** The director writes `uMoonSize = moonSize × moon`. P's sky reads
  `uMoonSize` as a multiplier of `MOON_RADIUS` (0.045 rad, `sky.js`), so the presets' `moonSize: 1` gives the
  intended disc and `moon: 0` hides it. Test: `node tools/perf.mjs --only checks --check nightSky --shots dir`
  (stars, a dark sky, a moon disc of the expected size with exactly those values).
- **LUT looks (new).** `LUT_LOOKS` (`src/render/lut.js`) has one look per preset (`goldenHour` is the
  identity). In `write()`, after the post params:
  - a plain preset: `w.rs?.setLut?.(this.name)`;
  - during `blendTo`: `w.rs?.setLut?.(b.from name, b.name, smooth(b.t))`;
  - with x-keys: `w.rs?.setLut?.(K[i].name, K[i + 1].name, t)` (keep the preset names next to the resolved keys).
  Reason: the LUT stays off in the integrated game otherwise. Test: `?chapter=night` →
  `world.rs.post.params.lutA === lut('night')` and `lut === 1`; `node tools/perf.mjs --only checks --check lut`.
- **Brightness and grain have one owner: P (new).** P applies the user's settings in the final pass
  (`post.params.userExposure = 2^(0.18·b)`, `userGamma = 1 − 0.035·b`, `grainScale = grain / 60`), which the
  director never writes. Change: `setUser()` becomes a no-op and `write()` uses `P.exposure = c.exposure;
  P.grain = c.grain` (or `game.applySettings` stops calling `director.setUser`). Reason: today both apply,
  so grain 100 gives 2.78× grain and brightness +3 about 1.8× exposure plus the gamma lift.
  Test: `applySettings({brightness: 3, grain: 100})` → `rs.post.params.exposure` equals the preset's
  exposure and `grain` the preset's grain; `userExposure ≈ 1.45`, `grainScale ≈ 1.67`.
- **Rim (optional).** Retint the character rim per preset: `G.uRimColor` (sun colour, the moon's at night).

## 5. `src/game/game.js` / chapter loader: context loss (landed)

- `rs.onContextLost(fn)` / `rs.onContextRestored(fn)` return an unsubscribe function; the foundation listens
  on the canvas directly, which is equivalent. Test: `node tools/perf.mjs --only checks --check contextLoss`.

## 6. URL test flags over saved settings (no change needed)

- Under `?noauto`, `rs.applySettings` ignores `quality: 'auto'` (the tier stays fixed) and `dynres` (fixed
  resolution) unless `?dynres=1`; `?dynres=0` turns dynamic resolution off whatever the settings say. An
  explicit quality (`low`…`ultra`) still applies. This matches `game.applySettings`
  (`rs.autoQuality = !params.noauto`). Test: `node tools/perf.mjs --only checks --check settingsNoauto`.

## 7. Particles across chapter loads (no change needed)

- Live GPU particles are cleared when a direct child subtree of the scene is removed (the loader's
  `scene.remove(root)`), so moths and smoke never carry into the next chapter. `rs.clearEffects()` does the
  same explicitly. Test: the `contracts` check (`particlesClear`).

## 8. `src/ui/**` (U): menu background

- **Change.** While the main menu is up over the live shot: `world.rs.setMenuBackground?.(true)` (30 fps at
  half resolution, FULL_GAME §7.2); `false` when play starts.
- **Test.** `world.rs.stats.cap === 30` and `stats.internal` is half the canvas while the menu shows.

## 9. `src/game/entities.js` (L): the Chapter I searchlight cone

- **Change.** `BEAM_FS` ends with `#include <fog_fragment>`; the cone moves to `LAYERS.BEAMS` with
  `softFade` (`src/render/layers.js`, as FULL_GAME §6.5 asks of L's beams).
- **Reason.** In the LDR fallback every colour is stored Reinhard-encoded by that chunk; the cone skips it,
  so the post chain decodes it too bright (the beam core blows out to white over the carpets with `?ldr=1`).
- **Test.** `?ldr=1&tier=low`, courtyard: the cone matches the float path within the LDR check's tolerance.
