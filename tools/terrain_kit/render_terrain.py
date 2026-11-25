# Проба ближнего уровня: рельеф в наклонной проекции (2.5D) с тремя классами гор, холмами,
# перевалом и схематичными рощами. Всё — кодом из данных репозитория.
# Запуск: python3 render_close.py ПАПКА_tools X0 Y0 X1 Y1 ВЫХОД.jpg
import sys, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd

T = sys.argv[1].rstrip('/') + '/'
X0, Y0, X1, Y1 = map(int, sys.argv[2:6]); OUT = sys.argv[6]
S = 3
rng = np.random.default_rng(11)
m = np.load(T + 'umap/masks.npz')
def crop(a): return a[Y0:Y1, X0:X1]
def up(a, order=1): return nd.zoom(a.astype(np.float32), (S, S) + (1,) * (a.ndim - 2), order=order)
def C(h): return np.array([int(h[i:i + 2], 16) for i in (1, 3, 5)], np.float32) / 255

land = nd.gaussian_filter(up(crop(m['land'])), 2) > 0.5
H, W = land.shape
def noise(scale, octaves=4, ridged=False):
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        s = max(0.8, scale / 2 ** o)
        n = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), s); n /= n.std() + 1e-6
        if ridged: n = 1 - np.abs(n)
        out += amp * n; tot += amp; amp *= 0.5
    return out / tot

base_h = nd.gaussian_filter(up(crop(np.asarray(Image.open(T + 'terrain/height.png')).astype(np.float32)), 3), 3 * S)
base_h = np.where(land, base_h - np.percentile(base_h[land], 5), 0).clip(0)
hn = base_h / max(base_h.max(), 1)

# ---- классы рельефа ----
impass = nd.gaussian_filter(up(crop(m['mtn'] | nd.binary_dilation(m['ridge'], iterations=1))), 1.6 * S)
impass = np.clip(impass * 1.7, 0, 1) * land                       # непроходимые хребты
hi = np.clip((nd.gaussian_filter(hn, 4 * S) - 0.42) / 0.12, 0, 1)
low_ridge = impass * (1 - hi)
impass = impass * hi
passable = np.clip(np.clip((hn - 0.35) / 0.25, 0, 1) + low_ridge * 1.5, 0, 1) * (1 - impass) * land  # проходимые горы
hills = np.clip((hn - 0.12) / 0.2, 0, 1) * (1 - passable) * (1 - impass) * land

# перевалы из графа связей
passes = []
for p in json.load(open(T + 'umap/passes.json')):
    x, y = (p[2] - X0) * S, (p[3] - Y0) * S
    if 0 <= x < W and 0 <= y < H: passes.append((x, y))
yy, xx = np.mgrid[0:H, 0:W]
saddle = np.zeros((H, W), np.float32)
for x, y in passes:
    saddle = np.maximum(saddle, np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * (15 * S) ** 2)))
impass = impass * (1 - saddle)

# ---- высота для отрисовки: плавная основа + пики по классам ----
peaks = np.clip(noise(22, 2, ridged=True) * 0.55 + 0.45, 0, 1.4) ** 2.6   # крупные пирамиды, не иглы
z = base_h * 0.35
z += impass * 14                      # под нарисованными вершинами — лишь подъём земли
z += passable * 8
z += hills * (3 + 6 * np.clip(noise(18, 2) * 0.5 + 0.5, 0, 1.5))
z = nd.gaussian_filter(z, 1.5)

# ---- цвет поверхности (вид сверху) ----
grass = C('#9aa35a'); dry = C('#b9ad72'); hillc = C('#a4945e'); rock = C('#a39b8e'); rock_d = C('#6e6a66'); snow = C('#f3f1ea')
gw = np.clip(noise(60, 3) * 0.25 + 0.45, 0, 1)[..., None]
col = dry * (1 - gw) + grass * gw
col = col * (1 + 0.04 * noise(6, 2))[..., None]
col = col * (1 - hills[..., None] * 0.6) + hillc * hills[..., None] * 0.6
dzy, dzx = np.gradient(z)
slope = np.sqrt(dzx ** 2 + dzy ** 2)
rockiness = np.clip((slope - 0.8) / 2.0, 0, 1) * np.clip(impass + passable, 0, 1)
greenmt = C('#7f8a52')
col = col * (1 - passable[..., None] * 0.7) + greenmt * passable[..., None] * 0.7
rockiness = rockiness * (0.35 + 0.65 * impass)
col = col * (1 - rockiness[..., None]) + (rock * (1 - impass[..., None] * 0.3) + rock_d * impass[..., None] * 0.3) * rockiness[..., None]
snowm = np.zeros_like(z)
snowm = np.clip(snowm + 0.15 * noise(3, 2) * (snowm > 0.05), 0, 1)
col = col * (1 - snowm[..., None]) + snow * snowm[..., None]

# свет: тёплый с северо-запада, холодная тень
lx, ly, lz = -0.6, -0.55, 0.58
n = np.sqrt(dzx ** 2 + dzy ** 2 + 1)
sh = (-dzx * lx - dzy * ly + lz) / n
sh = np.clip((sh - lz) * 1.8, -1, 1)[..., None]
warm = C('#fff0c4'); cool = C('#45506e')
col = col * (1 - np.clip(sh, 0, 1) * 0.45) + warm * np.clip(sh, 0, 1) * 0.45
col = col * (1 - np.clip(-sh, 0, 1) * 0.6) + col * cool * 1.5 * np.clip(-sh, 0, 1) * 0.6

# ---- рощи: островки деревьев с просветами (видно, где идёт войско) ----
fm = nd.gaussian_filter(up(crop(m['forest'] | m['conifer'])), 2 * S) + 0.12
fm = fm * (1 - impass)
clumps = (noise(5, 2) > 0.7) & (fm > 0.35) & land            # островки, между ними просветы
conif = up(crop(m['conifer'])) > 0.5
# у подножия гор — пояс ёлок
foot = (nd.gaussian_filter(impass + passable, 6) > 0.2) & (impass + passable < 0.35) & (noise(4, 2) > 1.0) & land
treepos = []
mtrees = (passable > 0.6) & (noise(4, 2) > 1.6) & land
clumps &= impass < 0.3; foot &= impass < 0.3
for mask, kind in ((clumps, 'd'), (foot, 'c'), (mtrees, 'c')):
    ys, xs = np.nonzero(mask[::8, ::8])
    for y, x in zip(ys * 8, xs * 8):
        treepos.append((x + rng.integers(-3, 4), y + rng.integers(-3, 4), 'c' if (kind == 'c' or conif[y, x]) else 'd'))

# ---- вода ----
sea = ~land
dist = nd.distance_transform_edt(sea) / S
water = C('#4aa7a6') * (1 - np.clip(dist / 4, 0, 1))[..., None] + C('#1d5f8c') * np.clip(dist / 4, 0, 1)[..., None]
col = np.where(sea[..., None], water, col)

# ---- наклонная проекция: столбцы рисуем от ближнего ряда к дальнему ----
K = 0.9                  # насколько высота поднимает точку на экране
TILT = 0.82              # сжатие по вертикали (наклон камеры)
SH = int(H * TILT) + 10; top_pad = int(z.max() * K) + 10
scr = np.zeros((SH + top_pad, W, 3), np.float32); scr[:] = C('#cfd8dc')
horizon = np.full(W, SH + top_pad, np.int32)
zz = np.where(sea, 0, z)
for y in range(H - 1, -1, -1):
    sy = (top_pad + y * TILT - zz[y] * K).astype(np.int32)
    lo = np.minimum(sy, horizon)
    for_cols = lo < horizon
    if for_cols.any():
        cs = np.nonzero(for_cols)[0]
        span = horizon[cs] - lo[cs]
        mx = span.max()
        rows = lo[cs][None, :] + np.arange(mx)[:, None]
        ok = rows < horizon[cs][None, :]
        c_rep = np.broadcast_to(col[y, cs], (mx, len(cs), 3))
        r = rows[ok]; c = np.broadcast_to(cs, (mx, len(cs)))[ok]
        # стенки обрыва чуть темнее верхней грани
        depth = np.broadcast_to(np.arange(mx)[:, None], (mx, len(cs)))[ok]
        scr[r, c] = c_rep[ok] * (1 - np.clip(depth / 40, 0, 0.25))[:, None]
        horizon[cs] = lo[cs]

scr = scr[:top_pad + int((H - 12) * TILT)]
img = Image.fromarray((np.clip(scr, 0, 1) * 255).astype(np.uint8))
dr = ImageDraw.Draw(img, 'RGBA')
def proj(x, y): return x, int(top_pad + y * TILT - zz[min(y, H - 1), min(x, W - 1)] * K)
# ================= нарисованные спрайты: горы, холмы, перевалы =================
# Наборы лежат в ART/<набор>/peak_*.png (вырезаны cut.py). Зеркалить нельзя: свет слева сверху.
import glob
ART = sys.argv[7].rstrip('/')
# цветокоррекция набора под землю карты: насыщенность и оттенок (нейросеть рисует слишком сочно)
GRADE = {'hills': (0.55, (0.93, 0.95, 0.82)), 'hills_d1': (0.55, (0.93, 0.95, 0.82)), 'hills_d2': (0.7, (0.95, 0.96, 0.86)),
         'hills_single': (0.55, (0.93, 0.95, 0.82)), 'lm_vulcano': (0.7, (0.97, 0.97, 0.92)), 'lm_etna': (0.85, (0.98, 0.98, 0.95)),
         'lm_vesuvius': (0.8, (0.96, 0.97, 0.9)), 'lm_ararat': (0.8, (0.97, 0.97, 0.93)), 'mtn_low': (0.8, (0.96, 0.97, 0.9)), 'mtn_low_single': (0.8, (0.96, 0.97, 0.9)),
         'ridges_low_h': (0.8, (0.96, 0.97, 0.9)), 'ridges_low_d1': (0.8, (0.96, 0.97, 0.9))}
def grade(im, name):
    if name not in GRADE: return im
    sat, tint = GRADE[name]
    a = np.asarray(im).astype(np.float32); rgb = a[..., :3]
    lum = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
    rgb = (lum[..., None] + (rgb - lum[..., None]) * sat) * np.array(tint, np.float32)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a[..., 3]]).astype(np.uint8), 'RGBA')
def load(name): return [grade(Image.open(f).convert('RGBA'), name) for f in sorted(glob.glob(f'{ART}/{name}/peak_*.png'))]
import os
SETS = {n: load(n) for n in sorted(os.listdir(ART)) if os.path.isdir(f'{ART}/{n}')}
#  размер на экране (ширина, px) и доля высоты спрайта до точки привязки (низ «подошвы»)
SIZE = {'peaks_snow': (140, 190), 'ridges_snow_h': (200, 250), 'ridges_snow_d1': (190, 240), 'ridges_snow_d2': (190, 240),
        'mtn_low': (110, 145), 'mtn_low_single': (95, 130), 'ridges_low_h': (150, 190), 'ridges_low_d1': (150, 190),
        'hills': (95, 125), 'hills_d1': (95, 125), 'hills_d2': (95, 125), 'hills_single': (70, 95),
        'pass_1': (235, 235), 'pass_1b': (235, 235), 'pass_2': (235, 235)}
ANCHOR = {'peaks_snow': 0.82, 'hills': 0.7, 'hills_d1': 0.7, 'hills_d2': 0.7, 'hills_single': 0.7,
          'pass_1': 0.7, 'pass_1b': 0.7, 'pass_2': 0.7}
# уникальные горы: (набор, широта, долгота, ширина на экране, привязка)
FIT = json.load(open(T + 'umap/fit.json')); KF = 5298 / FIT.get('W', 2000)
L0, SXF, P0, SYF = FIT['p'][0], FIT['p'][1] * KF, FIT['p'][2], FIT['p'][3] * KF
LANDMARKS = [('lm_etna', 37.75, 14.99, 380, 0.72), ('lm_vesuvius', 40.82, 14.43, 300, 0.72), ('lm_stromboli', 38.79, 15.21, 95, 0.62),
             ('lm_vulcano', 38.40, 14.96, 105, 0.55), ('lm_ararat', 39.70, 44.36, 400, 0.75), ('lm_athos', 40.16, 24.33, 240, 0.78),
             ('lm_sinai', 28.54, 33.98, 300, 0.72), ('lm_olympus', 40.09, 22.36, 320, 0.76), ('lm_olympus_bith', 40.07, 29.22, 330, 0.68),
             ('lm_erciyes', 38.53, 35.45, 300, 0.75), ('lm_elbrus', 43.35, 42.44, 350, 0.75)]
lm_here = []
ISLANDS = {'lm_stromboli', 'lm_vulcano'}
for name, la, lo, w, anc in LANDMARKS:
    x = ((lo - L0) * SXF - X0) * S; y = ((P0 - la) * SYF - Y0) * S
    if name in ISLANDS:                                  # остров: привязка к ближайшему острову карты
        lab_, n_ = nd.label(land); best = None
        for c in nd.find_objects(lab_):
            pass
        cy_, cx_ = np.array(nd.center_of_mass(land, lab_, range(1, n_ + 1))).T
        sz_ = nd.sum(land, lab_, range(1, n_ + 1))
        ok_ = sz_ < 0.002 * land.size                    # только небольшие острова
        d_ = (cx_ - x) ** 2 + (cy_ - y) ** 2; d_[~ok_] = 1e18
        i_ = int(np.argmin(d_))
        if d_[i_] < (90 * S) ** 2: x, y = cx_[i_], cy_[i_]
    if -100 <= x < W + 100 and -100 <= y < H + 100: lm_here.append((name, int(x), int(y), w, anc))
yy_, xx_ = np.mgrid[0:H, 0:W]
lm_block = np.zeros((H, W), bool)
for name, x, y, w, anc in lm_here: lm_block |= (xx_ - x) ** 2 + ((yy_ - y) * 1.6) ** 2 < (w * 0.5) ** 2
SIZE.update({n: (w, w) for n, _, _, w, _ in LANDMARKS}); ANCHOR.update({n: a for n, _, _, _, a in LANDMARKS})

# направление хребта по тензору структуры (0° — горизонталь, >0 — из верхнего левого в нижний правый)
mm = nd.gaussian_filter(passable + impass, 3 * S)
gyy, gxx = np.gradient(mm)
Jxx = nd.gaussian_filter(gxx * gxx, 6 * S); Jyy = nd.gaussian_filter(gyy * gyy, 6 * S); Jxy = nd.gaussian_filter(gxx * gyy, 6 * S)
ang = 0.5 * np.degrees(np.arctan2(2 * Jxy, Jxx - Jyy)) + 90
ang = (ang + 90) % 180 - 90
coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / (Jxx + Jyy + 1e-9)
def direction(y, x):
    if coh[y, x] < 0.2: return None
    a = ang[y, x]
    if abs(a) < 25: return 'h'
    if 25 <= a < 70: return 'd1'
    if -70 < a <= -25: return 'd2'
    return None                                  # почти вертикальный хребет — одиночные горы

items = [(y, 't', x, k) for x, y, k in treepos if not lm_block[min(max(y,0),H-1), min(max(x,0),W-1)]]
def add(y, x, name, scale=1.0):
    items.append((y, name, x, (int(rng.integers(len(SETS[name]))), scale)))

# 1) непроходимые: плотная цепь
step = 42
gy, gx = np.mgrid[step // 2:H:step, step // 2:W:int(step * 1.25)]
for y, x in zip(gy.ravel(), gx.ravel()):
    y = int(y + rng.integers(-8, 9)); x = int(x + rng.integers(-10, 11))
    if not (0 <= y < H and 0 <= x < W) or impass[y, x] <= 0.6 or saddle[y, x] >= 0.35 or lm_block[y, x]: continue
    d = direction(y, x)
    name = {'h': 'ridges_snow_h', 'd1': 'ridges_snow_d1', 'd2': 'ridges_snow_d2'}.get(d, 'peaks_snow')
    if rng.random() < 0.2: name = 'peaks_snow'                           # разнообразие
    add(y, x, name, 0.55 + 0.45 * np.clip((impass[y, x] - 0.6) / 0.3, 0, 1))

# 2) проходимые: отдельные горы по местным вершинам, с просветами между ними
def sparse(mask, score, mind):
    ys, xs = np.nonzero(mask)
    order = np.argsort(-score[ys, xs]); taken = []
    for i in order:
        y, x = ys[i], xs[i]
        if all((y - ty) ** 2 + ((x - tx) * 0.8) ** 2 > mind ** 2 for ty, tx in taken): taken.append((y, x))
    return taken
cand = (passable > 0.55) & (impass < 0.3) & (saddle < 0.35) & ~lm_block
cand[::3, :] = False; cand[:, ::3] = False                                  # прореживание для скорости
for y, x in sparse(cand, base_h + 4 * noise(8, 2), 92):
    d = direction(y, x)
    name = {'h': 'ridges_low_h', 'd1': 'ridges_low_d1', 'd2': 'mtn_low'}.get(d, 'mtn_low_single')
    add(y, x, name, 0.75 + 0.25 * np.clip((passable[y, x] - 0.55) / 0.3, 0, 1))

# 3) холмы: средние высоты вне гор + кольцо предгорий
hillzone = (np.clip((hn - 0.12) / 0.15, 0, 1) > 0.5) | (nd.gaussian_filter(passable + impass, 8 * S) > 0.12)
hillzone &= (passable < 0.35) & (impass < 0.2) & land & (saddle < 0.35) & ~lm_block
hillzone[::3, :] = False; hillzone[:, ::3] = False
for y, x in sparse(hillzone & (noise(30, 2) > 0.1), base_h + 6 * noise(10, 2), 95):
    d = direction(y, x)
    add(y, x, {'h': 'hills', 'd1': 'hills_d1', 'd2': 'hills_d2'}.get(d, 'hills_single'), rng.uniform(0.8, 1.0))

# 4) перевалы: вариант по направлению хребта (дорога поперёк хребта)
for x, y in passes:
    yi, xi = int(min(y, H - 1)), int(min(x, W - 1))
    add(yi, xi, 'pass_2' if ang[yi, xi] < -20 else ('pass_1' if rng.random() < 0.5 else 'pass_1b'))
for name, x, y, w, anc in lm_here:
    if 0 <= x < W and 0 <= y < H: items.append((y, name, x, (0, 1.0)))

items.sort(key=lambda t: t[0])
for y, name, x, k in items:
    if not (0 <= x < W and 0 <= y < H) or (sea[y, x] and not name.startswith('lm_')): continue
    px, py = proj(x, y)
    if name != 't':
        idx, scale = k
        lo, hi_ = SIZE[name]
        w = int(rng.uniform(lo, hi_) * scale) if not name.startswith('lm_') else lo
        src = SETS[name][idx]
        sp = src.resize((w, max(1, int(src.height * w / src.width))), Image.LANCZOS)
        img.paste(sp, (px - w // 2, py - int(sp.height * ANCHOR.get(name, 0.78))), sp)
        continue
    dr.ellipse((px - 2, py - 2, px + 9, py + 3), fill=(30, 35, 30, 90))
    if k == 'c':
        dr.polygon([(px, py - 17), (px - 6, py), (px + 6, py)], fill=(38, 64, 44, 255))
        dr.polygon([(px, py - 17), (px - 6, py), (px, py)], fill=(64, 98, 60, 255))
    else:
        dr.line((px, py, px, py - 5), fill=(70, 50, 35, 255), width=2)
        dr.ellipse((px - 6, py - 16, px + 6, py - 4), fill=(62, 88, 40, 255))
        dr.ellipse((px - 5, py - 15, px + 2, py - 9), fill=(118, 140, 62, 255))
img.save(OUT, quality=90)
from collections import Counter
print('ok', img.size, Counter(n for _, n, _, _ in items if n != 't'))
