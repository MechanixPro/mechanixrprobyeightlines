import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInvoice } from '../admin/invoice.js';

const services = [
  { id: 'general', kind: 'service', name: 'General service', price: 1299 },
  { id: 'wash', kind: 'addon', name: 'Foam wash', price: 199 },
  { id: 'bigbike', kind: 'fee', name: 'Big bike surcharge', price: 300 },
  { id: 'repair', kind: 'service', name: 'Repair or problem check', price: 349 },
];
const lead = { ref: 'MP-53020C', name: 'Asha', phone: '9876543210', service_id: 'general', addons: ['wash'], big_bike: false, coupon_discount: 0, paid_amount: 0, created_at: '2026-10-08T05:00:00Z' };

test('invoice lists the service and add-ons and splits GST out of the inclusive total', () => {
  const v = buildInvoice(lead, services);
  assert.deepEqual(v.lines.map((l) => [l.name, l.amount]), [['General service', 1299], ['Foam wash', 199]]);
  assert.equal(v.total, 1498);
  assert.equal(v.taxable, 1269.49);
  assert.equal(+(v.cgst + v.sgst).toFixed(2), +(v.total - v.taxable).toFixed(2));
  assert.equal(v.cgst, 114.26); assert.equal(v.sgst, 114.25);
});
test('big-bike surcharge applies only to service packages', () => {
  assert.equal(buildInvoice({ ...lead, big_bike: true, addons: [] }, services).total, 1599);
  assert.equal(buildInvoice({ ...lead, big_bike: true, addons: [], service_id: 'repair' }, services).total, 349);
});
test('coupon discount and amounts already paid reduce the balance, not the tax split of the bill', () => {
  const v = buildInvoice({ ...lead, coupon_discount: 100, paid_amount: 349 }, services);
  assert.equal(v.discount, 100); assert.equal(v.total, 1398); assert.equal(v.paid, 349); assert.equal(v.balance, 1049);
  assert.equal(v.taxable, 1184.75);
});
test('a fully paid booking shows no balance', () => {
  assert.equal(buildInvoice({ ...lead, paid_amount: 1498 }, services).balance, 0);
});
test('invoice number comes from the booking reference and the date is the booking date in India', () => {
  const v = buildInvoice(lead, services, { date: '2026-10-08T05:00:00Z' });
  assert.equal(v.number, 'INV-MP-53020C'); assert.equal(v.dateLabel, '8 Oct 2026');
});
test('unknown services give an empty bill instead of crashing', () => {
  assert.equal(buildInvoice({ ...lead, service_id: 'ghost', addons: [] }, services).total, 0);
});
test('admin wires the invoice: button, animation, print, company details, reduced motion', () => {
  const a = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(a, /data-act="invoice"/); assert.match(a, /window\.print\(\)/); assert.match(a, /company\.json/);
  const css = readFileSync(new URL('../admin/admin.css', import.meta.url), 'utf8');
  assert.match(css, /@media print/); assert.match(css, /prefers-reduced-motion/); assert.match(css, /\.inv-line/);
  assert.match(readFileSync(new URL('../scripts/build_admin.sh', import.meta.url), 'utf8'), /company\.json/);
});
