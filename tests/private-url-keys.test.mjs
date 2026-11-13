import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('tags.js removes the booking token and payment order from the address before any tag starts', () => {
  const t = read('assets/js/tags.js');
  const strip = t.indexOf("['t', 'cf_order']"), gtag = t.indexOf("googletagmanager.com/gtag/js"), pixel = t.indexOf('fbevents.js');
  assert.ok(strip > 0 && gtag > strip && pixel > strip, 'the strip runs first');
  assert.match(t, /replaceState/);
  assert.match(t, /\(track\|pay\|book\)/);
});
test('the tracking and pay pages still find the token and order after the address is cleaned', () => {
  assert.match(read('assets/js/track.js'), /mxp_priv/);
  assert.match(read('assets/js/pay.js'), /mxp_priv/);
});
