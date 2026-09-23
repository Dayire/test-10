# Game design — Medina (one level, Inside-like)

## Pillars

- **Wordless.** No text beyond the title and a controls hint that fades out.
- **Every mechanic taught by the space.** Each one is used once or twice, then combined.
- **Instant, fair failure.** Death cuts to black and you respawn at the last checkpoint, within about 2 seconds.
- **Light is the story.** You move from dim souk alleys to a walk into the sun.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | A/D or ←/→ | left stick / d-pad | left pad |
| Climb / crawl | W/S or ↑/↓ | stick up / down | pad up / down |
| Jump | Space (↑ when nothing to climb) | A | ⤒ |
| Grab (hold) | Shift / E / J | X, B or RT | ✋ |
| Pause | Esc / P | Start | — |

## Mechanics

The boy runs at 4.1 m/s. His jump peaks at 0.92 m, with coyote time and a jump buffer. Fixed 120 Hz physics runs with interpolated rendering.

- **Mantle.** Jumping at a ledge 0.5–1.1 m above the feet pulls the boy straight up.
- **Hang and climb.** Ledges up to 1.6 m above the feet are grabbed and hung from. Pressing toward or up climbs, pressing down or away drops, and jump plus away leaps off.
- **Crates.** Walking into a crate pushes it. Holding grab lets you push or pull. Crates fall off edges, stack, press plates and crush.
- **Climbing.** Ivy walls and rope ladders can be climbed.
- **Levers.** Grab the lever and walk away from it to pull.
- **Pressure plates.** A plate needs crate weight. The boy alone is too light.
- **Crawling.** The boy crawls automatically into low gaps.
- **Falls.** Landings over 2.4 m stagger him, and falls over 6.6 m kill.
- **Stealth.** The watchman's lamp checks whether the boy's head or chest is in its cone and in line of sight. Hanging rugs cast real shadows, and standing inside one hides him.
- **Chase.** The guard runs at 3.95 m/s and vaults obstacles faster than the boy climbs them. He can't follow into the crawl tunnel.

## Level beats (x in metres)

| # | Beat | Teaches / tests |
| --- | --- | --- |
| A | The souk (0–34) under striped canopies | move, jump the sack pile, climb the 1.5 m ledge |
| B | Crate and rooftops (34–70) | push the crate to the 3.1 m wall, mantle it, climb, running jump across the rooftop gap, drop onto the awning |
| C | Watchman's courtyard (70–118) | stealth between rug shadows, pull the lever to drop a rope ladder, climb out |
| D | Balcony and ravine (118–141) | climb ivy, push the crate off the balcony, push it onto the plate, and the drawbridge lowers |
| E | The chase (141–186) | a guard bursts through behind you: hop the barrels, climb the cart, hop the crates, climb the wall, crawl under the rubble |
| F | Into the light (186→) | the camera swings into the reference framing and the boy walks through the arch into the sun |

Checkpoints sit at the start of every beat. Each one snapshots crates, plate, bridge, lever, ladder, lamp and guard, and restores them on death.

## Verification

- `node tools/playtest.mjs`: a bot plays the whole level from the first frame to the finale.
- `node tools/negative.mjs`: checks the lamp spots you, the guard catches you, the ravine and crates kill, the plate needs a crate, and respawns restore state.
- `node tools/tour.mjs`: captures screenshots of every section.
