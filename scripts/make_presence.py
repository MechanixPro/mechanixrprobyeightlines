#!/usr/bin/env python3
"""Makes the share cards (one per key page) and the Instagram and Google Business image pack in the bold navy and ember style.
Needs Pillow. Uses the macOS Helvetica Neue font. Run: python3 scripts/make_presence.py
Share cards go to assets/img/og/ (published). The social pack goes to brand-src/presence/ (not published)."""
import os
from PIL import Image, ImageDraw, ImageFont
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NAVY, EMBER, GOLD, INK, SOFT = (20, 41, 90), (242, 128, 31), (255, 200, 87), (31, 18, 6), (225, 232, 248)
FONT = '/System/Library/Fonts/HelveticaNeue.ttc'
def F(sz, bold=True): return ImageFont.truetype(FONT, sz, index=1 if bold else 0)
mark = Image.open(os.path.join(ROOT, 'assets/img/logo-mark.png')).convert('RGBA')
def paste_mark(img, size, xy, card=True, pad=22):
    d = ImageDraw.Draw(img)
    if card: d.rounded_rectangle((xy[0] - pad, xy[1] - pad, xy[0] + size + pad, xy[1] + int(size * mark.size[1] / mark.size[0]) + pad), radius=int(size * .22), fill='white')
    m = mark.resize((size, int(size * mark.size[1] / mark.size[0])), Image.LANCZOS); img.paste(m, xy, m)
def wrap(d, text, font, width):
    words, lines, cur = text.split(), [], ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=font) <= width: cur = t
        else: lines.append(cur); cur = w
    return lines + [cur]

def share_card(path, kicker, headline, sub):
    W, H = 1200, 630; img = Image.new('RGB', (W, H), EMBER); d = ImageDraw.Draw(img)
    d.polygon([(560, 0), (W, 0), (W, H), (430, H)], fill=NAVY); d.polygon([(560, 0), (600, 0), (470, H), (430, H)], fill=GOLD)
    paste_mark(img, 270, (105, 190 - 0)); 
    x, maxw = 650, 500
    d.text((x, 70), kicker.upper(), font=F(28), fill=GOLD)
    size = 70
    while True:
        lines = wrap(d, headline, F(size), maxw)
        if len(lines) <= 3 and size >= 44 or size <= 44: break
        size -= 4
    y = 120
    for ln in lines: d.text((x, y), ln, font=F(size), fill='white'); y += int(size * 1.1)
    y += 22
    for ln in wrap(d, sub, F(30, False), maxw)[:3]: d.text((x, y), ln, font=F(30, False), fill=SOFT); y += 40
    d.rounded_rectangle((x, 520, x + 230, 580), radius=30, fill=EMBER); d.text((x + 115, 550), 'Open 24/7', font=F(30), fill=INK, anchor='mm')
    d.text((x + 255, 550), 'mechanixpro.in', font=F(26, False), fill=SOFT, anchor='lm')
    os.makedirs(os.path.dirname(path), exist_ok=True); img.save(path, 'JPEG', quality=86, optimize=True)

CARDS = {
  'services': ('Services and prices', 'Clear prices, quote first', 'Bike and scooter service at your door in Bengaluru. Pay after you say yes.'),
  'roadside': ('Roadside help', 'Broken down? We come to you.', 'Puncture, battery or breakdown. Share your location on WhatsApp.'),
  'join': ('Garages and mechanics', 'Join the Mechanix Pro network', 'Apply in two minutes. Our team calls you.'),
  'axlio': ('Our partner Axlio', 'Car and bike spare parts, delivered', 'Parts, service kits and car help in Bengaluru.'),
  'diwali': ('Diwali special', 'Get your bike Diwali-ready', 'A mechanic checks your bike at your door before the festive rides.'),
  'areas': ('Coverage', 'All of Bengaluru, checked in a second', 'Every PIN from 560001 to 560110. Type yours and see.'),
  'how': ('How it works', 'Message, quote, approve, done', 'We send a quote on WhatsApp first. Work starts after you say yes.'),
}
for k, (a, b, c) in CARDS.items(): share_card(os.path.join(ROOT, f'assets/img/og/{k}.jpg'), a, b, c)

# ---- Social pack (not published) ----
PACK = os.path.join(ROOT, 'brand-src/presence'); os.makedirs(PACK, exist_ok=True)
def profile(size, path):
    img = Image.new('RGB', (size, size), EMBER); ImageDraw.Draw(img).ellipse((size * .06, size * .06, size * .94, size * .94), fill='white')
    m = mark.resize((int(size * .56), int(size * .56 * mark.size[1] / mark.size[0])), Image.LANCZOS); img.paste(m, ((size - m.size[0]) // 2, (size - m.size[1]) // 2), m); img.save(path, quality=92)
profile(1080, os.path.join(PACK, 'instagram-profile-1080.jpg')); profile(720, os.path.join(PACK, 'google-business-logo-720.jpg'))
def highlight(label, path):
    W, H = 1080, 1920; img = Image.new('RGB', (W, H), NAVY); d = ImageDraw.Draw(img)
    d.ellipse((140, 560, 940, 1360), fill=EMBER); d.ellipse((190, 610, 890, 1310), fill='white')
    m = mark.resize((380, int(380 * mark.size[1] / mark.size[0])), Image.LANCZOS); img.paste(m, ((W - 380) // 2, 960 - m.size[1] // 2), m)
    d.text((W // 2, 1480), label.upper(), font=F(78), fill='white', anchor='mm'); d.rectangle((W // 2 - 60, 1550, W // 2 + 60, 1562), fill=GOLD); img.save(path, quality=92)
for lbl in ('Services', 'Roadside', 'How it works', 'Prices', 'Reviews', 'Join us'): highlight(lbl, os.path.join(PACK, 'highlight-' + lbl.lower().replace(' ', '-') + '.jpg'))
def post(story, title, sub, path):
    W, H = 1080, 1350; img = Image.new('RGB', (W, H), NAVY); d = ImageDraw.Draw(img)
    pic = Image.open(os.path.join(ROOT, f'assets/img/stories/{story}-p.webp')).convert('RGB'); pic = pic.resize((W, int(W * pic.size[1] / pic.size[0])), Image.LANCZOS)
    img.paste(pic.crop((0, 0, W, 900)), (0, 0)); d.rectangle((0, 900, W, H), fill=NAVY); d.rectangle((0, 900, W, 914), fill=EMBER)
    tl = wrap(d, title, F(66), W - 120)[:2]
    for i, ln in enumerate(tl): d.text((60, 945 + i * 72), ln, font=F(66), fill='white')
    for i, ln in enumerate(wrap(d, sub, F(34, False), W - 120)[:2]): d.text((60, 945 + len(tl) * 72 + 14 + i * 44), ln, font=F(34, False), fill=SOFT)
    d.rounded_rectangle((60, 1210, 360, 1280), radius=35, fill=EMBER); d.text((210, 1245), 'Open 24/7', font=F(34), fill=INK, anchor='mm'); d.text((390, 1245), 'mechanixpro.in', font=F(32, False), fill=SOFT, anchor='lm'); img.save(path, quality=92)
post('roadside-rain', 'Broken down? We come to you.', 'Share your location on WhatsApp. Puncture, battery or breakdown.', os.path.join(PACK, 'post-roadside.jpg'))
post('clear-quote', 'A clear quote, before any work.', 'Review it on WhatsApp. Approve when you are ready.', os.path.join(PACK, 'post-quote.jpg'))
post('doorstep-service', 'Bike service at your door.', 'Oil check, chain lube, brake adjust and a wash. Bengaluru.', os.path.join(PACK, 'post-doorstep.jpg'))
cover = Image.new('RGB', (1080, 608), NAVY); d = ImageDraw.Draw(cover); d.polygon([(0, 0), (520, 0), (380, 608), (0, 608)], fill=EMBER); paste_mark(cover, 230, (110, 150))
d.text((560, 190), 'Mechanix Pro', font=F(66), fill='white'); d.text((560, 275), 'Bike service at your door', font=F(32, False), fill=SOFT); d.text((560, 320), 'Roadside help 24/7, Bengaluru', font=F(32, False), fill=SOFT); cover.save(os.path.join(PACK, 'google-business-cover-1080x608.jpg'), quality=92)
print('done')
