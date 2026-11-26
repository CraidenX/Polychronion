# Резкая фактура земли вблизи: плитки ближнего уровня хранят 2 px на пиксель карты и при 16× мылятся. Игра накладывает поверх
# «рельеф» текстур (только мелкие детали, серое = нейтрально) в родном разрешении 1024 px, режимом «мягкий свет», по маскам классов.
# Выход: ../detail_{grass,steppe,maquis,sand}.jpg — детали текстур (повтор = 70 px карты, как в плитках: 140 px плитки, начало в 0,0),
#        ../detail_w_{…}.png — где какая текстура (альфа = вес), четверть разрешения карты. Запуск: python3 -I mkdetail.py ..
import os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
Mk = np.load(SP + 'umap/masks.npz'); land, WP = Mk['land'], Mk['cleanwater']; H, W = land.shape
TC = np.load(SP + 'umap/tclass.npy')
ecol = np.asarray(Image.open(SP + 'terrain/color.jpg').convert('RGB')).astype(np.float32) / 255
# веса классов — как в mkwater.py (close_land), но для всей карты сразу (в четверть разрешения)
q = lambda a: a[::4, ::4]
tc = q(TC); isl = tc != 255; ref = q(ecol)
green = nd.gaussian_filter(np.clip((ref[..., 1] - (ref[..., 0] + ref[..., 2]) / 2 - 0.005) / 0.05, 0, 1), 1.5)
dsea = q(nd.distance_transform_edt(~(WP & ~land)).astype(np.float32))
ys = np.arange(0, H, 4)[:, None] * np.ones((1, tc.shape[1]))
bit = lambda b: ((tc & b) > 0) & isl
hill = bit(1) | bit(4) | bit(8)
w = {'sand': bit(32) * 1.0, 'marsh': bit(16) * 1.0, 'maquis': (hill | ((dsea < 45) & (ys > 866))) * 1.0,
     'steppe': (bit(64) | ~hill) * (1 - green), 'grass': (~hill & ~bit(64)) * green}
w['maquis'] *= (1 - w['sand']) * (1 - w['marsh']); w['steppe'] *= (1 - w['maquis']) * (1 - w['sand']) * (1 - w['marsh']); w['grass'] *= (1 - w['maquis']) * (1 - w['sand']) * (1 - w['marsh'])
for k in w: w[k] = nd.gaussian_filter(w[k], 0.75)
tot = sum(w.values()) + 1e-6
w['steppe'] = w['steppe'] + w['marsh']   # болото — редкое: деталь степи
RVQ = np.clip(nd.uniform_filter((np.load(SP + 'umap/rivers.npy') > 46).astype(np.float32), 4)[::4, ::4] * 2.5, 0, 1)
for k in ('grass', 'steppe', 'maquis', 'sand'):
    a = (np.clip(w[k] / tot * 255, 0, 255) * isl * (1 - RVQ)).astype(np.uint8)   # на реках — без фактуры
    Image.fromarray(np.dstack([np.full_like(a, 128)] * 3 + [a]), 'RGBA').save(OUT + f'/detail_w_{k}.png', optimize=True)
    # деталь текстуры: яркость минус размытая яркость (частоты мельче ~1/12 повтора), серое 128 — без изменений
    t = np.asarray(Image.open(SP + f'textures/{k}.webp').convert('RGB')).astype(np.float32) / 255
    lum = t @ np.array([0.3, 0.59, 0.11], np.float32)
    big = np.pad(lum, 40, mode='wrap'); hp = (lum - nd.gaussian_filter(big, 14)[40:-40, 40:-40])
    g = np.clip(0.5 + hp * {'grass': 1.6, 'steppe': 1.2, 'maquis': 1.0, 'sand': 1.3}[k], 0, 1)   # у травы контраст слабее — усиливаем сильнее
    Image.fromarray((g * 255).astype(np.uint8)).save(OUT + f'/detail_{k}.jpg', quality=88)
print('детали текстур и маски готовы', {k: os.path.getsize(OUT + f'/detail_{k}.jpg') // 1024 for k in ('grass', 'steppe', 'maquis', 'sand')}, 'КБ')
