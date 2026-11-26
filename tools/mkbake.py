# Дальний вид из ближнего: рисуем всю карту на ближнем уровне (подложка hi_wc*c с фактурой, светотенью и подошвами, спрайты гор, холмов,
# перевалов, рощи, уникальные горы, модель Афона) по тем же terrain_sprites.json, landmarks.json и icons_t*.bin, затем:
#   ../hi_wc{VAR}/X_Y.jpg — плитки 2× дальнего уровня (вместо прежних со значками-треугольниками),
#   ../map_wc{VAR}.jpg    — вся карта 1× (уменьшение тех же плиток),
#   ../relief_wc{VAR}.png — маска нарисованного рельефа для политической карты (горы 255, леса 165, реки 180).
# Запуск после mkwater.py (NOICONS=1) и mkterrain_sprites.py: python3 -I mkbake.py ..   (VAR=2 — второй стиль)
import os, sys, json, struct
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
VAR = os.environ.get('VAR', '')
K = 2                                    # масштаб плиток
m = np.load(SP + 'umap/masks.npz'); land = m['land']; H, W = land.shape
TSJ = json.load(open(OUT + '/terrain_sprites.json')); SETS = TSJ['sets']
ATL = Image.open(OUT + '/terrain_atlas.webp').convert('RGBA')
TREES = Image.open(OUT + '/trees.png').convert('RGBA'); NT = TREES.width // 10
idx = json.load(open(OUT + f'/hi_wc{VAR}c/index.json')); T = idx['T']
# суша, размытая на ~2,5 px — для обрезки подножий у берега (как в игре)
LANDS = nd.gaussian_filter(land.astype(np.float32), 1.2)
RIV = np.zeros(np.load(SP + 'umap/rivers_big.npy').shape, bool)   # J5: чёткий растровый слой рек не нужен — вблизи игра рисует реки линиями (большие — лентой, малые — тонкой линией)
RSM = json.load(open(OUT + '/rivers_small.json'))['lines']   # малые реки — линиями (mkrivvec.py)
RSB = [(min(l[0::2]), min(l[1::2]), max(l[0::2]), max(l[1::2])) for l in RSM]
RBG = list(json.load(open(OUT + '/rivers_big.json'))['rivers'].values())   # большие реки — лентой шириной w px карты
def small_rivers(img, X0, Y0, X1, Y1, K):   # малые реки на плитке: берег (песок/ил), тёмная кромка, вода; сглаживание — рисуем в 3× и уменьшаем
    SS = 3; sel = [l for l, b in zip(RSM, RSB) if b[2] >= X0 - 4 and b[0] <= X1 + 4 and b[3] >= Y0 - 4 and b[1] <= Y1 + 4]
    bigs = [r for r in RBG if max(r['pts'][0::2]) >= X0 - 8 and min(r['pts'][0::2]) <= X1 + 8 and max(r['pts'][1::2]) >= Y0 - 8 and min(r['pts'][1::2]) <= Y1 + 8]
    if not sel and not bigs: return img
    w, h = img.size; lay = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    for r in bigs:   # как в игре: берег, тёмная кромка, вода, светлая стремнина
        pts = [((r['pts'][i] - X0) * K * SS, (r['pts'][i + 1] - Y0) * K * SS) for i in range(0, len(r['pts']), 2)]; bw = r['w'] * K * SS
        for col, wd in (((160, 140, 98, 153), bw + 2.0 * K * SS), ((30, 44, 58, 235), bw + 1.0 * K * SS), ((58, 98, 132, 255), bw), ((96, 138, 168, 255), max(1, bw * 0.35))):
            d.line(pts, fill=col, width=max(1, int(round(wd))), joint='curve')
    core = 1.6 * K * SS
    for col, wd in (((168, 150, 106, 150), core + 2.4 * K * SS), ((38, 52, 66, 225), core + 0.9 * K * SS), ((64, 104, 136, 255), core)):
        for l in sel:
            pts = [((l[i] - X0) * K * SS, (l[i + 1] - Y0) * K * SS) for i in range(0, len(l), 2)]
            d.line(pts, fill=col, width=max(1, int(round(wd))), joint='curve')
            r = wd / 2
            for x, y in (pts[0], pts[-1]): d.ellipse((x - r, y - r, x + r, y + r), fill=col)
    return Image.alpha_composite(img, lay.resize((w, h), Image.LANCZOS))
# что рисуем: спрайты (без перевалов, они — тоже спрайты) и уникальные горы; деревья рощ
items = []   # (y, kind, data)
TONES = np.array(TSJ.get('tones', [[0.5, 0.45, 0.35]] * 8), np.float32)
for it in TSJ['items']: set_, v, x, y, w, c = it[:6]; items.append((y, 's', (set_, v, x, y, w, c, np.array(it[7] if len(it) > 7 else TONES[it[6] if len(it) > 6 else 4], np.float32))))
for l in TSJ['landmarks']:
    if l.get('model'): continue          # модель (Афон) рисуется отдельно
    items.append((l['y'], 's', (l['set'], 0, l['x'], l['y'], l['w'], 2, np.array(l.get('col', TONES[4]), np.float32))))   # 2 — уникальная гора (подножие режется по берегу раньше)
TT = TSJ.get('treeTones', {}).get(VAR, '')
b = open(OUT + f'/icons_t{VAR}.bin', 'rb').read(); nm, nt = struct.unpack('<II', b[:8]); o = 8 + nm * 48
for i in range(nt):
    tx, ty, r, f = struct.unpack('<HHBB', b[o + i * 6:o + i * 6 + 6]); items.append((ty / 8, 't', (tx / 8, ty / 8, r / 100, f & 1, f >> 1, int(TT[i]) if i < len(TT) else 4)))
MODELS = TSJ.get('models', [])           # модели, заменяющие кусок карты (часть D: Афон)
items.sort(key=lambda t: t[0])
CELL = 128; grid = {}
for it in items:
    x, y = (it[2][2], it[2][3]) if it[1] == 's' else (it[2][0], it[2][1])
    grid.setdefault((int(y // CELL), int(x // CELL)), []).append(it)
_cache = {}
def sprite(set_, v, w):   # спрайт набора нужной ширины (px плитки)
    key = (set_, v, int(round(w)))
    if key not in _cache:
        r = SETS[set_]['r'][v]; im = ATL.crop((r[0], r[1], r[0] + r[2], r[1] + r[3]))
        ww = max(2, key[2]); hh = max(2, round(r[3] * ww / r[2])); _cache[key] = im.resize((ww, hh), Image.LANCZOS)
        if len(_cache) > 6000: _cache.clear()
    return _cache[key]
# подкраска под землю с сохранением яркости: у подножия ~60 %, к вершине плавно до ~15 %; белое (снег) не трогаем
def tint(im, col, an=0.78, tb=(0.15, 0.6)):
    a = np.asarray(im).astype(np.float32) / 255; rgb = a[..., :3]; h = a.shape[0]
    lum = rgb @ np.array([0.3, 0.59, 0.11], np.float32); cl = float(col @ np.array([0.3, 0.59, 0.11], np.float32)) + 1e-4
    tgt = np.clip(col[None, None, :] * (lum / cl)[..., None], 0, 1)
    yy = (np.arange(h)[:, None] + 0.5) / h; t = np.clip((yy - 0.15) / max(0.2, an - 0.15), 0, 1); wgt = tb[0] + (tb[1] - tb[0]) * t * t * (3 - 2 * t)
    mx, mn = rgb.max(2), rgb.min(2); white = np.clip((lum - 0.74) / 0.14, 0, 1) * np.clip(1 - (mx - mn) / (mx + 1e-4) / 0.25, 0, 1)
    wgt = (wgt * (1 - white))[..., None]
    a[..., :3] = rgb * (1 - wgt) + tgt * wgt
    return Image.fromarray((a * 255).astype(np.uint8), 'RGBA')
_tc = {}
def tree(con, k, px, tn=4):
    key = (con, k, px, tn)
    if key not in _tc: _tc[key] = tint(TREES.crop((k * NT, con * NT, k * NT + NT, con * NT + NT)).resize((px, px), Image.LANCZOS), TONES[tn], 0.72)
    return _tc[key]
outd = OUT + f'/hi_wc{VAR}'; os.makedirs(outd, exist_ok=True)
full = np.asarray(Image.open(OUT + f'/map_wc{VAR}.jpg').convert('RGB')).copy()
rel = np.zeros((H, W), np.uint8)
cover_tot = cover_land = 0
for tx_, ty_ in idx['tiles']:
    X0, Y0 = tx_ * T, ty_ * T
    base = Image.open(OUT + f'/hi_wc{VAR}c/{tx_}_{ty_}.jpg').convert('RGBA'); tw, th = base.size
    X1, Y1 = X0 + tw / K, Y0 + th / K
    # под моделью (Афон) суша полуострова и береговая обводка не рисуются: заливаем их соседним морем — и в ближней подложке тоже
    for md in MODELS:
        lx0, ly0, lx1, ly1 = md['land']
        if lx1 + 4 < X0 or lx0 - 4 > X1 or ly1 + 4 < Y0 or ly0 - 4 > Y1: continue
        pm = np.zeros((H, W), bool); pm[ly0 - 2:ly1 + 2, md['isthmus']:lx1 + 2] = land[ly0 - 2:ly1 + 2, md['isthmus']:lx1 + 2]
        pm = nd.binary_dilation(pm, iterations=3); pm[:, :md['isthmus']] = False
        mk = np.asarray(Image.fromarray(pm[Y0:Y0 + th // K, X0:X0 + tw // K].astype(np.uint8) * 255).resize((tw, th), Image.NEAREST)) > 0
        if mk.any():
            a = np.asarray(base).copy(); _, (iy, ix) = nd.distance_transform_edt(mk, return_indices=True); a[mk] = a[iy[mk], ix[mk]]
            a[..., :3] = np.where(mk[..., None], nd.gaussian_filter(a[..., :3].astype(np.float32), (3, 3, 0)), a[..., :3]).astype(np.uint8)
            base = Image.fromarray(a, 'RGBA'); base.convert('RGB').save(OUT + f'/hi_wc{VAR}c/{tx_}_{ty_}.jpg', quality=84, optimize=True, progressive=True)
    lay = Image.new('RGBA', (tw, th), (0, 0, 0, 0)); mtn = Image.new('L', (tw, th), 0); tre = Image.new('L', (tw, th), 0)
    seen = []
    for cy in range(int((Y0 - 60) // CELL), int((Y1 + 200) // CELL) + 1):
        for cx in range(int((X0 - 200) // CELL), int((X1 + 200) // CELL) + 1): seen += grid.get((cy, cx), [])
    seen.sort(key=lambda t: t[0])
    for y_, kind, d in seen:
        if kind == 's':
            set_, v, x, y, w, coast, col = d; an = SETS[set_]['anchor']
            sp = tint(sprite(set_, v, w * K), col, an, SETS[set_].get('tint', (0.15, 0.6))); px0 = int(round((x - X0) * K - sp.width / 2)); py0 = int(round((y - Y0) * K - sp.height * an))
            if px0 > tw or py0 > th or px0 + sp.width < 0 or py0 + sp.height < 0: continue
            if coast:   # подножие (62–80 % высоты и ниже) — только над сушей
                a = np.asarray(sp).astype(np.float32); hh, ww = a.shape[:2]
                yy = (np.arange(hh) + 0.5) / hh; ramp = (np.clip((yy - 0.4) / 0.15, 0, 1) if coast == 2 else np.clip((yy - 0.62) / 0.18, 0, 1))[:, None]
                gx = np.clip(((np.arange(ww) + px0) / K + X0).astype(int), 0, W - 1); gy = np.clip(((np.arange(hh) + py0) / K + Y0).astype(int), 0, H - 1)
                ls = LANDS[gy[:, None], gx[None, :]]
                a[..., 3] *= 1 - ramp * (1 - np.clip((ls - 0.25) / 0.5, 0, 1)); sp = Image.fromarray(a.astype(np.uint8), 'RGBA')
            lay.alpha_composite(sp, (px0, py0)) if px0 >= 0 and py0 >= 0 and px0 + sp.width <= tw and py0 + sp.height <= th else lay.paste(Image.alpha_composite(lay.crop((px0, py0, px0 + sp.width, py0 + sp.height)), sp), (px0, py0))
            (tre if set_.startswith('tree_') else mtn).paste(255, (px0, py0), sp.getchannel('A').point(lambda q: 255 if q > 128 else 0))   # деревья — в маску леса, не гор
        else:
            x, y, r, con, k, tn = d; px = max(3, int(round(r * 4.2 * K)))
            sp = tree(con, k, px, tn); px0 = int(round((x - X0) * K - px / 2)); py0 = int(round((y - Y0) * K - px * 0.72))
            if px0 > tw or py0 > th or px0 + px < 0 or py0 + px < 0: continue
            lay.paste(Image.alpha_composite(lay.crop((px0, py0, px0 + px, py0 + px)), sp), (px0, py0))
            tre.paste(255, (px0, py0), sp.getchannel('A').point(lambda q: 255 if q > 128 else 0))
    out = small_rivers(base, X0, Y0, X1, Y1, K)   # J5: малые реки — под моделями и спрайтами
    for md in MODELS:   # модели, заменяющие кусок карты (Афон): картинка с прозрачностью в рамке (пиксели карты) — под спрайтами
        mx0, my0, mx1, my1 = md['box']
        if mx1 < X0 or mx0 > X1 or my1 < Y0 or my0 > Y1: continue
        im = Image.open(OUT + '/' + md['file']).convert('RGBA').resize((int(round((mx1 - mx0) * K)), int(round((my1 - my0) * K))), Image.LANCZOS)
        px0, py0 = int(round((mx0 - X0) * K)), int(round((my0 - Y0) * K))
        out = out.copy(); out.paste(Image.alpha_composite(out.crop((px0, py0, px0 + im.width, py0 + im.height)), im), (px0, py0))
        mtn.paste(165, (px0, py0), im.getchannel('A').point(lambda q: 255 if q > 128 else 0))
    out = Image.alpha_composite(out, lay).convert('RGB')
    out.save(f'{outd}/{tx_}_{ty_}.jpg', quality=84, optimize=True, progressive=True)
    # дальний вид 1× и маска рельефа
    w1, h1 = tw // K, th // K
    full[Y0:Y0 + h1, X0:X0 + w1] = np.asarray(out.resize((w1, h1), Image.LANCZOS))
    mm = np.asarray(mtn.resize((w1, h1), Image.BOX)) > 100; tt = np.asarray(tre.resize((w1, h1), Image.BOX)) > 100
    rr = np.zeros((h1, w1), np.uint8); rr[tt] = 165; rr[RIV[Y0:Y0 + h1, X0:X0 + w1]] = 180; rr[mm] = 255
    rel[Y0:Y0 + h1, X0:X0 + w1] = rr
    ln = land[Y0:Y0 + h1, X0:X0 + w1]; cover_tot += int(((mm | tt) & ln).sum()); cover_land += int(ln.sum())
json.dump(idx, open(outd + '/index.json', 'w'))
Image.fromarray(full).save(OUT + f'/map_wc{VAR}.jpg', quality=90, optimize=True, progressive=True)
Image.fromarray(rel).save(OUT + f'/relief_wc{VAR}.png', optimize=True)
print('запечено плиток', len(idx['tiles']), 'рельеф и лес занимают', round(100 * cover_tot / max(1, cover_land), 1), '% суши')
