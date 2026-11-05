# Генерация игровых регионов из карт пользователя:
#   umap/rl.npy (метки регионов по regions.webp), umap/regs.json, umap/src.webp (державы)
# На выходе: gen.json (регионы, связи, псевдонимы) и mapinfo3.json (сетка для отрисовки)
import json, math, heapq, re
from collections import deque, Counter
import numpy as np
from PIL import Image, ImageFilter
SP = __import__('os').path.dirname(__import__('os').path.abspath(__file__)) + '/'
import glob, os
fit = json.load(open(SP + 'umap/fit.json'))
rl = np.load(SP + 'umap/rl.npy').astype(np.int32); regs = json.load(open(SP + 'umap/regs.json'))
H0, W0 = rl.shape
kfit = W0 / fit.get('W', 2000)
l0, sx, p0, sy = fit['p'][0], fit['p'][1] * kfit, fit['p'][2], fit['p'][3] * kfit
SC = 1.0; C = 8  # карта показывается в исходном размере; клетка запасной сетки = 8 px
W, H = int(round(W0 * SC)), int(round(H0 * SC)); GW, GH = W // C + 1, H // C + 1
POL = sorted(glob.glob(SP + '../source/*political*.png'))[0]
stRaw = np.asarray(Image.open(POL).convert('RGB')).astype(np.int32)
kP = (stRaw[..., 0] << 16) | (stRaw[..., 1] << 8) | stRaw[..., 2]
dnav = np.where(kP == 0x001F48, 0, 999)
def topx(lon, lat): return ((lon - l0) * sx, (p0 - lat) * sy)  # исходные px
def tolonlat(x, y): return (l0 + x / sx, p0 - y / sy)
# сетка: метки и море
cx = (np.arange(GW) * C + C / 2) / SC; cy = (np.arange(GH) * C + C / 2) / SC  # в исходных px
XI = np.clip(cx.astype(int), 0, W0 - 1); YI = np.clip(cy.astype(int), 0, H0 - 1)
glab = rl[np.ix_(YI, XI)]
gsea = dnav[np.ix_(YI, XI)] < 60
glab = rl[np.ix_(YI, XI)]
# --- исторические области (старые 34) ---
old = json.load(open(SP + 'regions.json'))
LEG = {}  # id -> def из старых данных
src2 = open(SP + 'src/2_data.js').read()
for m in re.finditer(r"\['(\w+)', '([^']+)', '(\w+)', (\d+), (\d+), (\d+), (\d+), (\d+), '(\w+)'\]", src2):
    LEG[m.group(1)] = [m.group(1), m.group(2), m.group(3)] + [int(m.group(i)) for i in range(4, 9)] + [m.group(9)]
# --- палитра держав по карте 1261 года ---
FMAP = {  # точный цвет на карте держав -> держава игры
 (114,6,80): 'byz', (144,182,161): 'seljuk', (86,76,163): 'sicily', (103,97,122): 'bulgaria', (165,39,62): 'serbia',
 (40,164,157): 'trebizond', (157,111,186): 'epirus', (128,153,104): 'thessaly', (255,213,51): 'achaea', (255,215,124): 'candar',
 (58,150,178): 'karaman', (56,101,153): 'venice', (54,100,153): 'venice', (24,50,123): 'venice', (114,140,213): 'venice', (248,195,36): 'venice', (54,167,156): 'venice',
 (247,123,0): 'cyprus', (113,112,96): 'athens', (76,255,0): 'athens', (252,112,214): 'athens', (211,172,185): 'achaea',
 (56,181,110): 'menteshe', (232,48,2): 'ilkhan', (36,132,247): 'georgia', (56,101,153): 'venice', (28,141,255): 'georgia', (127,71,77): 'hungary', (81,45,49): 'hungary',
 (240,167,130): 'bosnia', (168,113,87): 'vlachs', (188,166,93): 'mamluk', (214,140,190): 'armenia', (0,181,135): 'shirvan', (38,127,0): 'byz', (160,82,128): 'venice', (255,248,214): 'sicily',
}
OVER = {0x808080, 0x001F48, 0x000020, 0x262626, 0x000000, 0xDFDFDF, 0x81817F, 0x5E5E5E, 0x404040}
unknown = Counter()
def owner_of(rid, lon, lat):
    m = rl == rid
    ks = kP[m]; ks = ks[~np.isin(ks, list(OVER))]
    if len(ks) < 20: return None, None
    cnt = Counter(ks.tolist())
    for k, n in cnt.most_common():
        col = ((k >> 16) & 255, (k >> 8) & 255, k & 255)
        if col in FMAP: return FMAP[col], list(col)
        unknown[col] += n
    return None, None
# --- точки подписей: самая «глубокая» клетка региона ---
def label_point(mask):
    dist = np.zeros(mask.shape, int); q = deque()
    ys, xs = np.nonzero(mask)
    for y, x in zip(ys, xs):
        if y == 0 or x == 0 or y == mask.shape[0] - 1 or x == mask.shape[1] - 1 or not (mask[y - 1, x] and mask[y + 1, x] and mask[y, x - 1] and mask[y, x + 1]):
            dist[y, x] = 1; q.append((y, x))
    while q:
        y, x = q.popleft()
        for Y, X in ((y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)):
            if mask[Y, X] and dist[Y, X] == 0: dist[Y, X] = dist[y, x] + 1; q.append((Y, X))
    mx = dist.max(); cand = np.argwhere(dist >= max(1, mx - 1))
    c = cand.mean(0); best = cand[np.argmin(((cand - c) ** 2).sum(1))]
    return int(best[1]), int(best[0])
GAZ = [('Константинополь',28.97,41.02),('Диррахий',19.45,41.32),('Авлона',19.49,40.47),('Берат',19.95,40.70),('Кроя',19.79,41.52),('Скутари',19.51,42.07),('Охрид',20.80,41.12),('Кастория',21.27,40.52),('Янина',20.85,39.66),('Арта',20.99,39.16),('Навпакт',21.83,38.39),('Корфу',19.92,39.62),('Кефалония',20.5,38.2),('Пелагония',21.33,41.03),('Прилеп',21.55,41.34),('Скопье',21.43,42.0),('Велбужд',22.69,42.28),('Струмица',22.64,41.44),('Мельник',23.39,41.52),('Серры',23.55,41.09),('Драма',24.14,41.15),('Христополь',24.41,40.94),('Ксанфия',24.88,41.14),('Мосинополь',25.4,41.1),('Фессалоники',22.95,40.64),('Верия',22.2,40.52),('Эдесса',22.05,40.8),('Кассандрия',23.4,40.05),('Афон',24.2,40.2),('Лариса',22.42,39.64),('Трикала',21.77,39.55),('Димитриада',22.95,39.36),('Неопатры',22.43,38.9),('Салона',22.38,38.53),('Фивы',23.32,38.32),('Афины',23.73,37.98),('Негропонт',23.6,38.46),('Коринф',22.88,37.9),('Патры',21.73,38.25),('Андравида',21.27,37.9),('Каламата',22.11,37.04),('Мистра',22.37,37.07),('Монемвасия',23.05,36.69),('Навплион',22.8,37.57),('Модон',21.7,36.8),('Филиппополь',24.75,42.15),('Адрианополь',26.56,41.68),('Дидимотих',26.5,41.35),('Траянополь',25.97,40.95),('Энос',26.08,40.73),('Галлиполи',26.67,40.41),('Родосто',27.51,40.98),('Силиврия',28.25,41.07),('Визия',27.68,41.57),('Аркадиополь',27.36,41.39),('Месемврия',27.73,42.66),('Созополь',27.7,42.42),('Ямбол',26.5,42.48),('Берое',25.63,42.42),('Средец',23.32,42.7),('Тырново',25.63,43.08),('Варна',27.91,43.2),('Лемнос',25.2,39.9),('Тасос',24.7,40.7),('Самофракия',25.53,40.48),('Имброс',25.85,40.18),('Лесбос',26.25,39.2),('Хиос',26.0,38.38),('Самос',26.8,37.75),('Родос',28.0,36.2),('Кос',27.1,36.85),('Наксос',25.4,37.05),('Андрос',24.85,37.85),('Милос',24.4,36.7),('Скирос',24.55,38.9),('Карпатос',27.15,35.6),('Кандия',25.13,35.33),('Ханья',24.0,35.5),('Ретимно',24.48,35.36),('Ситея',26.1,35.2),('Никосия',33.36,35.17),('Фамагуста',33.94,35.12),('Пафос',32.42,34.77),('Кирения',33.32,35.34),('Лимасол',33.04,34.68),('Палермо',13.36,38.12),('Мессина',15.55,38.19),('Сиракузы',15.29,37.07),('Агридженто',13.58,37.31),('Трапани',12.51,38.02),('Катания',15.08,37.5),('Никомедия',29.92,40.77),('Никея',29.72,40.43),('Прусса',29.06,40.18),('Кизик',27.88,40.38),('Лопадий',28.4,40.13),('Пиги',27.1,40.4),('Адрамиттий',27.0,39.6),('Пергам',27.18,39.12),('Смирна',27.14,38.42),('Магнесия',27.43,38.61),('Фокея',26.75,38.67),('Эфес',27.34,37.94),('Сарды',28.04,38.48),('Филадельфия',28.52,38.35),('Траллы',27.84,37.86),('Милет',27.27,37.53),('Миласа',27.78,37.32),('Лаодикея',29.11,37.84),('Ахирай',28.0,39.6),('Сёгют',30.18,40.02),('Дорилей',30.52,39.78),('Кютахья',29.98,39.42),('Гераклея Понтийская',31.42,41.28),('Амастрида',32.38,41.75),('Кастамону',33.78,41.38),('Синоп',35.15,42.02),('Амис',36.33,41.29),('Трапезунд',39.72,41.0),('Керасунт',38.39,40.91),('Лампсак',26.69,40.35),('Хрисополь',29.03,41.0),('Атталия',30.7,36.89)]
# сопоставляем исторические области с регионами пользователя
info = []
for r in regs:
    m = rl == r['id']; x, y = label_point(m); lon, lat = tolonlat(x, y)
    f, col = owner_of(r['id'], lon, lat)
    if f is None: rl[m] = -1; print('skip region without state colour', round(lon, 1), round(lat, 1)); continue
    info.append({'rid': r['id'], 'x': x, 'y': y, 'lon': lon, 'lat': lat, 'owner': f, 'col': col, 'n': r['n'], 'parts': r['parts'], 'id': None})
byrid = {i['rid']: i for i in info}
regs_by = {r['id']: r for r in regs}
glab = rl[np.ix_(YI, XI)]
alias = {}
prio = ['konst', 'thessal', 'nikomed', 'bithynia', 'prusa', 'smyrna', 'phila', 'thrace', 'morea', 'achaea', 'athens', 'negro', 'crete', 'epirus', 'thessaly', 'dyrr', 'ohrid', 'skopje', 'serres', 'rhodope', 'mysia', 'lesbos', 'chios', 'archip', 'mesemb', 'tarnovo', 'sofia', 'rascia', 'sogut', 'germiyan', 'konya', 'caria', 'paphl', 'trebiz']
unmatched = []
for hid in prio:
    o = next(e for e in old if e[0] == hid)
    x, y = topx(o[2], o[3]); xi, yi = int(x), int(y)
    R0 = 21 * 3
    found = None; first = None
    for rad in range(0, R0, 3):
        win = rl[max(0, yi - rad):yi + rad + 1, max(0, xi - rad):xi + rad + 1]
        v = [r for r in set(win[win >= 0].tolist()) if r in byrid]
        if v and first is None and rad <= 12: first = Counter(win[win >= 0].tolist()).most_common(1)[0][0]
        good = [r for r in v if byrid[r]['owner'] == LEG[hid][2] and (byrid[r]['id'] is None)] if LEG[hid][2] == 'byz' else []
        if good: found = good[0]; break
    if found is None: found = first if first in byrid else None
    if found is None: unmatched.append(hid); continue
    it = byrid[found]
    if it['id'] is None: it['id'] = hid
    else: alias[hid] = it['id']
# названия для новых регионов
used = set(LEG[i['id']][1] for i in info if i['id'])
k = 0
for it in info:
    if it['id']: it['name'] = LEG[it['id']][1]; continue
    cands = sorted(GAZ, key=lambda g: (g[1] - it['lon']) ** 2 + (g[2] - it['lat']) ** 2)
    nm = next((g[0] for g in cands[:6] if g[0] not in used), None) or ('Земля ' + str(k + 1))
    used.add(nm); k += 1; it['name'] = nm; it['id'] = 'g' + str(it['rid'])
NAMES = json.load(open(SP + 'names.json')) if os.path.exists(SP + 'names.json') else []
for it in info:
    hexc = '#%06x' % regs_by[it['rid']]['col']
    it['color'] = hexc
    cand = [n for n in NAMES if n['color'] == hexc and (n['lon'] - it['lon']) ** 2 + (n['lat'] - it['lat']) ** 2 < 2.5 ** 2]
    if cand: it['name'] = min(cand, key=lambda n: (n['lon'] - it['lon']) ** 2 + (n['lat'] - it['lat']) ** 2)['name']
# --- запасные области для исторических мест вне закрашенной зоны (Вороной по незакрашенной суше) ---
land = ~gsea
free = land & (glab < 0)
NREG = len(info)
gl = -np.ones((GH, GW), int)
for it_i, it in enumerate(info): gl[glab == it['rid']] = it_i
fb = []
for hid in unmatched:
    o = next(e for e in old if e[0] == hid)
    fb.append({'id': hid, 'name': LEG[hid][1], 'lon': o[2], 'lat': o[3], 'w': o[4], 'owner': LEG[hid][2], 'fallback': True})
best = np.full((GH, GW), 1e18); pq = []
for j, f in enumerate(fb):
    x, y = topx(f['lon'], f['lat']); gx, gy = int(x * SC / C), int(y * SC / C)
    if not free[gy, gx]:
        c = [(dx * dx + dy * dy, gx + dx, gy + dy) for dy in range(-10, 11) for dx in range(-10, 11) if 0 <= gx + dx < GW and 0 <= gy + dy < GH and free[gy + dy, gx + dx]]
        if not c: continue
        c.sort(); gx, gy = c[0][1], c[0][2]
    heapq.heappush(pq, (0.0, j, gx, gy, 0.0))
done = np.zeros((GH, GW), bool)
while pq:
    pr, j, x, y, raw = heapq.heappop(pq)
    if done[y, x]: continue
    done[y, x] = True; gl[y, x] = NREG + j
    for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
        X, Y = x + dx, y + dy
        if 0 <= X < GW and 0 <= Y < GH and not done[Y, X] and free[Y, X]:
            nr = raw + math.hypot(dx, dy) * C; npr = nr / fb[j]['w']
            if npr > 200: continue
            if npr < best[Y, X]: best[Y, X] = npr; heapq.heappush(pq, (npr, j, X, Y, nr))
allr = info + fb
# --- позиции подписей (в px показа) ---
pos = {}
for i, it in enumerate(allr):
    if it.get('fallback'):
        m = gl == i
        if not m.any(): x, y = topx(it['lon'], it['lat']); pos[it['id']] = [round(x * SC), round(y * SC)]; continue
        mm = np.zeros((GH + 2, GW + 2), bool); mm[1:-1, 1:-1] = m
        x, y = label_point(mm); pos[it['id']] = [(x - 1) * C + C // 2, (y - 1) * C + C // 2]
    else:
        pos[it['id']] = [round(it['x'] * SC), round(it['y'] * SC)]
        o = next((e for e in old if e[0] == it['id']), None)
        if o:
            hx, hy = topx(o[2], o[3])
            if 0 <= int(hy) < H0 and 0 <= int(hx) < W0 and rl[int(hy), int(hx)] == it['rid']: pos[it['id']] = [round(hx * SC), round(hy * SC)]
# --- связи: суша по сетке, море/пролив по расстоянию между берегами ---
adj = set()
for y in range(GH):
    for x in range(GW):
        a = gl[y, x]
        if a < 0: continue
        for X, Y in ((x + 1, y), (x, y + 1), (x + 1, y + 1), (x - 1, y + 1)):
            if 0 <= X < GW and Y < GH:
                b = gl[Y, X]
                if b >= 0 and b != a: adj.add((min(a, b), max(a, b)))
coast = {}
for y in range(1, GH - 1):
    for x in range(1, GW - 1):
        a = gl[y, x]
        if a >= 0 and (gsea[y - 1, x] or gsea[y + 1, x] or gsea[y, x - 1] or gsea[y, x + 1]): coast.setdefault(a, []).append((x, y))
for a in coast:
    c = coast[a]
    if len(c) > 160: c = [c[i] for i in np.linspace(0, len(c) - 1, 160).astype(int)]
    coast[a] = np.array(c, float) * C
ids = sorted(coast)
sea_d = {}
for i, a in enumerate(ids):
    for b in ids[i + 1:]:
        d = np.sqrt(((coast[a][:, None, :] - coast[b][None, :, :]) ** 2).sum(2)).min()
        sea_d[(a, b)] = d
links = {}
NP = len(info)
rid2i = {it['rid']: i for i, it in enumerate(info)}
for (a, b) in adj:
    if a < NP and b < NP: continue          # между регионами карты — по расчёту с горами (mkadj.py)
    links[(a, b)] = 'land'
WALLS = []
for ra, rb, t, o, bl in json.load(open(SP + 'umap/adj.json')):
    if ra not in rid2i or rb not in rid2i: continue
    a, b = sorted((rid2i[ra], rid2i[rb]))
    if t == 'wall': WALLS.append((a, b)); continue
    links[(a, b)] = t
for (a, b), d in sea_d.items():
    if (a, b) in links or (a, b) in WALLS: continue
    if d < 40: links[(a, b)] = 'strait'
for a in ids:
    cand = sorted((d, (min(a, b), max(a, b))) for (p, q), d in sea_d.items() for b in [q if p == a else p if q == a else None] if b is not None)
    added = 0
    for d, key in cand:
        if key in links: continue
        if d < 200 and added < 3 or (added == 0 and not any(a in k for k in links)):
            links[key] = 'sea'; added += 1
# гарантия связности: каждый регион хоть с кем-то связан
for i in range(len(allr)):
    if not any(i in k for k in links):
        o = min((j for j in range(len(allr)) if j != i), key=lambda j: (pos[allr[j]['id']][0] - pos[allr[i]['id']][0]) ** 2 + (pos[allr[j]['id']][1] - pos[allr[i]['id']][1]) ** 2)
        links[(min(i, o), max(i, o))] = 'sea'
# --- характеристики ---
TER = {e: LEG[e][8] for e in LEG}
out = []
for i, it in enumerate(allr):
    rid = it['id']
    lon, lat = (it['lon'], it['lat'])
    if rid in LEG:
        d = LEG[rid][:]; d[2] = it['owner'] if not it.get('fallback') else d[2]
        if not it.get('fallback'): d[1] = it['name']
        if rid == 'konst': d[2] = 'byz'
    else:
        near = min(LEG, key=lambda e: (next(o for o in old if o[0] == e)[2] - lon) ** 2 + (next(o for o in old if o[0] == e)[3] - lat) ** 2)
        ter = TER[near] if TER[near] != 'walls' else 'plain'
        w = int(round(min(26, max(4, 3 + it['parts'] * 1.2))))
        d = [rid, it['name'], it['owner'], w, w * 4 + 10, 2, 300, 52, ter]
    out.append(d + [round(lon, 2), round(lat, 2)])
# масштаб богатства: суммарный доход ромеев — как в версии 0.1 (≈263)
byzw = sum(d[3] for d in out if d[2] == 'byz' and d[0] != 'konst')
k = (263 - 55) / max(1, byzw)
for d in out:
    if d[0] != 'konst': d[3] = max(3, int(round(d[3] * k))); d[4] = max(10, int(round(d[4] * min(1, k * 1.2))))
idx = {d[0]: i for i, d in enumerate(out)}
L = [[allr[a]['id'], allr[b]['id'], t] for (a, b), t in sorted(links.items())]
greekOwners = {'byz', 'epirus', 'trebizond', 'achaea', 'athens', 'venice', 'cyprus'}
greek = [d[0] for d in out if d[2] in greekOwners and not (d[9] < 16)]
anat = [d[0] for d in out if (d[9] > 29.1 and d[10] < 42.2) or (d[10] < 40.3 and d[9] > 26.4)]
ports = sorted(set(x for a, b, t in L if t != 'land' for x in (a, b)))
gen = {'rids': [it.get('rid', -1) for it in allr], 'colors': [it.get('color') for it in allr], 'regions': out, 'links': L, 'alias': alias, 'greek': greek, 'anatolia': anat, 'ports': ports}
json.dump(gen, open(SP + 'gen.json', 'w'), ensure_ascii=False)
np.save(SP + 'umap/gl.npy', gl.astype(np.int16)); json.dump({'C': C, 'GW': GW, 'GH': GH}, open(SP + 'umap/grid.json', 'w'))
# RLE сетки
alpha = [chr(0x100 + i) for i in range(1500)]
flat = [(alpha[v] if v >= 0 else '.') for v in gl.flatten()]
assert len(allr) <= len(alpha), len(allr)
rle = []; i = 0
while i < len(flat):
    j = i
    while j < len(flat) and flat[j] == flat[i]: j += 1
    n = j - i; rle.append((str(n) if n > 1 else '') + flat[i]); i = j
mi = {'W': W, 'H': H, 'C': C, 'GW': GW, 'GH': GH, 'rle': ''.join(rle), 'abase': 256, 'pos': pos, 'ids': [d[0] for d in out],
      'focus': [int(min(p[0] for p in pos.values())) - 100, int(min(p[1] for p in pos.values())) - 100, int(max(p[0] for p in pos.values())) + 100, int(max(p[1] for p in pos.values())) + 100]}
for a, b in alias.items(): mi['pos'][a] = mi['pos'][b]
json.dump(mi, open(SP + 'mapinfo3.json', 'w'), ensure_ascii=False)
own_c = Counter(d[2] for d in out)
print('regions', len(out), 'painted', len(info), 'fallback', len(fb), 'links', len(L), Counter(t for _, _, t in L))
print('walls', [(allr[a]['name'], allr[b]['name']) for a, b in WALLS]); print('passes', [(allr[a]['name'], allr[b]['name']) for (a, b), t in links.items() if t == 'pass']); print('owners', dict(own_c)); print('unknown colours', unknown.most_common(8)); print('alias', alias); print('unmatched->fallback', unmatched)
for it in info: print(it['id'], it.get('color'), it['name'], it['owner'], it['parts'], round(it['lon'], 1), round(it['lat'], 1))
