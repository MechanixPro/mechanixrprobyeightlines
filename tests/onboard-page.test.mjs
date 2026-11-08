// /onboard/ page (partner KYC): source-pattern checks. Server contract is in supabase/functions/partner-onboard.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const html = read('onboard/index.html'), js = read('assets/js/onboard.js');

test('onboard page is noindex and has no inline script', () => {
  assert.match(html, /<meta name="robots" content="noindex,nofollow/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/);
  assert.match(html, /\/assets\/js\/onboard\.js/);
});
test('onboard is not in the sitemap and is built into the site', () => {
  assert.doesNotMatch(read('sitemap.xml'), /onboard/);
  assert.match(read('scripts/build_site.sh'), /for d in [^;]*\bonboard\b/);
});
test('camera capture, PDF-only agreement and no blob: previews', () => {
  assert.match(js, /capture/); assert.match(js, /'environment'/);
  assert.match(js, /readAsDataURL/); assert.doesNotMatch(js, /createObjectURL/);
  assert.match(js, /signed_agreement/); assert.match(js, /application\/pdf/);
});
test('link token is kept in sessionStorage and removed from the address bar', () => {
  assert.match(js, /sessionStorage\.setItem/); assert.match(js, /replaceState\(null, '', '\/onboard\/'\)/);
  assert.match(js, /\[a-f0-9\]\{64\}/);
});
test('calls the partner-onboard function with the four actions', () => {
  assert.match(js, /functions\/v1\/partner-onboard/);
  for (const a of ['me', 'upload_url', 'doc_done', 'submit']) assert.match(js, new RegExp("'" + a + "'"));
  assert.match(js, /method: 'PUT'/);
});
test('agreement PDF exists and is linked', () => {
  const p = new URL('../assets/legal/Mechanix-Pro-Garage-Partner-Agreement.pdf', import.meta.url);
  assert.ok(existsSync(p) && statSync(p).size > 1000);
  assert.match(js, /\/assets\/legal\/Mechanix-Pro-Garage-Partner-Agreement\.pdf/);
});

test('mechanics also get their agreement PDF to download', () => {
  assert.ok(statSync(new URL('../assets/legal/Mechanix-Pro-Mechanic-Engagement-Terms.pdf', import.meta.url)).size > 10000);
  assert.match(readFileSync(new URL('../assets/js/onboard.js', import.meta.url), 'utf8'), /Mechanix-Pro-Mechanic-Engagement-Terms\.pdf/);
});
