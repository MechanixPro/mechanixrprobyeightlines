import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerLeads, bookingRows, summarize, customerList } from '../admin/customer-bookings.js';

const customer = { id: 'c1', name: 'Asha Rao', phone: '9876543210' };
const leads = [
  { id: 'l1', ref: 'MP-1', customer_id: 'c1', phone: '9876543210', status: 'completed', created_at: '2026-10-05T05:00:00Z', service_id: 'basic', est_total: 599, paid_amount: 599, preferred_date: '2026-10-06' },
  { id: 'l2', ref: 'MP-2', customer_id: null, phone: '9876543210', status: 'scheduled', created_at: '2026-10-12T05:00:00Z', service_id: 'general', est_total: 1199, paid_amount: 349, preferred_date: '2026-10-15' },
  { id: 'l3', ref: 'MP-3', customer_id: 'c2', phone: '9000000000', status: 'new', created_at: '2026-10-13T05:00:00Z', service_id: 'basic', est_total: 599, paid_amount: 0 },
];
const accounts = [{ lead_id: 'l1', total: 600, collected: 400, outstanding: 200 }];

test('a customer\'s bookings are matched by customer id or by phone, newest first', () => {
  assert.deepEqual(customerLeads(customer, leads).map((l) => l.ref), ['MP-2', 'MP-1']);
});
test('rows use the invoice figures when there is an invoice, otherwise the estimate and what was paid', () => {
  const rows = bookingRows({ customer, leads, accounts, svcName: (id) => id.toUpperCase() });
  assert.deepEqual(rows.map((r) => [r.ref, r.kind, r.total, r.paid, r.balance, r.service]), [['MP-2', 'estimate', 1199, 349, 0, 'GENERAL'], ['MP-1', 'invoice', 600, 400, 200, 'BASIC']]);
});
test('the summary adds up what was billed, paid and is still due', () => {
  const rows = bookingRows({ customer, leads, accounts, svcName: (id) => id });
  assert.deepEqual(summarize(rows), { bookings: 2, billed: 600, paid: 749, due: 200 });
});
test('the customer list counts bookings per customer, matches search text, and puts the latest first', () => {
  const customers = [customer, { id: 'c2', name: 'Bala', phone: '9000000000' }, { id: 'c3', name: 'Chitra', phone: '9111111111' }];
  const all = customerList({ customers, leads, q: '' });
  assert.deepEqual(all.map((c) => [c.id, c.bookings]), [['c2', 1], ['c1', 2], ['c3', 0]]);
  assert.deepEqual(customerList({ customers, leads, q: 'asha' }).map((c) => c.id), ['c1']);
  assert.deepEqual(customerList({ customers, leads, q: '9000' }).map((c) => c.id), ['c2']);
});
