"""Demo 08 — pygame (SDL, headless dummy driver). Staging: drain stage 1, cut off, separate, light stage 2."""
import os, sys, math, random; sys.path.insert(0, '..'); os.environ['SDL_VIDEODRIVER'] = 'dummy'
import pygame, pygame.gfxdraw, numpy as np
from common import *
pygame.init(); S = 2; surf = pygame.Surface((W * S, H * S))
font = lambda p, s: pygame.font.Font(p, int(s * S))
F_CAP, F_SM, F_NUM, F_IT = font(SANS, 26), font(SANS, 18), font(SERIF, 30), font(SERIF_IT, 26)
random.seed(11); STARS = [(random.random() * W, random.random() * H, random.choice([1, 1, 1.5, 2])) for _ in range(160)]
MECO, SEP, IGN2 = 1.8, 2.05, 2.55
CX = 380
PROP = (0x58, 0xC4, 0xDD)
def poly(pts, col, a=255):
    pts = [(int(x * S), int(y * S)) for x, y in pts]
    pygame.gfxdraw.filled_polygon(surf, pts, (*col, a)); pygame.gfxdraw.aapolygon(surf, pts, (*col, a))
def text(s, x, y, f, col, a=1.0, anchor='center'):
    if a <= 0.01: return
    img = f.render(s, True, col); img.set_alpha(int(255 * a)); r = img.get_rect(); setattr(r, anchor, (int(x * S), int(y * S))); surf.blit(img, r)
def rot(pts, cx, cy, ang):
    c, s_ = math.cos(ang), math.sin(ang)
    return [(cx + (x - cx) * c - (y - cy) * s_, cy + (x - cx) * s_ + (y - cy) * c) for x, y in pts]
def plume(x, y, length, width, t, seed, up=False):
    """three nested flame polygons with a noisy edge"""
    rnd = random.Random(int(t * 30) + seed)
    for k, (col, a) in enumerate(((RED, 110), (ORANGE, 150), (YELLOW, 200), (WHITE, 230))):
        L = length * (1 - k * .22); w = width * (1 - k * .22)
        pts = [(x - w / 2, y)]
        for j in range(1, 8):
            u = j / 8; pts.append((x - w / 2 * (1 - u) * (1 + .3 * (rnd.random() - .5)), y + L * u * (0.9 + .2 * rnd.random())))
        pts.append((x, y + L * (1 + .15 * rnd.random())))
        for j in range(7, 0, -1):
            u = j / 8; pts.append((x + w / 2 * (1 - u) * (1 + .3 * (rnd.random() - .5)), y + L * u * (0.9 + .2 * rnd.random())))
        pts.append((x + w / 2, y))
        poly(pts, col, a)
enc = Encoder('out.mp4')
for i in range(N):
    t = i / FPS
    surf.fill(BG)
    # star field streaming down: the rocket is climbing
    speed = 260 + 90 * smooth(seg(t, IGN2, IGN2 + 1.5)) - 120 * seg(t, MECO, IGN2) * (1 - seg(t, IGN2, IGN2 + .5))
    for sx, sy, r in STARS:
        y = (sy + speed * t * (0.4 + r * .3)) % H
        pygame.gfxdraw.filled_circle(surf, int(sx * S), int(y * S), int(r * S * .8), (140, 140, 150))
    # ---------- stage 1 (falls away after SEP) ----------
    sep = seg(t, SEP, 5.0); dy = 30 * sep + 380 * sep * sep; ang = -0.10 * sep
    s1 = lambda pts: rot([(x, y + dy) for x, y in pts], CX, 470 + dy, ang)
    fuel1 = 1 - smooth(seg(t, 0.2, MECO))
    if t < MECO: plume(CX, 585 + dy, 210, 52, t, 1)
    poly(s1([(CX - 24, 335), (CX + 24, 335), (CX + 24, 560), (CX - 24, 560)]), (22, 34, 52)); poly(s1([(CX - 24, 335), (CX - 20, 335), (CX - 20, 560), (CX - 24, 560)]), (80, 96, 120))
    # tanks: LOX above, RP-1 below, draining
    for (y0, y1, col) in ((345, 465, BLUE), (472, 548, YELLOW)):
        hgt = (y1 - y0) * fuel1; poly(s1([(CX - 19, y1 - hgt), (CX + 19, y1 - hgt), (CX + 19, y1), (CX - 19, y1)]), col, 210)
        pygame.gfxdraw.aapolygon(surf, [(int(x * S), int(y * S)) for x, y in s1([(CX - 19, y0), (CX + 19, y0), (CX + 19, y1), (CX - 19, y1)])], (*GREY, 160))
    poly(s1([(CX - 24, 300), (CX + 24, 300), (CX + 24, 335), (CX - 24, 335)]), (40, 44, 52))          # interstage
    for ex in (-15, 0, 15): poly(s1([(CX + ex - 5, 560), (CX + ex + 5, 560), (CX + ex + 8, 585), (CX + ex - 8, 585)]), (90, 100, 120))
    # ---------- stage 2 + fairing ----------
    lift = -18 * smooth(seg(t, IGN2, 5.0))
    s2 = lambda pts: [(x, y + lift) for x, y in pts]
    if t >= IGN2: plume(CX, 300 + lift, 170 * smooth(seg(t, IGN2, IGN2 + .6)), 40, t, 2)
    poly(s2([(CX - 9, 268), (CX + 9, 268), (CX + 16, 300), (CX - 16, 300)]), (90, 100, 120))                        # vacuum nozzle
    poly(s2([(CX - 24, 170), (CX + 24, 170), (CX + 24, 268), (CX - 24, 268)]), (22, 34, 52)); poly(s2([(CX - 24, 170), (CX - 20, 170), (CX - 20, 268), (CX - 24, 268)]), (80, 96, 120))
    poly(s2([(CX - 19, 180), (CX + 19, 180), (CX + 19, 220), (CX - 19, 220)]), BLUE, 210); poly(s2([(CX - 19, 226), (CX + 19, 226), (CX + 19, 260), (CX - 19, 260)]), YELLOW, 210)
    poly(s2([(CX - 24, 170), (CX - 24, 150), (CX - 16, 118), (CX, 100), (CX + 16, 118), (CX + 24, 150), (CX + 24, 170)]), (30, 44, 66)); poly(s2([(CX - 7, 138), (CX + 7, 138), (CX + 7, 160), (CX - 7, 160)]), GREEN, 220)
    # separation flash
    fl = 1 - seg(t, SEP, SEP + .3)
    if SEP <= t < SEP + .3:
        for k in range(6): pygame.gfxdraw.filled_circle(surf, int((CX - 30 + k * 12) * S), int((302 + lift) * S), int(4 * S * fl), (*WHITE, int(220 * fl)))
    # ---------- mass bar on the right: payload / stage-2 dry / stage-2 propellant / stage-1 dry / stage-1 propellant ----------
    bx, by0, bh = 1000, 560, 420
    def seg_bar(y_bottom, m, col, a=255, shift=0.0):
        hgt = bh * m / 549; poly([(bx, y_bottom - hgt + shift), (bx + 46, y_bottom - hgt + shift), (bx + 46, y_bottom + shift), (bx, y_bottom + shift)], col, a); return y_bottom - hgt
    y = seg_bar(by0, 10, GREEN); y = seg_bar(y, 4, GREY); y = seg_bar(y, 108, PROP)
    dry_top = y - bh * 26 / 549
    if sep < 1: seg_bar(y, 26, (150, 150, 160), int(255 * (1 - sep)), shift=dy * .6)      # the empty stage falls off the bar too
    if fuel1 > 0.002: seg_bar(dry_top, 411 * fuel1, PROP, 230)
    pygame.gfxdraw.aapolygon(surf, [(int(x * S), int(y_ * S)) for x, y_ in [(bx, by0), (bx + 46, by0), (bx + 46, by0 - bh), (bx, by0 - bh)]], (*GREY, 90))
    mass = 549 - 411 * (1 - fuel1) - (26 if t >= SEP else 0)
    text(f'{mass:,.0f} t', bx + 23, by0 + 26, F_NUM, WHITE)
    text('stack mass', bx + 23, by0 + 52, F_SM, GREY)
    if t >= SEP: text('− 26 t dead weight', bx + 23, dry_top - 26, F_SM, RED, smooth(seg(t, SEP, SEP + .5)))
    # captions
    text('STAGING', 800, 60, F_SM, TEAL, smooth(seg(t, 0, .5)))
    if t < MECO: text('Stage 1 burns 411 tonnes in 160 seconds…', 800, 665, F_CAP, WHITE, smooth(seg(t, .3, .9)))
    elif t < IGN2 + .4: text('…then it is 26 tonnes of empty tank. Drop it.', 800, 665, F_CAP, WHITE, smooth(seg(t, MECO, MECO + .4)))
    else: text('Stage 2 restarts the equation: small, light, fresh.', 800, 665, F_CAP, WHITE, smooth(seg(t, IGN2 + .4, IGN2 + .9)))
    if t < MECO + .2: text(f'{max(0, fuel1) * 100:3.0f} %', CX + 60, 470, F_IT, PROP, 1, 'midleft')
    frame = pygame.surfarray.pixels3d(pygame.transform.smoothscale(surf, (W, H)))
    enc.write(np.transpose(frame, (1, 0, 2)))
enc.close(); print('demo 08 done')
