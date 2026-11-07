import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRows, suggestKeeper, paidBookings, mergeConfirmText, mergeConfirmHtml, esc, withoutCustomer } from '../crm/dupes.js';

const r = (id, o = {}) => ({ customer_id: id, name: 'A', phone: '9876543210', group_key: '9876543210', bookings: 1, paid_total: 0, created_at: '2026-01-01T00:00:00Z', has_booking_id: false, ...o });

test('groups by normalised phone, drops singletons and bad phones', () => {
  const g = groupRows([r('a'), r('b', { phone: '+91 98765 43210', group_key: undefined }), r('c', { phone: '9000000001', group_key: '9000000001' }), r('d', { phone: '12', group_key: '12' }), null]);
  assert.equal(g.length, 1);
  assert.deepEqual(g[0].members.map((m) => m.customer_id), ['a', 'b']);
  assert.deepEqual(groupRows(null), []);
});
test('keeper: most paid bookings first', () => {
  assert.equal(suggestKeeper([r('a'), r('b', { has_booking_id: true, bookings: 2 })]), 'b');
  assert.equal(suggestKeeper([r('a', { confirmed_bookings: 1 }), r('b', { confirmed_bookings: 3, created_at: '2026-05-01' })]), 'b');
});
test('keeper: oldest on a tie, then id', () => {
  assert.equal(suggestKeeper([r('a', { created_at: '2026-03-01' }), r('b', { created_at: '2026-02-01' })]), 'b');
  assert.equal(suggestKeeper([r('b'), r('a')]), 'a');
  assert.equal(suggestKeeper([]), null);
  assert.equal(paidBookings(null), 0);
});
test('confirm text states what moves and what is kept; money only when allowed', () => {
  const k = r('k', { name: 'Ravi', bookings: 2, paid_total: 500 }), d = r('d', { name: 'Ravi K', bookings: 1, paid_total: 300 });
  const t = mergeConfirmText(k, d);
  assert.match(t, /What moves/); assert.match(t, /What is kept/); assert.match(t, /1 booking,/); assert.match(t, /undo/);
  assert.doesNotMatch(t, /₹/);
  const m = mergeConfirmText(k, d, { showMoney: true });
  assert.match(m, /₹300 paid/); assert.match(m, /₹500 paid/);
});
test('html is escaped', () => {
  const h = mergeConfirmHtml(r('k', { name: '<img onerror=x>' }), r('d', { name: '"><script>' }));
  assert.doesNotMatch(h, /<img|<script/);
  assert.equal(esc(`<&>"'`), '&lt;&amp;&gt;&quot;&#39;');
});
test('withoutCustomer', () => assert.deepEqual(withoutCustomer([r('a'), r('b')], 'a').map((x) => x.customer_id), ['b']));
