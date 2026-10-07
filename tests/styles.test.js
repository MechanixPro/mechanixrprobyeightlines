const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
global.window = {}; require('../assets/js/bikes.js');
const L = require('../assets/js/logic.js');
const B = global.window.MXP_BIKES;
const STYLES = ['commuter', 'sports', 'cruiser', 'scooter', 'electric'];

test('scooters, electric bikes and cruisers are classified from their type and brand', () => {
  assert.equal(L.styleOf('Honda', ['Activa 6G', 's', 0]), 'scooter');
  assert.equal(L.styleOf('Ather', ['450X', 'e', 0]), 'electric');
  assert.equal(L.styleOf('Royal Enfield', ['Classic 350', 'm', 1]), 'cruiser');
  assert.equal(L.styleOf('Jawa / Yezdi', ['Jawa 42', 'm', 1]), 'cruiser');
  assert.equal(L.styleOf('Bajaj', ['Avenger Cruise 220', 'm', 1]), 'cruiser');
});
test('sporty names are sports and plain commuters are commuters', () => {
  for (const [b, n] of [['Bajaj', 'Pulsar N160'], ['TVS', 'Apache RTR 160'], ['Yamaha', 'R15'], ['KTM', 'Duke 200'], ['Suzuki', 'Gixxer'], ['Hero', 'Xtreme 160R']]) assert.equal(L.styleOf(b, [n, 'm', 0]), 'sports', n);
  for (const [b, n] of [['Hero', 'Splendor Plus'], ['Honda', 'Shine 125'], ['Bajaj', 'Platina 110'], ['TVS', 'Radeon'], ['Hero', 'HF Deluxe']]) assert.equal(L.styleOf(b, [n, 'm', 0]), 'commuter', n);
});
test('every listed model gets one of the five styles', () => {
  for (const [brand, rows] of Object.entries(B)) for (const row of rows) assert.ok(STYLES.includes(L.styleOf(brand, row)), brand + ' ' + row[0]);
});
test('every style has a tile image on disk', () => {
  for (const s of STYLES) assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets/img/tile-' + s + '.svg')), s);
});
test('tileImage gives the image path for a model', () => assert.equal(L.tileImage('Honda', ['Activa 6G', 's', 0]), '/assets/img/tile-scooter.svg'));
