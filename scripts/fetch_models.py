"""Finds a freely licensed photo of each listed model on Wikimedia Commons, saves a small WebP and writes the credit data.
Run: python3 scripts/fetch_models.py   (needs `cwebp` and Node).  Only CC0, public domain, CC BY and CC BY-SA files are kept,
and only when the file name contains the full model name, so a photo is never shown for the wrong model."""
import json, os, re, subprocess, tempfile, time, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'img', 'models')
UA = {'User-Agent': 'MechanixProSite/1.0 (hello@mechanixpro.in)'}
OKLIC = ('CC0', 'Public domain', 'CC BY', 'CC BY-SA')
BAD = re.compile(r'engine|interior|dashboard|cluster|speedo|meter|logo|badge|emblem|headlight|headlamp|taillight|exhaust|wheel|tyre|tire|tank|seat|handle|mirror|detail|close|cutaway|showroom|dealer|brochure|advert|poster|stamp|drawing|crash|accident|police|ambulance|delivery|parade|rally|racing|race|convoy|queue|parking|traffic|scrap|burn|stolen|wreck|broken|damaged|fuel|petrol pump|garage|workshop|mechanic', re.I)
norm = lambda s: re.sub(r'[^a-z0-9]', '', s.lower())
def slug(brand, model): return re.sub(r'[^a-z0-9]+', '-', (brand + ' ' + model).lower()).strip('-')
def api(params):
    u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({'format': 'json', **params})
    for i in range(3):
        try: return json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=30))
        except Exception: time.sleep(1.5)
    return {}
def query_for(brand, model):
    b = '' if brand in ('Jawa / Yezdi', 'Other') else brand.replace('Ola Electric', 'Ola')
    return (b + ' ' + model).strip()
def find(brand, model):
    q = query_for(brand, model)
    r = api({'action': 'query', 'generator': 'search', 'gsrsearch': q + ' filetype:bitmap', 'gsrnamespace': 6, 'gsrlimit': 12, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata|size', 'iiurlwidth': 700})
    need = norm(model)
    for p in sorted((r.get('query', {}).get('pages', {}) or {}).values(), key=lambda p: p.get('index', 99)):
        t = p['title'].replace('File:', ''); ii = p['imageinfo'][0]; m = ii.get('extmetadata', {})
        lic = m.get('LicenseShortName', {}).get('value', '')
        if need not in norm(t) or BAD.search(t): continue
        if not any(lic.startswith(o) for o in OKLIC) or 'NC' in lic or 'ND' in lic: continue
        if ii['width'] < 1000 or not (1.15 <= ii['width'] / ii['height'] <= 2.0): continue
        if brand not in ('Jawa / Yezdi', 'Other') and norm(brand.split()[0]) not in norm(t) and brand not in ('Honda',) and norm(model.split()[0]) not in norm(t): continue
        return t, ii, m, lic
    return None
os.makedirs(OUT, exist_ok=True)
models = json.load(open('/tmp/models.json')); credits = {}; miss = []
for row in models:
    b, mo = row['brand'], row['model']
    if b == 'Other': continue
    hit = find(b, mo); time.sleep(0.25)
    if not hit: miss.append(f'{b} {mo}'); continue
    t, ii, m, lic = hit
    data = urllib.request.urlopen(urllib.request.Request(ii['thumburl'], headers=UA), timeout=60).read()
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f: f.write(data); tmp = f.name
    s = slug(b, mo)
    subprocess.run(['cwebp', '-q', '68', '-resize', '600', '0', tmp, '-o', os.path.join(OUT, s + '.webp')], check=True, capture_output=True); os.unlink(tmp)
    artist = re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', m.get('Artist', {}).get('value', 'Unknown'))).strip()[:80]
    credits[s] = {'brand': b, 'model': mo, 'title': t, 'author': artist, 'license': lic, 'license_url': m.get('LicenseUrl', {}).get('value', ''), 'source': ii['descriptionurl']}
    print('ok', s, lic)
json.dump(credits, open(os.path.join(ROOT, 'src', 'model-photos.json'), 'w'), indent=1, ensure_ascii=False)
open(os.path.join(ROOT, 'assets', 'js', 'model-photos.js'), 'w').write('/* Models that have a photo in assets/img/models/. Written by scripts/fetch_models.py. */\nwindow.MXP_MODEL_PHOTOS = ' + json.dumps({k: 1 for k in credits}) + ';\n')
print(len(credits), 'photos;', len(miss), 'models without one')
open('/tmp/model_miss.txt', 'w').write('\n'.join(miss))
