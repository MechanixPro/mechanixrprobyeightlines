#!/bin/sh
# Builds the Mechanix CRM (Sales and Support desk) for its own Cloudflare Pages project (crm.mechanixpro.in).
# Cloudflare Pages (crm project): Build command  sh scripts/build_crm.sh   Output directory  dist-crm
set -e
root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/dist-crm"
rm -rf "$out"; mkdir -p "$out/assets/js" "$out/assets/img"
cp -R "$root/crm" "$out/crm"
cp "$root/assets/js/config.js" "$out/assets/js/"
cp "$root/assets/img/logo.svg" "$root/assets/img/favicon-32.png" "$root/assets/img/apple-touch-icon.png" "$out/assets/img/"
cat > "$out/index.html" <<'I'
<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/crm/"><title>Mechanix Desk</title><a href="/crm/">Open the desk</a>
I
cat > "$out/_redirects" <<'R'
/ /crm/ 302
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
  Content-Security-Policy: default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' https://*.supabase.co wss://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
H
echo "CRM built in dist-crm/"
