# Requests from L (Sunwork) for files L does not own

Each entry: file, change, reason, test. Everything L ships works without them (fallbacks noted). "Done (I1)" marks
what the integration of L and U applied (every item: #1–#9).

## 1. `tools/playtest.mjs` (F, frozen): inject the Sunwork bot helpers

**Done (I1).** Applied as written; the fallback in `tools/bots/lab.js` is gone and the lab bot passes.

- **Change.** After `inject(P.page, 'tools/bots/lib.js')`, also `if (exists('tools/bots/lightlib.js')) await inject(P.page, 'tools/bots/lightlib.js');`
  (before the chapter bot).
- **Reason.** FULL_GAME §6.8 puts the light bot helpers in `tools/bots/lightlib.js`; the chapter bots of C2, C3 and C4
  build on them. Until then `tools/bots/lab.js` loads the file itself with a synchronous request to the dev server
  (with a cache-busting query: Vite serves a stale transform of a plain `/tools/bots/lightlib.js` after an edit), which
  only works where the page is served by the dev server.
- **Test.** `node tools/playtest.mjs --chapter lab` passes with the fallback in `lab.js` removed.

## 2. `src/game/game.js` (F, frozen): the colour a death fades to

**Done (I1),** with #8: `updateDying` fades to `L.deathColor?.(kind) ?? black`, and `Player.deathTint` with its
display-encoding stopgap is gone. The lab negative `idle sunset` reads the indigo off the screen.

- **Change.** In `updateDying`, `this.fadeColor.set(this.level?.deathColor?.(this.deathKind) ?? 0x000000)` instead of
  always black.
- **Reason.** FULL_GAME §3.2 II-E2: when the sunset clock expires "the light dies, the screen dims to indigo (death
  kind `sunset`)". The contract is already live without this change: a chapter declares `L.deathColor(kind)` (the lab
  returns `#0b1026` for `sunset`), and the dead boy's step (`Player.deathTint`) holds that colour on `game.fadeColor`
  once the fade to dark has begun, so the lab dims to indigo today. The engine-side line makes the rule the
  engine's own (it would then cover a death whose boy is not stepping) and lets `deathTint` go, together with its
  display-encoding stopgap for #8 (land #8 first, or keep the encoding with this line while #8 is open).
- **Test.** `node tools/negative.mjs --chapter lab --only "idle sunset"` reads the screen at the end of the dying
  fade: about (11, 16, 38), the hex of `#0b1026` (it passes today).

## 3. `docs/ARCHITECTURE.md` (F / integrator): the Sunwork contracts

**Done (I1).** ARCHITECTURE.md §13 (the LightSystem, entities, light-blocking flags, player states) and §12 (the
Sunwork events and sounds).

- **Change.** Add `docs/systems/light.md`'s summary: the LightSystem as a chapter system, the entity list, the player
  states (`crank`, `capstan`), the light-blocking flags (`Solid.light`, `Body.light`, entity `lightPlank` / `lightBox`),
  and these names to the registries:
  - events `notch`, `lockOpen`, `ropeSnap`, `alarm`, `dart`, `dazzle`, `lampDazzled`, `lampFixate`, `guardStun`,
    `guardAsleep`, `mirrorLost`, `mirrorHome`, `clock`;
  - sounds now in use: `mirrorGrip`, `notch`, `mirrorRoll`, `crank`, `capstan`, `lockCharge`, `lockOpen`, `boltShut`,
    `ropeSmoulder`, `ropeSnap`, `counterweight`, `dazzle`, `fixate`, `turret`, `dartGuard`, `guardStun`,
    `guardSleep`, `tripHum`, `sunsetTick`, `answeredLight`.
- **Reason.** §11.2 F16 makes ARCHITECTURE.md the event and SFX registry.
- **Test.** Documentation only.

## 4. `docs/FULL_GAME.md` §5.2 IV-D (C4's design): a two-mirror shortcut

**Done (I1).** The rafter is in IV-D's table (C4 builds it); `light-unit.mjs` checks both versions.

- **Change.** Add a light-blocking rafter, solid x 162.5–169.0, y 9.0–9.3 (or move L_TOP), to the minaret chain.
- **Reason.** `node tools/light-unit.mjs` finds that, as specified, C1 at −60° alone sends a 150° leg from (170.8, 6.0)
  into L_TOP at (161.55, 11.34), whatever C2 does: 12 of the 1727 wrong settings light the lock, so C4's negative
  "chain dark if any mirror is wrong" would fail. With the rafter all 1727 wrong settings stay dark and every leg of
  the solution (and the boy on ladder 1 and floor 1) is clear.
- **Test.** The `IV-D minaret chain` fixture in `tools/light-unit.mjs` (it checks both versions).

## 5. `src/ui/**`, `src/core/input.js` (U): touch grab and haptics hooks

**Done (U, checked at I1).** The touch grab icon reads `player.reachable()` (☼ for a mirror, crank or capstan), and
the haptics subscribe to `notch`, `lockOpen`, `ropeSnap` and `death`. `mobile-tests --only aim` now runs on the real
lab with real touches on three phones: a tap latches M2, a finger on L4 tilts it to −45° and the notch buzzes, a
second tap lets go; K2 turns F2 onto L7; the capstan turns the heliostat onto the fortress lamp and the lab ends.

- **Change (none required in L's files).** The context icon of the touch grab button can read
  `game.player.reachable()` (`'mirror' | 'crank' | 'capstan' | 'crate' | 'lever' | null`), and haptics can subscribe
  to `game.events` `notch` (5 ms tick), `lockOpen`, `ropeSnap`, `dart`. The sticky grab on mirrors, cranks and the
  capstan for touch, and `settings.grabMode === 'toggle'` for every grip, are handled in `player.js` (no input change).
- **Reason.** FULL_GAME §8.1, §8.3.
- **Test.** `tools/mobile-tests.mjs`: "finger aim tilts a lab mirror to the touched notch" (a pointer held on the
  canvas while gripping `M2` in `?chapter=lab&cp=3`).

## 6. `tools/neg/foundation.mjs` (F, frozen): two scenarios written against the lab stub

**Done (I1),** with exactly this patch, in the merge's first follow-up commit; both scenarios pass.

- **Change.** In `lab end keeps the save`, reach the lab's real end instead of running right from x 26 (the stub's
  end): `M.checkpoint(12); const H = G.level.light.get('H'); H.setState({ ...H.getState(), alpha: 3.2 });
  M.teleport(475, 12, 1);` then sim with `{ x: 0 }` as before. In `x-keyed look swaps the env map`, compare the
  lab's maps with its own distinct presets instead of 1: `const lk = G.def.look; out.lab = { envs: D.envs.size,
  presets: new Set(Array.isArray(lk) ? lk.map((k) => k.preset) : [lk]).size };` and
  `if (r.lab.envs !== r.lab.presets) ...`.
- **Reason.** The Sunwork lab replaces the one-preset stub: its end is the heliostat at x 475 (twelve rooms of gates
  stand between x 26 and it), and its look follows the day through five presets (sunset, dusk, night, dawn,
  sunrise), so a chapter that frees every other map holds 5, not 1. Both scenarios still test what they were for
  (a dev end keeps the save and reloads the lab at x 1.5; a new chapter drops the maps it does not use).
- **Test.** With exactly this patch (applied locally, run, then reverted), `node tools/negative.mjs --suite foundation
  --only "lab end keeps"` and `--only "x-keyed look"` pass; without it they are the suite's only two failures
  (15 / 17). **Until it is applied `npm test` is red on the foundation suite after L merges**, so the integrator
  applies it in the same step as the merge. Re-checked on this branch's head after the last fix round (both pass
  with it, then reverted), and it applies with offsets to the integration branch's newer `foundation.mjs`
  (`claude/epic-carson-edzzjb` at 9c5f053: hunks at 248, 643, 653). The patch (`git apply` from the repo root):

```diff
--- a/inside-medina/tools/neg/foundation.mjs
+++ b/inside-medina/tools/neg/foundation.mjs
@@ -209,8 +209,9 @@ export const scenarios = [
     run: ({ page }) => page.evaluate(async () => {
       const M = __medina, G = M.game;
       const save0 = M.save();
-      M.teleport(26, 0);
-      for (let i = 0; i < 10 * 120 && G.mode === 'play'; i++) M.sim(1 / 120, { x: 1 });
+      // the lab's end: the heliostat (room 12) set on the fortress lamp
+      M.checkpoint(12); const H = G.level.light.get('H'); H.setState({ ...H.getState(), alpha: 3.2 }); M.teleport(475, 12, 1);
+      for (let i = 0; i < 10 * 120 && G.mode === 'play'; i++) M.sim(1 / 120, { x: 0 });
       const endMode = G.mode;
       await new Promise((r) => { const t0 = performance.now(); const f = () => (G.mode === 'play' || performance.now() - t0 > 15000 ? r() : setTimeout(f, 50)); f(); });
       const ev = M.events().filter((e) => ['chapterEnd', 'credits', 'chapterStart'].includes(e.name)).map((e) => `${e.name}:${e.data.id ?? ''}${e.data.dev ? ':dev' : ''}`);
@@ -469,7 +470,8 @@ export const scenarios = [
       await at(26); await G.restartChapter(); await frames(3);
       out.restart = { bakes, env: W.env === a.env, name: D.name };
       await G.loadChapter('lab', 0, { reason: 'restart' });
-      out.lab = { envs: D.envs.size };
+      const lk = G.def.look;
+      out.lab = { envs: D.envs.size, presets: new Set(Array.isArray(lk) ? lk.map((k) => k.preset) : [lk]).size };
       W.bakeEnvironment = bake;
       return out;
     }),
@@ -478,7 +480,7 @@ export const scenarios = [
       const w = r.walk;
       if (w.a !== 'dawn' || w.b !== 'sunrise' || w.c !== 'dawn' || !w.swapped || !w.back || !w.brass || w.bakes || new Set(w.progs).size !== 1 || !(w.sun[1] > w.sun[0])) return `walking the blend: ${JSON.stringify(w)}`;
       if (r.restart.bakes || !r.restart.env || r.restart.name !== 'dawn') return `restart: ${JSON.stringify(r.restart)}`;
-      if (r.lab.envs !== 1) return `the maps outlived their chapter: ${JSON.stringify(r.lab)}`;
+      if (r.lab.envs !== r.lab.presets) return `the maps outlived their chapter: ${JSON.stringify(r.lab)}`;
       return true;
     },
   },
```

## 7. `docs/FULL_GAME.md` §6 and §3.2 (design owner / integrator): the rules Sunwork ships

**Done (I1).** §6.1 (both faces, lattice gates), §6.2 (LampEye `face`, the dazzle's settle and re-arm, the daylight
stun and the asleep body).

- **Change.** Sign off these shipped rules so C2–C4 build against them:
  - §6.1 "What blocks light": "Mirror trays (one-sided: the back face blocks)" becomes "Mirror trays (both faces
    reflect; `oneSided: true` makes the back face block)". II-B2 starts on the underside at +30° and IV-A1's crank
    is solved on its underside, so one-sided trays would break both puzzles as specified.
  - §6.2 / §3.2 II-C2: a `Gate` is a lattice portcullis and lets light through (`light: 'pass'` by default,
    `light: 'block'` for a solid door). A lifted solid gate would cut the II-C2 window ray and hold G6 open.
  - §6.2 `LampEye`: `face` (deg) for an eye behind a window that only sees light travelling toward it (the IV-E
    fortress lamp looks east).
  - §6.2 `Searchlight` / §4.2 III-B2: after the dazzle (7 s, assist 10.5 s) the beam settles back onto the street
    over 0.9 s while the sweep runs on away from the rest that blinded it, still blind; the eye re-arms only once
    the lamp sees again. The lamp sees the boy again within one sweep cycle.
  - §6.2 `Guard`: the stun rule counts daylight only (sun or moon rays, direct or reflected): a searchlight's or
    a tripwire's own beam never stuns a lamp-keeper. An asleep guard's body drops to 0.45 m.
- **Reason.** The fixtures of `tools/light-unit.mjs` (II-B2, II-C2, IV-A1, IV-E) and the lab negatives depend on
  them; the design text still says otherwise.
- **Test.** `node tools/light-unit.mjs` (29 / 29) and `node tools/negative.mjs --chapter lab` on the merged tree.

## 8. `src/render/post.js` (P): a fade colour shows darker than its hex

**Done (I1):** `p = mix(p, toSRGB(uFadeColor), uFade)`. Every fade colour now shows its own hex (Chapter I's warm exit
`#f8e6c7` too); the stopgap went with #2.

- **Change.** In the final pass, mix the fade in display space: `p = mix(p, toSRGB(uFadeColor), uFade);` (this form,
  in the shader: L's stopgap below keys on the old line).
- **Reason.** `P.fadeColor` is a `THREE.Color`, so `set('#0b1026')` stores the linear value (0.003, 0.005, 0.019), but
  the shader mixes it into `p` after `toSRGB`: the screen ends at (1, 1, 5) instead of (11, 16, 38). The sunset
  death's indigo (FULL_GAME §3.2, the lab's `L.deathColor`) and Chapter II's `#0b1026` exit fade read as black; any
  fade colour is darker than designed (Chapter I's warm-white fade is light enough to hide it).
- **L's stopgap.** Until this lands, `Player.deathTint` hands the death colour over display-encoded
  (`convertLinearToSRGB()`) while the final shader still contains `p = mix(p, uFadeColor, uFade)`, so the lab's
  sunset death already ends on (11, 15, 37). With the change above the check finds the new line and stops
  encoding by itself; nothing else needs to move. (Chapter fades set by `game.js`, such as an exit colour, are
  still too dark until it lands.)
- **Test.** `node tools/negative.mjs --chapter lab --only "idle sunset"` reads the screen at the end of the fade
  and expects (11, 16, 38) ± 3; it passes before and after the change.

## 9. `src/game/game.js` (F, frozen): the boy's turn diverges below ~19 fps

**Done (I1),** the exact step as written. Tested by the foundation scenario `the boy turns cleanly at 5 fps`
(`game.frame(0.1)` × 60 after each of three changes of facing: the yaw stays within ±π, settles on the target with
no velocity left, the wrists stay finite).

- **Change.** In `render`, step the yaw spring exactly (as `camera.js`'s `spring` does) instead of the explicit
  update:
  ```js
  const w = 16, x0 = root.rotation.y - targetYaw, v0 = pl.yawVel || 0, e = Math.exp(-w * dt);
  root.rotation.y = targetYaw + (x0 + (v0 + w * x0) * dt) * e;
  pl.yawVel = (v0 - w * (v0 + w * x0) * dt) * e;
  ```
- **Reason.** `a = w²·d − 2w·v; v += a·dt; yaw += v·dt` with w = 16 is stable only while w·dt < 0.83, i.e. at
  frames shorter than 52 ms; `frame()` clamps dt to 0.1 s, so on a device that drops under ~19 fps (a throttled
  phone, a hitch run) the boy spins after any change of facing: measured in headless Chromium (frames of about
  0.1 s), a turn from facing right to left took `yawVel` to 1e16 in 24 frames and the rig's arms to NaN (the
  hand-reach probe saw NaN wrists until the yaw was reset by hand).
- **Test.** At 5 fps (`frame(0.1)` in a loop), flip `player.facing` and render 60 frames: `root.rotation.y` stays
  within [−π, π] and settles on the target.
