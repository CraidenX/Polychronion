# Поиск артефактов на картах автора (source/*political*.png, source/*regions*.png).
# Выход: tools/artifacts.md (список с координатами пикселей для графического редактора)
#        tools/artifacts_political.png, tools/artifacts_regions.png (обзор с номерами)
import glob, os, json
from collections import Counter, defaultdict
import numpy as np
from PIL import Image, ImageDraw, ImageFont
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
pl = np.load(SP + 'umap/pl.npy').astype(np.int32)
H, W = pl.shape
k = W / 2000
def ll(x, y): return 11.4547 + x / (51.075 * k), 48.4153 - y / (51.0312 * k)
def load(n):
    a = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*' + n + '*.png'))[0]).convert('RGB')).astype(np.int32)
    return a, (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
PA, KP = load('political'); RA, KR = load('regions')
# служебные цвета (не державы и не регионы)
SERVICE = {0x001F48: 'море', 0x808080: 'фон / ничейные', 0x000000: 'подписи', 0x070707: 'подписи', 0x262626: 'границы регионов',
           0x404040: 'край игровой зоны (?)', 0xDFDFDF: 'границы провинций', 0x000020: 'реки / береговая линия (?)',
           0x5E5E5E: 'фоновые горы', 0xFFFFFF: 'игровые горы'}
NEARGRAY = lambda c: c not in SERVICE and max((c >> 16) & 255, (c >> 8) & 255, c & 255) - min((c >> 16) & 255, (c >> 8) & 255, c & 255) < 10 and 0x50 <= (c & 255) <= 0x90
zone = pl >= 0
items = []   # (карта, тип, x, y, текст)
def add(mp, kind, x, y, text): items.append((mp, kind, int(x), int(y), text))

for mp, K in (('политическая', KP), ('регионов', KR)):
    cnt = Counter(K.ravel().tolist())
    for c, n in cnt.items():
        if c in (0x001F48, 0x808080, 0x000000, 0x070707, 0x000020, 0x262626, 0xDFDFDF): continue
        m = K == c
        lab, nl = nd.label(m)
        if nl == 0: continue
        sizes = nd.sum(m, lab, range(1, nl + 1))
        cms = nd.center_of_mass(m, lab, range(1, nl + 1))
        big = sizes.max()
        for s, (cy, cx) in zip(sizes, cms):
            iz = zone[int(cy), int(cx)] or zone[max(0, int(cy) - 3):int(cy) + 4, max(0, int(cx) - 3):int(cx) + 4].any()
            if NEARGRAY(c):
                if s >= 5: add(mp, 'почти серый', cx, cy, f'цвет #{c:06x} ({int(s)} пикс.) — почти как фон #808080, но не он. Перекрасить в нужный цвет')
                continue
            if c in (0xFFFFFF, 0x5E5E5E, 0x404040):
                if s < 6 and iz: add(mp, 'обрывок', cx, cy, f'{SERVICE[c]} #{c:06x}: одиночное пятно {int(s)} пикс.')
                continue
            if not iz: continue
            if s < 30 and s < big:
                add(mp, 'обрывок', cx, cy, f'#{c:06x}: оторванный кусочек {int(s)} пикс. (основная часть цвета — {int(big)} пикс.)')
            elif n < 30:
                add(mp, 'случайный цвет', cx, cy, f'#{c:06x}: цвет встречается всего {n} пикс.')

# цвета государств на карте регионов
pol_cols = set(Counter(KP[zone].ravel().tolist())) - set(SERVICE)
reg_cnt = Counter(KR[zone].ravel().tolist())
reg_only_pol = {c for c in pol_cols if c in reg_cnt and Counter(KP[KR == c].ravel().tolist()).most_common(1)[0][0] == c}
for c in reg_only_pol:
    m = (KR == c) & (KP == c)
    if m.sum() < 1: continue
    lab, nl = nd.label(m)
    for s, (cy, cx) in zip(nd.sum(m, lab, range(1, nl + 1)), nd.center_of_mass(m, lab, range(1, nl + 1))):
        add('регионов', 'цвет державы', cx, cy, f'#{c:06x}: на карте регионов стоит цвет державы ({int(s)} пикс.) — из-за этого здесь получился отдельный регион')

# провинции, поделённые между державами (граница державы не по линии провинции)
sel = zone & ~np.isin(KP, [0xDFDFDF, 0x262626, 0x000020, 0xFFFFFF, 0x404040, 0x000000, 0x5E5E5E])
key = pl[sel].astype(np.int64) * (1 << 24) + KP[sel]
uu, cc = np.unique(key, return_counts=True)
byp = defaultdict(list)
for kk, nn in zip(uu.tolist(), cc.tolist()): byp[kk >> 24].append((nn, kk & 0xFFFFFF))
provs = json.load(open(SP + 'mapinfo3.json'))['provs']
for p, lst in byp.items():
    lst.sort(reverse=True); tot = sum(n for n, _ in lst)
    if len(lst) < 2: continue
    n2, c2 = lst[1]
    if n2 >= 15 and n2 / tot >= 0.02:
        m = (pl == p) & (KP == c2); ys, xs = np.nonzero(m)
        nm = provs[p][4] if p < len(provs) else '?'
        add('политическая', 'провинция поделена', xs.mean(), ys.mean(),
            f'«{nm}»: {round(lst[0][0] / tot * 100)}% #{lst[0][1]:06x}, {round(n2 / tot * 100)}% #{c2:06x}. Граница державы идёт не по белой линии провинции')

# несовпадение игровой зоны: на одной карте суша закрашена, на другой — фон
def zmask(K): return ~np.isin(K, [0x001F48, 0x808080, 0x000000, 0x070707, 0x000020, 0x5E5E5E]) & ~np.vectorize(NEARGRAY, otypes=[bool])(K) if False else ~np.isin(K, [0x001F48, 0x808080, 0x000000, 0x070707, 0x000020, 0x5E5E5E])
zp, zr = zmask(KP), zmask(KR)
for mm, txt in (((zp & ~zr) & (KR == 0x808080), 'на политической закрашено, на карте регионов — фон'), ((zr & ~zp) & (KP == 0x808080) & (KR != 0x404040), 'на карте регионов закрашено, на политической — серый (ничейная?)')):
    lab, nl = nd.label(mm)
    if nl == 0: continue
    for s, (cy, cx) in zip(nd.sum(mm, lab, range(1, nl + 1)), nd.center_of_mass(mm, lab, range(1, nl + 1))):
        if s >= 8: add('обе', 'зона не совпадает', cx, cy, f'{txt} ({int(s)} пикс.)')

# сортировка и вывод
order = {'цвет державы': 0, 'провинция поделена': 1, 'зона не совпадает': 2, 'случайный цвет': 3, 'обрывок': 4, 'почти серый': 5}
items.sort(key=lambda t: (order.get(t[1], 9), t[0], t[3], t[2]))
with open(SP + 'artifacts.md', 'w') as f:
    f.write('# Артефакты на картах\n\nКоординаты x, y — пиксели исходного PNG 5298×2899 (так их показывает графический редактор). Номер совпадает с меткой на artifacts_*.png.\n\n')
    f.write('| № | Карта | Тип | x, y | Долгота, широта | Что не так |\n|---|---|---|---|---|---|\n')
    for i, (mp, kind, x, y, t) in enumerate(items, 1):
        lo, la = ll(x, y); f.write(f'| {i} | {mp} | {kind} | {x}, {y} | {lo:.2f}, {la:.2f} | {t} |\n')
for mp, A in (('political', PA), ('regions', RA)):
    im = Image.fromarray(A.astype(np.uint8)).resize((W // 2, H // 2), Image.NEAREST); d = ImageDraw.Draw(im)
    try: fnt = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 14)
    except Exception: fnt = None
    for i, (m, kind, x, y, t) in enumerate(items, 1):
        if not (m == 'обе' or (m == 'политическая') == (mp == 'political')): continue
        X, Y = x // 2, y // 2; col = (255, 0, 0) if kind != 'почти серый' else (255, 160, 0)
        d.ellipse((X - 9, Y - 9, X + 9, Y + 9), outline=col, width=3)
        d.text((X + 10, Y - 8), str(i), fill=(255, 255, 0), font=fnt, stroke_width=2, stroke_fill=(0, 0, 0))
    im.save(SP + 'artifacts_' + mp + '.png', optimize=True)
print(len(items), Counter(t[1] for t in items))
