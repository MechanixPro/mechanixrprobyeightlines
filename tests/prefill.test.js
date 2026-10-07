const test = require('node:test');
const assert = require('node:assert/strict');
global.window = {}; require('../assets/js/bikes.js');
const L = require('../assets/js/logic.js');
const B = global.window.MXP_BIKES;

test('prefill picks a known brand and model from the link', () => {
  assert.deepEqual(L.prefillFromQuery('?brand=Honda&model=Activa%206G', B), { brand: 'Honda', model: 'Activa 6G' });
});
test('prefill accepts a brand alone', () => assert.deepEqual(L.prefillFromQuery('?brand=Hero', B), { brand: 'Hero', model: '' }));
test('prefill is case-insensitive and returns the canonical names', () => {
  assert.deepEqual(L.prefillFromQuery('?brand=royal%20enfield&model=classic%20350', B), { brand: 'Royal Enfield', model: 'Classic 350' });
});
test('prefill ignores an unknown brand and a model that is not in that brand', () => {
  assert.deepEqual(L.prefillFromQuery('?brand=Nope&model=X', B), { brand: '', model: '' });
  assert.deepEqual(L.prefillFromQuery('?brand=Honda&model=Splendor%20Plus', B), { brand: 'Honda', model: '' });
});
test('prefill ignores a model without a brand and an empty link', () => {
  assert.deepEqual(L.prefillFromQuery('?model=Activa%206G', B), { brand: '', model: '' });
  assert.deepEqual(L.prefillFromQuery('', B), { brand: '', model: '' });
});
