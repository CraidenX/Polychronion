# Однократно: игровые горы #FFFFFF -> #8B5A2B (коричневый), их контур #262626 -> #4A2F1A.
# Только внутри игровой зоны: снаружи #262626 обводит фоновые горы #5E5E5E и остаётся как есть.
import glob, os, shutil
import numpy as np
from PIL import Image
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
pl = np.load(SP + 'umap/pl.npy')
zone = nd.binary_dilation(pl >= 0, iterations=6)
for n in ('political', 'regions'):
    f = sorted(glob.glob(SP + f'../source/*{n}*.png'))[0]
    if not os.path.exists(SP + f'umap/backup2_{n}.png'): shutil.copy(f, SP + f'umap/backup2_{n}.png')
    a = np.asarray(Image.open(f).convert('RGB')).copy()
    k = (a[..., 0].astype(np.int32) << 16) | (a[..., 1].astype(np.int32) << 8) | a[..., 2]
    white = (k == 0xFFFFFF) & zone
    near_w = nd.binary_dilation(k == 0xFFFFFF, iterations=2)
    outl = (k == 0x262626) & zone & near_w & ~nd.binary_dilation(k == 0x5E5E5E, iterations=2)
    a[white] = (0x8B, 0x5A, 0x2B); a[outl] = (0x4A, 0x2F, 0x1A)
    Image.fromarray(a).save(f, optimize=True)
    print(n, 'горы', int(white.sum()), 'контур', int(outl.sum()), 'осталось #262626 в зоне', int(((k == 0x262626) & zone & ~outl).sum()))
