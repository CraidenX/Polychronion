import json, math, heapq, sys
import numpy as np
from PIL import Image, ImageFilter
SP = __import__('os').path.dirname(__import__('os').path.abspath(__file__)) + '/'
OUT = sys.argv[1]
fit = json.load(open(SP + 'umap/fit.json'))
l0, sx, p0, sy = fit['p']
SC = 2  # увеличение
src = Image.open(SP + 'umap/src.webp').convert('RGB')
a = np.asarray(src).astype(int)
NAVY = np.array([1, 31, 73])
dn = np.abs(a - NAVY).sum(axis=2)
sat = a.max(axis=2) - a.min(axis=2)
L = (a * np.array([0.3, 0.59, 0.11])).sum(axis=2)
Limg = Image.fromarray(np.clip(L, 0, 255).astype(np.uint8))
Lmed = np.asarray(Limg.filter(ImageFilter.MedianFilter(9))).astype(float)
satmed = np.asarray(Image.fromarray(sat.astype(np.uint8)).filter(ImageFilter.MedianFilter(9))).astype(float)
colored = (dn > 70) & ((satmed > 7) | (Lmed > 172) | ((Lmed < 110) & (Lmed > 80))) & ~((sat < 25) & (L < 100))
dev = L - Lmed
g = np.where(dev > 14, np.clip(128 + dev * 1.1, 128, 215), 128)
out = a.copy()
out[colored] = np.stack([g, g, g], axis=-1)[colored].astype(int)
o_sat = out.max(axis=2) - out.min(axis=2); o_dn = np.abs(out - NAVY).sum(axis=2)
left = (o_sat > 18) & (o_dn > 70) & (dn > 70)
Lo = (out * np.array([0.3, 0.59, 0.11])).sum(axis=2)
out[left] = np.stack([Lo, Lo, Lo], axis=-1)[left].astype(int)
outimg = Image.fromarray(out.astype(np.uint8))
W, H = src.size[0] * SC, src.size[1] * SC
big = outimg.resize((W, H), Image.LANCZOS)
big.quantize(colors=96, method=Image.MEDIANCUT, dither=Image.NONE).save(OUT + '/map.png', optimize=True)

def P(lon, lat): return ((lon - l0) * sx * SC, (p0 - lat) * sy * SC)
# маска суши (по исходной карте: всё, что не море)
landmask = Image.fromarray(((dn > 45).astype(np.uint8) * 255))
regs = json.load(open(SP + 'regions.json'))
C = 6
GW, GH = W // C + 1, H // C + 1
small = landmask.resize((GW, GH), Image.BILINEAR)
sm = np.asarray(small)
isl = sm > 110
own = -np.ones((GH, GW), int); best = np.full((GH, GW), 1e18); done = np.zeros((GH, GW), bool)
pq = []; cap = 151.0  # px: 175 в старой карте (118 px/°) × 102/118
seeds = []
for i, e in enumerate(regs):
    seeds.append((i, e[2], e[3]))
    for q in (e[5] if len(e) > 5 else []): seeds.append((i, q[0], q[1]))
for i, lon, lat in seeds:
    x, y = P(lon, lat); gx, gy = int(x / C), int(y / C)
    if not isl[gy, gx]:
        cand = [(dx * dx + dy * dy, gx + dx, gy + dy) for dy in range(-8, 9) for dx in range(-8, 9) if 0 <= gx + dx < GW and 0 <= gy + dy < GH and isl[gy + dy, gx + dx]]
        cand.sort(); print('moved seed', regs[i][0], cand[0] if cand else None); gx, gy = cand[0][1], cand[0][2]
    heapq.heappush(pq, (0.0, i, gx, gy, 0.0))
while pq:
    pr, i, x, y, raw = heapq.heappop(pq)
    if done[y, x]: continue
    done[y, x] = True; own[y, x] = i
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
        X, Y = x + dx, y + dy
        if 0 <= X < GW and 0 <= Y < GH and not done[Y, X] and isl[Y, X]:
            nr = raw + math.hypot(dx, dy) * C
            npr = nr / regs[i][4]
            if npr > cap: continue
            if npr < best[Y, X]: best[Y, X] = npr; heapq.heappush(pq, (npr, i, X, Y, nr))
alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
flat = ''.join(alpha[v] if v >= 0 else '.' for v in own.flatten())
outr = []; i = 0
while i < len(flat):
    j = i
    while j < len(flat) and flat[j] == flat[i]: j += 1
    n = j - i; outr.append((str(n) if n > 1 else '') + flat[i]); i = j
xs = [P(r[2], r[3])[0] for r in regs]; ys = [P(r[2], r[3])[1] for r in regs]
info = {'W': W, 'H': H, 'C': C, 'GW': GW, 'GH': GH, 'rle': ''.join(outr),
        'pos': {r[0]: [round(P(r[2], r[3])[0]), round(P(r[2], r[3])[1])] for r in regs},
        'focus': [round(min(xs) - 80), round(min(ys) - 80), round(max(xs) + 80), round(max(ys) + 80)],
        'ids': [r[0] for r in regs], 'proj': [l0, sx * SC, p0, sy * SC]}
json.dump(info, open(SP + 'mapinfo2.json', 'w'), ensure_ascii=False)
print(W, H, len(info['rle']))
# превью с областями
prev = big.copy().convert('RGB'); pa = np.asarray(prev).copy()
rng = np.random.default_rng(3); cols = rng.integers(0, 255, (len(regs), 3))
for y in range(GH):
    for x in range(GW):
        v = own[y, x]
        if v >= 0: pa[y * C:(y + 1) * C, x * C:(x + 1) * C] = (pa[y * C:(y + 1) * C, x * C:(x + 1) * C] * 0.55 + cols[v] * 0.45).astype(np.uint8)
Image.fromarray(pa).crop((int(min(xs)) - 150, int(min(ys)) - 150, int(max(xs)) + 150, int(max(ys)) + 150)).resize((1200, 620)).save(SP + 'umap/prev.png')
Image.fromarray(np.asarray(outimg)).save(SP + 'umap/processed_small.png')
