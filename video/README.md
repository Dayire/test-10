# How a rocket works — ten 5-second demos, ten renderers

`rocket_ten_ways.mp4` is the 50 s reel (1280×720, 30 fps). Each folder renders one 5 s clip to `out.mp4`
with a different technology, all sharing the 3Blue1Brown-style spec in `common.py` (black ground,
blue / yellow / red / green palette, smooth-step easing).

| # | Folder | Renderer | Beat |
|---|---|---|---|
| 01 | `01_ffmpeg` | a single ffmpeg filter graph (no code) | T-minus countdown → ignition |
| 02 | `02_pillow` | Pillow `ImageDraw`, 2× supersampled | Newton's third law: throw mass, recoil |
| 03 | `03_canvas` | HTML Canvas 2D in headless Chromium | combustion: molecules → 3,300 °C |
| 04 | `04_numpy` | NumPy only, analytic anti-aliasing, hand-made pixel font | de Laval nozzle Mach field |
| 05 | `05_webgl` | raw WebGL fragment shader | exhaust plume with shock diamonds |
| 06 | `06_manim` | Manim Community | thrust equation F = ṁ·vₑ |
| 07 | `07_matplotlib` | matplotlib + Computer Modern mathtext | the rocket equation, staging bar |
| 08 | `08_pygame` | pygame (SDL dummy driver) | stage separation with a live mass bar |
| 09 | `09_opencv` | OpenCV drawing + `VideoWriter` | Newton's cannonball → orbit |
| 10 | `10_svg` | declarative SVG + SMIL, seeked with `setCurrentTime` | orbit vectors, closing card |

## Rendering

```sh
pip install numpy pillow matplotlib imageio-ffmpeg opencv-python-headless pygame manim
# Python demos:            cd 0X_name && python3 render.py
# ffmpeg demo:             cd 01_ffmpeg && sh build.sh        # needs an ffmpeg with drawtext (apt ffmpeg)
# browser demos (03/05/10): node capture.cjs 03_canvas/index.html 03_canvas canvas   (needs Playwright + Chromium)
# Manim:                   cd 06_manim && manim render -r 1280,720 --fps 30 -o out scene.py Thrust
./assemble.sh              # labels, fades, concat → rocket_ten_ways.mp4
```
