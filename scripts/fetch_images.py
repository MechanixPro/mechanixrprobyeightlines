"""Downloads the freely licensed bike and part photos used on the site from Wikimedia Commons,
converts them to WebP and writes src/credits.json (author + licence + source) for the /credits/ page.
Run: python3 scripts/fetch_images.py   (needs `cwebp`).  Only CC0, public domain, CC BY and CC BY-SA files are listed here."""
import json, os, re, subprocess, tempfile, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'img', 'photos')
UA = {'User-Agent': 'MechanixProSite/1.0 (info@ziyam.in)'}
OK = ('CC0', 'Public domain', 'CC BY', 'CC BY-SA')
# slug -> (Commons file title, caption)
PHOTOS = {
  'bike-activa': ('File:Honda Activa Rental- Goa 1.jpg', 'Honda Activa'),
  'bike-splendor': ('File:Hero Splendor+, Bangalore (2025).jpg', 'Hero Splendor+'),
  'bike-pulsar': ('File:BAJAJ Pulsar NS160.jpg', 'Bajaj Pulsar NS160'),
  'bike-jupiter': ('File:TVS Jupiter Scooter.jpg', 'TVS Jupiter'),
  'bike-classic': ('File:Royal Enfield Classic 350 (2017 Model Year).jpg', 'Royal Enfield Classic 350'),
  'bike-access': ('File:Suzuki Access 125.jpg', 'Suzuki Access 125'),
  'bike-duke': ('File:KTM DUKE 200.jpg', 'KTM Duke 200'),
  'part-oilfilter': ('File:New motorcycle oil filter Hiflo Filtro.jpg', 'Oil filter'),
  'part-sparkplug': ('File:Spark-plug01.jpeg', 'Spark plug'),
  'part-tyre': ('File:Motorcycle tyre stack.jpg', 'Tyres'),
  'part-airfilter': ('File:Filtro aria a coppa.jpg', 'Air filter'),
  'part-brake': ('File:Brembo Disc brake.jpg', 'Brake disc and caliper'),
}
def api(title):
    u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({'action': 'query', 'format': 'json', 'titles': title, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 900})
    r = json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA)))
    return next(iter(r['query']['pages'].values()))['imageinfo'][0]
credits = []
for slug, (title, caption) in PHOTOS.items():
    ii = api(title); m = ii['extmetadata']
    lic = m.get('LicenseShortName', {}).get('value', '')
    if not any(lic.startswith(o) for o in OK) or 'NC' in lic or 'ND' in lic:
        raise SystemExit(f'{title}: licence {lic!r} not allowed')
    artist = re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', m.get('Artist', {}).get('value', 'Unknown'))).strip()
    data = urllib.request.urlopen(urllib.request.Request(ii['thumburl'], headers=UA)).read()
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f: f.write(data); tmp = f.name
    subprocess.run(['cwebp', '-q', '76', '-resize', '800', '0', tmp, '-o', os.path.join(OUT, slug + '.webp')], check=True, capture_output=True)
    os.unlink(tmp)
    credits.append({'slug': slug, 'caption': caption, 'title': title.replace('File:', ''), 'author': artist[:80], 'license': lic, 'license_url': m.get('LicenseUrl', {}).get('value', ''), 'source': ii['descriptionurl']})
    print('ok', slug, lic, '|', artist[:40])
json.dump(credits, open(os.path.join(ROOT, 'src', 'credits.json'), 'w'), indent=1, ensure_ascii=False)
