# Разбор точных PNG автора: регионы (цвет) и провинции (светлые линии 223,223,223 внутри региона).
# Острова: мелкие острова одного региона — одна провинция (если между ними нет белой черточки),
#          крупный остров — отдельная провинция (и может делиться линиями дальше).
# Выход: umap/rl.npy (регион на пиксель), umap/pl.npy (провинция на пиксель), umap/regs.json, umap/provs.json, umap/meta.json
import json, glob, os, math
from collections import deque, Counter
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = SP + '../source/'
BIG_ISLAND = 850     # px исходника (~450 км²): остров крупнее — своя провинция (Самос, Хиос, Лесбос, Родос...)
CRUMB = 40           # кусок меньше — не провинция, а обрывок: отдаётся соседней провинции
ISL_GAP = 160        # мелкие острова ближе этого (px, ~100 км) объединяются в одну провинцию
def find(word): return sorted(glob.glob(SRC + '*' + word + '*.png'))[0]
G = np.asarray(Image.open(find('regions')).convert('RGB')).astype(np.int32)
H, W, _ = G.shape
kG = (G[..., 0] << 16) | (G[..., 1] << 8) | G[..., 2]
SEA, WATER, PLINE = 0x001F48, 0x000020, 0xDFDFDF
sat = G.max(2) - G.min(2)
fill = (sat > 10) & (kG != SEA) & (kG != WATER)
pline = kG == PLINE
# 1) одноцветные связные куски
lab = -np.ones((H, W), np.int32); comps = []
for y0, x0 in zip(*np.nonzero(fill)):
    if lab[y0, x0] >= 0: continue
    col = kG[y0, x0]; cid = len(comps); q = deque([(y0, x0)]); lab[y0, x0] = cid; n = 0; sx = sy = 0; bx0 = bx1 = x0; by0 = by1 = y0
    while q:
        y, x = q.popleft(); n += 1; sx += x; sy += y
        if x < bx0: bx0 = x
        if x > bx1: bx1 = x
        if y < by0: by0 = y
        if y > by1: by1 = y
        for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= Y < H and 0 <= X < W and lab[Y, X] < 0 and kG[Y, X] == col:
                lab[Y, X] = cid; q.append((Y, X))
    comps.append({'col': int(col), 'n': n, 'x0': bx0, 'x1': bx1, 'y0': by0, 'y1': by1, 'cx': sx / n, 'cy': sy / n})
N = len(comps)
class DSU:
    def __init__(s, n): s.p = list(range(n))
    def f(s, i):
        while s.p[i] != i: s.p[i] = s.p[s.p[i]]; i = s.p[i]
        return i
    def u(s, a, b): s.p[s.f(a)] = s.f(b)
# 2) регионы: одноцветные куски с рамками ближе 220 px
reg_d = DSU(N); bycol = {}
for i, c in enumerate(comps): bycol.setdefault(c['col'], []).append(i)
def gap(A, B):
    dx = max(0, max(A['x0'], B['x0']) - min(A['x1'], B['x1'])); dy = max(0, max(A['y0'], B['y0']) - min(A['y1'], B['y1']))
    return (dx * dx + dy * dy) ** 0.5
for ids in bycol.values():
    for a in ids:
        for b in ids:
            if a < b and gap(comps[a], comps[b]) < 220: reg_d.u(a, b)
# явные объединения регионов (merge.json): одноцветные куски у заданных точек — один регион
_fit = json.load(open(SP + 'umap/fit.json')); _k = W / _fit.get('W', 2000)
def _px(lon, lat): return int((lon - _fit['p'][0]) * _fit['p'][1] * _k), int((_fit['p'][2] - lat) * _fit['p'][3] * _k)
if os.path.exists(SP + 'merge.json'):
    for m in json.load(open(SP + 'merge.json')):
        cs = []
        for lon, lat in m['points']:
            x, y = _px(lon, lat); win = lab[max(0, y - 40):y + 41, max(0, x - 40):x + 41]; v = win[win >= 0]
            if len(v): cs.append(int(np.bincount(v).argmax()))
        for a2 in cs[1:]: reg_d.u(cs[0], a2)
groups = {}
for i in range(N): groups.setdefault(reg_d.f(i), []).append(i)
regs = []; c2r = -np.ones(N, np.int32)
for g, ids in groups.items():
    n = sum(comps[i]['n'] for i in ids)
    if n < 120: continue
    rid = len(regs)
    for i in ids: c2r[i] = rid
    regs.append({'id': rid, 'col': comps[ids[0]]['col'], 'n': n})
# 3) «соседство через линию»: куски одного региона в 2 px друг от друга (их разделяет только белая линия)
touch = DSU(N)
L = lab
for dy in range(-2, 3):
    for dx in range(-2, 3):
        if dx == 0 and dy == 0: continue
        a = L[max(0, dy):H + min(0, dy), max(0, dx):W + min(0, dx)]
        b = L[max(0, -dy):H + min(0, -dy), max(0, -dx):W + min(0, -dx)]
        m = (a >= 0) & (b >= 0) & (a != b)
        if not m.any(): continue
        pairs = np.unique(np.stack([a[m], b[m]], 1), axis=0)
        for p, q2 in pairs:
            if c2r[p] >= 0 and c2r[p] == c2r[q2]: touch.u(int(p), int(q2))
pieces = {}
for i in range(N):
    if c2r[i] >= 0: pieces.setdefault(touch.f(i), []).append(i)
# 4) провинции
c2p = -np.ones(N, np.int32); provs = []
def white_between(A, B):
    for t in np.linspace(0.1, 0.9, 30):
        x = int(A['cx'] + (B['cx'] - A['cx']) * t); y = int(A['cy'] + (B['cy'] - A['cy']) * t)
        if pline[max(0, y - 1):y + 2, max(0, x - 1):x + 2].any(): return True
    return False
# острова-провинции из списка автора (islands.json): координаты -> пиксели
fit = json.load(open(SP + 'umap/fit.json')); kf = W / fit.get('W', 2000)
l0, fsx, p0, fsy = fit['p'][0], fit['p'][1] * kf, fit['p'][2], fit['p'][3] * kf
ANCH = json.load(open(SP + 'islands.json')) if os.path.exists(SP + 'islands.json') else []
# каждая точка острова — ровно к одному, ближайшему куску суши
anchor_comp = {}
for an in ANCH:
    for lon_, lat_ in (an.get('points') or [[an['lon'], an['lat']]]):   # группа островов = несколько точек одной провинции
        ax, ay = int((lon_ - l0) * fsx), int((p0 - lat_) * fsy)
        y0, y1, x0, x1 = max(0, ay - 30), min(H, ay + 31), max(0, ax - 30), min(W, ax + 31)
        win = lab[y0:y1, x0:x1]; ys, xs = np.nonzero(win >= 0)
        if not len(ys): continue
        d = (ys + y0 - ay) ** 2 + (xs + x0 - ax) ** 2; j = int(np.argmin(d))
        anchor_comp[int(win[ys[j], xs[j]])] = an['name']
def piece_has_anchor(ids):
    for i in ids:
        if i in anchor_comp: return anchor_comp[i]
    return None
anchor_prov = {}
attach = []   # мелкие острова: присоединяются к ближайшей провинции своего региона
for root, ids in pieces.items():
    area = sum(comps[i]['n'] for i in ids); r = int(c2r[ids[0]])
    anc = piece_has_anchor(ids) if area < BIG_ISLAND else None
    if anc and area < BIG_ISLAND and (anc, r) in anchor_prov:      # ещё один остров той же группы (в том же регионе)
        for i in ids: c2p[i] = anchor_prov[(anc, r)]; provs[anchor_prov[(anc, r)]]['comps'].append(i)
        continue
    if area >= BIG_ISLAND or anc:
        made = []
        for i in ids:
            if comps[i]['n'] >= CRUMB or anc:
                if anc and made: c2p[i] = made[0]; provs[made[0]]['comps'].append(i); continue
                c2p[i] = len(provs); provs.append({'region': r, 'comps': [i], 'anchor': anc}); made.append(c2p[i])
                if anc: anchor_prov[(anc, r)] = c2p[i]
        if not made:
            c2p[ids[0]] = len(provs); provs.append({'region': r, 'comps': [ids[0]], 'anchor': anc}); made = [c2p[ids[0]]]
        for i in ids:
            if c2p[i] < 0:
                j = min(made, key=lambda j: min((comps[q]['cx'] - comps[i]['cx']) ** 2 + (comps[q]['cy'] - comps[i]['cy']) ** 2 for q in provs[j]['comps']))
                c2p[i] = j; provs[j]['comps'].append(i)
    else:
        attach.append((r, ids))
for r, ids in attach:
    cx = sum(comps[i]['cx'] * comps[i]['n'] for i in ids) / sum(comps[i]['n'] for i in ids)
    cy = sum(comps[i]['cy'] * comps[i]['n'] for i in ids) / sum(comps[i]['n'] for i in ids)
    cand = [j for j, p in enumerate(provs) if p['region'] == r]
    if not cand:
        j = len(provs); provs.append({'region': r, 'comps': []}); cand = [j]
    # ближайшая провинция региона — по расстоянию до её кусков (рамок)
    def dist(j):
        best = 1e18
        for q in provs[j]['comps']:
            c = comps[q]; dx = max(c['x0'] - cx, 0, cx - c['x1']); dy = max(c['y0'] - cy, 0, cy - c['y1']); best = min(best, dx * dx + dy * dy)
        return best
    j = min(cand, key=dist)
    for i in ids: c2p[i] = j
    provs[j]['comps'].extend(ids)
# ручные поправки (fixes.json): кусок в точке from отдаётся провинции, которой принадлежит точка to
def _comp_at(lon, lat):
    x, y = int((lon - l0) * fsx), int((p0 - lat) * fsy)
    win = lab[max(0, y - 6):y + 7, max(0, x - 6):x + 7]; v = win[win >= 0]
    return int(np.bincount(v).argmax()) if len(v) else None
if os.path.exists(SP + 'fixes.json'):
    for fx in json.load(open(SP + 'fixes.json')):
        a_, b_ = _comp_at(*fx['from']), _comp_at(*fx['to'])
        if a_ is not None and b_ is not None and c2p[b_] >= 0:
            old_p = c2p[a_]
            if old_p >= 0 and a_ in provs[old_p]['comps']: provs[old_p]['comps'].remove(a_)
            c2p[a_] = c2p[b_]; provs[c2p[b_]]['comps'].append(a_)
provs_keep = [i for i, p in enumerate(provs) if p['comps']]
if len(provs_keep) != len(provs):
    remap = -np.ones(len(provs), np.int32)
    for n_, i in enumerate(provs_keep): remap[i] = n_
    provs = [provs[i] for i in provs_keep]; c2p = np.where(c2p >= 0, remap[np.maximum(c2p, 0)], -1)
# метки на пиксель
rl = np.where(lab >= 0, c2r[np.maximum(lab, 0)], -1).astype(np.int32)
pl = np.where(lab >= 0, c2p[np.maximum(lab, 0)], -1).astype(np.int32)
# линии и подписи внутри зоны — ближайшей провинции (не дальше 6 px), но не серый фон
MOUNT = kG == 0xFFFFFF
np.save(SP + 'umap/mt.npy', MOUNT)
land = kG != SEA
dist = np.where(pl >= 0, 0, 99).astype(np.int32)
q = deque(zip(*np.nonzero(pl >= 0)))
while q:
    y, x = q.popleft(); dd = dist[y, x]
    if dd >= (14 if MOUNT[y, x] else 6): continue
    for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= Y < H and 0 <= X < W and land[Y, X] and pl[Y, X] < 0 and not fill[Y, X] and sat[Y, X] <= 10 and kG[Y, X] != 0x808080:
            pl[Y, X] = pl[y, x]; rl[Y, X] = rl[y, x]; dist[Y, X] = dd + 1; q.append((Y, X))
# сводка по провинциям
cnt = np.bincount(pl[pl >= 0], minlength=len(provs))
for i, p in enumerate(provs):
    ids = p['comps']; n = sum(comps[j]['n'] for j in ids)
    p['n'] = int(cnt[i]); p['cx'] = sum(comps[j]['cx'] * comps[j]['n'] for j in ids) / n; p['cy'] = sum(comps[j]['cy'] * comps[j]['n'] for j in ids) / n
    p['island'] = all(gap(comps[j], comps[j]) == 0 for j in ids) and len(ids) > 1
    del p['comps']
parts = Counter(p['region'] for p in provs)
for r in regs: r['parts'] = parts[r['id']]
np.save(SP + 'umap/rl.npy', rl.astype(np.int16)); np.save(SP + 'umap/pl.npy', pl.astype(np.int16))
json.dump(regs, open(SP + 'umap/regs.json', 'w')); json.dump(provs, open(SP + 'umap/provs.json', 'w'))
json.dump({'W0': W, 'H0': H}, open(SP + 'umap/meta.json', 'w'))
print('regions', len(regs), 'provinces', len(provs))
print('provinces per region', sorted(parts.values()))
