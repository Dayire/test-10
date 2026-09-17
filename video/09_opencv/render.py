"""Demo 09 — OpenCV drawing + VideoWriter. Newton's cannonball: shoot faster and faster until the ground curves away."""
import sys, subprocess; sys.path.insert(0, '..')
import numpy as np, cv2
from common import *
bgr = lambda c: (c[2], c[1], c[0])
CX, CY, RE = 640, 420, 150                       # Earth centre & radius (px); 400 km orbit is exaggerated for legibility
GM = 1.0                                          # in units where v_circ at r0 = sqrt(GM/r0)
R0 = RE + 12; V_CIRC = np.sqrt(GM / R0)
def trajectory(frac, dt=0.4, max_steps=20000):
    p = np.array([CX, CY - R0], float); v = np.array([frac * V_CIRC, 0.0]); pts = [p.copy()]; ang = 0.0; prev = np.arctan2(*(p - (CX, CY))[::-1])
    for _ in range(max_steps):
        def acc(q): d = q - (CX, CY); r = np.hypot(*d); return -GM * d / r ** 3
        k1 = acc(p); pm = p + v * dt / 2 + k1 * dt * dt / 8; vm = v + k1 * dt / 2
        k2 = acc(pm); p = p + vm * dt + k2 * dt * dt / 2; v = v + k2 * dt
        pts.append(p.copy())
        a = np.arctan2(*(p - (CX, CY))[::-1]); da = (a - prev + np.pi) % (2 * np.pi) - np.pi; ang += da; prev = a
        if np.hypot(*(p - (CX, CY))) < RE or abs(ang) > 2 * np.pi - 0.02 or p[1] < -200 or abs(p[0] - CX) > 900: break
    return np.array(pts)
SHOTS = [(0.42, 'v = 3.2 km/s'), (0.62, 'v = 4.8 km/s'), (0.82, 'v = 6.3 km/s'), (0.95, 'v = 7.3 km/s'), (1.0, 'v = 7.7 km/s   orbit')]
TR = [trajectory(f) for f, _ in SHOTS]
T0 = [0.9, 1.5, 2.1, 2.75, 3.4]; DRAW = [0.5, 0.5, 0.55, 0.6, 1.5]
rng = np.random.default_rng(3); STARS = np.column_stack([rng.integers(0, W, 140), rng.integers(0, H, 140)])
def put(img, s, x, y, col, scale=0.8, th=1, center=False):
    (tw, thh), _ = cv2.getTextSize(s, cv2.FONT_HERSHEY_DUPLEX, scale, th)
    if center: x -= tw // 2
    cv2.putText(img, s, (int(x), int(y)), cv2.FONT_HERSHEY_DUPLEX, scale, bgr(col), th, cv2.LINE_AA)
def alpha_blend(img, layer, a):
    return cv2.addWeighted(img, 1 - a, cv2.add(img, layer), a, 0) if a < 1 else cv2.add(img, layer)
vw = cv2.VideoWriter('raw.mp4', cv2.VideoWriter_fourcc(*'mp4v'), FPS, (W, H))
for i in range(N):
    t = i / FPS
    img = np.zeros((H, W, 3), np.uint8)
    for sx, sy in STARS: img[sy, sx] = (110, 110, 110)
    # Earth: filled disc, atmosphere rim, a mountain to shoot from
    cv2.circle(img, (CX, CY), RE + 6, bgr((20, 60, 80)), -1, cv2.LINE_AA)
    cv2.circle(img, (CX, CY), RE, bgr((18, 52, 90)), -1, cv2.LINE_AA)
    cv2.circle(img, (CX, CY), RE, bgr(BLUE), 2, cv2.LINE_AA)
    cv2.fillPoly(img, [np.array([[CX - 14, CY - RE + 2], [CX, CY - R0 - 2], [CX + 14, CY - RE + 2]])], bgr(GREY), cv2.LINE_AA)
    # trajectories: each draws itself in over DRAW seconds; earlier ones dim to grey
    for k, (pts, t0, dur) in enumerate(zip(TR, T0, DRAW)):
        if t < t0: continue
        f = smooth(seg(t, t0, t0 + dur)); n = max(2, int(f * len(pts)))
        last = k == len(TR) - 1
        col = YELLOW if last else (WHITE if t < t0 + dur + 0.3 else GREY)
        cv2.polylines(img, [pts[:n].astype(np.int32)], False, bgr(col), 2 if last else 1, cv2.LINE_AA)
        if f < 1 or last:
            cv2.circle(img, tuple(pts[n - 1].astype(int)), 6 if last else 4, bgr(col), -1, cv2.LINE_AA)
            if last and f >= 1:  # keep orbiting: loop the closed path
                j = int((t - t0 - dur) / 1.2 * len(pts)) % len(pts); cv2.circle(img, tuple(pts[j].astype(int)), 6, bgr(YELLOW), -1, cv2.LINE_AA)
        if f > .15:
            lx, ly = 40, 150 + k * 40
            put(img, SHOTS[k][1], lx, ly, col if not last else YELLOW, 0.75)
        if last and f >= 1:
            # gravity and velocity vectors on the orbiting ship
            j = int((t - t0 - dur) / 1.2 * len(pts)) % len(pts); p = pts[j]; q = pts[(j + 8) % len(pts)]
            d = (CX, CY) - p; d /= np.hypot(*d); vv = q - p; vv /= np.hypot(*vv)
            cv2.arrowedLine(img, tuple(p.astype(int)), tuple((p + d * 55).astype(int)), bgr(GREY), 2, cv2.LINE_AA, tipLength=.25)
            cv2.arrowedLine(img, tuple(p.astype(int)), tuple((p + vv * 55).astype(int)), bgr(GREEN), 2, cv2.LINE_AA, tipLength=.25)
    put(img, "NEWTON'S CANNONBALL", 640, 66, TEAL, 0.7, 1, True)
    if t > 3.9:
        put(img, 'gravity', 1010, 300, GREY, 0.7); put(img, 'velocity', 1010, 340, GREEN, 0.7)
    cap = 'Faster ... faster ... until the ground curves away as fast as you fall.' if t > 3.6 else ('Same gravity every time. Only the sideways speed changes.' if t > 1.0 else '')
    if cap: put(img, cap, 640, 668, WHITE, 0.85, 1, True)
    vw.write(img)
vw.release()
subprocess.run([FFMPEG, '-y', '-loglevel', 'error', '-i', 'raw.mp4', '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'out.mp4'], check=True)
print('demo 09 done')
