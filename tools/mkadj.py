# Сухопутные связи между регионами с учётом гор (карта регионов):
#   коричневый хребет #8B5A2B и его контур #4A2F1A закрывают проход;
#   перевал — пунктир #FF00FF поперёк хребта: соединяет провинции по обе его стороны (переход — один сезон).
# Итог по паре регионов:
#   есть нарисованный перевал        -> 'pass' (армия проводит сезон в перевале)
#   иначе есть открытые касания      -> 'land'
#   иначе касаются только через хребет -> 'wall' (пути нет)
import json, os, glob
from collections import Counter
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
rl = np.load(SP + 'umap/rl.npy').astype(np.int32)
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
G = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*regions*.png'))[0]).convert('RGB')).astype(np.int32)
kG = (G[..., 0] << 16) | (G[..., 1] << 8) | G[..., 2]
mt = np.isin(kG, [0x8B5A2B, 0x4A2F1A, 0xFF00FF])
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
# перевалы: группы пикселей #FF00FF (пунктир склеивается), концы — провинции по обе стороны хребта
pm = kG == 0xFF00FF
glab, gn = nd.label(nd.binary_dilation(pm, iterations=2))
passes = []
landp = np.where(mt, -1, pl)
for i, sl in enumerate(nd.find_objects(glab), 1):
    y0, y1 = max(0, sl[0].start - 4), sl[0].stop + 4; x0, x1 = max(0, sl[1].start - 4), sl[1].stop + 4
    g = (glab[y0:y1, x0:x1] == i) & pm[y0:y1, x0:x1]
    ring = nd.binary_dilation(g, iterations=3) & ~g
    ps = Counter(landp[y0:y1, x0:x1][ring].tolist()); ps.pop(-1, None)
    two = [p for p, _ in ps.most_common(2)]
    if len(two) < 2: print('перевал без двух концов:', x0, y0); continue
    a, b = two; ys, xs = np.nonzero(g)
    passes.append([int(a), int(b), int(x0 + xs.mean()), int(y0 + ys.mean())])
json.dump(passes, open(SP + 'umap/passes.json', 'w'))
rp = Counter()
ys, xs = np.nonzero(pl >= 0)
first = {}
for p, r in zip(pl[ys, xs][::97].tolist(), rl[ys, xs][::97].tolist()): first.setdefault(p, r)
for a, b, x, y in passes:
    ra, rb = first.get(a), first.get(b)
    if ra is None or rb is None or ra == rb: continue
    rp[(min(ra, rb), max(ra, rb))] += 1
pairs = set(opened) | set(blocked) | set(rp)
out = []
for p in sorted(pairs):
    o, b = opened[p], blocked[p]
    if rp[p]: out.append([p[0], p[1], 'pass', o, b]); continue
    if o >= 4: out.append([p[0], p[1], 'land', o, b]); continue
    if b >= 4: out.append([p[0], p[1], 'wall', o, b])
json.dump(out, open(SP + 'umap/adj.json', 'w'))
c = Counter(x[2] for x in out)
print('pairs', len(out), dict(c), 'перевалов на карте', len(passes))
