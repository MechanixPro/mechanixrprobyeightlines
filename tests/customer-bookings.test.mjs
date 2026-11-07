import { test } from 'node:test';
import assert from 'node:assert/strict';
import { customerLeads, bookingRows, summarize, customerList } from '../admin/customer-bookings.js';

const customer = { id: 'c1', name: 'Asha Rao', phone: '9876543210' };
const leads = [
  { id: 'l1', ref: 'MP-1', booking_id: 'MP-1', customer_id: 'c1', phone: '9876543210', status: 'completed', created_at: '2026-10-05T05:00:00Z', service_id: 'basic', est_total: 599, paid_amount: 599, preferred_date: '2026-10-06' },
  { id: 'l2', ref: 'MP-2', booking_id: 'MP-2', customer_id: null, phone: '9876543210', status: 'scheduled', created_at: '2026-10-12T05:00:00Z', service_id: 'general', est_total: 1199, paid_amount: 349, preferred_date: '2026-10-15' },
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

// ---- Unified Customers screen: ONE counting rule for the list and the detail ----
import { normPhone, customerSummaries } from '../admin/customer-bookings.js';
const dupCustomers = [
  { id: 'a', name: 'Asha', phone: '9876543210' }, { id: 'b', name: '', phone: '+91 98765 43210' }, { id: 'c', name: 'Chitra', phone: '09111111111' }, { id: 'd', name: 'Dev', phone: '9222222222' }, { id: 'e', name: '', phone: '' },
];
const dupLeads = [
  { id: 'x1', customer_id: 'a', phone: '9876543210', status: 'new', created_at: '2026-10-01T05:00:00Z', paid_amount: 0 },
  { id: 'x2', customer_id: null, phone: '+91 98765 43210', status: 'paid', created_at: '2026-10-03T05:00:00Z', paid_amount: 49 },
  { id: 'x3', customer_id: 'c', phone: '9111111111', status: 'completed', created_at: '2026-10-02T05:00:00Z', paid_amount: 899 },
  { id: 'x4', customer_id: 'd', phone: '9222222222', status: 'junk', created_at: '2026-10-04T05:00:00Z', paid_amount: 0 },
  { id: 'x5', customer_id: 'd', phone: '9222222222', status: 'new', deleted_at: '2026-10-05T05:00:00Z', created_at: '2026-10-05T05:00:00Z' },
];
test('normPhone keeps the last 10 digits whatever the format', () => {
  for (const v of ['9876543210', '+91 98765 43210', '09876543210', '91-9876543210', ' 98765 43210 ']) assert.equal(normPhone(v), '9876543210', v);
  assert.equal(normPhone(''), ''); assert.equal(normPhone('12345'), ''); assert.equal(normPhone(null), '');
});
test('bookings = not deleted or junk, linked by customer_id OR the same normalised phone', () => {
  assert.deepEqual(customerLeads(dupCustomers[0], dupLeads).map((l) => l.id), ['x2', 'x1']);
  assert.deepEqual(customerLeads(dupCustomers[2], dupLeads).map((l) => l.id), ['x3'], '0-prefixed phone still matches');
  assert.deepEqual(customerLeads(dupCustomers[3], dupLeads), [], 'junk and deleted are not counted');
});
test('the list and the detail can never disagree: every row count equals customerLeads and summarize', () => {
  for (const r of customerSummaries({ customers: dupCustomers, leads: dupLeads })) {
    const c = dupCustomers.find((x) => x.id === r.id), rows = bookingRows({ customer: c, leads: dupLeads, accounts: [] }), sm = summarize(rows);
    assert.equal(r.bookings, customerLeads(c, dupLeads).length); assert.equal(r.bookings, sm.bookings); assert.equal(r.paid, sm.paid);
  }
});
test('totals, last booking date and sort: latest first, blank names kept', () => {
  const rows = customerSummaries({ customers: dupCustomers, leads: dupLeads });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.equal(by.a.paid, 49); assert.equal(by.c.paid, 899); assert.equal(by.a.lastAt, Date.parse('2026-10-03T05:00:00Z'));
  assert.equal(by.e.bookings, 0); assert.equal(by.e.name, '');
  assert.deepEqual(rows.map((r) => r.id).slice(0, 3), ['a', 'b', 'c']);
});
test('Duplicate? appears when two customers share the last 10 digits (+91 and spaces variants), never for blank phones', () => {
  const by = Object.fromEntries(customerSummaries({ customers: dupCustomers, leads: dupLeads }).map((r) => [r.id, r]));
  assert.equal(by.a.duplicate, true); assert.equal(by.b.duplicate, true);
  assert.equal(by.c.duplicate, false); assert.equal(by.d.duplicate, false); assert.equal(by.e.duplicate, false);
  assert.equal(by.a.bookings, by.b.bookings, 'duplicates see the same bookings');
});
test('filters: open booking, paid, no name, duplicate; search finds a phone typed in any format', () => {
  const ids = (o) => customerSummaries({ customers: dupCustomers, leads: dupLeads, ...o }).map((r) => r.id).sort();
  assert.deepEqual(ids({ filter: 'open' }), ['a', 'b']); assert.deepEqual(ids({ filter: 'paid' }), ['a', 'b', 'c']);
  assert.deepEqual(ids({ filter: 'noname' }), ['b', 'e']); assert.deepEqual(ids({ filter: 'dup' }), ['a', 'b']);
  assert.deepEqual(ids({ q: '+91 98765 43210' }), ['a', 'b'], 'any phone format finds the number');
  assert.deepEqual(ids({ q: '9876543210' }), ['a', 'b']);
});
test('the bike labels come from the bikes table', () => {
  const [r] = customerSummaries({ customers: [dupCustomers[0]], leads: [], bikes: [{ customer_id: 'a', brand: 'Honda', model: 'Activa' }, { customer_id: 'a', brand: 'Other', model: 'Pulsar' }, { customer_id: 'z', brand: 'X', model: 'Y' }] });
  assert.deepEqual(r.bikes, ['Honda Activa', 'Pulsar']);
});
