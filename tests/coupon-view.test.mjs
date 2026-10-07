import test from 'node:test';
import assert from 'node:assert/strict';
import { couponRows } from '../admin/coupon-view.js';

const NOW = new Date('2026-10-10T10:00:00+05:30');
const c = (o) => ({ id: 'x', code: 'A', kind: 'percent', value: 10, min_amount: 0, active: true, starts_on: null, ends_on: null, max_uses: null, ...o });
const leads = [
  { coupon_code: 'A', status: 'paid', coupon_discount: 100 },
  { coupon_code: 'A', status: 'completed', coupon_discount: 130 },
  { coupon_code: 'A', status: 'new', coupon_discount: 90 },
  { coupon_code: 'B', status: 'scheduled', coupon_discount: 50 }
];

test('usage counts only quotes that went ahead, and totals the discount given', () => {
  const r = couponRows([c({ code: 'A' })], leads, NOW)[0];
  assert.equal(r.requested, 3); assert.equal(r.used, 2); assert.equal(r.given, 230);
});
test('status says active, scheduled, expired, used up or off', () => {
  const s = (o) => couponRows([c(o)], leads, NOW)[0].status;
  assert.equal(s({}), 'Active');
  assert.equal(s({ active: false }), 'Off');
  assert.equal(s({ starts_on: '2026-10-15' }), 'Scheduled');
  assert.equal(s({ ends_on: '2026-10-09' }), 'Expired');
  assert.equal(s({ max_uses: 2 }), 'Used up');
});
test('the offer text reads clearly for percent and flat codes', () => {
  assert.equal(couponRows([c({ kind: 'percent', value: 15 })], [], NOW)[0].offer, '15% off');
  assert.equal(couponRows([c({ kind: 'flat', value: 200, min_amount: 1000 })], [], NOW)[0].offer, '₹200 off orders of ₹1,000 or more');
});
test('active coupons come first, newest code list is stable by code', () => {
  const rows = couponRows([c({ code: 'B', active: false }), c({ code: 'C' }), c({ code: 'A' })], [], NOW);
  assert.deepEqual(rows.map((r) => r.code), ['A', 'C', 'B']);
});
