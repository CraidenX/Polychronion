# Узкая вода внутри суши (нижний Евфрат и Тигр, рукава Дуная и т. п.: в исходной маске суши это «вода» шириной 1–6 px, лесенкой)
# становится сушей с рекой: тогда река рисуется одной ровной линией (граф рек), а не ступенчатой полосой моря.
# Узкая вода — то, что не переживает «открытия» кругом радиуса 3 (широкие водоёмы восстанавливаются), и лежит в пределах 4 px от суши.
# Меняет (из нетронутых копий *_orig, повторный запуск безопасен): umap/masks.npz (land, water, cleanwater), umap/rivers.npy (река по узкой воде),
# ../ids.png (провинция — ближайшая), пишет umap/riverland.npy (что стало сушей; читает mkseamask.py — это не море).
# Запуск первым в цепочке рек: python3 -I mkriverland.py ..
import os, sys, shutil
import numpy as np
from PIL import Image
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
for a, b in ((SP + 'umap/masks.npz', SP + 'umap/masks_orig.npz'), (SP + 'umap/rivers.npy', SP + 'umap/rivers_orig.npy'), (OUT + '/ids.png', SP + 'umap/ids_orig.png')):
    if not os.path.exists(b): shutil.copy(a, b)
M = dict(np.load(SP + 'umap/masks_orig.npz')); land = M['land']; H, W = land.shape
water = ~land
disk = np.hypot(*np.mgrid[-3:4, -3:4]) <= 3.01
wide = nd.binary_dilation(nd.binary_opening(water, structure=disk), structure=disk, iterations=1) & water
wide = nd.binary_propagation(wide, mask=water & nd.binary_dilation(wide, iterations=2))   # края широких водоёмов не трогаем
thin = water & ~wide & (nd.distance_transform_edt(water) <= 4) & ~nd.binary_dilation(wide, iterations=3)   # у широкой воды (устья, протоки у берега) — не трогаем
lab, n = nd.label(thin, structure=np.ones((3, 3))); sz = nd.sum(thin, lab, range(1, n + 1))
objs = nd.find_objects(lab)
# река — вытянутый участок: не меньше 150 px и не короче 50 px по большей стороне (бухты, протоки у островов, озёра — нет)
keep = [i + 1 for i, v in enumerate(sz) if v >= 150 and max(objs[i][0].stop - objs[i][0].start, objs[i][1].stop - objs[i][1].start) >= 50]
thin = np.isin(lab, keep)
rv0 = np.load(SP + "umap/rivers_orig.npy") > 46
lab2, n2 = nd.label(water & ~wide, structure=np.ones((3, 3)))   # мелкие лужицы воды, примыкающие к реке, — тоже река (иначе видны пятна под лентой)
tch = np.unique(lab2[nd.binary_dilation(thin | (rv0 & ~nd.binary_dilation(wide, iterations=3)), iterations=4) & (lab2 > 0)]); sz2 = nd.sum(water, lab2, range(1, n2 + 1))
thin |= np.isin(lab2, [t for t in tch if t > 0 and sz2[t - 1] < 400])
for x, y in ((2330, 1005), (2150, 1110), (560, 1350), (3300, 560), (1820, 1230)):   # проливы (Босфор, Дарданеллы, Мессина, Керчь, Еврип) — всегда вода
    thin[max(0, y - 45):y + 45, max(0, x - 45):x + 45] = False
M['land'] = land | thin
for k in ('water', 'cleanwater'):   # реки на суше — не «вода» подложки (иначе нарисованы морем с чернильной кромкой): их рисует граф рек линиями
    if k in M: M[k] = M[k] & ~M['land']
np.savez_compressed(SP + 'umap/masks.npz', **M)
rv = np.load(SP + 'umap/rivers_orig.npy').copy(); rv[thin] = 255; np.save(SP + 'umap/rivers.npy', rv)
I = np.asarray(Image.open(SP + 'umap/ids_orig.png')).copy()
pid = (I[..., 0].astype(np.int32) << 8) | I[..., 1]
_, (iy, ix) = nd.distance_transform_edt(pid == 0, return_indices=True)   # провинция — ближайшая; признаки (вне зоны и т. п., канал B) — ближайшей суши
Bo = I[..., 2]; _, (ky, kx) = nd.distance_transform_edt(~(land & ~thin & ~((Bo >= 162) & (Bo <= 190))), return_indices=True)   # ближайшая суша без признака реки/леса
I[thin, 0] = I[iy[thin], ix[thin], 0]; I[thin, 1] = I[iy[thin], ix[thin], 1]; I[thin, 2] = I[ky[thin], kx[thin], 2]
outside = (I[..., 2] >= 100) & (I[..., 2] < 160) & thin   # за краем зоны провинции нет — как у соседней суши
nz = ((I[..., 0].astype(np.int32) << 8) | I[..., 1]); I[thin & (nz[ky, kx] == 0), 0:2] = 0   # у суши без провинции (за краем зоны) — тоже без провинции: вуаль сплошная
# дыры вуали за краем зоны: суша без провинции и без признака «вне зоны» (бывшие пиксели рек по краю русла) — признак от ближайшей «внешней» суши (≤ 4 px)
B = I[..., 2]; nz2 = ((I[..., 0].astype(np.int32) << 8) | I[..., 1]); isout = (B >= 100) & (B < 160)
hole = M['land'] & (nz2 == 0) & ~isout
dO, (oy, ox) = nd.distance_transform_edt(~isout, return_indices=True); fx = hole & (dO <= 4)
I[fx, 2] = B[oy[fx], ox[fx]]
Image.fromarray(I).save(OUT + '/ids.png', optimize=True)
# высоты и типы местности под бывшей водой — от ближайшей суши: иначе «долина-лесенка» даёт ступенчатую тень и кайму по бывшему руслу
for f in ('terrain/height.png', 'terrain/type.png'):
    o_ = SP + f.replace('.png', '_orig.png')
    if not os.path.exists(o_): shutil.copy(SP + f, o_)
    A = np.asarray(Image.open(o_)).copy(); src = land & ~thin
    _, (jy, jx) = nd.distance_transform_edt(~src, return_indices=True); A[thin] = A[jy[thin], jx[thin]]
    Image.fromarray(A).save(SP + f)
np.save(SP + 'umap/riverland.npy', thin)
print('узкая вода → суша с рекой: px', int(thin.sum()), 'участков', len(keep))
