# Звуки окружения для игры (без синтеза): ../sounds/*.mp3 + sounds.json + CREDITS.txt
# Источники лежат в tools/sounds_src/ (в репозиторий не кладутся; свободные — скачиваются сами). Запуск: python3 -I mksounds.py ..
#   море   — запись «the sea is slightly rough», прислал автор игры (плеск волн, петля)
#   чайки  — фрагменты записи «calm sea and seagulls», прислал автор игры (лучшие места с криками ищутся автоматически)
#   ветер в горах — OpenGameArt «Mild Wind Background Noise» (bashar3a) и «Short wind sound» (remaxim), CC0
#   хищные птицы — OpenGameArt «Bald Eagle Screams» (qubodup, CC BY 3.0) и «Osprey Sound» (antumdeluge, CC BY-SA 4.0)
import os, sys, json, subprocess, urllib.request
import numpy as np
SP = os.path.dirname(os.path.abspath(__file__)) + '/'
OUT = (sys.argv[1] if len(sys.argv) > 1 else SP + '..') + '/sounds'
SRC = SP + 'sounds_src/'
UA = {'User-Agent': 'PolychronionAssetFetcher/1.0 (hobby game project)'}
OGA = 'https://opengameart.org/sites/default/files/'
FILES = {   # имя: (адрес или None — файл кладётся вручную, лицензия, автор, страница)
  'user_sea.mp3': (None, 'прислал автор игры', '—', '«the sea is slightly rough»'),
  'user_gulls.mp3': (None, 'прислал автор игры', '—', '«calm sea and seagulls»'),
  'wind_mild.wav': (OGA + 'wind%20background%20noise%202.wav', 'CC0', 'bashar3a', 'https://opengameart.org/content/mild-wind-background-noise'),
  'wind_short.wav': (OGA + 'short%20wind%20sound.wav', 'CC0', 'remaxim', 'https://opengameart.org/content/short-wind-sound'),
  'eagle.mp3': (OGA + 'montageAudio-20120417%40215617.mp3', 'CC BY 3.0', 'qubodup', 'https://opengameart.org/content/bald-eagle-screams'),
  'osprey.flac': (OGA + 'osprey.flac', 'CC BY-SA 4.0', 'antumdeluge', 'https://opengameart.org/content/osprey-sound'),
}
os.makedirs(SRC, exist_ok=True); os.makedirs(OUT, exist_ok=True)
for fn, (url, *_r) in FILES.items():
    if not os.path.exists(SRC + fn):
        if not url: sys.exit('нет файла ' + SRC + fn + ' — положите его вручную')
        data = urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=300).read()
        open(SRC + fn, 'wb').write(data); print('скачано', fn, len(data) // 1024, 'КБ')
for f in os.listdir(OUT):   # старые файлы
    if f.endswith('.mp3'): os.remove(OUT + '/' + f)
SR = 44100
def load(fn, af='', sr=SR):
    cmd = ['ffmpeg', '-v', 'error', '-i', SRC + fn] + (['-af', af] if af else []) + ['-ac', '1', '-ar', str(sr), '-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, capture_output=True, check=True).stdout, np.float32).copy()
def save(x, name, kbps=80):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'libmp3lame', '-b:a', f'{kbps}k', OUT + '/' + name], input=x.astype(np.float32).tobytes(), check=True)
def fades(x, a, b):
    n1, n2 = int(a * SR), int(b * SR); x = x.copy()
    if n1: x[:n1] *= np.linspace(0, 1, n1) ** 1.5
    if n2: x[-n2:] *= np.linspace(1, 0, n2) ** 1.5
    return x
def rms_db(x): return 20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9)
def norm_rms(x, target_db, peak=0.95):
    x = x * 10 ** ((target_db - rms_db(x)) / 20); p = np.abs(x).max()
    return x * (peak / p) if p > peak else x
meta = {}
# море: вся запись — петля (шов сводит игра)
save(norm_rms(load('user_sea.mp3', 'highpass=f=40'), -22), 'sea.mp3', 72); meta['sea'] = 'sea.mp3'
# чайки: окна по 3 с, где больше всего тональных криков (спектральная «неплоскость» в полосе 0,9–3,8 кГц); шум воды приглушён фильтром
def gull_windows(x, sr, count=14, sec=3.0):
    n, hop = 1024, 512; win = np.hanning(n); fr = np.fft.rfftfreq(n, 1 / sr); band = (fr > 900) & (fr < 3800); sc = []
    for i in range(0, len(x) - n, hop):
        S = np.abs(np.fft.rfft(x[i:i + n] * win))[band] + 1e-9
        sc.append((1 - np.exp(np.mean(np.log(S))) / np.mean(S)) * np.log10(np.sum(S ** 2) + 1e-9))
    sc = np.array(sc); L = int(sec * sr / hop); ws = np.convolve(sc, np.ones(L) / L, mode='valid'); used = np.zeros(len(ws), bool); out = []
    for _ in range(count):
        j = int(np.argmax(np.where(used, -1e9, ws))); out.append(j * hop / sr); used[max(0, j - L):j + L] = True
    return sorted(out)
xg = load('user_gulls.mp3', 'highpass=f=700,lowpass=f=6500')
meta['gull'] = []
for i, t0 in enumerate(gull_windows(load('user_gulls.mp3', '', 22050), 22050)):
    y = xg[int(t0 * SR):int((t0 + 3) * SR)]
    save(norm_rms(fades(y, 0.4, 0.6), -22), f'gull{i + 1}.mp3', 80); meta['gull'].append(f'gull{i + 1}.mp3')
# ветер в горах: ровный фон (петля) и отдельные порывы
save(norm_rms(load('wind_mild.wav', 'highpass=f=60,lowpass=f=5000'), -24), 'wind.mp3', 64); meta['wind'] = 'wind.mp3'
save(norm_rms(fades(load('wind_short.wav', 'highpass=f=80'), 0.3, 0.8), -22), 'gust1.mp3', 64); meta['gust'] = ['gust1.mp3']
# хищные птицы: крики орла режем по паузам + скопа
def phrases(x, gap=0.25, minlen=0.25):
    fr = int(0.02 * SR); e = np.array([np.sqrt(np.mean(x[i:i + fr] ** 2)) for i in range(0, len(x) - fr, fr)])
    on = 20 * np.log10(e + 1e-9) > 20 * np.log10(e.max()) - 26; segs, s, last = [], None, -99
    for k, v in enumerate(on):
        if v:
            if s is None: s = k
            elif (k - last) * 0.02 > gap: segs.append((s, last)); s = k
            last = k
    if s is not None: segs.append((s, last))
    return [(max(0, a * 0.02 - 0.03), (b + 1) * 0.02 + 0.15) for a, b in segs if (b - a + 1) * 0.02 >= minlen]
meta['raptor'] = []
xe = load('eagle.mp3', 'highpass=f=500')
for t0, t1 in phrases(xe):
    y = xe[int(t0 * SR):int(t1 * SR)]
    k = len(meta['raptor']) + 1; save(norm_rms(fades(y, 0.01, 0.1), -20), f'raptor{k}.mp3', 80); meta['raptor'].append(f'raptor{k}.mp3')
k = len(meta['raptor']) + 1; save(norm_rms(fades(load('osprey.flac', 'highpass=f=500'), 0.01, 0.15), -20), f'raptor{k}.mp3', 80); meta['raptor'].append(f'raptor{k}.mp3')
json.dump(meta, open(OUT + '/sounds.json', 'w'), ensure_ascii=False)
lines = ['Звуки окружения в «Полихронионе»:', '']
for fn, (url, lic, author, page) in FILES.items(): lines.append(f'{author} — {lic} — {page}')
open(OUT + '/CREDITS.txt', 'w', encoding='utf-8').write('\n'.join(lines) + '\n')
tot = sum(os.path.getsize(OUT + '/' + f) for f in os.listdir(OUT))
print({k: (len(v) if isinstance(v, list) else v) for k, v in meta.items()}, 'всего', tot // 1024, 'КБ')
