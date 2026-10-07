const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../assets/js/logic.js');
const st = (o) => Object.assign({ brand: 'Honda', model: 'Activa 6G', cc: 'std', nick: '', km: '', issues: [], note: '', service: 'general', addons: [], place: 'home', area: 'HSR Layout', slot: 'morning', name: 'Asha', phone: '9876543210', type: 's' }, o);
const ITEMS = [{ id: 'general', kind: 'service', name: 'General service', price: 1299 }];

test('the message names the coupon code only when one is entered', () => {
  assert.match(L.buildMessage(st({ coupon: 'monsoon10' }), ITEMS, {}, 'Tomorrow'), /Coupon code: MONSOON10/);
  assert.doesNotMatch(L.buildMessage(st(), ITEMS, {}, 'Tomorrow'), /Coupon code/);
  assert.doesNotMatch(L.buildMessage(st({ coupon: '   ' }), ITEMS, {}, 'Tomorrow'), /Coupon code/);
});
test('the lead carries a cleaned coupon code or null', () => {
  assert.equal(L.leadPayload(st({ coupon: ' monsoon 10 ' }), '2026-10-08').coupon_code, 'MONSOON10');
  assert.equal(L.leadPayload(st(), '2026-10-08').coupon_code, null);
});
test('cleanCoupon matches the server rules', () => {
  assert.equal(L.cleanCoupon(' a-b_c! '), 'A-B_C');
  assert.equal(L.cleanCoupon('x'.repeat(40)).length, 20);
});
