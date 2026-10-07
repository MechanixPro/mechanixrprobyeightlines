#!/bin/sh
# Converts one of your own photos to a web-ready WebP in assets/img/photos/.
# Usage: scripts/add_photo.sh <name> <path-to-photo>     e.g.  scripts/add_photo.sh mechanic-at-doorstep ~/Pictures/IMG_1234.HEIC
# Works with JPG, PNG and iPhone HEIC. Output is max 1600px wide, WebP, about 150 KB.
set -e
name="$1"; src="$2"
[ -n "$name" ] && [ -f "$src" ] || { echo "usage: add_photo.sh <name> <photo-file>"; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"; mkdir -p "$root/assets/img/photos"
tmp="$(mktemp -d)/p.png"
sips -Z 1600 -s format png "$src" --out "$tmp" >/dev/null
cwebp -q 78 "$tmp" -o "$root/assets/img/photos/$name.webp" >/dev/null 2>&1
echo "Saved assets/img/photos/$name.webp"
