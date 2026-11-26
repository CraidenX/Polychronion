# Модель Афона с ячейками монастырей: python3 athos_slots.py
import json, numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage as nd
base = Image.open('art/lm_athos_base/sheet.png' if __import__('os').path.exists('art/lm_athos_base/sheet.png') else 'art/lm_athos_base/sheet.webp').convert('RGB')
A = np.asarray(base).astype(np.float32)
land = ~(np.clip(((A[..., 0] + A[..., 2]) / 2 - A[..., 1] - 60) / 80, 0, 1) > 0.5)
dist = nd.distance_transform_edt(land)
# ячейки: точка подошвы в координатах листа lm_athos_base (1447×1087); примерно по реальной географии
SLOTS = {'chilandar': (420, 335), 'zograf': (265, 415), 'esphigmenou': (540, 440), 'panteleimon': (455, 545),
         'karyes': (650, 525), 'vatopedi': (775, 530), 'iviron': (870, 625), 'lavra': (1010, 885)}
json.dump({'sheet_size': base.size, 'slot_width': 72, 'anchor': 0.78, 'slots': SLOTS}, open('athos_slots.json', 'w'), ensure_ascii=False, indent=1)
MON = [Image.open(f'art/athos_monasteries/peak_{i}.png') for i in range(9)]   # 0–2 руины, 3–5 обычный, 6–8 крупный
KARYES = Image.open('art/athos_karyes/peak_0.png')
def render(state, out):
    im = Image.open('art/lm_athos_base/peak_0.png').convert('RGBA')
    ox, oy = np.nonzero(np.asarray(Image.open('art/lm_athos_base/sheet.png' if __import__('os').path.exists('art/lm_athos_base/sheet.png') else 'art/lm_athos_base/sheet.webp').convert('L')) >= 0)[1].min(), 0
    # peak_0 — вырезка с отступом: найдём смещение вырезки относительно листа
    a = np.asarray(Image.open('art/lm_athos_base/sheet.png' if __import__('os').path.exists('art/lm_athos_base/sheet.png') else 'art/lm_athos_base/sheet.webp').convert('RGB')).astype(np.float32)
    m = ~(np.clip(((a[..., 0] + a[..., 2]) / 2 - a[..., 1] - 60) / 80, 0, 1) > 0.5)
    ys, xs = np.nonzero(nd.binary_opening(m)); dx, dy = xs.min() - 3, ys.min() - 3
    items = sorted(SLOTS.items(), key=lambda kv: kv[1][1])
    for k, (x, y) in items:
        s = state.get(k)
        if s is None: continue
        sp = KARYES if k == 'karyes' else MON[{'ruin': 0, 'ord': 3, 'big': 6}[s] + sum(map(ord, k)) % 3]
        w = 72 if s != 'big' else 84
        if k == 'karyes': w = 80
        sp = sp.resize((w, int(sp.height * w / sp.width)), Image.LANCZOS)
        im.alpha_composite(sp, (x - dx - w // 2, y - dy - int(sp.height * 0.78)))
    im.save(out)
S1261 = {'lavra': 'big', 'vatopedi': 'big', 'iviron': 'ord', 'chilandar': 'ord', 'zograf': 'ord', 'panteleimon': 'ord', 'esphigmenou': 'ord', 'karyes': 'ord'}
S1309 = dict(S1261, panteleimon='ruin', zograf='ruin', esphigmenou='ruin')
SFULL = {k: 'big' for k in SLOTS}; SFULL['karyes'] = 'ord'
for st, n in [(S1261, '1261'), (S1309, '1309'), (SFULL, 'full')]: render(st, f'athos_{n}.png')
print(SLOTS)
