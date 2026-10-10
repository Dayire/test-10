# The shell: menus, input, touch, distribution (package U)

Owner files: `src/ui/**` (`ui.js`, `focus.js`, `glyphs.js`, `settings.js`, `chapters.js`, `hints.js`, `touch.js`,
`style.css`, `fonts.css`, `fonts/`), `src/core/{input,haptics}.js`, `src/game/boot.js`, `src/main.js`, `index.html`,
`public/**`, `vite.config.js`, `tools/{vite.artifact.config.js,make-artifact.mjs,make-icons.mjs,fetch-font.mjs,ux-tests.mjs,mobile-tests.mjs}`.
The plan is FULL_GAME §7, §8 (except rendering) and §11.4 U; this page is how it is built and how to use it.

## Look and feel

Moroccan craft as a restrained modern interface: one serif (Cormorant Garamond, vendored: a variable roman 300–500
and an italic 400, latin subset, 60 KB), brass hairlines, an eight-point star (khatam) as the focus mark, zellige
lattices as faint textures, arched chapter cards, and time-of-day glyphs drawn as SVG (`glyphs.js`). Menus use short
lowercase labels; play is wordless (glyphs only). Every transition animates `opacity` and `transform` only, so it runs
on the compositor and keeps moving while the main thread bakes or builds. Screens reveal with staggered entries.

| Token | Value |
|---|---|
| ink / ivory / brass | `#0b0806` / `#f3e6d2` (`#fbefdc` focused) / `#dcb46f` (`#f3d79e` hi, `#a27436` lo) |
| type | wordmark 300, 0.32 em tracking; entries 26 px (× menu text size); rows 19 px; micro labels 12 px caps 0.42 em |
| rows | ≥ 48 px main entries, ≥ 50 px settings rows, ≥ 44 px everywhere (touch: 52 px entries in portrait) |
| motion | `cubic-bezier(.16,.84,.24,1)`; entries stagger 55 ms; cards assemble their glyph in 1.6 s |

The menus sit over the live title shot. The dimming is the post chain's vignette, raised through a LookDirector
override while a menu is up over the title (never `backdrop-filter`), plus plain gradients behind the text column.
While the main menu shows, `world.rs.setMenuBackground(true)` renders the title at 30 fps and half resolution
(requests/P.md #8); desktop pointers add ±0.6 m of parallax to the title shot (the override function is wrapped).

## Flow (FULL_GAME §7.1)

```
index.html paints the splash (wordmark, turning brass rosette, progress hairline) before any script
boot: the UI and Input first, the main menu interactive at once (continue / new journey / chapters wait, with a
      turning rosette, until the chapter is built: a choice made meanwhile is taken when it is ready)
      → world, session bake, Game → the loop starts → the save's chapter loads under the title → splash fades
main menu over the live shot of the save's place (souk for a new player):
  continue      only with a save: play begins in place (the camera blends to the rail), or loads the save's place
  new journey   glyph confirm ✓/✕ when there is progress; in place when the title already shows the souk at 0
  chapters      four arches → checkpoint pips → start (behind the card)
  settings      graphics | audio | controls | accessibility | data
  credits       the roll over the live title (skippable)
  asset sheet   dev server only
play: pause = Esc / P, pad Start, ⏸; auto on blur, hidden page, pad disconnect
  → resume | restart checkpoint | restart chapter | chapters | settings | title
chapter end → the engine fades to the exit colour → the card (numeral and glyph, ≥ 2.5 s and until built)
last chapter → credits (game.hooks.credits) → title
?autostart=1 skips every menu
```

Esc on the title rests the scene: the game pauses (freeze-frame, no rendering) under the menu; any key wakes it.
Hiding the page pauses play (the player returns to the pause menu) and the title alike, and flushes the save.

## Focus and input (`focus.js`, `src/core/input.js`)

`FocusManager` keeps a stack of `Screen`s; opening one hides the one below (a `modal` screen such as the confirm keeps
it visible but inert). Hidden screens carry `hidden` and `inert`. Each screen declares `items()`, remembers its last
focus, may handle `onNav(dir)` (the chapter grid, the settings tab row) and `tab(dir)`. Real DOM focus follows the
roving focus, so `:focus-visible`, Tab (kept inside the open screen) and screen readers agree; every control has a
role and an aria-label. Enter and Space act through the nav edges only (their native click is prevented).

| Device | Navigate | Confirm | Back | Tabs | Other |
|---|---|---|---|---|---|
| Keyboard | arrows / WASD, Tab | Enter / Space | Esc / Backspace | Q / E, [ ], PgUp / PgDn | P / Esc pause |
| Gamepad | d-pad / stick | A (✕) | B (○) | LB / RB | Start pause |
| Pointer | hover focuses | click | — | click a tab | drag a slider |
| Touch | — | tap | — | tap a tab | drag a slider |

`Input.poll()` returns `{x, y, jump, grab, pause, any, pointer}` and fills `nav = {up, down, left, right, confirm,
back, prev, next, pause}` (directions repeat after 400 ms every 120 ms). `jumpPressed`, `grabPressed`,
`pausePressed`, `anyPressed` are edges against the raw previous poll, so the game zeroing `state`/`prev` while a menu
is open never turns a held key into a new press (a Start held through "resume" used to pause again). Pads: the
standard mapping, and for raw HID pads the face buttons at 0–3 with the d-pad on axes 6/7 or a hat on axis 9.
`padKind(id)` picks glyphs from the vendor id (054c PlayStation, 045e Xbox, 057e Nintendo). `lastDevice` is
`keyboard | gamepad | touch` (`input.on('device', fn)`); L's player reads it for the sticky touch grab. Crawl
toggle lives here: a down-press on the ground latches the crouch until up, a jump, another down-press or leaving the
ground. Keys typed into a text field (the save code) never reach the game. Everything held lets go on blur and when
the page hides.

## Touch (`touch.js`, FULL_GAME §8.1)

| Control | Spec as built |
|---|---|
| Stick | floating: a touch in the left 45 % (not the top 18 %, not ⏸) puts the base under the thumb; radius 56 px × size; dead zone 12 %; `x` is the horizontal share, so 75 % runs; vertical at 0.55 (0.40 to release) and only on the dominant axis, which may change at most every 200 ms; near a vine a diagonal ≥ 35° counts as up. Fixed: the base rests bottom left. A faint ghost base shows where the thumb goes. |
| Jump | 84 px × size, bottom right, hit zone 1.4× (a pseudo-element) |
| Grab | 72 px × size, up-left of jump; icon ✋ (crate, lever) or ☼ (mirror, crank, capstan) from `player.reachable()` (L; a fallback reads grips and interactables); the latch on mirrors is L's (`player.sticky`) |
| ⏸ | 44 px, top left in the safe area (top right left-handed) |
| Scene | a touch anywhere else hits the canvas: `Input.pointer` (kind `touch`) → `pin.aimTarget` (finger aim) |
| Layout | left-handed mirrors everything; size S/M/L = 0.85 / 1 / 1.2; opacity 20–80 % of the idle outline |
| Behaviour | every control follows its own pointer id (multi-touch); the layer fades out when a key or a pad is used, to 25 % after 5 s idle, and hides under every menu and card; `touch-action: none`, no callout, no selection, `contextmenu`/`dblclick`/`gesturestart` blocked |

The touch layer is the first child of `#ui`, so the card, the menus and the loading screen cover it.

**Lens shift** (FULL_GAME §8.2): in play on touch, `camRig.setSafeRect(ui.playRect())` keeps the boy centred in the
play rect: portrait, the screen above a control band of max(160 px, 24 vh) plus the bottom inset; landscape, the safe
area. It eases in and out over 0.8 s (the title shot is composed for the full screen, so the shift is cleared there).
The camera distance setting `auto` (the default) resolves to `close` on portrait phones and `normal` elsewhere, and
follows rotations. A one-time rotate-phone glyph shows for 3 s at the first portrait play (never blocking).

## Settings (`settings.js`, FULL_GAME §7.4)

Every option applies live: `ui.setSetting(k, v)` persists the value as chosen (`save.settings`, debounced 500 ms by
F) and hands the resolved value to `game.applySettings(..., {persist: false})`, which applies the engine's keys and
forwards the rest to the renderer (`rs.applySettings`), the mixer (`audio.setVolumes`) and Input (touch layer,
haptics, crawl). Defaults: `defaultSettings(deviceClass)`.

| Tab | Options (default) |
|---|---|
| graphics | quality (auto), render scale 50–100 (100), dynamic resolution (on), frame cap 30/60/display (60 on touch, display on desktop), battery saver (off), depth of field (on), film grain 0–100 (60), motion blur (off; ultra only), brightness −3…+3 (0, with the calibration rosettes), camera auto/close/normal/wide (auto), fullscreen (only where `document.fullscreenEnabled`; a phone then tries `screen.orientation.lock('landscape')`) |
| audio | master, music, effects, ambience 0–10 (10), mute in background (on), mono (off), reduced dynamic range (off) |
| controls | touch stick floating/fixed, touch size S/M/L, touch opacity 20–80 % (45), left-handed (touch devices only); grab hold/toggle, crawl hold/toggle, invert tilt, aim snap (on), vibration off/low/full (low), control hints always/first time/never (first time), keys (keyboard and pad glyphs, read-only) |
| accessibility | camera shake 0–100 % (100), reduce motion, reduce flashing, high contrast, visual sound cues, generous timing, assist, game speed 100/85/70 %, menu text size 100/125/150 % |
| data | where progress is kept (a broken-link glyph when storage is unavailable), save code (copy), enter a save code, reset progress (glyph confirm) |

High contrast also brightens the shell; for beams, locks, tripwires and searchlight cones it is `game.settings.highContrast`
for L and the chapters to read (requests/U.md). The save code is `M1` + a two-character checksum + base64url of the
progress (chapter, checkpoint, chapters reached, furthest checkpoints, completion, play time, deaths): 94 characters
for a mid-game save. Brightness calibration draws three rosettes lifted by the same exposure and gamma the grade
applies (`1 + 0.08·b`, `1 − 0.04·b`).

## Screens

- **Splash** (`index.html`): inline critical CSS and SVG, so it paints before the module loads; the rosette turns on
  the compositor. `#loading .lbar i` keeps receiving the loader's progress (the foundation's boot test reads it); once
  the menu is up the splash yields its text to the menu's own hairline.
- **Main**: left column at 7.5 vw (landscape) or a bottom sheet (portrait); the continue entry names the save's
  chapter with its glyph; a broken-link glyph bottom right when progress cannot be kept.
- **Pause**: the same column over the dimmed freeze-frame, with the chapter's glyph, numeral, label and checkpoint pips.
- **Chapters**: four arches (an SVG clip path), each with a 320 × 180 JPEG (q 0.7) captured from the canvas ~1.6 s
  after a chapter first starts (`medina.v1.thumb.<id>`), else the chapter's palette; the glyph; checkpoint pips (the
  counts of FULL_GAME §2–5, replaced by the counts seen when a chapter loads). Locked chapters are dark arches with a
  closed door. Confirm on a chapter with reached checkpoints opens its pips (← → choose, confirm starts).
- **Card** (`game.hooks.card`): the chapter's tone, a drifting zellige lattice, the glyph assembled layer by layer
  (ground, body, rays or stars), numeral, rule and label; resolves once it covers the screen, `hide()` keeps it at least
  2.5 s; after 2.5 s a small rosette turns while the chapter is still building.
- **Credits** (`game.hooks.credits(lines)`): a slow roll on the right (centred in portrait): MEDINA, a rosette, the
  lines (strings, or `{role, name}`), and "thank you for walking with us". Ink follows what is behind (dark on a pale
  exit colour). Skippable after the first completion, and always from the main menu.
- **Confirm**: glyph, one short question, ✓ and ✕ (✕ focused).
- **Lifecycle**: a lost GL context shows a lantern card ("tap to reload": the hosted page may reload, the artifact
  waits for the browser to restore it, after which the engine reloads the checkpoint); without WebGL 2 a static card
  says the city cannot be lit here.

## HUD

The save rosette (top right, while a write happens), hint glyphs, sound cues, the rotate glyph. **HintDirector**
(`hints.js`): `L.hints = [{x0, x1, y0?, y1?, after, glyph, unless(game)}]` with glyphs `jump grab up down tilt crank aim
crawl`; the first steps of a journey get `move` (`game.hooks.hint('controls')`). The glyph follows the device in hand
(keycaps with the player's own layout letters, pad buttons of the pad's family, a ghost thumb on touch that also
pulses the control) above the boy's projected head, and fades when the action happens; done hints are written to
`save.seenHints` (`<chapter>:<index>`, `move`). **Visual sound cues**: the horn (`alarm`), shouts, darts and the drum
show an edge glyph on the side they came from.

## Haptics (`src/core/haptics.js`, FULL_GAME §8.3)

| Event (source) | `navigator.vibrate` | pad dual-rumble (ms, strong, weak) |
|---|---|---|
| hard landing (`land {hard}`) | 20 | 120, .6, .3 |
| crate impact (`impact {kind crate}`, speed > 3) | 15 | 150, .4, .6 |
| notch (`notch`, L) | 5 | 30, 0, .2 |
| lock opens (`lockOpen`, L) | 15-30-15 | 80, .2, .5 |
| rope snap (`ropeSnap`) / gate or bridge slam (sounds) | 40 / 60 | 250, .8, .4 |
| death (`death`) | 40-40-80 | 300, .9, .5 |

Off / low (half strength, shorter pulses) / full. Phones vibrate when touch is the device in use, pads rumble when the
pad is (`vibrationActuator.playEffect`, or Firefox's `hapticActuators[0].pulse`); nothing plays before the first user
activation; iOS has no Vibration API.

## Boot and lifecycle (`boot.js`)

Order: storage and save, device class, UI, Input (+ touch layer, haptics), the main menu (interactive), the world,
GLB overrides (skipped in the artifact), the session bake, Game, settings applied, the loop, then the chapter load
under the title. `nextFrame()` waits for a presented frame, so the splash and the menu reach the compositor before
each long synchronous step. `window.__boot` marks `menu`, `world`, `overrides`, `init`, `chapter`; `window.__ui` is
the shell (tests). Lifecycle: hidden page → pause, save flush, wake lock released; `pagehide` → flush; `blur` in play
→ pause; pad disconnect → pause; `navigator.wakeLock` held in play only (guarded); `resize` → layout and the auto
camera; `webglcontextlost` / `restored` → the lantern card, then the engine's `recoverContext()`.

## Distribution (FULL_GAME §8.7)

**Hosted** (`npx vite build` → `dist/`): `base: './'`, every asset named by hash under `assets/`; a
`manifest.webmanifest` (standalone, landscape, `#0b0806`, icons 192 / 512 / maskable 512 and an Apple touch icon
from `tools/make-icons.mjs`: the brass tray with its engraved rosette, rendered in Chromium); `sw.js` generated at the
end of the build from what was written: precache everything, cache-first for assets, network-first for the page
(falling back to the cached page offline). It registers only in a production build, outside the artifact, in a top
window, in a secure context, and not with `?nosw=1`.

**Artifact** (`npm run build:artifact` → `dist-artifact/medina.html`): `import.meta.env.VITE_ARTIFACT` strips the dev
views (gallery, exporter, previews), the GLB fetch, the service worker and every reload; all chapters are in one
module; `make-artifact.mjs` folds the splash, every stylesheet (fonts as data URIs) and the module into one fragment
(the host supplies `<html>`), escaping `</script` inside the module. `test.html` wraps it as the host does. No
fullscreen row unless the frame allows it, no pointer lock, `alert`, `print` or `location.reload`. Storage goes through
`storage.js` (an opaque sandbox origin has none: the save code is the way to carry progress).

**Fonts**: `node tools/fetch-font.mjs` vendors the latin subsets into `src/ui/fonts/` and writes `src/ui/fonts.css`
(OFL 1.1). Without it, Georgia is the fallback.

## Tests

```
node tools/ux-tests.mjs --port 5176 [--only keyboard,gamepad,storage,persist,autostart,menubg,chapters,artifact,hosted]
node tools/mobile-tests.mjs --port 5176 [--device iphone|pixel] [--only menus,controls,stick,jump,grab,lens,aim]
```

Results of the last run are at the end of this page.
