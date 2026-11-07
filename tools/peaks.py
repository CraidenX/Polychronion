# Стилизованные горы в духе «рисованных» стратегий: по хребтам расставляются пики-пирамидки
# (освещённый левый склон, теневой правый, снег на высоких), рисуются от дальних к ближним.
# draw_peaks(out, allm, zone_or_None, seed) -> out (RGB, int32), рисует поверх.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import scipy.ndimage as nd

def draw_peaks(out, allm, rng, scale=2, cell=7, bg=None):
    H, W = allm.shape
    # «высота» хребта: толщина маски вокруг точки — крупнее пики там, где хребет толще
    thick = nd.gaussian_filter(allm.astype(np.float32), 3.0)
    ys, xs = np.nonzero(allm)
    # одна вершина на клетку cell×cell (со случайным сдвигом сетки)
    key = (ys // cell) * (W // cell + 1) + (xs // cell)
    order = rng.permutation(len(ys))
    _, first = np.unique(key[order], return_index=True)
    sel = order[first]
    sel = sel[rng.random(len(sel)) < 0.85]
    py, px = ys[sel], xs[sel]
    t = thick[py, px]
    # слой гор рисуем в увеличенном размере (сглаживание краёв), только вокруг хребтов
    S = scale
    lay = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0))
    sh = Image.new('L', (W * S, H * S), 0)
    d = ImageDraw.Draw(lay); ds = ImageDraw.Draw(sh)
    idx = np.argsort(py)               # дальние (выше на карте) — раньше
    isbg = bg[py, px] if bg is not None else np.zeros(len(py), bool)
    for i in idx:
        x, y = px[i] * S, py[i] * S
        size = (5.5 + 9 * min(1.0, t[i] * 1.6)) * (0.8 + rng.random() * 0.45)
        w = size * S * 1.25; h = size * S * (1.05 + rng.random() * 0.35)
        ax = x + (rng.random() - 0.5) * w * 0.25          # вершина чуть смещена
        top, bl, br = (ax, y - h * 0.75), (x - w / 2, y + h * 0.25), (x + w / 2, y + h * 0.25)
        mid = (ax + (rng.random() - 0.4) * w * 0.12, y + h * 0.25)
        g = isbg[i]
        lit = (150, 146, 138) if g else (156, 140, 112)
        dark = (88, 84, 80) if g else (92, 78, 60)
        jl = rng.integers(-8, 9); jd = rng.integers(-6, 7)
        lit = tuple(int(c + jl) for c in lit); dark = tuple(int(c + jd) for c in dark)
        # тень на землю (вправо-вниз)
        ds.polygon([top, (br[0] + w * 0.35, br[1] - h * 0.05), br, mid], fill=110)
        d.polygon([top, bl, mid], fill=lit + (255,))
        d.polygon([top, mid, br], fill=dark + (255,))
        # снег на крупных вершинах
        if size > 11.5 and not g:
            f = 0.32
            sl = (top[0] + (bl[0] - top[0]) * f, top[1] + (bl[1] - top[1]) * f)
            sm = (top[0] + (mid[0] - top[0]) * f * 1.1, top[1] + (mid[1] - top[1]) * f * 1.1)
            sr = (top[0] + (br[0] - top[0]) * f, top[1] + (br[1] - top[1]) * f)
            d.polygon([top, sl, sm], fill=(236, 234, 228, 255)); d.polygon([top, sm, sr], fill=(178, 182, 190, 255))
        # контур
        d.line([bl, top, br], fill=(52, 44, 36, 200), width=max(1, S // 2))
    lay = lay.resize((W, H), Image.LANCZOS)
    sh = sh.filter(ImageFilter.GaussianBlur(3 * S)).resize((W, H), Image.BILINEAR)
    L = np.asarray(lay).astype(np.float32); A = L[..., 3:4] / 255
    s = np.asarray(sh).astype(np.float32)[..., None] / 255
    o = out.astype(np.float32) * (1 - s * 0.45)
    o = o * (1 - A) + L[..., :3] * A
    return np.clip(o, 0, 255).astype(np.int32)
