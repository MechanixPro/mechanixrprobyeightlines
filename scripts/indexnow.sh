#!/bin/sh
# Tells Bing (and other IndexNow search engines) which public pages changed. Public URLs only; nothing private is sent.
#   sh scripts/indexnow.sh                 submit every URL in sitemap.xml
#   sh scripts/indexnow.sh <url> [<url>]   submit just these
set -e
cd "$(dirname "$0")/.."
python3 - "$@" <<'PY'
import json, re, sys, urllib.request
KEY = "0283f8d107f97af9cb796f264b45b494"
urls = sys.argv[1:] or re.findall(r'<loc>([^<]*)</loc>', open('sitemap.xml', encoding='utf-8').read())
body = json.dumps({"host": "mechanixpro.in", "key": KEY, "keyLocation": f"https://mechanixpro.in/{KEY}.txt", "urlList": urls[:10000]}).encode()
req = urllib.request.Request('https://api.indexnow.org/IndexNow', data=body, headers={'Content-Type': 'application/json; charset=utf-8'})
try: print('IndexNow answered', urllib.request.urlopen(req, timeout=30).status, f'for {len(urls)} URLs (200 or 202 means accepted)')
except Exception as e: print('IndexNow failed:', e); sys.exit(1)
PY
