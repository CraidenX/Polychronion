# Местность из эталонной карты (папка map/: heightmap.bmp, terrain.bmp, terrain/colormap_summer.dds).
# Наша карта — вырезка эталонной, увеличенная ровно в 2 раза: наш (x, y) = эталон (x/2 + X0, y/2 + Y0),
# сдвиг подобран по морю (совпадение 99,4 %). Оригиналы в репозиторий не кладём — только вырезки.
# Запуск: python3 mkterrain.py ПАПКА_map
# Выход: terrain/color.jpg, terrain/type.png, terrain/height.png — вырезки в нашей сетке (их читает mkmap3.py)
import os, sys, glob
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
SRC = sys.argv[1].rstrip('/') + '/'
X0, Y0, K = 3100, 854, 2
H, W = np.asarray(Image.open(sorted(glob.glob(SP + '../source/*political*.png'))[0])).shape[:2]
w, h = (W + K - 1) // K + 1, (H + K - 1) // K + 1
def fit(im, scale, resample):
    s = scale
    c = im.crop((int(X0 / s), int(Y0 / s), int(X0 / s) + int(w / s) + 2, int(Y0 / s) + int(h / s) + 2))
    big = c.resize((c.size[0] * K * s, c.size[1] * K * s), resample)
    return np.roll(np.asarray(big), -1, 0)[:H, :W]   # +½ пикселя эталона по вертикали (99,44 % совпадения моря)
col = fit(Image.open(SRC + 'terrain/colormap_summer.dds').convert('RGB'), 2, Image.BICUBIC)
ter = fit(Image.open(SRC + 'terrain.bmp'), 1, Image.NEAREST)
hgt = fit(Image.open(SRC + 'heightmap.bmp'), 1, Image.BICUBIC)
os.makedirs(SP + 'terrain', exist_ok=True)
Image.fromarray(col.astype(np.uint8)).save(SP + 'terrain/color.jpg', quality=92)
Image.fromarray(ter.astype(np.uint8)).save(SP + 'terrain/type.png', optimize=True)
Image.fromarray(hgt.astype(np.uint8)).save(SP + 'terrain/height.png', optimize=True)
print('готово', col.shape, ter.shape, hgt.shape)
