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
# --- пена у берегов (../foam.png, половинное разрешение) ---
# суша для прибоя — всё, что не открытое море (береговая линия — тоже берег), считается в полном разрешении,
# а в половинное берётся «минимумом» по 2×2 — так крошечные острова не пропадают.
# R = (расстояние со знаком + 1) × 40; у маленьких островов полоса прибоя уже: d / охват × 5,5
# G = плавный шум (неровность пены), B = направление от берега в море (0..255 = 0..2π), A = сила берега (открытость) в полосе, 0 — вне её
seaO = big   # море + береговая линия: нарисованный контур берега проходит посередине этой линии
# расстояние со знаком (море +, суша −) в полном разрешении, затем среднее по 2×2 — граница берега проходит точно, без «ступенек»;
# ноль сдвинут на 0,75 px в море — под середину контура (иначе пена начинается в 1–2 px от нарисованного берега)
Ds = nd.distance_transform_edt(seaO); Dl = nd.distance_transform_edt(~seaO)
SDf = (np.where(seaO, Ds - 0.5, -(Dl - 0.5)) - 0.75).astype(np.float32)
Hh, Wh = (H + 1) // 2, (W + 1) // 2
SDp = np.pad(SDf, ((0, Hh * 2 - H), (0, Wh * 2 - W)), mode='edge')
Dh = SDp.reshape(Hh, 2, Wh, 2).mean(axis=(1, 3)) / 2                # в пикселях половинного разрешения
landh = Dh <= 0
# охват прибоя по размеру ближайшего куска суши: крошечный остров — узкое кольцо, материк — полная полоса
lab2, n2 = nd.label(landh | (nd.minimum_filter(SDf, 2)[::2, ::2][:Hh, :Wh] < 0))
area = np.bincount(lab2.ravel(), minlength=n2 + 1).astype(np.float32); area[0] = 1e9
_, (iy, ix) = nd.distance_transform_edt(lab2 == 0, return_indices=True)
near_area = area[lab2[iy, ix]]
reach = np.clip(1.5 + 0.8 * np.sqrt(near_area / np.pi), 1.5, 5.5)
reach = nd.gaussian_filter(reach.astype(np.float32), 3.0)          # плавно — без скачков на границе «чей берег ближе»
deff = np.where(Dh > 0, Dh * 5.5 / reach, Dh)
nearsea = nd.binary_dilation(np.asarray(m) > 60, iterations=2)
band = (Dh > -1) & (deff <= 5.3) & nearsea
# направление «от берега в море» — по градиенту сглаженного расстояния
Gs = nd.gaussian_filter(Dh.astype(np.float32), 1.5)
gy, gx = np.gradient(Gs)
ang = (np.arctan2(gy, gx) % (2 * np.pi)) / (2 * np.pi) * 255
# открытость: доля моря в радиусе ~25 px (бухты и проливы — тише)
openf = nd.uniform_filter((~landh).astype(np.float32), 51)
strength = np.clip(0.35 + 0.65 * np.clip((openf - 0.45) / 0.4, 0, 1), 0, 1)
rng = np.random.default_rng(5)
def fbm(s):
    o = np.zeros(landh.shape, np.float32); a = 1.0
    for i in range(3): o += a * nd.gaussian_filter(rng.standard_normal(landh.shape).astype(np.float32), max(s / 2 ** i, .6)); a *= .5
    o -= o.min(); return o / (o.max() + 1e-6)
nz = fbm(5.0)
F = np.zeros(landh.shape + (4,), np.uint8)
F[..., 0] = np.clip((deff + 1) * 40, 0, 255); F[..., 1] = (nz * 255).astype(np.uint8); F[..., 2] = ang.astype(np.uint8)
F[..., 3] = np.clip(strength * 254 + 1, 1, 255)
F[~band] = 0
Image.fromarray(F, 'RGBA').save(OUT + '/foam.png', optimize=True)
print('пена: пикселей полосы', int(band.sum()), 'островов', n2, os.path.getsize(OUT + '/foam.png') // 1024, 'КБ')
