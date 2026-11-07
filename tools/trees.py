# Деревья в духе Knights of Honor: готовые рисунки (кудрявая крона из «шапок» листвы, блик сверху-слева,
# тень снизу-справа, фактура листьев, ствол; ёлки — ярусами с рваным краем). Рисуются один раз крупно (N px),
# в карту ставятся уменьшенными копиями.
import numpy as np
from PIL import Image
import scipy.ndimage as nd
N = 96
def _fbm(shape, s, r):
    o = np.zeros(shape, np.float32); a = 1
    for i in range(4): o += a * nd.gaussian_filter(r.standard_normal(shape).astype(np.float32), max(s / 2 ** i, .6)); a *= .55
    return (o - o.mean()) / (o.std() + 1e-6)
def _blobs(yy, xx, pts):
    D = np.zeros(yy.shape, np.float32)
    for x, y, rr in pts: D += np.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (rr * rr) * 1.8)
    return D
def _shade(D, r, dark, mid, light, ink=(26, 36, 22)):
    A = np.clip((D - 0.45) / 0.35, 0, 1); A = A * A * (3 - 2 * A)
    gy, gx = np.gradient(nd.gaussian_filter(D, 2.2))
    lit = np.clip(0.5 - (gx + gy) * 2.6, 0, 1)                     # свет сверху-слева
    tex = _fbm(D.shape, 1.6, r)                                       # листва
    s = np.clip(lit + tex * 0.13, 0, 1)[..., None]
    dark, mid, light = (np.array(c, np.float32) for c in (dark, mid, light))
    col = np.where(s < .5, dark + (mid - dark) * (s / .5), mid + (light - mid) * ((s - .5) / .5))
    edge = np.clip(1 - np.abs(A - .5) * 2.6, 0, 1)[..., None] * 0.45   # тонкий тёмный контур
    col = col * (1 - edge) + np.array(ink, np.float32) * edge
    return col, A
def deciduous(seed):
    r = np.random.default_rng(seed); yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cx, cy = N / 2, N * 0.42
    pts = [(cx + r.normal(0, N * .1), cy + r.normal(0, N * .07), N * r.uniform(.17, .26)) for _ in range(int(r.integers(4, 8)))]
    D = _blobs(yy, xx, pts)
    prof = [(x, y, rr) for x, y, rr in pts]
    for _ in range(int(r.integers(26, 40))):                          # мелкие шапки листвы по краю — кудрявый силуэт
        x, y, rr = prof[r.integers(len(prof))]; a = r.uniform(0, 2 * np.pi); d = rr * r.uniform(.75, 1.0)
        D += 0.8 * np.exp(-((xx - x - np.cos(a) * d) ** 2 + (yy - y - np.sin(a) * d) ** 2) / (N * r.uniform(.05, .09)) ** 2 * 1.8)
    tone = r.uniform(-12, 12)
    col, A = _shade(D, r, (30 + tone * .3, 52 + tone * .5, 26), (60 + tone, 90 + tone, 42), (116 + tone, 140 + tone, 72))
    # ствол под кроной
    tm = (np.abs(xx - cx) < N * .03) & (yy > cy + N * .14) & (yy < N * .74) & (A < .5)
    col[tm] = (82, 58, 36); A = np.maximum(A, tm * 1.0)
    return np.dstack([col, A[..., None] * 255]).clip(0, 255).astype(np.uint8)
def conifer(seed):
    r = np.random.default_rng(seed); yy, xx = np.mgrid[0:N, 0:N].astype(np.float32)
    cx = N / 2 + r.normal(0, 1.5); top, bot = N * r.uniform(.06, .14), N * .8
    D = np.zeros((N, N), np.float32); tiers = int(r.integers(4, 7))
    for t in range(tiers):
        f = (t + 1) / tiers; ty = top + (bot - top) * f; hw = N * (.1 + .24 * f) * r.uniform(.9, 1.1); th = (bot - top) / tiers * 1.7
        inside = (yy <= ty) & (yy >= ty - th) & (np.abs(xx - cx) <= hw * (yy - (ty - th)) / th)
        D = np.maximum(D, nd.gaussian_filter(inside.astype(np.float32), 1.6) * 1.3)
    D = D + _fbm((N, N), 1.4, r) * 0.12
    tone = r.uniform(-8, 8)
    col, A = _shade(D, r, (24, 44 + tone, 30), (46, 78 + tone, 48), (96, 122 + tone, 76), ink=(16, 28, 20))
    tm = (np.abs(xx - cx) < N * .03) & (yy > bot - 2) & (yy < N * .88)
    col[tm] = (70, 50, 32); A = np.maximum(A, tm * 1.0)
    return np.dstack([col, A[..., None] * 255]).clip(0, 255).astype(np.uint8)
SPR = {'d': [Image.fromarray(deciduous(100 + i), 'RGBA') for i in range(10)], 'c': [Image.fromarray(conifer(200 + i), 'RGBA') for i in range(6)]}
_cache = {}
def sprite(kind, idx, px):
    key = (kind, idx, px)
    if key not in _cache: _cache[key] = SPR[kind][idx % len(SPR[kind])].resize((px, px), Image.LANCZOS)
    return _cache[key]
def sheet(path):
    im = Image.new('RGBA', (N * 8, N * 2), (120, 140, 90, 255))
    for i, s in enumerate(SPR['d'][:8]): im.alpha_composite(s, (i * N, 0))
    for i, s in enumerate(SPR['c'] + SPR['d'][8:]): im.alpha_composite(s, (i * N, N))
    im.convert('RGB').save(path)
