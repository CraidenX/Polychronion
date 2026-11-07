# Акварельный рендер (по скрипту автора watercolor_map_1.py) для участка Сицилия + Калабрия,
# с нашими данными вместо внешней отмывки: высоты tools/terrain/height.png (уже совмещены с картой), реки umap/rivers.npy.
import sys, glob
sys.path.insert(0, '/tmp/claude-0/-home-user/697d9db8-74f0-5c0a-8a74-95666c35c65d/scratchpad/wc')
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage as ndi
import wcmap as W
from wcmap import noise, clean_political, paint_mountains, PAPER, INK, SEA, OFFMAP, SEA_SHALLOW, SEA_DEEP, OFFMAP_WASH, MOUNTAIN_TINT
R = '/home/user/polychronion/'
OUT = '/tmp/claude-0/-home-user/697d9db8-74f0-5c0a-8a74-95666c35c65d/scratchpad/wc/'
x0, y0, x1, y1 = 101, 1070, 791, 1611
scale = 2
P = np.asarray(Image.open(sorted(glob.glob(R + 'source/*political*.png'))[0]).convert('RGB'))[y0:y1, x0:x1].copy()
k = (P[..., 0].astype(int) << 16) | (P[..., 1].astype(int) << 8) | P[..., 2]
# наши цвета -> обозначения скрипта: коричневые хребты = «белые метки гор», контур хребта/границы регионов — линии
brown = np.isin(k, [0x8B5A2B, 0x4A2F1A, 0xFF00FF])
P[brown] = (223, 223, 223)
P[k == 0x000020] = (0, 31, 72)
hgt = np.asarray(Image.open(R + 'tools/terrain/height.png')).astype(float)[y0:y1, x0:x1]
rivers = np.load(R + 'tools/umap/rivers.npy')[y0:y1, x0:x1].astype(float) / 255

def render(rgb, scale, seed=7, mountain_px=26, mountain_size=0.75, mountain_thresh=0.36, with_rivers=True):
    rng = np.random.default_rng(seed)
    filled, sea, white, prov_lines, ink = clean_political(rgb)
    white = brown.astype(float)
    def up(arr, order=0):
        return ndi.zoom(arr, (scale, scale) + (() if arr.ndim == 2 else (1,)), order=order)
    filled = up(filled.astype(np.uint8))
    sea = ndi.gaussian_filter(up(sea.astype(np.uint8)).astype(float), scale * 0.9) > 0.5
    white = ndi.gaussian_filter(up(white, 1), scale * 0.8)
    prov_lines = ndi.gaussian_filter(up(prov_lines.astype(float), 1), scale * 0.5)
    ink = ndi.gaussian_filter(up(ink.astype(float), 1), scale * 0.4)
    H, Wd = sea.shape
    warp = 3.0 * scale
    wx = (noise((H, Wd), 18 * scale, rng, 3) - 0.5) * 2 * warp
    wy = (noise((H, Wd), 18 * scale, rng, 3) - 0.5) * 2 * warp
    yy, xx = np.mgrid[0:H, 0:Wd]
    Yw = np.clip(yy + wy, 0, H - 1).astype(int); Xw = np.clip(xx + wx, 0, Wd - 1).astype(int)
    filled = filled[Yw, Xw]; sea = sea[Yw, Xw]
    sea = ndi.median_filter(sea.astype(np.uint8), size=int(3 * scale) | 1) > 0
    wrong = np.all(filled.astype(int) == SEA, axis=2) & ~sea
    if wrong.any():
        _, (iy, ix) = ndi.distance_transform_edt(wrong | sea, return_indices=True)
        filled[wrong] = filled[iy[wrong], ix[wrong]]
    filled[sea] = SEA
    offmap = np.all(np.abs(filled.astype(int) - OFFMAP) <= 3, axis=2) & ~sea
    # ---- рельеф из наших высот (вместо внешней отмывки) ----
    hh = up(hgt, 3)
    shade = ndi.gaussian_filter(hh, 0.8 * scale) - ndi.gaussian_filter(hh, 4 * scale)
    shade = shade / 12
    height = np.clip((ndi.gaussian_filter(hh, scale) - 100) / 26, 0, 1)
    rg = ndi.gaussian_filter(up(brown.astype(float), 1), 2.5 * scale)
    height = np.maximum(height, np.clip(rg * 2.2, 0, 1) * 0.85)   # игровые хребты — всегда горы
    shade = ndi.gaussian_filter(shade, scale * 1.0) * (0.15 + 0.85 * height)
    height = height ** 1.3
    height = ndi.gaussian_filter(height, scale * 2)
    base = filled.astype(float) / 255
    base = 0.55 * base + 0.45 * PAPER
    base[offmap] = OFFMAP_WASH
    blot = noise((H, Wd), 40 * scale, rng); gran = noise((H, Wd), 1.2 * scale, rng, 2)
    base *= (0.93 + 0.10 * blot)[..., None]; base *= (0.94 + 0.08 * gran)[..., None]
    lab = (filled[..., 0].astype(int) << 16) | (filled[..., 1].astype(int) << 8) | filled[..., 2]
    edge = np.zeros((H, Wd), bool)
    edge[:-1] |= lab[:-1] != lab[1:]; edge[1:] |= lab[:-1] != lab[1:]
    edge[:, :-1] |= lab[:, :-1] != lab[:, 1:]; edge[:, 1:] |= lab[:, :-1] != lab[:, 1:]
    d = ndi.distance_transform_edt(~edge)
    pool = np.exp(-d / (2.2 * scale)) * (0.75 + 0.5 * noise((H, Wd), 6 * scale, rng, 2))
    base *= (1 - 0.30 * pool)[..., None]
    m = height[..., None]
    base = base * (1 - 0.35 * m) + MOUNTAIN_TINT * 0.35 * m
    base *= (1 + np.clip(shade * 1.6, -0.12, 0.08))[..., None]
    ridge = np.clip(white * 1.4, 0, 1)[..., None]
    # реки — разбавленной синькой под горами
    if with_rivers:
        rv = ndi.gaussian_filter(up(rivers, 1), 0.6 * scale)[Yw, Xw]
        rv = np.clip(rv * 1.4, 0, 1)[..., None] * 0.75
        base = base * (1 - rv) + np.array([70, 110, 140]) / 255 * rv
    base = paint_mountains(base, height, ~sea, scale, rng, mountain_px, mountain_size, mountain_thresh)
    base = base * (1 - 0.18 * np.clip(prov_lines * 2, 0, 1))[..., None] + INK * 0.18 * np.clip(prov_lines * 2, 0, 1)[..., None]
    inkm = np.clip(ink * 1.6, 0, 1)[..., None] * offmap[..., None]
    base = base * (1 - 0.8 * inkm) + INK * 0.8 * inkm
    dist = ndi.distance_transform_edt(sea) / scale
    depth = np.clip(dist / 90, 0, 1) ** 0.7
    sea_col = SEA_SHALLOW * (1 - depth[..., None]) + SEA_DEEP * depth[..., None]
    sea_col *= (0.94 + 0.09 * noise((H, Wd), 30 * scale, rng))[..., None]
    sea_col *= (0.95 + 0.07 * gran)[..., None]
    bands = 0.5 + 0.5 * np.cos(dist / 3.2 * np.pi)
    halo = np.exp(-dist / 4.5) * bands
    sea_col = sea_col * (1 - 0.13 * halo[..., None]) + PAPER * 0.13 * halo[..., None]
    coast = np.exp(-dist / 1.0)
    sea_col = sea_col * (1 - 0.55 * coast[..., None]) + INK * 0.55 * coast[..., None]
    out = np.where(sea[..., None], sea_col, base)
    fibers = ndi.gaussian_filter(rng.standard_normal((H, Wd)), (0.6, 3.5))
    out *= (1 + 0.035 * fibers / (np.abs(fibers).max() + 1e-9) * 3)[..., None]
    out *= (0.97 + 0.05 * noise((H, Wd), 120 * scale, rng, 2))[..., None]
    return np.clip(out * 255, 0, 255).astype(np.uint8)

img = render(P, scale, mountain_px=20, mountain_size=0.7, mountain_thresh=0.3)
Image.fromarray(img).save(OUT + 'wc_sicily.png')
# для сравнения — тот же участок в нынешнем стиле (плитки 2×)
cur = Image.open(R + 'map.jpg').crop((x0, y0, x1, y1)).resize(((x1 - x0) * 2, (y1 - y0) * 2), Image.BICUBIC)
cur.save(OUT + 'cur_sicily.png')
print(img.shape)
