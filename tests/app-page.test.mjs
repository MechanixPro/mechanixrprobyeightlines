import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
test('/app/ page: honest install instructions, no store claim, no inline script', () => {
  const h = read('app/index.html');
  assert.match(h, /<h1[^>]*>Mechanix Pro on your phone\./);
  assert.match(h, /Add to Home Screen/); assert.match(h, /href="\/join\/"/); assert.match(h, /href="\/book\/"/);
  assert.doesNotMatch(h, /Google Play|App Store|play\.google|apps\.apple/i);
  assert.doesNotMatch(h, /<script(?![^>]*(?:\bsrc=|ld\+json))[^>]*>[\s\S]*?<\/script>/, 'no inline script');
  assert.ok(existsSync(new URL('../assets/js/app-page.js', import.meta.url)));
  assert.match(read('sitemap.xml'), /\/app\//);
});
