# Рисованные значки местности: пики гор и деревья.
# Точки и все их случайные свойства выбираются один раз для всей карты (*_points), а рисуются (render_*)
# в любом масштабе K и любом прямоугольнике — так подложка 1× и плитки 2× совпадают без швов.
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
import scipy.ndimage as nd

def _pick(mask, cell, rng, keep):
    H, W = mask.shape
    ys, xs = np.nonzero(mask)
    key = (ys // cell) * (W // cell + 1) + (xs // cell)
    order = rng.permutation(len(ys)); _, first = np.unique(key[order], return_index=True)
    sel = order[first]
    pk = keep if np.isscalar(keep) else keep[ys[sel], xs[sel]]
    sel = sel[rng.random(len(sel)) < pk]
    return ys[sel], xs[sel]

def peak_points(allm, rng, cell=7, keep=0.85):
    py, px = _pick(allm, cell, rng, keep)
    t = nd.gaussian_filter(allm.astype(np.float32), 3.0)[py, px]
    n = len(py)
    size = (5.5 + 9 * np.minimum(1.0, t * 1.6)) * (0.8 + rng.random(n) * 0.45)
    return dict(x=px.astype(np.float32), y=py.astype(np.float32), size=size, hk=1.05 + rng.random(n) * 0.35,
                ax=rng.random(n) - 0.5, mid=rng.random(n) - 0.4, jl=rng.integers(-8, 9, n), jd=rng.integers(-6, 7, n))

def tree_points(forest, conifer, rng, cell=5):
    py, px = _pick(forest, cell, rng, 0.92)
    n = len(py)
    return dict(x=px + rng.random(n) - 0.5, y=py + rng.random(n) - 0.5, con=conifer[py, px],
                sz=3.6 + rng.random(n) * 1.6, j=rng.integers(-10, 11, n))

def _sub(P, x0, y0, x1, y1, m):
    s = (P['x'] >= x0 - m) & (P['x'] < x1 + m) & (P['y'] >= y0 - m) & (P['y'] < y1 + m)
    return {k: v[s] for k, v in P.items()}

def render_peaks(out, P, x0=0, y0=0, K=1, S=2):
    """out — кусок карты в масштабе K, левый верхний угол = (x0, y0) в координатах 1×."""
    h, w = out.shape[:2]
    P = _sub(P, x0, y0, x0 + w / K, y0 + h / K, 30)
    lay = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    sh = Image.new('L', (w * S, h * S), 0); ds = ImageDraw.Draw(sh)
    F = K * S
    for i in np.argsort(P['y'], kind='stable'):
        x, y = (P['x'][i] - x0) * F, (P['y'][i] - y0) * F
        size = P['size'][i]
        wd = size * F * 1.25; ht = size * F * P['hk'][i]
        ax = x + P['ax'][i] * wd * 0.25
        top, bl, br = (ax, y - ht * 0.75), (x - wd / 2, y + ht * 0.25), (x + wd / 2, y + ht * 0.25)
        mid = (ax + P['mid'][i] * wd * 0.12, y + ht * 0.25)
        lit = tuple(int(c + P['jl'][i]) for c in (156, 140, 112)); dark = tuple(int(c + P['jd'][i]) for c in (92, 78, 60))
        ds.polygon([top, (br[0] + wd * 0.35, br[1] - ht * 0.05), br, mid], fill=110)
        d.polygon([top, bl, mid], fill=lit + (255,)); d.polygon([top, mid, br], fill=dark + (255,))
        if size > 11.5:
            f = 0.32
            sl = (top[0] + (bl[0] - top[0]) * f, top[1] + (bl[1] - top[1]) * f)
            sm = (top[0] + (mid[0] - top[0]) * f * 1.1, top[1] + (mid[1] - top[1]) * f * 1.1)
            sr = (top[0] + (br[0] - top[0]) * f, top[1] + (br[1] - top[1]) * f)
            d.polygon([top, sl, sm], fill=(236, 234, 228, 255)); d.polygon([top, sm, sr], fill=(178, 182, 190, 255))
        d.line([bl, top, br], fill=(52, 44, 36, 200), width=max(1, round(F / 2)))
    return _compose(out, lay, sh, 3 * F, 0.45)

def render_trees(out, P, x0=0, y0=0, K=1, S=2):
    h, w = out.shape[:2]
    P = _sub(P, x0, y0, x0 + w / K, y0 + h / K, 12)
    lay = Image.new('RGBA', (w * S, h * S), (0, 0, 0, 0)); d = ImageDraw.Draw(lay)
    sh = Image.new('L', (w * S, h * S), 0); ds = ImageDraw.Draw(sh)
    F = K * S; lw = max(1, round(F / 2))
    for i in np.argsort(P['y'], kind='stable'):
        x, y = (P['x'][i] - x0) * F, (P['y'][i] - y0) * F
        sz = P['sz'][i] * F; j = int(P['j'][i])
        if P['con'][i]:
            dark, lit = (38 + j // 2, 62 + j, 44 + j // 2), (60 + j // 2, 88 + j, 60 + j // 2)
            ds.ellipse([x - sz * 0.2, y - sz * 0.1, x + sz * 0.9, y + sz * 0.35], fill=120)
            for wf, yf in ((0.5, 0.0), (0.38, -0.45)):
                top = (x, y - sz * (0.95 + yf * 0.2) + yf * sz); bl = (x - sz * wf, y + yf * sz * 0.9); br = (x + sz * wf, y + yf * sz * 0.9)
                d.polygon([top, bl, (x, y + yf * sz * 0.9)], fill=lit + (255,)); d.polygon([top, (x, y + yf * sz * 0.9), br], fill=dark + (255,))
            d.line([(x, y), (x, y + sz * 0.2)], fill=(60, 44, 30, 255), width=lw)
        else:
            r = sz * 0.55
            base, hi, lo = (72 + j, 98 + j, 50 + j // 2), (106 + j, 132 + j, 70 + j // 2), (50 + j // 2, 70 + j, 38)
            ds.ellipse([x - r * 0.2, y - r * 0.2, x + r * 1.6, y + r * 0.9], fill=120)
            d.line([(x, y + r * 0.2), (x, y + r * 0.9)], fill=(70, 52, 34, 255), width=lw)
            d.ellipse([x - r, y - r * 1.5, x + r, y + r * 0.3], fill=lo + (255,))
            d.ellipse([x - r * 0.95, y - r * 1.55, x + r * 0.75, y + r * 0.1], fill=base + (255,))
            d.ellipse([x - r * 0.75, y - r * 1.45, x + r * 0.1, y - r * 0.55], fill=hi + (255,))
    return _compose(out, lay, sh, 1.5 * F, 0.4)

def forest_floor(out, forest_soft):
    floor = np.array([84, 98, 70], np.float32)
    s = forest_soft[..., None] * 0.55
    return out.astype(np.float32) * (1 - s) + floor * s

def _compose(out, lay, sh, blur, sk):
    h, w = out.shape[:2]
    lay = lay.resize((w, h), Image.LANCZOS)
    sh = sh.filter(ImageFilter.GaussianBlur(blur)).resize((w, h), Image.BILINEAR)
    L = np.asarray(lay).astype(np.float32); A = L[..., 3:4] / 255
    s = np.asarray(sh).astype(np.float32)[..., None] / 255
    o = out.astype(np.float32) * (1 - s * sk)
    o = o * (1 - A) + L[..., :3] * A
    return np.clip(o, 0, 255).astype(np.int32)

# совместимость
def draw_peaks(out, allm, rng, scale=2, cell=7, bg=None, keep=None):
    return render_peaks(out, peak_points(allm, rng, cell, 0.85 if keep is None else keep))
def draw_trees(out, forest, conifer, rng, scale=2, cell=5):
    o = forest_floor(out, nd.gaussian_filter(forest.astype(np.float32), 2.0))
    return render_trees(o, tree_points(forest, conifer, rng, cell))
