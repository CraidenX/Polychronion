# Подкраска спрайтов под землю: средний цвет земли у подножия каждого спрайта (горы, холмы, перевалы, рощи, уникальные горы).
# Берётся кольцо вокруг подножия (внутри — пятно «подошвы» цвета самого спрайта) на чистой подложке ближнего уровня hi_wc*c.
# Все цвета сводятся к 8 тонам (k-средних): в игре вблизи — подкрашенные варианты спрайтов по номеру тона, при запекании — точный цвет.
# Запуск после NOICONS=1 mkwater.py: python3 -I mktone.py ..   → пишет в ../terrain_sprites.json: tones, items[*][6] (тон), items[*][7] (цвет),
# landmarks[*].tone/.col, treeTones {'' | '2': строка цифр тонов по порядку деревьев icons_t*.bin}
import os, sys, json, struct
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
m = np.load(SP + 'umap/masks.npz'); land = m['land']; H, W = land.shape
idx = json.load(open(OUT + '/hi_wcc/index.json')); T = idx['T']
G = np.zeros((H, W, 3), np.float32)
for tx, ty in idx['tiles']:
    im = Image.open(OUT + f'/hi_wcc/{tx}_{ty}.jpg').convert('RGB'); w, h = im.width // 2, im.height // 2
    G[ty * T:ty * T + h, tx * T:tx * T + w] = np.asarray(im.resize((w, h), Image.BOX)).astype(np.float32) / 255
TSJ = json.load(open(OUT + '/terrain_sprites.json'))
def ring(x, y, rx, ry, k0=1.15, k1=1.7):   # средний цвет суши в кольце вокруг эллипса подножия
    x0, x1, y0, y1 = int(max(0, x - rx * k1)), int(min(W, x + rx * k1 + 1)), int(max(0, y - ry * k1)), int(min(H, y + ry * k1 + 1))
    if x1 <= x0 or y1 <= y0: return None
    yy, xx = np.mgrid[y0:y1, x0:x1]; e = ((xx - x) / rx) ** 2 + ((yy - y) / ry) ** 2
    sel = (e >= k0 ** 2) & (e <= k1 ** 2) & land[y0:y1, x0:x1]
    if sel.sum() < 3: sel = (e <= k1 ** 2) & land[y0:y1, x0:x1]
    return G[y0:y1, x0:x1][sel].mean(0) if sel.any() else None
cols = []
for it in TSJ['items']:
    set_, v, x, y, w = it[:5]
    c = ring(x, y + w * 0.02, max(2, w * 0.42), max(1.5, w * 0.12)); cols.append(c)
lmc = [ring(l['x'], l['y'], max(3, l['w'] * 0.4), max(2, l['w'] * 0.12)) if not l.get('model') else None for l in TSJ['landmarks']]
trees = {}
for var in ('', '2'):
    b = open(OUT + f'/icons_t{var}.bin', 'rb').read(); nm, nt = struct.unpack('<II', b[:8]); o = 8 + nm * 48; tc = []
    for i in range(nt):
        tx_, ty_, r, f = struct.unpack('<HHBB', b[o + i * 6:o + i * 6 + 6]); tc.append(ring(tx_ / 8, ty_ / 8 + 0.5, 2.0, 1.2, 1.0, 2.2))
    trees[var] = tc
allc = np.array([c for c in cols + lmc + trees[''] + trees['2'] if c is not None], np.float32)
# 8 тонов: k-средних по цветам подножий
r = np.random.default_rng(3); C = allc[r.choice(len(allc), 8, replace=False)]
for _ in range(25):
    lab = ((allc[:, None, :] - C[None]) ** 2).sum(2).argmin(1)
    C = np.array([allc[lab == k].mean(0) if (lab == k).any() else C[k] for k in range(8)])
C = C[np.argsort(C @ np.array([0.3, 0.59, 0.11]))]   # от тёмного к светлому
near = lambda c: int(((C - c) ** 2).sum(1).argmin()) if c is not None else 4
TSJ['tones'] = [[round(float(v), 3) for v in c] for c in C]
for it, c in zip(TSJ['items'], cols):
    del it[6:]; it += [near(c), [round(float(v), 3) for v in (c if c is not None else C[4])]]
for l, c in zip(TSJ['landmarks'], lmc):
    if c is not None: l['tone'] = near(c); l['col'] = [round(float(v), 3) for v in c]
TSJ['treeTones'] = {var: ''.join(str(near(c)) for c in tc) for var, tc in trees.items()}
json.dump(TSJ, open(OUT + '/terrain_sprites.json', 'w'), ensure_ascii=False, separators=(',', ':'))
print('тона земли:', [tuple(int(v * 255) for v in c) for c in C], 'спрайтов', len(cols), 'деревьев', {k: len(v) for k, v in trees.items()})
