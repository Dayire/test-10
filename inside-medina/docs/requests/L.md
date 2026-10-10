# Requests from L (Sunwork) for files L does not own

Each entry: file, change, reason, test. Everything L ships works without them (fallbacks noted).

## 1. `tools/playtest.mjs` (F, frozen): inject the Sunwork bot helpers

- **Change.** After `inject(P.page, 'tools/bots/lib.js')`, also `if (exists('tools/bots/lightlib.js')) await inject(P.page, 'tools/bots/lightlib.js');`
  (before the chapter bot).
- **Reason.** FULL_GAME §6.8 puts the light bot helpers in `tools/bots/lightlib.js`; the chapter bots of C2, C3 and C4
  build on them. Until then `tools/bots/lab.js` loads the file itself with a synchronous request to the dev server
  (with a cache-busting query: Vite serves a stale transform of a plain `/tools/bots/lightlib.js` after an edit), which
  only works where the page is served by the dev server.
- **Test.** `node tools/playtest.mjs --chapter lab` passes with the fallback in `lab.js` removed.

## 2. `src/game/game.js` (F, frozen): the colour a death fades to

- **Change.** In `updateDying`, `this.fadeColor.set(this.level?.deathColor?.(this.deathKind) ?? 0x000000)` instead of
  always black.
- **Reason.** FULL_GAME §3.2 II-E2: when the sunset clock expires "the light dies, the screen dims to indigo (death
  kind `sunset`)". The boy kneels into the dark (the `sunset` death pose) today, but the fade is black.
- **Test.** `?chapter=lab&cp=9`, walk past x 176 and wait 49 s: during the dying fade `post.params.fadeColor` is the
  chapter's indigo (`#0b1026` in Chapter II).

## 3. `docs/ARCHITECTURE.md` (F / integrator): the Sunwork contracts

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

- **Change.** Add a light-blocking rafter, solid x 162.5–169.0, y 9.0–9.3 (or move L_TOP), to the minaret chain.
- **Reason.** `node tools/light-unit.mjs` finds that, as specified, C1 at −60° alone sends a 150° leg from (170.8, 6.0)
  into L_TOP at (161.55, 11.34), whatever C2 does: 12 of the 1727 wrong settings light the lock, so C4's negative
  "chain dark if any mirror is wrong" would fail. With the rafter all 1727 wrong settings stay dark and every leg of
  the solution (and the boy on ladder 1 and floor 1) is clear.
- **Test.** The `IV-D minaret chain` fixture in `tools/light-unit.mjs` (it checks both versions).

## 5. `src/ui/**`, `src/core/input.js` (U): touch grab and haptics hooks

- **Change (none required in L's files).** The context icon of the touch grab button can read
  `game.player.reachable()` (`'mirror' | 'crank' | 'capstan' | 'crate' | 'lever' | null`), and haptics can subscribe
  to `game.events` `notch` (5 ms tick), `lockOpen`, `ropeSnap`, `dart`. The sticky grab on mirrors, cranks and the
  capstan for touch, and `settings.grabMode === 'toggle'` for every grip, are handled in `player.js` (no input change).
- **Reason.** FULL_GAME §8.1, §8.3.
- **Test.** `tools/mobile-tests.mjs`: "finger aim tilts a lab mirror to the touched notch" (a pointer held on the
  canvas while gripping `M2` in `?chapter=lab&cp=3`).

## 6. `tools/neg/foundation.mjs` (F, frozen): two scenarios written against the lab stub

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
  (15 / 17).

## 7. `docs/FULL_GAME.md` §6 and §3.2 (design owner / integrator): the rules Sunwork ships

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
