# Requests from P (presentation) for files P does not own

Everything below already works through optional chaining or default arguments, so nothing breaks
before these land. Each entry: file, change, reason, test.

## 1. `src/game/boot.js` (F12, then U): frame cap and paused frames

- **Change.** In the rAF loop:
  ```js
  const loop = (now) => {
    requestAnimationFrame(loop);
    if (world.rs.beginFrame?.(now) === false) return;          // frame cap (30 / 60 / display)
    const dt = (now - last) / 1000; last = now;
    world.rs.trackFrame(dt * 1000, { paused: game.paused, hidden: document.hidden });
    game.frame(dt);
    ...
  };
  ```
  Apply the settings once at boot and on every change: `world.rs.applySettings?.(settings)`
  (`quality, renderScale, dynres, fpsCap, batterySaver, dof, grain, brightness, motionBlur, reduceFlashing`).
- **Reason.** Today the loop is uncapped and paused frames feed auto quality. `last` must only advance
  on rendered frames, so `dt` stays the real frame interval under the cap.
- **Test.** `node tools/perf.mjs --only checks --check cap,capLoop,pausedIgnored`; in the game with
  `fpsCap: 60` on a 120 Hz display `__info()` frame counter advances at 60/s.

## 2. `src/game/boot.js`: mute

- **Change.** The `mute` handler becomes `audio.muted = !audio.muted;` (drop the direct
  `audio.master.gain.value = ...` write).
- **Reason.** Mute now lives on `userMaster`; `master` carries fades. Writing `master` directly cuts a
  running fade-out short when unmuting.
- **Test.** `node tools/audio-tests.mjs --only muteFadeIn`; in game: mute, die (fadeIn on respawn) →
  still silent.

## 3. `src/game/game.js` (F4): pause, chapter and zone

- **Change.** `setPaused(p)`: `this.audio.setPaused?.(p)` instead of `ctx.suspend()/resume()`
  (`game.js:205`). On chapter load: `this.audio.setChapter?.(def.audio)`. Each frame:
  `audio.update(dt, game.mix)` with `mix.zone` when `L.mix` names one.
- **Reason.** Suspending the context also silences the ui bus, so menu sounds die in the pause menu;
  ducking keeps the world audible but distant (§9.4).
- **Test.** `node tools/audio-tests.mjs --only uiWhilePaused`; in game: Esc → the music drops and
  dulls in 0.3 s, menu hover/confirm sounds play.

## 4. `src/render/lookdirector.js` (F7): night sky and shafts

- **Change.** Write `sky.uniforms.uNight / uStars / uMoonDir / uMoonColor / uMoonSize` from the preset
  (`stars / moon` columns of §9.3; `uNight = moon`, `uStars = stars`, `uMoonDir = night sunDir`), and
  call `game.shafts?.setSun?.(sunDir, sunColor, raysOrIntensity)` whenever the sun changes. Optionally
  retint the character rim: `G.uRimColor` (sun colour, or the moon's at night), `G.uRimStrength`.
- **Reason.** P added the uniforms with today's look as default (`uNight = 0`).
- **Test.** `node tools/perf.mjs --only checks --check nightSky` (and the screenshot it saves with
  `--shots`).

## 5. `src/game/game.js` / chapter loader: context loss

- **Change.** `world.rs.onContextLost?.(() => hooks.card?.('lost'))`,
  `world.rs.onContextRestored?.(() => loadChapter(current, cp, {reason: 'restore'}))` (re-bakes the
  render-target textures).
- **Reason.** §8.2 lifecycle; P's half is in `renderer.js` (frames stop while lost, the post chain
  re-applies its state after the restore).
- **Test.** `node tools/perf.mjs --only checks --check contextLoss`.

## 6. Chapter definitions (C2, C3, C4): audio zones

- **Change.** `def.audio = {theme, zones: [{x0, x1, verb, amb, music, tension, hum, drips}]}` with the
  places of §9.4 (`alley`, `souk`, `courtyard`, `madrasa`, `cistern`, `minaret`, `open`). The souk has
  built-in defaults (`THEME_ZONES.souk` in `src/core/audio.js`) until its chapter brings its own.
- **Test.** `audio.stats.verb` reads the zone's place while the boy stands in it.
