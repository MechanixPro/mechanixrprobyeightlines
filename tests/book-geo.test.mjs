import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const read = (p) => readFileSync(new URL('../' + p, import.meta.url), 'utf8');

test('"Add my location" fills the PIN code and area from the site\'s own PIN outlines and links the map', () => {
  const js = read('assets/js/book-pay.js');
  assert.match(js, /MXP_PIN_GEO/); assert.match(js, /MXP_PINS/);
  assert.match(js, /pinEl\.value = best/); assert.match(js, /areaEl\.value = names\[best\]/);
  assert.match(js, /google\.com\/maps\?q=/);
  assert.match(js, /err\.code === 1/, 'a blocked location gets its own message');
});

test('the PIN lookup picks the right PIN for known Bengaluru points and refuses far-away points', () => {
  const g = globalThis; const keep = g.window; g.window = {};
  const req = createRequire(import.meta.url);
  req('../assets/js/pingeo.js'); req('../assets/js/pincodes.js');
  const geo = g.window.MXP_PIN_GEO, names = g.window.MXP_PINS; g.window = keep;
  const find = (lat, lng) => { let best = '', bd = Infinity; for (const pin of Object.keys(geo)) { const q = geo[pin], inside = lat >= q[2] && lat <= q[3] && lng >= q[4] && lng <= q[5]; let d = (lat - q[0]) ** 2 + (lng - q[1]) ** 2; if (inside) d -= 1; if (d < bd) { bd = d; best = pin; } } return { best, ok: bd < 0.0016 }; };
  assert.deepEqual(find(12.9116, 77.6389), { best: '560102', ok: true });
  assert.equal(names['560102'], 'HSR Layout');
  assert.equal(find(12.2958, 76.6394).ok, false);
});

test('book-start puts a map link in the lead note when the customer shared a location', () => {
  assert.match(read('supabase/functions/book-start/index.ts'), /Map: https:\/\/www\.google\.com\/maps\?q=\$\{extra\.lat\},\$\{extra\.lng\}/);
});
