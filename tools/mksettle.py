# K5: места под поселения — по одной точке на провинцию: тип (город, крепость, монастырь, деревня), координаты, название.
# Источники: газетир GAZ из mkgen2.py (исторические города: широта/долгота), названия провинций (mapinfo3.json), классы местности (umap/tclass.npy),
# реки (umap/rivgraph.npy), дороги (../roads.js), перевалы (umap/passes.json).
#  — город: в провинции есть пункт газетира → точка на нём, название — из газетира;
#  — монастырь: в названии провинции/пункта «Афон», «монастыр», «Метеор», «Сумел», «Синай»;
#  — крепость: центр провинции на проходимых или непроходимых горах либо у перевала (≤ 25 px);
#  — деревня: самое «удобное» место провинции — равнина у реки или дороги, подальше от края.
# Файл tools/settlements.json правится вручную; пересобрать заново: REGEN_SETTLEMENTS=1. Копия для игры — ../settlements.json.
# Радиус расчистки (без деревьев, скал и бугров), px карты: город 12, крепость 9, монастырь и деревня 6 — читает mkterrain_sprites.py.
# Запуск после mkrivgraph.py: python3 -I mksettle.py ..
import os, sys, json, re, ast
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
PATH = SP + 'settlements.json'
CLEAR = {'город': 12, 'крепость': 9, 'монастырь': 6, 'деревня': 6}
def save_game(L):
    json.dump({'_': 'Поселения (копия tools/settlements.json)', 'clear': CLEAR, 'settlements': L}, open(OUT + '/settlements.json', 'w'), ensure_ascii=False, separators=(',', ':'))
if os.path.exists(PATH) and not os.environ.get('REGEN_SETTLEMENTS'):
    L = json.load(open(PATH))['settlements']; save_game(L); print('поселения: из tools/settlements.json', len(L)); sys.exit(0)
m = np.load(SP + 'umap/masks.npz'); land = m['land']; H, W = land.shape
FIT = json.load(open(SP + 'umap/fit.json')); KF = W / FIT.get('W', 2000)
L0, SXF, P0, SYF = FIT['p'][0], FIT['p'][1] * KF, FIT['p'][2], FIT['p'][3] * KF
topx = lambda lon, lat: ((lon - L0) * SXF, (P0 - lat) * SYF)
GAZ = ast.literal_eval(re.search(r'^GAZ = (\[.*?\])\s*$', open(SP + 'mkgen2.py', encoding='utf-8').read(), re.M | re.S).group(1))
MI = json.load(open(SP + 'mapinfo3.json')); P = MI['provs']
I = np.asarray(Image.open(OUT + '/ids.png').convert('RGB')).astype(np.int32); pid = (I[..., 0] << 8) | I[..., 1]
tc = np.load(SP + 'umap/tclass.npy')
riv = np.load(SP + 'umap/rivgraph.npy') > 0 if os.path.exists(SP + 'umap/rivgraph.npy') else np.load(SP + 'umap/rivers.npy') > 46
roads = json.loads(re.search(r'=\s*(\[.*\])\s*;', open(OUT + '/roads.js').read(), re.S).group(1))
rimg = Image.new('L', (W, H), 0); dr = ImageDraw.Draw(rimg)
for r in roads:
    if not r: continue
    pts = []; x = y = 0
    for i in range(0, len(r), 2): x += r[i]; y += r[i + 1]; pts.append((x, y))
    if len(pts) > 1: dr.line(pts, fill=255, width=1)
rivD = nd.distance_transform_edt(~riv); roadD = nd.distance_transform_edt(np.asarray(rimg) == 0)
hgt = nd.gaussian_filter(np.asarray(Image.open(SP + 'terrain/height.png')).astype(np.float32), 2); gy_, gx_ = np.gradient(hgt); slope = np.hypot(gx_, gy_)
passes = json.load(open(SP + 'umap/passes.json'))
MONK = ('Афон', 'монастыр', 'Метеор', 'Сумел', 'Синай', 'Лавра')
gaz = [(n, *topx(lo, la)) for n, lo, la in GAZ]
objs = nd.find_objects(pid)
out = []
for k, p in enumerate(P):
    sl = objs[k] if k < len(objs) else None
    if sl is None: continue
    msk = (pid[sl] == k + 1) & land[sl]
    if not msk.any(): continue
    y0, x0 = sl[0].start, sl[1].start
    name = p[4]; base = re.sub(r',\s*земля\s*\d+$', '', name)
    g = [(n, x, y) for n, x, y in gaz if 0 <= int(y) - y0 < msk.shape[0] and 0 <= int(x) - x0 < msk.shape[1] and msk[int(y) - y0, int(x) - x0]]
    cx, cy = int(p[1]), int(p[2])
    if g:
        n, x, y = min(g, key=lambda t: (t[1] - cx) ** 2 + (t[2] - cy) ** 2)
        kind = 'монастырь' if any(w in n for w in MONK) else 'город'; out.append({'prov': k, 'x': round(x, 1), 'y': round(y, 1), 'type': kind, 'name': n}); continue
    if any(w in name for w in MONK): out.append({'prov': k, 'x': cx, 'y': cy, 'type': 'монастырь', 'name': base}); continue
    mtn = 0 <= cy < H and 0 <= cx < W and (tc[cy, cx] != 255) and (tc[cy, cx] & (4 | 8))
    near_pass = any((pp[2] - cx) ** 2 + (pp[3] - cy) ** 2 <= 25 ** 2 for pp in passes)
    # «удобство»: равнина (малый уклон), у реки или дороги, подальше от края провинции
    inner = nd.distance_transform_edt(msk)
    sc = -slope[sl] * 2.0 - np.minimum(rivD[sl], 12) * 0.25 - np.minimum(roadD[sl], 12) * 0.3 + np.minimum(inner, 8) * 0.5
    t_ = tc[sl]; sc = sc - (((t_ & (4 | 8)) > 0) & (t_ != 255)) * 3 - (((t_ & 2) > 0) & (t_ != 255)) * 1.0
    sc[~msk | (inner < 3)] = -1e9
    i = int(np.argmax(sc)); yy, xx = y0 + i // msk.shape[1], x0 + i % msk.shape[1]
    if mtn or near_pass: out.append({'prov': k, 'x': cx, 'y': cy, 'type': 'крепость', 'name': base})
    else: out.append({'prov': k, 'x': int(xx), 'y': int(yy), 'type': 'деревня', 'name': base})
json.dump({'_': 'Поселения: по одной точке на провинцию (mksettle.py). Правится вручную: x, y — px карты; type — город / крепость / монастырь / деревня; name — подпись. '
           'Пересобрать заново: REGEN_SETTLEMENTS=1 python3 -I mksettle.py ..', 'settlements': out}, open(PATH, 'w'), ensure_ascii=False, indent=1)
save_game(out)
from collections import Counter
print('поселений', len(out), Counter(s['type'] for s in out))
