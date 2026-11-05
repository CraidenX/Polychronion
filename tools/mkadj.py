# Сухопутные связи между регионами с учётом гор (белые хребты на карте регионов).
# Для каждой пары регионов считаем «открытые» касания (рядом, без гор между ними)
# и «закрытые» (между ними только хребет). Итог:
#   нет открытых касаний            -> пути нет (горная стена)
#   открытых мало, закрытых много   -> перевал (армия задерживается на сезон)
#   иначе                           -> обычная сухопутная связь
import json, os
from collections import Counter
import numpy as np
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
rl = np.load(SP + 'umap/rl.npy').astype(np.int32)
mt = np.load(SP + 'umap/mt.npy')
reg = np.where(mt, -1, rl)          # горы не считаются землёй региона при касаниях
isreg = reg >= 0
OPEN_D, MAX_D = 3, 16               # открытое касание — до 3 px; через хребет — до 16 px
opened, blocked = Counter(), Counter()
def scan(R, M, IR):
    H, W = R.shape
    cw = np.concatenate([np.zeros((H, 1), np.int32), np.cumsum(M, 1, dtype=np.int32)], 1)
    cr = np.concatenate([np.zeros((H, 1), np.int32), np.cumsum(IR, 1, dtype=np.int32)], 1)
    for d in range(1, MAX_D + 1):
        A = R[:, :W - d]; B = R[:, d:]
        ok = (A >= 0) & (B >= 0) & (A != B)
        if not ok.any(): continue
        # промежуток (x+1 .. x+d-1)
        nw = cw[:, d:W] - cw[:, 1:W - d + 1]
        nr = cr[:, d:W] - cr[:, 1:W - d + 1]
        if d == 1: nw = np.zeros_like(A); nr = np.zeros_like(A)
        o = ok & (nr == 0) & (nw == 0) & (d <= OPEN_D)
        b = ok & (nr == 0) & (nw > 0)
        for mask, ctr in ((o, opened), (b, blocked)):
            if mask.any():
                a, c = A[mask], B[mask]
                key = np.minimum(a, c) * 4096 + np.maximum(a, c)
                u, n = np.unique(key, return_counts=True)
                for kk, nn in zip(u.tolist(), n.tolist()): ctr[(kk // 4096, kk % 4096)] += nn
scan(reg, mt, isreg)
scan(reg.T.copy(), mt.T.copy(), isreg.T.copy())
pairs = set(opened) | set(blocked)
out = []
for p in sorted(pairs):
    o, b = opened[p], blocked[p]
    if o < 4:
        if b >= 4: out.append([p[0], p[1], 'wall', o, b])
        continue
    t = 'pass' if b > 3 * o else 'land'
    out.append([p[0], p[1], t, o, b])
json.dump(out, open(SP + 'umap/adj.json', 'w'))
c = Counter(x[2] for x in out)
print('pairs', len(out), dict(c))
