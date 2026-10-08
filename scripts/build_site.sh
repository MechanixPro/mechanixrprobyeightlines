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
cp index.html 404.html offline.html sw.js manifest.webmanifest robots.txt sitemap.xml _headers _redirects "$out/"
cp -R assets "$out/assets"
for d in book services help contact terms privacy refund-policy credits unsubscribe bike-service-*; do [ -d "$d" ] && cp -R "$d" "$out/$d"; done
echo "Site built in dist-site/ ($(find "$out" -type f | wc -l | tr -d ' ') files)"
