"""Shared spec for the ten demos: 1280x720 @ 30 fps, 5 s, 3Blue1Brown palette, ffmpeg pipe encoder."""
import subprocess, os, numpy as np
W, H, FPS, DUR = 1280, 720, 30, 5.0
N = int(FPS * DUR)
BG = (0, 0, 0)
BLUE, YELLOW, RED, GREEN, TEAL, WHITE, GREY, ORANGE = (
    (0x58, 0xC4, 0xDD), (0xFF, 0xFF, 0x00), (0xFC, 0x62, 0x55), (0x83, 0xC1, 0x67),
    (0x5C, 0xD0, 0xB3), (0xFF, 0xFF, 0xFF), (0x88, 0x88, 0x88), (0xFF, 0x86, 0x2F))
FONT_DIR = '/usr/local/lib/python3.11/dist-packages/matplotlib/mpl-data/fonts/ttf/'
SERIF = FONT_DIR + 'STIXGeneral.ttf'          # math-serif for equations
SERIF_IT = FONT_DIR + 'STIXGeneralItalic.ttf'
SANS = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
FFMPEG = 'ffmpeg'

def smooth(t):
    """3b1b's default easing: smooth step with zero velocity at both ends."""
    t = min(1.0, max(0.0, t)); return t * t * (3 - 2 * t)

def seg(t, a, b):
    """0→1 progress of t across the interval [a, b]."""
    return min(1.0, max(0.0, (t - a) / (b - a)))

def lerp(a, b, t): return a + (b - a) * t

def mix(c1, c2, t): return tuple(int(round(lerp(a, b, t))) for a, b in zip(c1, c2))

class Encoder:
    """Pipe raw RGB frames into ffmpeg → H.264 mp4."""
    def __init__(self, path, w=W, h=H, fps=FPS):
        self.p = subprocess.Popen([FFMPEG, '-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                                   '-s', f'{w}x{h}', '-r', str(fps), '-i', '-', '-c:v', 'libx264', '-preset', 'slow',
                                   '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path], stdin=subprocess.PIPE)
    def write(self, frame):
        self.p.stdin.write(np.ascontiguousarray(frame, dtype=np.uint8).tobytes())
    def close(self):
        self.p.stdin.close(); self.p.wait()
