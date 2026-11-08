# Маска открытого моря для анимации воды (волны, блики, пена у берегов): крупные водоёмы цвета моря
# (без рек и озёр) + береговая линия рядом с ними. Выход: ../sea.png — половинное разрешение, прозрачность = море.
import os, sys, glob
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
P = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*political*.png'))[0]).convert('RGB')).astype(np.int32)
k = (P[..., 0] << 16) | (P[..., 1] << 8) | P[..., 2]
sea = k == 0x001F48
lab, n = nd.label(sea)
sz = nd.sum(sea, lab, range(1, n + 1))
big = np.isin(lab, [i + 1 for i, v in enumerate(sz) if v > 150000])
big |= nd.binary_dilation(big, iterations=2) & (k == 0x000020)          # береговая линия у открытого моря
H, W = big.shape
m = Image.fromarray((big * 255).astype(np.uint8)).resize(((W + 1) // 2, (H + 1) // 2), Image.BOX)
Image.merge('LA', (Image.new('L', m.size, 255), m)).save(OUT + '/sea.png', optimize=True)   # море — непрозрачно, остальное прозрачно (для destination-in)
print('море, % карты:', round(big.mean() * 100, 1), os.path.getsize(OUT + '/sea.png') // 1024, 'КБ')
# пена у берегов: для моря в полосе до 5,5 px (половинное разрешение) — расстояние до суши и «шум» пены
# ../foam.png: R = расстояние × 28, G = шум, A = 255 в полосе прибоя
mh = np.asarray(m) > 127
dist = nd.distance_transform_edt(mh)
band = mh & (dist <= 5.5)
rng = np.random.default_rng(5)
def fbm(s):
    o = np.zeros(mh.shape, np.float32); a = 1.0
    for i in range(3): o += a * nd.gaussian_filter(rng.standard_normal(mh.shape).astype(np.float32), max(s / 2 ** i, .6)); a *= .5
    o -= o.min(); return o / (o.max() + 1e-6)
nz = fbm(3.0)
F = np.zeros(mh.shape + (4,), np.uint8)
F[..., 0] = np.clip(dist * 28, 0, 255); F[..., 1] = (nz * 255).astype(np.uint8); F[..., 3] = band * 255
F[~band] = 0   # вне полосы — пусто (файл сжимается)
Image.fromarray(F, 'RGBA').save(OUT + '/foam.png', optimize=True)
print('пена: пикселей полосы', int(band.sum()), os.path.getsize(OUT + '/foam.png') // 1024, 'КБ')
