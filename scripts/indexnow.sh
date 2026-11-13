#!/bin/sh
# Tells Bing (and other IndexNow search engines) which public pages changed. Public URLs only; nothing private is sent.
#   sh scripts/indexnow.sh                 submit every URL in sitemap.xml
#   sh scripts/indexnow.sh <url> [<url>]   submit just these
set -e
KEY="0283f8d107f97af9cb796f264b45b494"; HOST="mechanixpro.in"
cd "$(dirname "$0")/.."
if [ $# -gt 0 ]; then urls="$*"; else urls="$(grep -o '<loc>[^<]*</loc>' sitemap.xml | sed 's#</\?loc>##g')"; fi
json="$(printf '%s\n' $urls | python3 -c 'import sys,json; u=[l.strip() for l in sys.stdin if l.strip()]; print(json.dumps({"host":"SYEDs-MacBook-Air.local" if False else "mechanixpro.in","key":"0283f8d107f97af9cb796f264b45b494","keyLocation":"https://mechanixpro.in/0283f8d107f97af9cb796f264b45b494.txt","urlList":u[:10000]}))')"
code="$(curl -s -o /dev/null -w '%{http_code}' -X POST https://api.indexnow.org/IndexNow -H 'Content-Type: application/json; charset=utf-8' -d "$json")"
echo "IndexNow answered $code (200 or 202 means accepted)"
