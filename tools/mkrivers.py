# Реки: линии из Natural Earth (rivers.json — вырезка ne_10m_rivers_lake_centerlines и ne_10m_rivers_europe,
# общественное достояние, naturalearthdata.com) в проекции карты автора (umap/fit.json), затем — «гидрография»:
#   1) реки, повторяющие воду автора (Дунай, Нил, Тигр, Евфрат…), убираются целиком;
#   2) там, где река подходит к воде автора, она обрезается и устье дотягивается до ближайшей воды;
#   3) концы рек, оказавшиеся рядом с другой рекой, присоединяются к ней (приток);
#   4) остаются только реки, которые по цепочке притоков доходят до воды (моря, озера, реки автора) или до края карты.
# Выход: umap/rivers.npy — маска 0..255 (полная карта) для mkmap3.py и ids.png.
import json, os, glob, math
import numpy as np
from PIL import Image, ImageDraw
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
fit = json.load(open(SP + 'umap/fit.json'))
P = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*political*.png'))[0]).convert('RGB')).astype(np.int32)
kP = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
H, W = kP.shape
k = W / fit.get('W', 2000); l0, sx, p0, sy = fit['p'][0], fit['p'][1] * k, fit['p'][2], fit['p'][3] * k
water = np.isin(kP, [0x001F48, 0x000020])
wd, (wy, wx) = nd.distance_transform_edt(~water, return_indices=True)
def wdist(x, y):
    xi, yi = min(W - 1, max(0, int(round(x)))), min(H - 1, max(0, int(round(y))))
    return wd[yi, xi], (wx[yi, xi], wy[yi, xi])
def width(r):
    r = 12 if r is None else r
    return 2.4 if r <= 3 else 2.0 if r <= 6 else 1.6 if r <= 9 else 1.3 if r <= 10 else 1.1
NEAR, MOUTH, JOIN = 9, 28, 10          # px: «у воды», как далеко дотягивать устье, как далеко искать реку-приёмник
runs = []                               # [точки, толщина, бледная, связана_с_водой]
dropped_dup = 0
for rv in json.load(open(SP + 'rivers.json')):
    if rv['f'] == 'Lake Centerline': continue
    pts = [((x - l0) * sx, (p0 - y) * sy) for x, y in rv['c']]
    if len(pts) < 2: continue
    # плотнее точки (не реже 3 px), чтобы резать точно
    dense = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(b[0] - a[0], b[1] - a[1]) / 3))
        dense += [(a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n) for t in range(1, n + 1)]
    near = [wdist(x, y)[0] < NEAR for x, y in dense]
    if sum(near) > 0.5 * len(dense): dropped_dup += 1; continue     # дубль реки автора
    w = width(rv['r']); faint = rv['f'] == 'Intermittent River'
    cur = []
    for i, (p, nr) in enumerate(zip(dense, near)):
        if not nr: cur.append(p); continue
        if len(cur) >= 3: runs.append([cur, w, faint, False, True]); cur = []   # прервана водой: устье -> к воде
        else: cur = []
    if len(cur) >= 3: runs.append([cur, w, faint, False, False])
# устья: конец рядом с водой — дотягиваем до воды
def edge(p): return p[0] < 4 or p[1] < 4 or p[0] > W - 5 or p[1] > H - 5
for r in runs:
    pts = r[0]
    for end in (0, -1):
        p = pts[end]; d, (qx, qy) = wdist(*p)
        if d < MOUTH or (end == -1 and r[4]) or edge(p):
            if not edge(p) and d < MOUTH * 1.5: (pts.insert(0, (qx, qy)) if end == 0 else pts.append((qx, qy)))
            r[3] = True
# притоки: конец рядом с другой рекой — присоединяем
idm = np.full((H, W), -1, np.int32)
for i, r in enumerate(runs):
    for x, y in r[0]:
        xi, yi = int(round(x)), int(round(y))
        if 0 <= xi < W and 0 <= yi < H: idm[max(0, yi - 1):yi + 2, max(0, xi - 1):xi + 2] = i
adj = [set() for _ in runs]
for i, r in enumerate(runs):
    for end in (0, -1):
        x, y = r[0][end]; xi, yi = int(round(x)), int(round(y))
        y0, y1, x0, x1 = max(0, yi - JOIN), min(H, yi + JOIN + 1), max(0, xi - JOIN), min(W, xi + JOIN + 1)
        win = idm[y0:y1, x0:x1]
        ys, xs = np.nonzero((win >= 0) & (win != i))
        if not len(ys): continue
        j = np.argmin((ys + y0 - yi) ** 2 + (xs + x0 - xi) ** 2); o = int(win[ys[j], xs[j]])
        adj[i].add(o); adj[o].add(i)
        q = (float(xs[j] + x0), float(ys[j] + y0))
        if end == 0: r[0].insert(0, q)
        else: r[0].append(q)
# только связанные с водой (через цепочку притоков)
ok = [r[3] for r in runs]; stack = [i for i, v in enumerate(ok) if v]
while stack:
    i = stack.pop()
    for j in adj[i]:
        if not ok[j]: ok[j] = True; stack.append(j)
S = 3
img = Image.new('L', (W * S, H * S), 0); d = ImageDraw.Draw(img)
kept = 0
for r, good in zip(runs, ok):
    if not good: continue
    kept += 1
    d.line([(x * S, y * S) for x, y in r[0]], fill=150 if r[2] else 255, width=max(1, round(r[1] * S)), joint='curve')
m = np.asarray(img.resize((W, H), Image.BOX)).astype(np.float32)   # BOX: чёткий край без размытия
m = np.clip((m - 25) * 1.25, 0, 255).astype(np.uint8)              # подтянуть контраст края
m[water] = 0
np.save(SP + 'umap/rivers.npy', m)
print('кусков рек', len(runs), 'оставлено', kept, 'убрано оторванных', len(runs) - kept, 'дублей реки автора', dropped_dup, 'пикселей', int((m > 60).sum()))
