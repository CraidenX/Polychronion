# K2: реки — граф осевых линий с направлением течения и порядком Штралера.
# Вход: umap/rivers.npy (маска рек), umap/masks.npz (суша), terrain/height.png, umap/rivers_big.npy (основное русло больших рек, mkrivvec.py).
# Шаги: скелет → граф (узлы — концы и развилки, рёбра — цепочки пикселей) → удаление обрывков короче 5 px → достройка разрывов до 6 px
#       по направлению → сток (море; у замкнутых систем — самая низкая точка) → направление течения → порядок Штралера → ширина.
# Ширина — px экрана при 4×: малые 1,5–3 (растут с порядком), большие (по big_rivers.json) — 5–9, продолжение той же линии.
# Устья дотягиваются до воды. Выход: ../rivers.json {'edges': [{'p': [x0,y0,…] вниз по течению, 'o': порядок, 'b': 0/1, 'w': ширина}]},
#        umap/rivgraph.npy (uint8: 1 малая река, 2 большая) — для сетки передвижения и деревьев по берегам.
# Запуск после mkrivvec.py: python3 -I mkrivgraph.py ..
import os, sys, json, heapq
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
from skimage.morphology import skeletonize
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
m = np.load(SP + 'umap/masks.npz'); land = m['land']; H, W = land.shape
rv = np.load(SP + 'umap/rivers.npy') > 46
bigm = nd.binary_dilation(np.load(SP + 'umap/rivers_big.npy'), iterations=2)
hgt = nd.gaussian_filter(np.asarray(Image.open(SP + 'terrain/height.png')).astype(np.float32), 2)
sea = ~land
seaD = nd.distance_transform_edt(~sea)
sk = skeletonize(rv & land)
OFF = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
def deg_map(s):
    d = nd.convolve(s.astype(np.uint8), np.ones((3, 3), np.uint8), mode='constant') - 1; d[~s] = 0; return d
# ---------- граф из скелета ----------
def plen(p): return sum(np.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]) for i in range(len(p) - 1))
def graph(s):   # узлы — концы и развилки (соседние пиксели развилки — один узел), рёбра — цепочки пикселей между узлами
    dg = deg_map(s); node = s & (dg != 2)
    lab_, n_ = nd.label(node & (dg >= 3), structure=np.ones((3, 3)))
    nid = -np.ones((H, W), np.int32); nid[lab_ > 0] = lab_[lab_ > 0] - 1
    ey, ex = np.nonzero(node & (dg < 3)); nid[ey, ex] = n_ + np.arange(len(ey))
    nn = n_ + len(ey); sx_ = np.zeros(nn); sy_ = np.zeros(nn); cnt = np.zeros(nn)
    yy_, xx_ = np.nonzero(nid >= 0); np.add.at(sx_, nid[yy_, xx_], xx_); np.add.at(sy_, nid[yy_, xx_], yy_); np.add.at(cnt, nid[yy_, xx_], 1)
    nodes = [(int(round(sx_[k] / cnt[k])), int(round(sy_[k] / cnt[k]))) for k in range(nn)]
    seen = np.zeros((H, W), bool); edges = []
    for y0, x0 in zip(yy_, xx_):   # из каждого пикселя узла — в каждого соседа-«не узел»
        k = int(nid[y0, x0])
        for dy, dx in OFF:
            y, x = y0 + dy, x0 + dx
            if not (0 <= y < H and 0 <= x < W) or not s[y, x] or nid[y, x] >= 0 or seen[y, x]: continue
            pts = [(int(x0), int(y0))]; py, px = y0, x0; cy, cx = y, x; end = -1
            while True:
                seen[cy, cx] = True; pts.append((int(cx), int(cy))); nxt = None
                for ey2, ex2 in OFF:
                    qy, qx = cy + ey2, cx + ex2
                    if (qy, qx) == (py, px) or not (0 <= qy < H and 0 <= qx < W) or not s[qy, qx]: continue
                    if nid[qy, qx] >= 0 and not (nid[qy, qx] == k and len(pts) < 3): end = int(nid[qy, qx]); pts.append((int(qx), int(qy))); nxt = None; break
                    if nid[qy, qx] < 0 and not seen[qy, qx]: nxt = (qy, qx)
                if end >= 0 or nxt is None: break
                py, px = cy, cx; cy, cx = nxt
            if end < 0: nodes.append((int(cx), int(cy))); end = len(nodes) - 1
            if end == k and plen(pts) < 6: continue   # крошечная петля у развилки
            edges.append([k, end, pts])
    # соседние узлы без пикселей между ними — короткое ребро (один раз на пару)
    pairs = set()
    for y0, x0 in zip(yy_, xx_):
        for dy, dx in OFF:
            y, x = y0 + dy, x0 + dx
            if 0 <= y < H and 0 <= x < W and nid[y, x] >= 0 and nid[y, x] != nid[y0, x0]:
                pr = (min(int(nid[y, x]), int(nid[y0, x0])), max(int(nid[y, x]), int(nid[y0, x0])))
                if pr not in pairs: pairs.add(pr); edges.append([int(nid[y0, x0]), int(nid[y, x]), [(int(x0), int(y0)), (int(x), int(y))]])
    return nodes, edges
# ---------- обрывки короче 5 px (висячие рёбра), несколько проходов ----------
for it in range(4):
    nodes, edges = graph(sk)
    deg = np.zeros(len(nodes), int)
    for a, b, p in edges: deg[a] += 1; deg[b] += 1
    cut = 0
    for a, b, p in edges:
        if (deg[a] == 1) != (deg[b] == 1) and plen(p) < 5 and min(seaD[y, x] for x, y in p) > 3:   # висячий обрывок (не устье)
            tip = p if deg[b] == 1 else p[::-1]   # от узла к висячему концу
            for x, y in tip[1:]: sk[y, x] = False
            cut += 1
    if not cut: break
# ---------- достройка разрывов до 6 px по направлению ----------
nodes, edges = graph(sk)
deg = np.zeros(len(nodes), int)
for a, b, p in edges: deg[a] += 1; deg[b] += 1
lab, _ = nd.label(sk, structure=np.ones((3, 3)))
joins = 0; dr = Image.fromarray(sk.astype(np.uint8) * 255); dd = ImageDraw.Draw(dr)
sy, sx = np.nonzero(sk)
for a, b, p in edges:
    for end, pts in ((a, p), (b, p[::-1])):
        if deg[end] != 1: continue
        x, y = pts[0]; tail = pts[1:6] if len(pts) > 2 else pts[1:]
        if not tail or seaD[y, x] <= 3: continue
        tx, ty = x - np.mean([q[0] for q in tail]), y - np.mean([q[1] for q in tail]); L = np.hypot(tx, ty)
        if L < 0.5: continue
        tx, ty = tx / L, ty / L
        sel = (np.abs(sx - x) <= 6) & (np.abs(sy - y) <= 6)
        best = None
        for qx, qy in zip(sx[sel], sy[sel]):
            if lab[qy, qx] == lab[y, x]: continue
            vx, vy = qx - x, qy - y; d = np.hypot(vx, vy)
            if d < 1 or d > 6: continue
            if (vx * tx + vy * ty) / d < 0.6: continue   # по направлению (≤ ~53°)
            if best is None or d < best[0]: best = (d, qx, qy)
        if best: dd.line([(x, y), (best[1], best[2])], fill=255, width=1); joins += 1
sk = skeletonize(np.asarray(dr) > 0)
# ---------- устья: висячий конец у моря — дотянуть до воды ----------
nodes, edges = graph(sk)
deg = np.zeros(len(nodes), int)
for a, b, p in edges: deg[a] += 1; deg[b] += 1
_, (iy, ix) = nd.distance_transform_edt(~sea, return_indices=True)
mouth = set()
for k, (x, y) in enumerate(nodes):
    if deg[k] == 1 and seaD[y, x] <= 6: mouth.add(k)
# ---------- сток и направление: расстояние по графу до стока ----------
adj = [[] for _ in nodes]
for e, (a, b, p) in enumerate(edges): L = plen(p); adj[a].append((b, e, L)); adj[b].append((a, e, L))
dist = np.full(len(nodes), np.inf); comp = -np.ones(len(nodes), int); c = 0
for s0 in range(len(nodes)):   # компоненты связности графа
    if comp[s0] >= 0: continue
    st = [s0]; comp[s0] = c
    while st:
        u = st.pop()
        for v, e, L in adj[u]:
            if comp[v] < 0: comp[v] = c; st.append(v)
    c += 1
sinks = set(mouth)
for ci in range(c):
    mem = np.nonzero(comp == ci)[0]
    if not any(k in sinks for k in mem):   # нет выхода к морю — сток в самой низкой точке (озеро, впадение в большую реку)
        sinks.add(int(min(mem, key=lambda k: hgt[nodes[k][1], nodes[k][0]])))
pq = [(0.0, k) for k in sinks]
for d0, k in pq: dist[k] = 0
heapq.heapify(pq)
while pq:
    d0, u = heapq.heappop(pq)
    if d0 > dist[u]: continue
    for v, e, L in adj[u]:
        if d0 + L < dist[v]: dist[v] = d0 + L; heapq.heappush(pq, (d0 + L, v))
# ---------- порядок Штралера: от дальних узлов к стоку ----------
down = {}   # ребро → (верхний узел, нижний узел)
for e, (a, b, p) in enumerate(edges): down[e] = (a, b) if dist[a] >= dist[b] else (b, a)
inc = [[] for _ in nodes]
for e, (u, d) in down.items(): inc[d].append(e)
order = np.zeros(len(edges), int)
for u in sorted(range(len(nodes)), key=lambda k: -dist[k]):
    ins = [order[e] for e in inc[u]]
    o = 1 if not ins else (max(ins) + 1 if ins.count(max(ins)) >= 2 else max(ins))
    for v, e, L in adj[u]:
        if down[e][0] == u: order[e] = max(order[e], o)
def rdp(p, eps):
    if len(p) < 3: return p
    a, b = np.array(p[0], float), np.array(p[-1], float); ab = b - a; L = np.hypot(*ab) or 1
    d = [abs(ab[0] * (q[1] - a[1]) - ab[1] * (q[0] - a[0])) / L for q in p[1:-1]]; i = int(np.argmax(d)) + 1
    return rdp(p[:i + 1], eps)[:-1] + rdp(p[i:], eps) if d[i - 1] > eps else [p[0], p[-1]]
omax = max(1, int(order.max()))
out = []; ras = Image.new('L', (W, H), 0); dr2 = ImageDraw.Draw(ras)
for e, (a, b, p) in enumerate(edges):
    u, d = down[e]; pts = p if a == u else p[::-1]
    if plen(pts) < 1.5: continue
    big = np.mean([bigm[y, x] for x, y in pts]) > 0.5
    if d in mouth:   # устье — до ближайшей воды
        x, y = pts[-1]; pts = pts + [(int(ix[y, x]), int(iy[y, x]))]
    q = rdp([(x + 0.5, y + 0.5) for x, y in pts], 0.5)
    o = int(order[e])
    w = round(5 + 4 * min(1, (o - 1) / 4), 2) if big else round(1.5 + 1.5 * min(1, (o - 1) / max(1, min(omax, 5) - 1)), 2)
    out.append({'p': [round(float(v), 1) for pt in q for v in pt], 'o': o, 'b': int(big), 'w': w})
    dr2.line([(x + 0.5, y + 0.5) for x, y in pts], fill=2 if big else 1, width=2 if big else 1)
json.dump({'_': 'Реки (mkrivgraph.py): рёбра графа вниз по течению; o — порядок Штралера, b — большая река, w — ширина в px экрана при 4×', 'edges': out},
          open(OUT + '/rivers.json', 'w'), ensure_ascii=False, separators=(',', ':'))
np.save(SP + 'umap/rivgraph.npy', np.asarray(ras))
from collections import Counter
print('рёбер', len(out), 'узлов', len(nodes), 'компонент', c, 'устьев', len(mouth), 'достроено разрывов', joins, 'порядки', sorted(Counter(r['o'] for r in out).items()),
      'больших рёбер', sum(r['b'] for r in out), 'КБ', os.path.getsize(OUT + '/rivers.json') // 1024)
