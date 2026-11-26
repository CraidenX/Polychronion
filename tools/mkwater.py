# Акварельная подложка (стиль по скрипту автора watercolor_map.py, «в духе Knights of Honor»), вся карта:
#   map_wc.jpg (1×) и плитки hi_wc/ (2×) для приближения.
# Отличия от первого опыта (6 правок): цвет местности из эталона, разбавленный бумагой (зелень/степь/пустыня);
# акварельные леса; горы крупнее, с контуром и снегом на высоких; спокойное море со штрихами волн;
# цвета держав не смешиваются с подложкой (их кладёт игра отдельным слоем); плитки 2× с перерисовкой значков.
# Входы: tools/terrain/*, umap/masks.npz (mkmap3.py), umap/rivers.npy. Запуск: python3 mkwater.py ..
import os, sys, json, math
import numpy as np
from PIL import Image, ImageDraw
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import trees as TS
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
base = pig * 0.66 + PAPER * 0.34
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
# вариант значков: '' — крупные и реже (map_wc), '2' — мельче и гуще (map_wc2); запуск: VAR=2 python3 mkwater.py ..
VAR = os.environ.get('VAR', '')
SPG, SIZEK, TH = (11.0, 0.9, 0.42) if VAR != '2' else (7.5, 0.72, 0.38)
gm = (hsm >= TH) & land & (nd.distance_transform_edt(land) >= 4) & bigland2   # не на крошечных островах и не на самом берегу
mx, my = pick(gm, int(SPG * 0.75), np.clip((hsm - TH) / (1 - TH) * 1.15, 0, 1), r2)
mh = hsm[np.clip(my.astype(int), 0, H - 1), np.clip(mx.astype(int), 0, W - 1)]
n = len(mx); ms = SPG * SIZEK * (0.65 + 0.8 * mh) * r2.uniform(0.8, 1.25, n); mwk = r2.uniform(1.9, 2.6, n)
# весь силуэт — на суше: подножие дальше от воды, чем полширины горы, и над вершиной тоже суша
dland = nd.distance_transform_edt(land)
xi, yi = np.clip(mx.astype(int), 0, W - 1), np.clip(my.astype(int), 0, H - 1)
ok = (dland[yi, xi] >= ms * mwk * 0.42) & land[np.clip((my - ms * 0.75).astype(int), 0, H - 1), xi]
# прореживание: гора не ставится, если рядом (эллипс вдоль хребта) уже стоит другая — меньше наслоения
order = np.argsort(-mh); keep = np.zeros(n, bool); taken = {}
for i in order:
    if not ok[i]: continue
    gx, gy = int(mx[i] // SPG), int(my[i] // SPG); near = False
    for ax in (gx - 2, gx - 1, gx, gx + 1, gx + 2):
        for ay in (gy - 1, gy, gy + 1):
            for j in taken.get((ax, ay), ()):
                if ((mx[i] - mx[j]) / (ms[i] * mwk[i] * 0.55)) ** 2 + ((my[i] - my[j]) / (ms[i] * 0.55)) ** 2 < 1: near = True; break
            if near: break
        if near: break
    if not near: keep[i] = True; taken.setdefault((gx, gy), []).append(i)
mx, my, mh, ms, mwk = mx[keep], my[keep], mh[keep], ms[keep], mwk[keep]
n = len(mx)
MP = dict(x=mx, y=my, h=mh, s=ms, wk=mwk,
          pk=r2.uniform(-0.3, 0.2, n), bumps=nd.gaussian_filter1d(r2.normal(0, 1, (n, 25)), 1.5, axis=1),
          vx=r2.uniform(0.08, 0.25, n), vm=r2.uniform(-0.04, 0.04, n), vy=r2.uniform(0.35, 0.55, n))
# деревья: лиственные — кроны-кружки, хвойные — ёлки
tx, ty = pick(forest & land & (dland >= 3.5), 5 if VAR != '2' else 4, 0.85 if VAR != '2' else 0.9, r2)   # реже и не на самом берегу
TP = dict(x=tx, y=ty, con=conifer[np.clip(ty.astype(int), 0, H - 1), np.clip(tx.astype(int), 0, W - 1)], r=r2.uniform(1.7, 2.5, len(tx)) * (1 if VAR != '2' else 0.72), j=r2.uniform(-0.06, 0.06, len(tx)))
# штрихи волн в открытом море
wx, wy = pick(WL & (dist > 26), 46, 0.55, r2)
WV = dict(x=wx, y=wy, l=r2.uniform(5, 8, len(wx)))
# ---------- значки для игры: игра вблизи рисует горы и деревья сама (резко на любом масштабе) ----------
# icons{VAR}.bin: заголовок (n гор, n деревьев), горы по 48 байт, деревья по 6 байт; trees.png — атлас крон (как в подложке).
def look(c):   # то же «освещение», что в конце paint(): насыщенность и контраст
    c = np.asarray(c, np.float32); l = c.mean(-1, keepdims=True); c = l + (c - l) * 1.18; c = (c - 0.52) * 1.2 + 0.5
    return np.clip(np.clip(c, 0, 1) ** 1.06, 0, 1)
def export_icons():
    import struct
    n = len(MP['x']); ts = np.linspace(-1, 1, 25); buf = bytearray(struct.pack('<II', n, len(TP['x'])))
    for i in range(n):
        X, Y, s_ = MP['x'][i], MP['y'][i], MP['s'][i]; pk = MP['pk'][i]
        dd_ = np.where(ts < pk, (pk - ts) / (1 + pk), (ts - pk) / (1 - pk)); prof = 1 - np.abs(dd_) ** 0.8
        bm = MP['bumps'][i]; prof = np.clip(prof * (1 + 0.22 * bm / (np.abs(bm).max() + 1e-9)), 0, None)
        b = B0[int(np.clip(Y - s_ * 0.35, 0, H - 1)), int(np.clip(X, 0, W - 1))]
        lt = look(b * 0.1 + np.clip(b * 0.55 + PAPER * 0.45 + 0.03, 0, 1) * 0.9); dk = look(b * 0.1 + b * 0.66 * np.array([0.92, 0.86, 0.82]) * 0.9)
        buf += struct.pack('<HHhhhhhhB', max(0, int(X * 8)), max(0, int(Y * 8)), int(s_ * 100), int(MP['wk'][i] * 1000), int(pk * 1000), int(MP['vx'][i] * 1000), int(MP['vm'][i] * 1000), int(MP['vy'][i] * 1000), 1 if MP['h'][i] > 0.8 else 0)
        buf += bytes((lt * 255).astype(np.uint8)) + bytes((dk * 255).astype(np.uint8)) + bytes(np.clip(prof * 200, 0, 255).astype(np.uint8))
    for i in range(len(TP['x'])):
        X, Y = TP['x'][i], TP['y'][i]
        buf += struct.pack('<HHBB', max(0, int(X * 8)), max(0, int(Y * 8)), int(TP['r'][i] * 100), (1 if TP['con'][i] else 0) | ((int(X * 7 + Y * 13) % len(TS.SPR['c' if TP['con'][i] else 'd'])) << 1))   # номер рисунка — как в подложке
    open(OUTD + f'/icons{VAR}.bin', 'wb').write(buf)
    # атлас для игры — в 2 раза подробнее (192 px): те же кроны (те же зёрна), но мельче фактура листьев
    N0 = TS.N; TS.N = N = 192
    spr = {'d': [Image.fromarray(TS.deciduous(100 + i), 'RGBA') for i in range(len(TS.SPR['d']))], 'c': [Image.fromarray(TS.conifer(200 + i), 'RGBA') for i in range(len(TS.SPR['c']))]}
    TS.N = N0
    at = Image.new('RGBA', (N * 10, N * 2), (0, 0, 0, 0))
    for r_, kind in enumerate(('d', 'c')):
        for j, sp in enumerate(spr[kind]): at.alpha_composite(sp, (j * N, r_ * N))
    a = np.asarray(at).astype(np.float32) / 255; a[..., :3] = look(a[..., :3])
    Image.fromarray((a * 255).astype(np.uint8), 'RGBA').save(OUTD + '/trees.png', optimize=True)   # одинаков для обоих вариантов
    print('значки для игры: гор', n, 'деревьев', len(TP['x']), len(buf) // 1024, 'КБ')
export_icons()
if os.environ.get('ICONS_ONLY'): sys.exit(0)
# NOICONS=1 — плитки 2× без гор и деревьев (hi_wc{VAR}c/): вблизи их рисует ближний уровень рельефа, старые значки не должны просвечивать
NOI = bool(os.environ.get('NOICONS'))
if NOI: TP = {kk: v[:0] for kk, v in TP.items()}; MP = {kk: v[:0] for kk, v in MP.items()}
def sub(P, x0, y0, x1, y1, mg):
    s = (P['x'] >= x0 - mg) & (P['x'] < x1 + mg) & (P['y'] >= y0 - mg) & (P['y'] < y1 + mg)
    return {kk: v[s] for kk, v in P.items()}

OBJ = {}
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
    # деревья — готовые рисунки (trees.py) в духе Knights of Honor; на земле — мягкая тень вправо-вниз
    S = 3
    Sh = Image.new('L', (w * S, h * S), 0); ds = ImageDraw.Draw(Sh)
    lay = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    for i in np.argsort(P['y'], kind='stable'):
        X, Y = tr(P['x'][i], P['y'][i]); r = P['r'][i] * K
        px = max(3, int(round(r * 4.2)))
        ds.ellipse([(X - r * 0.3) * S, (Y - r * 0.1) * S, (X + r * 1.9) * S, (Y + r * 0.9) * S], fill=255)
        spr = TS.sprite('c' if P['con'][i] else 'd', int(P['x'][i] * 7 + P['y'][i] * 13), px)
        lay.alpha_composite(spr, (int(round(X - px / 2)), int(round(Y - px * 0.72))))   # низ кроны — у точки дерева
    Sh_ = nd.gaussian_filter(np.asarray(Sh.resize((w, h), Image.BOX), np.float32) / 255, 1.0 * K)
    TL = np.asarray(lay, np.float32) / 255; D_ = TL[..., 3]
    B = B * (1 - 0.28 * Sh_[..., None])
    B = B * (1 - D_[..., None]) + TL[..., :3] * D_[..., None]
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
    # освещение: контраст и насыщенность (карта была «ярко-блеклой»)
    lum = B.mean(2, keepdims=True)
    B = lum + (B - lum) * 1.18
    B = (B - 0.52) * 1.2 + 0.5
    B = np.clip(B, 0, 1) ** 1.06
    OBJ['m'] = (f > 0); OBJ['t'] = D_ > 0.4
    return np.clip(B, 0, 1)

out = paint(B0.copy(), 0, 0, 1, RV)
# маска нарисованных значков для игры: на политической карте цвет державы над ними прозрачнее (горы 255, леса 165, реки 180)
rel = np.zeros((H, W), np.uint8)
rel[OBJ['t']] = 165; rel[RV > 0.18] = 180; rel[OBJ['m']] = 255
if not NOI:
    Image.fromarray(rel).save(OUTD + f'/relief_wc{VAR}.png', optimize=True)
    Image.fromarray((out * 255).astype(np.uint8)).save(OUTD + f'/map_wc{VAR}.jpg', quality=90, optimize=True, progressive=True)
print('map_wc.jpg готово, гор', len(MP['x']), 'деревьев', len(TP['x']))
if os.environ.get('ONLY1'): sys.exit(0)
# ---------- плитки 2× ----------
T, MG = 512, 12
hid = OUTD + f'/hi_wc{VAR}' + ('c' if NOI else ''); os.makedirs(hid, exist_ok=True)
_, (iy, ix) = nd.distance_transform_edt(WL, return_indices=True); landfill = B0[iy, ix]
_, (iy, ix) = nd.distance_transform_edt(~WP, return_indices=True); waterfill = B0[iy, ix]
del iy, ix
def up(a, mode=Image.BICUBIC):
    if a.ndim == 3: return np.stack([up(a[..., c], mode) for c in range(3)], -1)
    im = Image.fromarray(a.astype(np.float32), 'F'); return np.asarray(im.resize((a.shape[1] * 2, a.shape[0] * 2), mode))
# ---------- ближний уровень (NOICONS): фактура земли по классам местности, светотень по рельефу, «подошвы» под спрайтами ----------
if NOI:
    TC = np.load(SP + 'umap/tclass.npy')
    DSEA = nd.distance_transform_edt(~(WP & ~land)).astype(np.float32)
    HSM = nd.gaussian_filter(hgt, 2.0)
    MTB = nd.gaussian_filter(((TC != 255) & ((TC & (1 | 4 | 8)) > 0)).astype(np.float32), 6)   # холмы и горы — светотень сильнее
    # текстуры со своим цветом (насыщенность ≈ 0,88; трава приглушена на 15 %) в двух масштабах: повтор ≈ 140 и 226 px плитки
    # (≈ 280 и 450 px экрана при 4×) — смесь масштабов прячет повторы
    def _tex(name, sat, val):
        t = Image.open(SP + f'textures/{name}.webp').convert('RGB'); out = []
        for n in (140, 226):
            a = np.asarray(t.resize((n, n), Image.LANCZOS)).astype(np.float32) / 255
            lum = (a @ np.array([0.3, 0.59, 0.11], np.float32))[..., None]; out.append(np.clip((lum + (a - lum) * sat) * val, 0, 1))
        return out
    SC = 0.88 / 1.18 / 1.1   # итоговая насыщенность ≈ 0,88: paint() в конце ещё раз поднимает насыщенность (×1,18) и контраст (×1,2)
    TEX = {'grass': _tex('grass', SC * 0.85, 0.92), 'steppe': _tex('steppe', SC, 1.0), 'maquis': _tex('maquis', SC, 1.0),
           'sand': _tex('sand', SC, 1.0), 'marsh': _tex('marsh', SC, 1.0)}
    # промежуточные оттенки между травой и степью: выгоревшая трава (50/50 с тёплым оттенком) и оливковая степь
    TEX['burnt'] = [np.clip((g + st) * 0.5 * np.array([1.05, 1.0, 0.86], np.float32), 0, 1) for g, st in zip(TEX['grass'], TEX['steppe'])]
    TEX['olive'] = [np.clip((st * 0.75 + g * 0.25) * np.array([0.92, 1.0, 0.78], np.float32), 0, 1) for g, st in zip(TEX['grass'], TEX['steppe'])]
    # «зелёность» эталона — по всей карте сразу, размыта на ~15 px: переход трава ↔ степь шириной 30–60 px, без швов между плитками
    GREEN = nd.gaussian_filter(np.clip((ecol[..., 1] - (ecol[..., 0] + ecol[..., 2]) / 2 - 0.005) / 0.05, 0, 1), 15).astype(np.float32)
    # общие для всей карты поля шума (без швов между плитками): сдвиг весов классов и смешение двух масштабов текстуры
    _r = np.random.default_rng(31)
    NZQ = nd.gaussian_filter(_r.standard_normal(((H + 3) // 4, (W + 3) // 4)).astype(np.float32), 1.3); NZQ /= NZQ.std()
    MXQ = nd.gaussian_filter(_r.standard_normal(((H + 3) // 4, (W + 3) // 4)).astype(np.float32), 5); MXQ = np.clip(MXQ / MXQ.std() * 0.35 + 0.5, 0, 1)
    GAIN = float(os.environ.get('GAIN', '1.2'))   # земля светлее прежней на ~30 % (у подножий — не темнее низа спрайтов)
    def _crop4(F, x0, y0, x1, y1, k):   # кусок поля четвертного разрешения в масштабе k (1 — карта, 2 — плитка)
        qy0, qx0 = y0 // 4, x0 // 4; sub = F[qy0:(y1 + 3) // 4 + 1, qx0:(x1 + 3) // 4 + 1]
        z = nd.zoom(sub, 4 * k, order=1); oy, ox = (y0 - qy0 * 4) * k, (x0 - qx0 * 4) * k
        return z[oy:oy + (y1 - y0) * k, ox:ox + (x1 - x0) * k]
    SOUTH = 866   # ≈ 42° с. ш.: южнее — средиземноморские побережья (маквис)
    WARM, COOL = np.array([1.0, 0.945, 0.785], np.float32), np.array([0.24, 0.29, 0.42], np.float32)
    # «подошвы»: цвет подножия каждого набора — средний цвет нижней полосы спрайта (над точкой привязки)
    try:
        TSJ = json.load(open(OUTD + '/terrain_sprites.json')); ATL = np.asarray(Image.open(OUTD + '/terrain_atlas.webp').convert('RGBA')).astype(np.float32) / 255
        FOOT = {}
        for n, st in TSJ['sets'].items():
            FOOT[n] = []
            for r in st['r']:
                h_ = r[3]; ya = int(h_ * st['anchor']); band = ATL[r[1] + max(0, ya - h_ // 6):r[1] + ya, r[0]:r[0] + r[2]]
                m_ = band[..., 3] > 0.8; FOOT[n].append(band[..., :3][m_].mean(0) if m_.any() else np.array([0.5, 0.45, 0.35], np.float32))
        FEET = [(it[2], it[3], it[4], FOOT[it[0]][it[1]]) for it in TSJ['items'] if not it[0].startswith('pass')] + [(l['x'], l['y'], l['w'], FOOT[l['set']][0]) for l in TSJ['landmarks'] if not l.get('model') and l['set'] in FOOT]
        FEET = np.array([(x, y, w, *c) for x, y, w, c in FEET], np.float32)
    except Exception as e:
        print('подошвы: нет данных спрайтов', e); FEET = np.zeros((0, 6), np.float32)
    def close_land(bl, x0, y0, x1, y1):
        h2, w2 = bl.shape[:2]
        tcc = TC[y0:y1, x0:x1]; isl = tcc != 255; ref = ecol[y0:y1, x0:x1]
        green = GREEN[y0:y1, x0:x1]
        ys = np.arange(y0, y1)[:, None] * np.ones((1, x1 - x0))
        q = lambda F: _crop4(F, x0, y0, x1, y1, 1)
        nz = q(NZQ)
        bit = lambda b: ((tcc & b) > 0) & isl
        hill = bit(1) | bit(4) | bit(8)
        # трава ↔ степь по «зелёности» g: степь (g≈0) → оливковая степь (0,25) → выгоревшая трава (0,5) → трава (≥0,75); класс «степь» — всегда степь
        g = np.where(bit(64), 0.0, green)
        plain = ~hill & ~bit(32) & ~bit(16)
        w = {'sand': bit(32) * 1.0, 'marsh': bit(16) * 1.0,
             'maquis': (hill | ((DSEA[y0:y1, x0:x1] < 45) & (ys > SOUTH))) * 1.0,
             'steppe': plain * np.clip((0.25 - g) / 0.25, 0, 1), 'olive': plain * np.clip(1 - np.abs(g - 0.25) / 0.25, 0, 1),
             'burnt': plain * np.clip(1 - np.abs(g - 0.5) / 0.25, 0, 1), 'grass': plain * np.clip((g - 0.5) / 0.25, 0, 1)}
        w['maquis'] *= (1 - w['sand']) * (1 - w['marsh'])
        for k in ('steppe', 'olive', 'burnt', 'grass'): w[k] = w[k] * (1 - w['maquis'])
        for k in w: w[k] = np.clip(nd.gaussian_filter(w[k], 3.0) + 0.04 * nz * (w[k] > 0.05), 0, None)   # без «камуфляжа»: шум слабый
        tot = sum(w.values()) + 1e-6
        gy = (y0 * 2 + np.arange(h2))[:, None]; gx = (x0 * 2 + np.arange(w2))[None, :]
        mx = _crop4(MXQ, x0, y0, x1, y1, 2)[:h2, :w2][..., None]
        tex = np.zeros_like(bl)
        for k, (tA, tB) in TEX.items():
            wk = nd.zoom(w[k] / tot, 2, order=1)[:h2, :w2][..., None]
            if wk.max() < 0.01: continue
            tex += wk * (tA[gy % 140, gx % 140] * (1 - mx) + tB[(gy + 77) % 226, (gx + 131) % 226] * mx)
        lw = nd.zoom(isl.astype(np.float32), 2, order=1)[:h2, :w2][..., None]
        out = (tex * 0.75 + bl * 0.25) * GAIN                                       # цвет текстур; прежняя подложка — лёгкий оттенок для плавных переходов
        out = bl * (1 - lw) + out * lw
        # светотень мягче: на равнине почти нет, в холмах и горах — умеренная, без тёмных разводов
        hz = nd.zoom(nd.gaussian_filter(HSM[y0:y1, x0:x1], 2.5), 2, order=1)[:h2, :w2]; dy, dx = np.gradient(hz * 0.5)
        lx, ly, lz = -0.62, -0.62, 0.48; sh = (-dx * lx - dy * ly + lz) / np.sqrt(dx * dx + dy * dy + 1)
        sh = np.clip((sh - lz) * 1.4, -1, 1) * (0.05 + 0.6 * nd.zoom(MTB[y0:y1, x0:x1], 2, order=1)[:h2, :w2])
        sp_ = np.clip(sh, 0, 1)[..., None] * 0.22; sn = np.clip(-sh, 0, 1)[..., None] * 0.16
        out = out * (1 - sp_) + WARM * sp_; out = out * (1 - sn) + out * COOL * 1.9 * sn
        # подошвы: мягкая контактная тень на юго-восток и пятно цвета подножия с размытым краем
        sel = FEET[(FEET[:, 0] + FEET[:, 2] > x0) & (FEET[:, 0] - FEET[:, 2] < x1) & (FEET[:, 1] + FEET[:, 2] > y0) & (FEET[:, 1] - FEET[:, 2] < y1)]
        if len(sel):
            shm = Image.new('L', (w2, h2), 0); ftm = Image.new('L', (w2, h2), 0); fcol = np.zeros((h2, w2, 3), np.float32)
            dsh = ImageDraw.Draw(shm); dft = ImageDraw.Draw(ftm)
            for x, y, wd, r_, g_, b_ in sel:
                X, Y, Wd = (x - x0) * 2, (y - y0) * 2, wd * 2
                dsh.ellipse([X - Wd * 0.38 + Wd * 0.14, Y - Wd * 0.07 + Wd * 0.05, X + Wd * 0.48 + Wd * 0.14, Y + Wd * 0.11 + Wd * 0.05], fill=255)
                e = [X - Wd * 0.42, Y - Wd * 0.1, X + Wd * 0.42, Y + Wd * 0.07]; dft.ellipse(e, fill=255)
                a0, a1 = max(0, int(e[1])), min(h2, int(e[3]) + 1); b0, b1 = max(0, int(e[0])), min(w2, int(e[2]) + 1)
                if a1 > a0 and b1 > b0: fcol[a0:a1, b0:b1] = (r_, g_, b_)
            S_ = nd.gaussian_filter(np.asarray(shm, np.float32) / 255, 4)[..., None] * 0.3
            Fm = nd.gaussian_filter(np.asarray(ftm, np.float32) / 255, 3)[..., None] * 0.55
            fcol = nd.gaussian_filter(fcol, (3, 3, 0)); fn = nd.gaussian_filter((fcol.sum(2) > 0).astype(np.float32), 3)[..., None]
            fcol = fcol / np.maximum(fn, 1e-3)
            out = out * (1 - S_) + out * COOL * 1.2 * S_
            out = out * (1 - Fm * (fn > 0.05)) + fcol * Fm * (fn > 0.05)
        return np.clip(out, 0, 1).astype(np.float32)
tiles = []
for ty_ in range(0, H, T):
    for tx_ in range(0, W, T):
        if not land[ty_:ty_ + T, tx_:tx_ + T].any(): continue
        if os.environ.get('TILES') and f'{tx_ // T}_{ty_ // T}' not in os.environ['TILES'].split(','): tiles.append([tx_ // T, ty_ // T]); continue   # TILES=3_1,3_2 — только эти плитки (для проверки)
        x0, y0, x1, y1 = max(0, tx_ - MG), max(0, ty_ - MG), min(W, tx_ + T + MG), min(H, ty_ + T + MG)
        bl, bw = up(landfill[y0:y1, x0:x1]), up(waterfill[y0:y1, x0:x1])
        if NOI: bl = close_land(bl, x0, y0, x1, y1)
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
