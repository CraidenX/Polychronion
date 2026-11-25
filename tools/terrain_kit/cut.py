# Вырезка спрайтов с пурпурного фона: python3 cut.py ПАПКА  (берёт ПАПКА/sheet.png или sheet.webp)
# Все наборы сразу: for d in art/*; do python3 cut.py $d; done
import sys
from PIL import Image; import numpy as np
from scipy import ndimage as nd
D = sys.argv[1]
import os
SRC = D + '/sheet.png' if os.path.exists(D + '/sheet.png') else D + '/sheet.webp'
a = np.asarray(Image.open(SRC).convert('RGB')).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mag = np.clip(((r + b) / 2 - g - 60) / 80, 0, 1); alpha = 1 - mag
solid = nd.binary_opening(alpha > 0.5, iterations=1)
lab, n = nd.label(solid); sz = nd.sum(solid, lab, range(1, n + 1))
keep = [i for i in np.argsort(sz)[::-1] if sz[i] > 0.25 * sz.max()]
spill = np.clip((r + b) / 2 - g, 0, None) * mag
a2 = a.copy(); a2[..., 0] -= spill * 0.9; a2[..., 2] -= spill * 0.9
objs = nd.find_objects(lab)
for k, i in enumerate(sorted(keep, key=lambda i: (objs[i][0].start // 300, objs[i][1].start))):
    sl = objs[i]; sl = (slice(max(sl[0].start - 3, 0), sl[0].stop + 3), slice(max(sl[1].start - 3, 0), sl[1].stop + 3))
    m = nd.binary_dilation(lab[sl] == i + 1, iterations=2) * alpha[sl]
    Image.fromarray(np.dstack([np.clip(a2[sl], 0, 255), np.clip(m * 255, 0, 255)]).astype(np.uint8), 'RGBA').save(f'{D}/peak_{k}.png')
print(D, len(keep), 'спрайтов')
