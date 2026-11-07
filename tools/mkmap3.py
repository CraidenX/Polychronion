# Фон карты из точной карты держав: заливки держав -> нейтральный серый, линии/реки/горы/подписи сохраняются
import glob, os, sys
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
POL = sorted(glob.glob(SP + '../source/*political*.png'))[0]
a = np.asarray(Image.open(POL).convert('RGB')).astype(np.int32)
sat = a.max(2) - a.min(2)
k = (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
L = a.max(2)
keep = ((sat <= 10) & (L < 232)) | (k == 0x001F48) | (k == 0x000020)
out = a.copy(); out[~keep] = (128, 128, 128)
# подписи (чёрный текст) убираем с фона, но сохраняем отдельным слоем — потом вернём в другом виде
text = (k == 0x070707)   # чёрный #000000 — это границы внешних земель, их не трогаем
os.makedirs(SP + 'assets', exist_ok=True)
lab = np.zeros(a.shape[:2] + (4,), np.uint8); lab[text] = (0, 0, 0, 255)
Image.fromarray(lab, 'RGBA').save(SP + 'assets/labels.png', optimize=True)
out[text] = (128, 128, 128)
# внутри закрашенной зоны линии берём с карты регионов (новые провинции), снаружи — с политической
REG = sorted(glob.glob(SP + '../source/*regions*.png'))[0]
g = np.asarray(Image.open(REG).convert('RGB')).astype(np.int32)
gs = g.max(2) - g.min(2); gk = (g[..., 0] << 16) | (g[..., 1] << 8) | g[..., 2]
rl = np.load(SP + 'umap/rl.npy').astype(np.int32)
zone = rl >= 0
inner = g.copy(); inner[(gs > 10) & (gk != 0x001F48) & (gk != 0x000020) & ~np.isin(gk, [0x8B5A2B, 0x4A2F1A, 0xFF00FF])] = (128, 128, 128)
inner[gk == 0x070707] = (128, 128, 128)   # подписи и внутри зоны
inner[(gk == 0x262626) | (gk == 0x404040)] = (128, 128, 128)       # старые тёмные границы внутри зоны убираем
out[zone] = inner[zone]
# линии провинций внутри зоны убираем — их рисует векторный слой игры (ровные при любом приближении)
pk = (out[..., 0] << 16) | (out[..., 1] << 8) | out[..., 2]
out[zone & (pk == 0xDFDFDF)] = (128, 128, 128)
from PIL import ImageFilter
rng = np.random.default_rng(1261)
H0, W0 = out.shape[:2]
def noise(scale):
    n = rng.random((H0 // scale + 2, W0 // scale + 2)).astype(np.float32)
    return np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((W0 + 2 * scale, H0 + 2 * scale), Image.BICUBIC), np.float32)[scale:scale + H0, scale:scale + W0] / 255 - 0.5
pk = (out[..., 0] << 16) | (out[..., 1] << 8) | out[..., 2]
sea = pk == 0x001F48
landm = ~sea
# суша: мягкое «пергаментное» зерно на нейтральном сером
base = pk == 0x808080
tex = 128 + noise(48) * 14 + noise(6) * 6 + (rng.random((H0, W0)) - 0.5) * 4
for c, sh in ((0, 2), (1, 0), (2, -3)):
    ch = out[..., c].astype(np.float32); ch[base] = tex[base] + sh; out[..., c] = np.clip(ch, 0, 255).astype(np.int32)
# море: у берегов светлее, в открытом море темнее
near = np.asarray(Image.fromarray((landm * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(14)), np.float32) / 255
t = np.clip(near * 2.2, 0, 1) + noise(24) * 0.08
deep, shallow = np.array([0, 20, 54], np.float32), np.array([20, 56, 96], np.float32)
seacol = deep[None, None, :] * (1 - t[..., None]) + shallow[None, None, :] * t[..., None]
out[sea] = np.clip(seacol[sea], 0, 255).astype(np.int32)
# --- горы: рельеф вместо схематичных хребтов ---
# высота: гладкий массив вокруг хребтов (шире маски) + неровности; отмывка — свет с северо-запада
import scipy.ndimage as nd
ridge = np.isin(gk, [0x8B5A2B, 0x4A2F1A, 0xFF00FF]) & zone
bgm = (k == 0x5E5E5E) | ((k == 0x262626) & nd.binary_dilation(k == 0x5E5E5E, iterations=2)) | ((gk == 0x5E5E5E) & zone)
allm = (ridge | bgm) & landm
for c_, sh_ in ((0, 2), (1, 0), (2, -3)):   # под хребтами — та же земля, цвет даст рельеф
    ch_ = out[..., c_].astype(np.float32); ch_[allm] = tex[allm] + sh_; out[..., c_] = np.clip(ch_, 0, 255).astype(np.int32)
dout = nd.distance_transform_edt(~allm)                                                   # расстояние до хребта, px
din = np.minimum(nd.distance_transform_edt(allm), 5)                                     # глубина внутри хребта
ridged = lambda s: 0.5 - np.abs(noise(s))                                                # ветвящиеся отроги
rough = ridged(15) * 0.8 + ridged(7) * 0.5 + noise(3) * 0.2
fall = np.exp(-(dout / (9 + 6 * (noise(30) + 0.5))) ** 1.4)                              # спад к подножию, неровный край
Hm = (0.55 + din / 5 * 0.45) * fall * (0.75 + rough * 0.9)
Hm = np.clip(Hm, 0, 1.2).astype(np.float32)
hills = (noise(40) * 0.5 + noise(14) * 0.35) * 0.025                                   # пологие холмы равнин
Ht = np.where(landm, Hm + hills, 0).astype(np.float32)
Z = 9.0
gy_, gx_ = np.gradient(nd.gaussian_filter(Ht, 0.7) * Z)
L = np.array([-0.62, -0.62, 0.48]); L /= np.linalg.norm(L)
nz = 1 / np.sqrt(gx_ ** 2 + gy_ ** 2 + 1)
shade = (-gx_ * L[0] - gy_ * L[1] + L[2]) * nz / L[2]          # 1 — ровное место
shade = np.clip(shade, 0.35, 1.6)
# цвет гор: предгорья — землистые, склоны — каменистые, вершины — светлые
hmix = np.clip((Hm - 0.1) / 0.95, 0, 1)[..., None]
foot, rock, peak = np.array([124, 114, 92], np.float32), np.array([128, 112, 92], np.float32), np.array([178, 170, 156], np.float32)
mcol = np.where(hmix < 0.6, foot + (rock - foot) * (hmix / 0.6), rock + (peak - rock) * ((hmix - 0.6) / 0.4))
land_out = out.astype(np.float32)
w = np.clip(hmix * 0.9, 0, 0.5)   # подножия чуть землистее
land_out = land_out * (1 - w) + mcol * w
land_out *= shade[..., None]
out = np.where(landm[..., None], np.clip(land_out, 0, 255), out).astype(np.int32)
# --- местность по эталонной карте (mkterrain.py), если вырезки есть: цвет земли, тип местности, высоты ---
EU = os.path.exists(SP + 'terrain/color.jpg')
if EU:
    ecol = np.asarray(Image.open(SP + 'terrain/color.jpg').convert('RGB')).astype(np.float32)
    ter = np.asarray(Image.open(SP + 'terrain/type.png')); hgt = np.asarray(Image.open(SP + 'terrain/height.png')).astype(np.float32)
    # «рисованные» цвета типов местности (смешиваются с цветом эталона — карта, а не спутниковый снимок)
    PAL = {0: (112, 140, 72), 5: (138, 156, 84), 4: (168, 160, 102), 3: (206, 182, 132), 7: (184, 156, 108),
           2: (152, 128, 98), 6: (128, 120, 106), 16: (232, 232, 230), 1: (74, 104, 54), 9: (84, 108, 86),
           19: (200, 176, 126), 35: (150, 148, 108)}
    pal = ecol.copy()
    for i, c in PAL.items(): pal[ter == i] = c
    pal = np.stack([nd.gaussian_filter(pal[..., c], 1.1) for c in range(3)], -1)
    basecol = ecol * 0.5 + pal * 0.5 + noise(5)[..., None] * 8
    Hs = nd.gaussian_filter(hgt, 1.3)
    gy2, gx2 = np.gradient(Hs * 0.11)
    nz2 = 1 / np.sqrt(gx2 ** 2 + gy2 ** 2 + 1)
    shade2 = np.clip((-gx2 * L[0] - gy2 * L[1] + L[2]) * nz2 / L[2], 0.55, 1.45)
    land2 = np.clip(basecol * shade2[..., None], 0, 255)
    coast = k == 0x000020
    keepl = landm & ~coast
    out = np.where(keepl[..., None], land2, out).astype(np.int32)
    # границы внешних земель автора (чёрные линии за краем зоны) — поверх
    olin = ~zone & ((k == 0) | (np.isin(k, [0x262626, 0x404040]) & ~nd.binary_dilation(k == 0x5E5E5E, iterations=2)))
    out[olin] = (out[olin] * 0.35).astype(np.int32)
    euw = np.isin(ter, [1]) & landm                                   # лесистая местность эталона
    forest_m = nd.binary_opening(euw, iterations=1)
    if os.path.exists(SP + 'umap/forest.npy'): forest_m |= np.load(SP + 'umap/forest.npy') & landm   # + исторические леса (mkforest.py)
    conifer_m = forest_m & ((Hs > 118) | (nd.distance_transform_edt(~allm) < 22))
    eu_mtn = np.isin(ter, [6, 16, 2]) & landm & (Hs > 127)            # пики эталона — только на самых высоких местах
# --- значки и реки: точки выбираются один раз, рисуются в 1× (map.jpg) и 2× (плитки hi/ для приближения) ---
sys.path.insert(0, SP)
from peaks import peak_points, tree_points, render_peaks, render_trees, forest_floor
if not EU:
    forest_m = (np.load(SP + 'umap/forest.npy') & landm) if os.path.exists(SP + 'umap/forest.npy') else np.zeros_like(landm)
    conifer_m = np.load(SP + 'umap/conifer.npy') if os.path.exists(SP + 'umap/conifer.npy') else np.zeros_like(landm)
fsoft = nd.gaussian_filter(forest_m.astype(np.float32), 2.0)
TP = tree_points(forest_m, conifer_m, np.random.default_rng(1204))
pkeep = np.where(allm, 0.85, 0.4).astype(np.float32)   # на игровых хребтах — плотно, на горах эталона — реже
PP = peak_points((allm | (eu_mtn if EU else False)) & landm, np.random.default_rng(1261), keep=pkeep)
RV = np.load(SP + 'umap/rivers.npy').astype(np.float32) / 255 if os.path.exists(SP + 'umap/rivers.npy') else np.zeros(landm.shape, np.float32)
RCOL = np.array([30, 66, 112], np.float32)
base0 = out.copy()
# для плиток 2×: вода с гладким контуром вместо «лесенки» — две заливки (суша/вода продолжены через границу) и мягкая маска
WL = np.isin(k, [0x001F48, 0x000020]) | (np.isin(gk, [0x001F48, 0x000020]) & zone)
_, (iy, ix) = nd.distance_transform_edt(WL, return_indices=True); landfill = base0[iy, ix]
WP = (k == 0x001F48) | ((gk == 0x001F48) & zone)   # цвет воды — только из «чистой» воды, без тёмного контура «лесенкой»
_, (iy, ix) = nd.distance_transform_edt(~WP, return_indices=True); waterfill = base0[iy, ix]
del iy, ix
def paint(o, fs, rv, x0, y0, K):
    o = forest_floor(o, fs)
    o = render_trees(o, TP, x0, y0, K)
    o = np.clip(o.astype(np.float32) * (1 - rv[..., None]) + RCOL * rv[..., None], 0, 255)
    return render_peaks(o, PP, x0, y0, K)
out = paint(base0, fsoft, RV, 0, 0, 1)
# плитки 2× (512×512 карты -> 1024×1024 px)
T, MG = 512, 8
hid = sys.argv[1] + '/hi'; os.makedirs(hid, exist_ok=True)
grain = lambda shp: (np.random.default_rng(7).random(shp, dtype=np.float32) - 0.5) * 7
tiles = []
def up(a, mode):
    im = Image.fromarray(a); return np.asarray(im.resize((a.shape[1] * 2, a.shape[0] * 2), mode))
for ty in range(0, H0, T):
    for tx in range(0, W0, T):
        x0, y0, x1, y1 = max(0, tx - MG), max(0, ty - MG), min(W0, tx + T + MG), min(H0, ty + T + MG)
        if not landm[ty:ty + T, tx:tx + T].any(): continue
        U3 = lambda A: np.stack([up(np.clip(A[y0:y1, x0:x1, c], 0, 255).astype(np.uint8), Image.BICUBIC) for c in range(3)], -1).astype(np.float32)
        bl, bw = U3(landfill), U3(waterfill)
        wm = nd.gaussian_filter(up((WL[y0:y1, x0:x1] * 255).astype(np.uint8), Image.BILINEAR).astype(np.float32) / 255, 1.5)
        a_ = np.clip((wm - 0.5) * 4 + 0.5, 0, 1)[..., None]                 # гладкий край воды
        b = bl * (1 - a_) + bw * a_
        edge = np.clip(1 - np.abs(wm - 0.5) * 4, 0, 1)[..., None] * 0.8    # тёмная береговая линия
        b = b * (1 - edge) + np.array([12, 22, 44], np.float32) * edge
        lm = 1 - a_
        b += grain(b.shape[:2])[..., None] * lm                       # мелкое зерно суши — чёткость вблизи
        fs = up((fsoft[y0:y1, x0:x1] * 255).astype(np.uint8), Image.BILINEAR).astype(np.float32) / 255
        rv = up((RV[y0:y1, x0:x1] * 255).astype(np.uint8), Image.BILINEAR).astype(np.float32) / 255
        rv = np.clip((rv - 0.3) * 1.8, 0, 1)                           # чёткий край реки
        o = paint(b, fs, rv, x0, y0, 2)
        ox, oy = (tx - x0) * 2, (ty - y0) * 2
        o = o[oy:oy + 2 * min(T, H0 - ty), ox:ox + 2 * min(T, W0 - tx)]
        Image.fromarray(o.astype(np.uint8)).save(f'{hid}/{tx // T}_{ty // T}.jpg', quality=84, optimize=True, progressive=True)
        tiles.append([tx // T, ty // T])
import json
json.dump({'T': T, 'tiles': tiles}, open(hid + '/index.json', 'w'))
print('плиток 2×:', len(tiles))
# широкая маска гор (для режима «хребты своего цвета» — без заливки державы) — в синий канал ids.png
massif = ((Hm > 0.38) | (nd.binary_dilation(eu_mtn, iterations=3) if EU else False)) & zone
idp = sys.argv[1] + '/ids.png'
if os.path.exists(idp):
    I = np.asarray(Image.open(idp).convert('RGB')).copy()
    b = I[..., 2]; keep_outer = (b >= 100) & (b < 160)
    b[~keep_outer] = 0; b[massif & ~keep_outer & ((I[..., 0].astype(int) << 8 | I[..., 1]) > 0)] = 255
    if os.path.exists(SP + 'umap/rivers.npy'):   # реки: B=180 — видны сквозь цвет державы
        rvm = (np.load(SP + 'umap/rivers.npy') > 45) & ~keep_outer & ((I[..., 0].astype(int) << 8 | I[..., 1]) > 0)
        b[rvm] = 180
    if EU or os.path.exists(SP + 'umap/forest.npy'):   # леса: B=165 — видны сквозь цвет державы (слабее гор)
        fm = (forest_m if EU else np.load(SP + 'umap/forest.npy')) & ~keep_outer & (b == 0) & ((I[..., 0].astype(int) << 8 | I[..., 1]) > 0)
        b[fm] = 165
    I[..., 2] = b; Image.fromarray(I).save(idp, optimize=True)
np.savez_compressed(SP + 'umap/masks.npz', forest=forest_m, conifer=conifer_m, ridge=allm & landm, mtn=(eu_mtn if EU else np.zeros_like(landm)) & landm, zone=zone, land=landm, water=WL, cleanwater=WP, k=k, gk=gk)   # для mkwater.py
im = Image.fromarray(out.astype(np.uint8))
W, H = a.shape[1], a.shape[0]
# исходный размер — без пересжатия
im.save(sys.argv[1] + '/map.jpg', quality=91, optimize=True, progressive=True)   # фон с текстурами — JPEG
print(W, H)
