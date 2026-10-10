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
- **Brightness and grain: one owner per component (no change needed).** The director already scales the
  look's exposure by `1 + 0.08·brightness` and its grain by `grain / 60` as it writes them every frame; P's
  `rs.applySettings` no longer touches either and adds only the gamma lift the director lacks
  (`post.params.userGamma = 1 − 0.04·brightness`, which lifts dark scenes for the Chapter III calibration).
  Measured on F's tree with P's files at brightness +3 and grain 100: exposure 1.24×, grain 1.67×, gamma 0.88,
  each applied once (before this change, P scaled both a second time: 1.80× exposure and 2.78× grain).
  Test: `game.applySettings({brightness: 3, grain: 100})` → `post.params.userExposure === 1`,
  `grainScale === 1`, `userGamma ≈ 0.88`, `exposure` = preset × 1.24.
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

## 10. The low tier's draw-call budget (FULL_GAME §8.5): batches and characters

`tools/perf.mjs` now prints the §8.5 budget per tier and spot (calls of the shadow and main passes, triangles)
and warns when a spot is over. On low (budget 130 calls, 400 k triangles) every Chapter I spot is over:
144–177 calls at a 60 fps cadence, and at low's own 30 fps target, where the 30 Hz shadow map refreshes every
frame, 192 (souk) to 244 (balcony). P's passes are already lean there (shadow refresh, small-caster cull, no
soft pass, sky, three shaft slabs, one dust draw, the instanced flock). What remains is structural:

- **Level batches** (`src/game/levelkit.js` / the chapter Batcher, F). A frame at the souk spot draws about
  55 merged batches in the shadow pass and 70 in the main pass. Each batch is one material over a 40 m chunk,
  from the play plane to 90 m behind it, so neither frustum culling nor a depth cut can thin it. Change: split
  each chunk's batches into a near set (z ≥ −12) and a far set, and give the far set `castShadow = false`.
  Optionally, for the shadow pass, merge each chunk's opaque, non-alpha-tested statics into one positions-only
  caster. Reason: about 40 of the 86 shadow draws at the souk are far facades whose shadows land only on other
  far geometry. Test: `node tools/perf.mjs --tiers low`, souk shadow calls per update ≤ 50.
- **Characters** (`src/assets/character.js`, frozen; the integrator or L). The boy is 21 rigid parts: 21
  shadow draws and 22 main draws. A guard adds about 13 of each. Change: merge each character's parts by material
  into skinned meshes (skin, clothRed, clothTrousers, leather, hair, scarf: 6 draws). Reason: it saves about 30
  draws per pass in the courtyard and the chase. Test: the `__medina.game.rig` mesh count; low, courtyard, ≤ 140
  calls at 30 fps.
