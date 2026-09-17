"""Demo 04 — NumPy only: no drawing library. Quasi-1D isentropic flow through a de Laval nozzle, rasterised with array math."""
import sys; sys.path.insert(0, '..')
import numpy as np
from common import *
GAMMA = 1.2
# ---- geometry: half-width h(s) along the nozzle, s in [0,1]; axis at y=300, x from 190 to 1090 ----
X0, X1, YA = 190, 1090, 300
ST = 0.42
def half_width(s):
    s = np.asarray(s, float); h = np.empty_like(s)
    c = s < 0.22; h[c] = 110
    m = (s >= 0.22) & (s < ST); u = (s[m] - 0.22) / (ST - 0.22); h[m] = 45 + 65 * (0.5 + 0.5 * np.cos(np.pi * u))
    d = s >= ST; h[d] = 45 + 90 * np.sqrt((s[d] - ST) / (1 - ST))
    return h
def mach_from_area(ar, supersonic):
    """Bisection on the area–Mach relation, vectorised."""
    lo = np.full_like(ar, 1.0 if supersonic else 1e-3); hi = np.full_like(ar, 8.0 if supersonic else 1.0)
    e = (GAMMA + 1) / (2 * (GAMMA - 1))
    f = lambda M: (1 / M) * ((2 / (GAMMA + 1)) * (1 + (GAMMA - 1) / 2 * M * M)) ** e
    for _ in range(60):
        mid = 0.5 * (lo + hi); fm = f(mid)
        if supersonic: lo, hi = np.where(fm < ar, mid, lo), np.where(fm < ar, hi, mid)
        else:          lo, hi = np.where(fm > ar, mid, lo), np.where(fm > ar, hi, mid)
    return 0.5 * (lo + hi)
s = np.linspace(0, 1, 901); h = half_width(s); ar = (h / 45) ** 2
M = np.where(s < ST, mach_from_area(ar, False), mach_from_area(ar, True))
Tr = 1 / (1 + (GAMMA - 1) / 2 * M ** 2)                       # T/T0
u = M * np.sqrt(Tr); u = u / u[-1]                            # velocity, normalised to exit = 1
# ---- pixel grids ----
yy, xx = np.mgrid[0:H, 0:W].astype(float)
sx = np.clip((xx - X0) / (X1 - X0), 0, 1)
inside_s = (xx >= X0) & (xx <= X1)
hw = np.interp(sx, s, h); Mpx = np.interp(sx, s, M)
dist = hw - np.abs(yy - YA)
fill = np.clip(dist, 0, 1) * inside_s                          # analytic anti-aliased interior mask
wall = np.clip(1 - np.abs(dist) / 2.2, 0, 1) * inside_s        # 4-px wall stroke
def cmap(m):
    """blue → white at M=1 → red at M≈3.4 (3b1b palette)"""
    c = np.zeros(m.shape + (3,))
    lo = np.clip(m, 0, 1)[..., None]; c += (1 - lo) * np.array(BLUE) + lo * np.array(WHITE)
    hi = np.clip((m - 1) / 2.4, 0, 1)[..., None]; c = c * (1 - hi) + hi * np.array(RED)
    return c
field = cmap(Mpx) * fill[..., None] * 0.92
# ---- a hand-made 5x7 pixel font so the demo stays pure NumPy ----
GL = {'G':"01111 10000 10000 10111 10001 10001 01111",'F':"11111 10000 11110 10000 10000 10000 10000",'K':"10001 10010 10100 11000 10100 10010 10001",
'V':"10001 10001 10001 10001 10001 01010 00100",'Y':"10001 10001 01010 00100 00100 00100 00100",'X':"10001 01010 00100 00100 00100 01010 10001",
'J':"00111 00010 00010 00010 00010 10010 01100",'Q':"01110 10001 10001 10001 10101 10010 01101",',':"00000 00000 00000 00000 00000 00100 01000",
'-':"00000 00000 00000 11111 00000 00000 00000",'4':"00010 00110 01010 10010 11111 00010 00010",'5':"11111 10000 11110 00001 00001 10001 01110",
'A':"01110 10001 10001 11111 10001 10001 10001",'B':"11110 10001 11110 10001 10001 10001 11110",'C':"01111 10000 10000 10000 10000 10000 01111",
'E':"11111 10000 11110 10000 10000 10000 11111",'H':"10001 10001 11111 10001 10001 10001 10001",'I':"11111 00100 00100 00100 00100 00100 11111",
'M':"10001 11011 10101 10101 10001 10001 10001",'N':"10001 11001 10101 10011 10001 10001 10001",'O':"01110 10001 10001 10001 10001 10001 01110",
'P':"11110 10001 10001 11110 10000 10000 10000",'R':"11110 10001 10001 11110 10100 10010 10001",'S':"01111 10000 10000 01110 00001 00001 11110",
'T':"11111 00100 00100 00100 00100 00100 00100",'U':"10001 10001 10001 10001 10001 10001 01110",'D':"11110 10001 10001 10001 10001 10001 11110",
'L':"10000 10000 10000 10000 10000 10000 11111",'Z':"11111 00001 00010 00100 01000 10000 11111",'W':"10001 10001 10001 10101 10101 11011 10001",
'0':"01110 10001 10011 10101 11001 10001 01110",'1':"00100 01100 00100 00100 00100 00100 01110",'2':"01110 10001 00001 00110 01000 10000 11111",
'3':"11110 00001 00001 01110 00001 00001 11110",'=':"00000 00000 11111 00000 11111 00000 00000",' ':"00000 00000 00000 00000 00000 00000 00000",
'.':"00000 00000 00000 00000 00000 00000 00100",':':"00000 00100 00000 00000 00000 00100 00000",'>':"10000 01000 00100 00010 00100 01000 10000"}
def text(img, msg, x, y, scale, col, alpha=1.0, center=True):
    rows = [np.array([[int(c) for c in g.split()[r]] for g in (GL[ch] for ch in msg)]).reshape(len(msg), 5) for r in range(7)]
    bmp = np.zeros((7, len(msg) * 6));
    for r in range(7):
        for k in range(len(msg)): bmp[r, k * 6:k * 6 + 5] = rows[r][k]
    bmp = np.kron(bmp, np.ones((scale, scale)))
    # soften a touch (box blur) so it sits with the anti-aliased vectors
    pad = np.pad(bmp, 1); bmp = (pad[:-2, 1:-1] + pad[2:, 1:-1] + pad[1:-1, :-2] + pad[1:-1, 2:] + 4 * bmp) / 8
    hh, ww = bmp.shape; x0 = int(x - ww / 2) if center else int(x); y0 = int(y - hh / 2)
    reg = img[y0:y0 + hh, x0:x0 + ww]; a = (bmp * alpha)[..., None]
    img[y0:y0 + hh, x0:x0 + ww] = reg * (1 - a) + a * np.array(col)
# ---- particles: emitted on 11 streamlines, advected by u(s) via a travel-time table ----
SPEED = 3400.0                                               # exit speed in px/s (chamber ≈ 140 px/s)
tau = np.concatenate([[0], np.cumsum(np.diff(s) * (X1 - X0) / (SPEED * 0.5 * (u[1:] + u[:-1])))])
LINES = np.linspace(-.82, .82, 9); EMIT_DT = 0.3; EMIT_T0 = 0.4
stamp_r = 4; sy, sxx = np.mgrid[-6:7, -6:7]; stamp = np.clip(1.6 - np.hypot(sxx, sy) / stamp_r, 0, 1)
# ---- Mach plot under the nozzle ----
PX0, PX1, PY0, PY1 = X0, X1, 660, 500                          # M=0 at PY0, M=3.4 at PY1
py = PY0 + (PY1 - PY0) * (M / 3.4)
plot_px = np.interp(np.clip((xx - PX0) / (PX1 - PX0), 0, 1), s, py)
curve = np.clip(1.6 - np.abs(yy - plot_px), 0, 1) * inside_s
axis = (np.clip(1.2 - np.abs(yy - PY0), 0, 1) * inside_s) + (np.clip(1.2 - np.abs(xx - PX0), 0, 1) * ((yy <= PY0) & (yy >= PY1)))
m1_y = PY0 + (PY1 - PY0) / 3.4; dash = (((xx - PX0) // 12) % 2 == 0)
m1_line = np.clip(1 - np.abs(yy - m1_y), 0, 1) * inside_s * dash
throat_x = X0 + ST * (X1 - X0)
enc = Encoder('out.mp4')
for i in range(N):
    t = i / FPS
    img = np.zeros((H, W, 3))
    # 1) geometry draws itself in (0–1.0 s), 2) the Mach field floods left→right (1.0–2.6 s)
    draw_front = X0 + (X1 - X0) * smooth(seg(t, 0.0, 1.0))
    reveal_w = np.clip((draw_front - xx) / 40 + 1, 0, 1)
    flood = X0 + (X1 - X0) * smooth(seg(t, 1.0, 2.6))
    reveal_f = np.clip((flood - xx) / 60 + 1, 0, 1)
    img += field * reveal_f[..., None]
    img = img * (1 - wall[..., None] * reveal_w[..., None]) + (wall * reveal_w)[..., None] * np.array(GREY) * 1.3
    # particles
    if t > EMIT_T0:
        n_em = int((t - EMIT_T0) / EMIT_DT) + 1
        te = EMIT_T0 + np.arange(n_em) * EMIT_DT
        for k, frac in enumerate(LINES):
            age = t - te - k * 0.013
            age = age[age > 0]
            spos = np.interp(age, tau, s, right=np.nan); spos = spos[~np.isnan(spos)]
            xs = X0 + spos * (X1 - X0); ys = YA + frac * np.interp(spos, s, h) * 0.93
            mach = np.interp(spos, s, M)
            for xp, yp, mm in zip(xs, ys, mach):
                xi, yi = int(round(xp)), int(round(yp))
                if 7 <= xi < W - 7 and 7 <= yi < H - 7:
                    col = np.array(WHITE) if mm < 1 else np.array(YELLOW)
                    reg = img[yi - 6:yi + 7, xi - 6:xi + 7]; a = stamp[..., None] * 0.95
                    img[yi - 6:yi + 7, xi - 6:xi + 7] = reg * (1 - a) + a * col
    # Mach plot (3) draws with the flood front
    pa = smooth(seg(t, 1.0, 1.5))
    img = img * (1 - (axis * pa * .6)[..., None]) + (axis * pa * .6)[..., None] * np.array(GREY)
    cr = curve * reveal_f
    img = img * (1 - cr[..., None]) + cr[..., None] * np.array(YELLOW)
    ml = m1_line * pa * .5; img = img * (1 - ml[..., None]) + ml[..., None] * np.array(WHITE)
    # labels
    text(img, 'THE NOZZLE', 640, 60, 3, TEAL, smooth(seg(t, 0, .6)))
    text(img, 'SUBSONIC', X0 + 0.12 * (X1 - X0), 150, 3, BLUE, smooth(seg(t, 1.1, 1.6)))
    text(img, 'M=1', throat_x, 150, 3, WHITE, smooth(seg(t, 1.6, 2.0)))
    text(img, 'SUPERSONIC', X0 + 0.75 * (X1 - X0), 110, 3, RED, smooth(seg(t, 2.1, 2.6)))
    text(img, 'MACH', PX0 - 62, PY1 + 10, 2, GREY, pa); text(img, '3', PX0 - 22, PY1, 2, GREY, pa); text(img, '0', PX0 - 22, PY0, 2, GREY, pa); text(img, '1', PX0 - 22, m1_y, 2, WHITE, pa)
    text(img, 'NARROW THE PIPE: THE GAS REACHES MACH 1.  THEN WIDEN IT: IT GOES FASTER.', 640, 700, 2, WHITE, smooth(seg(t, 2.6, 3.3)))
    enc.write(np.clip(img, 0, 255))
enc.close(); print('demo 04 done')
