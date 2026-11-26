# Ближний уровень рельефа: классы местности, расстановка нарисованных спрайтов (горы, холмы, перевалы, уникальные горы), атлас.
# Логика — по образцу terrain_kit/render_terrain.py (автор), но на всю карту и в пикселях карты (проба рисовала в 3× — размеры /3).
# Входы: umap/masks.npz, terrain/height.png, terrain/type.png, umap/passes.json, umap/fit.json, terrain_ranges.json (ручной список хребтов),
#        terrain_art/<набор>/peak_N.png (вырезаны terrain_kit/cut.py), ../icons.bin, ../icons2.bin (деревья акварели)
# Выходы: ../terrain_atlas.webp + ../terrain_sprites.json (атлас: место, размер, привязка; спрайты на карте; уникальные горы),
#         ../icons_t.bin, ../icons_t2.bin (деревья без тех, что под уникальными горами и на непроходимых хребтах — для ближнего уровня),
#         umap/tclass.npy — класс местности каждого пикселя (тот же, что на картинке; его читает mkroadcost.py для скорости).
# Запуск: python3 -I mkterrain_sprites.py ..
import os, sys, json, glob, struct
import numpy as np
from PIL import Image
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
ART = SP + 'terrain_art'
rng = np.random.default_rng(11)
m = np.load(SP + 'umap/masks.npz')
land = m['land']; H, W = land.shape
def noise(scale, octaves=4, ridged=False, r=rng):
    out = np.zeros((H, W), np.float32); amp = 1.0; tot = 0
    for o in range(octaves):
        s = max(0.8, scale / 2 ** o)
        n = nd.gaussian_filter(r.standard_normal((H, W)).astype(np.float32), s); n /= n.std() + 1e-6
        if ridged: n = 1 - np.abs(n)
        out += amp * n; tot += amp; amp *= 0.5
    return out / tot
FIT = json.load(open(SP + 'umap/fit.json')); KF = W / FIT.get('W', 2000)
L0, SXF, P0, SYF = FIT['p'][0], FIT['p'][1] * KF, FIT['p'][2], FIT['p'][3] * KF
topx = lambda lon, lat: ((lon - L0) * SXF, (P0 - lat) * SYF)
# ---------- высоты: как в пробе (основание и размах одинаковы во всех проверочных кадрах: ≈96 и ≈37) ----------
# высота над местным «полом» (окно ~150 px): плато (Анатолия, Армения) — не горы, как в пробе, где высота считалась от низа кадра
hraw = nd.gaussian_filter(np.asarray(Image.open(SP + 'terrain/height.png')).astype(np.float32), 3)
hl = np.where(land, hraw, 255)
floor_ = nd.gaussian_filter(nd.minimum_filter(nd.grey_erosion(hl, size=(9, 9)), size=151).astype(np.float32), 40)
floor_ = np.maximum(np.minimum(floor_, hraw), 96)            # у моря «пол» не ниже уровня берега
base_h = np.where(land, hraw - floor_, 0).clip(0)
hn = base_h / 37.0
# ---------- классы рельефа ----------
imp0 = nd.gaussian_filter((m['mtn'] | nd.binary_dilation(m['ridge'], iterations=1)).astype(np.float32), 1.6)
imp0 = np.clip(imp0 * 1.7, 0, 1) * land
hi = np.clip((nd.gaussian_filter(hn, 4) - 0.42) / 0.12, 0, 1)
# непроходимы только хребты из ручного списка; остальное понижено до проходимых гор
RANGES = json.load(open(SP + 'terrain_ranges.json'))['ranges']
listed = np.zeros((H, W), np.float32)
yy, xx = np.mgrid[0:H, 0:W]
for r in RANGES:
    (x0, y1), (x1, y0) = topx(r['box'][0], r['box'][1]), topx(r['box'][2], r['box'][3])
    box = (xx >= x0) & (xx <= x1) & (yy >= y0) & (yy <= y1)
    listed[box] = 1.0 if r['class'] == 'impassable' else 0.0
del yy, xx
listed = nd.gaussian_filter(listed, 6)                     # мягкий край рамки
impass = imp0 * hi * listed
low_ridge = imp0 * (1 - hi) + imp0 * hi * (1 - listed)
passable = np.clip(np.clip((hn - 0.35) / 0.25, 0, 1) + low_ridge * 1.5, 0, 1) * (1 - impass) * land
# перевалы: радиус ~15 px без обычных гор
PASSES = json.load(open(SP + 'umap/passes.json'))
saddle = np.zeros((H, W), np.float32)
for p in PASSES:
    x, y = int(p[2]), int(p[3]); r0 = 40
    ys, xs = slice(max(0, y - r0), min(H, y + r0)), slice(max(0, x - r0), min(W, x + r0))
    gy, gx = np.mgrid[ys, xs]
    saddle[ys, xs] = np.maximum(saddle[ys, xs], np.exp(-((gx - x) ** 2 + (gy - y) ** 2) / (2 * 15.0 ** 2)))
impass *= (1 - saddle)
# холмы: средние высоты вне гор + кольцо предгорий
mtn_any = passable + impass
hillv = np.clip((hn - 0.12) / 0.15, 0, 1)
foot = nd.gaussian_filter(mtn_any, 8)
hills_m = ((hillv > 0.5) & (hn < 0.35 + 0.1) | (foot > 0.12)) & (passable < 0.35) & (impass < 0.2) & land
# ---------- уникальные горы ----------
LANDMARKS = [   # набор, широта, долгота, ширина (px экрана пробы, 3× карты), привязка, название, справка
 ('lm_etna', 37.75, 14.99, 380, 0.72, 'Этна', 'Высочайший действующий вулкан Европы. Извергался в 1284–1285, 1321–1328, 1329 и 1333–1334, 1350 гг.'),
 ('lm_vesuvius', 40.82, 14.43, 300, 0.72, 'Везувий', 'Вулкан над Неаполитанским заливом. В XIII–XIV вв. спит: последнее сильное извержение — 1139 г.'),
 ('lm_stromboli', 38.79, 15.21, 95, 0.62, 'Стромболи', '«Маяк Средиземноморья»: вулкан, который не затихает — над кратером всегда дым и отсветы.'),
 ('lm_vulcano', 38.40, 14.96, 105, 0.55, 'Вулкано', 'Остров, давший имя всем вулканам: здесь древние помещали кузницу Гефеста. Курится белым паром.'),
 ('lm_ararat', 39.70, 44.36, 400, 0.75, 'Арарат', 'Двуглавая гора, на которой, по преданию, остановился Ноев ковчег.'),
 ('lm_athos', 40.16, 24.33, 200, 0.78, 'Афон', 'Святая Гора — монашеская республика, сердце православного монашества.'),
 ('lm_sinai', 28.54, 33.98, 300, 0.72, 'Синай', 'Гора Моисея; у подножия — монастырь Святой Екатерины.'),
 ('lm_olympus', 40.09, 22.36, 320, 0.76, 'Олимп', 'Высочайшая гора Эллады, обитель древних богов.'),
 ('lm_olympus_bith', 40.07, 29.22, 330, 0.68, 'Олимп Вифинский', 'Гора над Бурсой; на её склонах — древние монастыри (ныне Улудаг).'),
 ('lm_erciyes', 38.53, 35.45, 300, 0.75, 'Эрджиес (Аргей)', 'Потухший вулкан над Кесарией Каппадокийской, высочайшая гора Анатолии.'),
 ('lm_elbrus', 43.35, 42.44, 350, 0.75, 'Эльбрус', 'Высочайшая вершина Кавказа и Европы.'),
]
ISLANDS = {'lm_stromboli', 'lm_vulcano'}
lab_, n_ = nd.label(land); cy_, cx_ = np.array(nd.center_of_mass(land, lab_, range(1, n_ + 1))).T; sz_ = nd.sum(land, lab_, range(1, n_ + 1))
# ручные точки (landmarks.json): пиксели карты и ширина; правятся по скриншотам. LANDMARKS выше — исходные широта/долгота (справочно)
lms = [dict(l, w=float(l['w'])) for l in json.load(open(SP + 'landmarks.json'))['landmarks']]
# ---------- модели, заменяющие кусок карты: Афон (lm_athos_base) — вписывается по рамке суши полуострова Акти ----------
models = []
lm_block = np.zeros((H, W), bool)
for l in lms:
    if l.get('model') != 'athos': continue
    from PIL import Image as _I
    A_ = np.asarray(_I.open(ART + '/lm_athos_base/sheet.webp').convert('RGB')).astype(np.float32)
    ml = nd.binary_opening(~(np.clip(((A_[..., 0] + A_[..., 2]) / 2 - A_[..., 1] - 60) / 80, 0, 1) > 0.5))
    sy_, sx_ = np.nonzero(ml); sx0, sx1, sy0, sy1 = sx_.min(), sx_.max() + 1, sy_.min(), sy_.max() + 1
    BX = (1683, 1068, 1764, 1129); sub = land[BX[1]:BX[3], BX[0]:BX[2]].copy(); sub[:, :1687 - BX[0]] = False   # отрезано по перешейку x ≈ 1687
    lb, nl_ = nd.label(sub); pen = lb == (np.argmax(nd.sum(sub, lb, range(1, nl_ + 1))) + 1)
    py_, px_ = np.nonzero(pen); mx0, mx1, my0, my1 = BX[0] + px_.min(), BX[0] + px_.max() + 1, BX[1] + py_.min(), BX[1] + py_.max() + 1
    kx, ky = (mx1 - mx0) / (sx1 - sx0), (my1 - my0) / (sy1 - sy0)
    pk = _I.open(ART + '/lm_athos_base/peak_0.png').convert('RGBA'); dx, dy = sx0 - 3, sy0 - 3   # peak_0 — вырезка листа с отступом 3 px
    box = [round(mx0 + (dx - sx0) * kx, 2), round(my0 + (dy - sy0) * ky, 2), round(mx0 + (dx + pk.width - sx0) * kx, 2), round(my0 + (dy + pk.height - sy0) * ky, 2)]
    pk.resize((600, round(pk.height * 600 / pk.width)), _I.LANCZOS).save(OUT + '/athos_model.webp', quality=88, method=6)
    SL = json.load(open(SP + 'terrain_kit/athos_slots.json'))
    slots = {k: [round(mx0 + (x - sx0) * kx, 2), round(my0 + (y - sy0) * ky, 2)] for k, (x, y) in SL['slots'].items()}
    models.append({'id': 'athos', 'file': 'athos_model.webp', 'box': box, 'land': [int(mx0), int(my0), int(mx1), int(my1)], 'isthmus': 1687,
                   'slots': slots, 'w': {'ord': round(72 * kx, 2), 'ruin': round(72 * kx, 2), 'big': round(84 * kx, 2), 'karyes': round(80 * kx, 2)}, 'anchor': SL['anchor']})
    l['box'] = box
    lm_block[int(box[1]):int(box[3]) + 1, int(box[0]):int(box[2]) + 1] = True      # под моделью — ни гор, ни холмов, ни деревьев
for l in lms:
    if l.get('model'): continue
    r0 = int(l['w'] * 0.6) + 2; x, y = int(l['x']), int(l['y'])
    ys, xs = slice(max(0, y - r0), min(H, y + r0)), slice(max(0, x - r0), min(W, x + r0))
    gy, gx = np.mgrid[ys, xs]
    lm_block[ys, xs] |= (gx - x) ** 2 + ((gy - y) * 1.6) ** 2 < (l['w'] * 0.5) ** 2
# ---------- направление хребта: тензор структуры ----------
mm = nd.gaussian_filter(passable + impass, 3)
gyy, gxx = np.gradient(mm)
Jxx = nd.gaussian_filter(gxx * gxx, 6); Jyy = nd.gaussian_filter(gyy * gyy, 6); Jxy = nd.gaussian_filter(gxx * gyy, 6)
ang = 0.5 * np.degrees(np.arctan2(2 * Jxy, Jxx - Jyy)) + 90
ang = (ang + 90) % 180 - 90
coh = np.sqrt((Jxx - Jyy) ** 2 + 4 * Jxy ** 2) / (Jxx + Jyy + 1e-9)
def direction(y, x):
    if coh[y, x] < 0.2: return None
    a = ang[y, x]
    if abs(a) < 25: return 'h'
    if 25 <= a < 70: return 'd1'
    if -70 < a <= -25: return 'd2'
    return None
# ---------- расстановка ----------
SIZE = {'peaks_snow': (140, 190), 'ridges_snow_h': (200, 250), 'ridges_snow_d1': (190, 240), 'ridges_snow_d2': (190, 240),
        'mtn_low': (110, 145), 'mtn_low_single': (95, 130), 'ridges_low_h': (150, 190), 'ridges_low_d1': (150, 190),
        'hills': (95, 125), 'hills_d1': (95, 125), 'hills_d2': (95, 125), 'hills_single': (70, 95),
        'pass_1': (235, 235), 'pass_1b': (235, 235), 'pass_2': (235, 235)}
ANCHOR = {'peaks_snow': 0.82, 'hills': 0.7, 'hills_d1': 0.7, 'hills_d2': 0.7, 'hills_single': 0.7, 'pass_1': 0.7, 'pass_1b': 0.7, 'pass_2': 0.7}
NV = {n: len(glob.glob(f'{ART}/{n}/peak_*.png')) for n in os.listdir(ART) if os.path.isdir(f'{ART}/{n}')}
items = []
def add(y, x, name, scale=1.0):
    lo, hi_ = SIZE[name]
    items.append((int(y), name, int(x), int(rng.integers(NV[name])), round(float(rng.uniform(lo, hi_) * scale / 3), 1)))
sea = ~land
# 1) непроходимые: плотная цепь (шаг ~14 px), спрайты перекрываются
step = 14
gy, gx = np.mgrid[step // 2:H:step, step // 2:W:int(step * 1.25)]
for y, x in zip(gy.ravel(), gx.ravel()):
    y = int(y + rng.integers(-3, 4)); x = int(x + rng.integers(-3, 4))
    if not (0 <= y < H and 0 <= x < W) or impass[y, x] <= 0.6 or saddle[y, x] >= 0.35 or lm_block[y, x]: continue
    d = direction(y, x)
    name = {'h': 'ridges_snow_h', 'd1': 'ridges_snow_d1', 'd2': 'ridges_snow_d2'}.get(d, 'peaks_snow')
    if rng.random() < 0.2: name = 'peaks_snow'
    add(y, x, name, 0.55 + 0.45 * np.clip((impass[y, x] - 0.6) / 0.3, 0, 1))
# 2) проходимые и холмы: разреженно, по убыванию высоты, с минимальным расстоянием (сетка ускоряет проверку)
def sparse(mask, score, mind):
    ys, xs = np.nonzero(mask)
    order = np.argsort(-score[ys, xs]); taken = []; cell = {}; cs = mind
    for i in order:
        y, x = int(ys[i]), int(xs[i]); cy, cx = y // cs, x // cs; ok = True
        for a in (cy - 1, cy, cy + 1):
            for b in (cx - 2, cx - 1, cx, cx + 1, cx + 2):
                for ty, tx in cell.get((a, b), ()):
                    if (y - ty) ** 2 + ((x - tx) * 0.8) ** 2 <= mind ** 2: ok = False; break
                if not ok: break
            if not ok: break
        if ok: taken.append((y, x)); cell.setdefault((cy, cx), []).append((y, x))
    return taken
cand = (passable > 0.55) & (impass < 0.3) & (saddle < 0.35) & ~lm_block
for y, x in sparse(cand, base_h + 4 * noise(8 / 3 * 3, 2), 31):
    d = direction(y, x)
    add(y, x, {'h': 'ridges_low_h', 'd1': 'ridges_low_d1', 'd2': 'mtn_low'}.get(d, 'mtn_low_single'), 0.75 + 0.25 * np.clip((passable[y, x] - 0.55) / 0.3, 0, 1))
hz = hills_m & (saddle < 0.35) & ~lm_block & (noise(10, 2) > 0.1)
for y, x in sparse(hz, base_h + 6 * noise(10 / 3 * 3, 2), 32):
    d = direction(y, x)
    add(y, x, {'h': 'hills', 'd1': 'hills_d1', 'd2': 'hills_d2'}.get(d, 'hills_single'), rng.uniform(0.8, 1.0))
# 3) перевалы: дорога поперёк хребта
for p in PASSES:
    x, y = int(p[2]), int(p[3])
    if 0 <= x < W and 0 <= y < H:
        add(y, x, 'pass_2' if ang[y, x] < -20 else ('pass_1' if rng.random() < 0.5 else 'pass_1b'))
# только игровая зона; под точкой привязки ≥60% суши в радиусе полуширины; прибрежные (у подножия есть вода) помечаются — игра подрежет подножие
zone = nd.binary_dilation(m['zone'], iterations=2) & land
landf = land.astype(np.float32); ii = landf.cumsum(0).cumsum(1)
def land_frac(y, x, r):
    y0, y1, x0, x1 = max(0, y - r), min(H - 1, y + r), max(0, x - r), min(W - 1, x + r)
    s_ = ii[y1, x1] - (ii[y0 - 1, x1] if y0 else 0) - (ii[y1, x0 - 1] if x0 else 0) + (ii[y0 - 1, x0 - 1] if y0 and x0 else 0)
    return s_ / ((y1 - y0 + 1) * (x1 - x0 + 1))
items2 = []
for t in items:
    y, name, x, v, w = t
    if not zone[y, x]: continue
    r = max(2, int(w / 2))
    if land_frac(y, x, r) < 0.6: continue
    coast = land_frac(y, x, max(2, int(w * 0.35))) < 0.999 or land_frac(y + 3, x, max(2, int(w * 0.35))) < 0.999
    items2.append((y, name, x, v, w, int(coast)))
items = items2
items.sort(key=lambda t: t[0])
# ---------- классы местности для движения (те же, что на картинке) ----------
# биты (несколько классов сразу — для скорости берётся минимальный множитель): 1 холмы, 2 лес, 4 проходимые горы, 8 непроходимые,
# 16 болото, 32 пустыня, 64 степь; 0 — равнина; 255 — вода
ter = np.asarray(Image.open(SP + 'terrain/type.png'))
tc = np.zeros((H, W), np.uint8)
tc[ter == 4] |= 64
tc[np.isin(ter, (3, 19))] |= 32
tc[ter == 9] |= 16
tc[hills_m] |= 1
tc[(m['forest'] | m['conifer']) & land] |= 2
tc[(passable > 0.5) & land] |= 4
tc[(impass > 0.5) & land] |= 8
tc[~land] = 255
np.save(SP + 'umap/tclass.npy', tc)
# ---------- атлас: спрайты с цветокоррекцией (GRADE), в 2/3 от исходного (≈4 точки на пиксель карты) ----------
GRADE = {'hills': (0.55, (0.93, 0.95, 0.82)), 'hills_d1': (0.55, (0.93, 0.95, 0.82)), 'hills_d2': (0.7, (0.95, 0.96, 0.86)),
         'hills_single': (0.55, (0.93, 0.95, 0.82)), 'lm_vulcano': (0.7, (0.97, 0.97, 0.92)), 'lm_etna': (0.85, (0.98, 0.98, 0.95)),
         'lm_etna_active': (0.85, (0.98, 0.98, 0.95)), 'lm_etna_erupt': (0.85, (0.98, 0.98, 0.95)),
         'lm_vesuvius': (0.8, (0.96, 0.97, 0.9)), 'lm_ararat': (0.8, (0.97, 0.97, 0.93)), 'mtn_low': (0.8, (0.96, 0.97, 0.9)), 'mtn_low_single': (0.8, (0.96, 0.97, 0.9)),
         'ridges_low_h': (0.8, (0.96, 0.97, 0.9)), 'ridges_low_d1': (0.8, (0.96, 0.97, 0.9))}
def grade(im, name):
    if name not in GRADE: return im
    sat, tint = GRADE[name]
    a = np.asarray(im).astype(np.float32); rgb = a[..., :3]
    lum = rgb @ np.array([0.3, 0.59, 0.11], np.float32)
    rgb = (lum[..., None] + (rgb - lum[..., None]) * sat) * np.array(tint, np.float32)
    return Image.fromarray(np.dstack([np.clip(rgb, 0, 255), a[..., 3]]).astype(np.uint8), 'RGBA')
used = {t[1] for t in items} | {l['set'] for l in lms if not l.get('model')} | {'lm_etna_active', 'lm_etna_erupt', 'athos_monasteries', 'athos_karyes'}
spr = []
for n in sorted(used):
    for k in range(NV[n]):
        im = grade(Image.open(f'{ART}/{n}/peak_{k}.png').convert('RGBA'), n)
        mw = 900 if n.startswith(('lm_', 'pass_')) else 270
        if im.width > mw: im = im.resize((mw, max(1, round(im.height * mw / im.width))), Image.LANCZOS)
        spr.append((n, k, im))
AW = 4096; x = y = rowh = 0; rects = {}
spr.sort(key=lambda t: -t[2].height)
for n, k, im in spr:
    if x + im.width + 2 > AW: x = 0; y += rowh + 2; rowh = 0
    rects.setdefault(n, {})[k] = [x, y, im.width, im.height]; x += im.width + 2; rowh = max(rowh, im.height)
atlas = Image.new('RGBA', (AW, y + rowh), (0, 0, 0, 0))
for n, k, im in spr: r = rects[n][k]; atlas.paste(im, (r[0], r[1]))
atlas.save(OUT + '/terrain_atlas.webp', quality=86, method=6)
sets = {n: {'anchor': ANCHOR.get(n, next((l['anchor'] for l in lms if l['set'] == n), 0.78)) if not n.startswith('athos_') else 0.78, 'r': [rects[n][k] for k in range(NV[n])]} for n in rects}
for n in ('lm_etna_active', 'lm_etna_erupt'): sets[n]['anchor'] = sets['lm_etna']['anchor']
json.dump({'sets': sets, 'items': [[t[1], t[3], t[2], t[0], t[4], t[5]] for t in items], 'landmarks': lms, 'models': models,
           'ischia': [round(v, 1) for v in topx(13.90, 40.73)]},
          open(OUT + '/terrain_sprites.json', 'w'), ensure_ascii=False, separators=(',', ':'))
# ---------- деревья для ближнего уровня: без тех, что под уникальными горами и на непроходимых хребтах ----------
block_t = lm_block | (impass > 0.3) | ~zone
# рощи с просветами: примерно вдвое реже, островками (крупный шум), а не ковром
grove = noise(6, 2, r=np.random.default_rng(77)) > 0.0
for var in ('', '2'):
    b = open(OUT + f'/icons{var}.bin', 'rb').read(); nm, nt = struct.unpack('<II', b[:8]); o = 8 + nm * 48
    keep = []
    for i in range(nt):
        rec = b[o + i * 6:o + i * 6 + 6]; tx, ty = struct.unpack('<HH', rec[:4])
        X, Y = min(W - 1, tx // 8), min(H - 1, ty // 8)
        if not block_t[Y, X] and grove[Y, X]: keep.append(rec)
    open(OUT + f'/icons_t{var}.bin', 'wb').write(struct.pack('<II', 0, len(keep)) + b''.join(keep))
from collections import Counter
print('спрайтов', len(items), Counter(t[1] for t in items).most_common(), '\nуникальных гор', [(l['name'], l['x'], l['y']) for l in lms],
      '\nатлас', atlas.size, os.path.getsize(OUT + '/terrain_atlas.webp') // 1024, 'КБ', '\nклассы (биты)', {b: int(((tc & b) > 0)[tc != 255].sum()) for b in (1, 2, 4, 8, 16, 32, 64)})
