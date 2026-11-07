# Акварельная подложка (стиль по скрипту автора watercolor_map.py, «в духе Knights of Honor»), вся карта:
#   map_wc.jpg (1×) и плитки hi_wc/ (2×) для приближения.
# Отличия от первого опыта (6 правок): цвет местности из эталона, разбавленный бумагой (зелень/степь/пустыня);
# акварельные леса; горы крупнее, с контуром и снегом на высоких; спокойное море со штрихами волн;
# цвета держав не смешиваются с подложкой (их кладёт игра отдельным слоем); плитки 2× с перерисовкой значков.
# Входы: tools/terrain/*, umap/masks.npz (mkmap3.py), umap/rivers.npy. Запуск: python3 mkwater.py ..
import os, sys, json, math
import numpy as np
from PIL import Image, ImageDraw
import scipy.ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUTD = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
Mk = np.load(SP + 'umap/masks.npz')
forest, conifer, ridge, emtn, zone, land, WL, WP = (Mk[n] for n in ('forest', 'conifer', 'ridge', 'mtn', 'zone', 'land', 'water', 'cleanwater'))
k = Mk['k']
H, W = land.shape
ecol = np.asarray(Image.open(SP + 'terrain/color.jpg').convert('RGB')).astype(np.float32) / 255
ter = np.asarray(Image.open(SP + 'terrain/type.png'))
hgt = np.asarray(Image.open(SP + 'terrain/height.png')).astype(np.float32)
RV = np.load(SP + 'umap/rivers.npy').astype(np.float32) / 255
PAPER = np.array([238, 226, 198], np.float32) / 255
INK = np.array([70, 48, 32], np.float32) / 255
SEA_SHALLOW = np.array([92, 140, 150], np.float32) / 255
SEA_DEEP = np.array([44, 82, 108], np.float32) / 255
MTN = np.array([150, 112, 72], np.float32) / 255
RIVER = np.array([64, 104, 136], np.float32) / 255
rng = np.random.default_rng(1261)
def noise(scale, oct=4, shape=(H, W), r=rng):
    out = np.zeros(shape, np.float32); amp = 1.0
    for o in range(oct):
        s = max(scale / 2 ** o, 0.8)
        out += amp * nd.gaussian_filter(r.standard_normal(shape).astype(np.float32), s); amp *= 0.5
    out -= out.min(); return out / (out.max() + 1e-9)

# ---------- 1×: суша ----------
# 1) цвет местности эталона, приглушённый и «разбавленный» бумагой
lum = ecol.mean(2, keepdims=True)
pig = np.clip((ecol - lum) * 1.05 + lum, 0, 1) * 1.12            # снимок -> пигмент: светлее, цвет сохраняется
pig = nd.gaussian_filter(pig, (2.0, 2.0, 0))            # мазок — без пиксельной ряби
base = pig * 0.58 + PAPER * 0.42
blot = noise(40); gran = noise(1.2, 2)
base *= (0.93 + 0.10 * blot)[..., None]; base *= (0.94 + 0.08 * gran)[..., None]
# пигмент собирается у края мазка: на границах типов местности и у берега
tl = ter.astype(np.int32)
edge = np.zeros((H, W), bool)
edge[:-1] |= tl[:-1] != tl[1:]; edge[:, :-1] |= tl[:, :-1] != tl[:, 1:]
edge = nd.binary_opening(nd.gaussian_filter(edge.astype(np.float32), 1.5) > 0.25) | (nd.binary_dilation(WL, iterations=1) & land)
d = nd.distance_transform_edt(~edge)
pool = np.exp(-d / 2.4) * (0.75 + 0.5 * noise(6, 2))
base *= (1 - 0.16 * pool)[..., None]
# рельеф: охра на высоком + мягкая светотень
Hs = nd.gaussian_filter(hgt, 1.0)
rg = nd.gaussian_filter(ridge.astype(np.float32), 2.5)
loc = Hs - nd.gaussian_filter(Hs, 22)                              # перепад высот: плато ровное — не горы
height = np.clip(loc / 10, 0, 1) * 0.85 + np.clip((Hs - 127) / 10, 0, 1) * 0.5
height = np.clip(nd.gaussian_filter(height, 1.5), 0, 1)
height = np.maximum(height, np.clip(rg * 2.2, 0, 1) * 0.85)      # игровые хребты — всегда горы
shade = (nd.gaussian_filter(Hs, 0.8) - nd.gaussian_filter(Hs, 4)) / 12
shade = nd.gaussian_filter(shade, 1.0) * (0.15 + 0.85 * height)
hsm = nd.gaussian_filter(height ** 1.3, 2)
m = hsm[..., None]
base = base * (1 - 0.30 * m) + MTN * 0.30 * m
base *= (1 + np.clip(shade * 1.6, -0.12, 0.08))[..., None]
# земли за краем игровой зоны — бледнее (игра кладёт поверх серую вуаль)
outer = land & ~nd.binary_dilation(zone, iterations=2)
base[outer] = base[outer] * 0.7 + PAPER * 0.3
# ---------- 1×: море ----------
dist = nd.distance_transform_edt(WL)
lab_, nl_ = nd.label(land); sz_ = nd.sum(land, lab_, range(1, nl_ + 1))
bigland2 = np.isin(lab_, [i + 1 for i, v in enumerate(sz_) if v >= 400])   # островки не дают светлых пятен мелководья
dist2 = nd.distance_transform_edt(~bigland2)
bigland = nd.binary_opening(land, iterations=4)                    # ореол — только у крупных берегов
distb = nd.distance_transform_edt(~bigland)
depth = np.clip(dist2 / 30, 0, 1) ** 0.6
sea = SEA_SHALLOW * (1 - depth[..., None]) + SEA_DEEP * depth[..., None]
sea *= (0.97 + 0.04 * noise(30))[..., None]                         # спокойнее, без «облаков»
sea *= (0.97 + 0.05 * gran)[..., None]
bands = 0.5 + 0.5 * np.cos(distb / 3.2 * np.pi)
halo = np.exp(-distb / 4.0) * bands * (distb < 14)
sea = sea * (1 - 0.10 * halo[..., None]) + PAPER * 0.10 * halo[..., None]
coast = np.exp(-dist / 1.0)
sea = sea * (1 - 0.55 * coast[..., None]) + INK * 0.55 * coast[..., None]
B0 = np.where(WL[..., None], sea, base)
# бумага
fib = nd.gaussian_filter(rng.standard_normal((H, W)).astype(np.float32), (0.6, 3.5))
B0 *= (1 + 0.035 * fib / (np.abs(fib).max() + 1e-9) * 3)[..., None]
B0 *= (0.97 + 0.05 * noise(120, 2))[..., None]
B0 = np.clip(B0, 0, 1)

# ---------- значки: точки выбираются один раз, рисуются в любом масштабе ----------
def pick(mask, cell, keep, rr):
    ys, xs = np.nonzero(mask)
    key = (ys // cell) * (W // cell + 1) + (xs // cell)
    o = rr.permutation(len(ys)); _, f = np.unique(key[o], return_index=True); s = o[f]
    kp = keep if np.isscalar(keep) else keep[ys[s], xs[s]]
    s = s[rr.random(len(s)) < kp]
    return xs[s] + rr.random(len(s)) - 0.5, ys[s] + rr.random(len(s)) - 0.5
r2 = np.random.default_rng(7)
# горы: сетка со сдвигом рядов, вероятность растёт с высотой (как в скрипте автора)
SPG, SIZEK, TH = 11.0, 0.9, 0.42
gm = (hsm >= TH) & land & (nd.distance_transform_edt(land) >= 4) & bigland2   # не на крошечных островах и не на самом берегу
mx, my = pick(gm, int(SPG * 0.75), np.clip((hsm - TH) / (1 - TH) * 1.15, 0, 1), r2)
mh = hsm[np.clip(my.astype(int), 0, H - 1), np.clip(mx.astype(int), 0, W - 1)]
n = len(mx)
MP = dict(x=mx, y=my, h=mh, s=SPG * SIZEK * (0.65 + 0.8 * mh) * r2.uniform(0.8, 1.25, n), wk=r2.uniform(1.9, 2.6, n),
          pk=r2.uniform(-0.3, 0.2, n), bumps=nd.gaussian_filter1d(r2.normal(0, 1, (n, 25)), 1.5, axis=1),
          vx=r2.uniform(0.08, 0.25, n), vm=r2.uniform(-0.04, 0.04, n), vy=r2.uniform(0.35, 0.55, n))
# деревья: лиственные — кроны-кружки, хвойные — ёлки
tx, ty = pick(forest & land, 4, 0.9, r2)
TP = dict(x=tx, y=ty, con=conifer[np.clip(ty.astype(int), 0, H - 1), np.clip(tx.astype(int), 0, W - 1)], r=r2.uniform(1.7, 2.5, len(tx)), j=r2.uniform(-0.06, 0.06, len(tx)))
# штрихи волн в открытом море
wx, wy = pick(WL & (dist > 26), 46, 0.55, r2)
WV = dict(x=wx, y=wy, l=r2.uniform(5, 8, len(wx)))
def sub(P, x0, y0, x1, y1, mg):
    s = (P['x'] >= x0 - mg) & (P['x'] < x1 + mg) & (P['y'] >= y0 - mg) & (P['y'] < y1 + mg)
    return {kk: v[s] for kk, v in P.items()}

def paint(B, x0, y0, K, rv):
    """B — подложка куска (h×w×3, 0..1) в масштабе K, левый верхний угол = (x0, y0) в 1×; rv — реки куска."""
    h, w = B.shape[:2]
    tr = lambda x, y: ((x - x0) * K, (y - y0) * K)
    gr = (0.86 + 0.28 * noise(1.4 * K, 2, (h, w), np.random.default_rng(int(x0 * 7 + y0)))).astype(np.float32)
    # реки — разбавленная синька с тёмной кромкой
    rvb = rv[..., None]
    B = B * (1 - 0.8 * rvb) + RIVER * 0.8 * rvb
    # леса: тени крон, кроны (светлая/тёмная сторона), чернильная дуга снизу
    P = sub(TP, x0, y0, x0 + w / K, y0 + h / K, 6)
    S = 3
    def canv(): return Image.new('L', (w * S, h * S), 0)
    Lt, Dk, Ed, Sh = canv(), canv(), canv(), canv()
    dl, dd, de, ds = (ImageDraw.Draw(c) for c in (Lt, Dk, Ed, Sh))
    for i in np.argsort(P['y'], kind='stable'):
        X, Y = tr(P['x'][i], P['y'][i]); X *= S; Y *= S; r = P['r'][i] * K * S
        if P['con'][i]:
            pts = [(X, Y - r * 2.2), (X - r * 0.9, Y + r * 0.4), (X + r * 0.9, Y + r * 0.4)]
            ds.ellipse([X - r * 0.2, Y, X + r * 1.6, Y + r * 0.8], fill=255)
            dd.polygon(pts, fill=255); dl.polygon([pts[0], pts[1], (X, Y + r * 0.4)], fill=255)
            de.line([pts[1], pts[0], pts[2]], fill=255, width=max(1, int(K * S * 0.45)))
        else:
            ds.ellipse([X - r * 0.4, Y - r * 0.2, X + r * 1.8, Y + r * 1.1], fill=255)
            dd.ellipse([X - r, Y - r, X + r, Y + r], fill=255)
            dl.ellipse([X - r * 0.95, Y - r * 1.0, X + r * 0.45, Y + r * 0.35], fill=255)
            de.arc([X - r, Y - r, X + r, Y + r], 10, 170, fill=255, width=max(1, int(K * S * 0.45)))
    def g(c, s): return nd.gaussian_filter(np.asarray(c.resize((w, h), Image.BOX), np.float32) / 255, s)
    L_, D_, E_, Sh_ = g(Lt, 0.35 * K), g(Dk, 0.35 * K), g(Ed, 0.3 * K), g(Sh, 1.0 * K)
    green_d = np.array([62, 92, 52], np.float32) / 255; green_l = np.array([128, 156, 92], np.float32) / 255
    B = B * (1 - 0.25 * Sh_[..., None])
    B = B * (1 - 0.85 * D_[..., None]) + (green_d * gr[..., None] * 0.6 + B * 0.4) * 0.85 * D_[..., None]
    B = B * (1 - 0.75 * L_[..., None]) + (green_l * 0.75 + PAPER * 0.25) * 0.75 * L_[..., None]
    B = B * (1 - 0.5 * E_[..., None]) + INK * 0.5 * E_[..., None]
    # горы-мазки (порт paint_mountains): силуэт, светлая грань, тень, контур; цвет — из подложки
    P = sub(MP, x0, y0, x0 + w / K, y0 + h / K, 40)
    face = Image.new('L', (w, h), 0); df = ImageDraw.Draw(face)
    snow = Image.new('L', (w, h), 0); dsn = ImageDraw.Draw(snow)
    lw = max(1, int(round(K * 0.9)))
    ts = np.linspace(-1, 1, 25)
    for i in np.argsort(P['y'], kind='stable'):
        X, Y = tr(P['x'][i], P['y'][i]); s_ = P['s'][i] * K; wd = s_ * P['wk'][i]; pk = P['pk'][i]
        dd_ = np.where(ts < pk, (pk - ts) / (1 + pk), (ts - pk) / (1 - pk))
        prof = 1 - np.abs(dd_) ** 0.8
        bm = P['bumps'][i]; prof = np.clip(prof * (1 + 0.22 * bm / (np.abs(bm).max() + 1e-9)), 0, None)
        sil = [(X + t * wd / 2, Y - s_ * v) for t, v in zip(ts, prof)]
        ip = int(np.argmax(prof)); vx = sil[ip][0] + P['vx'][i] * wd
        vmid = ((sil[ip][0] + vx) / 2 + P['vm'][i] * wd, Y - s_ * P['vy'][i])
        df.polygon(sil, fill=2); df.polygon(sil[:ip + 1] + [vmid, (vx, Y)], fill=1); df.line(sil[1:-1], fill=3, width=lw)
        if P['h'][i] > 0.8:   # снег на высоких вершинах
            cap = [p for p in sil if p[1] < Y - s_ * 0.72]
            if len(cap) >= 2: dsn.polygon([cap[0]] + cap + [cap[-1]], fill=255)
    f = np.asarray(face)
    L = nd.gaussian_filter((f == 1).astype(np.float32), 0.7 * K); D = nd.gaussian_filter((f == 2).astype(np.float32), 0.7 * K)
    E = nd.gaussian_filter((f == 3).astype(np.float32), 0.4 * K); M = nd.gaussian_filter((f > 0).astype(np.float32), 3 * K)
    SN = nd.gaussian_filter(np.asarray(snow, np.float32) / 255, 0.6 * K)
    B = B * (1 - 0.12 * M[..., None])
    light = np.clip(B * 0.55 + PAPER * 0.45 + 0.03, 0, 1); dark = B * 0.66 * np.array([0.92, 0.86, 0.82], np.float32)
    B = B * (1 - 0.9 * L[..., None]) + light * 0.9 * L[..., None]
    B = B * (1 - 0.9 * D[..., None]) + dark * gr[..., None] * 0.9 * D[..., None]
    B = B * (1 - 0.85 * SN[..., None]) + np.array([0.95, 0.94, 0.92], np.float32) * 0.85 * SN[..., None]
    B = B * (1 - 0.55 * E[..., None]) + INK * 0.55 * E[..., None]
    # штрихи волн
    P = sub(WV, x0, y0, x0 + w / K, y0 + h / K, 10)
    wv = Image.new('L', (w * 2, h * 2), 0); dw = ImageDraw.Draw(wv)
    for i in range(len(P['x'])):
        X, Y = tr(P['x'][i], P['y'][i]); X *= 2; Y *= 2; l = P['l'][i] * K * 2
        for o in (0, l * 0.28):
            dw.arc([X - l / 2 + o, Y - l * 0.18 + o * 0.6, X + o, Y + l * 0.18 + o * 0.6], 200, 340, fill=255, width=max(1, int(K)))
            dw.arc([X + o, Y - l * 0.18 + o * 0.6, X + l / 2 + o, Y + l * 0.18 + o * 0.6], 200, 340, fill=255, width=max(1, int(K)))
    WVm = np.asarray(wv.resize((w, h), Image.BOX), np.float32)[..., None] / 255 * 0.28
    B = B * (1 - WVm) + INK * WVm
    return np.clip(B, 0, 1)

if os.environ.get('ONLY1'): out = paint(B0.copy(), 0, 0, 1, RV); Image.fromarray((out * 255).astype(np.uint8)).save(OUTD + '/map_wc.jpg', quality=90); sys.exit(0)
out = paint(B0.copy(), 0, 0, 1, RV)
Image.fromarray((out * 255).astype(np.uint8)).save(OUTD + '/map_wc.jpg', quality=90, optimize=True, progressive=True)
print('map_wc.jpg готово')
# ---------- плитки 2× ----------
T, MG = 512, 12
hid = OUTD + '/hi_wc'; os.makedirs(hid, exist_ok=True)
_, (iy, ix) = nd.distance_transform_edt(WL, return_indices=True); landfill = B0[iy, ix]
_, (iy, ix) = nd.distance_transform_edt(~WP, return_indices=True); waterfill = B0[iy, ix]
del iy, ix
def up(a, mode=Image.BICUBIC):
    if a.ndim == 3: return np.stack([up(a[..., c], mode) for c in range(3)], -1)
    im = Image.fromarray(a.astype(np.float32), 'F'); return np.asarray(im.resize((a.shape[1] * 2, a.shape[0] * 2), mode))
tiles = []
for ty_ in range(0, H, T):
    for tx_ in range(0, W, T):
        if not land[ty_:ty_ + T, tx_:tx_ + T].any(): continue
        x0, y0, x1, y1 = max(0, tx_ - MG), max(0, ty_ - MG), min(W, tx_ + T + MG), min(H, ty_ + T + MG)
        bl, bw = up(landfill[y0:y1, x0:x1]), up(waterfill[y0:y1, x0:x1])
        wm = nd.gaussian_filter(up(WL[y0:y1, x0:x1].astype(np.float32), Image.BILINEAR), 1.5)
        a_ = np.clip((wm - 0.5) * 4 + 0.5, 0, 1)[..., None]
        b = bl * (1 - a_) + bw * a_
        edg = np.clip(1 - np.abs(wm - 0.5) * 4, 0, 1)[..., None] * 0.55
        b = b * (1 - edg) + INK * edg
        rr = np.random.default_rng(tx_ * 131 + ty_)
        g2 = nd.gaussian_filter(rr.standard_normal(b.shape[:2]).astype(np.float32), 0.7)
        b *= (1 + 0.035 * g2 / (np.abs(g2).max() + 1e-9) * 2)[..., None]       # зерно бумаги вблизи
        rv = np.clip((up(RV[y0:y1, x0:x1], Image.BILINEAR) - 0.3) * 1.8, 0, 1)
        o = paint(np.clip(b, 0, 1), x0, y0, 2, rv)
        ox, oy = (tx_ - x0) * 2, (ty_ - y0) * 2
        o = o[oy:oy + 2 * min(T, H - ty_), ox:ox + 2 * min(T, W - tx_)]
        Image.fromarray((o * 255).astype(np.uint8)).save(f'{hid}/{tx_ // T}_{ty_ // T}.jpg', quality=84, optimize=True, progressive=True)
        tiles.append([tx_ // T, ty_ // T])
json.dump({'T': T, 'tiles': tiles}, open(hid + '/index.json', 'w'))
print('плиток 2×:', len(tiles))
