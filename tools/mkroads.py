# Дороги: для каждого ребра графа провинций (umap/padj.json) — путь по местности (A* по сетке C×C пикселей).
#   суша/перевал: только по клеткам двух провинций, хребет непроходим (кроме клеток перевала для ребра-перевала);
#   пролив/море: по морю, на суше — только клетки самих провинций (порт отправления и прибытия).
# Выход: ../roads.js — ROADS[i] = [x0,y0, dx1,dy1, ...] (пиксели карты ×1, сдвигами) в порядке MAPINFO.padj
import json, os, sys, glob, heapq, math
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
C = 3
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
G = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*regions*.png'))[0]).convert('RGB')).astype(np.int32)
kG = (G[..., 0] << 16) | (G[..., 1] << 8) | G[..., 2]
P = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*political*.png'))[0]).convert('RGB')).astype(np.int32)
kP = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
H, W = pl.shape; GH, GW = H // C, W // C
def pool(m, how):
    v = m[:GH * C, :GW * C].reshape(GH, C, GW, C)
    return v.any(axis=(1, 3)) if how == 'any' else v.all(axis=(1, 3))
mtn = pool(np.isin(kG, [0x8B5A2B, 0x4A2F1A, 0x5E5E5E]), 'any')
import scipy.ndimage as nd
pas = nd.binary_dilation(pool(kG == 0xFF00FF, 'any'), iterations=1)   # штрихи пунктира склеиваются
water = pool(np.isin(kP, [0x001F48, 0x000020]), 'any')
sea = water & ~mtn   # море, озёра и реки — по ним можно плыть
cpl = pl[C // 2::C, C // 2::C][:GH, :GW]
mi = json.load(open(SP + 'mapinfo3.json')); provs = mi['provs']; edges = mi['padj']
def snap(k, allowed):
    x, y = provs[k][1] // C, provs[k][2] // C
    for r in range(0, 40):
        y0, y1, x0, x1 = max(0, y - r), min(GH, y + r + 1), max(0, x - r), min(GW, x + r + 1)
        m = allowed[y0:y1, x0:x1]
        if m.any():
            ys, xs = np.nonzero(m); i = np.argmin((ys + y0 - y) ** 2 + (xs + x0 - x) ** 2)
            return int(xs[i] + x0), int(ys[i] + y0)
    return None
SQ2 = math.sqrt(2)
def astar(ok, s, t):
    (sx, sy), (tx, ty) = s, t
    h0 = lambda x, y: math.hypot(x - tx, y - ty)
    best = {s: 0.0}; prev = {}; q = [(h0(sx, sy), 0.0, sx, sy)]
    while q:
        f, g, x, y = heapq.heappop(q)
        if (x, y) == (tx, ty): break
        if g > best.get((x, y), 1e18): continue
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            X, Y = x + dx, y + dy
            if X < 0 or Y < 0 or Y >= ok.shape[0] or X >= ok.shape[1] or not ok[Y, X]: continue
            if dx and dy and not (ok[y, X] or ok[Y, x]): continue
            ng = g + (SQ2 if dx and dy else 1.0)
            if ng < best.get((X, Y), 1e18): best[(X, Y)] = ng; prev[(X, Y)] = (x, y); heapq.heappush(q, (ng + h0(X, Y), ng, X, Y))
    if (tx, ty) not in prev and s != t: return None
    path = [(tx, ty)]
    while path[-1] != s: path.append(prev[path[-1]])
    return path[::-1]
def rdp(pts, eps):
    if len(pts) < 3: return pts
    (x0, y0), (x1, y1) = pts[0], pts[-1]; L = math.hypot(x1 - x0, y1 - y0) or 1
    dmax, idx = -1, 0
    for i in range(1, len(pts) - 1):
        d = abs((x1 - x0) * (y0 - pts[i][1]) - (x0 - pts[i][0]) * (y1 - y0)) / L
        if d > dmax: dmax, idx = d, i
    if dmax <= eps: return [pts[0], pts[-1]]
    return rdp(pts[:idx + 1], eps)[:-1] + rdp(pts[idx:], eps)
roads, fails = [], 0
FAIL = []; DROP = []; LOOSE = []
for n, (a, b, t) in enumerate(edges):
    ax, ay, bx, by = provs[a][1] // C, provs[a][2] // C, provs[b][1] // C, provs[b][2] // C
    M = 60 if t in ('land', 'pass') else 160
    x0, x1, y0, y1 = max(0, min(ax, bx) - M), min(GW, max(ax, bx) + M + 1), max(0, min(ay, by) - M), min(GH, max(ay, by) + M + 1)
    P2 = cpl[y0:y1, x0:x1]; mine = nd.binary_dilation((P2 == a) | (P2 == b), iterations=2)   # +2 клетки: реки и изгибы берега переходим вброд
    if t == 'land': ok = mine & ~mtn[y0:y1, x0:x1]
    elif t == 'pass': ok = (mine & ~mtn[y0:y1, x0:x1]) | pas[y0:y1, x0:x1]
    else: ok = sea[y0:y1, x0:x1] | (mine & ~mtn[y0:y1, x0:x1])
    okfull = np.zeros((GH, GW), bool); okfull[y0:y1, x0:x1] = ok
    s = snap(a, okfull & (cpl == a)); e = snap(b, okfull & (cpl == b))
    path = None
    if s and e:
        path = astar(ok, (s[0] - x0, s[1] - y0), (e[0] - x0, e[1] - y0))
        if path is None and t in ('sea', 'strait'):   # огибаем полуострова: поиск по всей карте
            okw = sea | (nd.binary_dilation((cpl == a) | (cpl == b), iterations=2) & ~mtn)
            p2 = astar(okw, s, e)
            if p2: path = p2; x0 = y0 = 0
        if path is None and t == 'land':   # обход через соседние земли (без хребтов)
            ok2 = (cpl[y0:y1, x0:x1] >= 0) & ~mtn[y0:y1, x0:x1]; path = astar(ok2, (s[0] - x0, s[1] - y0), (e[0] - x0, e[1] - y0))
    if path is None and s and e and t in ('land', 'pass'):   # переправа к острову или проход через горы в обход правил — последний шанс
        okw = sea | (cpl >= 0)
        p2 = astar(okw, s, e)
        if p2: path = p2; x0 = y0 = 0; LOOSE.append((t, provs[a][4], provs[b][4]))
    if path is None and t in ('sea', 'strait'):
        DROP.append(n); roads.append(None); FAIL.append((t + ' (убрана)', provs[a][4], provs[b][4], True, True)); continue
    if path is None:
        fails += 1; FAIL.append((t, provs[a][4], provs[b][4], bool(s), bool(e))); pts = [(provs[a][1], provs[a][2]), (provs[b][1], provs[b][2])]
    else:
        pts = [(provs[a][1], provs[a][2])] + [((x + x0) * C + C // 2, (y + y0) * C + C // 2) for x, y in path] + [(provs[b][1], provs[b][2])]
        pts = rdp(pts, 1.6)
    flat = [pts[0][0], pts[0][1]]
    for i in range(1, len(pts)): flat += [pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]
    roads.append(flat)
    if n % 500 == 0: print(n, '/', len(edges), flush=True)
# морские связи, для которых нет пути по воде, — ошибка разметки: убираем из графа
if DROP:
    keep = [i for i in range(len(edges)) if i not in set(DROP)]
    mi['padj'] = [edges[i] for i in keep]; roads = [roads[i] for i in keep]
    json.dump(mi, open(SP + 'mapinfo3.json', 'w'), ensure_ascii=False)
js = 'const ROADS = ' + json.dumps(roads, separators=(',', ':')) + ';\n'
open(OUT + '/roads.js', 'w').write(js)
from collections import Counter
print(Counter(f[0] for f in FAIL), Counter((f[3], f[4]) for f in FAIL)); print(FAIL[:12])
print('через горы/воду в обход правил:', LOOSE)
print('дорог', len(roads), 'без пути по местности', fails, 'roads.js', len(js) // 1024, 'КБ')
