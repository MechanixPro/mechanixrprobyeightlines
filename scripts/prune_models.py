"""Removes model photos that were checked by eye and rejected. Usage: python3 scripts/prune_models.py slug [slug ...]
Deletes the WebP, drops it from src/model-photos.json and rewrites assets/js/model-photos.js."""
import json, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
jp = os.path.join(ROOT, 'src', 'model-photos.json')
credits = json.load(open(jp, encoding='utf-8'))
for slug in sys.argv[1:]:
    f = os.path.join(ROOT, 'assets', 'img', 'models', slug + '.webp')
    if os.path.exists(f): os.remove(f)
    credits.pop(slug, None)
json.dump(credits, open(jp, 'w'), indent=1, ensure_ascii=False)
open(os.path.join(ROOT, 'assets', 'js', 'model-photos.js'), 'w').write('/* Models that have a photo in assets/img/models/. Written by scripts/fetch_models.py. */\nwindow.MXP_MODEL_PHOTOS = ' + json.dumps({k: 1 for k in credits}) + ';\n')
print(len(credits), 'photos kept')
