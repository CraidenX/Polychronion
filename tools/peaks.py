# Стилизованные горы в духе «рисованных» стратегий: по хребтам расставляются пики-пирамидки
# (освещённый левый склон, теневой правый, снег на высоких), рисуются от дальних к ближним.
# draw_peaks(out, allm, zone_or_None, seed) -> out (RGB, int32), рисует поверх.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import scipy.ndimage as nd

def draw_peaks(out, allm, rng, scale=2, cell=7, bg=None, keep=None):
    H, W = allm.shape
    # «высота» хребта: толщина маски вокруг точки — крупнее пики там, где хребет толще
    thick = nd.gaussian_filter(allm.astype(np.float32), 3.0)
    ys, xs = np.nonzero(allm)
    # одна вершина на клетку cell×cell (со случайным сдвигом сетки)
    key = (ys // cell) * (W // cell + 1) + (xs // cell)
    order = rng.permutation(len(ys))
    _, first = np.unique(key[order], return_index=True)
    sel = order[first]
    pk = 0.85 if keep is None else keep[ys[sel], xs[sel]]
    sel = sel[rng.random(len(sel)) < pk]
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

def draw_trees(out, forest, conifer, rng, scale=2, cell=5):
    """Деревья-значки по маске леса: хвойные (тёмные ёлки) у гор, лиственные (кроны) на равнинах; тень вправо-вниз."""
    H, W = forest.shape
    # подложка леса: земля под кронами темнее и зеленее
    soft = nd.gaussian_filter(forest.astype(np.float32), 2.0)[..., None]
    floor = np.array([84, 98, 70], np.float32)
    o = out.astype(np.float32) * (1 - soft * 0.55) + floor * soft * 0.55
    ys, xs = np.nonzero(forest)
    key = (ys // cell) * (W // cell + 1) + (xs // cell)
    order = rng.permutation(len(ys)); _, first = np.unique(key[order], return_index=True)
    sel = order[first]; sel = sel[rng.random(len(sel)) < 0.92]
    py, px = ys[sel], xs[sel]; con = conifer[py, px]
    S = scale
    lay = Image.new('RGBA', (W * S, H * S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    sh = Image.new('L', (W * S, H * S), 0); ds = ImageDraw.Draw(sh)
    for i in np.argsort(py):
        x, y = (px[i] + rng.random() - 0.5) * S, (py[i] + rng.random() - 0.5) * S
        sz = (3.6 + rng.random() * 1.6) * S
        j = int(rng.integers(-10, 11))
        if con[i]:
            # ёлка: два яруса
            dark, lit = (38 + j // 2, 62 + j, 44 + j // 2), (60 + j // 2, 88 + j, 60 + j // 2)
            ds.ellipse([x - sz * 0.2, y - sz * 0.1, x + sz * 0.9, y + sz * 0.35], fill=120)
            for t, (wf, yf) in enumerate(((0.5, 0.0), (0.38, -0.45))):
                top = (x, y - sz * (0.95 + yf * 0.2) + yf * sz); bl = (x - sz * wf, y + yf * sz * 0.9); br = (x + sz * wf, y + yf * sz * 0.9)
                d.polygon([top, bl, (x, y + yf * sz * 0.9)], fill=lit + (255,)); d.polygon([top, (x, y + yf * sz * 0.9), br], fill=dark + (255,))
            d.line([(x, y), (x, y + sz * 0.2)], fill=(60, 44, 30, 255), width=max(1, S // 2))
        else:
            # лиственное: крона с бликом слева-сверху
            r = sz * 0.55
            base, hi, lo = (72 + j, 98 + j, 50 + j // 2), (106 + j, 132 + j, 70 + j // 2), (50 + j // 2, 70 + j, 38)
            ds.ellipse([x - r * 0.2, y - r * 0.2, x + r * 1.6, y + r * 0.9], fill=120)
            d.line([(x, y + r * 0.2), (x, y + r * 0.9)], fill=(70, 52, 34, 255), width=max(1, S // 2))
            d.ellipse([x - r, y - r * 1.5, x + r, y + r * 0.3], fill=lo + (255,))
            d.ellipse([x - r * 0.95, y - r * 1.55, x + r * 0.75, y + r * 0.1], fill=base + (255,))
            d.ellipse([x - r * 0.75, y - r * 1.45, x + r * 0.1, y - r * 0.55], fill=hi + (255,))
    lay = lay.resize((W, H), Image.LANCZOS)
    sh = sh.filter(ImageFilter.GaussianBlur(1.5 * S)).resize((W, H), Image.BILINEAR)
    L = np.asarray(lay).astype(np.float32); A = L[..., 3:4] / 255
    s = np.asarray(sh).astype(np.float32)[..., None] / 255
    o = o * (1 - s * 0.4)
    o = o * (1 - A) + L[..., :3] * A
    return np.clip(o, 0, 255).astype(np.int32)
