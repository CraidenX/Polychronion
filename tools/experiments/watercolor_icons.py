# Пробные значки в акварельном стиле: город, крепость, войско — для оценки соотношения размеров.
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
D = '/tmp/claude-0/-home-user/697d9db8-74f0-5c0a-8a74-95666c35c65d/scratchpad/wc/'
img = Image.open(D + 'wc_sicily.png').convert('RGBA')
k = 5298 / 2000; X0, Y0, SC = 101, 1070, 2
def px(lon, lat): return (((lon - 11.4547) * 51.075 * k - X0) * SC, ((48.4153 - lat) * 51.0312 * k - Y0) * SC)
S = 4  # рисуем крупно и уменьшаем — мягкий «рисованный» край
INK = (70, 48, 32, 255); PAPER = (238, 226, 198, 255)
def layer(): return Image.new('RGBA', (img.size[0] * S, img.size[1] * S), (0, 0, 0, 0))
L = layer(); d = ImageDraw.Draw(L)
def city(x, y, size, big=False):
    x, y = x * S, y * S; u = size * S / 10
    d.ellipse([x - 9 * u, y - 1 * u, x + 9 * u, y + 4 * u], fill=(60, 40, 25, 70))          # тень
    houses = [(-6, 0, 4, 4), (-1, -2, 5, 6), (4, 0, 4, 4), (-3, 2, 4, 3), (2, 2, 4, 3)] + ([(0, -6, 3, 9)] if big else [])
    for hx, hy, w, h in houses:
        X, Y = x + hx * u, y + hy * u
        d.rectangle([X - w * u / 2, Y - h * u, X + w * u / 2, Y], fill=(226, 212, 182, 255), outline=INK, width=max(1, S // 2))
        d.polygon([(X - w * u / 2 - u * 0.4, Y - h * u), (X, Y - h * u - w * u * 0.55), (X + w * u / 2 + u * 0.4, Y - h * u)], fill=(168, 74, 52, 255), outline=INK)
    if big:  # купол собора
        d.ellipse([x - 2 * u, y - 11 * u, x + 2 * u, y - 7.5 * u], fill=(200, 170, 90, 255), outline=INK, width=max(1, S // 2))
def fort(x, y, size):
    x, y = x * S, y * S; u = size * S / 10
    d.ellipse([x - 10 * u, y - 1 * u, x + 10 * u, y + 4 * u], fill=(60, 40, 25, 70))
    d.rectangle([x - 7 * u, y - 6 * u, x + 7 * u, y], fill=(198, 186, 160, 255), outline=INK, width=max(1, S // 2))
    for tx in (-7, 0, 7):
        th = 11 if tx == 0 else 9
        d.rectangle([x + tx * u - 2.4 * u, y - th * u, x + tx * u + 2.4 * u, y], fill=(186, 172, 146, 255), outline=INK, width=max(1, S // 2))
        for c in (-1.6, 0, 1.6): d.rectangle([x + (tx + c) * u - 0.5 * u, y - (th + 1.3) * u, x + (tx + c) * u + 0.5 * u, y - th * u], fill=(186, 172, 146, 255), outline=INK)
    d.rectangle([x - 1.6 * u, y - 4 * u, x + 1.6 * u, y], fill=(80, 56, 36, 255))
    d.line([x, y - 11 * u, x, y - 16 * u], fill=INK, width=max(1, S // 2)); d.polygon([(x, y - 16 * u), (x + 4 * u, y - 15 * u), (x, y - 14 * u)], fill=(120, 30, 90, 255))
def army(x, y, size, col, men):
    x, y = x * S, y * S; u = size * S / 10
    d.ellipse([x - 9 * u, y - 1 * u, x + 9 * u, y + 3 * u], fill=(60, 40, 25, 80))
    for i, (sx, sy) in enumerate([(-5, 0), (-1.5, -1), (2, 0), (5.5, -1), (-3, 1.5), (1, 1.5), (4.5, 1.5)]):
        X, Y = x + sx * u, y + sy * u
        d.line([X, Y - 4.5 * u, X, Y], fill=INK, width=max(1, S))                     # фигурка
        d.ellipse([X - 0.9 * u, Y - 6 * u, X + 0.9 * u, Y - 4.3 * u], fill=INK)
        d.line([X + 1.2 * u, Y - 8 * u, X + 1.2 * u, Y], fill=(110, 80, 50, 255), width=max(1, S // 2))   # копьё
    d.line([x - 7 * u, y - 2 * u, x - 7 * u, y - 16 * u], fill=INK, width=max(1, S))      # знамя
    d.polygon([(x - 7 * u, y - 16 * u), (x + 1 * u, y - 14.5 * u), (x - 2 * u, y - 13 * u), (x + 1 * u, y - 11.5 * u), (x - 7 * u, y - 11 * u)], fill=col, outline=INK)
    f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', int(5 * u))
    d.rounded_rectangle([x - 2 * u, y + 3 * u, x + 13 * u, y + 9.5 * u], radius=2 * u, fill=PAPER, outline=INK, width=max(1, S // 2))
    d.text((x + 5.5 * u, y + 6.3 * u), men, fill=INK, font=f, anchor='mm')
CITIES = [('Палермо', 13.36, 38.12, True), ('Мессина', 15.55, 38.19, True), ('Катания', 15.09, 37.50, False), ('Сиракузы', 15.29, 37.07, False),
          ('Агридженто', 13.58, 37.31, False), ('Реджо', 15.65, 38.11, False), ('Козенца', 16.25, 39.30, False), ('Трапани', 12.51, 38.02, False)]
for n, lo, la, big in CITIES: city(*px(lo, la), 3.0 if big else 2.4, big)
fort(*px(15.29, 37.85), 2.6)            # Таормина
fort(*px(16.08, 38.62), 2.6)            # Тропеа / замок Калабрии
army(*px(14.28, 37.62), 2.6, (114, 6, 80, 255), '2 400')      # ромеи (цвет державы)
army(*px(16.30, 38.92), 2.6, (136, 140, 85, 255), '3 100')    # Сицилийское королевство
L = L.resize(img.size, Image.LANCZOS)
img = Image.alpha_composite(img, L)
# подписи сепией с «бумажным» ореолом
t = Image.new('RGBA', img.size, (0, 0, 0, 0)); dt = ImageDraw.Draw(t)
f1 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf', 15)
f2 = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf', 26)
for n, lo, la, big in CITIES:
    x, y = px(lo, la); dt.text((x, y + 13), n, font=f1, fill=(70, 48, 32, 255), anchor='mt', stroke_width=3, stroke_fill=(238, 226, 198, 200))
for n, lo, la in [('СИЦИЛИЯ', 14.1, 37.2), ('КАЛАБРИЯ', 16.45, 39.55)]:
    x, y = px(lo, la); dt.text((x, y), n, font=f2, fill=(70, 48, 32, 170), anchor='mm', stroke_width=2, stroke_fill=(238, 226, 198, 120))
img = Image.alpha_composite(img, t).convert('RGB')
img.save(D + 'wc_sicily_icons.png')
img.crop((850, 0, 1380, 720)).resize((795, 1080), Image.LANCZOS).save(D + 'wc_zoom_calabria.png')
img.crop((420, 600, 940, 960)).resize((1040, 720), Image.LANCZOS).save(D + 'wc_zoom_sicily.png')
