# J5: малые реки — в линии (для отрисовки линией постоянной ширины вблизи и при запекании дальнего вида).
# Малые = все реки umap/rivers.npy, кроме коридора больших (big_rivers.json, как в mkgrid.py).
# Скелет маски → ломаные от концов и развилок → упрощение (Рамер — Дуглас — Пекер, 0,6 px).
# Запуск после mkrivers: python3 -I mkrivvec.py ..  →  ../rivers_small.json {'lines': [[x0,y0,x1,y1,…], …]} (px карты, 1 знак)
#                                                       umap/rivers_big.npy — маска больших рек (для mkwater.py / mkbake.py)
import os, sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from skimage.morphology import skeletonize
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
m = np.load(SP + 'umap/masks.npz'); land = m['land']; H, W = land.shape
rv = np.load(SP + 'umap/rivers.npy') > 46
FIT = json.load(open(SP + 'umap/fit.json')); KF = W / FIT.get('W', 2000)
L0, SXF, P0, SYF = FIT['p'][0], FIT['p'][1] * KF, FIT['p'][2], FIT['p'][3] * KF
BR = json.load(open(SP + 'big_rivers.json')); lines = Image.new('L', (W, H), 0); dl = ImageDraw.Draw(lines)
for pts in BR['rivers'].values(): dl.line([((lo - L0) * SXF, (P0 - la) * SYF) for lo, la in pts], fill=255, width=2)
bigz = nd.distance_transform_edt(np.asarray(lines) == 0) <= BR['corridor']
# основное русло: для каждой большой реки — кратчайший путь по пикселям реки между концами ручной ломаной (притоки в коридоре в него не входят),
# затем — пиксели реки в пределах 3 px от этого пути
from skimage.graph import route_through_array
inc = rv & bigz; main = np.zeros((H, W), bool); BIGL = {}
def rdp_(p, eps):
    if len(p) < 3: return p
    a, b = np.array(p[0], float), np.array(p[-1], float); ab = b - a; L = np.hypot(*ab) or 1
    d = [abs(ab[0] * (q[1] - a[1]) - ab[1] * (q[0] - a[0])) / L for q in p[1:-1]]; i = int(np.argmax(d)) + 1
    return rdp_(p[:i + 1], eps)[:-1] + rdp_(p[i:], eps) if d[i - 1] > eps else [p[0], p[-1]]
for name, pts in BR['rivers'].items():
    P_ = [((lo - L0) * SXF, (P0 - la) * SYF) for lo, la in pts]
    xs = [p[0] for p in P_]; ys = [p[1] for p in P_]; M_ = BR['corridor'] + 40
    x0, x1 = max(0, int(min(xs)) - M_), min(W, int(max(xs)) + M_ + 1); y0, y1 = max(0, int(min(ys)) - M_), min(H, int(max(ys)) + M_ + 1)
    if x1 - x0 < 3 or y1 - y0 < 3: continue
    # по всем рекам в окне ±40 px вокруг ручной ломаной (река уходит от неё дальше коридора); суша — дорого, у ломаной чуть дешевле
    sub = rv[y0:y1, x0:x1]; dz = nd.distance_transform_edt(np.asarray(lines)[y0:y1, x0:x1] == 0)
    if not sub.any(): continue
    cost = np.where(sub, 1.0 + 0.02 * dz, 30.0 + 0.5 * dz)
    ry, rx = np.nonzero(sub)
    ry, rx = np.nonzero(sub & (dz <= BR['corridor']))
    if not len(ry): continue
    def snap(px, py): i = int(np.argmin((rx + x0 - px) ** 2 + (ry + y0 - py) ** 2)); return (int(ry[i]), int(rx[i]))
    a_, b_ = snap(*P_[0]), snap(*P_[-1])
    path, _ = route_through_array(cost, a_, b_, fully_connected=True, geometric=True)
    pm = np.zeros(sub.shape, bool); pm[tuple(np.array(path).T)] = True
    main[y0:y1, x0:x1] |= nd.binary_dilation(pm, iterations=3) & sub
    # линия русла: путь → упрощение → ширина (медиана 2 × расстояния до края реки вдоль пути + 1, не меньше 3 px)
    wd = {'Дунай': 4.5, 'Днестр': 3.5, 'Кура': 3.5}.get(name, 4.0)   # ширина ленты, px карты: в растре все реки ≈ 2 px — большие задаём явно, чтобы читались широкими
    q = rdp_([(x + x0 + 0.5, y + y0 + 0.5) for y, x in path], 0.8)
    BIGL[name] = {'w': round(wd, 1), 'pts': [round(float(v), 1) for pt in q for v in pt]}
# лента больших рек — растр по линиям (для сетки, плиток и мостов)
rib = Image.new('L', (W, H), 0); dr_ = ImageDraw.Draw(rib)
for b_ in BIGL.values(): dr_.line([(b_['pts'][i], b_['pts'][i + 1]) for i in range(0, len(b_['pts']), 2)], fill=255, width=max(1, int(round(b_['w']))), joint='curve')
big = np.asarray(rib) > 0; small = rv & ~nd.binary_dilation(big, iterations=1)
json.dump({'_': 'Большие реки (mkrivvec.py): основное русло — ломаная в px карты и ширина w (px карты)', 'rivers': BIGL}, open(OUT + '/rivers_big.json', 'w'), ensure_ascii=False, separators=(',', ':'))
np.save(SP + 'umap/rivers_big.npy', big)
sk = skeletonize(small)
nb = nd.convolve(sk.astype(np.uint8), np.ones((3, 3), np.uint8), mode='constant') - 1
nb[~sk] = 0
seen = np.zeros_like(sk)
OFF = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
def nbrs(y, x):
    for dy, dx in OFF:
        yy, xx = y + dy, x + dx
        if 0 <= yy < H and 0 <= xx < W and sk[yy, xx]: yield yy, xx
def trace(y, x):
    pts = [(x, y)]; seen[y, x] = True
    while True:
        nxt = [(yy, xx) for yy, xx in nbrs(y, x) if not seen[yy, xx]]
        if not nxt: break
        nxt.sort(key=lambda p: abs(p[0] - y) + abs(p[1] - x))   # сначала прямые соседи
        y, x = nxt[0]; seen[y, x] = True; pts.append((x, y))
        if nb[y, x] >= 3: break   # развилка — конец ломаной (от неё начнутся другие)
    return pts
def rdp(p, eps):
    if len(p) < 3: return p
    a, b = np.array(p[0], float), np.array(p[-1], float); ab = b - a; L = np.hypot(*ab) or 1
    d = [abs(ab[0] * (q[1] - a[1]) - ab[1] * (q[0] - a[0])) / L for q in p[1:-1]]; i = int(np.argmax(d)) + 1
    return rdp(p[:i + 1], eps)[:-1] + rdp(p[i:], eps) if d[i - 1] > eps else [p[0], p[-1]]
out = []
starts = list(zip(*np.nonzero(sk & ((nb == 1) | (nb >= 3)))))
for y, x in starts:
    for yy, xx in list(nbrs(y, x)):
        if seen[yy, xx] and nb[y, x] < 3: continue
        if not seen[y, x] or nb[y, x] >= 3:
            seen[y, x] = True
            if seen[yy, xx]: continue
            p = [(x, y)] + trace(yy, xx)
            if len(p) >= 3: out.append(p)
for y, x in zip(*np.nonzero(sk & ~seen)):   # оставшиеся петли
    if seen[y, x]: continue
    p = trace(y, x)
    if len(p) >= 4: out.append(p)
res = []
for p in out:
    q = rdp(p, 0.6)
    if len(q) >= 2 and sum(np.hypot(q[i + 1][0] - q[i][0], q[i + 1][1] - q[i][1]) for i in range(len(q) - 1)) >= 4:
        res.append([round(float(v) + 0.5, 1) for pt in q for v in pt])   # центр пикселя
json.dump({'_': 'Малые реки (mkrivvec.py): ломаные в px карты [x0,y0,x1,y1,…]', 'lines': res}, open(OUT + '/rivers_small.json', 'w'), separators=(',', ':'))
print('малых рек: ломаных', len(res), 'точек', sum(len(r) // 2 for r in res), 'пикселей скелета', int(sk.sum()), 'больших рек px', int(big.sum()),
      'КБ', os.path.getsize(OUT + '/rivers_small.json') // 1024)
