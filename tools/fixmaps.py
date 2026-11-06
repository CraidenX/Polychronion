# Однократная чистка карт автора: случайные пиксели, обрывки, Тир на карте регионов,
# провинции с мелкой «чужой» долей, новый цвет ничейных земель #A0A0A0.
# Исходники перезаписываются; копии до правки — в umap/backup_*.png
import glob, os, json, shutil
from collections import Counter
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
FP = sorted(glob.glob(SP + '../source/*political*.png'))[0]
FR = sorted(glob.glob(SP + '../source/*regions*.png'))[0]
for f, n in ((FP, 'political'), (FR, 'regions')):
    if not os.path.exists(SP + f'umap/backup_{n}.png'): shutil.copy(f, SP + f'umap/backup_{n}.png')
def load(f):
    a = np.asarray(Image.open(f).convert('RGB')).astype(np.int32); return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
KP, KR = load(FP), load(FR)
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
zone = nd.binary_dilation(pl >= 0, iterations=3)
SERV = {0x001F48, 0x000020, 0xDFDFDF, 0x262626, 0x404040, 0x000000, 0x070707, 0xFFFFFF, 0x5E5E5E, 0x808080}
SEA = KP == 0x001F48
log = []
def neighbour_colour(K, m, allow_bg=True):
    ring = nd.binary_dilation(m, iterations=2) & ~m
    vals = [v for v in K[ring].tolist() if v not in (0x001F48, 0x000020, 0xDFDFDF, 0x262626, 0x404040, 0x000000, 0x070707, 0xFFFFFF, 0x5E5E5E) and (allow_bg or v != 0x808080)]
    return Counter(vals).most_common(1)[0][0] if vals else None
def recolor(K, m, name, why):
    c = neighbour_colour(K, m)
    old = Counter(K[m].tolist()).most_common(1)[0][0]
    if c is None or c == old: return
    ys, xs = np.nonzero(m); K[m] = c
    log.append(f'{name}: {why} #{old:06x} → #{c:06x}, {int(m.sum())} пикс., x {int(xs.mean())}, y {int(ys.mean())}')

# 1. Тир на карте регионов: пятно цвета державы → цвет окружающего региона
for c in (0x2D1D2D, 0xE7EAF1):
    m = (KR == c) & zone
    lab, n = nd.label(m)
    for i in range(1, n + 1): recolor(KR, lab == i, 'регионов', 'цвет державы на карте регионов')
# 2. мелкие обрывки и случайные цвета на обеих картах
for name, K in (('политическая', KP), ('регионов', KR)):
    cnt = Counter(K[zone].tolist())
    for c, n in cnt.items():
        if c in SERV: continue
        m = (K == c) & zone
        lab, nl = nd.label(m)
        sizes = nd.sum(m, lab, range(1, nl + 1)); big = sizes.max()
        for i, s in enumerate(sizes, 1):
            if not (s < 30 and (s < big or n < 30)): continue
            cm = lab == i; ys, xs = np.nonzero(cm); y, x = int(ys.mean()), int(xs.mean())
            if SEA[max(0, y - 12):y + 13, max(0, x - 12):x + 13].mean() > 0.35 and n >= 30: continue   # остров
            recolor(K, cm, name, 'обрывок/случайный цвет')
# 3. провинции с мелкой чужой долей: отдать большинству (спорные оставлены автору)
KEEP = {'Боспор, земля 5', 'Конавли, земля 1', 'Корчула', 'Андрос', 'Тинос', 'Серифос', 'Ситея'}
provs = json.load(open(SP + 'mapinfo3.json'))['provs']
LINES = [0xDFDFDF, 0x262626, 0x000020, 0xFFFFFF, 0x404040, 0x000000, 0x5E5E5E, 0x070707]
idx = np.nonzero((pl >= 0) & ~np.isin(KP, LINES))
pv = pl[idx]; cv = KP[idx]
order = np.argsort(pv, kind='stable'); pv, cv = pv[order], cv[order]; ys, xs = idx[0][order], idx[1][order]
bounds = np.searchsorted(pv, np.arange(len(provs) + 1))
for p in range(len(provs)):
    a, b = bounds[p], bounds[p + 1]
    if b - a == 0: continue
    cc = Counter(cv[a:b].tolist()).most_common()
    if len(cc) < 2: continue
    tot = b - a; maj = cc[0][0]
    for c, n in cc[1:]:
        if n < 15 or n / tot < 0.02: continue
        if provs[p][4] in KEEP: continue
        sel = cv[a:b] == c
        KP[ys[a:b][sel], xs[a:b][sel]] = maj
        log.append(f'политическая: провинция «{provs[p][4]}» — {round(n / tot * 100)}% #{c:06x} отдано #{maj:06x}')
# 4. ничейные земли: серый внутри игровой зоны (на карте регионов там регион) → #A0A0A0
painted = ~np.isin(KR, [0x808080, 0x001F48, 0x000020, 0x5E5E5E, 0x000000, 0x070707])
free = (KP == 0x808080) & painted
KP[free] = 0xA0A0A0
log.append(f'политическая: ничейные земли #808080 → #A0A0A0, {int(free.sum())} пикс.')
for f, K in ((FP, KP), (FR, KR)):
    a = np.stack([(K >> 16) & 255, (K >> 8) & 255, K & 255], -1).astype(np.uint8)
    Image.fromarray(a).save(f, optimize=True)
open(SP + 'fixmaps.log', 'w').write('\n'.join(log) + '\n')
print(len(log)); print('\n'.join(log[-40:]))
