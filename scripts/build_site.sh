#!/bin/sh
# Builds the customer site (only public files) into dist-site/ for Cloudflare Pages.
# Cloudflare Pages (site project): Build command  sh scripts/build_site.sh   Output directory  dist-site
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist-site"
rm -rf "$out"; mkdir -p "$out"
cd "$root"
python3 scripts/sync_prices.py || echo "(price sync skipped)"
python3 scripts/build_pages.py >/dev/null
cp favicon.ico index.html 404.html offline.html sw.js manifest.webmanifest robots.txt sitemap.xml _headers _redirects "$out/"
cp -R assets "$out/assets"
for d in rate-card warranty book join partners two-wheeler-service-at-home-bangalore scooty-repair-at-home-bangalore ev-and-petrol-bike-care-bangalore verified-bike-garages-bangalore digital-service-records doorstep-bike-and-car-repair-near-me major-bike-repair-pickup-and-drop-bangalore services help contact terms privacy refund-policy credits unsubscribe track rate pay offers roadside hi kn areas coming-soon bike-service fleet societies guides bike-service-*; do [ -d "$d" ] && cp -R "$d" "$out/$d"; done
python3 scripts/cachebust.py "$out"
echo "Site built in dist-site/ ($(find "$out" -type f | wc -l | tr -d ' ') files)"
