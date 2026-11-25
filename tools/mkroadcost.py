# Стоимость пути по местности для каждой связи провинций: идём вдоль дороги (roads.js) и копим километры по классам местности
# (umap/tclass.npy — те же классы, что на картинке ближнего уровня) и переправы через реки. Запуск после mkroads.py: python3 -I mkroadcost.py ..
# Выход: mapinfo3.json['rcost'][i] = [км: равнина, холмы, лес, горы, болото, пустыня, степь, броды, большие реки] для связи padj[i].
# Множители и задержки — в игре (объект MOVE в src/3_core.js), здесь только «сколько чего на пути».
import os, sys, json, re
import numpy as np
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
mi = json.load(open(SP + 'mapinfo3.json')); edges = mi['padj']
W = mi['W']; k = W / 5298
roads = json.loads(re.search(r'=\s*(\[.*\])\s*;', open(OUT + '/roads.js').read(), re.S).group(1))
assert len(roads) == len(edges), 'roads.js и padj разной длины — сначала mkroads.py'
tc = np.load(SP + 'umap/tclass.npy'); H, Wm = tc.shape
rv = np.load(SP + 'umap/rivers.npy') > 46
# большие реки — по ручному списку big_rivers.json (ширина русла на этой карте их не отличает: Дунай и Марица одинаково 4–5 px)
from PIL import Image, ImageDraw
BR = json.load(open(SP + 'big_rivers.json')); FIT = json.load(open(SP + 'umap/fit.json')); KF = Wm / FIT.get('W', 2000)
L0, SXF, P0, SYF = FIT['p'][0], FIT['p'][1] * KF, FIT['p'][2], FIT['p'][3] * KF
lines = Image.new('L', (Wm, H), 0); dl = ImageDraw.Draw(lines)
for pts in BR['rivers'].values(): dl.line([((lo - L0) * SXF, (P0 - la) * SYF) for lo, la in pts], fill=255, width=2)
bigzone = nd.distance_transform_edt(np.asarray(lines) == 0) <= BR['corridor']
rw = np.where(bigzone, 10.0, 1.0)                 # 10 — большая река, 1 — брод
BIG = 5
# порядок: равнина, холмы, лес, проходимые горы, болото, пустыня, степь (непроходимые горы на дороге — как проходимые: это перевал)
def cls(v):
    if v == 255: return None
    out = []
    if v & 1: out.append(1)
    if v & 2: out.append(2)
    if v & (4 | 8): out.append(3)
    if v & 16: out.append(4)
    if v & 32: out.append(5)
    if v & 64: out.append(6)
    return out or [0]
SLOW = [3, 4, 2, 5, 1, 6, 0]   # порядок от медленного к быстрому при множителях MOVE (горы 0,4, болото 0,4, лес 0,5, пустыня 0,7, холмы 0,75, степь и равнина 1)
rcost = []
for (a, b, t), r in zip(edges, roads):
    if r is None or t in ('sea', 'strait'): rcost.append(None); continue
    pts = []; x = y = 0
    for i in range(0, len(r), 2): x += r[i]; y += r[i + 1]; pts.append((x, y))
    km = [0.0] * 7; fords = bigs = 0; inriv = False; wmax = 0; gap = 0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
        L = max(1, int(np.hypot(x1 - x0, y1 - y0)))
        seg = np.hypot((x1 - x0) * 0.63 / k, (y1 - y0) * 0.82 / k) / L
        for j in range(L):
            X = int(round(x0 + (x1 - x0) * (j + 0.5) / L)); Y = int(round(y0 + (y1 - y0) * (j + 0.5) / L))
            if not (0 <= X < Wm and 0 <= Y < H): continue
            c = cls(int(tc[Y, X]))
            if c:   # несколько классов сразу — шаг идёт в самый медленный (минимальный множитель): горы, болото, лес, пустыня, холмы, степь, равнина
                km[min(c, key=SLOW.index)] += seg
            if rv[Y, X]:
                inriv = True; gap = 0; wmax = max(wmax, rw[Y, X])
            elif inriv:
                gap += 1
                if gap > 6:   # вышли из реки надолго — переправа закончена (вдоль берега дорога может «касаться» русла — это одна переправа)
                    inriv = False
                    if wmax >= BIG: bigs += 1
                    else: fords += 1
                    wmax = 0
    if inriv: bigs += int(wmax >= BIG); fords += int(wmax < BIG)
    rcost.append([round(v, 1) for v in km] + [fords, bigs])
mi['rcost'] = rcost
json.dump(mi, open(SP + 'mapinfo3.json', 'w'), ensure_ascii=False)
land = [c for c in rcost if c]
print('связей', len(rcost), 'по суше', len(land), 'км по классам', [round(sum(c[i] for c in land)) for i in range(7)], 'бродов', sum(c[7] for c in land), 'больших рек', sum(c[8] for c in land))
