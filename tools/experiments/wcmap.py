#!/usr/bin/env python3
"""
Акварельный рендер политической карты в духе Knights of Honor.

Вход:
  --map     политическая карта (PNG, цвета государств, море одним цветом)
  --relief  отмывка рельефа в равнопромежуточной проекции на весь мир
            (shadedrelief.jpg Тома Паттерсона / Natural Earth, общественное достояние;
             лежит, например, в пакете basemap-data: mpl_toolkits/basemap_data/shadedrelief.jpg)
  --crop    x0 y0 x1 y1 — фрагмент карты (в пикселях исходной карты)
  --guess   lon0 lat0 px_per_deg_lon px_per_deg_lat — грубая привязка левого верхнего угла
            фрагмента к координатам; скрипт сам уточняет её по береговой линии
Выход:
  --out     PNG

Зависимости: numpy, scipy, pillow.
"""
import argparse, json
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as ndi
from scipy.optimize import minimize

SEA = np.array([0, 31, 72])          # цвет моря на политической карте
OFFMAP = np.array([129, 129, 127])   # серые земли за пределами игровой зоны

PAPER = np.array([238, 226, 198]) / 255.0   # цвет бумаги
INK = np.array([70, 48, 32]) / 255.0        # сепия для линий и подписей
SEA_SHALLOW = np.array([150, 186, 184]) / 255.0
SEA_DEEP = np.array([58, 98, 120]) / 255.0
OFFMAP_WASH = np.array([196, 186, 160]) / 255.0
MOUNTAIN_TINT = np.array([150, 112, 72]) / 255.0


# ---------- шум ----------
def noise(shape, scale, rng, octaves=4):
    """Фрактальный шум 0..1 (сумма размытых случайных полей)."""
    out = np.zeros(shape)
    amp, tot = 1.0, 0.0
    for o in range(octaves):
        s = max(scale / (2 ** o), 0.8)
        out += amp * ndi.gaussian_filter(rng.standard_normal(shape), s)
        tot += amp
        amp *= 0.5
    out -= out.min()
    return out / (out.max() + 1e-9)


# ---------- 1. чистим политическую карту ----------
def clean_political(rgb):
    """Убирает линии провинций, белые горные метки и текст: заполняет их соседним цветом."""
    a = rgb.astype(int)
    grey = (a.max(2) - a.min(2)) < 12
    offmap = np.all(np.abs(a - OFFMAP) <= 3, axis=2)
    sea = np.linalg.norm(a - SEA, axis=2) < 60
    keep = (~grey | offmap) & ~sea
    keep |= sea
    lines = ~keep
    # исходные метки для дальнейшего использования
    white = np.all(a >= 245, axis=2)
    prov_lines = grey & ~white & ~offmap & (a.mean(2) > 150)   # светлые линии провинций
    ink = (a.mean(2) < 60) & ~sea                                # тёмные линии/текст
    _, (iy, ix) = ndi.distance_transform_edt(lines, return_indices=True)
    filled = a[iy, ix]
    filled[sea] = SEA
    return filled, sea | np.all(filled == SEA, axis=2), white, prov_lines, ink


# ---------- 2. привязка к координатам ----------
def relief_landmask(rel):
    r, g, b = [rel[..., i].astype(int) for i in range(3)]
    return ~((b > 190) & (b - r > 25))


def fit_georef(land, rel_land, guess, step=4):
    """Подгоняем lon0, lat0, kx, ky так, чтобы суша на карте совпала с сушей на рельефе."""
    H, W = rel_land.shape
    ys, xs = np.mgrid[0:land.shape[0]:step, 0:land.shape[1]:step]
    target = ndi.gaussian_filter(land[::step, ::step].astype(float), 2)
    relf = ndi.gaussian_filter(rel_land.astype(float), 1.5)

    def sample(p):
        lon0, lat0, kx, ky = p
        lon = lon0 + xs / kx
        lat = lat0 - ys / ky
        X = (lon + 180) / 360 * W
        Y = (90 - lat) / 180 * H
        return ndi.map_coordinates(relf, [Y, X], order=1)

    def loss(p):
        return np.mean((sample(p) - target) ** 2)

    best = None
    # грубый перебор вокруг догадки, потом Нелдер–Мид
    for dx in (-0.4, 0, 0.4):
        for dy in (-0.4, 0, 0.4):
            for s in (0.9, 1.0, 1.1):
                p0 = [guess[0] + dx, guess[1] + dy, guess[2] * s, guess[3] * s]
                l = loss(p0)
                if best is None or l < best[0]:
                    best = (l, p0)
    res = minimize(loss, best[1], method="Nelder-Mead",
                   options=dict(maxiter=600, xatol=1e-3, fatol=1e-6))
    return res.x, res.fun


# ---------- 3. горы-мазки ----------
def paint_mountains(base, height, land, scale, rng, spacing_px=26, size_k=0.75, thresh=0.36):
    """Рисует акварельные горы там, где рельеф высокий (в духе карт Knights of Honor).
    Горы рисуются от дальних к ближним; цвет берётся из подложки, поэтому горы
    «окрашиваются» в цвет государства, как на картах KoH."""
    H, W = height.shape
    sp = spacing_px                      # шаг сетки гор в пикселях готовой карты
    pts = []
    for gy in np.arange(sp / 2, H, sp * 0.5):
        row = int(gy // (sp * 0.5))
        for gx in np.arange(sp / 2 + (row % 2) * sp / 2, W, sp):
            x = int(gx + rng.uniform(-0.35, 0.35) * sp)
            y = int(gy + rng.uniform(-0.2, 0.2) * sp)
            if not (0 <= x < W and 0 <= y < H) or not land[y, x]:
                continue
            h = height[y, x]
            if h < thresh or rng.random() > (h - thresh) / (1 - thresh) * 1.1:
                continue
            pts.append((y, x, h))
    pts.sort()
    face = Image.new("L", (W, H), 0)     # 0 = нет горы, 1 = светлая грань, 2 = тень, 3 = контур
    df = ImageDraw.Draw(face)
    lw = max(1, int(round(scale * 0.7)))
    for y, x, h in pts:
        s_ = sp * size_k * (0.65 + 0.8 * h) * rng.uniform(0.8, 1.25)
        w = s_ * rng.uniform(1.9, 2.6)
        pk = rng.uniform(-0.3, 0.2)                    # положение вершины (-1..1)
        ts = np.linspace(-1, 1, 25)
        d = np.where(ts < pk, (pk - ts) / (1 + pk), (ts - pk) / (1 - pk))
        prof = 1 - np.abs(d) ** 0.8                     # острая вершина, широкие склоны
        bumps = ndi.gaussian_filter1d(rng.normal(0, 1, ts.size), 1.5)
        prof = np.clip(prof * (1 + 0.22 * bumps / (np.abs(bumps).max() + 1e-9)), 0, None)
        sil = [(x + t * w / 2, y - s_ * v) for t, v in zip(ts, prof)]
        ipk = int(np.argmax(prof))
        vx = sil[ipk][0] + rng.uniform(0.08, 0.25) * w
        vmid = ((sil[ipk][0] + vx) / 2 + rng.uniform(-0.04, 0.04) * w, y - s_ * rng.uniform(0.35, 0.55))
        df.polygon(sil, fill=2)
        df.polygon(sil[:ipk + 1] + [vmid, (vx, y)], fill=1)
        df.line(sil[1:-1], fill=3, width=lw)
    f = np.asarray(face)
    L = ndi.gaussian_filter((f == 1).astype(float), 0.8 * scale)
    D = ndi.gaussian_filter((f == 2).astype(float), 0.8 * scale)
    E = ndi.gaussian_filter((f == 3).astype(float), 0.45 * scale)
    M = ndi.gaussian_filter((f > 0).astype(float), 3 * scale)
    gran = (0.86 + 0.28 * noise((H, W), 1.4 * scale, rng, 2))[..., None]
    # мягкая тень у подножия гряды
    out = base * (1 - 0.12 * M[..., None])
    light_col = np.clip(base * 0.55 + PAPER * 0.45 + 0.03, 0, 1)
    dark_col = base * 0.68 * np.array([0.92, 0.86, 0.82])
    out = out * (1 - 0.9 * L[..., None]) + light_col * 0.9 * L[..., None]
    out = out * (1 - 0.9 * D[..., None]) + dark_col * gran * 0.9 * D[..., None]
    out = out * (1 - 0.45 * E[..., None]) + INK * 0.45 * E[..., None]
    return out


# ---------- 4. рендер ----------
def render(rgb, rel, georef, scale, seed=7, mountain_px=26, mountain_size=0.75, mountain_thresh=0.36):
    rng = np.random.default_rng(seed)
    filled, sea, white, prov_lines, ink = clean_political(rgb)

    # увеличиваем и сглаживаем «ступеньки» пикселей
    def up(arr, order=0):
        return ndi.zoom(arr, (scale, scale) + (() if arr.ndim == 2 else (1,)), order=order)
    filled = up(filled.astype(np.uint8))
    sea = ndi.gaussian_filter(up(sea.astype(np.uint8)).astype(float), scale * 0.9) > 0.5
    white = ndi.gaussian_filter(up(white.astype(float), 1), scale * 0.8)
    prov_lines = ndi.gaussian_filter(up(prov_lines.astype(float), 1), scale * 0.5)
    ink = ndi.gaussian_filter(up(ink.astype(float), 1), scale * 0.4)
    H, W = sea.shape

    # «дрожание» кромок мазка: сдвигаем метки шумом
    warp = 3.0 * scale
    wx = (noise((H, W), 18 * scale, rng, 3) - 0.5) * 2 * warp
    wy = (noise((H, W), 18 * scale, rng, 3) - 0.5) * 2 * warp
    yy, xx = np.mgrid[0:H, 0:W]
    Yw = np.clip(yy + wy, 0, H - 1).astype(int)
    Xw = np.clip(xx + wx, 0, W - 1).astype(int)
    filled = filled[Yw, Xw]
    sea = sea[Yw, Xw]
    sea = ndi.median_filter(sea.astype(np.uint8), size=int(3 * scale) | 1) > 0
    # согласуем цвета с гладкой береговой линией (убираем «лесенку» пикселей)
    wrong = np.all(filled.astype(int) == SEA, axis=2) & ~sea
    if wrong.any():
        _, (iy, ix) = ndi.distance_transform_edt(wrong | sea, return_indices=True)
        filled[wrong] = filled[iy[wrong], ix[wrong]]
    filled[sea] = SEA
    offmap = np.all(np.abs(filled.astype(int) - OFFMAP) <= 3, axis=2) & ~sea

    # ---- рельеф: координаты каждого пикселя ----
    lon0, lat0, kx, ky = georef
    lon = lon0 + (xx / scale) / kx
    lat = lat0 - (yy / scale) / ky
    RH, RW = rel.shape[:2]
    RX = (lon + 180) / 360 * RW
    RY = (90 - lat) / 180 * RH
    relf = rel.astype(float) / 255
    lum = relf.mean(2)
    shade = ndi.map_coordinates(ndi.gaussian_filter(lum, 0.8) - ndi.gaussian_filter(lum, 4), [RY, RX], order=3)
    ratio = relf[..., 0] / (relf[..., 1] + 1e-3)
    height = ndi.map_coordinates(ndi.gaussian_filter(ratio, 2.0), [RY, RX], order=3)
    shade = ndi.gaussian_filter(shade, scale * 2.0) * (0.15 + 0.85 * height)
    height = np.clip((height - 0.87) / 0.13, 0, 1) ** 1.3      # 0 = равнина, 1 = высокие горы
    height = ndi.gaussian_filter(height, scale * 2)

    # ---- суша: акварельная заливка ----
    base = filled.astype(float) / 255
    base = 0.55 * base + 0.45 * PAPER                    # пигмент разбавлен водой
    base[offmap] = OFFMAP_WASH
    # неравномерность пигмента и грануляция
    blot = noise((H, W), 40 * scale, rng)
    gran = noise((H, W), 1.2 * scale, rng, 2)
    base *= (0.93 + 0.10 * blot)[..., None]
    base *= (0.94 + 0.08 * gran)[..., None]

    # затемнение у края мазка (пигмент собирается по кромке)
    lab = (filled[..., 0].astype(int) << 16) | (filled[..., 1].astype(int) << 8) | filled[..., 2]
    edge = np.zeros((H, W), bool)
    edge[:-1] |= lab[:-1] != lab[1:]
    edge[1:] |= lab[:-1] != lab[1:]
    edge[:, :-1] |= lab[:, :-1] != lab[:, 1:]
    edge[:, 1:] |= lab[:, :-1] != lab[:, 1:]
    d = ndi.distance_transform_edt(~edge)
    pool = np.exp(-d / (2.2 * scale)) * (0.75 + 0.5 * noise((H, W), 6 * scale, rng, 2))
    base *= (1 - 0.30 * pool)[..., None]

    # горы: охристый тон + светотень
    m = height[..., None]
    base = base * (1 - 0.35 * m) + MOUNTAIN_TINT * 0.35 * m
    base *= (1 + np.clip(shade * 1.6, -0.12, 0.08))[..., None]
    # белые «непроходимые» метки — тёмный гребень
    ridge = np.clip(white * 1.4, 0, 1)[..., None]
    base = base * (1 - 0.30 * ridge) + INK * 0.30 * ridge
    base = paint_mountains(base, height, ~sea, scale, rng, mountain_px, mountain_size, mountain_thresh)

    # еле заметные границы провинций
    base = base * (1 - 0.18 * np.clip(prov_lines * 2, 0, 1))[..., None] + INK * 0.18 * np.clip(prov_lines * 2, 0, 1)[..., None]
    # подписи и реки за пределами игровой зоны — сепией
    inkm = np.clip(ink * 1.6, 0, 1)[..., None] * offmap[..., None]
    base = base * (1 - 0.8 * inkm) + INK * 0.8 * inkm

    # ---- море ----
    dist = ndi.distance_transform_edt(sea) / scale
    depth = np.clip(dist / 90, 0, 1) ** 0.7
    sea_col = SEA_SHALLOW * (1 - depth[..., None]) + SEA_DEEP * depth[..., None]
    sea_col *= (0.94 + 0.09 * noise((H, W), 30 * scale, rng))[..., None]
    sea_col *= (0.95 + 0.07 * gran)[..., None]
    # береговые полосы-«ореолы», как на старых картах
    bands = 0.5 + 0.5 * np.cos(dist / 3.2 * np.pi)
    halo = np.exp(-dist / 4.5) * bands
    sea_col = sea_col * (1 - 0.13 * halo[..., None]) + PAPER * 0.13 * halo[..., None]
    coast = np.exp(-dist / 1.0)
    sea_col = sea_col * (1 - 0.55 * coast[..., None]) + INK * 0.55 * coast[..., None]

    out = np.where(sea[..., None], sea_col, base)

    # ---- бумага ----
    fibers = ndi.gaussian_filter(rng.standard_normal((H, W)), (0.6, 3.5))
    out *= (1 + 0.035 * fibers / (np.abs(fibers).max() + 1e-9) * 3)[..., None]
    out *= (0.97 + 0.05 * noise((H, W), 120 * scale, rng, 2))[..., None]
    # мягкая виньетка
    vy = np.linspace(-1, 1, H)[:, None]
    vx = np.linspace(-1, 1, W)[None, :]
    out *= (1 - 0.12 * np.clip(vx ** 2 + vy ** 2 - 0.4, 0, 1))[..., None]
    return np.clip(out * 255, 0, 255).astype(np.uint8)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--map", required=True)
    ap.add_argument("--relief", required=True)
    ap.add_argument("--crop", type=int, nargs=4, required=True)
    ap.add_argument("--guess", type=float, nargs=4, required=True)
    ap.add_argument("--scale", type=int, default=2)
    ap.add_argument("--out", required=True)
    ap.add_argument("--georef-out", default=None)
    ap.add_argument("--mountain-px", type=float, default=26,
                    help="шаг между горами в пикселях готовой карты (больше = реже)")
    ap.add_argument("--mountain-size", type=float, default=0.75,
                    help="размер горы относительно шага (меньше = мельче)")
    ap.add_argument("--mountain-thresh", type=float, default=0.36,
                    help="с какой высоты рисовать горы, 0..1 (больше = только главные хребты)")
    a = ap.parse_args()

    Image.MAX_IMAGE_PIXELS = None
    rgb = np.array(Image.open(a.map).convert("RGB").crop(tuple(a.crop)))
    rel = np.array(Image.open(a.relief).convert("RGB"))

    land = np.linalg.norm(rgb.astype(int) - SEA, axis=2) >= 60
    params, err = fit_georef(land, relief_landmask(rel), a.guess)
    print("привязка: lon0=%.3f lat0=%.3f px/° lon=%.1f px/° lat=%.1f (ошибка %.4f)" % (*params, err))
    if a.georef_out:
        json.dump(dict(crop=a.crop, lon0=params[0], lat0=params[1], kx=params[2], ky=params[3]),
                  open(a.georef_out, "w"), indent=2)

    img = render(rgb, rel, params, a.scale, mountain_px=a.mountain_px, mountain_size=a.mountain_size,
                 mountain_thresh=a.mountain_thresh)
    Image.fromarray(img).save(a.out)
    print("сохранено:", a.out, img.shape[1], "x", img.shape[0])


if __name__ == "__main__":
    main()
