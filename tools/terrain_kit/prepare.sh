#!/bin/sh
# Подготовка спрайтов: вырезка всех наборов из листов и выравнивание состояний Этны по размеру спокойной.
for d in art/*; do python3 cut.py "$d"; done
python3 -c "
from PIL import Image
a = Image.open('art/lm_etna/peak_0.png')
for n in ['lm_etna_active', 'lm_etna_erupt']:
    Image.open(f'art/{n}/peak_0.png').resize(a.size, Image.LANCZOS).save(f'art/{n}/peak_0.png')
print('Этна: состояния выровнены')"
