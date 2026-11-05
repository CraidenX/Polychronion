import json, math, sys
import numpy as np
from PIL import Image, ImageDraw
SP = __import__('os').path.dirname(__import__('os').path.abspath(__file__)) + '/'
im = Image.open(SP + 'umap/src.webp').convert('RGB')
W, H = im.size
F = 4
a = np.asarray(im.resize((W // F, H // F), Image.NEAREST)).astype(int)
sea = (np.abs(a - np.array([1, 31, 73])).sum(axis=2) < 40)
user_land = ~sea
w, h = W // F, H // F
land = json.load(open(SP + 'ne/ne_50m_land.geojson'))
polys = []
for f in land['features']:
    g = f['geometry']; cs = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
    for p in cs:
        ring = p[0]
        if any(0 < x < 70 and 15 < y < 60 for x, y in ring[::max(1, len(ring) // 40)]):
            polys.append([(x, y) for x, y in ring if -5 < x < 75 and 10 < y < 65] if False else ring)
def merc(lat): return math.degrees(math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)))
def proj(kind, p, lon, lat):
    l0, sx, p0, sy = p
    yy = merc(lat) if kind == 'merc' else lat
    return ((lon - l0) * sx, (p0 - yy) * sy)
def render(kind, p):
    m = Image.new('1', (w, h), 0); d = ImageDraw.Draw(m)
    for ring in polys:
        d.polygon([(x / F, y / F) for x, y in (proj(kind, p, lo, la) for lo, la in ring)], fill=1)
    return np.asarray(m, dtype=bool)
def score(kind, p):
    r = render(kind, p)
    return (r == user_land).mean()
best = {}
for kind in ['eq', 'merc']:
    # стартовое приближение: Крит (24.9,35.25)->(690,672), Кипр (33.2,35.05)->(1115,680)
    sx = 51.2; l0 = 24.9 - 690 / sx
    yc = merc(35.25) if kind == 'merc' else 35.25
    sy = 52.0 if kind == 'eq' else 52.0 / 1.25
    p0 = yc + 672 / sy
    p = [l0, sx, p0, sy]
    s = score(kind, p)
    steps = [1.0, 2.0, 1.0, 2.0]
    for it in range(60):
        improved = False
        for i in range(4):
            for sg in (1, -1):
                q = p[:]; q[i] += sg * steps[i]
                sq = score(kind, q)
                if sq > s: s, p, improved = sq, q, True
        if not improved:
            steps = [x / 2 for x in steps]
            if max(steps) < 0.01: break
    best[kind] = (s, p); print(kind, round(s, 4), [round(x, 4) for x in p], flush=True)
kind = max(best, key=lambda k: best[k][0])
json.dump({'kind': kind, 'p': best[kind][1], 'score': best[kind][0], 'W': W, 'H': H}, open(SP + 'umap/fit.json', 'w'))
r = render(kind, best[kind][1])
vis = np.zeros((h, w, 3), np.uint8); vis[user_land & r] = (200, 200, 200); vis[user_land & ~r] = (255, 0, 0); vis[~user_land & r] = (0, 255, 0)
Image.fromarray(vis).save(SP + 'umap/fitvis.png'); print('best', kind)
