# Разбор карты регионов: каждый регион — свой цвет; белые линии внутри — провинции (части).
import json, sys
from collections import deque, Counter
import numpy as np
from PIL import Image, ImageFilter
SP = __import__('os').path.dirname(__import__('os').path.abspath(__file__)) + '/'
im = Image.open(SP + 'umap/regions.webp').convert('RGB')
a0 = np.asarray(im).astype(int); H, W, _ = a0.shape
NAVY = np.array([1, 31, 73])
dn = np.abs(a0 - NAVY).sum(axis=2)
sat = a0.max(2) - a0.min(2)
L = (a0 * np.array([0.3, 0.59, 0.11])).sum(axis=2)
sea = dn < 60
# сглаживаем цвет медианой, чтобы убрать шум сжатия, но линии берём из исходника
am = np.asarray(im.filter(ImageFilter.MedianFilter(5))).astype(int)
satm = am.max(2) - am.min(2)
colored = (satm > 30) & ~sea
white = (sat < 40) & (L > 165)           # белые линии частей
painted = colored & ~white
# компоненты по цвету (допуск) — 4-связность
lab = -np.ones((H, W), int); comps = []
for y0 in range(H):
    for x0 in range(W):
        if not painted[y0, x0] or lab[y0, x0] >= 0: continue
        ref = am[y0, x0]; cid = len(comps); q = deque([(y0, x0)]); lab[y0, x0] = cid; px = []
        while q:
            y, x = q.popleft(); px.append((y, x))
            for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= Y < H and 0 <= X < W and painted[Y, X] and lab[Y, X] < 0 and np.abs(am[Y, X] - ref).sum() < 45:
                    lab[Y, X] = cid; q.append((Y, X))
        ys = np.array([p[0] for p in px]); xs = np.array([p[1] for p in px])
        comps.append({'n': len(px), 'col': np.median(am[ys, xs], axis=0), 'cx': xs.mean(), 'cy': ys.mean()})
print('raw comps', len(comps), 'big', sum(c['n'] >= 30 for c in comps))
# объединяем компоненты одного цвета (острова одного региона) и отбрасываем мелочь
big = [i for i, c in enumerate(comps) if c['n'] >= 30]
group = {}; reg = []
for i in sorted(big, key=lambda i: -comps[i]['n']):
    c = comps[i]; best = None
    for r in reg:
        if np.abs(r['col'] - c['col']).sum() < 22 and np.hypot(r['cx'] - c['cx'], r['cy'] - c['cy']) < 140:
            best = r; break
    if best is None:
        best = {'id': len(reg), 'col': c['col'], 'cx': c['cx'], 'cy': c['cy'], 'n': 0}; reg.append(best)
    group[i] = best['id']; best['n'] += c['n']
rl = -np.ones((H, W), int)
for i, g in group.items(): rl[lab == i] = g
# заливаем белые линии и мелкие обрывки ближайшим регионом (только внутри закрашенной зоны)
zone = (colored | white) & ~sea
zone = np.asarray(Image.fromarray(zone.astype(np.uint8) * 255).filter(ImageFilter.MaxFilter(3))) > 0
zone &= ~sea
q = deque((y, x) for y, x in zip(*np.nonzero(rl >= 0)))
while q:
    y, x = q.popleft(); v = rl[y, x]
    for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
        if 0 <= Y < H and 0 <= X < W and zone[Y, X] and rl[Y, X] < 0:
            rl[Y, X] = v; q.append((Y, X))
# части (провинции): компоненты внутри региона, разделённые белыми линиями
parts = Counter()
pl = -np.ones((H, W), int); pid = 0
inner = (rl >= 0) & ~white
for y0 in range(H):
    for x0 in range(W):
        if not inner[y0, x0] or pl[y0, x0] >= 0: continue
        r = rl[y0, x0]; q = deque([(y0, x0)]); pl[y0, x0] = pid; n = 0
        while q:
            y, x = q.popleft(); n += 1
            for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
                if 0 <= Y < H and 0 <= X < W and inner[Y, X] and pl[Y, X] < 0 and rl[Y, X] == r:
                    pl[Y, X] = pid; q.append((Y, X))
        if n >= 25: parts[r] += 1
        pid += 1
for r in reg:
    m = rl == r['id']; ys, xs = np.nonzero(m)
    r['n'] = int(m.sum()); r['parts'] = max(1, parts[r['id']])
    r['col'] = [int(v) for v in r['col']]
    r['cx'] = float(xs.mean()); r['cy'] = float(ys.mean())
reg = [r for r in reg if r['n'] >= 60]
keep = {r['id'] for r in reg}
rl[~np.isin(rl, list(keep))] = -1
np.save(SP + 'umap/rl.npy', rl)
json.dump(reg, open(SP + 'umap/regs.json', 'w'))
print('regions', len(reg), 'parts total', sum(r['parts'] for r in reg))
print(sorted([(r['n'], r['parts']) for r in reg])[:10], '...')
rng = np.random.default_rng(5); pal = rng.integers(30, 255, (max(keep) + 1, 3)).astype(np.uint8)
out = np.asarray(im).copy(); m = rl >= 0; out[m] = pal[rl[m]]
out[white & m] = 255
Image.fromarray(out[250:720, 0:1250]).resize((1250 * 3 // 2 // 1, 470 * 3 // 2)).save(SP + 'umap/regseg.png')
