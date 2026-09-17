#!/bin/sh
# Demo 01 — no code at all: a single ffmpeg filter graph. Countdown, a growing ember glow, thrust bar, IGNITION.
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
SERIF=/usr/local/lib/python3.11/dist-packages/matplotlib/mpl-data/fonts/ttf/STIXGeneral.ttf
/usr/bin/ffmpeg -y -loglevel error -f lavfi -i "color=c=black:s=1280x720:r=30:d=5" -filter_complex "
[0:v]geq=
 r='255*clip(pow(clip(1-hypot(X-640,Y-760)/(140+T*T*38),0,1),2.2)*clip(T-0.2,0,1),0,255)':
 g='140*clip(pow(clip(1-hypot(X-640,Y-760)/(140+T*T*38),0,1),3),0,1)*clip(T-0.2,0,1)':
 b='60*clip(pow(clip(1-hypot(X-640,Y-760)/(140+T*T*38),0,1),4),0,1)*clip(T-0.2,0,1)',
drawtext=fontfile=$FONT:text='HOW A ROCKET WORKS':fontsize=26:fontcolor=0x888888:x=(w-tw)/2:y=150:alpha='min(1,t*2)',
drawtext=fontfile=$FONT:text='ten demos · ten renderers':fontsize=20:fontcolor=0x5CD0B3:x=(w-tw)/2:y=192:alpha='clip((t-0.4)*2,0,1)',
drawtext=fontfile=$SERIF:text='T − %{eif\:5-floor(t)\:d}':fontsize=200:fontcolor=white:x=(w-tw)/2:y=(h-th)/2-40:enable='lt(t,4)':alpha='1-0.85*(t-floor(t))',
drawtext=fontfile=$SERIF:text='IGNITION':fontsize=150:fontcolor=0xFC6255:x=(w-tw)/2:y=(h-th)/2-40:enable='gte(t,4)':alpha='min(1,(t-4)*3)',
drawbox=x=340:y=602:w=600:h=18:color=0x333333@1:t=1,
drawbox=x=341:y=603:w='598*clip((t-3.2)/1.7,0,1)':h=16:color=0xFC6255@1:t=fill:enable='gt(t,3.2)',
drawtext=fontfile=$FONT:text='thrust  %{eif\:100*clip((t-3.2)/1.7,0,1)\:d}\\\\%':fontsize=22:fontcolor=0x58C4DD:x=340:y=630:enable='gt(t,3.2)'
[v]" -map "[v]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -movflags +faststart out.mp4
