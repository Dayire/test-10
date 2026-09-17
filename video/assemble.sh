#!/bin/sh
# Stitch the ten clips: a small renderer label bottom-right, a 6-frame fade at each cut, one H.264 file.
set -e
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf
LABELS="01 · pure ffmpeg filter graph|02 · Pillow (PIL) rasteriser|03 · HTML Canvas 2D · headless Chromium|04 · NumPy only · hand-made pixel font|05 · WebGL GLSL fragment shader|06 · Manim · the 3Blue1Brown engine|07 · matplotlib + Computer Modern|08 · pygame · SDL headless|09 · OpenCV drawing + VideoWriter|10 · SVG + SMIL · seeked frame by frame"
i=1; INPUTS=""; FILTERS=""; CONCAT=""
for d in 01_ffmpeg 02_pillow 03_canvas 04_numpy 05_webgl 06_manim 07_matplotlib 08_pygame 09_opencv 10_svg; do
  L=$(echo "$LABELS" | cut -d'|' -f$i)
  INPUTS="$INPUTS -i $d/out.mp4"
  n=$((i-1))
  FILTERS="$FILTERS[$n:v]fps=30,scale=1280:720,format=yuv420p,drawtext=fontfile=$FONT:text='$L':fontsize=17:fontcolor=0x888888:x=w-tw-28:y=h-th-20,fade=t=in:st=0:d=0.2,fade=t=out:st=4.8:d=0.2[v$n];"
  CONCAT="$CONCAT[v$n]"
  i=$((i+1))
done
/usr/bin/ffmpeg -y -loglevel error $INPUTS -filter_complex "${FILTERS}${CONCAT}concat=n=10:v=1:a=0[out]" -map "[out]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart rocket_ten_ways.mp4
ffprobe -v error -show_entries format=duration -of csv=p=0 rocket_ten_ways.mp4
