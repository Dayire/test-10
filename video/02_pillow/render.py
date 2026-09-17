"""Demo 02 — Pillow only. Newton's third law: throw mass one way, you go the other. Then: that IS a rocket."""
import sys, math, random; sys.path.insert(0, '..')
from PIL import Image, ImageDraw, ImageFont
from common import *
S = 2                                                # supersample for antialiasing
fs = lambda p, s: ImageFont.truetype(p, int(s * S))
F_CAP, F_SMALL, F_MATH = fs(SANS, 26), fs(SANS, 20), fs(SERIF_IT, 34)
random.seed(4)
M, m, U = 10.0, 1.0, 380.0                            # cart mass, ball mass, throw speed (px/s)
THROWS = [0.7, 1.5, 2.3]
STREAM_T0, STREAM_RATE, STREAM_U = 3.1, 90, 1000     # exhaust phase
GROUND = 470
def sc(*v): return [x * S for x in v]

def arrow(d, x0, y0, x1, y1, col, w=6):
    d.line(sc(x0, y0, x1, y1), fill=col, width=w * S)
    ang = math.atan2(y1 - y0, x1 - x0); L = 16
    tip = (x1, y1); a = (x1 - L * math.cos(ang - .45), y1 - L * math.sin(ang - .45)); b = (x1 - L * math.cos(ang + .45), y1 - L * math.sin(ang + .45))
    d.polygon(sc(*tip, *a, *b), fill=col)

def cart_state(t):
    """Integrate recoil: each throw kicks the cart by m·U/M; the exhaust phase is a continuous push."""
    x, v, dt = 820.0, 0.0, 1 / 240
    tt = 0.0
    while tt < t:
        for th in THROWS:
            if tt <= th < tt + dt: v -= m * U / M
        if tt >= STREAM_T0: v -= 75.0 * dt                                    # ṁ·u / M, scaled to stay in frame
        x += v * dt; tt += dt
    return x, v

enc = Encoder('out.mp4')
for i in range(N):
    t = i / FPS
    img = Image.new('RGB', (W * S, H * S), BG); d = ImageDraw.Draw(img)
    a = smooth(seg(t, 0, .6))
    d.text(sc(640, 70), "NEWTON'S THIRD LAW", font=F_SMALL, fill=mix(BG, TEAL, a), anchor='mm')
    cap = "Throw mass one way — you move the other way." if t < STREAM_T0 else "Do it 2.7 tonnes per second: that is a rocket."
    ca = smooth(seg(t, .3, .9)) if t < STREAM_T0 else smooth(seg(t, STREAM_T0, STREAM_T0 + .5))
    d.text(sc(640, 640), cap, font=F_CAP, fill=mix(BG, WHITE, ca), anchor='mm')
    d.line(sc(80, GROUND + 26, 1200, GROUND + 26), fill=GREY, width=2 * S)

    xc, vc = cart_state(t)
    # cart → rocket silhouette during the exhaust phase
    k = smooth(seg(t, STREAM_T0, STREAM_T0 + .8))
    bw, bh = lerp(130, 150, k), lerp(70, 52, k)
    body = [xc - bw / 2, GROUND - bh, xc + bw / 2, GROUND]
    d.rounded_rectangle(sc(*body), radius=int(lerp(14, 26, k) * S), fill=(12, 30, 40), outline=BLUE, width=3 * S)
    if k > 0:  # nose cone grows on the left (rocket points the way it moves)
        nx = xc - bw / 2 - 48 * k
        d.polygon(sc(xc - bw / 2, GROUND - bh, nx, GROUND - bh / 2, xc - bw / 2, GROUND), fill=mix((12, 30, 40), BLUE, .3 * k), outline=BLUE)
    for wx in (-40, 40):
        wa = 1 - k
        if wa > 0.02: d.ellipse(sc(xc + wx - 14, GROUND + 2, xc + wx + 14, GROUND + 30), outline=mix(BG, GREY, wa), width=3 * S)
    # balls in flight + momentum arrows
    for th in THROWS:
        if t >= th:
            bx = cart_state(th)[0] + 90 + U * (t - th)
            if bx < W + 30: d.ellipse(sc(bx - 15, GROUND - 60, bx + 15, GROUND - 30), fill=YELLOW)
            fa = 1 - smooth(seg(t, th + .4, th + 1.1))
            if fa > 0.02:
                col_b, col_c = mix(BG, YELLOW, fa), mix(BG, BLUE, fa)
                L = 120
                arrow(d, bx, GROUND - 90, bx + L, GROUND - 90, col_b)
                arrow(d, xc, GROUND - bh - 40, xc - L, GROUND - bh - 40, col_c)
                d.text(sc(bx + L / 2, GROUND - 120), "p", font=F_MATH, fill=col_b, anchor='mm')
                d.text(sc(xc - L / 2, GROUND - bh - 72), "−p", font=F_MATH, fill=col_c, anchor='mm')
    # exhaust stream
    if t >= STREAM_T0:
        n_em = int((t - STREAM_T0) * STREAM_RATE)
        for j in range(n_em):
            te = STREAM_T0 + j / STREAM_RATE; age = t - te
            if age < 0: continue
            rnd = random.Random(j)
            ex = cart_state(te)[0] + bw / 2 + STREAM_U * age * (0.85 + .3 * rnd.random())
            ey = GROUND - bh / 2 + (rnd.random() - .5) * (14 + 60 * age)
            if ex > W + 20: continue
            r = 6 - 3.5 * min(1, age * 1.5)
            col = mix(mix(YELLOW, RED, min(1, age * 2.5)), BG, min(.85, age * .9))
            d.ellipse(sc(ex - r, ey - r, ex + r, ey + r), fill=col)
        # speed readout
        va = smooth(seg(t, STREAM_T0 + .3, STREAM_T0 + .7))
        d.text(sc(xc, GROUND - bh - 40), f"v = {abs(vc) / 60:.1f} m/s and rising", font=F_SMALL, fill=mix(BG, BLUE, va), anchor='mm')
    enc.write(img.resize((W, H), Image.LANCZOS))
enc.close()
print('demo 02 done')
