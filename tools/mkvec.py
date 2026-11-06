# Векторные границы: извлекаем все границы между провинциями (и берег) из карты провинций,
# сглаживаем и сохраняем как ломаные. Игра рисует их поверх карты — ровно при любом приближении.
# Выход: ../borders.js  (BORDERS = [[провА, провБ, x0,y0, dx1,dy1, ...], ...] — координаты ×2, затем сдвиги; -1 море, -2 незакрашенная суша)
import json, os, sys, glob
from collections import defaultdict
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
H, W = pl.shape
POL = sorted(glob.glob(SP + '../source/*political*.png'))[0]
P = np.asarray(Image.open(POL).convert('RGB')).astype(np.int32)
KK = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
sea = KK == 0x001F48
LINE = np.isin(KK, [0xDFDFDF, 0x262626, 0x000020, 0x404040, 0x8B5A2B, 0x4A2F1A, 0xFF00FF])   # только линии и игровые горы, не серый фон за краем зоны
# реки и прочие незакрашенные пиксели суши — к соседней провинции (чтобы не было «берегов» по рекам)
L = pl.copy()
lab0 = pl >= 0
def near(dy, dx):
    r = np.zeros_like(lab0)
    for d in range(1, 4): r |= np.roll(np.roll(lab0, dy * d, 0), dx * d, 1)
    return r
ENCL = (near(0, 1) & near(0, -1)) | (near(1, 0) & near(-1, 0))   # линия зажата провинциями с двух сторон
LINE &= ENCL
for _ in range(10):
    hole = (L < 0) & ~sea & LINE
    if not hole.any(): break
    for dy, dx in ((0, 1), (0, -1), (1, 0), (-1, 0)):
        nb = np.roll(np.roll(L, dy, 0), dx, 1)
        fill = hole & (nb >= 0) & (L < 0)
        L[fill] = nb[fill]
L[(L < 0) & ~sea] = -2
L[sea] = -1
# единичные рёбра между пикселями с разными метками
edges = defaultdict(list)   # вершина -> [(сосед, пара)]
def add(x0, y0, x1, y1, a, b):
    pr = (a, b) if a < b else (b, a)
    edges[(x0, y0)].append(((x1, y1), pr)); edges[(x1, y1)].append(((x0, y0), pr))
a = L[:, :-1]; b = L[:, 1:]; ys, xs = np.nonzero(a != b)
for y, x in zip(ys.tolist(), xs.tolist()):
    A, B = int(L[y, x]), int(L[y, x + 1])
    if A < 0 and B < 0: continue
    add(x + 1, y, x + 1, y + 1, A, B)
a = L[:-1, :]; b = L[1:, :]; ys, xs = np.nonzero(a != b)
for y, x in zip(ys.tolist(), xs.tolist()):
    A, B = int(L[y, x]), int(L[y + 1, x])
    if A < 0 and B < 0: continue
    add(x, y + 1, x + 1, y + 1, A, B)
print('edges', sum(len(v) for v in edges.values()) // 2)
# цепочки: идём от «узлов» (степень != 2 или смена пары) по вершинам степени 2 с той же парой
used = set()
def ekey(p, q): return (p, q) if p < q else (q, p)
def is_node(v):
    e = edges[v]
    return len(e) != 2 or e[0][1] != e[1][1]
chains = []
for v in list(edges.keys()):
    if not is_node(v): continue
    for (w, pr) in edges[v]:
        if ekey(v, w) in used: continue
        pts = [v]; cur, nxt = v, w; used.add(ekey(cur, nxt))
        while True:
            pts.append(nxt)
            if is_node(nxt): break
            cand = [(u, p2) for (u, p2) in edges[nxt] if ekey(nxt, u) not in used and p2 == pr]
            if not cand: break
            cur, nxt = nxt, cand[0][0]; used.add(ekey(cur, nxt))
        chains.append((pr, pts))
# замкнутые контуры без узлов (острова одной провинции и т.п.)
for v in list(edges.keys()):
    for (w, pr) in edges[v]:
        if ekey(v, w) in used: continue
        pts = [v]; cur, nxt = v, w; used.add(ekey(cur, nxt))
        while True:
            pts.append(nxt)
            cand = [(u, p2) for (u, p2) in edges[nxt] if ekey(nxt, u) not in used and p2 == pr]
            if not cand: break
            cur, nxt = nxt, cand[0][0]; used.add(ekey(cur, nxt))
        chains.append((pr, pts))
print('chains', len(chains))
# сглаживание: середины единичных рёбер (убирает «лесенку»), упрощение Дугласа–Пекера, один проход Чайкина
def dp(pts, eps):
    if len(pts) < 3: return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True; st = [(0, len(pts) - 1)]
    P_ = np.array(pts, float)
    while st:
        i, j = st.pop()
        if j <= i + 1: continue
        a_, b_ = P_[i], P_[j]; seg = P_[i + 1:j]
        d = b_ - a_; n = np.hypot(*d)
        rel = seg - a_
        dist = np.abs(d[0] * rel[:, 1] - d[1] * rel[:, 0]) / n if n > 0 else np.hypot(rel[:, 0], rel[:, 1])
        k = int(np.argmax(dist))
        if dist[k] > eps: m = i + 1 + k; keep[m] = True; st += [(i, m), (m, j)]
    return [p for p, kk in zip(pts, keep) if kk]
out = []; npts = 0
for (pa, pb), pts in chains:
    closed = pts[0] == pts[-1]
    mids = [((pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2) for i in range(len(pts) - 1)]
    if not closed: mids = [pts[0]] + mids + [pts[-1]]
    elif mids: mids = mids + [mids[0]]
    s = dp(mids, 0.7)
    if len(s) > 2:
        r = [s[0]]
        for i in range(len(s) - 1):
            p, q = s[i], s[i + 1]
            r += [(p[0] * .75 + q[0] * .25, p[1] * .75 + q[1] * .25), (p[0] * .25 + q[0] * .75, p[1] * .25 + q[1] * .75)]
        r.append(s[-1]); s = r
    flat = []; px = py = 0
    for x, y in s:   # координаты ×2, первая точка — абсолютно, дальше — сдвиги от предыдущей
        X, Y = round(x * 2), round(y * 2); flat += [X - px, Y - py]; px, py = X, Y
    out.append([pa, pb] + flat); npts += len(s)
js = 'const BORDERS = ' + json.dumps(out, separators=(',', ':')) + ';\n'
open(OUT + '/borders.js', 'w').write(js)
print('points', npts, 'borders.js', len(js) // 1024, 'KB')
