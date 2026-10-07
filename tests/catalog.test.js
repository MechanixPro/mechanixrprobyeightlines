const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {}; require('../assets/js/bikes.js');
const L = require('../assets/js/logic.js');
const B = global.window.MXP_BIKES;
const brands = Object.keys(B).filter((b) => b !== 'Other');
const all = brands.flatMap((b) => B[b].map((r) => [b, r]));

test('the catalogue covers the brands sold and serviced in Bengaluru', () => {
  for (const b of ['Honda', 'Hero', 'TVS', 'Bajaj', 'Royal Enfield', 'Yamaha', 'Suzuki', 'KTM', 'Kawasaki', 'Triumph', 'Harley-Davidson', 'BMW Motorrad', 'Ducati', 'Benelli', 'Husqvarna', 'Aprilia', 'Vespa', 'Mahindra', 'Jawa / Yezdi', 'Ather', 'Ola Electric', 'Revolt', 'Ampere', 'Okinawa', 'Pure EV', 'Simple Energy', 'Kinetic', 'BGauss']) assert.ok(B[b] && B[b].length >= 2, b);
  assert.ok(B['Other'] && B['Other'].length === 0);
});
test('the catalogue lists at least 350 models, and the big six have deep lists', () => {
  assert.ok(all.length >= 350, 'models: ' + all.length);
  for (const [b, n] of [['Honda', 30], ['Hero', 30], ['TVS', 22], ['Bajaj', 28], ['Royal Enfield', 16], ['Yamaha', 18]]) assert.ok(B[b].length >= n, b + ' has ' + B[b].length);
});
test('models that riders still bring in for service are listed (older bikes too)', () => {
  const has = (b, n) => B[b].some((r) => r[0].toLowerCase() === n.toLowerCase());
  for (const [b, n] of [['Hero', 'CBZ'], ['Hero', 'Splendor Plus'], ['Honda', 'Activa 5G'], ['Honda', 'Unicorn'], ['Bajaj', 'Discover 125'], ['Bajaj', 'Boxer'], ['Bajaj', 'Pulsar 220F'], ['TVS', 'XL100'], ['TVS', 'Victor'], ['Yamaha', 'RX 100'], ['Yamaha', 'Fascino 125'], ['Suzuki', 'Zeus'], ['Royal Enfield', 'Thunderbird 350'], ['Royal Enfield', 'Classic 500'], ['Mahindra', 'Mojo'], ['Kawasaki', 'Ninja 300']]) assert.ok(has(b, n), b + ' ' + n);
});
test('model names are unique inside each brand and photo slugs are unique across the site', () => {
  const slugs = new Set();
  for (const [b, r] of all) { const s = L.modelSlug(b, r[0]); assert.ok(!slugs.has(s), 'duplicate slug ' + s); slugs.add(s); }
});
test('every electric-only brand lists only electric models', () => {
  for (const b of ['Ather', 'Ola Electric', 'Revolt', 'Ampere', 'Okinawa', 'Pure EV', 'Simple Energy', 'BGauss']) assert.ok(B[b].every((r) => r[1] === 'e'), b);
});
test('modelSlug builds a stable file-name slug', () => {
  assert.equal(L.modelSlug('Honda', 'Activa 6G'), 'honda-activa-6g');
  assert.equal(L.modelSlug('Jawa / Yezdi', 'Jawa 42'), 'jawa-yezdi-jawa-42');
  assert.equal(L.modelSlug('Honda', 'H’ness CB350'), 'honda-h-ness-cb350');
});
test('the picture for a model is its photo when there is one, otherwise the drawing for its style', () => {
  assert.equal(L.tileImage('Honda', ['Activa 6G', 's', 0], { 'honda-activa-6g': 1 }), '/assets/img/models/honda-activa-6g.webp');
  assert.equal(L.tileImage('Honda', ['Activa 6G', 's', 0], {}), '/assets/img/tile-scooter.svg');
  assert.equal(L.tileImage('Honda', ['Activa 6G', 's', 0]), '/assets/img/tile-scooter.svg');
});
test('big bikes from the premium makers are classed for the right style tile', () => {
  assert.equal(L.styleOf('Harley-Davidson', ['Fat Boy', 'm', 1]), 'cruiser');
  assert.equal(L.styleOf('Triumph', ['Speed 400', 'm', 0]), 'sports');
  assert.equal(L.styleOf('Triumph', ['Bonneville T100', 'm', 1]), 'cruiser');
  assert.equal(L.styleOf('Kawasaki', ['Ninja 300', 'm', 1]), 'sports');
  assert.equal(L.styleOf('Hero', ['CBZ', 'm', 0]), 'sports');
  assert.equal(L.styleOf('TVS', ['XL100', 'm', 0]), 'commuter');
  assert.equal(L.styleOf('Benelli', ['Imperiale 400', 'm', 1]), 'cruiser');
});

test('long model lists get a search box in the picker', () => {
  const app = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'assets/js/app.js'), 'utf8');
  assert.match(app, /id="mfilter"/);
  assert.match(app, /list\.length > 12/);
  assert.match(app, /MXP_MODEL_PHOTOS/);
});
