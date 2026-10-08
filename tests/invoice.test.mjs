import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildInvoice } from '../admin/invoice.js';
import { buildInvoice as buildInvoiceFn } from '../supabase/functions/_shared/invoice.ts';

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

// ---- Edited invoices: the admin can change the items and amounts, and say whether they are before or including GST ----
const OV = (o) => ({ ...lead, invoice_override: o });
for (const [label, build] of [['admin', buildInvoice], ['function', buildInvoiceFn]]) {
  test(`${label}: amounts entered before GST get 18% GST added on top`, () => {
    const v = build(OV({ basis: 'excl', lines: [{ name: 'Clutch plate set', amount: 1000 }, { name: 'Labour', amount: 500 }] }), services);
    assert.equal(v.basis, 'excl'); assert.equal(v.subtotal, 1500); assert.equal(v.taxable, 1500);
    assert.equal(v.cgst, 135); assert.equal(v.sgst, 135); assert.equal(v.total, 1770);
    assert.deepEqual(v.lines.map((l) => l.name), ['Clutch plate set', 'Labour']);
  });
  test(`${label}: a discount comes off before the GST is added`, () => {
    const v = build({ ...OV({ basis: 'excl', lines: [{ name: 'Labour', amount: 1000 }] }), extra_discount: 100 }, services);
    assert.equal(v.taxable, 900); assert.equal(v.total, 1062);
  });
  test(`${label}: amounts entered including GST keep the old split`, () => {
    const v = build(OV({ basis: 'incl', lines: [{ name: 'Labour', amount: 1180 }] }), services);
    assert.equal(v.total, 1180); assert.equal(v.taxable, 1000); assert.equal(v.cgst + v.sgst, 180);
  });
  test(`${label}: no override keeps the package prices as GST-included`, () => {
    const v = build(lead, services); assert.equal(v.basis, 'incl');
  });
  test(`${label}: a bad override is cleaned: junk lines dropped, names and amounts capped, unknown basis falls back`, () => {
    const v = build(OV({ basis: 'weird', lines: [{ name: '  ', amount: 5 }, { name: 'x'.repeat(200), amount: -4 }, { name: 'Ok', amount: 99999999 }, null, 'str'] }), services);
    assert.equal(v.basis, 'excl');
    assert.deepEqual(v.lines.map((l) => [l.name.length, l.amount]), [[80, 0], [2, 1000000]]);
  });
  test(`${label}: an empty override list falls back to the package lines`, () => {
    assert.equal(build(OV({ basis: 'excl', lines: [] }), services).lines[0].name, 'General service');
  });
}
test('the admin and the email function agree on an edited invoice', () => {
  const o = OV({ basis: 'excl', lines: [{ name: 'A', amount: 333.33 }, { name: 'B', amount: 17.5 }] });
  assert.deepEqual(buildInvoice(o, services, { date: '2026-10-08T05:00:00Z' }), buildInvoiceFn(o, services, { date: '2026-10-08T05:00:00Z' }));
});
test('the invoice screen and email say whether amounts are before or including GST and let the admin edit them', () => {
  const a = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8'), m = readFileSync(new URL('../supabase/functions/_shared/email-templates.ts', import.meta.url), 'utf8');
  assert.match(a, /'excl\.' : 'incl\.'/); assert.match(a, /data-act="invEdit"/); assert.match(a, /invoice_override/); assert.match(a, /data-act="invSaveEdit"/); assert.match(a, /data-act="invResetEdit"/);
  assert.match(m, /'excl\.' : 'incl\.'/); assert.match(m, /GST is added at 18%/);
  assert.match(readFileSync(new URL('../supabase/migrations/20261029000000_invoice_override.sql', import.meta.url), 'utf8'), /invoice_override jsonb/);
});
test('the plain-text invoice email says the same thing about GST as the HTML one', async () => {
  const { invoiceEmail } = await import('../supabase/functions/_shared/email-templates.ts');
  const mk = (basis) => invoiceEmail({ siteUrl: 'https://x', phoneDisplay: '1', phoneTel: '1', whatsappUrl: 'https://wa.me/1', email: 'a@b.in', company: { legalName: 'N', addressLines: [], city: 'B', state: 'K', pincode: '1', gstin: 'G' },
    invoice: buildInvoice({ ...lead, invoice_override: { basis, lines: [{ name: 'Labour', amount: 1000 }] } }, services) });
  assert.match(mk('excl').text, /Amounts are before GST/); assert.match(mk('excl').html, /Amounts are before GST/); assert.doesNotMatch(mk('excl').text, /Prices include 18% GST/);
  assert.match(mk('incl').text, /Prices include 18% GST/);
});
