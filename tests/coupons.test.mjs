import test from 'node:test';
import assert from 'node:assert/strict';
import { applyCoupon, normalizeCode } from '../supabase/functions/_shared/coupons.ts';

const NOW = new Date('2026-10-10T10:00:00+05:30');
const base = { code: 'MONSOON10', kind: 'percent', value: 10, min_amount: 0, active: true, starts_on: null, ends_on: null, max_uses: null };

test('normalizeCode uppercases and keeps only letters, digits, dash and underscore', () => {
  assert.equal(normalizeCode(' monsoon 10! '), 'MONSOON10');
  assert.equal(normalizeCode('a-b_c'), 'A-B_C');
  assert.equal(normalizeCode('x'.repeat(40)).length, 20);
  assert.equal(normalizeCode(null), '');
});
test('a percent coupon takes that share off the subtotal, rounded down', () => {
  assert.deepEqual(applyCoupon(base, 1299, 0, NOW), { valid: true, discount: 129, reason: '' });
});
test('a flat coupon takes a fixed amount off but never more than the subtotal', () => {
  assert.equal(applyCoupon({ ...base, kind: 'flat', value: 200 }, 1299, 0, NOW).discount, 200);
  assert.equal(applyCoupon({ ...base, kind: 'flat', value: 500 }, 199, 0, NOW).discount, 199);
});
test('an unknown, switched-off or missing coupon is not valid', () => {
  assert.equal(applyCoupon(null, 1299, 0, NOW).valid, false);
  assert.equal(applyCoupon({ ...base, active: false }, 1299, 0, NOW).reason, 'This code is not active.');
});
test('dates: not valid before the start day or after the end day, valid on both days', () => {
  const c = { ...base, starts_on: '2026-10-10', ends_on: '2026-10-20' };
  assert.equal(applyCoupon(c, 1299, 0, new Date('2026-10-09T23:00:00+05:30')).reason, 'This code starts on 2026-10-10.');
  assert.equal(applyCoupon(c, 1299, 0, new Date('2026-10-10T00:30:00+05:30')).valid, true);
  assert.equal(applyCoupon(c, 1299, 0, new Date('2026-10-20T23:00:00+05:30')).valid, true);
  assert.equal(applyCoupon(c, 1299, 0, new Date('2026-10-21T00:30:00+05:30')).reason, 'This code has expired.');
});
test('a coupon that has reached its use limit is not valid', () => {
  assert.equal(applyCoupon({ ...base, max_uses: 5 }, 1299, 4, NOW).valid, true);
  assert.equal(applyCoupon({ ...base, max_uses: 5 }, 1299, 5, NOW).reason, 'This code has been fully used.');
});
test('a coupon needs the minimum order amount', () => {
  assert.equal(applyCoupon({ ...base, min_amount: 1000 }, 999, 0, NOW).reason, 'This code needs an order of at least ₹1,000.');
  assert.equal(applyCoupon({ ...base, min_amount: 1000 }, 1000, 0, NOW).valid, true);
});
