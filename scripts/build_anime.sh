#!/bin/sh
# Rebuilds assets/js/anime-lite.js: only animate, stagger and createTimeline from animejs, minified (about 15 KB gzipped).
# Run after changing the animejs version in package.json, then commit the output.
set -e
cd "$(cd "$(dirname "$0")/.." && pwd)"
tmp="$(mktemp -d)"
printf "import { animate, stagger, createTimeline } from 'animejs';\nwindow.MXP_ANIME = { animate: animate, stagger: stagger, createTimeline: createTimeline };\n" > "$tmp/entry.mjs"
npx esbuild "$tmp/entry.mjs" --bundle --minify --format=iife --alias:animejs=./node_modules/animejs/dist/modules/index.js --outfile=assets/js/anime-lite.js
rm -rf "$tmp"
