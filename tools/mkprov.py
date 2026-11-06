# Провинции для браузера: ids.png (номер провинции в цвете пикселя, вполовину разрешения) + список провинций в mapinfo3.json
import json, os, re, sys, glob
from collections import Counter
from collections import deque
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
provs = json.load(open(SP + 'umap/provs.json'))
gen = json.load(open(SP + 'gen.json')); mi = json.load(open(SP + 'mapinfo3.json'))
gl = np.load(SP + 'umap/gl.npy').astype(np.int32); grid = json.load(open(SP + 'umap/grid.json'))
fit = json.load(open(SP + 'umap/fit.json'))
H0, W0 = pl.shape
k = W0 / fit.get('W', 2000); l0, sx, p0, sy = fit['p'][0], fit['p'][1] * k, fit['p'][2], fit['p'][3] * k
POL = sorted(glob.glob(SP + '../source/*political*.png'))[0]
P = np.asarray(Image.open(POL).convert('RGB')).astype(np.int32)
sea = ((P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]) == 0x001F48
rid2gi = {rid: gi for gi, rid in enumerate(gen['rids']) if rid >= 0}
GAZ = eval(re.search(r"GAZ = (\[.*?\])\n", open(SP + 'mkgen2.py').read(), re.S).group(1))
# провинции карты автора
plist = []
for i, p in enumerate(provs):
    gi = rid2gi.get(p['region'])
    plist.append({'gi': gi, 'n': p['n'], 'cx': p['cx'], 'cy': p['cy']})
# запасные регионы — по одной провинции на регион
S = 1; H2, W2 = H0, W0   # карта провинций в полном разрешении
ids = np.zeros((H2, W2), np.int32)
small = pl[::S, ::S]
ids[small >= 0] = small[small >= 0] + 1
C = grid['C']
yy, xx = np.mgrid[0:H2, 0:W2]
gy = np.clip((yy * S) // C, 0, grid['GH'] - 1); gx = np.clip((xx * S) // C, 0, grid['GW'] - 1)
gv = gl[gy, gx]
landS = ~sea[::S, ::S]
for gi, rid in enumerate(gen['rids']):
    if rid >= 0: continue
    m = (gv == gi) & (ids == 0) & landS
    if not m.any(): continue
    ys, xs = np.nonzero(m)
    plist.append({'gi': gi, 'n': int(m.sum()) * S * S, 'cx': float(xs.mean() * S), 'cy': float(ys.mean() * S), 'fallback': True})
    ids[m] = len(plist)
# точки подписей провинций: самая «глубокая» точка
def deep(mask):
    dist = np.zeros(mask.shape, np.int32); q = deque()
    hh, ww = mask.shape
    for y, x in zip(*np.nonzero(mask)):
        if y == 0 or x == 0 or y == hh - 1 or x == ww - 1 or not (mask[y - 1, x] and mask[y + 1, x] and mask[y, x - 1] and mask[y, x + 1]): dist[y, x] = 1; q.append((y, x))
    while q:
        y, x = q.popleft()
        for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if 0 <= Y < hh and 0 <= X < ww and mask[Y, X] and dist[Y, X] == 0: dist[Y, X] = dist[y, x] + 1; q.append((Y, X))
    c = np.argwhere(dist == dist.max()); return c[len(c) // 2]
idx = ids.ravel(); order = np.argsort(idx, kind='stable'); vals = idx[order]
starts = np.searchsorted(vals, np.arange(1, len(plist) + 1)); ends = np.searchsorted(vals, np.arange(1, len(plist) + 1), side='right')
for i, p in enumerate(plist):
    sel = order[starts[i]:ends[i]]
    if len(sel) == 0: p['x'], p['y'] = int(p['cx']), int(p['cy']); continue
    ys, xs = np.divmod(sel, W2)
    y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
    sub = ids[y0:y1 + 1, x0:x1 + 1] == i + 1
    yy2, xx2 = deep(np.pad(sub, 1)) - 1
    p['x'], p['y'] = int((x0 + xx2) * S), int((y0 + yy2) * S)
# названия провинций: ближайший город из справочника (в пределах 0,2°), иначе «Регион, часть N»
used = set(); cnt = {}
for i, p in enumerate(plist):
    if i < len(provs) and provs[i].get('anchor'): p['name'] = provs[i]['anchor']; used.add(p['name']); continue
    lon, lat = l0 + p['x'] / sx, p0 - p['y'] / sy
    rn = gen['regions'][p['gi']][1] if p['gi'] is not None else '—'
    best = sorted(GAZ, key=lambda g: (g[1] - lon) ** 2 + (g[2] - lat) ** 2)
    nm = next((g[0] for g in best[:3] if (g[1] - lon) ** 2 + (g[2] - lat) ** 2 < 0.2 ** 2 and g[0] not in used), None)
    if nm is None:
        cnt[rn] = cnt.get(rn, 0) + 1; nm = f'{rn}, земля {cnt[rn]}'
    used.add(nm); p['name'] = nm
mt = np.load(SP + 'umap/mt.npy')
# владелец каждой провинции — цвет державы, занимающий большую часть её площади
exec(open(SP + 'fmap.py').read())
kP = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
OVERC = [0x808080, 0x001F48, 0x000020, 0x262626, 0x000000, 0xDFDFDF, 0x81817F, 0x5E5E5E, 0x404040, 0xFFFFFF, 0x5D5D60, 0x82827C, 0x828280, 0x80807E, 0x82827D, 0x81817F, 0x82827F, 0x82827E, 0x9F9F9F, 0x6C6C6C, 0x070707, 0x88888C]
selp = (pl >= 0) & ~np.isin(kP, OVERC)
keyp = pl[selp].astype(np.int64) * (1 << 24) + kP[selp]
uu, cc = np.unique(keyp, return_counts=True)
from collections import defaultdict
byp = defaultdict(list)
for kk, nn in zip(uu.tolist(), cc.tolist()): byp[kk >> 24].append((nn, kk & 0xFFFFFF))
report_mixed = []
for i, p in enumerate(plist):
    if p.get('fallback'): p['own'] = gen['regions'][p['gi']][2]; continue
    lst = sorted(byp.get(i, []), reverse=True)
    lon, lat = l0 + p['cx'] / sx, p0 - p['cy'] / sy
    p['own'] = None
    for nn, col in lst:
        f = faction_of(((col >> 16) & 255, (col >> 8) & 255, col & 255), lon, lat)
        if f: p['own'] = f; break
    if p['own'] is None: p['own'] = 'free'   # серая на политической карте — ничейная земля
    tot = sum(n for n, _ in lst)
    if len(lst) > 1 and tot and lst[0][0] / tot < 0.75 and lst[1][0] > 200:
        report_mixed.append(f"{p['name']} — {round(lst[0][0] / tot * 100)}% #{lst[0][1]:06x}, {round(lst[1][0] / tot * 100)}% #{lst[1][1]:06x}")
img = np.zeros((H2, W2, 3), np.uint8); img[..., 0] = (ids >> 8) & 255; img[..., 1] = ids & 255
img[..., 2] = np.where(mt[::S, ::S][:H2, :W2] & (ids > 0), 255, 0)
# доля гор в каждой провинции
plf = pl.ravel(); mtf = mt.ravel(); sel = plf >= 0
mcount = np.bincount(plf[sel], weights=mtf[sel].astype(np.float64), minlength=len(provs))
for i, p in enumerate(plist):
    p['mt'] = round(float(mcount[i]) / max(1, p['n']), 2) if i < len(provs) else 0
Image.fromarray(img).save(OUT + '/ids.png', optimize=True)
mi['provs'] = [[p['gi'] if p['gi'] is not None else -1, p['x'], p['y'], p['n'], p['name'], p.get('mt', 0), p.get('own')] for p in plist]
mi['idsScale'] = S
json.dump(mi, open(SP + 'mapinfo3.json', 'w'), ensure_ascii=False)
cntr = Counter(p['gi'] for p in plist if not p.get('fallback') and p['gi'] is not None)
rep = {'out_of_range': [[gen['regions'][g][1], n] for g, n in sorted(cntr.items(), key=lambda t: t[1]) if n < 4 or n > 10], 'mixed': report_mixed}
json.dump(rep, open(SP + 'report.json', 'w'), ensure_ascii=False, indent=1)
# список для аудита
with open(SP + 'provinces.md', 'w') as f:
    f.write('# Регионы и провинции\n\nСписок для проверки. Формат: регион (держава, число провинций): провинции.\n\n')
    regs_order = sorted(set(p['gi'] for p in plist if p['gi'] is not None), key=lambda g: gen['regions'][g][1])
    for g in regs_order:
        ps = [p for p in plist if p['gi'] == g]
        d = gen['regions'][g]; flag = '' if 4 <= len(ps) <= 10 else ' ⚠'
        f.write(f"- **{d[1]}** ({d[2]}, {len(ps)}){flag}: " + ', '.join(p['name'] + (f" [{p['own']}]" if p.get('own') and p['own'] != d[2] else '') for p in ps) + '\n')
print('регионы вне 4–10:', rep['out_of_range']); print('спорные провинции:', report_mixed)
print('provinces', len(plist), 'ids.png', W2, H2, os.path.getsize(OUT + '/ids.png'))
