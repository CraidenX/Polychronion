# Граф соседства провинций (для движения войск по провинциям):
#   land   — провинции касаются по суше (не через хребет);
#   pass   — перевал (пунктир #FF00FF) соединяет провинции по обе стороны хребта;
#   strait — между берегами двух провинций не больше STRAIT_PX моря (переправа на лодках);
#   sea    — морской путь между регионами (из связей регионов) — между ближайшими приморскими провинциями.
# Выход: umap/padj.json = {"edges": [[a, b, тип], ...], "coast": [номера приморских провинций]}
import json, os, glob
from collections import Counter
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
G = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*regions*.png'))[0]).convert('RGB')).astype(np.int32)
kG = (G[..., 0] << 16) | (G[..., 1] << 8) | G[..., 2]
P = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*political*.png'))[0]).convert('RGB')).astype(np.int32)
kP = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
mt = np.isin(kG, [0x8B5A2B, 0x4A2F1A, 0xFF00FF])
sea = np.isin(kP, [0x001F48, 0x000020])
R = np.where(mt, -1, pl)
STRAIT_PX, OPEN_MIN = 45, 3
opened, strait = Counter(), {}
def scan(R, S, T):
    H, W = R.shape
    cs = np.concatenate([np.zeros((H, 1), np.int32), np.cumsum(S, 1, dtype=np.int32)], 1)
    for d in range(1, STRAIT_PX + 1):
        A = R[:, :W - d]; B = R[:, d:]
        ok = (A >= 0) & (B >= 0) & (A != B)
        if not ok.any(): continue
        ns = cs[:, d:W] - cs[:, 1:W - d + 1] if d > 1 else np.zeros_like(A)
        if d <= 2:
            o = ok & (ns == 0)
            a, b = A[o], B[o]; key = np.minimum(a, b) * 4096 + np.maximum(a, b)
            u, n = np.unique(key, return_counts=True)
            for kk, nn in zip(u.tolist(), n.tolist()): opened[(kk // 4096, kk % 4096)] += nn
        if d > 1:
            s = ok & (ns == d - 1)   # между ними только море
            if s.any():
                a, b = A[s], B[s]; key = np.unique(np.minimum(a, b) * 4096 + np.maximum(a, b))
                for kk in key.tolist():
                    k2 = (kk // 4096, kk % 4096)
                    if k2 not in strait or strait[k2] > d: strait[k2] = d
scan(R, sea, False); scan(R.T.copy(), sea.T.copy(), True)
edges = {}
for p, n in opened.items():
    if n >= OPEN_MIN: edges[p] = 'land'
for p, d in strait.items():
    if p not in edges: edges[p] = 'strait'
# перевалы
for q in json.load(open(SP + 'umap/passes.json')):
    a, b = q[0], q[1]; edges[(min(a, b), max(a, b))] = 'pass'
# приморские провинции
coastm = nd.binary_dilation(sea, iterations=2) & (pl >= 0) & ~sea
coast = sorted(set(np.unique(pl[coastm]).tolist()) - {-1})
# морские пути регионов -> между ближайшими приморскими провинциями
gen = json.load(open(SP + 'gen.json')); mi = json.load(open(SP + 'mapinfo3.json'))
provs = mi['provs']; gi_of = {r[0]: i for i, r in enumerate(gen['regions'])}
by_reg = {}
for k in coast:
    if k < len(provs) and provs[k][0] >= 0: by_reg.setdefault(provs[k][0], []).append(k)
nsea = 0
for l in gen['links']:
    if l[2] not in ('sea', 'strait'): continue
    ga, gb = gi_of.get(l[0]), gi_of.get(l[1])
    if ga is None or gb is None or ga not in by_reg or gb not in by_reg: continue
    best = min(((provs[a][1] - provs[b][1]) ** 2 + (provs[a][2] - provs[b][2]) ** 2, a, b) for a in by_reg[ga] for b in by_reg[gb])
    key = (min(best[1], best[2]), max(best[1], best[2]))
    if key not in edges: edges[key] = 'sea' if l[2] == 'sea' else 'strait'; nsea += 1
# одинокие провинции (мелкие острова, устья рек) — к ближайшей провинции
deg0 = Counter(); [deg0.update([a, b]) for a, b in edges]
for k in range(len(provs)):
    if provs[k][0] < 0 or deg0[k]: continue
    d, j = min(((provs[k][1] - provs[j][1]) ** 2 + (provs[k][2] - provs[j][2]) ** 2, j) for j in range(len(provs)) if j != k and provs[j][0] >= 0)
    edges[(min(k, j), max(k, j))] = 'strait' if d ** 0.5 < 90 else 'sea'
out = {'edges': [[a, b, t] for (a, b), t in sorted(edges.items())], 'coast': coast}
json.dump(out, open(SP + 'umap/padj.json', 'w'))
mi['padj'] = out['edges']; mi['coast'] = out['coast']; json.dump(mi, open(SP + 'mapinfo3.json', 'w'), ensure_ascii=False)   # сразу в данные карты
c = Counter(edges.values())
# связность: провинции без соседей
deg = Counter(); [deg.update([a, b]) for a, b in edges]
iso = [k for k in range(len(provs)) if provs[k][0] >= 0 and deg[k] == 0]
print('рёбра', dict(c), 'морских путей регионов', nsea, 'приморских', len(coast), 'без соседей', len(iso), [provs[k][4] for k in iso[:10]])
# компоненты связности (весь граф и только суша+перевалы+проливы)
def comps(types):
    par = list(range(len(provs)))
    def f(x):
        while par[x] != x: par[x] = par[par[x]]; x = par[x]
        return x
    for (a, b), t in edges.items():
        if t in types: par[f(a)] = f(b)
    cs = Counter(f(k) for k in range(len(provs)) if provs[k][0] >= 0)
    return len(cs), sorted(cs.values())[-3:]
print('компонент (все пути):', comps({'land', 'pass', 'strait', 'sea'}), ' (без моря):', comps({'land', 'pass', 'strait'}))
