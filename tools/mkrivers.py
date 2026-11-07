# Малые реки — с карты мода (source/*mod*реки*.png, автор загрузил; судоходные реки автор уже нанёс на свои карты).
# В моде река нарисована двумя тёмными берегами (#000020) с руслом между ними. Порядок:
#   1) совмещение: карта мода шире на 113 px; сдвиг подбирается по морю (совпадение ~99,98%);
#   2) берега рек на суше автора (не ближе 2 px к его воде — там береговая линия и большие реки) -> заливка русла;
#   3) осевая линия русла (скелет) -> река ровной ширины ~2,3 px с мягким краем;
#   4) каждое пятно рек должно касаться воды автора или края карты (иначе — убрать; если вода близко — дотянуть).
# Выход: umap/rivers.npy — маска 0..255 (полная карта) для mkmap3.py и ids.png.
import os, glob
import numpy as np
from PIL import Image, ImageDraw
import scipy.ndimage as nd
from skimage.morphology import skeletonize
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
def load(pat):
    a = np.asarray(Image.open(sorted(glob.glob(SP + '../source/' + pat))[0]).convert('RGB')).astype(np.int32)
    return (a[..., 0] << 16) | (a[..., 1] << 8) | a[..., 2]
kB = load('*political*.png'); H, W = kB.shape
kM = load('*mod*реки*.png')
water = np.isin(kB, [0x001F48, 0x000020])
# 1) сдвиг по морю
best = None
for dx in range(0, kM.shape[1] - W + 1):
    s = ((kM[::6, dx:dx + W:6] == 0x001F48) == (kB[::6, ::6] == 0x001F48)).mean()
    if best is None or s > best[0]: best = (s, dx)
dx = best[1]; kM = kM[:, dx:dx + W]
print('сдвиг карты мода', dx, 'совпадение моря', round(best[0] * 100, 2), '%')
# 2) берега -> русло
wd, (wy, wx) = nd.distance_transform_edt(~water, return_indices=True)
banks = np.isin(kM, [0x000020, 0x001F48]) & ~water & (wd > 2)
chan = nd.binary_closing(banks, structure=np.ones((3, 3)), iterations=2) & ~water
chan = nd.binary_opening(chan, structure=np.ones((2, 2)))
# 3) осевая линия и ровная ширина
sk = skeletonize(chan)
sk &= ~nd.binary_dilation(water, iterations=1)
# дотянуть устья: концы скелета у воды автора (до 6 px) соединяем с водой
nb = nd.convolve(sk.astype(np.uint8), np.ones((3, 3), np.uint8), mode='constant') - sk
ends = sk & (nb == 1)
ys, xs = np.nonzero(ends & (wd <= 6))
img = Image.fromarray((sk * 255).astype(np.uint8)); d = ImageDraw.Draw(img)
for y, x in zip(ys, xs): d.line([(x, y), (wx[y, x], wy[y, x])], fill=255, width=1)
sk = np.asarray(img) > 0
# 4) только связанные с водой или краем карты
lab, n = nd.label(sk, structure=np.ones((3, 3)))
touch = set(np.unique(lab[nd.binary_dilation(water, iterations=2)]).tolist())
e = np.zeros_like(water); e[:3] = e[-3:] = True; e[:, :3] = e[:, -3:] = True
touch |= set(np.unique(lab[e]).tolist()); touch.discard(0)
sz = nd.sum(sk, lab, range(1, n + 1))
keep = np.isin(lab, [i + 1 for i in range(n) if (i + 1) in touch or sz[i] > 400])   # большие оторванные — озёрные/бессточные, оставить
removed = n - len(touch) - sum(1 for i in range(n) if (i + 1) not in touch and sz[i] > 400)
sk &= keep
# ширина ~2,3 px с мягким краем
dist = nd.distance_transform_edt(~sk)
m = np.clip((1.75 - dist) / 1.0, 0, 1) * 255
m[water] = 0
np.save(SP + 'umap/rivers.npy', m.astype(np.uint8))
print('пятен рек', n, 'убрано оторванных', removed, 'пикселей реки', int((m > 60).sum()))
