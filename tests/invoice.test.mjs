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

test('a last-minute discount at the customer\'s request comes off the bill, after any coupon, and the GST is worked out on what is left', () => {
  const v = buildInvoice({ ...lead, coupon_discount: 100, extra_discount: 200, extra_discount_note: 'Regular customer' }, services);
  assert.equal(v.couponDiscount, 100); assert.equal(v.extraDiscount, 200); assert.equal(v.extraNote, 'Regular customer'); assert.equal(v.discount, 300);
  assert.equal(v.total, 1198); assert.equal(v.taxable, 1015.25); assert.equal(+(v.cgst + v.sgst).toFixed(2), +(v.total - v.taxable).toFixed(2));
});
test('the discounts can never take the bill below zero', () => {
  const v = buildInvoice({ ...lead, extra_discount: 99999 }, services);
  assert.equal(v.total, 0); assert.equal(v.extraDiscount, 1498);
});
test('if the customer already paid more than the new total, the invoice shows a refund due', () => {
  const v = buildInvoice({ ...lead, extra_discount: 400, paid_amount: 1498 }, services);
  assert.equal(v.total, 1098); assert.equal(v.balance, 0); assert.equal(v.refund, 400);
  assert.equal(buildInvoice({ ...lead, paid_amount: 349 }, services).refund, 0);
});
test('the invoice screen has a discount box (amount or percent, with a reason) that saves to the booking and redraws the bill', () => {
  const a = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  for (const id of ['inv-disc', 'inv-disc-kind', 'inv-disc-note']) assert.ok(a.includes(id), id);
  assert.match(a, /data-act="invDiscount"/); assert.match(a, /extra_discount/); assert.match(a, /invoice_discount/);
  assert.match(a, /Refund due/);
});
test('the database keeps the extra discount and its reason on the booking', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261025000000_invoice_discount.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists extra_discount integer not null default 0/); assert.match(sql, /add column if not exists extra_discount_note text/);
  assert.doesNotMatch(sql, /add column (?!if not exists)/);
});
