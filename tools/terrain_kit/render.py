# Проба «фона кодом»: Мраморное море и Вифиния в целевом стиле (тёплый свет, массы гор и лесов, мелководье).
# Запуск: python3 render.py ПАПКА_tools ВЫХОД.jpg
import sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

T = sys.argv[1].rstrip('/') + '/'
OUT = sys.argv[2]
X0, Y0, X1, Y1 = 1820, 880, 2720, 1440
S = 2                                   # рисуем вдвое крупнее исходной сетки — как при приближении

rng = np.random.default_rng(7)
m = np.load(T + 'umap/masks.npz')
def crop(a): return a[Y0:Y1, X0:X1]
def up(a, order=1): return nd.zoom(a.astype(np.float32), (S, S) + (1,) * (a.ndim - 2), order=order)

hgt = up(crop(np.asarray(Image.open(T + 'terrain/height.png')).astype(np.float32)), 3)
land = nd.gaussian_filter(up(crop(m['land']), 1), 1.6) > 0.5
water = ~land
lakes = crop(m['water'] & ~m['cleanwater'])
_a = np.asarray(Image.open(T + '../map.jpg').convert('RGB')).astype(int)[Y0:Y1, X0:X1]
_rv = (_a[..., 2] > _a[..., 0] + 25) & (_a[..., 2] > _a[..., 1]) & crop(m['land'])
_rv &= ~nd.binary_dilation(crop(m['cleanwater']), iterations=3)
_lab, _n = nd.label(_rv, np.ones((3, 3))); _sz = nd.sum(_rv, _lab, range(1, _n + 1))
_rv = np.isin(_lab, 1 + np.nonzero(_sz >= 40)[0])
rivers = nd.gaussian_filter(up(_rv, 1), 1.0) > 0.35
inland = (nd.gaussian_filter(up(lakes, 1), 1.6) > 0.5) | rivers      # реки и озёра
forest = up(crop(m['forest']), 1)
ridge = up(crop(m['ridge'] | m['mtn']), 1)
H, W = land.shape

def noise(scale, octaves=4):
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        s = max(1, scale / 2 ** o)
        n = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), s)
        n /= n.std() + 1e-6; out += amp * n; tot += amp; amp *= 0.5
    return out / tot

# ---------- рельеф: сглаженная высота, свет с северо-запада, тёплый свет / холодная тень ----------
h = nd.gaussian_filter(hgt, 3.0)
h = h - h[land].min() if land.any() else h
h = np.where(land, h, 0)
_ex = 1.2 + 2.2 * np.clip((h / max(h.max(), 1) - 0.15) / 0.5, 0, 1)
dy, dx = np.gradient(h * _ex)
lx, ly, lz = -0.62, -0.62, 0.48                         # свет сверху-слева, низкое солнце
nlen = np.sqrt(dx * dx + dy * dy + 1)
shade = (-dx * lx - dy * ly + lz) / nlen                   # освещённость
shade = np.clip((shade - lz / 1.0) * 1.6, -1, 1)
cavity = np.clip((nd.gaussian_filter(h, 8) - h) / 6, -1, 1)  # впадины темнее, гребни светлее

# ---------- палитра Средиземноморья ----------
def C(hexs): return np.array([int(hexs[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255
plain_lo = C('#b9ab6a')     # сухая равнина (охра)
plain_gr = C('#8f9a55')     # олива / низины
hill_c   = C('#a88f5c')     # холмы
mtn_c    = C('#9a8a78')     # скальные горы
snow_c   = C('#f1ece0')
hn = np.clip(h / max(h.max(), 1), 0, 1)
low_green = np.clip(nd.gaussian_filter(inland.astype(np.float32), 18) * 6 + noise(60) * 0.25, 0, 1)
base = plain_lo * (1 - low_green[..., None]) + plain_gr * low_green[..., None]
t_hill = np.clip((hn - 0.18) / 0.25, 0, 1)[..., None]
t_mtn = np.clip((hn - 0.45) / 0.25, 0, 1)[..., None]
base = base * (1 - t_hill) + hill_c * t_hill
base = base * (1 - t_mtn) + mtn_c * t_mtn
ref = up(nd.gaussian_filter(crop(np.asarray(Image.open(T + 'terrain/color.jpg')).astype(np.float32) / 255), (6, 6, 0)), 1)
ref = ref / (ref.mean(axis=(0, 1)) + 1e-6) * base.mean(axis=(0, 1))     # тон эталона, яркость нашей палитры
base = base * 0.55 + ref * 0.45
base = base * (1 + 0.06 * noise(25)[..., None])           # живая неровность заливки

warm = C('#fff1c8'); cool = C('#3d4a6b')
sh = shade[..., None]
lit = base * (1 - np.clip(sh, 0, 1) * 0.55) + warm * np.clip(sh, 0, 1) * 0.55
lit = lit * (1 - np.clip(-sh, 0, 1) * 0.55) + (base * cool * 1.6) * np.clip(-sh, 0, 1) * 0.55
lit = lit * (1 - 0.25 * np.clip(cavity, 0, 1)[..., None])
img = lit

# ---------- лес: цельные массы крон с тенью ----------
fmask = nd.gaussian_filter(forest, 3) + 0.18 * noise(6)
fm = fmask > 0.42
fm = nd.binary_opening(fm, iterations=2) & land
# кроны: случайные центры, у каждой — шарик с освещением слева-сверху
SP_ = 6.5
gy, gx = np.mgrid[0:H:SP_, 0:W:SP_]
cy = (gy + rng.uniform(-2.5, 2.5, gy.shape)).astype(int).clip(0, H - 1)
cx = (gx + rng.uniform(-2.5, 2.5, gx.shape)).astype(int).clip(0, W - 1)
seed = np.ones((H, W), bool); seed[cy, cx] = False
rad = np.zeros((H, W), np.float32); rad[cy, cx] = rng.uniform(3.6, 5.2, cy.shape)
d, (iy, ix) = nd.distance_transform_edt(seed, return_indices=True)
r = rad[iy, ix]
ox = (np.mgrid[0:H, 0:W][1] - ix) / r; oy = (np.mgrid[0:H, 0:W][0] - iy) / r
inside = d < r
nz = np.sqrt(np.clip(1 - ox * ox - oy * oy, 0, 1))
cl = np.clip(-(ox * lx + oy * ly) * 0.9 + nz * lz + 0.15, 0, 1)
cl = np.where(inside, cl, 0.0)                                   # между кронами — тень
cl = cl * np.clip(nd.distance_transform_edt(fm) / 5, 0.6, 1)
f_dark = C('#22361d'); f_mid = C('#4b6a2e'); f_lit = C('#9aa64a')
fcol = f_dark * (1 - cl[..., None]) + f_mid * cl[..., None]
fcol = fcol * (1 - np.clip(cl - 0.6, 0, 1)[..., None] * 2) + f_lit * np.clip(cl - 0.6, 0, 1)[..., None] * 2
fcol = fcol * (0.8 + 0.45 * np.clip(sh, -0.6, 1))              # общий рельеф виден и сквозь лес
shadow = nd.shift((nd.binary_dilation(fm, iterations=3) & inside | fm).astype(np.float32), (4, 4), order=0)     # тень массива на юго-восток
shadow = nd.gaussian_filter(shadow, 2) * (~fm) * land
img = img * (1 - 0.35 * shadow[..., None])
fm = (fm | (nd.binary_dilation(fm, iterations=3) & inside)) & land     # кроны выступают за контур
img = np.where(fm[..., None], fcol, img)

# ---------- реки и озёра ----------
rv = inland & land | inland
river_c = C('#4f86a3')
img = np.where(rv[..., None], river_c * (0.9 + 0.1 * noise(8)[..., None]), img)
rbank = nd.binary_dilation(rv, iterations=1) & ~rv
img = np.where(rbank[..., None], img * 0.8, img)

# ---------- море: мелководье -> глубина, тень берега, кромка ----------
sea = water & ~inland
dist = nd.distance_transform_edt(sea) / S
shallow = C('#4aa7a6'); mid = C('#1f6f96'); deep = C('#163f6b')
t1 = np.clip(dist / 3.5, 0, 1)[..., None]; t2 = np.clip((dist - 3) / 45, 0, 1)[..., None]
seac = shallow * (1 - t1) + mid * t1
seac = seac * (1 - t2) + deep * t2
seac = seac * (1 + 0.04 * noise(40)[..., None])
land_sh = nd.gaussian_filter(nd.shift(land.astype(np.float32), (5, 5), order=0), 3) * sea
seac = seac * (1 - 0.35 * land_sh[..., None])
img = np.where(sea[..., None], seac, img)
coast = land & nd.binary_dilation(sea, iterations=2)
img = np.where(coast[..., None], img * 0.55 + C('#e8d9a8') * 0.45, img)       # светлая полоса пляжа/утёса
cline = sea & nd.binary_dilation(land, iterations=1)
img = np.where(cline[..., None], C('#24333f'), img)

# ---------- бумага / акварель ----------
paper = noise(1.2, 2) * 0.025 + noise(90, 2) * 0.03
img = img * (1 + paper[..., None])
img = np.clip(img, 0, 1)
Image.fromarray((img * 255).astype(np.uint8)).save(OUT, quality=90)
print('ok', img.shape)
