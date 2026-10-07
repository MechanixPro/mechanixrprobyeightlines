#!/bin/sh
# Builds the admin panel for its own Cloudflare Pages project at admin.mechanixpro.in.
# Cloudflare Pages (admin project): Build command  sh scripts/build_admin.sh   Output directory  dist-admin
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist-admin"
rm -rf "$out"; mkdir -p "$out/assets/js" "$out/assets/css" "$out/assets/img"
cp -R "$root/admin" "$out/admin"
cp "$root/assets/css/style.css" "$out/assets/css/"
cp "$root/assets/js/config.js" "$out/assets/js/"
cp "$root/assets/img/logo.svg" "$root/assets/img/favicon-32.png" "$root/assets/img/apple-touch-icon.png" "$out/assets/img/"
cp "$root/src/company.json" "$out/company.json"
cat > "$out/index.html" <<'I'
<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/admin/"><title>Mechanix Pro Admin</title><a href="/admin/">Open admin</a>
I
cat > "$out/_redirects" <<'R'
/ /admin/ 302
R
cat > "$out/_headers" <<'H'
/*
  X-Robots-Tag: noindex, nofollow
  Cache-Control: no-store
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Cross-Origin-Opener-Policy: same-origin
  Permissions-Policy: geolocation=(), camera=(), microphone=(), payment=()
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
H
echo "Admin built in dist-admin/"
