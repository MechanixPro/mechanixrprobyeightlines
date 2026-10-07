#!/bin/sh
# Swap a placeholder for a real photo.  Usage: scripts/set_photo.sh <slot> <path-to-photo>
# Slots: mechanic | inspection | handover.  Converts to WebP (1200px wide) and points index.html at it.
set -e
slot="$1"; src="$2"
case "$slot" in mechanic|inspection|handover) ;; *) echo "slot must be mechanic, inspection or handover"; exit 1;; esac
[ -f "$src" ] || { echo "photo not found: $src"; exit 1; }
root="$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)/p.png"
sips -Z 1200 -s format png "$src" --out "$tmp" >/dev/null
cwebp -q 80 "$tmp" -o "$root/assets/img/photo-$slot.webp" >/dev/null 2>&1
sed -i '' "s#/assets/img/photo-$slot\.[a-z]*#/assets/img/photo-$slot.webp#" "$root/index.html"
echo "Done: assets/img/photo-$slot.webp. Now update the alt text in index.html to describe the real photo."
