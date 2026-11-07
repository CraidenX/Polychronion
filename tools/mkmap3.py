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
# реки (Natural Earth, mkrivers.py): синие линии под пиками
if os.path.exists(SP + 'umap/rivers.npy'):
    rv = np.load(SP + 'umap/rivers.npy').astype(np.float32)[..., None] / 255
    rcol = np.array([38, 76, 120], np.float32)
    out = np.clip(out.astype(np.float32) * (1 - rv * 0.9) + rcol * rv * 0.9, 0, 255).astype(np.int32)
# рисованные пики по хребтам (дальние — раньше, ближние перекрывают)
sys.path.insert(0, SP)
from peaks import draw_peaks
out = draw_peaks(out, allm & landm, np.random.default_rng(1261), bg=bgm & ~zone)
# широкая маска гор (для режима «хребты своего цвета» — без заливки державы) — в синий канал ids.png
massif = (Hm > 0.38) & zone
idp = sys.argv[1] + '/ids.png'
if os.path.exists(idp):
    I = np.asarray(Image.open(idp).convert('RGB')).copy()
    b = I[..., 2]; keep_outer = (b >= 100) & (b < 160)
    b[~keep_outer] = 0; b[massif & ~keep_outer & ((I[..., 0].astype(int) << 8 | I[..., 1]) > 0)] = 255
    if os.path.exists(SP + 'umap/rivers.npy'):   # реки: B=180 — видны сквозь цвет державы
        rvm = (np.load(SP + 'umap/rivers.npy') > 45) & ~keep_outer & ((I[..., 0].astype(int) << 8 | I[..., 1]) > 0)
        b[rvm] = 180
    I[..., 2] = b; Image.fromarray(I).save(idp, optimize=True)
im = Image.fromarray(out.astype(np.uint8))
W, H = a.shape[1], a.shape[0]
# исходный размер — без пересжатия
im.save(sys.argv[1] + '/map.jpg', quality=88, optimize=True, progressive=True)   # фон с текстурами — JPEG
print(W, H)
