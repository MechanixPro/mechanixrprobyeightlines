"""Downloads the free-licence part photos used on the Services page from Wikimedia Commons as WebP and writes src/part-photos.json.
Run: python3 scripts/fetch_parts.py   (needs `cwebp`). Only CC0, public domain, CC BY and CC BY-SA files are accepted."""
import json, os, re, subprocess, tempfile, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'img', 'parts')
UA = {'User-Agent': 'MechanixProSite/1.0 (hello@mechanixpro.in)'}
PARTS = {
  'part-oilfilter': ('File:New motorcycle oil filter Hiflo Filtro.jpg', 'Oil filter'),
  'part-sparkplug': ('File:Spark-plug01.jpeg', 'Spark plug'),
  'part-airfilter': ('File:Filtro aria a coppa.jpg', 'Air filter'),
  'part-brake': ('File:Brembo Disc brake.jpg', 'Brake disc and caliper'),
  'part-tyre': ('File:Motorcycle tyre stack.jpg', 'Tyres'),
}
credits = {}
for slug, (title, caption) in PARTS.items():
    u = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({'action': 'query', 'format': 'json', 'titles': title, 'prop': 'imageinfo', 'iiprop': 'url|extmetadata', 'iiurlwidth': 800})
    ii = next(iter(json.load(urllib.request.urlopen(urllib.request.Request(u, headers=UA)))['query']['pages'].values()))['imageinfo'][0]; m = ii['extmetadata']
    lic = m.get('LicenseShortName', {}).get('value', '')
    if not any(lic.startswith(o) for o in ('CC0', 'Public domain', 'CC BY', 'CC BY-SA')) or 'NC' in lic or 'ND' in lic: raise SystemExit(f'{title}: licence {lic!r} not allowed')
    data = urllib.request.urlopen(urllib.request.Request(ii['thumburl'], headers=UA)).read()
    with tempfile.NamedTemporaryFile(suffix='.jpg', delete=False) as f: f.write(data); tmp = f.name
    subprocess.run(['cwebp', '-q', '72', '-resize', '800', '0', tmp, '-o', os.path.join(OUT, slug + '.webp')], check=True, capture_output=True); os.unlink(tmp)
    artist = re.sub(r'\s+', ' ', re.sub('<[^>]+>', '', m.get('Artist', {}).get('value', 'Unknown'))).strip()[:80]
    credits[slug] = {'caption': caption, 'title': title.replace('File:', ''), 'author': artist, 'license': lic, 'license_url': m.get('LicenseUrl', {}).get('value', ''), 'source': ii['descriptionurl']}
    print('ok', slug, lic, '|', artist[:40])
json.dump(credits, open(os.path.join(ROOT, 'src', 'part-photos.json'), 'w'), indent=1, ensure_ascii=False)
