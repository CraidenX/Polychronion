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
# «конструктор» (terrain_lego, нарезка prepare_lego.sh): хребты parts_ridges_a по направлениям из dirs.txt и одиночные вершины parts_summits
LEGO = SP + 'terrain_lego'
_pk = lambda d: sorted(glob.glob(f'{LEGO}/{d}/peak_*.png'), key=lambda f: int(f.split('_')[-1][:-4]))
_rd = open(f'{LEGO}/parts_ridges_a/dirs.txt').read().split()
LEGO_FILES = {f'lego_ridge_{d}': [f for f, dd in zip(_pk('parts_ridges_a'), _rd) if dd == d] for d in ('h', 'd1', 'd2')}
LEGO_FILES['lego_summit'] = _pk('parts_summits')
LEGO_FILES.update({'lego_hill': _pk('parts_hilltops') + _pk('parts_hilltops_rocky'), 'lego_hill_r': _pk('parts_hilltops_rocky'), 'lego_rock': _pk('parts_rocks')})
# деревья: полог parts_forest_canopy (0–1 дубовый, 2–3 еловый, 4–5 смешанный), купы parts_trees_a…d (0–3 дубы, 4–7 ели в c/d, 8–11 оливы, 12–15 кипарисы),
# одиночные parts_trees_single (0–4 дубы, 5–9 сосны и ели, 10–14 оливы и кипарисы, 15–19 кусты, 20–24 маквис); лишние обрывки нарезки (16-й в trees_d) не берутся
_can, _sg = _pk('parts_forest_canopy'), _pk('parts_trees_single'); _tr = {c: _pk(f'parts_trees_{c}') for c in 'abcd'}
LEGO_FILES.update({'tree_can_oak': _can[0:2], 'tree_can_fir': _can[2:4], 'tree_can_mix': _can[4:6],
    'tree_k_oak': [f for c in 'abcd' for f in _tr[c][0:4]], 'tree_k_fir': _tr['c'][4:8] + _tr['d'][4:8], 'tree_k_olv': [f for c in 'abcd' for f in _tr[c][8:16]],
    'tree_s_oak': _sg[0:5] + _sg[15:20], 'tree_s_pine': _sg[5:10], 'tree_s_olv': _sg[10:15] + _sg[20:25]})
TREE_PAD, TREE_PB, TREE_AN = 0.2, 0.32, 0.92   # поля под тень (доля ширины с боков, доля высоты снизу), привязка дерева (низ ствола)
for n, fs in LEGO_FILES.items():
    NV[n] = len(fs)
    if n.startswith('tree_'): SIZE[n] = (0, 0); ANCHOR[n] = TREE_AN / (1 + TREE_PB)
    elif n.startswith('lego_hill'): SIZE[n] = (70, 115); ANCHOR[n] = 0.6
    else: SIZE[n] = (150, 200) if 'ridge' in n else (95, 130); ANCHOR[n] = 0.85
spath = lambda n, k: LEGO_FILES[n][k] if n in LEGO_FILES else f'{ART}/{n}/peak_{k}.png'
items = []
def add(y, x, name, scale=1.0, px=3):   # px — пикселей экрана на пиксель карты, в которых задан размер набора (проба 3×, конструктор 4×)
    lo, hi_ = SIZE[name]
    items.append((int(y), name, int(x), int(rng.integers(NV[name])), round(float(rng.uniform(lo, hi_) * scale / px), 1)))
sea = ~land
# 2) проходимые и холмы: разреженно, по убыванию высоты, с минимальным расстоянием (сетка ускоряет проверку)
def sparse(mask, score, mind, kx=0.8):
    ys, xs = np.nonzero(mask)
    order = np.argsort(-score[ys, xs]); taken = []; cell = {}; cs = mind
    for i in order:
        y, x = int(ys[i]), int(xs[i]); cy, cx = y // cs, x // cs; ok = True
        for a in (cy - 1, cy, cy + 1):
            for b in (cx - 2, cx - 1, cx, cx + 1, cx + 2):
                for ty, tx in cell.get((a, b), ()):
                    if (y - ty) ** 2 + ((x - tx) * kx) ** 2 <= mind ** 2: ok = False; break
                if not ok: break
            if not ok: break
        if ok: taken.append((y, x)); cell.setdefault((cy, cx), []).append((y, x))
    return taken
# 2) J4: холмы и проходимые горы — из «конструктора» (образец lego_render.py, размеры — px экрана пробы 3×):
#    холмы — parts_hilltops(+rocky) группами по 2–3 (шаг 34); проходимые горы — бугор parts_hilltops_rocky + 2–3 скалы parts_rocks (шаг 24), ели — ниже, с деревьями
def ladd(y, x, name, lo, hi_):
    y, x = int(round(y)), int(round(x))
    if 0 <= y < H and 0 <= x < W and land[y, x]: items.append((y, name, x, int(rng.integers(NV[name])), round(float(rng.uniform(lo, hi_) / 3), 1)))
near_riv = nd.binary_dilation(np.load(SP + 'umap/rivers.npy') > 46, iterations=5)   # бугры не наезжают на русла
mtn_lego = (passable > 0.55) & (impass < 0.3) & (saddle < 0.35) & ~lm_block
hill_lego = hills_m & (saddle < 0.35) & ~lm_block & ~mtn_lego
# K4: поле высот рельефа (условные метры; 1 ед. height.png = 4 у. м): исходная карта высот + купола по классам местности —
#     холмы 30–60, проходимые горы 90–150, непроходимые 200–320. Купола задаются первыми; бугры parts_hilltops ставятся на их вершины.
RELK = 4.0
def domes(pts, lo, hi_, sig):   # сумма гауссовых куполов с вершиной заданной высоты
    imp_ = np.zeros((H, W), np.float32)
    for y, x in pts: imp_[y, x] += rng.uniform(lo, hi_) * 2 * np.pi * sig * sig
    return nd.gaussian_filter(imp_, sig)
hill_c = sparse(hill_lego & ~near_riv, rng.random((H, W)).astype(np.float32), 34, 1.0)
mtn_c = sparse(mtn_lego & ~near_riv, rng.random((H, W)).astype(np.float32), 24, 1.0)
DOME = domes(hill_c, 30, 60, 6.0) + domes(mtn_c, 90, 150, 7.0)
imp_c = sparse((impass > 0.6) & (saddle < 0.35), rng.random((H, W)).astype(np.float32), 13, 1.0)
DOME += domes(imp_c, 200, 320, 7.0)
REL = (nd.gaussian_filter(hraw, 2.0) * RELK + DOME) * land
np.save(SP + 'umap/relief.npy', REL.astype(np.float16))
def top(y, x, r=5):   # вершина купола рядом с центром
    ys_, xs_ = slice(max(0, y - r), y + r + 1), slice(max(0, x - r), x + r + 1); sub_ = DOME[ys_, xs_]; i = int(np.argmax(sub_))
    return ys_.start + i // sub_.shape[1], xs_.start + i % sub_.shape[1]
for y, x in mtn_c:
    y, x = top(y, x); ladd(y, x, 'lego_hill_r', 110, 150)
    for j in range(int(rng.integers(2, 4))): ladd(y + rng.normal(0, 3), x + rng.normal(0, 6), 'lego_rock', 50, 75)
for y, x in hill_c:
    y, x = top(y, x)
    for j in range(int(rng.integers(2, 4))): ladd(y + (rng.normal(0, 4) if j else 0), x + (rng.normal(0, 8) if j else 0), 'lego_hill', 70 * (1 if j == 0 else 0.75), 115 * (1 if j == 0 else 0.75))
print('купола: холмы', len(hill_c), 'проходимые горы', len(mtn_c), 'непроходимые', len(imp_c), 'высоты у. м: до', int(REL.max()))
# 1) непроходимые — из «конструктора» (образец terrain_lego/lego_render.py): центры вразброс с шагом ~13 px карты;
#    направление — тензор структуры маски непроходимых гор; при когерентности > 0,2 — с вероятностью 75 % хребет этого направления
#    (150–200 px экрана при 4×), иначе одиночная вершина (95–130)
impm = (impass > 0.6) & (saddle < 0.35) & ~lm_block
mi = nd.gaussian_filter(impm.astype(np.float32), 3); gyi, gxi = np.gradient(mi)
Ixx = nd.gaussian_filter(gxi * gxi, 6); Iyy = nd.gaussian_filter(gyi * gyi, 6); Ixy = nd.gaussian_filter(gxi * gyi, 6)
iang = 0.5 * np.degrees(np.arctan2(2 * Ixy, Ixx - Iyy)) + 90; iang = (iang + 90) % 180 - 90
icoh = np.sqrt((Ixx - Iyy) ** 2 + 4 * Ixy ** 2) / (Ixx + Iyy + 1e-9)
del mi, gyi, gxi, Ixx, Iyy, Ixy
for y, x in sparse(impm, rng.random((H, W)).astype(np.float32), 13, 1.0):
    a = iang[y, x]; d = ('h' if abs(a) < 25 else ('d1' if a > 0 else 'd2')) if icoh[y, x] > 0.2 else None
    if d and rng.random() < 0.75: add(y, x, f'lego_ridge_{d}', px=4)
    else: add(y, x, 'lego_summit', px=4)
# 1б) деревья — три слоя (образец lego_render.py): маска леса вне непроходимых гор с просветами по крупному шуму;
#     сердцевина (> 6 px от края, не на проходимых горах) — полог, шаг 14; пояс (1,5–7 px) — купы, шаг 8; опушка (до 3 px снаружи) — одиночные, шаг 5, 35 %;
#     холмы вне леса — редкие кусты и деревья (шаг 14), поля — очень редкие одиночные (шаг 40). Размеры — px экрана при 4×; тени — в атласе (мягкий эллипс на юго-восток)
rt = np.random.default_rng(23)
ASP = {n: [Image.open(f).height / Image.open(f).width for f in LEGO_FILES[n]] for n in LEGO_FILES if n.startswith('tree_')}
def tadd(y, x, name, lo, hi_):   # высокие (кипарисы) — по высоте: не выше ~1,5 ширины набора, иначе одиночный кипарис выше холма
    v = int(rt.integers(NV[name])); k = min(1.0, 1.5 / ASP[name][v])
    items.append((int(y), name, int(x), v, round(float(rt.uniform(lo, hi_) / 4 * k * (1 + 2 * TREE_PAD)), 2)))
imp_b = impass > 0.5; mtn_b = passable > 0.5
fz = (m['forest'] | m['conifer']) & land & ~imp_b & ~lm_block & (noise(5, 1, r=rt) > -0.25)
fd = nd.distance_transform_edt(fz)
south = np.arange(H)[:, None] > 870                         # южнее ~42° с. ш. — средиземноморская растительность
nearmt = nd.binary_dilation(mtn_b | imp_b, iterations=6)
rs = lambda: rt.random((H, W)).astype(np.float32)
tcount = len(items)
for y, x in sparse(fz & (fd > 6) & ~mtn_b, rs(), 14, 1.0):
    tadd(y, x, 'tree_can_fir' if nearmt[y, x] else ('tree_can_mix' if south[y, 0] else 'tree_can_oak'), 95, 130)
for y, x in sparse(fz & (fd > 1.5) & (fd <= 7), rs(), 8, 1.0):
    tadd(y, x, 'tree_k_fir' if nearmt[y, x] else ('tree_k_olv' if south[y, 0] and rt.random() < 0.6 else 'tree_k_oak'), 40, 56)
# J2: одиночные деревья и кусты — только группами по 3–7 (центр + разброс 2–5 px карты): опушки, берега малых рек (полоса ~4 px),
#     холмы, окрестности поселений; в открытом поле — редкие группы (≈ одна на 60×60 px); одиночек в чистом поле нет
okg = land & ~imp_b & ~lm_block & ~nd.binary_dilation(np.load(SP + 'umap/rivers.npy') > 46, iterations=2)   # не на русле (нарисованная река шире маски)
def group(y, x, name, lo, hi_):
    n = int(rt.integers(3, 8)); rr = rt.uniform(2, 5)
    for i in range(n):
        if i == 0: yy, xx = y, x
        else: a_ = rt.uniform(0, 2 * np.pi); d_ = rr * np.sqrt(rt.random()); yy, xx = int(round(y + d_ * np.sin(a_) * 0.8)), int(round(x + d_ * np.cos(a_)))
        if 0 <= yy < H and 0 <= xx < W and okg[yy, xx]: tadd(yy, xx, name, lo, hi_)
sp_ = lambda y, x: 'tree_s_pine' if nearmt[y, x] else ('tree_s_olv' if south[y, 0] else 'tree_s_oak')
ng = {}
edge = nd.binary_dilation(fz, iterations=3) & ~(fd > 1.5) & okg
for y, x in sparse(edge, rs(), 18, 1.0): group(y, x, sp_(y, x), 18, 28); ng['опушки'] = ng.get('опушки', 0) + 1
# малые реки: все реки, кроме коридора больших (big_rivers.json, как в mkgrid.py)
from PIL import ImageDraw
BR = json.load(open(SP + 'big_rivers.json')); lines_ = Image.new('L', (W, H), 0); dl_ = ImageDraw.Draw(lines_)
for pts in BR['rivers'].values(): dl_.line([topx(lo, la) for lo, la in pts], fill=255, width=2)
bigz = nd.distance_transform_edt(np.asarray(lines_) == 0) <= BR['corridor']
riv_s = (np.load(SP + 'umap/rivers.npy') > 46) & ~bigz
bank = (nd.distance_transform_edt(~riv_s) <= 5) & ~riv_s & ~fz & okg   # полоса ~4 px за краем русла
for y, x in sparse(bank, rs(), 24, 1.0): group(y, x, sp_(y, x), 18, 28); ng['берега рек'] = ng.get('берега рек', 0) + 1
hb = hills_m & ~fz & okg
for y, x in sparse(hb, rs(), 30, 1.0): group(y, x, 'tree_s_olv' if south[y, 0] else 'tree_s_oak', 16, 24); ng['холмы'] = ng.get('холмы', 0) + 1
MI = json.load(open(SP + 'mapinfo3.json'))
for pv in MI['provs']:   # окрестности поселений: 1–2 группы в 4–12 px от центра провинции
    for _ in range(int(rt.integers(1, 3))):
        a_ = rt.uniform(0, 2 * np.pi); d_ = rt.uniform(4, 12); y, x = int(pv[2] + d_ * np.sin(a_) * 0.8), int(pv[1] + d_ * np.cos(a_))
        if 0 <= y < H and 0 <= x < W and okg[y, x] and not fz[y, x]: group(y, x, sp_(y, x), 16, 24); ng['поселения'] = ng.get('поселения', 0) + 1
pl = okg & ~fz & ~hills_m & ~mtn_b & ~bank & (nd.distance_transform_edt(~edge) > 6)
for y, x in sparse(pl, rs(), 60, 1.0): group(y, x, 'tree_s_olv' if south[y, 0] and rt.random() < 0.5 else 'tree_s_oak', 16, 24); ng['поле'] = ng.get('поле', 0) + 1
print('групп одиночных деревьев', ng)
for y, x in sparse(mtn_lego & (noise(3, 1, r=rt) > 0), rs(), 12, 1.0): tadd(y, x, 'tree_k_fir', 34 * 4 / 3, 46 * 4 / 3)   # ели на проходимых горах (34–46 px пробы 3×)
print('деревьев (до отбора по зоне)', len(items) - tcount)
del fd, edge, hb, pl, bank, riv_s, bigz
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
# неровное подножие уникальных гор: нижние ~45 % альфы × «рваный край» (расстояние от края минус шум двух масштабов: ~3 % и ~1 % ширины);
# одинаковый для состояний одной горы (Этна: спокойна / активна / извергается) — шум по имени горы, размер у них общий
def ragged_foot(im, name):
    a = np.asarray(im).astype(np.float32); al = a[..., 3] / 255; h, w = al.shape
    base = name.split('_')[1] if name.startswith('lm_etna') else name
    r = np.random.default_rng(sum(map(ord, base)))
    nb = nd.gaussian_filter(r.standard_normal((h, w)).astype(np.float32), w * 0.03); nb = (nb - nb.min()) / (np.ptp(nb) + 1e-9)
    ns = nd.gaussian_filter(r.standard_normal((h, w)).astype(np.float32), w * 0.01); ns = (ns - ns.min()) / (np.ptp(ns) + 1e-9)
    d = nd.distance_transform_edt(al > 0.5)
    edge = d - (nb * 0.03 * w * 1.4 + ns * 0.01 * w * 1.4)
    mask = np.clip(edge / (0.012 * w), 0, 1); mask = mask * mask * (3 - 2 * mask)
    yy = (np.arange(h)[:, None] + 0.5) / h; f = np.clip((yy - 0.5) / 0.1, 0, 1)   # с 55 % высоты вниз — рвём край, вершина чёткая
    a[..., 3] = al * (1 - f * (1 - mask)) * 255
    return Image.fromarray(a.astype(np.uint8), 'RGBA')
def tree_shadow(im):   # поля и мягкая тень-эллипс на юго-восток от низа ствола
    w0, h0 = im.size; px, pb = round(w0 * TREE_PAD), round(h0 * TREE_PB); W2, H2 = w0 + 2 * px, h0 + pb
    yy, xx = np.mgrid[0:H2, 0:W2].astype(np.float32); cx, cy = px + w0 * 0.66, h0 * TREE_AN + w0 * 0.05
    e = ((xx - cx) / (w0 * 0.42)) ** 2 + ((yy - cy) / (w0 * 0.14)) ** 2
    sh = nd.gaussian_filter(np.clip(1.2 - e, 0, 1).astype(np.float32), max(0.6, w0 * 0.05)) * 0.42
    out = Image.new('RGBA', (W2, H2), (0, 0, 0, 0)); out.putalpha(Image.fromarray((np.clip(sh, 0, 1) * 255).astype(np.uint8)))
    base = Image.new('RGBA', (W2, H2), (28, 24, 14, 0)); base.putalpha(out.getchannel('A'))
    base.alpha_composite(im, (px, 0)); return base
def fade_bottom(im, n, k, frac=0.28):   # низ растворяется с шумом (как в lego_render.py)
    a = np.asarray(im).astype(np.float32); h, w = a.shape[:2]; r = np.random.default_rng(sum(map(ord, n)) * 31 + k)
    ex = np.clip(np.minimum(a[..., 0], a[..., 2]) - a[..., 1], 0, None)   # остаток пурпурного фона: красный и синий выше зелёного — к серому
    a[..., 0] -= ex * 0.85; a[..., 2] -= ex * 0.85
    f = np.clip((1 - (np.arange(h) + 0.5) / h) / frac, 0, 1)[:, None]
    nz = nd.gaussian_filter(r.standard_normal((h, w)).astype(np.float32), 2.5 * w / 130); nz = (nz - nz.min()) / (np.ptp(nz) + 1e-9)
    a[..., 3] *= np.clip(f * (0.6 + 0.8 * nz), 0, 1)
    return Image.fromarray(a.astype(np.uint8), 'RGBA')
for n in sorted(used):
    for k in range(NV[n]):
        im = grade(Image.open(spath(n, k)).convert('RGBA'), n)
        mw = 900 if n.startswith(('lm_', 'pass_')) else (256 if n == 'lego_rock' else 400) if n.startswith('lego_') else (256 if '_can_' in n else 128 if '_k_' in n else 64) if n.startswith('tree_') else 270
        if im.width > mw: im = im.resize((mw, max(1, round(im.height * mw / im.width))), Image.LANCZOS)
        if n.startswith('lm_'): im = ragged_foot(im, n)
        if n.startswith('lego_') and not n.startswith('lego_hill'): im = fade_bottom(im, n, k, 0.25 if n == 'lego_rock' else 0.28)
        if n.startswith('tree_'): im = tree_shadow(im)
        spr.append((n, k, im))
AW = 4096; x = y = rowh = 0; rects = {}
spr.sort(key=lambda t: -t[2].height)
for n, k, im in spr:
    if x + im.width + 2 > AW: x = 0; y += rowh + 2; rowh = 0
    rects.setdefault(n, {})[k] = [x, y, im.width, im.height]; x += im.width + 2; rowh = max(rowh, im.height)
atlas = Image.new('RGBA', (AW, y + rowh), (0, 0, 0, 0))
for n, k, im in spr: r = rects[n][k]; atlas.paste(im, (r[0], r[1]))
atlas.save(OUT + '/terrain_atlas.webp', quality=86, method=6)
TINTS = {'lego_hill': [0.25, 0.55], 'lego_hill_r': [0.25, 0.55], 'lego_rock': [0.1, 0.45]}   # подкраска под землю — как в образце
sets = {n: {'tint': [0.05, 0.25]} if n.startswith('tree_') else {'tint': TINTS[n]} if n in TINTS else {} for n in rects}
sets = {n: {**sets[n], 'anchor': ANCHOR.get(n, next((l['anchor'] for l in lms if l['set'] == n), 0.78)) if not n.startswith('athos_') else 0.78, 'r': [rects[n][k] for k in range(NV[n])]} for n in rects}
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
        if False and not block_t[Y, X] and grove[Y, X]: keep.append(rec)   # деревья теперь — из конструктора (tree_* в items)
    open(OUT + f'/icons_t{var}.bin', 'wb').write(struct.pack('<II', 0, len(keep)) + b''.join(keep))
from collections import Counter
print('спрайтов', len(items), Counter(t[1] for t in items).most_common(), '\nуникальных гор', [(l['name'], l['x'], l['y']) for l in lms],
      '\nатлас', atlas.size, os.path.getsize(OUT + '/terrain_atlas.webp') // 1024, 'КБ', '\nклассы (биты)', {b: int(((tc & b) > 0)[tc != 255].sum()) for b in (1, 2, 4, 8, 16, 32, 64)})
