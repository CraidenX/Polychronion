# Облака в духе Knights of Honor: объёмные, пористые, из множества клубов; свет сверху-слева.
# Выход: ../clouds.png (атлас N×(SW×SH), RGBA) и ../clouds.json ({w, h, n, cols}).
# Игра собирает облако на карте из 2–4 заготовок атласа («конструктор») + мелкие клочки.
import os, sys, json
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
SW, SH, N, COLS = 360, 220, 16, 4
def fbm(shape, scale, rng, oct=5):
    o = np.zeros(shape, np.float32); a = 1.0; t = 0
    for i in range(oct):
        o += a * nd.gaussian_filter(rng.standard_normal(shape).astype(np.float32), max(scale / 2 ** i, 0.6)); t += a; a *= 0.55
    o -= o.mean(); return o / (o.std() + 1e-6)
def cloud(seed):
    r = np.random.default_rng(seed)
    S = 2; H, W = SH * S, SW * S
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    D = np.zeros((H, W), np.float32)
    kind = r.integers(0, 4)
    ncl = [1, 2, 3, 2][kind]
    base = H * r.uniform(0.62, 0.72)
    span = W * [0.4, 0.52, 0.58, 0.48][kind]
    centers = np.sort(r.uniform(W / 2 - span / 2, W / 2 + span / 2, ncl))
    for c in centers:
        cw = span / ncl * r.uniform(0.7, 1.15); ch = cw * r.uniform(0.45, 0.8) * [1.0, 0.9, 0.7, 0.6][kind]
        npf = int(r.integers(18, 34))
        for _ in range(npf):
            px = c + r.normal(0, cw * 0.32); t = abs(px - c) / (cw * 0.6)
            top = base - ch * max(0.15, 1 - t * t) * r.uniform(0.55, 1.1)
            py = r.uniform(top, base)
            pr = r.uniform(9, 24) * S * (1.2 - 0.45 * (py - top) / max(1, base - top))
            D += np.exp(-(((xx - px) ** 2 + (yy - py) ** 2) / (pr * pr)) * 1.6)
    # «барашки» по верхнему краю — выпуклые клубы, как у кучевых облаков
    Dt = nd.gaussian_filter(D, 2 * S); prof = (Dt > 0.6).argmax(0)
    for _ in range(int(r.integers(14, 26))):
        px = int(r.uniform(W / 2 - span * 0.55, W / 2 + span * 0.55)); ty = prof[px]
        if ty <= 0: continue
        pr = r.uniform(6, 13) * S
        D += 0.9 * np.exp(-(((xx - px) ** 2 + (yy - (ty + pr * 0.35)) ** 2) / (pr * pr)) * 1.6)
    # отдельные клочки вокруг — «пористость» и рваный край
    for _ in range(int(r.integers(6, 14))):
        px = r.uniform(W / 2 - span * 0.62, W / 2 + span * 0.62); py = r.uniform(base - span * 0.28, base); pr = r.uniform(4, 10) * S
        D += 0.75 * np.exp(-(((xx - px) ** 2 + (yy - py) ** 2) / (pr * pr)) * 1.6)
    D *= np.clip(1 - (yy - base) / (10 * S), 0, 1)                    # плоское дно
    n1 = fbm((H, W), 12 * S, r); n2 = fbm((H, W), 4 * S, r)
    near = np.clip(nd.gaussian_filter(D, 6 * S) * 3, 0, 1)            # шум края — только у самого облака
    De = D * (1 + 0.22 * n1) + near * (0.10 * n2 - 0.03)
    A = np.clip((De - 0.26) / 0.62, 0, 1); A = A * A * (3 - 2 * A)   # мягкий, но рваный край
    # освещение: сколько облака между точкой и светом (сверху-слева) + рельеф клубов (нормаль по градиенту)
    Ds = nd.gaussian_filter(De, 2.0 * S)
    occ = np.zeros_like(Ds)
    for s in range(1, 9):
        occ += np.roll(np.roll(Ds, s * 3 * S, 0), s * 3 * S, 1) * (0.9 ** s)
    light = np.exp(-np.clip(occ, 0, None) * 0.075)
    gy, gx = np.gradient(nd.gaussian_filter(D, 3.0 * S))
    bump = np.clip(0.5 - (gx * 0.7 + gy * 0.7) * 9, 0, 1)            # округлые «барашки»: освещённая сторона клуба
    sh = np.clip(light * 0.55 + bump * 0.6 + 0.04 * n2, 0, 1)
    under = np.clip((yy - (base - 22 * S)) / (24 * S), 0, 1)          # низ — серо-голубой
    sh = sh * (1 - 0.35 * under)
    white = np.array([255, 255, 252], np.float32); mid = np.array([226, 232, 242], np.float32); dark = np.array([150, 162, 184], np.float32)
    s3 = sh[..., None]
    col = np.where(s3 > 0.5, mid + (white - mid) * ((s3 - 0.5) / 0.5), dark + (mid - dark) * (s3 / 0.5))
    rgba = np.dstack([col, A[..., None] * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA').resize((SW, SH), Image.LANCZOS)
rows = (N + COLS - 1) // COLS
atlas = Image.new('RGBA', (SW * COLS, SH * rows), (0, 0, 0, 0))
for i in range(N):
    atlas.paste(cloud(1261 + i * 7919), ((i % COLS) * SW, (i // COLS) * SH))
atlas.save(OUT + '/clouds.png', optimize=True)
json.dump({'w': SW, 'h': SH, 'n': N, 'cols': COLS}, open(OUT + '/clouds.json', 'w'))
print('облаков', N, os.path.getsize(OUT + '/clouds.png') // 1024, 'КБ')
