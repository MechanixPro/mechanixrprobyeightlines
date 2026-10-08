"""Builds the website logo files from the client's logo artwork (brand-src/logo-original.png).
Removes the plain background, drops the "An 8-Lines Group Company" line, and writes transparent PNG/WebP files.
Run: python3 scripts/make_logo.py"""
import base64, io, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
SRC = os.path.join(ROOT, 'brand-src', 'logo-original.png')
OUT = os.path.join(ROOT, 'assets', 'img')
NAVY = np.array([20, 41, 90], dtype=float)

im = Image.open(SRC).convert('RGB')
W, H = im.size
im = im.crop((0, 0, W, int(H * 0.915)))           # everything above the "8-Lines Group" line
W, H = im.size
a = np.asarray(im).astype(float)
bg = np.median(np.concatenate([a[:6, :6].reshape(-1, 3), a[:6, -6:].reshape(-1, 3)]), axis=0)
dist = np.abs(a - bg).max(axis=2)

# Row where the shield ends and the wordmark begins: first fully-background row after the shield.
rows_ink = (dist > 60).sum(axis=1)
y = int(H * 0.40)
while y < H and rows_ink[y] > 0: y += 1
split = y + (int(H * 0.012))                       # a blank band separates mark and text
mark_end = y

# 1) Mark: flood the outside background so the white wrench stays solid.
probe = Image.fromarray(a.astype('uint8'))
ImageDraw.floodfill(probe, (0, 0), (255, 0, 255), thresh=34)
pa = np.asarray(probe).astype(int)
outside = (pa[..., 0] == 255) & (pa[..., 1] == 0) & (pa[..., 2] == 255)
ring = np.asarray(Image.fromarray((outside * 255).astype('uint8')).filter(ImageFilter.MaxFilter(7))) > 0
alpha = np.where(outside, 0.0, 1.0)
edge = ring & ~outside
ramp = np.clip((dist - 18) / 110.0, 0, 1)
alpha = np.where(edge, ramp, alpha)
rgb = a.copy()
safe = np.maximum(alpha, 0.05)[..., None]
unm = (a - (1 - alpha)[..., None] * bg) / safe
rgb = np.where(edge[..., None], np.clip(unm, 0, 255), rgb)

# 2) Wordmark and tagline: solid brand navy with smooth edges from how dark each pixel is.
lum = a.mean(axis=2); bgl = bg.mean(); navl = NAVY.mean()
t_alpha = np.clip((bgl - lum) / (bgl - navl), 0, 1)
t_alpha = np.where(t_alpha < 0.10, 0.0, np.clip((t_alpha - 0.10) / 0.80, 0, 1))
text_rows = np.arange(H)[:, None] >= split
alpha = np.where(text_rows, t_alpha, alpha)
rgb = np.where(text_rows[..., None], NAVY, rgb)

out = np.dstack([np.clip(rgb, 0, 255), alpha * 255]).astype('uint8')
full = Image.fromarray(out)
full = full.crop(full.getbbox())
mark = Image.fromarray(out[:mark_end, :, :]); mark = mark.crop(mark.getbbox())

# The "MECHANIX PRO" line on its own, for the header and footer next to the shield.
ta = out[:, :, 3] > 0
r = split
while r < H and not ta[r].any(): r += 1
r0 = r
while r < H and ta[r].any(): r += 1
word = Image.fromarray(out[r0:r, :, :]); word = word.crop(word.getbbox())
while r < H and not ta[r].any(): r += 1
t0 = r
while r < H and ta[r].any(): r += 1
tag = Image.fromarray(out[t0:r, :, :]); tag = tag.crop(tag.getbbox())

def fit(img, w):
    return img.resize((w, round(img.height * w / img.width)), Image.LANCZOS)
def pad(img, p):
    c = Image.new('RGBA', (img.width + 2 * p, img.height + 2 * p), (0, 0, 0, 0)); c.paste(img, (p, p)); return c
def save(img, name):
    img.save(os.path.join(OUT, name + '.png'), optimize=True)
    img.save(os.path.join(OUT, name + '.webp'), quality=92, method=6)

save(fit(full, 1000), 'logo-full')
save(fit(mark, 400), 'logo-mark')
save(fit(word, 640), 'logo-wordmark')
save(fit(tag, 640), 'logo-tagline')

# Email header logo (PNG, because email apps do not show WebP or SVG).
em = fit(mark, 160); em.quantize(256, method=Image.FASTOCTREE).save(os.path.join(OUT, 'email-logo.png'), optimize=True)

em2 = fit(word, 340); em2.quantize(256, method=Image.FASTOCTREE).save(os.path.join(OUT, 'email-wordmark.png'), optimize=True)

# Square icons on white, with room around the shield.
def square(size, fill=(255, 255, 255, 255), inner=0.70):
    c = Image.new('RGBA', (size, size), fill)
    m = fit(mark, int(size * inner * mark.width / max(mark.width, mark.height)))
    if m.height > size * inner: m = m.resize((round(m.width * size * inner / m.height), int(size * inner)), Image.LANCZOS)
    c.paste(m, ((size - m.width) // 2, (size - m.height) // 2), m); return c
square(512).convert('RGB').save(os.path.join(OUT, 'icon-512.png'), optimize=True)
square(192).convert('RGB').save(os.path.join(OUT, 'icon-192.png'), optimize=True)
square(180, inner=0.74).convert('RGB').save(os.path.join(OUT, 'apple-touch-icon.png'), optimize=True)
fit(pad(mark, 2), 32).save(os.path.join(OUT, 'favicon-32.png'), optimize=True) if False else None
sq = Image.new('RGBA', (32, 32), (0, 0, 0, 0)); fm = fit(mark, 28)
if fm.height > 30: fm = fm.resize((round(fm.width * 30 / fm.height), 30), Image.LANCZOS)
sq.paste(fm, ((32 - fm.width) // 2, (32 - fm.height) // 2), fm); sq.save(os.path.join(OUT, 'favicon-32.png'), optimize=True)

# logo.svg keeps its old name so every page, the service worker and the admin keep working: it wraps the exact artwork.
m256 = fit(mark, 200); buf = io.BytesIO(); m256.quantize(256, method=Image.FASTOCTREE).save(buf, 'PNG', optimize=True)
b64 = base64.b64encode(buf.getvalue()).decode()
open(os.path.join(OUT, 'logo.svg'), 'w').write(
    f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {m256.width} {m256.height}" role="img" aria-label="Mechanix Pro">'
    f'<image width="{m256.width}" height="{m256.height}" xlink:href="data:image/png;base64,{b64}"/></svg>\n')
print('mark', mark.size, 'full', full.size, 'svg bytes', os.path.getsize(os.path.join(OUT, 'logo.svg')))

og = Image.new('RGB', (1200, 630), (255, 255, 255)); f = full.copy(); f.thumbnail((900, 520), Image.LANCZOS)
og.paste(f, ((1200 - f.width) // 2, (630 - f.height) // 2), f); og.save(os.path.join(OUT, 'og.png'), optimize=True)

# favicon.ico for browsers that ask for /favicon.ico directly.
ico = Image.new('RGBA', (64, 64), (0, 0, 0, 0)); im2 = fit(mark, 58)
if im2.height > 62: im2 = im2.resize((round(im2.width * 62 / im2.height), 62), Image.LANCZOS)
ico.paste(im2, ((64 - im2.width) // 2, (64 - im2.height) // 2), im2)
ico.save(os.path.join(ROOT, 'favicon.ico'), sizes=[(16, 16), (32, 32), (48, 48), (64, 64)])
