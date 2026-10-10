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
- **Rim (no change needed).** P's `Lighting.update` derives the character rim from the key light the director
  has just written (its colour half way to white, strength 0.55 × √(intensity / 7)), so every preset gets its
  own rim: the moon's is faint and cool, dawn before sunrise has none. `world.light.rimAuto = false` hands
  `G.uRimColor` / `G.uRimStrength` back to a caller that wants to drive them.
- **Shafts and dust (no change needed).** `shafts.setSun(dir, colour)` stays as it is: their brightness follows
  `G.uSunLight` (the key light's intensity / 7, written by `Lighting.update`), so they fade at dusk and stop
  drawing at dawn. Passing a third argument (`intensity / 7`) is equivalent and optional.

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

## 10. The low tier's budget (FULL_GAME §8.5): characters and the main pass

P now merges the level's static batches into shadow-only proxies (12 m tiles × depth bands, 16-bit positions,
`src/render/shadowpolicy.js`), culls them against the view along the sun, and on low / medium drops the ones
whose shadow cannot reach the play area. The first part of the earlier request (a near/far batch split with far
casters off) is no longer needed. Measured with `node tools/perf.mjs --tiers low,medium,high` (P's tree, 640 × 360,
shadow + main calls / triangles per frame at a 60 fps cadence): medium and high are within budget at all six
Chapter I spots; low is within at the souk only:

| low (130 / 400 k) | souk | raised | rooftops | courtyard | balcony | chase |
|---|---|---|---|---|---|---|
| calls at 60 fps (shadow + main) / triangles | 128.5 / 303 k | 130.5 / 411 k | 124 / 402 k | 136.5 / 449 k | 146.5 / 511 k | 133.5 / 463 k |
| calls per frame at 30 fps (shadow + main) | 45 + 106 | 47 + 107 | 44 + 102 | 76 + 101 | 69 + 112 | 47 + 110 |

What remains is the main pass, which P does not own (101–112 draws and 213–354 k triangles before any shadow),
and casters P cannot prove static.

- **Characters** (`src/assets/character.js`, frozen; the integrator or L). The boy is 21 rigid parts: 21
  shadow draws and 22 main draws; a guard adds about 13 of each. Change: merge each character's parts by
  material into skinned meshes (skin, clothRed, clothTrousers, leather, hair, scarf: 6 draws). Reason: −15 shadow
  and −16 main draws per boy, which brings every low spot under 130 calls at 60 fps. Test: the
  `__medina.game.rig` mesh count; `node tools/perf.mjs --tiers low` shows ≤ 130 calls at every spot.
- **Lanterns** (`src/chapters/souk/level.js` and the levelkit `lantern`, F / C2). Each hanging lantern is a
  3 k-triangle mesh that sways (±0.03 rad), so it is a moving caster: 24 shadow draws and 72 k shadow triangles at
  the courtyard, 28 at the balcony. Change: set `userData.staticCaster = true` on the lantern body (and on any
  other prop that only sways): the shadow policy then merges it into the static proxies, whose shadow keeps the
  pose the lantern had when it was merged (within 2 cm of any other). Reason: with the characters merged, this brings the courtyard and the balcony under
  130 calls at low's own 30 fps. Test: `rs.shadows.stats.proxied` grows by the lantern count; shadow calls at
  the courtyard −24.
- **The main pass on low** (`src/game/levelkit.js` / the chapter Batcher, F). About 70 per-material batches per
  frame (40 m chunks, each from the play plane to 90 m back) carry 213–354 k triangles. Change, low tier only: a
  cheaper far set (beyond z −20: facades without window, arch and moulding detail, or a baked skyline card per
  chunk), or a coarser chunk for far geometry. Reason: the triangle budget (400 k with shadows) at the raised,
  rooftops, courtyard, balcony and chase spots. Test: `node tools/perf.mjs --tiers low`, triangles ≤ 400 k.

## 11. `src/game/game.js` / chapter loader (F): discontinuities (optional)

- **Change.** Call `world.rs.markDiscontinuity?.()` after a respawn or a cut that does not move the camera.
- **Reason.** Dynamic resolution and auto quality ignore the frames right after a discontinuity (compiles,
  uploads). P already detects a chapter root added to or removed from the scene and a camera jump of more than
  4 m, which covers loads, checkpoints and most respawns; this covers the rest.
- **Test.** `node tools/perf.mjs --only checks --check dynSignal,throttleLoop`.
