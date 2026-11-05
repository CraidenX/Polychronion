# Разбор PNG-карт автора с точными цветами (без шума сжатия).
#   source/*regions.png  — каждый регион залит своим цветом; светлые линии (223,223,223) — границы провинций
#   source/*political.png — державы 1261 года
# Выход: umap/rl.npy (метка региона на каждый пиксель), umap/regs.json, umap/meta.json
import json, glob, os
from collections import deque, Counter
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = SP + '../source/'
def find(word): return sorted(glob.glob(SRC + '*' + word + '*.png'))[0]
G = np.asarray(Image.open(find('regions')).convert('RGB')).astype(np.int32)
H, W, _ = G.shape
key = lambda A: (A[..., 0] << 16) | (A[..., 1] << 8) | A[..., 2]
def c(r, g, b): return (r << 16) | (g << 8) | b
kG = key(G)
SEA, WATER, PLINE = c(0, 31, 72), c(0, 0, 32), c(223, 223, 223)
sat = G.max(2) - G.min(2)
fill = (sat > 10) & (kG != SEA) & (kG != WATER)
# 1) связные куски одного цвета
lab = -np.ones((H, W), np.int32); comps = []
for y0, x0 in zip(*np.nonzero(fill)):
    if lab[y0, x0] >= 0: continue
    col = kG[y0, x0]; cid = len(comps); q = deque([(y0, x0)]); lab[y0, x0] = cid; n = 0; xs = []; ys = []
    while q:
        y, x = q.popleft(); n += 1; xs.append(x); ys.append(y)
        for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= Y < H and 0 <= X < W and lab[Y, X] < 0 and kG[Y, X] == col:
                lab[Y, X] = cid; q.append((Y, X))
    comps.append({'col': int(col), 'n': n, 'x0': min(xs), 'x1': max(xs), 'y0': min(ys), 'y1': max(ys), 'cx': float(np.mean(xs)), 'cy': float(np.mean(ys))})
# 2) куски одного цвета, разделённые только линиями провинций/горами, — один регион:
#    объединяем одноцветные куски, если их рамки ближе 220 px (острова и части одного региона)
parent = list(range(len(comps)))
def fnd(i):
    while parent[i] != i: parent[i] = parent[parent[i]]; i = parent[i]
    return i
bycol = {}
for i, cm in enumerate(comps): bycol.setdefault(cm['col'], []).append(i)
for col, ids in bycol.items():
    for a in ids:
        for b in ids:
            if a < b:
                A, B = comps[a], comps[b]
                dx = max(0, max(A['x0'], B['x0']) - min(A['x1'], B['x1'])); dy = max(0, max(A['y0'], B['y0']) - min(A['y1'], B['y1']))
                if dx * dx + dy * dy < 220 ** 2: parent[fnd(a)] = fnd(b)
groups = {}
for i in range(len(comps)): groups.setdefault(fnd(i), []).append(i)
reg = []; comp2reg = -np.ones(len(comps), np.int32)
for g, ids in groups.items():
    n = sum(comps[i]['n'] for i in ids)
    if n < 120: continue
    rid = len(reg)
    for i in ids: comp2reg[i] = rid
    reg.append({'id': rid, 'col': comps[ids[0]]['col'], 'n': n, 'pieces': len([i for i in ids if comps[i]['n'] >= 30])})
rl = np.where(lab >= 0, comp2reg[np.maximum(lab, 0)], -1).astype(np.int32)
# 3) части (провинции): куски одного региона, разделённые светлыми линиями; мелочь (<40 px) не считаем
parts = Counter()
for i, cm in enumerate(comps):
    r = comp2reg[i]
    if r >= 0 and cm['n'] >= 40: parts[r] += 1
# 4) линии, горы и подписи внутри закрашенной зоны отдаём ближайшему региону (не дальше 6 px)
land = (kG != SEA)
dist = np.where(rl >= 0, 0, 99).astype(np.int32)
q = deque(zip(*np.nonzero(rl >= 0)))
while q:
    y, x = q.popleft(); d = dist[y, x]
    if d >= 6: continue
    for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= Y < H and 0 <= X < W and land[Y, X] and rl[Y, X] < 0 and not fill[Y, X] and sat[Y, X] <= 10 and kG[Y, X] != c(128, 128, 128):
            rl[Y, X] = rl[y, x]; dist[Y, X] = d + 1; q.append((Y, X))
for r in reg:
    r['parts'] = max(1, parts[r['id']])
np.save(SP + 'umap/rl.npy', rl.astype(np.int16))
json.dump(reg, open(SP + 'umap/regs.json', 'w'))
json.dump({'W0': W, 'H0': H}, open(SP + 'umap/meta.json', 'w'))
print('regions', len(reg), 'parts', sum(r['parts'] for r in reg), 'colours', len(bycol))
print('parts per region', sorted(r['parts'] for r in reg))
