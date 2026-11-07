# Реки: линии из Natural Earth (rivers.json — вырезка ne_10m_rivers_lake_centerlines и ne_10m_rivers_europe,
# общественное достояние, naturalearthdata.com) переводятся в пиксели карты той же проекцией, что подогнана к карте автора
# (umap/fit.json), и рисуются со сглаживанием. Толщина — по величине реки (scalerank).
# Выход: umap/rivers.npy — маска 0..255 (полная карта), её используют mkmap3.py (подложка) и ids.png (реки видны сквозь цвет державы).
import json, os, glob
import numpy as np
from PIL import Image, ImageDraw
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
fit = json.load(open(SP + 'umap/fit.json'))
P = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*political*.png'))[0]).convert('RGB')).astype(np.int32)
kP = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
H, W = kP.shape
k = W / fit.get('W', 2000); l0, sx, p0, sy = fit['p'][0], fit['p'][1] * k, fit['p'][2], fit['p'][3] * k
S = 2
img = Image.new('L', (W * S, H * S), 0); d = ImageDraw.Draw(img)
def width(r):
    r = 12 if r is None else r
    return 2.8 if r <= 3 else 2.3 if r <= 6 else 1.9 if r <= 9 else 1.6 if r <= 10 else 1.35
n = 0
for rv in json.load(open(SP + 'rivers.json')):
    if rv['f'] == 'Lake Centerline': continue
    pts = [((x - l0) * sx * S, (p0 - y) * sy * S) for x, y in rv['c']]
    if len(pts) < 2: continue
    w = width(rv['r']); val = 150 if rv['f'] == 'Intermittent River' else 255
    d.line(pts, fill=val, width=max(1, round(w * S)), joint='curve'); n += 1
m = np.asarray(img.resize((W, H), Image.LANCZOS)).astype(np.uint8)
sea = np.isin(kP, [0x001F48, 0x000020])
# там, где реку уже нарисовал автор (Дунай, Нил, Тигр, Евфрат…), линию Natural Earth не рисуем: ближе 14 px к воде автора — убираем
import scipy.ndimage as nd
near = nd.distance_transform_edt(~sea) < 14
m[near] = 0
np.save(SP + 'umap/rivers.npy', m)
print('рек', n, 'пикселей реки', int((m > 60).sum()))
