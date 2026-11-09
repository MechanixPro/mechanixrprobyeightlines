// Book package buttons on /services/ and the "You chose" line on /book/.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const SUPPORTED = ['basic', 'general', 'full', 'repair'];
test('every Book package link on /services/ targets a service the booking form supports', () => {
  const h = read('services/index.html');
  const links = [...h.matchAll(/class="btn btn-wa" href="\/book\/\?service=([a-z0-9]+)">Book package/g)].map((m) => m[1]);
  assert.deepEqual(links, SUPPORTED);
  for (const id of links) assert.ok(read('book/index.html').includes(`<option value="${id}">`), id);
});
test('puncture and roadside rows do not send guests to /book/ with an unsupported service', () => {
  const h = read('services/index.html');
  assert.doesNotMatch(h, /\/book\/\?service=(puncture|sos|roadside)/);
});
test('the trust line sits under each button and uses only true wording', () => {
  const h = read('services/index.html');
  const n = (h.match(/Itemised quote before work\. Nothing starts until you say yes\./g) || []).length;
  assert.equal(n, 4);
  const rows = h.slice(h.indexOf('id="priceList"'), h.indexOf('</ul>', h.indexOf('id="priceList"')));
  assert.doesNotMatch(rows, /guaranteed|100%|cheapest|instant/i);
});
test('the booking form reads the chosen package name from its own select, no inline script', () => {
  const js = read('assets/js/book-pay.js');
  assert.match(js, /getElementById\('bk-chosen'\)/); assert.match(js, /You chose '/); assert.match(js, /sel\.querySelector\('option\[value="'/);
  assert.match(read('book/index.html'), /id="bk-chosen"[^>]*hidden/);
});
