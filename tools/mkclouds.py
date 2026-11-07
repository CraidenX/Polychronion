# Облака в духе Knights of Honor — ВИД СВЕРХУ: «цветная капуста» из десятков шаров-клубов.
# Поле высот = максимум полусфер клубов; освещение по нормали (свет сверху-слева), тёмные ложбинки между клубами,
# тонкие полупрозрачные края, мелкие оторванные клочки вокруг.
# Выход: ../clouds.png (атлас N заготовок SW×SH, RGBA) и ../clouds.json. Игра собирает облако из 2–4 заготовок.
import os, sys, json
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
SW, SH, N, COLS = 360, 240, 20, 5
S = 2
LIGHT = np.array([-0.55, -0.62, 0.5]); LIGHT /= np.linalg.norm(LIGHT)
def fbm(shape, s, r, oct=4):
    o = np.zeros(shape, np.float32); a = 1
    for i in range(oct): o += a * nd.gaussian_filter(r.standard_normal(shape).astype(np.float32), max(s / 2 ** i, .6)); a *= .55
    return (o - o.mean()) / (o.std() + 1e-6)
def cloud(seed):
    r = np.random.default_rng(seed)
    H, W = SH * S, SW * S
    Sx = np.zeros((H, W), np.float64)              # сумма exp(h/k) — мягкое слияние клубов
    KS = 7 * S
    kind = r.integers(0, 4)                      # 0 — кучевое, 1 — гряда, 2 — россыпь, 3 — рваное
    masses = {0: 1, 1: 3, 2: 4, 3: 2}[kind]
    cx0, cy0 = W / 2, H / 2
    puffs = []
    for m in range(masses):
        if kind == 1: mx, my = cx0 + (m - 1) * W * 0.2 + r.normal(0, 10), cy0 + r.normal(0, 14)
        elif masses == 1: mx, my = cx0, cy0
        else: mx, my = cx0 + r.uniform(-.22, .22) * W, cy0 + r.uniform(-.16, .16) * H
        ax = W * r.uniform(.11, .2) * (1.2 if kind == 0 else 1) * (0.65 if kind == 2 else 1)
        ay = ax * r.uniform(.45, .72)
        ang = r.uniform(-.35, .35)
        n = int(r.integers(16, 30) * (0.6 if kind == 2 else 1))
        for _ in range(n):
            u, v = r.normal(0, .5), r.normal(0, .5)
            d = min(1.0, np.hypot(u, v))
            px = mx + (u * np.cos(ang) - v * np.sin(ang)) * ax * 1.6
            py = my + (u * np.sin(ang) + v * np.cos(ang)) * ay * 1.6
            pr = r.uniform(12, 26) * S * (1.15 - 0.6 * d) * (ax / (W * .2)) ** .5
            pz = (1 - d) * 22 * S                          # клубы в середине выше
            puffs.append((px, py, pr, pz))
        # кромка из мелких клубов — кудрявый силуэт
        for _ in range(int(n * .9)):
            t = r.uniform(0, 2 * np.pi); rr = r.uniform(.85, 1.15)
            px = mx + (np.cos(t) * ax * np.cos(ang) - np.sin(t) * ay * np.sin(ang)) * rr
            py = my + (np.cos(t) * ax * np.sin(ang) + np.sin(t) * ay * np.cos(ang)) * rr
            puffs.append((px, py, r.uniform(6, 12) * S, r.uniform(0, 5) * S))
    # оторванные клочки и «пыль» вокруг
    for _ in range(int(r.integers(4, 12))):
        a = r.uniform(0, 2 * np.pi); d = r.uniform(.24, .38)
        puffs.append((cx0 + np.cos(a) * W * d, cy0 + np.sin(a) * H * d * 0.9, r.uniform(4, 8) * S, 0))
    for px, py, pr, pz in puffs:
        x0, x1 = int(max(0, px - pr - 1)), int(min(W, px + pr + 2)); y0, y1 = int(max(0, py - pr - 1)), int(min(H, py + pr + 2))
        if x0 >= x1 or y0 >= y1: continue
        yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
        q = 1 - ((xx - px) ** 2 + (yy - py) ** 2) / (pr * pr)
        h = pz + pr * np.sqrt(np.clip(q, 0, 1))
        Sx[y0:y1, x0:x1] += np.where(q > 0, np.exp(h / KS) - 1, 0)
    Hc = (KS * np.log1p(Sx)).astype(np.float32)
    inside = Hc > 0.5
    n1 = fbm((H, W), 7 * S, r, oct=2)
    Hs = nd.gaussian_filter(Hc, 2.2 * S) + n1 * 1.2 * S * inside        # мягкие неровности ваты
    gy, gx = np.gradient(Hs)
    nrm = np.stack([-gx, -gy, np.ones_like(gx)], -1); nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    diff = np.clip(nrm @ LIGHT, 0, 1)
    ao = np.clip(1 - np.clip(nd.gaussian_filter(Hc, 7 * S) - Hc, 0, None) / (14 * S), 0.45, 1)   # ложбинки темнее
    lit = np.clip(diff * 0.95 + 0.18, 0, 1) * ao
    white = np.array([255, 255, 255], np.float32); mid = np.array([224, 228, 240], np.float32); shade = np.array([138, 144, 172], np.float32)
    thick = np.clip(Hc / (16 * S), 0, 1)
    lit = lit * (0.75 + 0.25 * thick) + (1 - thick) * 0.25   # тонкий край просвечивает — светлее
    l3 = np.clip(lit, 0, 1)[..., None]
    col = np.where(l3 > .55, mid + (white - mid) * ((l3 - .55) / .45), shade + (mid - shade) * (l3 / .55))
    # прозрачность: толщина облака + рваный пористый край
    thick = np.clip(Hc / (16 * S), 0, 1)
    n2 = fbm((H, W), 3 * S, r, oct=3)
    near = nd.gaussian_filter(inside.astype(np.float32), 4 * S) > 0.05
    A = np.clip(thick * 1.35 + n2 * 0.2 * thick * (1 - thick) * 4 - 0.04, 0, 1) * near
    A = nd.gaussian_filter(A, 1.4 * S)              # мягкий, «тающий» край
    A = A ** 0.9 * 0.97
    rgba = np.dstack([col, A[..., None] * 255]).clip(0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA').resize((SW, SH), Image.LANCZOS)
rows = (N + COLS - 1) // COLS
atlas = Image.new('RGBA', (SW * COLS, SH * rows), (0, 0, 0, 0))
for i in range(N):
    atlas.paste(cloud(1261 + i * 7919), ((i % COLS) * SW, (i // COLS) * SH))
atlas.save(OUT + '/clouds.png', optimize=True)
json.dump({'w': SW, 'h': SH, 'n': N, 'cols': COLS}, open(OUT + '/clouds.json', 'w'))
print('облаков', N, os.path.getsize(OUT + '/clouds.png') // 1024, 'КБ')
