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
# горы: светлые хребты с тенью справа-снизу — объём
# горы: коричневые хребты с объёмом (свет сверху-слева, тень справа-снизу), контур — тёмно-коричневый
mtn = np.isin(gk, [0x8B5A2B, 0xFF00FF]) & zone
edge = (gk == 0x4A2F1A) & zone
sh = np.zeros_like(mtn); sh[1:, 1:] = mtn[:-1, :-1]; sh &= ~mtn & ~edge & landm
out[sh] = (out[sh] * 0.6).astype(np.int32)
up = np.zeros_like(mtn); up[1:, 1:] = mtn[:-1, :-1]
base_b = np.array([139, 90, 43], np.float32) + (noise(5)[..., None] * 26)
out[mtn] = np.clip(base_b[mtn] + np.where(up[mtn], -14, 18)[:, None], 0, 255).astype(np.int32)
out[edge] = (74, 47, 26)
pas = (gk == 0xFF00FF) & zone
out[pas] = (236, 214, 160)   # перевал — светлая тропа
im = Image.fromarray(out.astype(np.uint8))
W, H = a.shape[1], a.shape[0]
# исходный размер — без пересжатия
im.save(sys.argv[1] + '/map.jpg', quality=88, optimize=True, progressive=True)   # фон с текстурами — JPEG
print(W, H)
