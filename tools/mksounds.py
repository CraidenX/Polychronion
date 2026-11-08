# Звуки моря для игры из свободных библиотек (без синтеза): ../sounds/*.mp3 + sounds.json + CREDITS.txt
# Источники скачиваются в tools/sounds_src/ (в репозиторий не кладутся). Запуск: python3 -I mksounds.py ..
#   волны  — OpenGameArt «Beach Ocean Waves» и «Water Waves» (CC0)
#   чайки  — OpenGameArt «Solo Seagull Sound Effects» (CC0) и Wikimedia Commons «Gull 1/2» (общественное достояние)
#   плеск/течение — Wikimedia Commons «Water over rocks as tide recedes» (общественное достояние)
import os, sys, json, subprocess, urllib.request
import numpy as np
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = (sys.argv[1] if len(sys.argv) > 1 else SP + '..') + '/sounds'
SRC = SP + 'sounds_src/'
UA = {'User-Agent': 'PolychronionAssetFetcher/1.0 (hobby game project)'}
OGA = 'https://opengameart.org/sites/default/files/'
WM = 'https://upload.wikimedia.org/wikipedia/commons/'
FILES = {   # имя: (адрес, лицензия, автор, страница)
  **{f'wave_j{i}.flac': (OGA + f'wave_0{i}_cc0-18363__jasinski__alkaibeach.flac', 'CC0', 'jasinski (Freesound), подготовил qubodup', 'https://opengameart.org/content/beach-ocean-waves') for i in range(1, 5)},
  **{f'wave_t{i}.flac': (OGA + f'wave_0{i}_cc0-11505__transitking__wavesound.flac', 'CC0', 'transitking (Freesound), подготовил qubodup', 'https://opengameart.org/content/water-waves') for i in range(1, 5)},
  **{f'gull_a{i}.wav': (OGA + f'Seagull%20Ambient%20{i}.wav', 'CC0', 'rango-mango', 'https://opengameart.org/content/solo-seagull-sound-effects') for i in range(1, 8)},
  'gull_wm1.ogg': (WM + '4/43/Gull_1.ogg', 'Public domain', 'avphillips', 'https://commons.wikimedia.org/wiki/File:Gull_1.ogg'),
  'gull_wm2.ogg': (WM + 'c/c6/Gull_2.ogg', 'Public domain', 'avphillips', 'https://commons.wikimedia.org/wiki/File:Gull_2.ogg'),
  'flow_wm.ogg': (WM + '6/60/Water_over_rocks_as_tide_recedes.ogg', 'Public domain', 'earthcalling', 'https://commons.wikimedia.org/wiki/File:Water_over_rocks_as_tide_recedes.ogg'),
}
os.makedirs(SRC, exist_ok=True); os.makedirs(OUT, exist_ok=True)
for fn, (url, *_rest) in FILES.items():
    if not os.path.exists(SRC + fn):
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
        open(SRC + fn, 'wb').write(data); print('скачано', fn, len(data) // 1024, 'КБ')
SR = 44100
def load(fn, af=''):   # моно float32 через ffmpeg (с фильтрами)
    cmd = ['ffmpeg', '-v', 'error', '-i', SRC + fn] + (['-af', af] if af else []) + ['-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).copy()
def save(x, name, kbps=80):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', OUT + '/' + name], input=x.astype(np.float32).tobytes(), check=True)
def fades(x, a, b):
    n1, n2 = int(a * SR), int(b * SR); x = x.copy()
    if n1: x[:n1] *= np.linspace(0, 1, n1) ** 1.5
    if n2: x[-n2:] *= np.linspace(1, 0, n2) ** 1.5
    return x
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
def norm_rms(x, target_db, peak=0.95):   # громкость по среднему уровню, без перегруза
    x = x * 10 ** ((target_db - rms_db(x)) / 20); p = np.abs(x).max()
    return x * (peak / p) if p > peak else x
meta = {'wave': [], 'gull': [], 'flow': None}
# волны: мягче (срез верхов — без «штормового шипения»), плавное начало и долгое затухание
for i, fn in enumerate(sorted(f for f in FILES if f.startswith('wave_'))):
    x = fades(load(fn, 'highpass=f=70,lowpass=f=6500'), 0.35, 1.0)
    save(norm_rms(x, -22), f'wave{i + 1}.mp3'); meta['wave'].append(f'wave{i + 1}.mp3')
# чайки: режем записи на отдельные фразы по паузам; убираем низкий гул
def phrases(x, gap=0.45, minlen=0.35, maxlen=3.6):
    fr = int(0.02 * SR); e = np.array([np.sqrt(np.mean(x[i:i + fr] ** 2)) for i in range(0, len(x) - fr, fr)])
    on = 20 * np.log10(e + 1e-9) > 20 * np.log10(e.max()) - 28
    segs, s, last = [], None, -99
    for k, v in enumerate(on):
        if v:
            if s is None: s = k
            elif (k - last) * 0.02 > gap: segs.append((s, last)); s = k
            last = k
    if s is not None: segs.append((s, last))
    out = []
    for a, b in segs:
        t0, t1 = max(0, a * 0.02 - 0.06), min(len(x) / SR, (b + 1) * 0.02 + 0.2)
        while t1 - t0 > maxlen: out.append((t0, t0 + maxlen * 0.6)); t0 += maxlen * 0.6
        if t1 - t0 >= minlen: out.append((t0, t1))
    return out
n = 0
for fn in sorted(f for f in FILES if f.startswith('gull_')):
    x = load(fn, 'highpass=f=380,lowpass=f=9000')
    for t0, t1 in (phrases(x) if 'wm' in fn else [(0, len(x) / SR)]):
        y = x[int(t0 * SR):int(t1 * SR)]
        if len(y) < 0.3 * SR: continue
        n += 1; save(norm_rms(fades(y, 0.02, min(0.25, len(y) / SR / 4)), -20), f'gull{n}.mp3', 96); meta['gull'].append(f'gull{n}.mp3')
# плеск воды о камни (30 с, без гула ветра ниже 150 Гц); петлю без шва собирает игра — перекрёстным затуханием
x = load('flow_wm.ogg', 'highpass=f=150,highpass=f=150,lowpass=f=7000')
save(norm_rms(x, -24), 'flow.mp3', 72); meta['flow'] = 'flow.mp3'
json.dump(meta, open(OUT + '/sounds.json', 'w'), ensure_ascii=False)
seen, lines = set(), ['Звуки моря в «Полихронионе» — из свободных библиотек:', '']
for fn, (url, lic, author, page) in FILES.items():
    if page in seen: continue
    seen.add(page); lines.append(f'{author} — {lic} — {page}')
open(OUT + '/CREDITS.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
tot = sum(os.path.getsize(OUT + '/' + f) for f in os.listdir(OUT))
print('волн', len(meta['wave']), 'чаек', len(meta['gull']), 'всего', tot // 1024, 'КБ')
