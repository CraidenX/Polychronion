# Разделение регионов по провинциям (split.json) — после mkprov.py, до mkpadj.py.
# Новый регион добавляется в КОНЕЦ списка: номера остальных регионов и провинций не меняются (сохранения и переименования целы).
# Что меняется: gen.json (regions, rids, colors, links, greek), mapinfo3.json (ids, pos, provs[*][0], rle — сетка регионов).
# Повторный запуск ничего не ломает: уже разделённое пропускается. Запуск: python3 -I mksplit.py ..
import os, sys, json
import numpy as np
from PIL import Image
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = sys.argv[1] if len(sys.argv) > 1 else SP + '..'
CFG = json.load(open(SP + 'split.json'))
gen = json.load(open(SP + 'gen.json')); mi = json.load(open(SP + 'mapinfo3.json'))
W, H, C, GW, GH = mi['W'], mi['H'], mi['C'], mi['GW'], mi['GH']
k = W / 2000
lonlat = lambda x, y: (round(x / (51.075 * k) + 11.4547, 2), round(48.4153 - y / (51.0312 * k), 2))
I = np.asarray(Image.open(OUT + '/ids.png').convert('RGB')).astype(np.int32)
S = mi.get('idsScale', 1)
PID = ((I[..., 0] << 8) | I[..., 1]) - 1          # номер провинции, −1 — нет
provs = mi['provs']
def decode_rle(s, base):
    out = []; p = 0
    while p < len(s):
        n = 0
        while s[p].isdigit(): n = n * 10 + int(s[p]); p += 1
        ch = s[p]; p += 1; out += [-1 if ch == '.' else ord(ch) - base] * max(1, n)
    return out
def encode_rle(a, base):
    r = []; i = 0
    while i < len(a):
        j = i
        while j < len(a) and a[j] == a[i]: j += 1
        n = j - i; r.append((str(n) if n > 1 else '') + ('.' if a[i] < 0 else chr(base + a[i]))); i = j
    return ''.join(r)
for sp in CFG['split']:
    if sp['id'] in mi['ids']: print('уже разделено:', sp['id']); continue
    r0 = mi['ids'].index(sp['from']); rn = len(mi['ids'])
    moved = [i for i, p in enumerate(provs) if p[0] == r0 and p[4] not in sp['keep']]
    kept = [i for i, p in enumerate(provs) if p[0] == r0 and p[4] in sp['keep']]
    assert moved and kept, 'нет провинций для разделения'
    for i in moved:
        provs[i][0] = rn
        if provs[i][4].startswith(gen['regions'][r0][1] + ','): provs[i][4] = sp['name'] + provs[i][4][len(gen['regions'][r0][1]):]
    cen = lambda L: (sum(provs[i][1] * provs[i][3] for i in L) / sum(provs[i][3] for i in L), sum(provs[i][2] * provs[i][3] for i in L) / sum(provs[i][3] for i in L))
    cx, cy = cen(moved); kx, ky = cen(kept)
    src = gen['regions'][r0]
    gen['regions'].append([sp['id'], sp['name'], src[2], *sp['stats'], *lonlat(cx, cy)])
    gen['rids'].append(-1); gen['colors'].append(sp.get('color', gen['colors'][r0]))
    mi['ids'].append(sp['id']); mi['pos'][sp['id']] = [round(cx), round(cy)]; mi['pos'][sp['from']] = [round(kx), round(ky)]
    gen['regions'][r0][-2:] = list(lonlat(kx, ky))
    if sp['from'] in gen.get('greek', []): gen['greek'].append(sp['id'])
    # сетка регионов (клетки C×C): клетки старого региона, где больше пикселей ушедших провинций, — новому
    grid = decode_rle(mi['rle'], mi['abase']); mset = set(moved)
    for gy in range(GH):
        for gx in range(GW):
            if grid[gy * GW + gx] != r0: continue
            blk = PID[gy * C // S:(gy + 1) * C // S, gx * C // S:(gx + 1) * C // S].ravel()
            blk = blk[blk >= 0]
            if len(blk) and np.isin(blk, moved).sum() * 2 > len(blk): grid[gy * GW + gx] = rn
    mi['rle'] = encode_rle(grid, mi['abase'])
    # связи: сухопутные соседи обоих регионов — по соседству пикселей провинций; морские пути старого региона — и новому
    reg = np.full(len(provs) + 1, -1); reg[:len(provs)] = [p[0] for p in provs]
    R = np.where(PID >= 0, reg[np.clip(PID, 0, None)], -1)
    pairs = set()
    for a, b in ((R[:, :-1], R[:, 1:]), (R[:-1, :], R[1:, :])):
        m = (a != b) & (a >= 0) & (b >= 0) & (np.isin(a, [r0, rn]) | np.isin(b, [r0, rn]))
        for x, y in set(zip(a[m].tolist(), b[m].tolist())): pairs.add((min(x, y), max(x, y)))
    ids = mi['ids']
    old = [l for l in gen['links'] if sp['from'] in l[:2]]
    keep_links = [l for l in gen['links'] if not (sp['from'] in l[:2] and l[2] == 'land')]
    for x, y in sorted(pairs):
        if not any({ids[x], ids[y]} == {l[0], l[1]} for l in keep_links): keep_links.append([ids[x], ids[y], 'land'])
    for l in old:
        if l[2] == 'sea': keep_links.append([sp['id'] if l[0] == sp['from'] else l[0], sp['id'] if l[1] == sp['from'] else l[1], 'sea'])
    gen['links'] = keep_links
    print(sp['from'], '→ оставлено', [provs[i][4] for i in kept], '| новый регион', sp['name'], [provs[i][4] for i in moved])
    print('   связи:', [l for l in gen['links'] if sp['id'] in l[:2] or sp['from'] in l[:2]])
# переименования — разом по исходным именам (можно менять имена местами) и только один раз
RN = CFG.get('rename_provs', {})
if RN and not mi.get('split_renamed'):
    for p in provs:
        a = p[4]
        if a in RN:
            p[4] = RN[a]
            if 'земля' not in a: mi.setdefault('oldnames', {})[RN[a]] = a   # в поиске: «прежде: …» — только для настоящих названий
            elif RN[a] in mi.get('oldnames', {}): del mi['oldnames'][RN[a]]
    mi['split_renamed'] = True
json.dump(gen, open(SP + 'gen.json', 'w'), ensure_ascii=False)
json.dump(mi, open(SP + 'mapinfo3.json', 'w'), ensure_ascii=False)
