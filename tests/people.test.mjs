import test from 'node:test';
import assert from 'node:assert/strict';
import { customerRows, searchCustomers, mechanicStats } from '../admin/people.js';

const customers = [
  { id: 'c1', name: 'Asha', phone: '9876543210', blocked: false, notes: null },
  { id: 'c2', name: 'Ravi', phone: '9123456780', blocked: true, notes: 'prank bookings' },
  { id: 'c3', name: 'Meena', phone: '9000000001', blocked: false, notes: null }
];
const bikes = [
  { customer_id: 'c1', brand: 'Honda', model: 'Activa 6G', nickname: null },
  { customer_id: 'c1', brand: 'Royal Enfield', model: 'Classic 350', nickname: 'Raja' },
  { customer_id: 'c2', brand: 'Other', model: 'Scooty', nickname: null }
];
const leads = [
  { id: 'l1', ref: 'MP-1', customer_id: 'c1', paid_amount: 1299, status: 'completed', created_at: '2026-10-01T10:00:00Z', mechanic_id: 'm1' },
  { id: 'l2', ref: 'MP-2', customer_id: 'c1', paid_amount: 1599, status: 'completed', created_at: '2026-10-05T10:00:00Z', mechanic_id: 'm1' },
  { id: 'l3', ref: 'MP-3', customer_id: 'c2', paid_amount: null, status: 'new', created_at: '2026-10-06T10:00:00Z', mechanic_id: null },
  { id: 'l4', ref: 'MP-4', customer_id: 'c1', paid_amount: null, status: 'scheduled', created_at: '2026-10-07T10:00:00Z', mechanic_id: 'm1' },
  { id: 'l5', ref: 'MP-5', customer_id: 'c3', paid_amount: 199, status: 'lost', created_at: '2026-10-02T10:00:00Z', mechanic_id: 'm2' }
];

test('customerRows counts bookings, adds up paid money and lists bikes', () => {
  const r = customerRows(customers, bikes, leads).find((x) => x.id === 'c1');
  assert.equal(r.bookings, 3); assert.equal(r.paidTotal, 2898);
  assert.deepEqual(r.bikes, ['Honda Activa 6G', 'Royal Enfield Classic 350 "Raja"']);
  assert.equal(r.lastRef, 'MP-4'); assert.equal(r.lastAt, '2026-10-07T10:00:00Z');
});
test('customerRows keeps the blocked flag and notes and gives zero for no bookings', () => {
  const rows = customerRows(customers, bikes, leads);
  assert.equal(rows.find((x) => x.id === 'c2').blocked, true);
  assert.equal(rows.find((x) => x.id === 'c2').notes, 'prank bookings');
  const none = customerRows([{ id: 'c9', name: 'New', phone: '9999999999' }], [], []);
  assert.equal(none[0].bookings, 0); assert.equal(none[0].paidTotal, 0); assert.equal(none[0].lastAt, null); assert.deepEqual(none[0].bikes, []);
});
test('customerRows puts the most recent customers first, then by name', () => {
  assert.deepEqual(customerRows(customers, bikes, leads).map((x) => x.id), ['c1', 'c2', 'c3']);
  const tie = customerRows([{ id: 'b', name: 'Bala', phone: '9' }, { id: 'a', name: 'Anu', phone: '8' }], [], []);
  assert.deepEqual(tie.map((x) => x.id), ['a', 'b']);
});
test('searchCustomers matches name, phone and bike, ignoring case, and returns all for an empty search', () => {
  const rows = customerRows(customers, bikes, leads);
  assert.deepEqual(searchCustomers(rows, 'asha').map((x) => x.id), ['c1']);
  assert.deepEqual(searchCustomers(rows, '91234').map((x) => x.id), ['c2']);
  assert.deepEqual(searchCustomers(rows, 'CLASSIC').map((x) => x.id), ['c1']);
  assert.equal(searchCustomers(rows, '  ').length, 3);
  assert.equal(searchCustomers(rows, 'zzz').length, 0);
});

const mechanics = [{ id: 'm1', name: 'Kiran', payout_rate: 60, active: true }, { id: 'm2', name: 'Suresh', payout_rate: 0, active: true }, { id: 'm3', name: 'Idle', payout_rate: 50, active: false }];
test('mechanicStats counts open and completed jobs, revenue and payout', () => {
  const s = mechanicStats(mechanics, leads).find((x) => x.id === 'm1');
  assert.equal(s.completed, 2); assert.equal(s.open, 1); assert.equal(s.revenue, 2898); assert.equal(s.payout, 1739);
});
test('mechanicStats ignores lost jobs and pays nothing at a zero rate', () => {
  const s = mechanicStats(mechanics, leads).find((x) => x.id === 'm2');
  assert.equal(s.completed, 0); assert.equal(s.open, 0); assert.equal(s.revenue, 0); assert.equal(s.payout, 0);
});
test('mechanicStats lists everyone, busiest first, and keeps active mechanics ahead of inactive ones', () => {
  assert.deepEqual(mechanicStats(mechanics, leads).map((x) => x.id), ['m1', 'm2', 'm3']);
});
