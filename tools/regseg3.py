# Разбор точных PNG автора: регионы (цвет) и провинции (светлые линии 223,223,223 внутри региона).
# Острова: мелкие острова одного региона — одна провинция (если между ними нет белой черточки),
#          крупный остров — отдельная провинция (и может делиться линиями дальше).
# Выход: umap/rl.npy (регион на пиксель), umap/pl.npy (провинция на пиксель), umap/regs.json, umap/provs.json, umap/meta.json
import json, glob, os
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
small_by_reg = {}
for root, ids in pieces.items():
    area = sum(comps[i]['n'] for i in ids); r = int(c2r[ids[0]])
    if area >= BIG_ISLAND:
        for i in ids:
            if comps[i]['n'] >= CRUMB:
                c2p[i] = len(provs); provs.append({'region': r, 'comps': [i]})
        # обрывки внутри большого куска — в ближайшую провинцию этого куска
        bigs = [i for i in ids if c2p[i] >= 0]
        if not bigs:
            c2p[ids[0]] = len(provs); provs.append({'region': r, 'comps': [ids[0]]}); bigs = [ids[0]]
        for i in ids:
            if c2p[i] < 0:
                j = min(bigs, key=lambda j: (comps[j]['cx'] - comps[i]['cx']) ** 2 + (comps[j]['cy'] - comps[i]['cy']) ** 2)
                c2p[i] = c2p[j]; provs[c2p[j]]['comps'].append(i)
    else:
        small_by_reg.setdefault(r, []).append(ids)
for r, plist in small_by_reg.items():
    d = DSU(len(plist))
    cent = []
    for ids in plist:
        n = sum(comps[i]['n'] for i in ids)
        cent.append({'cx': sum(comps[i]['cx'] * comps[i]['n'] for i in ids) / n, 'cy': sum(comps[i]['cy'] * comps[i]['n'] for i in ids) / n})
    for a in range(len(plist)):
        for b in range(a + 1, len(plist)):
            if ((cent[a]['cx'] - cent[b]['cx']) ** 2 + (cent[a]['cy'] - cent[b]['cy']) ** 2) ** 0.5 < ISL_GAP and not white_between(cent[a], cent[b]): d.u(a, b)
    grp = {}
    for a in range(len(plist)): grp.setdefault(d.f(a), []).extend(plist[a])
    for ids in grp.values():
        pid = len(provs); provs.append({'region': r, 'comps': ids})
        for i in ids: c2p[i] = pid
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
