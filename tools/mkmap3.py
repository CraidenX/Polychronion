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
# внутри закрашенной зоны линии берём с карты регионов (новые провинции), снаружи — с политической
REG = sorted(glob.glob(SP + '../source/*regions*.png'))[0]
g = np.asarray(Image.open(REG).convert('RGB')).astype(np.int32)
gs = g.max(2) - g.min(2); gk = (g[..., 0] << 16) | (g[..., 1] << 8) | g[..., 2]
rl = np.load(SP + 'umap/rl.npy').astype(np.int32)
zone = rl >= 0
inner = g.copy(); inner[(gs > 10) & (gk != 0x001F48) & (gk != 0x000020)] = (128, 128, 128)
inner[(gk == 0x262626) | (gk == 0x404040)] = (128, 128, 128)       # старые тёмные границы внутри зоны убираем
out[zone] = inner[zone]
# новые границы регионов — по смене цвета региона
b = np.zeros(rl.shape, bool)
b[:, :-1] |= (rl[:, :-1] != rl[:, 1:]) & (rl[:, :-1] >= 0) & (rl[:, 1:] >= 0)
b[:-1, :] |= (rl[:-1, :] != rl[1:, :]) & (rl[:-1, :] >= 0) & (rl[1:, :] >= 0)
out[b] = (52, 40, 52)
# горы: белые хребты
mtn = gk == 0xFFFFFF
out[mtn] = (232, 228, 214)
im = Image.fromarray(out.astype(np.uint8))
W, H = a.shape[1], a.shape[0]
# исходный размер — без пересжатия
im.quantize(colors=64, method=Image.MEDIANCUT, dither=Image.NONE).save(sys.argv[1] + '/map.png', optimize=True)
print(W, H)
