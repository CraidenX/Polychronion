# Сетка перемещений: клетка 6 px карты (≈ 4–5 км), 883 × 484 клетки. Единый источник — umap/tclass.npy (те же классы, что у картинки).
# Запуск после mkterrain_sprites.py, mkprov.py, mkroads.py: python3 -I mkgrid.py ..   →   ../grid.bin + ../grid.json (описание формата)
import os, sys, json, re
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
C = 6
m = np.load(SP + 'umap/masks.npz'); land = m['land']; H, W = land.shape
GW, GH = (W + C - 1) // C, (H + C - 1) // C
def blocks(a, fill=0):   # (H, W) → (GH, GW, 36)
    p = np.full((GH * C, GW * C) + a.shape[2:], fill, a.dtype); p[:H, :W] = a
    return p.reshape(GH, C, GW, C).transpose(0, 2, 1, 3).reshape(GH, GW, C * C)
tc = np.load(SP + 'umap/tclass.npy')
sea_px = m['cleanwater'] & ~land
L = blocks(land).mean(2); S = blocks(sea_px).mean(2)
# класс местности: бит ставится, если им занято ≥ половины суши клетки (непроходимые — ≥ 40 %)
Tb = blocks(tc, 255); landb = Tb != 255; nl = np.maximum(landb.sum(2), 1)
cls = np.zeros((GH, GW), np.uint8)
for bit in (1, 2, 4, 8, 16, 32, 64):
    f = (((Tb & bit) > 0) & landb).sum(2) / nl   # только по суше классов (255 — вода: все биты подняты)
    cls[f >= (0.4 if bit == 8 else 0.5)] |= bit
cls[L < 0.5] = 255
# провинция — по большинству пикселей ids.png (номер + 1; 0 — нет)
I = np.asarray(Image.open(OUT + '/ids.png').convert('RGB')).astype(np.int32)
pid = (I[..., 0] << 8) | I[..., 1]
Pb = np.sort(blocks(pid), axis=2)
# мода по отсортированному ряду: самая длинная серия ненулевых значений
prov = np.zeros((GH, GW), np.int32); best = np.zeros((GH, GW), np.int32)
run = np.ones((GH, GW), np.int32)
for k in range(1, C * C + 1):
    same = (Pb[..., k] == Pb[..., k - 1]) if k < C * C else np.zeros((GH, GW), bool)
    end = ~same
    v = Pb[..., k - 1]; upd = end & (v > 0) & (run > best)
    prov[upd] = v[upd]; best[upd] = run[upd]
    run = np.where(same, run + 1, 1)
prov[L < 0.5] = 0
# флаги
zone = blocks(nd.binary_dilation(m['zone'], iterations=4) & land).sum(2) >= np.maximum(blocks(land).sum(2), 1) * 0.5   # доля зоны среди суши клетки (береговая линия — тоже зона)
zone_sea = nd.binary_dilation(zone, iterations=14)        # море у игровой зоны (≈ 85 px) — для флота
FLAGS = {'land': 1, 'zone': 2, 'road': 4, 'pass': 8, 'impass': 16, 'sea': 32}
flags = np.zeros((GH, GW), np.uint8)
flags[L >= 0.5] |= 1
flags[(L >= 0.5) & zone] |= 2
flags[(L < 0.5) & (S >= 0.5) & zone_sea] |= 32
# дороги — по roads.js (те же ломаные, по которым ходили войска)
roads = json.loads(re.search(r'=\s*(\[.*\])\s*;', open(OUT + '/roads.js').read(), re.S).group(1))
rim = Image.new('L', (GW, GH), 0); dr = ImageDraw.Draw(rim)
for r in roads:
    if not r: continue
    pts = []; x = y = 0
    for i in range(0, len(r), 2): x += r[i]; y += r[i + 1]; pts.append((x / C, y / C))
    if len(pts) > 1: dr.line(pts, fill=255, width=1)
flags[(np.asarray(rim) > 0) & (L >= 0.5)] |= 4
# перевалы: радиус 15 px
gy, gx = np.mgrid[0:GH, 0:GW]
for p in json.load(open(SP + 'umap/passes.json')):
    flags[((gx * C + 3 - p[2]) ** 2 + (gy * C + 3 - p[3]) ** 2 <= 15 ** 2) & (L >= 0.5)] |= 8
flags[((cls & 8) > 0) & ((flags & 8) == 0) & (L >= 0.5)] |= 16
# проливы: морская клетка, у которой суша в пределах 2 клеток с двух противоположных сторон — войско без флота переходит её вброд/на лодках
FLAGS['strait'] = 64
lc = L >= 0.5
def near(dy, dx):
    r = np.zeros_like(lc)
    for k in (1, 2):
        sh = np.zeros_like(lc); ys_, xs_ = slice(max(0, dy * k), GH + min(0, dy * k)), slice(max(0, dx * k), GW + min(0, dx * k))
        yd, xd = slice(max(0, -dy * k), GH + min(0, -dy * k)), slice(max(0, -dx * k), GW + min(0, -dx * k))
        sh[yd, xd] = lc[ys_, xs_]; r |= sh
    return r
st = np.zeros_like(lc)
for dy, dx in ((1, 0), (0, 1), (1, 1), (1, -1)): st |= near(dy, dx) & near(-dy, -dx)
flags[st & ((flags & 32) > 0)] |= 64
# опорная точка клетки: ближайший к центру пиксель суши не на реке (для проверки переправ)
rv = np.load(SP + 'umap/rivers.npy') > 46
off = np.array([(i // C, i % C) for i in range(C * C)]); dc = np.hypot(off[:, 0] - 2.5, off[:, 1] - 2.5)
score = dc[None, None, :] + 100 * blocks(rv) + 200 * ~blocks(land)
k = score.argmin(2); ry = gy * C + off[k, 0]; rx = gx * C + off[k, 1]
ry = np.clip(ry, 0, H - 1); rx = np.clip(rx, 0, W - 1)
# большие реки — ручной список big_rivers.json (как в mkroadcost.py)
BR = json.load(open(SP + 'big_rivers.json')); FIT = json.load(open(SP + 'umap/fit.json')); KF = W / FIT.get('W', 2000)
L0, SXF, P0, SYF = FIT['p'][0], FIT['p'][1] * KF, FIT['p'][2], FIT['p'][3] * KF
lines = Image.new('L', (W, H), 0); dl = ImageDraw.Draw(lines)
for pts in BR['rivers'].values(): dl.line([((lo - L0) * SXF, (P0 - la) * SYF) for lo, la in pts], fill=255, width=2)
bigzone = nd.binary_dilation(np.load(SP + 'umap/rivers_big.npy'), iterations=1)   # J5: основное русло больших рек (mkrivvec.py), без притоков в коридоре
# J5: водные участки больших рек (нижний Дунай, Евфрат…): в маске суши это вода, а не линия растра рек. Узкая вода (≤ 5 px от берега)
# в коридоре ручной линии реки — река: клетки перестают быть «проливом» (вброд на лодках нельзя), судоходны (флаг 128), переход — только по мостам
corr_ = nd.distance_transform_edt(np.asarray(lines) == 0) <= BR['corridor'] + 4
rwat = ~land & corr_ & (nd.distance_transform_edt(~land) <= 5)
rcell = (L < 0.5) & (blocks(rwat).mean(2) >= 0.25)
flags[rcell] = flags[rcell] & (255 ^ (64 | 32)); flags[rcell] |= 128
# рёбра через водные участки не размечаем: войско разделяют сами водные клетки (иначе рёбра вдоль берега, задевающие кромку воды, стали бы «переправами»)
# J5: судоходные клетки — большая река занимает ≥ 12 % клетки (флот и речные суда идут вдоль неё)
FLAGS['river'] = 128
flags[(blocks(rv & bigzone).mean(2) >= 0.12)] |= 128
# города — центры провинций (MAPINFO.provs: [регион, x, y, …]) и клетки в пределах 2 от них
MI_ = json.load(open(SP + 'mapinfo3.json')); city = np.zeros((GH, GW), bool)
for pv in MI_['provs']: city[min(GH - 1, int(pv[2]) // C), min(GW - 1, int(pv[1]) // C)] = True
cityN = nd.binary_dilation(city, iterations=3); BRIDGES = []; BIGX = []
cityD = nd.distance_transform_edt(~city)   # расстояние до ближайшего города, клеток
# переправы на рёбрах: E, S, SE, SW (по 2 бита: 0 нет, 1 брод, 2 большая река, 3 мост)
edge = np.zeros((GH, GW), np.uint8)
for sh, (dy, dx) in enumerate(((0, 1), (1, 0), (1, 1), (1, -1))):
    y2, x2 = np.clip(gy + dy, 0, GH - 1), np.clip(gx + dx, 0, GW - 1)
    ok = (gy + dy < GH) & (gx + dx >= 0) & (gx + dx < GW) & (L >= 0.5) & (L[y2, x2] >= 0.5)
    hit = np.zeros((GH, GW), bool); big = np.zeros((GH, GW), bool)
    for t in np.linspace(0.08, 0.92, 12):
        py = np.round(ry + (ry[y2, x2] - ry) * t).astype(int); px = np.round(rx + (rx[y2, x2] - rx) * t).astype(int)
        hv = rv[py, px]; hit |= hv; big |= hv & bigzone[py, px]
    hit &= ok & ~rv[ry, rx] & ~rv[ry[y2, x2], rx[y2, x2]]
    code = np.where(big & hit, 2, np.where(hit, 1, 0)).astype(np.uint8)
    # J5: мост — где большую реку пересекает дорога (дорога с обеих сторон) или у города (центр провинции в пределах 2 клеток)
    rd = (flags & 4) > 0; bridge = (code == 2) & ((rd & rd[y2, x2]) | cityN | cityN[y2, x2])
    code[bridge] = 3
    for yy_, xx_ in zip(*np.nonzero(bridge)): BRIDGES.append(((gx[yy_, xx_] + (gx[yy_, xx_] + dx)) / 2 * C + C / 2, (gy[yy_, xx_] + gy[yy_, xx_] + dy) / 2 * C + C / 2, np.arctan2(dy, dx)))
    for yy_, xx_ in zip(*np.nonzero((code == 2) & ((flags & 2) > 0))): BIGX.append((float(cityD[yy_, xx_]), sh, yy_, xx_, (gx[yy_, xx_] + (gx[yy_, xx_] + dx)) / 2 * C + C / 2, (gy[yy_, xx_] + gy[yy_, xx_] + dy) / 2 * C + C / 2, np.arctan2(dy, dx)))
    edge |= code << (2 * sh)
# переправа не реже чем раз в ~120 px вдоль каждой большой реки в игровой зоне — у ближайшего к реке города
SPAN = 120
for d_, sh_, yy_, xx_, x, y, an_ in sorted(BIGX):
    if all((x - a) ** 2 + (y - b) ** 2 > SPAN ** 2 for a, b, _ in BRIDGES):
        BRIDGES.append((x, y, an_))
# мосты через водные участки: у городов и дорог, затем не реже чем раз в SPAN px — клетка реки снова переходима (флаг 64 + 128 = мост)
rdN = nd.binary_dilation((flags & 4) > 0, iterations=1)
zoneN = nd.binary_dilation((flags & 2) > 0, iterations=2)
cand = [(float(cityD[y, x]), y, x) for y, x in zip(*np.nonzero(rcell & zoneN))]
for d_, y, x in sorted(cand):
    px_, py_ = x * C + C / 2, y * C + C / 2
    if (cityN[y, x] or rdN[y, x]) or all((px_ - a) ** 2 + (py_ - b) ** 2 > SPAN ** 2 for a, b, _ in BRIDGES):
        if any((px_ - a) ** 2 + (py_ - b) ** 2 <= 30 ** 2 for a, b, _ in BRIDGES): continue   # не гуще одного моста на 30 px
        ys_, xs_ = slice(max(0, y - 1), y + 2), slice(max(0, x - 1), x + 2)
        sub_ = rcell[ys_, xs_]; flags[ys_, xs_][sub_] |= 64
        BRIDGES.append((px_, py_, 0.0))
# мост — на всех рёбрах большой реки в пределах 10 px от точки переправы (река шире клетки — иначе мост ведёт в следующую клетку реки)
for d_, sh_, yy_, xx_, x, y, an_ in BIGX:
    if any((x - a) ** 2 + (y - b) ** 2 <= 10 ** 2 for a, b, _ in BRIDGES): edge[yy_, xx_] = (int(edge[yy_, xx_]) & (255 ^ (3 << (2 * sh_)))) | (3 << (2 * sh_))
RB_ = json.load(open(OUT + '/rivers_big.json'))['rivers']; SEGS = []
for b_ in RB_.values():
    q = b_['pts']
    for i in range(0, len(q) - 2, 2): SEGS.append((q[i], q[i + 1], q[i + 2], q[i + 3]))
for pts in BR['rivers'].values():   # ручные линии — для водных участков, где русла-ломаной нет
    q = [((lo - L0) * SXF, (P0 - la) * SYF) for lo, la in pts]
    for a, b in zip(q[:-1], q[1:]): SEGS.append((a[0], a[1], b[0], b[1]))
SEGS = np.array(SEGS, np.float64)
def snap_br(x, y):   # ближайшая точка русла и угол поперёк реки
    ax, ay, bx, by = SEGS.T; dx_, dy_ = bx - ax, by - ay; L2 = np.maximum(dx_ * dx_ + dy_ * dy_, 1e-9)
    t = np.clip(((x - ax) * dx_ + (y - ay) * dy_) / L2, 0, 1); px, py = ax + t * dx_, ay + t * dy_; i = int(np.argmin((px - x) ** 2 + (py - y) ** 2))
    if (px[i] - x) ** 2 + (py[i] - y) ** 2 > 8 ** 2: return x, y, float(np.arctan2(dy_[i], dx_[i]) + np.pi / 2)   # далеко от линии — место не двигаем, только угол
    return float(px[i]), float(py[i]), float(np.arctan2(dy_[i], dx_[i]) + np.pi / 2)
BRIDGES = [snap_br(x, y) for x, y, _ in BRIDGES]
br_out = []
for x, y, an_ in BRIDGES:
    if all((x - a) ** 2 + (y - b) ** 2 > 10 ** 2 for a, b, _ in br_out): br_out.append((x, y, an_))
json.dump({'_': 'Мосты через большие реки (mkgrid.py): точки в px карты — значки на карте', 'bridges': [[round(x, 1), round(y, 1), round(float(an_), 2)] for x, y, an_ in br_out]}, open(OUT + '/bridges.json', 'w'), separators=(',', ':'))
# запись: заголовок + 5 слоёв, каждый — RLE (значение u16, длина u16), построчно подряд
def rle(a):
    a = a.ravel().astype(np.int64); out = []; i = 0; n = len(a)
    ch = np.flatnonzero(np.diff(a)) + 1; starts = np.concatenate([[0], ch]); ends = np.concatenate([ch, [n]])
    for s, e in zip(starts, ends):
        v = int(a[s]); ln = int(e - s)
        while ln > 0: q = min(ln, 65535); out += [v, q]; ln -= q
    return np.array(out, np.uint16)
layers = [('cls', cls), ('prov', prov), ('flags', flags), ('edge', edge)]
enc = [rle(a) for _, a in layers]
hdr = np.array([0x47524944, GW, GH, C, len(layers)] + [len(e) for e in enc], np.uint32)
with open(OUT + '/grid.bin', 'wb') as f:
    f.write(hdr.tobytes())
    for e in enc: f.write(e.tobytes())
json.dump({'_': 'Сетка перемещений (mkgrid.py). grid.bin: заголовок u32 [магия GRID, GW, GH, C, число слоёв, длины слоёв в u16], затем слои — RLE пар u16 (значение, длина) построчно (индекс клетки = y*GW+x).',
           'GW': GW, 'GH': GH, 'C': C, 'layers': [n for n, _ in layers],
           'cls': 'биты класса местности (как umap/tclass.npy): 1 холмы, 2 лес, 4 проходимые горы, 8 непроходимые, 16 болото, 32 пустыня, 64 степь; 0 равнина; 255 не суша',
           'prov': 'номер провинции + 1 (MAPINFO.provs), 0 — нет',
           'flags': FLAGS, 'edge': 'переправы на рёбрах к соседям E (биты 0–1), S (2–3), SE (4–5), SW (6–7): 0 нет, 1 брод, 2 большая река, 3 мост',
           'km': 'шаг по x ≈ 6·0,63 км, по y ≈ 6·0,82 км'}, open(OUT + '/grid.json', 'w'), ensure_ascii=False, indent=1)
e = edge
print('сетка', GW, 'x', GH, 'суша', int((flags & 1 > 0).sum()), 'зона', int((flags & 2 > 0).sum()), 'море', int((flags & 32 > 0).sum()),
      'дороги', int((flags & 4 > 0).sum()), 'проливы', int((flags & 64 > 0).sum()), 'перевалы', int((flags & 8 > 0).sum()), 'непроходимые', int((flags & 16 > 0).sum()),
      'мостов (значков)', len(br_out), 'судоходных клеток', int(((flags & 128) > 0).sum()), 'бродов', int(sum(((e >> (2 * s)) & 3 == 1).sum() for s in range(4))), 'больших рек', int(sum(((e >> (2 * s)) & 3 == 2).sum() for s in range(4))),
      'без провинции в зоне', int(((flags & 2) > 0).sum() - ((prov > 0) & ((flags & 2) > 0)).sum()), 'КБ', os.path.getsize(OUT + '/grid.bin') // 1024)
