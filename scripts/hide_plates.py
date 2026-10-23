#!/usr/bin/env python3
"""Covers the number plates in the Instagram creatives with a branded plate ("MECHANIX PRO / 24x7 HELP"), so no real-looking registration number is shown on the site.
Reads assets/img/stories/<name>.webp (the untouched original, kept outside git history if you re-export it) and writes <name>-p.webp. The -p files are what the site uses. Needs Pillow. Run: python3 scripts/hide_plates.py"""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONT = '/System/Library/Fonts/HelveticaNeue.ttc'
def plate(im, box):
    x0, y0, x1, y1 = box; w, h = x1 - x0, y1 - y0
    p = Image.new('RGBA', (w * 4, h * 4), (0, 0, 0, 0)); d = ImageDraw.Draw(p)
    d.rounded_rectangle((0, 0, w * 4 - 1, h * 4 - 1), radius=h, fill=(20, 41, 90, 255), outline=(255, 255, 255, 255), width=max(4, h // 7))
    def fit(txt, size):
        f = ImageFont.truetype(FONT, size, index=1)
        while d.textlength(txt, font=f) > w * 4 * .82 and size > 8:
            size -= 2; f = ImageFont.truetype(FONT, size, index=1)
        return f
    f1 = fit('MECHANIX PRO', int(h * 4 * .26)); f2 = fit('24x7 HELP', int(h * 4 * .40))
    d.text((w * 2, int(h * 4 * .31)), 'MECHANIX PRO', font=f1, fill=(255, 255, 255, 255), anchor='mm')
    d.text((w * 2, int(h * 4 * .70)), '24x7 HELP', font=f2, fill=(255, 200, 87, 255), anchor='mm')
    p = p.resize((w, h), Image.LANCZOS); base = im.convert('RGBA'); base.alpha_composite(p, (x0, y0)); return base
STORIES = {'roadside-rain': (0, 398, 64, 436), 'repair-check': (106, 316, 200, 350), 'clear-quote': (272, 362, 326, 396), 'full-service': (272, 295, 336, 322)}
for n, box in STORIES.items():
    src = os.path.join(ROOT, f'assets/img/stories/{n}.webp')
    if not os.path.exists(src): continue  # the site already uses the finished -p file
    im = Image.open(src)
    plate(im, box).convert('RGB').save(os.path.join(ROOT, f'assets/img/stories/{n}-p.webp'), quality=84, method=6)
for n in ('doorstep-service', 'doorstep-trust'):  # no plate visible: same picture under the new name so every card follows one naming rule
    if os.path.exists(os.path.join(ROOT, f'assets/img/stories/{n}.webp')): Image.open(os.path.join(ROOT, f'assets/img/stories/{n}.webp')).save(os.path.join(ROOT, f'assets/img/stories/{n}-p.webp'), quality=84, method=6)
print('done')
