# Art direction — Medina

The single reference is a low-angle render of a Moroccan/Andalusian alley at golden hour.
A cracked, powder-blue wall frames a pointed limestone arch. Beyond it, a sunlit courtyard glows under striped canopies.
Red-and-cream horseshoe arches, ivy and a green-gold dome rise into a lavender sky.
Everything in the game is tuned to that image, then run through Inside's staging: a side-on diorama, a small figure, few words, and light as the storyteller.

## Palette (measured from the reference, sRGB)

| Role | Value | Notes |
| --- | --- | --- |
| Sky | `#adb1c5` → clouds `#d5cfd8` | lavender-grey, brightest element in frame |
| Blue plaster in shade | `#2d3e49` | reads "powder blue" only next to warm tones |
| Blue plaster albedo | `#76a0bb` | peels to warm plaster underneath |
| Ochre under-plaster | `#9d734c` | exposed where paint flakes |
| Golden courtyard light | `#b9895c` → `#ca9b6a` | sunlight beyond the arch |
| Limestone trims | `#d0cbc4` | arch frames, cornices, stairs |
| Cobbles in shade | `#3c3029` | warm brown shadows, never neutral grey |
| Ivy | `#313627` | dark olive, glows yellow-green when backlit |
| Dome glaze | `#88855e` | green-gold, streaked white |
| Voussoirs | deep red `#8e2c1c` / cream | Córdoba-style alternating stones |
| The boy | tunic `#a3281e`, cream scarf | the only saturated red that moves |

## Materials

All surfaces are GPU-baked procedural PBR sets (albedo, normal, ORM) generated at load, in `src/render/textures.js`:
- **Plaster**: powder blue, peach, cream, ochre and white. Each has flaking paint masks, brick courses under the plaster, hairline cracks and weather streaks.
- **Stone and tile**: limestone with pores and veins, sandstone ashlar, zellige mosaic (navy with cream roundels and four-point stars, a few tiles missing), and cobbles in drifting sand.
- **Crafts**: wood planks, roof tiles, glazed dome tiles and terracotta.
- **Textiles and metal**: striped fabrics, a Persian rug, brass with patina, and rusted iron.
- **Foliage**: ivy leaves, bougainvillea blossoms and dry grass.

Fabric, leaves and skin carry a back-light translucency term, so canopies and ivy glow when the sun is behind them.

## Motifs

- Pointed and horseshoe arches with layered limestone frames, and zellige dados around doors.
- Stepped merlons on every roofline, moulded cornices, and mashrabiya lattice screens.
- Souk canopies of striped cloth spanning the street, dappling light onto the cobbles.
- Scalloped wooden eaves with terracotta tiles, and brass lanterns on scrolled iron brackets.
- Ivy curtains with pink blossom, laundry lines, sagging wires.
- Rolled rugs, amphorae, barrels, sacks and carts as foreground silhouettes.
- Domes and minarets with gilded finials on the skyline.

## Light

- **Sun.** A warm key light comes from behind and to the right of the scene, so facades are back-lit. Light enters the street through canopy gaps and between low shops, the way it does in the reference.
- **Fill.** Soft lavender sky fill comes from a hemisphere light plus a sky-derived environment map.
- **Haze.** Exponential height fog uses a sun in-scatter colour, giving peach haze toward the light and cool haze elsewhere.
- **Finale.** The sun swings low behind the great arch, and screen-space god rays spill toward the camera.
- **Courtyard.** A walled courtyard sits in shade, so the watchman's lamp beam reads clearly, Inside-style.

## Camera and grade

- **Gameplay camera.** It is side-on, with a 33–38° lens looking slightly upward to echo the reference's low angle. It uses a spring-damped rail with look-ahead and a vertical dead-zone.
- **Depth of field.** Blurred foreground silhouettes and a soft background stage the play plane.
- **Grade.** ACES tone mapping with cool shadows and warm highlights, a gentle S-curve, a vignette and fine grain. Bloom is kept for lanterns, and god rays for the finale.
- **Finale framing.** It recreates the reference composition: a low camera, steep upward view, arch centre-left, dome above, and red-and-cream arches on the right. On portrait screens the frame matches the reference almost one to one.
