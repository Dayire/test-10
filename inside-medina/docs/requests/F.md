# Requests from the foundation (F)

The foundation calls these through optional chaining, so nothing breaks while
they are missing. Each is a small addition in a file F does not own.

## 1. `src/render/lighting.js` (P): `setExtent(e)`

- **Change:** `setExtent(e)` sets `this.extent = e` and the sun shadow camera's `left/right = ∓e`, `top/bottom = ±0.8e`, then `updateProjectionMatrix()`.
- **Reason:** a chapter may declare `L.shadowExtent` (FULL_GAME §11.2 F1); the loader calls `world.light.setExtent?.(L.shadowExtent)`. Today the extent is fixed at 22 m.
- **Test:** load a chapter whose `build` sets `L.shadowExtent = 30`; `__medina.game.world.light.sun.shadow.camera.right === 30`; loading souk afterwards (no `shadowExtent`) restores 22 (the loader passes 22 when a chapter declares none).

## 2. `src/core/audio.js` (P): `setMuted(on)`

- **Change:** `setMuted(on)` sets `muted` and drives the user master gain (the mute that survives `fadeIn`, §9.4).
- **Reason:** the pause menu toggles sound with `audio.setMuted?.(m)` and otherwise writes `audio.master.gain`, which `fadeIn` undoes.
- **Test:** pause → sound off → `audio.fadeIn(2)` → the output stays silent (P's audio tests already cover "mute survives fadeIn").

## 3. `src/core/audio.js` (P): `setChapter(audioDef, chapterDef)`

- **Change:** accept the chapter's `audio` block (`{theme, zones}`) as the first argument; the second is the whole chapter definition for anything else it needs (id, look).
- **Reason:** the engine calls `audio.setChapter?.(def.audio, def)` when a chapter starts, and `audio.setZone?.(zone)` when `L.mix(x).zone` changes.
- **Test:** chain souk → sundown; the theme switches from hijaz to bayati (`audio.theme` or P's own probe).
